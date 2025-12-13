const { App, AwsLambdaReceiver } = require('@slack/bolt');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const fs = require('fs');
const path = require('path');

// Local dependencies
const { processFileUpload } = require('./processFileUpload');
const AirtableIntegration = require('./airtable-integration');
const { HybridDeduplicationService } = require('./dynamodb-deduplication');
const SlackArchive = require('./slack-archive');
const { generateFollowupMessage, formatMinutesForSlack } = require('./llm-integration');
const { getInstance: getConversationMemory } = require('./conversation-memory');
const { getProjectIdByChannel } = require('./channel-project-resolver');
const { isImageFile, downloadAndEncodeImage, analyzeImage } = require('./image-recognition');

// Lambda client for async self-invocation
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Initialize Slack archive for message backup (Phase 2.5)
const slackArchive = new SlackArchive();
const ARCHIVE_ENABLED = process.env.SLACK_ARCHIVE_ENABLED !== 'false';

// In-memory store for file data
const fileDataStore = new Map();

// Initialize deduplication service
const deduplicationService = new HybridDeduplicationService(console);
console.log('DynamoDB deduplication enabled');

// Build follow-up (thank-you) message draft for copy & paste
function buildFollowupTemplate({ summary, actions, recipient, sender }) {
  const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const toLine = recipient && recipient.trim() !== '' ? `${recipient} 各位` : 'ご担当者様 各位';
  const fromLine = sender && sender.trim() !== '' ? sender : '（お名前を入れてください）';

  const actionLines = Array.isArray(actions) && actions.length > 0
    ? actions.map(a => `- ${a.task}（${a.assignee || '担当未設定'}、${a.deadline || '期限未設定'}）`).join('\n')
    : '- なし（追記してください）';

  return [
    `件名: 本日の打合せありがとうございました（${today}）`,
    ``,
    `${toLine}`,
    ``,
    `お世話になっております。${fromLine}です。本日の打合せの振り返りとNext Actionを共有いたします。`,
    ``,
    `【本日のサマリ】`,
    summary ? `- ${summary}` : '- （サマリ未設定。必要に応じて追記してください）',
    ``,
    `【決定事項・Next Action】`,
    actionLines,
    ``,
    `【お願い】`,
    `- 内容に認識違いがあればご指摘ください。`,
    ``,
    `以上、引き続きよろしくお願いいたします。`,
    ``,
    `${fromLine}`
  ].join('\n');
}

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

// --- Slack Message Helpers ---
const SLACK_MESSAGE_LIMIT = 35000; // Slackの上限は40000、余裕を持たせる

/**
 * Slackメッセージのblocksからテキストを再帰的に抽出する
 * @param {Array|Object} blocks - Slack blocks or elements
 * @returns {string} 抽出されたテキスト
 */
function extractTextFromBlocks(blocks) {
  if (!blocks) return '';

  const texts = [];

  function extractFromElement(element) {
    if (!element) return;

    // 直接テキストを持つ要素
    if (element.type === 'text' && element.text) {
      texts.push(element.text);
      return;
    }

    // mrkdwn形式
    if (element.type === 'mrkdwn' && element.text) {
      texts.push(element.text);
      return;
    }

    // plain_text形式
    if (element.type === 'plain_text' && element.text) {
      texts.push(element.text);
      return;
    }

    // section blockのtext
    if (element.type === 'section') {
      if (element.text && element.text.text) {
        texts.push(element.text.text);
      }
      if (element.fields) {
        element.fields.forEach(field => {
          if (field.text) texts.push(field.text);
        });
      }
    }

    // rich_text block
    if (element.type === 'rich_text' && element.elements) {
      element.elements.forEach(extractFromElement);
    }

    // rich_text_section
    if (element.type === 'rich_text_section' && element.elements) {
      element.elements.forEach(extractFromElement);
    }

    // rich_text_list
    if (element.type === 'rich_text_list' && element.elements) {
      element.elements.forEach(extractFromElement);
    }

    // rich_text_preformatted
    if (element.type === 'rich_text_preformatted' && element.elements) {
      element.elements.forEach(extractFromElement);
    }

    // context block
    if (element.type === 'context' && element.elements) {
      element.elements.forEach(extractFromElement);
    }

    // header block
    if (element.type === 'header' && element.text && element.text.text) {
      texts.push(element.text.text);
    }

    // 子要素を再帰的に処理
    if (element.elements) {
      element.elements.forEach(extractFromElement);
    }
  }

  // blocksが配列の場合
  if (Array.isArray(blocks)) {
    blocks.forEach(extractFromElement);
  } else {
    extractFromElement(blocks);
  }

  return texts.join('\n');
}

/**
 * 長いメッセージを分割して送信する
 * @param {Object} client - Slack client
 * @param {string} channel - チャンネルID
 * @param {string} ts - メッセージのタイムスタンプ（最初のメッセージを更新）
 * @param {string} text - 送信するテキスト
 * @param {string} threadTs - スレッドのタイムスタンプ（オプション）
 */
async function sendLongMessage(client, channel, ts, text, threadTs = null) {
  console.log(`[sendLongMessage] Text length: ${text.length}, limit: ${SLACK_MESSAGE_LIMIT}`);

  // Helper: chat.updateが失敗したらpostMessageにフォールバック
  async function safeUpdate(updateText, isFirst = true) {
    try {
      await client.chat.update({
        channel,
        ts,
        text: updateText
      });
    } catch (updateErr) {
      console.warn(`[sendLongMessage] chat.update failed (${updateErr.data?.error || updateErr.message}), falling back to postMessage`);
      // フォールバック: 新しいメッセージとして送信
      if (isFirst) {
        // 最初のメッセージはプレースホルダを削除して新規投稿
        try {
          await client.chat.delete({ channel, ts });
        } catch (delErr) {
          console.warn('[sendLongMessage] Failed to delete placeholder:', delErr.message);
        }
      }
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs || ts,
        text: updateText
      });
    }
  }

  // 短いメッセージはそのまま送信
  if (text.length <= SLACK_MESSAGE_LIMIT) {
    await safeUpdate(text);
    return;
  }

  // 長いメッセージは分割
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= SLACK_MESSAGE_LIMIT) {
      chunks.push(remaining);
      break;
    }

    // 改行で区切れる場所を探す
    let splitIndex = remaining.lastIndexOf('\n', SLACK_MESSAGE_LIMIT);
    if (splitIndex === -1 || splitIndex < SLACK_MESSAGE_LIMIT * 0.5) {
      // 改行が見つからないか遠すぎる場合は強制分割
      splitIndex = SLACK_MESSAGE_LIMIT;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  // 最初のチャンクで元のメッセージを更新
  await safeUpdate(chunks[0] + (chunks.length > 1 ? '\n\n_(続き...)_' : ''), true);

  // 残りのチャンクは新しいメッセージとして送信
  for (let i = 1; i < chunks.length; i++) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs || ts,
      text: `_(続き ${i + 1}/${chunks.length})_\n\n${chunks[i]}`
    });
  }
}

// --- Version Logging ---
let version = 'unknown';
try {
  version = fs.readFileSync(path.join(__dirname, 'version.txt'), 'utf8').trim();
} catch (e) {
  console.log('Could not read version.txt file.');
}
console.log(`---mana--- Version: ${version}`);
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
console.log('- SLACK_ARCHIVE_ENABLED:', ARCHIVE_ENABLED ? 'Enabled' : 'Disabled');
console.log('- INBOX_TARGET_USER_ID:', process.env.INBOX_TARGET_USER_ID || 'U07LNUP582X (default k.sato)');
console.log('--------------------------');

// --- Event Handlers ---

// Message Archive Handler (Phase 2.5: ソースデータ蓄積)
// 全メッセージをS3にアーカイブ
app.message(async ({ message, client, logger }) => {
  if (!ARCHIVE_ENABLED) return;
  if (message.bot_id) return;

  try {
    let channelName = message.channel;
    let userName = message.user;

    try {
      const channelInfo = await client.conversations.info({ channel: message.channel });
      channelName = channelInfo.channel?.name || message.channel;
    } catch (e) { /* ignore */ }

    try {
      const userInfo = await client.users.info({ user: message.user });
      userName = userInfo.user?.real_name || userInfo.user?.name || message.user;
    } catch (e) { /* ignore */ }

    await slackArchive.archiveMessage(message, channelName, userName);
  } catch (error) {
    logger.warn('Failed to archive message:', error.message);
  }
});

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
    
    // Get Slack channels for the selected project (with names from DynamoDB)
    const channelInfos = await airtableIntegration.getSlackChannelsForProject(projectId, projectName, true);
    logger.info(`Found ${channelInfos.length} Slack channels for project ${projectId}:`, channelInfos);

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
    const { projectId, channelId, fileId, fileName, summary, projectName, workspace, channelName: actionChannelName } = actionData;

    // Get channel name for display (use from action data if available)
    let channelName = actionChannelName || channelId;
    const targetWorkspace = workspace || 'unson';

    // Get workspace-specific client for crosspost
    const { WebClient } = require('@slack/web-api');
    let targetClient = client;

    if (targetWorkspace !== 'unson') {
      let targetToken;
      switch (targetWorkspace) {
        case 'techknight':
          targetToken = process.env.SLACK_BOT_TOKEN_TECHKNIGHT;
          break;
        case 'salestailor':
          targetToken = process.env.SLACK_BOT_TOKEN_SALESTAILOR;
          break;
        default:
          targetToken = null;
      }

      if (!targetToken) {
        logger.error(`No token found for workspace: ${targetWorkspace}`);
        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          text: `❌ ワークスペース *${targetWorkspace}* のトークンが設定されていません。`,
          blocks: [{
            type: "section",
            text: { type: "mrkdwn", text: `❌ ワークスペース *${targetWorkspace}* のトークンが設定されていません。環境変数を確認してください。` }
          }]
        });
        return;
      }

      targetClient = new WebClient(targetToken);
      logger.info(`Using ${targetWorkspace} token for crosspost to #${channelName}`);
    }

    // If no channel name from action, try to get from API (only works for same workspace)
    if (!actionChannelName && targetWorkspace === 'unson') {
      try {
        const channelInfo = await client.conversations.info({ channel: channelId });
        channelName = channelInfo.channel.name || channelId;
      } catch (error) {
        logger.warn(`Failed to get channel name for ${channelId}:`, error.message);
      }
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
    // Use targetClient for crosspost to different workspace
    const postResult = await airtableIntegration.postMinutesToChannel(
      targetClient,
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
          type: "actions",
          elements: [
            {
              type: "button",
              style: "primary",
              text: { type: "plain_text", text: "お礼メッセージを作成" },
              action_id: "open_followup_modal",
              value: JSON.stringify({
                summary: summary || fileData.summary || '',
                actions: minutesData?.actions || [],
                minutes: minutesData?.minutes || meetingMinutes || '',
                projectName,
                channelId: body.channel.id,
                messageTs: body.message.ts,
                threadTs: body.message.thread_ts || body.message.ts
              }).slice(0, 1900) // Slack value length guard
            }
          ]
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

// Follow-up (thank-you) message generator
app.action('open_followup_modal', async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('=== OPEN FOLLOWUP MODAL ===');

  let payload = {};
  try {
    payload = JSON.parse(action.value || '{}');
  } catch (e) {
    logger.warn('Failed to parse followup payload:', e.message);
  }

  // Resolve sender info from Slack user and brainbase
  const slackUserId = body.user.id;
  let senderDisplay = '';
  let brainbaseName = '';
  try {
    const userInfo = await client.users.info({ user: slackUserId });
    senderDisplay = userInfo.user?.real_name || userInfo.user?.name || '';

    // Get brainbase name mapping
    const { getSlackIdToBrainbaseName } = require('./slack-name-resolver');
    const slackToBrainbase = await getSlackIdToBrainbaseName();
    brainbaseName = slackToBrainbase.get(slackUserId) || '';
    if (brainbaseName) {
      logger.info(`Resolved brainbase name: ${brainbaseName} for Slack user ${slackUserId}`);
    }
  } catch (e) {
    logger.warn('Failed to resolve sender name:', e.message);
  }

  const recipientDisplay = payload.recipient || 'ご担当者様';

  // Prefer channel/thread info from action body to avoid truncation
  const channelId = payload.channelId || body.channel?.id || '';
  const messageTs = payload.messageTs || body.message?.ts || '';
  const threadTs = payload.threadTs || body.message?.thread_ts || messageTs;

  // Build private_metadata with critical fields first (channelId, threadTs)
  // so they survive truncation. Truncate minutes/actions if needed.
  const metadataObj = {
    channelId,
    messageTs,
    threadTs,
    projectName: payload.projectName || '',
    slackUserId,
    senderDisplay,
    brainbaseName,
    summary: (payload.summary || '').slice(0, 500),
    actions: (payload.actions || []).slice(0, 5),
    minutes: (payload.minutes || '').slice(0, 1200)
  };
  const privateMetadata = JSON.stringify(metadataObj);
  logger.info('Followup modal private_metadata:', { channelId, messageTs, threadTs, slackUserId, brainbaseName, length: privateMetadata.length });

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "followup_modal_config",
        title: { type: "plain_text", text: "お礼メッセージ作成" },
        close: { type: "plain_text", text: "キャンセル" },
        submit: { type: "plain_text", text: "作成" },
        private_metadata: privateMetadata,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `送り手: *${brainbaseName || senderDisplay || 'あなた'}*\n宛先と補足を入力して「作成」を押すと、このスレッドに下書きが投稿されます。`
            }
          },
          {
            type: "input",
            block_id: "recipient_block",
            label: { type: "plain_text", text: "宛先（任意）" },
            optional: true,
            element: {
              type: "plain_text_input",
              action_id: "recipient_input",
              initial_value: recipientDisplay,
              placeholder: { type: "plain_text", text: "例: 田中様 / ○○社 ご担当者様" }
            }
          },
          {
            type: "input",
            block_id: "notes_block",
            label: { type: "plain_text", text: "伝えたい意図・一言（任意）" },
            optional: true,
            element: {
              type: "plain_text_input",
              action_id: "notes_input",
              multiline: true,
              placeholder: { type: "plain_text", text: "例: 次回デモ日程を第2候補まで提示したい、決裁者同席を依頼したい など" }
            }
          }
        ]
      }
    });
  } catch (error) {
    logger.error('Failed to open followup modal:', error);
  }
});

// Handle follow-up modal submission: close modal immediately, invoke Lambda async for LLM generation
app.view('followup_modal_config', async ({ ack, body, view, client, logger }) => {
  // Extract all data BEFORE ack()
  const state = view.state?.values || {};
  const recipient = state.recipient_block?.recipient_input?.value || 'ご担当者様';
  const notes = state.notes_block?.notes_input?.value || '';

  let metadata = {};
  try {
    metadata = JSON.parse(view.private_metadata || '{}');
  } catch (e) {
    // ignore
  }

  // Close modal IMMEDIATELY
  await ack();
  logger.info('=== FOLLOWUP CONFIG SUBMIT - Modal closed ===');

  // Use sender info from metadata (auto-resolved from Slack user)
  const sender = metadata.brainbaseName || metadata.senderDisplay || '';

  // Invoke Lambda async for LLM generation
  const asyncPayload = {
    type: 'followup_async',
    channelId: metadata.channelId,
    threadTs: metadata.threadTs || metadata.messageTs,
    summary: metadata.summary || '',
    actions: metadata.actions || [],
    minutes: metadata.minutes || '',
    projectName: metadata.projectName || '',
    slackUserId: metadata.slackUserId || '',
    brainbaseName: metadata.brainbaseName || '',
    recipient,
    sender,
    userNotes: notes
  };

  try {
    const command = new InvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
      InvocationType: 'Event', // async - don't wait
      Payload: JSON.stringify(asyncPayload)
    });
    await lambdaClient.send(command);
    logger.info('Followup async Lambda invoked');
  } catch (e) {
    logger.error('Failed to invoke async Lambda:', e.message);
  }
});

// Regenerate from result modal
app.view('followup_modal_result', async ({ ack, body, view, client, logger }) => {
  logger.info('=== FOLLOWUP RESULT RESUBMIT ===');
  const state = view.state?.values || {};

  const recipient = state.recipient_block?.recipient_input?.value || 'ご担当者様';
  const sender = state.sender_block?.sender_input?.value || '';
  const notes = state.notes_block?.notes_input?.value || '';
  const subjectInput = state.subject_block?.subject_input?.value || '';
  const bodyInput = state.body_block?.body_input?.value || '';
  const postToThread = !!(state.post_block?.post_to_thread_toggle?.selected_options || []).find(opt => opt.value === 'post_to_thread');

  let metadata = {};
  try {
    metadata = JSON.parse(view.private_metadata || '{}');
  } catch (e) {
    logger.warn('Failed to parse followup private_metadata:', e.message);
  }

  const generationInput = {
    summary: metadata.summary || '',
    actions: metadata.actions || [],
    minutes: metadata.minutes || '',
    projectName: metadata.projectName || '',
    recipient,
    sender,
    userNotes: notes,
    postToThread,
    channelId: metadata.channelId,
    messageTs: metadata.messageTs,
    threadTs: metadata.threadTs
  };

  await ack({
    response_action: 'update',
    view: {
      type: "modal",
      callback_id: "followup_modal_loading",
      title: { type: "plain_text", text: "お礼メッセージ再生成中..." },
      close: { type: "plain_text", text: "キャンセル" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "少々お待ちください。文面を再生成しています..." }
        }
      ]
    }
  });

  let generated = null;
  try {
    generated = await generateFollowupMessage(generationInput);
  } catch (e) {
    logger.error('generateFollowupMessage failed, fallback to user edits/template:', e);
  }

  const subject = generated?.subject || subjectInput || `本日の打合せありがとうございました（${new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}）`;
  const bodyText = generated?.body || bodyInput || buildFollowupTemplate({
    summary: generationInput.summary,
    actions: generationInput.actions,
    recipient,
    sender
  });

  // Post to Slack thread first (so下書きが確実に残る)
  if (generationInput.postToThread && generationInput.channelId) {
    const threadTs = generationInput.threadTs || generationInput.messageTs;
    const text = `${subject}\n\n${bodyText}`;
    logger.info('Posting followup draft to thread (resubmit):', {
      channel: generationInput.channelId,
      thread_ts: threadTs,
      textLength: text.length
    });
    try {
      const postResult = await client.chat.postMessage({
        channel: generationInput.channelId,
        thread_ts: threadTs,
        text
      });
      logger.info('Followup draft posted successfully (resubmit):', { ok: postResult.ok, ts: postResult.ts });
    } catch (e) {
      logger.error('Failed to post followup draft to thread (result resubmit path):', {
        error: e.data?.error || e.message,
        channel: generationInput.channelId,
        thread_ts: threadTs
      });
    }
  } else {
    logger.warn('Skipping thread post (resubmit):', {
      postToThread: generationInput.postToThread,
      channelId: generationInput.channelId,
      threadTs: generationInput.threadTs
    });
  }

  try {
    await client.views.update({
      view_id: view.id,
      view: {
        type: "modal",
        callback_id: "followup_modal_result",
        title: { type: "plain_text", text: "お礼メッセージ（コピー用）" },
        close: { type: "plain_text", text: "閉じる" },
        submit: { type: "plain_text", text: "再生成" },
        private_metadata: JSON.stringify({
          channelId: generationInput.channelId,
          messageTs: generationInput.messageTs,
          threadTs: generationInput.threadTs,
          projectName: generationInput.projectName,
          summary: (generationInput.summary || '').slice(0, 500),
          actions: (generationInput.actions || []).slice(0, 5),
          minutes: (generationInput.minutes || '').slice(0, 1500)
        }),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "生成し直しました。必要に応じて編集してコピーしてください。"
            }
          },
          {
            type: "input",
            block_id: "recipient_block",
            label: { type: "plain_text", text: "宛先（任意）" },
            optional: true,
            element: {
              type: "plain_text_input",
              action_id: "recipient_input",
              initial_value: recipient
            }
          },
          {
            type: "input",
            block_id: "sender_block",
            label: { type: "plain_text", text: "送り手（任意）" },
            optional: true,
            element: {
              type: "plain_text_input",
              action_id: "sender_input",
              initial_value: sender
            }
          },
          {
            type: "input",
            block_id: "notes_block",
            label: { type: "plain_text", text: "伝えたい意図・一言（任意）" },
            optional: true,
            element: {
              type: "plain_text_input",
              action_id: "notes_input",
              multiline: true,
              initial_value: notes
            }
          },
          {
            type: "input",
            block_id: "post_block",
            label: { type: "plain_text", text: "生成結果をこのスレッドに下書き投稿する" },
            optional: true,
            element: {
              type: "checkboxes",
              action_id: "post_to_thread_toggle",
              options: [
                {
                  text: { type: "plain_text", text: "はい、投稿する" },
                  value: "post_to_thread"
                }
              ],
              initial_options: generationInput.postToThread ? [
                {
                  text: { type: "plain_text", text: "はい、投稿する" },
                  value: "post_to_thread"
                }
              ] : []
            }
          },
          {
            type: "input",
            block_id: "subject_block",
            label: { type: "plain_text", text: "件名" },
            element: {
              type: "plain_text_input",
              action_id: "subject_input",
              initial_value: subject
            }
          },
          {
            type: "input",
            block_id: "body_block",
            label: { type: "plain_text", text: "本文" },
            element: {
              type: "plain_text_input",
              action_id: "body_input",
              multiline: true,
              initial_value: bodyText
            }
          }
        ]
      }
    });
  } catch (error) {
    logger.error('Failed to update followup result modal:', error);
  }

  if (generationInput.postToThread && generationInput.channelId) {
    const threadTs = generationInput.threadTs || generationInput.messageTs;
    const text = `${subject}\n\n${bodyText}`;
    try {
      await client.chat.postMessage({
        channel: generationInput.channelId,
        thread_ts: threadTs,
        text
      });
    } catch (e) {
      logger.error('Failed to post followup draft to thread:', e);
    }
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

    // Get Slack channels for the project (with names from DynamoDB, no Slack API calls needed)
    const channelInfos = await airtableIntegration.getSlackChannelsForProject(projectId, projectName, true);
    logger.info(`Found ${channelInfos.length} Slack channels for project ${projectId}`);

    if (channelInfos.length === 0) {
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

// --- Crosspost Action Handlers ---
// Show crosspost channel selection UI
app.action('open_crosspost_selection', async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('=== OPEN CROSSPOST SELECTION ===');

  let payload = {};
  try {
    payload = JSON.parse(action.value || '{}');
  } catch (e) {
    logger.warn('Failed to parse crosspost payload:', e.message);
  }

  const { crosspostChannels, projectName, summary, minutes, fileName, channelId, threadTs } = payload;

  if (!crosspostChannels || crosspostChannels.length === 0) {
    logger.warn('No crosspost channels found in payload');
    return;
  }

  // Build channel selection blocks
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "📤 他のワークスペースに共有",
        emoji: true
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${projectName}* の議事録を他のワークスペースに共有します。\n\n📄 ファイル: ${fileName}\n\n共有先のチャンネルを選択してください:`
      }
    },
    {
      type: "divider"
    }
  ];

  // Group channels by workspace
  const channelsByWorkspace = {};
  for (const ch of crosspostChannels) {
    const ws = ch.workspace || 'unknown';
    if (!channelsByWorkspace[ws]) {
      channelsByWorkspace[ws] = [];
    }
    channelsByWorkspace[ws].push(ch);
  }

  // Add channel buttons grouped by workspace
  for (const [workspace, channels] of Object.entries(channelsByWorkspace)) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📱 ${workspace}* ワークスペース`
      }
    });

    const channelButtons = channels.map(ch => ({
      type: "button",
      text: {
        type: "plain_text",
        text: `#${ch.channel_name}`,
        emoji: true
      },
      value: JSON.stringify({
        channelId: ch.channel_id,
        channelName: ch.channel_name,
        workspace: ch.workspace,
        type: ch.type,
        projectName,
        summary: summary ? summary.slice(0, 500) : '',
        minutes: minutes ? minutes.slice(0, 1000) : '',
        fileName,
        sourceChannelId: channelId,
        sourceThreadTs: threadTs
      }),
      action_id: `crosspost_to_channel_${ch.channel_id}`,
      style: "primary"
    }));

    // Split into chunks of 5 (Slack limit per action block)
    const chunks = [];
    for (let i = 0; i < channelButtons.length; i += 5) {
      chunks.push(channelButtons.slice(i, i + 5));
    }

    for (const chunk of chunks) {
      blocks.push({
        type: "actions",
        elements: chunk
      });
    }
  }

  // Add close button
  blocks.push({
    type: "divider"
  });
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "閉じる",
          emoji: true
        },
        value: "close",
        action_id: "cancel_crosspost_selection"
      }
    ]
  });

  // Post the selection UI in the thread
  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    blocks,
    text: '他のワークスペースに共有するチャンネルを選択してください'
  });
});

// Handle crosspost to specific channel
app.action(/crosspost_to_channel_.*/, async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('=== CROSSPOST TO CHANNEL ===');
  logger.info('Action ID:', action.action_id);

  let payload = {};
  try {
    payload = JSON.parse(action.value || '{}');
  } catch (e) {
    logger.error('Failed to parse crosspost action value:', e.message);
    return;
  }

  const { channelId, channelName, workspace, projectName, summary, minutes, fileName, sourceChannelId, sourceThreadTs } = payload;

  if (!channelId || !workspace) {
    logger.error('Missing channelId or workspace in crosspost payload');
    return;
  }

  // Get workspace-specific token
  const { WebClient } = require('@slack/web-api');
  let targetToken;
  let targetClient;

  switch (workspace) {
    case 'techknight':
      targetToken = process.env.SLACK_BOT_TOKEN_TECHKNIGHT;
      break;
    case 'salestailor':
      targetToken = process.env.SLACK_BOT_TOKEN_SALESTAILOR;
      break;
    case 'unson':
    default:
      targetToken = process.env.SLACK_BOT_TOKEN;
      break;
  }

  if (!targetToken) {
    logger.error(`No token found for workspace: ${workspace}`);
    await client.chat.postMessage({
      channel: sourceChannelId,
      thread_ts: sourceThreadTs,
      text: `❌ ワークスペース *${workspace}* のトークンが設定されていません。環境変数を確認してください。`
    });
    return;
  }

  targetClient = new WebClient(targetToken);

  // Post to target channel
  try {
    logger.info(`Crossposting to ${workspace}/#${channelName} (${channelId})`);

    // Post summary first
    const summaryBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📝 *会議要約: ${fileName}*\n\n_${projectName} プロジェクトからの共有です_`
        }
      },
      {
        type: "divider"
      }
    ];

    if (summary) {
      summaryBlocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: summary
        }
      });
    } else {
      summaryBlocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "📋 要約データが利用できません。"
        }
      });
    }

    summaryBlocks.push(
      {
        type: "divider"
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `💬 _詳細な議事録はスレッドに投稿されます_`
          }
        ]
      }
    );

    const summaryResponse = await targetClient.chat.postMessage({
      channel: channelId,
      text: `📝 会議要約: ${fileName}`,
      blocks: summaryBlocks
    });

    // Post minutes in thread if available
    if (minutes) {
      const minutesBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📄 *詳細議事録*\n\n${minutes.slice(0, 2800)}`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `🤖 _この議事録はAIにより自動生成されました_`
            }
          ]
        }
      ];

      await targetClient.chat.postMessage({
        channel: channelId,
        thread_ts: summaryResponse.ts,
        text: `📄 詳細議事録: ${fileName}`,
        blocks: minutesBlocks
      });
    }

    // Notify success in source thread
    await client.chat.postMessage({
      channel: sourceChannelId,
      thread_ts: sourceThreadTs,
      text: `✅ *${workspace}* ワークスペースの *#${channelName}* に議事録を共有しました。`
    });

    logger.info(`Successfully crossposted to ${workspace}/#${channelName}`);

  } catch (error) {
    logger.error('Error crossposting to channel:', error);
    await client.chat.postMessage({
      channel: sourceChannelId,
      thread_ts: sourceThreadTs,
      text: `❌ *${workspace}* ワークスペースへの共有中にエラーが発生しました: ${error.message}`
    });
  }
});

// Cancel crosspost selection
app.action('cancel_crosspost_selection', async ({ ack, body, client, logger }) => {
  await ack();
  logger.info('Crosspost selection cancelled');

  // Just acknowledge - the message will stay but user can ignore it
});

// --- App Mention Handler (Phase 2: AI PM + Phase 5b: Project AI PM) ---
// @mana へのメンションに応答
// - 質問系: Project AI PMに転送（Phase 5b）
// - タスク系: タスク登録（既存）
app.event('app_mention', async ({ event, client, logger, context }) => {
  logger.info('=== APP_MENTION EVENT RECEIVED ===');
  logger.info(`Team: ${context.teamId || event.team}`);
  logger.info(`Channel: ${event.channel}`);
  logger.info(`User: ${event.user}`);
  logger.info(`Text: ${event.text}`);

  // --- Deduplication check for app_mention ---
  const mentionEventKey = `app_mention:${event.channel}:${event.ts}`;
  const mentionMetadata = {
    channel_id: event.channel,
    user_id: event.user,
    text_preview: event.text?.substring(0, 50),
    lambda_instance_id: global.context?.awsRequestId || 'unknown'
  };

  try {
    const { isNew, reason } = await deduplicationService.checkAndMarkProcessed(mentionEventKey, mentionMetadata);
    if (!isNew) {
      logger.info(`Duplicate app_mention detected (key: ${mentionEventKey}), reason: ${reason}`);
      return;
    }
    logger.info(`Processing new app_mention event (key: ${mentionEventKey})`);
  } catch (dedupError) {
    logger.warn('Deduplication check failed, falling back to in-memory:', dedupError.message);
    if (processedEvents.has(mentionEventKey)) {
      logger.info(`Duplicate app_mention detected via fallback (key: ${mentionEventKey})`);
      return;
    }
    processedEvents.set(mentionEventKey, Date.now());
  }

  try {
    const { extractTasksFromMessage } = require('./llm-integration');
    const GitHubIntegration = require('./github-integration');
    const { getSlackIdToBrainbaseName } = require('./slack-name-resolver');

    // メンションを抽出
    const mentionRegex = /<@([A-Z0-9]+)>/g;
    const mentions = event.text.match(mentionRegex) || [];
    const botUserId = await getBotUserId();

    // Bot以外のメンションを抽出（担当者候補）
    const assigneeMentions = mentions
      .map(m => m.replace(/<@|>/g, ''))
      .filter(id => id !== botUserId);

    logger.info(`Assignee mentions: ${assigneeMentions.join(', ') || 'none'}`);

    // メンションを除去したテキスト
    const cleanedText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

    if (!cleanedText || cleanedText.length < 3) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: '💭 何かお手伝いできることはありますか？\n\n• 質問: `@mana 〇〇について教えて`\n• タスク登録: `@mana @担当者 〇〇をお願い`'
      });
      return;
    }

    // --- Phase 5b: 質問系メッセージの検出とAI PMへのルーティング ---
    // ルール: 担当者メンションがない場合は全てAI PM（質問モード）へルーティング
    // タスク作成は @mana + @担当者 が必要
    const isQuestion = assigneeMentions.length === 0;

    if (isQuestion) {
      logger.info('Question detected, routing to Project AI PM');

      // --- 画像認識処理 ---
      // 画像ファイルが添付されている場合は画像認識モードに
      if (event.files && event.files.length > 0) {
        const imageFiles = event.files.filter(isImageFile);
        if (imageFiles.length > 0) {
          logger.info(`Image files detected: ${imageFiles.length}`);

          const processingMsg = await client.chat.postMessage({
            channel: event.channel,
            thread_ts: event.ts,
            text: '🖼️ 画像を解析中...'
          });

          try {
            // 最初の画像を処理（複数画像は今後対応）
            const imageFile = imageFiles[0];
            const botToken = process.env.SLACK_BOT_TOKEN;

            logger.info(`Downloading image: ${imageFile.name} (${imageFile.mimetype})`);
            const imageData = await downloadAndEncodeImage(imageFile, botToken);

            logger.info('Analyzing image with Claude Vision...');
            const prompt = cleanedText || 'この画像について説明してください。';
            const analysis = await analyzeImage(imageData, prompt);

            if (analysis) {
              await client.chat.update({
                channel: event.channel,
                ts: processingMsg.ts,
                text: `🖼️ *画像解析結果*\n\n${analysis}`
              });
            } else {
              await client.chat.update({
                channel: event.channel,
                ts: processingMsg.ts,
                text: '画像を解析できませんでした。'
              });
            }
            return;
          } catch (imgError) {
            logger.error('Image recognition error:', imgError);
            await client.chat.update({
              channel: event.channel,
              ts: processingMsg.ts,
              text: `画像の解析中にエラーが発生しました: ${imgError.message}`
            });
            return;
          }
        }
      }
      // --- End of 画像認識処理 ---

      // 処理中メッセージ
      const processingMsg = await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: '🤔 考え中...'
      });

      // チャンネル名を取得
      let channelName = event.channel;
      try {
        const channelInfo = await client.conversations.info({ channel: event.channel });
        channelName = channelInfo.channel?.name || event.channel;
      } catch (e) {
        logger.warn('Failed to get channel name:', e.message);
      }

      // 送信者名を取得
      let senderName = event.user;
      try {
        const userInfo = await client.users.info({ user: event.user });
        senderName = userInfo.user?.real_name || userInfo.user?.name || event.user;
      } catch (e) {
        logger.warn('Failed to get user name:', e.message);
      }

      // スレッドコンテキストを取得（スレッド内での質問の場合）
      let threadContext = '';
      const threadTs = event.thread_ts;
      if (threadTs) {
        try {
          const { getThreadContext } = require('./thread-context');
          const { getSlackIdToBrainbaseName } = require('./slack-name-resolver');
          const slackIdToName = await getSlackIdToBrainbaseName();

          threadContext = await getThreadContext({
            client,
            channel: event.channel,
            threadTs,
            currentTs: event.ts,
            slackIdToName
          });

          if (threadContext) {
            logger.info(`Thread context added: ${threadContext.length} chars`);
          }
        } catch (e) {
          logger.warn('Failed to get thread context:', e.message);
        }
      }

      // 質問にスレッドコンテキストを追加
      const questionWithContext = cleanedText + threadContext;

      // --- プロジェクトID検出（Memory用に先に実行） ---
      // 1. S3のchannels.jsonからチャンネルID→プロジェクトIDをマッピング
      let projectId = await getProjectIdByChannel(event.channel);
      logger.info(`Channel ${event.channel} mapped to project: ${projectId}`);

      // 2. チャンネルで特定できない場合はワークスペースのデフォルトプロジェクトを使用
      const teamId = context.teamId || event.team;
      if (projectId === 'general' && teamId) {
        const workspaceDefaultProjects = {
          'T08EUJKQY07': 'salestailor',  // SalesTailorワークスペース
          'T07A9J3PEMB': 'techknight',   // TechKnightワークスペース
        };
        if (workspaceDefaultProjects[teamId]) {
          projectId = workspaceDefaultProjects[teamId];
          logger.info(`Using workspace default project: ${projectId} for team ${teamId}`);
        }
      }

      // 3. それでも特定できない場合は質問文から検出
      const textLower = cleanedText.toLowerCase();
      if (projectId === 'general') {
        const projectKeywords = {
          'zeims': ['zeims', 'ゼイムス', '採用管理'],
          'salestailor': ['salestailor', 'セールステイラー', 'セールスレター'],
          'techknight': ['techknight', 'テックナイト', 'tech knight'],
          'aitle': ['aitle', 'アイトル'],
          'dialogai': ['dialogai', 'ダイアログ'],
          'senrigan': ['senrigan', 'センリガン', '千里眼'],
          'baao': ['baao', 'バーオ'],
        };

        for (const [pid, keywords] of Object.entries(projectKeywords)) {
          if (keywords.some(kw => textLower.includes(kw.toLowerCase()))) {
            projectId = pid;
            logger.info(`Detected project "${pid}" from question keywords`);
            break;
          }
        }
      }

      // --- 会話メモリ統合（Phase 1） ---
      const conversationMemory = getConversationMemory();
      const userId = event.user;

      // ユーザーの質問を保存
      await conversationMemory.saveMessage(projectId, userId, {
        role: 'user',
        content: cleanedText
      });

      // 過去の会話履歴を取得（最新10件）
      const conversationHistory = await conversationMemory.formatForLLM(projectId, userId, 10);
      logger.info(`Conversation history loaded: ${conversationHistory.length} messages for ${projectId}:${userId}`);

      // AI PMに質問（Mastraまたは既存Bedrockを使用）
      try {
        let response = null;

        // Mastraブリッジを試す（ESM dynamic import）
        try {
          const mastraBridge = await import('./dist/mastra/bridge.js');
          logger.info('Using Mastra bridge for question');
          response = await mastraBridge.askProjectPM(questionWithContext, {
            channelName,
            senderName,
            threadId: event.ts,
            teamId: context.teamId || event.team,
            conversationHistory,  // 会話履歴を渡す
            projectId: projectId.replace('proj_', ''),  // チャンネルから解決したプロジェクトID
            // 進捗表示コールバック（ツール実行時にメッセージを更新）
            onProgress: async (progressText) => {
              try {
                await client.chat.update({
                  channel: event.channel,
                  ts: processingMsg.ts,
                  text: progressText
                });
              } catch (updateErr) {
                logger.warn('Progress update failed:', updateErr.message);
              }
            }
          });
        } catch (e) {
          // Mastra未ロード時は既存のBedrockを使用
          logger.error('Mastra bridge load failed:', e.message);
          logger.error('Stack:', e.stack);
          logger.info('Falling back to Bedrock directly');
          const { getProjectContext } = require('./llm-integration');
          const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

          // projectIdは既に検出済み（上で検出）

          const projectContext = await getProjectContext(projectId);
          const contextSection = projectContext
            ? `\n# プロジェクトコンテキスト\n${projectContext.substring(0, 20000)}\n---\n`
            : '';

          // 会話履歴をプロンプトに追加（最新の質問は除く）
          const historyForPrompt = conversationHistory.slice(0, -1);  // 現在の質問を除く
          const historySection = historyForPrompt.length > 0
            ? `\n## 過去の会話\n${historyForPrompt.map(m => `${m.role === 'user' ? '質問者' : 'あなた'}: ${m.content}`).join('\n')}\n---\n`
            : '';

          const prompt = `${contextSection}${historySection}
あなたは${projectId}プロジェクトのAIアシスタントです。以下の質問に簡潔に回答してください。
過去の会話がある場合は、その文脈を踏まえて回答してください。

## 出力フォーマット（Slack mrkdwn）
Slackで表示されるため、必ずSlack mrkdwn形式で回答すること：
- 太字: *テキスト*（アスタリスク1つ）
- 箇条書き: • または - で開始（番号リストは使わない）
- 見出し: *見出し* + 改行（# は使わない）
禁止: **太字**, # 見出し, 番号リスト(1. 2. 3.)

質問者: ${senderName}
質問: ${cleanedText}`;

          const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });
          const command = new InvokeModelCommand({
            modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
            contentType: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: 2048,
              messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
            })
          });

          const bedrockResponse = await bedrockClient.send(command);
          const decoded = new TextDecoder().decode(bedrockResponse.body);
          const parsed = JSON.parse(decoded);
          response = parsed.content?.[0]?.text || '回答を生成できませんでした。';
        }

        // 回答をMemoryに保存
        await conversationMemory.saveMessage(projectId, userId, {
          role: 'assistant',
          content: response
        });
        logger.info(`Conversation saved: ${projectId}:${userId} (assistant response)`);

        // 長いメッセージは分割して送信
        await sendLongMessage(client, event.channel, processingMsg.ts, response, event.ts);
        return;
      } catch (pmError) {
        logger.error('AI PM error:', pmError);
        await client.chat.update({
          channel: event.channel,
          ts: processingMsg.ts,
          text: `💬 ${cleanedText}\n\n申し訳ありません。回答を生成できませんでした。`
        });
        return;
      }
    }
    // --- End of Phase 5b ---

    // 担当者がいない場合は送信者を担当者にする
    const assigneeSlackId = assigneeMentions.length > 0 ? assigneeMentions[0] : event.user;

    // 処理中メッセージ
    const processingMsg = await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: '📝 タスクを解析中...'
    });

    // チャンネル名を取得
    let channelName = event.channel;
    try {
      const channelInfo = await client.conversations.info({ channel: event.channel });
      channelName = channelInfo.channel?.name || event.channel;
    } catch (e) {
      logger.warn('Failed to get channel name:', e.message);
    }

    // 送信者名を取得
    let senderName = event.user;
    try {
      const userInfo = await client.users.info({ user: event.user });
      senderName = userInfo.user?.real_name || userInfo.user?.name || event.user;
    } catch (e) {
      logger.warn('Failed to get user name:', e.message);
    }

    // 担当者名を取得
    const slackIdToName = await getSlackIdToBrainbaseName();
    const assigneeName = slackIdToName.get(assigneeSlackId) || senderName;

    // スレッドコンテキストを取得（タスク抽出時の文脈理解用）
    let threadContext = '';
    const threadTs = event.thread_ts;
    if (threadTs) {
      try {
        const threadResult = await client.conversations.replies({
          channel: event.channel,
          ts: threadTs,
          limit: 20
        });
        if (threadResult.messages && threadResult.messages.length > 1) {
          const contextMessages = [];
          for (const msg of threadResult.messages) {
            if (msg.ts === event.ts) continue;
            const msgUser = slackIdToName.get(msg.user) || msg.user;

            // blocksからテキストを抽出（議事録などの詳細内容はblocksに格納されている）
            let msgText = '';
            if (msg.blocks && msg.blocks.length > 0) {
              msgText = extractTextFromBlocks(msg.blocks);
            }
            // blocksからテキストが取得できなければmsg.textにフォールバック
            if (!msgText || msgText.trim() === '') {
              msgText = msg.text || '';
            }
            // メンションを削除
            msgText = msgText.replace(/<@[A-Z0-9]+>/g, '').trim();

            if (msgText) {
              contextMessages.push(`${msgUser}: ${msgText}`);
            }
          }
          if (contextMessages.length > 0) {
            threadContext = `\n\n【スレッドの文脈】\n${contextMessages.join('\n\n---\n')}`;
            logger.info(`Thread context added for task extraction: ${contextMessages.length} messages, total ${threadContext.length} chars`);
          }
        }
      } catch (e) {
        logger.warn('Failed to get thread context:', e.message);
      }
    }

    // LLMでタスク抽出（スレッドコンテキスト付き、複数タスク対応）
    const messageWithContext = cleanedText + threadContext;
    logger.info(`[DEBUG] Thread context length: ${threadContext.length} chars`);
    if (threadContext.length > 0) {
      // 最初の1000文字をログに出力（デバッグ用）
      logger.info(`[DEBUG] Thread context preview: ${threadContext.substring(0, 1000)}...`);
    }
    const taskResult = await extractTasksFromMessage(messageWithContext, channelName, senderName, assigneeName);
    logger.info(`[DEBUG] Task extraction result: ${JSON.stringify(taskResult)}`);

    // extractTasksFromMessageは配列を返す
    const validTasks = (taskResult || []).filter(t => t && t.title);

    if (validTasks.length === 0) {
      await client.chat.update({
        channel: event.channel,
        ts: processingMsg.ts,
        text: '💭 タスクとして認識できませんでした。具体的な依頼内容を記載してください。'
      });
      return;
    }

    logger.info(`Extracted ${validTasks.length} task(s)`);

    // Slackメッセージへのパーマリンクを取得
    let slackLink;
    try {
      const permalinkResult = await client.chat.getPermalink({
        channel: event.channel,
        message_ts: event.ts
      });
      slackLink = permalinkResult.permalink;
    } catch (e) {
      logger.warn('Failed to get permalink, using fallback:', e.message);
      const workspaceId = 'unson-inc';
      slackLink = `https://${workspaceId}.slack.com/archives/${event.channel}/p${event.ts.replace('.', '')}`;
    }

    // スレッドリマインド用のSlackコンテキスト
    const slackContext = {
      channel_id: event.channel,
      thread_ts: event.ts
    };

    // GitHub APIで各タスクを追記
    const github = new GitHubIntegration();
    const results = [];

    for (const task of validTasks) {
      // 担当者を設定
      task.assignee = assigneeName;
      task.assignee_slack_id = assigneeSlackId;
      task.requester = senderName;

      logger.info('Appending task:', task.title);
      const result = await github.appendTask(task, slackLink, slackContext);
      if (result.success) {
        results.push({ task, result });
        logger.info('Task appended:', result.taskId);
      }
    }

    if (results.length === 0) {
      throw new Error('Failed to append any tasks to GitHub');
    }

    // 複数タスク用のブロック生成
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📋 *タスク整理* (${results.length}件)\n「...」からそれぞれ編集やキャンセルができます`
        }
      },
      { type: "divider" }
    ];

    for (const { task, result } of results) {
      // AirtableのURLを優先、なければGitHubのURL
      const taskUrl = result.airtableRecordUrl || result.fileUrl;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${taskUrl}|【${task.project_id || 'TASK'}】${task.title}>*\n期限: ${task.due || '未設定'}　担当: <@${task.assignee_slack_id}>`
        },
        accessory: {
          type: "overflow",
          options: [
            { text: { type: "plain_text", text: "✅ 完了" }, value: `complete_${result.taskId}` },
            { text: { type: "plain_text", text: "📝 編集" }, value: `edit_${result.taskId}` },
            { text: { type: "plain_text", text: "❌ キャンセル" }, value: `cancel_${result.taskId}` }
          ],
          action_id: `task_action_${result.taskId}`
        }
      });
    }

    // Airtableに登録完了を表示
    const lastResult = results[results.length - 1].result;
    const airtableTableUrl = lastResult.airtableRecordUrl
      ? lastResult.airtableRecordUrl.replace(/\/rec[a-zA-Z0-9]+$/, '')  // レコードIDを除去してテーブルURLに
      : null;
    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: airtableTableUrl
            ? `📋 <${airtableTableUrl}|Airtable タスクテーブル> に追記完了`
            : `📋 <${lastResult.commitUrl}|_tasks/index.md に追記完了>`
        }]
      }
    );

    await client.chat.update({
      channel: event.channel,
      ts: processingMsg.ts,
      blocks: blocks,
      text: `✅ ${results.length}件のタスクを登録しました`
    });
  } catch (error) {
    logger.error('Error processing app_mention:', error);
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: `❌ タスク登録に失敗しました: ${error.message}`
    });
  }
});

// --- Task Intake from Mentions (Phase 2: AI PM) ---
// @mana + @member へのメンションでタスクを抽出して _tasks/index.md に追記
// 全メンバー対応: S3の members.json から動的に取得
// Bot User IDは起動時にSlack APIから取得
let BOT_USER_ID = process.env.SLACK_BOT_USER_ID || null;
const { getAllMemberSlackIds, getSlackIdToBrainbaseName } = require('./slack-name-resolver');

// Bot User IDの遅延解決用関数
const { WebClient } = require('@slack/web-api');
const initClient = new WebClient(process.env.SLACK_BOT_TOKEN);

async function getBotUserId() {
  if (BOT_USER_ID) {
    return BOT_USER_ID;
  }
  try {
    const authResult = await initClient.auth.test();
    BOT_USER_ID = authResult.user_id;
    console.log(`Bot User ID resolved: ${BOT_USER_ID}`);
    return BOT_USER_ID;
  } catch (e) {
    console.warn('Failed to resolve Bot User ID, using fallback U08T9TC88BB:', e.message);
    BOT_USER_ID = 'U08T9TC88BB';
    return BOT_USER_ID;
  }
}

// メンバーリストのキャッシュ
let memberSlackIdsCache = null;
let memberSlackIdsCacheTime = null;
const MEMBER_CACHE_TTL = 5 * 60 * 1000; // 5分

async function getMemberSlackIds() {
  if (memberSlackIdsCache && memberSlackIdsCacheTime && (Date.now() - memberSlackIdsCacheTime < MEMBER_CACHE_TTL)) {
    return memberSlackIdsCache;
  }
  memberSlackIdsCache = await getAllMemberSlackIds();
  memberSlackIdsCacheTime = Date.now();
  return memberSlackIdsCache;
}

function extractMentionedMemberIds(text, memberIds, botUserId) {
  const mentionedIds = [];
  const mentionRegex = /<@([A-Z0-9]+)>/g;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const userId = match[1];
    if (memberIds.has(userId) && userId !== botUserId) {
      mentionedIds.push(userId);
    }
  }
  return mentionedIds;
}

app.message(async ({ message, client, logger }) => {
  // Bot User IDを遅延解決（コールドスタート時の非同期初期化問題を回避）
  const botUserId = await getBotUserId();

  // デバッグ: 全メンションを検出してログ出力
  const allMentions = message.text ? message.text.match(/<@[A-Z0-9]+>/g) : [];
  if (allMentions && allMentions.length > 0) {
    logger.info(`=== DEBUG: Message with mentions ===`);
    logger.info(`Message text: ${message.text}`);
    logger.info(`All mentions found: ${allMentions.join(', ')}`);
    logger.info(`Current BOT_USER_ID: ${botUserId}`);
    logger.info(`Message sender: ${message.user}`);
  }

  // Botへのメンションが必要
  const hasBotMention = message.text && message.text.includes(`<@${botUserId}>`);

  if (!hasBotMention) {
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

  // メンバーリストを取得
  const memberIds = await getMemberSlackIds();
  logger.info(`Member IDs count: ${memberIds.size}`);

  // Bot以外のメンバーへのメンションを抽出（自分自身も許可）
  const mentionedMemberIds = extractMentionedMemberIds(message.text, memberIds, botUserId);
  logger.info(`Mentioned member IDs: ${mentionedMemberIds.join(', ') || 'none'}`);

  if (mentionedMemberIds.length === 0) {
    logger.info('No valid member mentions found, skipping task intake');
    return;
  }

  logger.info('=== TASK INTAKE HANDLER (@bot + @member) ===');
  logger.info('Mentioned members:', mentionedMemberIds);

  // 重複除外: メッセージのtsをキーにチェック
  const taskEventKey = `task_intake_${message.channel}_${message.ts}`;
  try {
    const { isNew, reason } = await deduplicationService.checkAndMarkProcessed(taskEventKey, {
      type: 'task_intake',
      channel: message.channel,
      user: message.user,
      ts: message.ts
    });
    if (!isNew) {
      logger.info(`Duplicate task intake event detected (key: ${taskEventKey}), reason: ${reason}`);
      return;
    }
  } catch (dedupError) {
    logger.warn('Deduplication check failed, proceeding anyway:', dedupError.message);
  }

  try {
    const { extractTasksFromMessage } = require('./llm-integration');
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

    // 担当者名を取得（最初のメンションされたメンバー）
    const slackIdToName = await getSlackIdToBrainbaseName();
    const assigneeName = slackIdToName.get(mentionedMemberIds[0]) || 'unknown';

    // メンションを除去したテキスト
    const cleanedText = message.text
      .replace(/<@[A-Z0-9]+>/g, '')
      .trim();

    if (!cleanedText || cleanedText.length < 2) {
      logger.info('Message too short after removing mentions, skipping');
      return;
    }

    // スレッドコンテキストを取得
    let threadContext = '';
    const threadTs = message.thread_ts;
    if (threadTs) {
      try {
        const threadResult = await client.conversations.replies({
          channel: message.channel,
          ts: threadTs,
          limit: 20
        });
        if (threadResult.messages && threadResult.messages.length > 1) {
          const contextMessages = [];
          for (const msg of threadResult.messages) {
            if (msg.ts === message.ts) continue;
            const msgUser = slackIdToName.get(msg.user) || msg.user;
            const msgText = msg.text?.replace(/<@[A-Z0-9]+>/g, '').trim() || '';
            if (msgText) {
              contextMessages.push(`${msgUser}: ${msgText}`);
            }
          }
          if (contextMessages.length > 0) {
            threadContext = `\n\n【スレッドの文脈】\n${contextMessages.join('\n')}`;
            logger.info(`Thread context added: ${contextMessages.length} messages`);
          }
        }
      } catch (e) {
        logger.warn('Failed to get thread context:', e.message);
      }
    }

    // 処理中メッセージを投稿
    const processingMsg = await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: '📝 タスクを解析中...'
    });

    // LLMでタスク抽出（スレッドコンテキスト付き、複数タスク対応）
    const messageWithContext = cleanedText + threadContext;
    const taskResult = await extractTasksFromMessage(messageWithContext, channelName, senderName, assigneeName);

    // extractTasksFromMessageは配列を返す
    const validTasks = (taskResult || []).filter(t => t && t.title);

    if (validTasks.length === 0) {
      logger.info('No task extracted from message');
      await client.chat.update({
        channel: message.channel,
        ts: processingMsg.ts,
        text: '💭 タスクとして認識できませんでした。依頼内容を具体的に記載してください。'
      });
      return;
    }

    logger.info(`Extracted ${validTasks.length} task(s)`);

    // Slackメッセージへのパーマリンクを取得
    let slackLink;
    try {
      const permalinkResult = await client.chat.getPermalink({
        channel: message.channel,
        message_ts: message.ts
      });
      slackLink = permalinkResult.permalink;
    } catch (e) {
      logger.warn('Failed to get permalink, using fallback:', e.message);
      const workspaceId = process.env.SLACK_WORKSPACE_ID || 'unson-inc';
      slackLink = `https://${workspaceId}.slack.com/archives/${message.channel}/p${message.ts.replace('.', '')}`;
    }

    // スレッドリマインド用のSlackコンテキスト
    const slackContext = {
      channel_id: message.channel,
      thread_ts: message.ts
    };

    // GitHub APIで各タスクを追記
    const github = new GitHubIntegration();
    const results = [];

    for (const task of validTasks) {
      // 担当者を設定
      task.assignee = assigneeName;
      task.assignee_slack_id = mentionedMemberIds[0];
      task.requester = senderName;

      logger.info('Appending task:', task.title);
      const result = await github.appendTask(task, slackLink, slackContext);
      if (result.success) {
        results.push({ task, result });
        logger.info('Task appended:', result.taskId);
      }
    }

    if (results.length === 0) {
      throw new Error('Failed to append any tasks to GitHub');
    }

    // 複数タスク用のブロック生成
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📋 *タスク整理* (${results.length}件)\n「...」からそれぞれ編集やキャンセルができます`
        }
      },
      { type: "divider" }
    ];

    for (const { task, result } of results) {
      // AirtableのURLを優先、なければGitHubのURL
      const taskUrl = result.airtableRecordUrl || result.fileUrl;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${taskUrl}|【${task.project_id || 'TASK'}】${task.title}>*\n期限: ${task.due || '未設定'}　担当: <@${task.assignee_slack_id}>`
        },
        accessory: {
          type: "overflow",
          options: [
            { text: { type: "plain_text", text: "✅ 完了" }, value: `complete_${result.taskId}` },
            { text: { type: "plain_text", text: "📝 編集" }, value: `edit_${result.taskId}` },
            { text: { type: "plain_text", text: "❌ キャンセル" }, value: `cancel_${result.taskId}` }
          ],
          action_id: `task_action_${result.taskId}`
        }
      });
    }

    // Airtableに登録完了を表示
    const lastResult = results[results.length - 1].result;
    const airtableTableUrl = lastResult.airtableRecordUrl
      ? lastResult.airtableRecordUrl.replace(/\/rec[a-zA-Z0-9]+$/, '')  // レコードIDを除去してテーブルURLに
      : null;
    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: airtableTableUrl
            ? `📋 <${airtableTableUrl}|Airtable タスクテーブル> に追記完了`
            : `📋 <${lastResult.commitUrl}|_tasks/index.md に追記完了>`
        }]
      }
    );

    await client.chat.update({
      channel: message.channel,
      ts: processingMsg.ts,
      blocks: blocks,
      text: `✅ ${results.length}件のタスクを登録しました`
    });

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

// --- _inbox Notification Handler (Phase 2.5) ---
// @k.satoへのメンション、または k.sato 宛のDMをbrainbase/_inbox/pending.mdに追記
// Claude Codeが起動時に確認・対応を提案できるようにする
const INBOX_TARGET_USER_ID = process.env.INBOX_TARGET_USER_ID || 'U07LNUP582X'; // k.sato's Slack ID

app.message(async ({ message, client, logger }) => {
  // DM (channel starts with "D") は宛先が明示されないため常に対象とする
  const isDirectMessage = typeof message.channel === 'string' && message.channel.startsWith('D');
  // チャンネル/スレッドでは明示的なメンションのみ対象
  const hasTargetMention = message.text && message.text.includes(`<@${INBOX_TARGET_USER_ID}>`);

  if (!hasTargetMention && !isDirectMessage) {
    return;
  }

  // Botメッセージはスキップ
  if (message.bot_id) {
    return;
  }

  // 自分自身の投稿はスキップ
  if (message.user === INBOX_TARGET_USER_ID) {
    return;
  }

  logger.info('=== _INBOX NOTIFICATION HANDLER (@k.sato or DM) ===');

  // 重複除外: メッセージのtsをキーにチェック
  const inboxEventKey = `inbox_${message.channel}_${message.ts}`;
  try {
    const { isNew, reason } = await deduplicationService.checkAndMarkProcessed(inboxEventKey, {
      type: 'inbox_notification',
      channel: message.channel,
      user: message.user,
      ts: message.ts
    });
    if (!isNew) {
      logger.info(`Duplicate inbox event detected (key: ${inboxEventKey}), reason: ${reason}`);
      return;
    }
  } catch (dedupError) {
    logger.warn('Inbox deduplication check failed, proceeding anyway:', dedupError.message);
  }

  try {
    const GitHubIntegration = require('./github-integration');

    // チャンネル名を取得
    let channelName = message.channel;
    try {
      const channelInfo = await client.conversations.info({ channel: message.channel });
      channelName = channelInfo.channel?.name || message.channel;
    } catch (e) {
      logger.warn('Failed to get channel name:', e.message);
    }

    // 送信者名を取得
    let senderName = message.user;
    try {
      const userInfo = await client.users.info({ user: message.user });
      senderName = userInfo.user?.real_name || userInfo.user?.name || message.user;
    } catch (e) {
      logger.warn('Failed to get user name:', e.message);
    }

    // ユーザー名キャッシュ（スレッド内で使用）
    const userNameCache = new Map();
    userNameCache.set(message.user, senderName);

    async function getUserName(userId) {
      if (userNameCache.has(userId)) {
        return userNameCache.get(userId);
      }
      try {
        const userInfo = await client.users.info({ user: userId });
        const name = userInfo.user?.real_name || userInfo.user?.name || userId;
        userNameCache.set(userId, name);
        return name;
      } catch (e) {
        userNameCache.set(userId, userId);
        return userId;
      }
    }

    // Slackメッセージへのパーマリンクを取得
    let slackLink;
    try {
      const permalinkResult = await client.chat.getPermalink({
        channel: message.channel,
        message_ts: message.ts
      });
      slackLink = permalinkResult.permalink;
    } catch (e) {
      logger.warn('Failed to get permalink, using fallback:', e.message);
      const workspaceId = process.env.SLACK_WORKSPACE_ID || 'unson-inc';
      slackLink = `https://${workspaceId}.slack.com/archives/${message.channel}/p${message.ts.replace('.', '')}`;
    }

    // スレッドの文脈を取得
    let contextText = '';
    const threadTs = message.thread_ts;

    if (threadTs) {
      // スレッド内のメッセージの場合、スレッド全体を取得
      try {
        const threadResult = await client.conversations.replies({
          channel: message.channel,
          ts: threadTs,
          limit: 20 // 直近20件まで
        });

        if (threadResult.messages && threadResult.messages.length > 1) {
          const threadMessages = [];
          for (const msg of threadResult.messages) {
            if (msg.ts === message.ts) continue; // 自分のメッセージはスキップ
            const msgUserName = await getUserName(msg.user);
            const msgTime = new Date(parseFloat(msg.ts) * 1000).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
            threadMessages.push(`> **${msgUserName}** (${msgTime}): ${msg.text}`);
          }
          if (threadMessages.length > 0) {
            contextText = `\n\n**スレッドの文脈:**\n${threadMessages.join('\n')}\n`;
          }
        }
      } catch (e) {
        logger.warn('Failed to get thread context:', e.message);
      }
    }

    // メンションを含むテキスト（スレッド文脈付き）
    const messageText = message.text + contextText;

    // GitHub APIで_inbox/pending.mdに追記
    const github = new GitHubIntegration();
    const result = await github.appendToInbox({
      channelName,
      senderName,
      text: messageText,
      timestamp: message.ts,
      slackLink
    });

    if (result.success) {
      logger.info('Inbox notification added:', result);

      // リアクションを付けて処理完了を示す（目立たないが追跡可能）
      try {
        await client.reactions.add({
          channel: message.channel,
          name: 'inbox_tray',
          timestamp: message.ts
        });
      } catch (e) {
        // リアクションの追加に失敗しても問題なし（すでに付いている場合など）
        logger.debug('Could not add reaction:', e.message);
      }
    }
  } catch (error) {
    logger.error('Error processing inbox notification:', error);
  }
});

// --- Task Reminder Actions (Phase 3) ---

// Task Complete Action (サポット風)
app.action(/^task_complete_/, async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('=== TASK COMPLETE ACTION ===');

  try {
    const { createCompletedTaskBlocks } = require('./task-ui');
    const actionData = JSON.parse(action.value);
    const { taskId, title, requesterSlackId, assigneeSlackId } = actionData;

    const completedAt = new Date().toISOString();
    const blocks = createCompletedTaskBlocks({
      taskId,
      title,
      requesterSlackId,
      assigneeSlackId,
      completedAt
    });

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: blocks,
      text: `✅ ${title}`
    });

    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: body.message.ts,
      text: `<@${body.user.id}> さんが完了`
    });

    logger.info(`Task ${taskId} marked as complete by ${body.user.id}`);
  } catch (error) {
    logger.error('Error handling task complete:', error);
  }
});

// Task Uncomplete Action (サポット風)
app.action(/^task_uncomplete_/, async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('=== TASK UNCOMPLETE ACTION ===');

  try {
    const { createTaskMessageBlocks } = require('./task-ui');
    const actionData = JSON.parse(action.value);
    const { taskId, title, requesterSlackId, assigneeSlackId } = actionData;

    const blocks = createTaskMessageBlocks({
      taskId,
      title,
      requesterSlackId,
      assigneeSlackId,
      due: null
    });

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: blocks,
      text: `🎯 ${title}`
    });

    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: body.message.ts,
      text: `<@${body.user.id}> さんが未完了に戻しました`
    });

    logger.info(`Task ${taskId} marked as uncomplete by ${body.user.id}`);
  } catch (error) {
    logger.error('Error handling task uncomplete:', error);
  }
});

// Task Snooze Action
app.action(/^task_snooze_/, async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('=== TASK SNOOZE ACTION ===');

  try {
    const actionData = JSON.parse(action.value);
    const { taskId } = actionData;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `⏰ *リマインダー設定*\n\nタスク \`${taskId}\` のリマインダーを ${tomorrowStr} に設定しました。`
          }
        }
      ],
      text: `⏰ タスク ${taskId} のリマインダーを明日に設定`
    });

    logger.info(`Task ${taskId} snoozed to ${tomorrowStr} by ${body.user.id}`);
  } catch (error) {
    logger.error('Error handling task snooze:', error);
  }
});

// Task Due Date Selection (サポット風)
app.action(/^task_set_due_/, async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('=== TASK SET DUE ACTION ===');
  logger.info('Selected value:', action.selected_option?.value);

  try {
    const taskId = action.action_id.replace('task_set_due_', '');
    const selectedValue = action.selected_option?.value;

    let dueDate;
    const today = new Date();

    switch (selectedValue) {
      case 'today':
        dueDate = today.toISOString().split('T')[0];
        break;
      case 'tomorrow':
        today.setDate(today.getDate() + 1);
        dueDate = today.toISOString().split('T')[0];
        break;
      case 'next_week':
        today.setDate(today.getDate() + 7);
        dueDate = today.toISOString().split('T')[0];
        break;
      case 'custom':
        await client.views.open({
          trigger_id: body.trigger_id,
          view: {
            type: 'modal',
            callback_id: `task_set_custom_due_${taskId}`,
            title: { type: 'plain_text', text: '期限を設定' },
            submit: { type: 'plain_text', text: '設定' },
            blocks: [
              {
                type: 'input',
                block_id: 'due_date_block',
                element: {
                  type: 'datepicker',
                  action_id: 'due_date_input',
                  placeholder: { type: 'plain_text', text: '日付を選択' }
                },
                label: { type: 'plain_text', text: '期限日' }
              }
            ],
            private_metadata: JSON.stringify({ taskId, channelId: body.channel.id, messageTs: body.message.ts })
          }
        });
        return;
      default:
        dueDate = null;
    }

    if (dueDate) {
      const currentBlocks = body.message.blocks;
      const updatedBlocks = currentBlocks.map(block => {
        if (block.type === 'section' && block.text?.text?.includes('期限')) {
          return {
            ...block,
            text: { type: 'mrkdwn', text: `期限: ${dueDate} ✅` }
          };
        }
        return block;
      });

      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: updatedBlocks,
        text: `期限を ${dueDate} に設定しました`
      });

      logger.info(`Task ${taskId} due date set to ${dueDate}`);
    }
  } catch (error) {
    logger.error('Error setting due date:', error);
  }
});

// Task Edit Button (サポット風)
app.action(/^task_edit_/, async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('=== TASK EDIT ACTION ===');

  try {
    const { createEditModalBlocks } = require('./task-ui');
    const actionData = JSON.parse(action.value);
    const { taskId, title, requesterSlackId, assigneeSlackId, due } = actionData;

    const blocks = createEditModalBlocks({ title, requesterSlackId, assigneeSlackId, due });

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: `task_edit_submit_${taskId}`,
        title: { type: 'plain_text', text: 'タスクを編集する' },
        submit: { type: 'plain_text', text: 'OK！' },
        close: { type: 'plain_text', text: 'やめとく' },
        blocks: blocks,
        private_metadata: JSON.stringify({ taskId, channelId: body.channel.id, messageTs: body.message.ts })
      }
    });

    logger.info(`Edit modal opened for task ${taskId}`);
  } catch (error) {
    logger.error('Error opening edit modal:', error);
  }
});

// Task Edit Modal Submit Handler (サポット風)
app.view(/^task_edit_submit_/, async ({ ack, view, body, client, logger }) => {
  await ack();
  logger.info('=== TASK EDIT SUBMIT ===');

  try {
    const { createTaskMessageBlocks, formatDueDate } = require('./task-ui');
    const metadata = JSON.parse(view.private_metadata);
    const { taskId, channelId, messageTs } = metadata;

    const values = view.state.values;

    const newTitle = values.title_block?.title_input?.value || '';
    const newRequesterSlackId = values.requester_block?.requester_input?.selected_user || null;
    const newAssigneeSlackId = values.assignee_block?.assignee_input?.selected_user || null;

    let newDue = null;
    const dueDate = values.due_block?.due_date_input?.selected_date;
    const dueTime = values.due_block?.due_time_input?.selected_option?.value;
    if (dueDate) {
      if (dueTime) {
        const [hours, minutes] = dueTime.split(':');
        newDue = new Date(`${dueDate}T${hours}:${minutes}:00+09:00`);
      } else {
        newDue = new Date(`${dueDate}T18:00:00+09:00`);
      }
    }

    let startDate = null;
    const startDateVal = values.start_block?.start_date_input?.selected_date;
    const startTimeVal = values.start_block?.start_time_input?.selected_option?.value;
    if (startDateVal) {
      if (startTimeVal) {
        const [hours, minutes] = startTimeVal.split(':');
        startDate = new Date(`${startDateVal}T${hours}:${minutes}:00+09:00`);
      } else {
        startDate = new Date(`${startDateVal}T09:00:00+09:00`);
      }
    }

    logger.info(`Edit submit - title: ${newTitle}, requester: ${newRequesterSlackId}, assignee: ${newAssigneeSlackId}, due: ${newDue}`);

    const blocks = createTaskMessageBlocks({
      taskId,
      title: newTitle,
      requesterSlackId: newRequesterSlackId,
      assigneeSlackId: newAssigneeSlackId,
      due: newDue ? newDue.toISOString() : null
    });

    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: blocks,
      text: `タスク更新: ${newTitle}`
    });

    logger.info(`Task ${taskId} updated successfully`);
  } catch (error) {
    logger.error('Error submitting task edit:', error);
  }
});

// --- Task Overflow Menu Action Handler ---
// オーバーフローメニュー（...ボタン）からの完了/編集/キャンセル操作
app.action(/^task_action_/, async ({ ack, action, body, client, logger }) => {
  await ack();
  logger.info('=== TASK OVERFLOW ACTION ===');
  logger.info('Action:', JSON.stringify(action, null, 2));

  try {
    const selectedOption = action.selected_option?.value;
    if (!selectedOption) {
      logger.warn('No selected option in overflow menu');
      return;
    }

    // selected_option.value は "complete_taskId", "edit_taskId", "cancel_taskId" 形式
    const [actionType, ...taskIdParts] = selectedOption.split('_');
    const taskId = taskIdParts.join('_');

    logger.info(`Task action: ${actionType}, taskId: ${taskId}`);

    const channel = body.channel?.id;
    const messageTs = body.message?.ts;

    if (actionType === 'complete') {
      // タスク完了処理
      // TODO: GitHub上のタスクステータスを更新する実装
      await client.chat.postMessage({
        channel: channel,
        thread_ts: messageTs,
        text: `✅ タスク (ID: ${taskId}) を完了しました`
      });
      logger.info(`Task ${taskId} marked as complete`);
    } else if (actionType === 'edit') {
      // 編集モーダルを開く
      // TODO: 既存のtask_edit_ハンドラーと同様のモーダルを表示
      await client.chat.postMessage({
        channel: channel,
        thread_ts: messageTs,
        text: `📝 タスク (ID: ${taskId}) の編集機能は準備中です`
      });
      logger.info(`Task ${taskId} edit requested`);
    } else if (actionType === 'cancel') {
      // タスクキャンセル処理
      // TODO: GitHub上のタスクを削除/キャンセル状態にする実装
      await client.chat.postMessage({
        channel: channel,
        thread_ts: messageTs,
        text: `❌ タスク (ID: ${taskId}) をキャンセルしました`
      });
      logger.info(`Task ${taskId} cancelled`);
    } else {
      logger.warn(`Unknown task action type: ${actionType}`);
    }
  } catch (error) {
    logger.error('Error handling task overflow action:', error);
  }
});

// Catch-all action handler for debugging (excluding already handled actions)
app.action(/^(?!select_project_|select_channel_|update_airtable_record|change_project_selection|retry_file_processing|reselect_project_for_recommit|skip_channel_github_only|retry_generate_minutes|back_to_channel_selection|cancel_|task_complete_|task_uncomplete_|task_snooze_|task_set_due_|task_edit_|task_action_|open_followup_modal|open_crosspost_selection|crosspost_to_channel_).*/, async ({ ack, action, logger }) => {
  logger.info('=== CATCH-ALL ACTION HANDLER ===');
  logger.info('Unhandled action:', action.action_id);
  logger.info('Action type:', action.type);
  await ack();
});

// --- Lambda Handler ---
// This is the standard handler format for Bolt on AWS Lambda.
module.exports.handler = async (event, context, callback) => {
  // Check for scheduled reminder trigger (daily DM summary)
  if (event.source === 'aws.events' || event.action === 'run_reminders') {
    const { WebClient } = require('@slack/web-api');
    const ReminderService = require('./reminder');

    const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    const reminderService = new ReminderService(slackClient);

    try {
      const results = await reminderService.runDailyReminders();
      console.log('Daily reminders completed:', JSON.stringify(results, null, 2));
      return {
        statusCode: 200,
        body: JSON.stringify(results)
      };
    } catch (error) {
      console.error('Failed to run reminders:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }
  }

  // Test daily summary for a specific user
  if (event.action === 'test_daily_summary' && event.slackId) {
    const { WebClient } = require('@slack/web-api');
    const ReminderService = require('./reminder');

    const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    const reminderService = new ReminderService(slackClient);

    try {
      const result = await reminderService.sendDailySummary(event.slackId);
      console.log('Test daily summary sent:', JSON.stringify(result, null, 2));
      return {
        statusCode: 200,
        body: JSON.stringify(result)
      };
    } catch (error) {
      console.error('Failed to send test daily summary:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }
  }

  // Run daily summaries with Working Memory consideration
  // Triggered by EventBridge, checks each user's preferred reminder time
  if (event.action === 'run_daily_summaries') {
    const { WebClient } = require('@slack/web-api');
    const ReminderService = require('./reminder');

    const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    const reminderService = new ReminderService(slackClient);

    // Get current hour in JST
    const now = new Date();
    const jstHour = now.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      hour12: false
    }).padStart(2, '0');

    try {
      const results = await reminderService.runDailySummaries(jstHour);
      console.log('Daily summaries completed:', JSON.stringify(results, null, 2));
      return {
        statusCode: 200,
        body: JSON.stringify(results)
      };
    } catch (error) {
      console.error('Failed to run daily summaries:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }
  }

  // Check for thread-based reminder trigger (for Slack-created tasks)
  if (event.action === 'run_thread_reminders') {
    const { WebClient } = require('@slack/web-api');
    const SlackThreadReminderService = require('./slack-thread-reminder');

    const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    const threadReminderService = new SlackThreadReminderService(slackClient);

    try {
      const results = await threadReminderService.runSlackReminders();
      console.log('Thread reminders completed:', JSON.stringify(results, null, 2));
      return {
        statusCode: 200,
        body: JSON.stringify(results)
      };
    } catch (error) {
      console.error('Failed to run thread reminders:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }
  }

  // Handle scheduled Slack history sync
  if (event.action === 'sync_slack_history') {
    const { syncAllWorkspaces } = require('./sync-slack-history');

    console.log('=== SLACK HISTORY SYNC HANDLER ===');
    console.log('Event:', JSON.stringify(event));

    const options = {
      workspaces: event.workspaces || null,
      daysToSync: event.daysToSync || 7
    };

    try {
      const result = await syncAllWorkspaces(options);
      console.log('Slack history sync completed:', JSON.stringify(result, null, 2));
      return {
        statusCode: 200,
        body: JSON.stringify(result)
      };
    } catch (error) {
      console.error('Failed to sync Slack history:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      };
    }
  }

  // Handle async followup generation (invoked from followup_modal_config)
  if (event.type === 'followup_async') {
    const { WebClient } = require('@slack/web-api');
    const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

    console.log('=== FOLLOWUP ASYNC HANDLER ===');
    console.log('Payload:', JSON.stringify(event));

    const { channelId, threadTs, summary, actions, minutes, projectName, recipient, sender, userNotes, brainbaseName } = event;

    if (!channelId) {
      console.error('No channelId in async payload');
      return { statusCode: 400, body: 'Missing channelId' };
    }

    // Generate with LLM
    let generated = null;
    try {
      generated = await generateFollowupMessage({
        summary,
        actions,
        minutes,
        projectName,
        recipient,
        sender,
        brainbaseName,
        userNotes
      });
    } catch (e) {
      console.error('LLM generation failed:', e.message);
    }

    const subject = generated?.subject || `本日の打合せありがとうございました（${new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}）`;
    const bodyText = generated?.body || buildFollowupTemplate({ summary, actions, recipient, sender });

    const text = `📧 *お礼メッセージ下書き*\n\n*件名:* ${subject}\n\n${bodyText}`;

    try {
      const result = await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text
      });
      console.log('Followup posted:', { ok: result.ok, ts: result.ts });
      return { statusCode: 200, body: 'OK' };
    } catch (e) {
      console.error('Failed to post followup:', e.message);
      return { statusCode: 500, body: e.message };
    }
  }

  const handler = await awsLambdaReceiver.start();
  return handler(event, context, callback);
};
