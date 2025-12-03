const { App, AwsLambdaReceiver } = require('@slack/bolt');
const fs = require('fs');
const path = require('path');

// Local dependencies
const { processFileUpload } = require('./processFileUpload');
const AirtableIntegration = require('./airtable-integration');
const { HybridDeduplicationService } = require('./dynamodb-deduplication');

// In-memory store for file data
const fileDataStore = new Map();

// Initialize deduplication service
const deduplicationService = new HybridDeduplicationService(console);
console.log('DynamoDB deduplication enabled');

// Legacy in-memory deduplication (kept for backward compatibility)
const processedEvents = new Map();
const EVENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Function to clean up old event IDs
function cleanupOldEvents() {
  const now = Date.now();
  let cleanedCount = 0;
  for (const [eventKey, timestamp] of processedEvents.entries()) {
    if (now - timestamp > EVENT_CACHE_TTL) {
      processedEvents.delete(eventKey);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} old event entries. Current cache size: ${processedEvents.size}`);
  }
}

// Run cleanup every minute (store reference for potential cleanup)
const cleanupInterval = setInterval(cleanupOldEvents, 60 * 1000);

// Clear interval on process termination (for Lambda)
process.on('SIGTERM', () => {
  clearInterval(cleanupInterval);
});

// --- Version Logging ---
let version = 'unknown';
try {
  version = fs.readFileSync(path.join(__dirname, 'version.txt'), 'utf8').trim();
} catch (e) {
  console.log('Could not read version.txt file.');
}
console.log(`---slack-classify-bot--- Version: ${version}`);
console.log(`Lambda instance started at: ${new Date().toISOString()}`);
console.log(`Event deduplication enabled with ${EVENT_CACHE_TTL / 1000}s TTL`);

// Initialize AWS Lambda Receiver
const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Initialize Bolt app with receiver
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
  processBeforeResponse: true,
});

// Log environment variable status
console.log('--- Environment Variables ---');
console.log('- SLACK_BOT_TOKEN:', process.env.SLACK_BOT_TOKEN ? 'Loaded' : 'Missing');
console.log('- SLACK_SIGNING_SECRET:', process.env.SLACK_SIGNING_SECRET ? 'Loaded' : 'Missing');
console.log('- N8N_ENDPOINT:', process.env.N8N_ENDPOINT ? 'Loaded' : 'Missing');
console.log('- N8N_AIRTABLE_ENDPOINT:', process.env.N8N_AIRTABLE_ENDPOINT ? 'Loaded' : 'Missing');
console.log('- AIRTABLE_BASE:', process.env.AIRTABLE_BASE ? 'Loaded' : 'Missing');
console.log('- AIRTABLE_TOKEN:', process.env.AIRTABLE_TOKEN ? 'Loaded' : 'Missing');
console.log('- SLACK_BOT_ID:', process.env.SLACK_BOT_ID ? process.env.SLACK_BOT_ID : 'Missing');
console.log('--------------------------');

// --- Event Handlers ---

// File Upload Event
app.message(async ({ message, client, logger, event }) => {
  // Log all message events for debugging
  if (message.subtype === 'file_share') {
    logger.info(`=== File share event received ===`);
    logger.info(`Timestamp: ${message.ts}`);
    logger.info(`Bot ID: ${message.bot_id || 'none'}`);
    logger.info(`User: ${message.user}`);
    logger.info(`Current processed events cache size: ${processedEvents.size}`);
  }
  
  // We only care about 'file_share' events from users or automation bots
  // Exclude our own bot responses if SLACK_BOT_ID is properly configured
  const isOurBot = process.env.SLACK_BOT_ID && process.env.SLACK_BOT_ID !== 'YOUR_BOT_ID_HERE' && message.bot_id === process.env.SLACK_BOT_ID;
  
  if (message.subtype === 'file_share' && !isOurBot) {
    if (!message.files || message.files.length === 0) {
      logger.warn('File share event, but no files found.');
      return;
    }
    
    // Create a unique event key
    const fileId = message.files[0].id;
    // Use event_id if available (from event context), otherwise use file ID + timestamp
    const eventId = event?.event_id;
    const eventKey = eventId || `${fileId}_${message.ts}`;
    
    logger.info(`Event details - Event ID: ${eventId || 'not available'}, File ID: ${fileId}, TS: ${message.ts}`);
    
    // Build metadata for deduplication
    const metadata = {
      file_id: fileId,
      channel_id: message.channel,
      user_id: message.user,
      lambda_instance_id: global.context?.awsRequestId || 'unknown'
    };
    
    try {
      // Check with DynamoDB deduplication service
      const { isNew, reason } = await deduplicationService.checkAndMarkProcessed(eventKey, metadata);
      
      if (!isNew) {
        logger.info(`Duplicate event detected (key: ${eventKey}), reason: ${reason}`);
        return;
      }
      
      logger.info(`Processing new file upload event (key: ${eventKey})`);
      await processFileUpload(message, client, logger, fileDataStore);
    } catch (error) {
      logger.error('Error in file upload processing:', error);
      
      // If it's a deduplication error, fall back to legacy in-memory check
      if (error.message && error.message.includes('deduplication')) {
        logger.info('Falling back to in-memory deduplication');
        if (processedEvents.has(eventKey)) {
          logger.info(`Duplicate event detected via fallback (key: ${eventKey})`);
          return;
        }
        processedEvents.set(eventKey, Date.now());
        logger.info(`Processing new file upload event via fallback (key: ${eventKey})`);
        
        try {
          await processFileUpload(message, client, logger, fileDataStore);
        } catch (processError) {
          logger.error('Error in processFileUpload:', processError);
        }
      }
    }
  }
});

// Project Selection Button Click
app.action(/select_project_.*/, async ({ ack, action, body, client, logger }) => {
  logger.info('=== ACTION HANDLER TRIGGERED ===');
  logger.info('Action ID:', action.action_id);
  logger.info('Action value:', action.value);
  
  await ack();
  logger.info('--- Project Selection Button Clicked ---');
  
  try {
    const airtableIntegration = new AirtableIntegration();
    
    // Parse action data to get project and file information
    const actionData = JSON.parse(action.value);
    const { projectId, fileId, fileName, projectName, summary } = actionData;
    
    // Get Slack channels for the selected project
    const slackChannels = await airtableIntegration.getSlackChannelsForProject(projectId, projectName);
    logger.info(`Found ${slackChannels.length} Slack channels for project ${projectId}:`, slackChannels);

    // Get channel names for better display
    const channelInfos = [];
    for (const channelId of slackChannels) {
      try {
        const channelInfo = await client.conversations.info({ channel: channelId });
        channelInfos.push({
          id: channelId,
          name: channelInfo.channel.name || channelId
        });
      } catch (error) {
        logger.warn(`Failed to get channel info for ${channelId}:`, error.message);
        channelInfos.push({
          id: channelId,
          name: channelId
        });
      }
    }

    // Always show channel selection UI (even with 0 channels, shows "GitHub only" button)
    const channelBlocks = airtableIntegration.createChannelSelectionBlocks(
      channelInfos,
      projectId,
      fileId,
      {
        fileName,
        channelId: body.channel.id,
        classificationResult: actionData.classificationResult,
        summary: summary
      },
      projectName
    );

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: channelBlocks,
      text: 'チャネルを選択してください。'
    });
  } catch (error) {
    logger.error('Error processing project selection:', error);
  }
});

// Channel Selection Button Click
app.action(/select_channel_.*/, async ({ ack, action, body, client, logger }) => {
  logger.info('=== CHANNEL SELECTION ACTION HANDLER ===');
  logger.info('Action ID:', action.action_id);
  logger.info('Action value:', action.value);
  
  await ack();
  logger.info('--- Channel Selection Button Clicked ---');
  
  try {
    const airtableIntegration = new AirtableIntegration();
    const { generateMeetingMinutes, formatMinutesForSlack } = require('./llm-integration');

    // Parse action data
    const actionData = JSON.parse(action.value);
    const { projectId, channelId, fileId, fileName, summary, projectName } = actionData;
    
    // Get channel name for display
    let channelName = channelId;
    try {
      const channelInfo = await client.conversations.info({ channel: channelId });
      channelName = channelInfo.channel.name || channelId;
    } catch (error) {
      logger.warn(`Failed to get channel name for ${channelId}:`, error.message);
    }
    
    // Immediately show processing message with cancel button
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ *チャネル選択完了*\n📢 投稿先: #${channelName}\n📄 ファイル: \`${fileName}\``
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🤖 *議事録を生成中...*\n\n⏳ AIが文字起こしデータから議事録を作成しています。\n少々お待ちください。"
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "← チャンネル選択に戻る"
              },
              action_id: "back_to_channel_selection",
              value: JSON.stringify({
                projectId,
                projectName,
                fileId,
                fileName,
                classificationResult: actionData.classificationResult,
                summary,
                sourceChannelId: body.channel.id
              })
            }
          ]
        }
      ],
      text: '議事録を生成中...'
    });
    
    // Get file content from store
    let fileData = fileDataStore.get(fileId) || fileDataStore.get(`${fileId}_${body.channel.id}`);
    
    if (!fileData || !fileData.content) {
      logger.info('File content not found in store, attempting to re-download from Slack');
      
      try {
        // Show message that we're retrieving the file
        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `✅ *チャネル選択完了*\n📢 投稿先: #${channelName}\n📄 ファイル: \`${fileName}\``
              }
            },
            {
              type: "divider"
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "📥 *ファイルを取得中...*\n\n⏳ Slackからファイルデータを再取得しています。\n少々お待ちください。"
              }
            }
          ],
          text: 'ファイルを取得中...'
        });

        // Re-download file from Slack
        const fileInfo = await client.files.info({ file: fileId });
        let fileContent = null;
        
        if (fileInfo.file.content) {
          fileContent = fileInfo.file.content;
        } else if (fileInfo.file.url_private_download) {
          const axios = require('axios');
          const response = await axios.get(fileInfo.file.url_private_download, {
            headers: {
              'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
            },
            responseType: 'text',
            timeout: 30000
          });
          fileContent = response.data;
        }
        
        if (!fileContent) {
          throw new Error('ファイルコンテンツの取得に失敗しました');
        }
        
        // Store the retrieved file data
        fileData = {
          content: fileContent,
          fileName: fileName
        };
        fileDataStore.set(fileId, fileData);
        fileDataStore.set(`${fileId}_${body.channel.id}`, fileData);
        
        logger.info('Successfully re-downloaded file content from Slack');
        
      } catch (error) {
        logger.error('Failed to re-download file content:', error);
        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "❌ *ファイル取得エラー*\n\nSlackからファイルデータを取得できませんでした。\nファイルが削除されているか、アクセス権限がない可能性があります。\n\n再度ファイルをアップロードしてください。"
              }
            }
          ],
          text: 'ファイル取得エラー'
        });
        return;
      }
    }
    
    // Generate meeting minutes with brainbase context
    const minutesData = await generateMeetingMinutes(fileData.content, projectName);
    // Format for Slack with mentions
    const meetingMinutes = await formatMinutesForSlack(minutesData);

    if (!meetingMinutes) {
      logger.error('Failed to generate meeting minutes');
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "❌ *議事録生成に失敗しました*\n\nAIによる議事録の生成でエラーが発生しました。しばらく待ってから再試行してください。"
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                style: "primary",
                text: {
                  type: "plain_text",
                  text: "再試行する"
                },
                action_id: "retry_generate_minutes",
                value: JSON.stringify({
                  projectId,
                  channelId,
                  fileId,
                  fileName,
                  summary,
                  projectName,
                  messageTs: body.message.ts,
                  sourceChannelId: body.channel.id
                })
              }
            ]
          }
        ],
        text: '議事録生成に失敗しました'
      });
      return;
    }
    
    // Show that minutes are being posted
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ *議事録生成完了*\n📢 投稿先: #${channelName}\n📄 ファイル: \`${fileName}\``
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "📤 *議事録を投稿中...*\n\n⏳ 指定されたチャネルに議事録を投稿しています。"
          }
        }
      ],
      text: '議事録を投稿中...'
    });
    
    // Post meeting minutes to selected channel (summary first, then detailed minutes in thread)
    const postResult = await airtableIntegration.postMinutesToChannel(
      client,
      channelId,
      meetingMinutes,
      fileName,
      summary || fileData.summary // Use summary from action data first, then fallback to fileData
    );
    
    if (postResult.success) {
      // Create completion blocks with full information preserved
      const completionBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📝 *アップロードされたファイル*\n📄 ファイル名: \`${fileName}\`\n📅 処理日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
          }
        },
        {
          type: "divider"
        }
      ];

      // Add summary if available
      const useSummary = summary || fileData.summary;
      if (useSummary) {
        completionBlocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📋 *要約*\n${useSummary}`
          }
        });
        completionBlocks.push({
          type: "divider"
        });
      }

      completionBlocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🎉 *処理完了*\n\n✅ 会議要約を #${channelName} に投稿しました\n💬 詳細議事録をスレッドに投稿しました\n⏰ 投稿時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🔄 *GitHubコミット処理を開始中...*\n\n⏳ ファイルをGitHubリポジトリにコミットしています。"
          }
        }
      );

      // Update original message with success confirmation
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: completionBlocks,
        text: '議事録を投稿しました。GitHubコミット処理中...'
      });
      
      // Also proceed with the original GitHub workflow
      await airtableIntegration.processFileWithProject(
        {
          ...action,
          value: JSON.stringify({
            projectId,
            projectName,
            fileId,
            fileName,
            channelId: body.channel.id,
            classificationResult: actionData.classificationResult
          })
        },
        body,
        client,
        logger,
        fileDataStore
      );
    } else {
      logger.error('Failed to post minutes to channel:', postResult.error);
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `❌ *議事録投稿に失敗しました*\n\n📢 投稿先: #${channelName}\n📄 ファイル: \`${fileName}\`\n\n⚠️ エラー: ${postResult.error}`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "← チャンネル選択に戻る"
                },
                action_id: "back_to_channel_selection",
                value: JSON.stringify({
                  projectId,
                  projectName,
                  fileId,
                  fileName,
                  classificationResult: actionData.classificationResult,
                  summary,
                  sourceChannelId: body.channel.id
                })
              }
            ]
          }
        ],
        text: '議事録投稿に失敗しました'
      });
    }
  } catch (error) {
    logger.error('Error processing channel selection:', error);

    // Try to parse action data for back button
    let backButtonBlock = [];
    try {
      const actionData = JSON.parse(action.value);
      backButtonBlock = [{
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "← チャンネル選択に戻る"
            },
            action_id: "back_to_channel_selection",
            value: JSON.stringify({
              projectId: actionData.projectId,
              projectName: actionData.projectName,
              fileId: actionData.fileId,
              fileName: actionData.fileName,
              classificationResult: actionData.classificationResult,
              summary: actionData.summary,
              sourceChannelId: body.channel.id
            })
          }
        ]
      }];
    } catch (e) {
      // If we can't parse action data, skip the back button
    }

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "❌ *処理中にエラーが発生しました*\n\nチャネル選択の処理でエラーが発生しました。しばらく待ってから再度お試しください。"
          }
        },
        ...backButtonBlock
      ],
      text: '処理中にエラーが発生しました'
    });
  }
});

// Skip channel posting - GitHub only
app.action('skip_channel_github_only', async ({ ack, action, body, client, logger }) => {
  logger.info('=== SKIP CHANNEL (GITHUB ONLY) ACTION HANDLER ===');
  logger.info('Action ID:', action.action_id);
  logger.info('Action value:', action.value);

  await ack();
  logger.info('--- Skip Channel, GitHub Only Button Clicked ---');

  try {
    const airtableIntegration = new AirtableIntegration();

    // Parse action data
    const actionData = JSON.parse(action.value);
    const { projectId, projectName, fileId, fileName, summary } = actionData;

    // Show processing message
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📦 *GitHubのみモード*\n📄 ファイル: \`${fileName}\`\n📂 プロジェクト: *${projectName}*`
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🔄 *GitHubコミット処理を開始中...*\n\n⏳ Slackへの投稿をスキップし、GitHubリポジトリに直接コミットしています。"
          }
        }
      ],
      text: 'GitHubコミット処理中...'
    });

    // Proceed directly with GitHub workflow (skip channel posting)
    await airtableIntegration.processFileWithProject(
      {
        ...action,
        value: JSON.stringify({
          projectId,
          projectName,
          fileId,
          fileName,
          channelId: body.channel.id,
          classificationResult: actionData.classificationResult,
          summary: summary
        })
      },
      body,
      client,
      logger,
      fileDataStore
    );

  } catch (error) {
    logger.error('Error processing GitHub-only action:', error);
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "❌ *処理中にエラーが発生しました*\n\nGitHubへのコミット処理でエラーが発生しました。しばらく待ってから再度お試しください。"
          }
        }
      ],
      text: '処理中にエラーが発生しました'
    });
  }
});

// Retry meeting minutes generation
app.action('retry_generate_minutes', async ({ ack, action, body, client, logger }) => {
  await ack();

  try {
    const airtableIntegration = new AirtableIntegration();
    const { generateMeetingMinutes, formatMinutesForSlack } = require('./llm-integration');

    const actionData = JSON.parse(action.value || '{}');
    const { projectId, channelId, fileId, fileName, summary, projectName, messageTs, sourceChannelId } = actionData;

    // Fallbacks
    const updateChannel = sourceChannelId || body.channel.id;
    const updateTs = messageTs || body.message?.ts;

    // Indicate retry start
    await client.chat.update({
      channel: updateChannel,
      ts: updateTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🔄 *再試行中...*\n議事録を再生成しています。\n📄 ファイル: \`${fileName || 'unknown'}\``
          }
        }
      ],
      text: '議事録再生成を開始'
    });

    // Ensure file data is available
    let fileData = fileDataStore.get(fileId) || fileDataStore.get(`${fileId}_${updateChannel}`);

    if (!fileData || !fileData.content) {
      logger.info('File content not found in store during retry, attempting to re-download from Slack');

      const fileInfo = await client.files.info({ file: fileId });
      let fileContent = null;

      if (fileInfo.file.content) {
        fileContent = fileInfo.file.content;
      } else if (fileInfo.file.url_private_download) {
        const axios = require('axios');
        const response = await axios.get(fileInfo.file.url_private_download, {
          headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}` },
          responseType: 'text',
          timeout: 30000
        });
        fileContent = response.data;
      }

      if (!fileContent) {
        throw new Error('ファイルコンテンツの再取得に失敗しました');
      }

      fileData = { content: fileContent, fileName: fileName };
      fileDataStore.set(fileId, fileData);
      fileDataStore.set(`${fileId}_${updateChannel}`, fileData);
    }

    const minutesData = await generateMeetingMinutes(fileData.content, projectName);
    const meetingMinutes = await formatMinutesForSlack(minutesData);

    if (!meetingMinutes) {
      throw new Error('再試行でも議事録生成に失敗しました');
    }

    // Post minutes to selected channel
    const postResult = await airtableIntegration.postMinutesToChannel(
      client,
      channelId,
      meetingMinutes,
      fileName,
      summary || fileData.summary
    );

    if (!postResult.success) {
      throw new Error('議事録の投稿に失敗しました');
    }

    // Update status with success
    const channelName = channelId;
    await client.chat.update({
      channel: updateChannel,
      ts: updateTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ *議事録生成完了*\n📢 投稿先: <#${channelId}>\n📄 ファイル: \`${fileName}\``
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "📤 *議事録を投稿しました。*"
          }
        }
      ],
      text: '議事録生成完了'
    });

  } catch (error) {
    logger.error('Retry generate minutes failed:', error);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `❌ *再試行に失敗しました*\n${error.message || '不明なエラーが発生しました。'}\n\nもう一度お試しください。`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              style: "primary",
              text: { type: "plain_text", text: "もう一度再試行" },
              action_id: "retry_generate_minutes",
              value: action.value
            }
          ]
        }
      ],
      text: '再試行に失敗しました'
    });
  }
});

// Update Record Button Click
app.action('update_airtable_record', async ({ ack, body, client, logger }) => {
  await ack();
  logger.info('--- Update Airtable Record Button Clicked ---');
  try {
    const airtableIntegration = new AirtableIntegration();
    const projects = await airtableIntegration.getProjects();
    const fileData = { fileName: 'unknown', channelId: body.channel.id, classificationResult: {} };
    const newBlocks = airtableIntegration.createProjectSelectionBlocks(
      projects,
      body.message.ts,
      fileData
    );
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: newBlocks,
      text: 'プロジェクトを再選択してください。',
    });
  } catch (error) {
    logger.error('Failed to handle update_airtable_record action:', error);
  }
});

// Change Project Selection Button Click
app.action('change_project_selection', async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('--- Change Project Selection Button Clicked ---');
  
  try {
    const airtableIntegration = new AirtableIntegration();
    const actionData = JSON.parse(action.value);
    const { fileId, fileName, channelId, classificationResult, summary } = actionData;
    
    // プロジェクト一覧を取得
    const projects = await airtableIntegration.getProjects();
    
    // ファイルデータを復元してfileDataStoreに保存
    const fileData = {
      fileName: fileName,
      channelId: channelId,
      classificationResult: classificationResult,
      summary: summary
    };
    fileDataStore.set(fileId, fileData);
    fileDataStore.set(`${fileId}_${channelId}`, fileData);
    
    // プロジェクト選択画面を表示
    const newBlocks = airtableIntegration.createProjectSelectionBlocks(
      projects,
      fileId,
      fileData
    );
    
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: newBlocks,
      text: 'プロジェクトを選択し直してください。'
    });
    
    logger.info('Successfully returned to project selection screen');
  } catch (error) {
    logger.error('Error handling change project selection:', error);
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "❌ *プロジェクト変更エラー*\n\nプロジェクト選択画面の表示中にエラーが発生しました。"
          }
        }
      ],
      text: 'プロジェクト変更エラー'
    });
  }
});

// Retry File Processing Button Click
app.action('retry_file_processing', async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('--- Retry File Processing Button Clicked ---');

  try {
    const actionData = JSON.parse(action.value);
    const { fileId, fileName, channelId, userId, threadTs } = actionData;

    logger.info(`Retrying file processing for: ${fileName} (${fileId})`);

    // Get file data from store
    const fileData = fileDataStore.get(fileId);
    if (!fileData || !fileData.content) {
      logger.error(`File data or content not found for file ID: ${fileId}`);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: '❌ ファイルデータが見つかりませんでした。再度ファイルをアップロードしてください。'
      });
      return;
    }

    // Post retry message
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: '🔄 処理を再試行しています...'
    });

    // Reconstruct message object for processFileUpload
    const reconstructedMessage = {
      files: [{
        id: fileId,
        name: fileName
      }],
      channel: channelId,
      user: userId,
      ts: threadTs,
      thread_ts: threadTs
    };

    // Re-run processFileUpload
    await processFileUpload(reconstructedMessage, client, logger, fileDataStore);

  } catch (error) {
    logger.error('Error retrying file processing:', error);
    const actionData = JSON.parse(action.value);
    await client.chat.postMessage({
      channel: actionData.channelId,
      thread_ts: actionData.threadTs,
      text: `❌ 再試行中にエラーが発生しました: ${error.message}`
    });
  }
});

// Re-select Project for Re-commit Button Click
app.action('reselect_project_for_recommit', async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('--- Re-select Project for Re-commit Button Clicked ---');

  try {
    const airtableIntegration = new AirtableIntegration();
    const actionData = JSON.parse(action.value);
    const { fileId, fileName, summary, previousCommits } = actionData;

    logger.info(`Re-commit requested for file: ${fileName} (${fileId})`);
    logger.info('Previous commits:', previousCommits);

    // Get all projects
    const projects = await airtableIntegration.getProjects();

    if (!projects || projects.length === 0) {
      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message.ts,
        text: 'プロジェクトが見つかりませんでした。'
      });
      return;
    }

    // Create file data object
    const fileData = {
      fileName: fileName,
      summary: summary,
      channelId: body.channel.id,
      classificationResult: {}
    };

    // Store file data (for later retrieval)
    fileDataStore.set(fileId, fileData);
    fileDataStore.set(`${fileId}_${body.channel.id}`, fileData);

    // Create project selection blocks with previous commits info
    const blocks = [];

    // Header
    blocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: "🔄 別のプロジェクトに再コミット",
        emoji: true
      }
    });

    // File info
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*ファイル名:* ${fileName}`
      }
    });

    blocks.push({ type: "divider" });

    // Previous commits info
    if (previousCommits && previousCommits.length > 0) {
      const previousCommitsText = previousCommits.map(commit =>
        `• ${commit.project} → ${commit.repo} (${commit.branch})`
      ).join('\n');

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*📋 既にコミット済み:*\n${previousCommitsText}`
        }
      });

      blocks.push({ type: "divider" });
    }

    // Project selection
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "🎯 *別のプロジェクトを選択してください*"
      }
    });

    // Add project buttons
    const projectBlocks = airtableIntegration.createProjectSelectionBlocks(projects, fileId, fileData);
    const actionBlocks = projectBlocks.filter(block => block.type === 'actions');
    blocks.push(...actionBlocks);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: blocks,
      text: '別のプロジェクトを選択してください。'
    });

    logger.info('Successfully showed project selection for re-commit');

  } catch (error) {
    logger.error('Error handling reselect project for recommit:', error);
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "❌ *エラー*\n\nプロジェクト選択画面の表示中にエラーが発生しました。"
          }
        }
      ],
      text: 'プロジェクト選択エラー'
    });
  }
});

// Back to Channel Selection Button Click
app.action('back_to_channel_selection', async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('--- Back to Channel Selection Button Clicked ---');

  try {
    const airtableIntegration = new AirtableIntegration();
    const actionData = JSON.parse(action.value);
    const { projectId, projectName, fileId, fileName, classificationResult, summary, sourceChannelId } = actionData;

    // Get Slack channels for the project
    const slackChannels = await airtableIntegration.getSlackChannelsForProject(projectId, projectName);
    logger.info(`Found ${slackChannels.length} Slack channels for project ${projectId}`);

    if (slackChannels.length === 0) {
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "⚠️ *チャンネルが設定されていません*\n\nこのプロジェクトにはSlackチャンネルが設定されていません。"
            }
          }
        ],
        text: 'チャンネルが設定されていません'
      });
      return;
    }

    // Get channel names for better display
    const channelInfos = [];
    for (const channelId of slackChannels) {
      try {
        const channelInfo = await client.conversations.info({ channel: channelId });
        channelInfos.push({
          id: channelId,
          name: channelInfo.channel.name || channelId
        });
      } catch (error) {
        logger.warn(`Failed to get channel info for ${channelId}:`, error.message);
        channelInfos.push({
          id: channelId,
          name: channelId
        });
      }
    }

    // Show channel selection UI
    const channelBlocks = airtableIntegration.createChannelSelectionBlocks(
      channelInfos,
      projectId,
      fileId,
      {
        fileName,
        channelId: sourceChannelId || body.channel.id,
        classificationResult: classificationResult || {},
        summary: summary
      },
      projectName
    );

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: channelBlocks,
      text: 'チャネルを選択してください。'
    });

    logger.info('Successfully returned to channel selection screen');
  } catch (error) {
    logger.error('Error handling back to channel selection:', error);
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "❌ *エラー*\n\nチャンネル選択画面の表示中にエラーが発生しました。"
          }
        }
      ],
      text: 'チャンネル選択エラー'
    });
  }
});

// --- Task Intake from Mentions (Phase 2: AI PM) ---
// @slack-classify-bot + @k.sato へのメンションでタスクを抽出して _tasks/index.md に追記
const KEIGO_USER_ID = 'U07LNUP582X';
const BOT_USER_ID = process.env.SLACK_BOT_USER_ID || 'U07M53WFD3V';

app.message(async ({ message, client, logger }) => {
  // Botへのメンション + k.satoへのメンション両方が必要
  const hasBotMention = message.text && message.text.includes(`<@${BOT_USER_ID}>`);
  const hasKeigoMention = message.text && message.text.includes(`<@${KEIGO_USER_ID}>`);

  if (!hasBotMention || !hasKeigoMention) {
    return;
  }

  // ファイル共有イベントは既存ハンドラで処理するのでスキップ
  if (message.subtype === 'file_share') {
    return;
  }

  // ボット自身のメッセージはスキップ
  if (message.bot_id) {
    return;
  }

  logger.info('=== TASK INTAKE HANDLER (@bot + @k.sato) ===');
  logger.info('Message:', JSON.stringify(message, null, 2));

  try {
    const { extractTaskFromMessage } = require('./llm-integration');
    const GitHubIntegration = require('./github-integration');

    // チャンネル名を取得
    let channelName = message.channel;
    try {
      const channelInfo = await client.conversations.info({ channel: message.channel });
      channelName = channelInfo.channel.name || message.channel;
    } catch (e) {
      logger.warn('Failed to get channel name:', e.message);
    }

    // 送信者名を取得
    let senderName = message.user;
    try {
      const userInfo = await client.users.info({ user: message.user });
      senderName = userInfo.user.real_name || userInfo.user.name || message.user;
    } catch (e) {
      logger.warn('Failed to get user name:', e.message);
    }

    // メンションを除去したテキスト
    const cleanedText = message.text
      .replace(/<@[A-Z0-9]+>/g, '')
      .trim();

    if (!cleanedText || cleanedText.length < 5) {
      logger.info('Message too short after removing mentions, skipping');
      return;
    }

    // 処理中メッセージを投稿
    const processingMsg = await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: '📝 タスクを解析中...'
    });

    // LLMでタスク抽出
    const task = await extractTaskFromMessage(cleanedText, channelName, senderName);

    if (!task) {
      logger.info('No task extracted from message');
      await client.chat.update({
        channel: message.channel,
        ts: processingMsg.ts,
        text: '💭 タスクとして認識できませんでした。依頼内容を具体的に記載してください。'
      });
      return;
    }

    logger.info('Extracted task:', JSON.stringify(task, null, 2));

    // Slackメッセージへのリンクを生成
    const workspaceId = process.env.SLACK_WORKSPACE_ID || 'unson-inc';
    const slackLink = `https://${workspaceId}.slack.com/archives/${message.channel}/p${message.ts.replace('.', '')}`;

    // GitHub APIでタスクを追記
    const github = new GitHubIntegration();
    const result = await github.appendTask(task, slackLink);

    if (result.success) {
      logger.info('Task appended successfully:', result);

      // 成功メッセージ
      const dueText = task.due ? `📅 期限: ${task.due}` : '';
      const priorityEmoji = task.priority === 'high' ? '🔴' : task.priority === 'low' ? '🟢' : '🟡';

      await client.chat.update({
        channel: message.channel,
        ts: processingMsg.ts,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ *タスクを登録しました*\n\n*タイトル:* ${task.title}\n*プロジェクト:* ${task.project_id || 'general'}\n${priorityEmoji} *優先度:* ${task.priority || 'medium'}\n${dueText}`
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `📋 <${result.commitUrl}|_tasks/index.md に追記> | ID: \`${result.taskId}\``
              }
            ]
          }
        ],
        text: `✅ タスク「${task.title}」を登録しました`
      });
    } else {
      throw new Error('Failed to append task to GitHub');
    }

  } catch (error) {
    logger.error('Error processing task intake:', error);

    // エラーメッセージ
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: `❌ タスク登録に失敗しました: ${error.message}`
    });
  }
});

// Catch-all action handler for debugging (excluding already handled actions)
app.action(/^(?!select_project_|select_channel_|update_airtable_record|change_project_selection|retry_file_processing|reselect_project_for_recommit|skip_channel_github_only|retry_generate_minutes|back_to_channel_selection|cancel_).*/, async ({ ack, action, logger }) => {
  logger.info('=== CATCH-ALL ACTION HANDLER ===');
  logger.info('Unhandled action:', action.action_id);
  logger.info('Action type:', action.type);
  await ack();
});

// --- Lambda Handler ---
// This is the standard handler format for Bolt on AWS Lambda.
module.exports.handler = async (event, context, callback) => {
  const handler = await awsLambdaReceiver.start();
  return handler(event, context, callback);
};
