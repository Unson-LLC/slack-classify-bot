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
    const slackChannels = await airtableIntegration.getSlackChannelsForProject(projectId);
    logger.info(`Found ${slackChannels.length} Slack channels for project ${projectId}:`, slackChannels);
    
    if (slackChannels.length === 0) {
      // No channels configured, proceed with original workflow
      logger.info('No Slack channels configured for project, proceeding with original workflow');
      await airtableIntegration.processFileWithProject(action, body, client, logger, fileDataStore);
    } else {
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
          channelId: body.channel.id, 
          classificationResult: actionData.classificationResult,
          summary: summary // Use summary from button data
        },
        projectName
      );
      
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: channelBlocks,
        text: 'チャネルを選択してください。'
      });
    }
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
    const { generateMeetingMinutes } = require('./llm-integration');
    
    // Parse action data
    const actionData = JSON.parse(action.value);
    const { projectId, channelId, fileId, fileName, summary } = actionData;
    
    // Get channel name for display
    let channelName = channelId;
    try {
      const channelInfo = await client.conversations.info({ channel: channelId });
      channelName = channelInfo.channel.name || channelId;
    } catch (error) {
      logger.warn(`Failed to get channel name for ${channelId}:`, error.message);
    }
    
    // Immediately show processing message
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
    
    // Generate meeting minutes
    const meetingMinutes = await generateMeetingMinutes(fileData.content);
    
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
              text: "❌ *議事録生成に失敗しました*\n\nAIによる議事録の生成でエラーが発生しました。しばらく待ってから再度お試しください。"
            }
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
          }
        ],
        text: '議事録投稿に失敗しました'
      });
    }
  } catch (error) {
    logger.error('Error processing channel selection:', error);
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
        }
      ],
      text: '処理中にエラーが発生しました'
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

// Catch-all action handler for debugging (excluding already handled actions)
app.action(/^(?!select_project_|select_channel_|update_airtable_record|change_project_selection|cancel_).*/, async ({ ack, action, logger }) => {
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