const AirtableIntegration = require('./airtable-integration');
const axios = require('axios');
const { summarizeText } = require('./llm-integration');

/**
 * Process file upload event from Slack
 * @param {Object} message - Slack message event
 * @param {Object} client - Slack Web API client
 * @param {Object} logger - Logger instance
 * @param {Map} fileDataStore - In-memory store for file data
 */
async function processFileUpload(message, client, logger, fileDataStore) {
  logger.info('=== Processing file upload ===');
  logger.info(`Message timestamp: ${message.ts}`);
  logger.info(`Thread timestamp: ${message.thread_ts || 'none'}`);
  
  // Initialize AirtableIntegration inside the function
  const airtableIntegration = new AirtableIntegration();
  
  const file = message.files[0];
  const fileId = file.id;
  const fileName = file.name;
  const channelId = message.channel;
  const userId = message.user;
  const threadTs = message.thread_ts || message.ts;
  
  // Check if file is a text file
  if (!fileName.toLowerCase().endsWith('.txt')) {
    logger.info(`Skipping non-text file: ${fileName}`);
    return;
  }
  
  try {
    // Get file content
    logger.info(`Downloading file: ${fileName} (${fileId})`);
    const fileInfo = await client.files.info({ file: fileId });
    
    let content = '';
    if (fileInfo.file.content) {
      content = fileInfo.file.content;
    } else if (fileInfo.file.url_private_download) {
      // Download file content using axios with Slack token
      logger.info(`Downloading file content from: ${fileInfo.file.url_private_download}`);
      const response = await axios.get(fileInfo.file.url_private_download, {
        headers: {
          'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
        },
        responseType: 'text'
      });
      content = response.data;
    }
    
    // Store file data
    const fileData = {
      fileId,
      fileName,
      content,
      channelId,
      userId,
      threadTs,
      uploadedAt: new Date().toISOString(),
      classificationResult: {}
    };
    
    // Store with multiple keys for better retrieval
    fileDataStore.set(fileId, fileData);
    fileDataStore.set(`${fileId}_${channelId}`, fileData);
    
    logger.info(`File data stored for: ${fileId}`);
    
    // Post initial processing message immediately
    const processingMsg = await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `📄 議事録を処理中です...\nファイル名: ${fileName}`,
      blocks: [{
        type: "section",
        text: {
          type: "mrkdwn",
          text: `⏳ *議事録を処理中です...*\n📄 ファイル名: ${fileName}\n\n_要約とネクストアクションを抽出しています。しばらくお待ちください..._`
        }
      }]
    });
    
    // Extract summary and action items from content
    let summary = null;
    let summaryError = null;
    
    try {
      logger.info('Extracting summary and action items...');
      summary = await summarizeText(content);
      fileData.summary = summary;
      
      // Update fileDataStore with summary
      fileDataStore.set(fileId, fileData);
      fileDataStore.set(`${fileId}_${channelId}`, fileData);
      
      logger.info('Summary extraction completed and stored');
    } catch (error) {
      logger.error('Failed to extract summary:', error);
      summaryError = error.message;
      fileData.summaryError = summaryError;
      
      // Update fileDataStore even with error
      fileDataStore.set(fileId, fileData);
      fileDataStore.set(`${fileId}_${channelId}`, fileData);
    }
    
    // Get project list from Airtable with error handling
    let projects;
    try {
      projects = await airtableIntegration.getProjects();
    } catch (error) {
      logger.error('Failed to fetch projects:', error);

      const errorMessage = error.message.includes('429')
        ? '⚠️ Airtable APIのレート制限に達しました。少し時間を置いてから再度お試しください。'
        : `⚠️ プロジェクト一覧の取得に失敗しました: ${error.message}`;

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: errorMessage
      });
      return;
    }

    if (!projects || projects.length === 0) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'プロジェクトが見つかりませんでした。Airtableの設定を確認してください。'
      });
      return;
    }
    
    // Make sure fileData includes summary before creating blocks
    fileData.summary = summary;
    fileData.classificationResult = fileData.classificationResult || {};
    
    // Create blocks with summary and project selection
    const blocks = createBlocksWithSummary(projects, fileId, fileData, summary, summaryError);
    
    // Update the processing message with summary and project selection
    const response = await client.chat.update({
      channel: channelId,
      ts: processingMsg.ts,
      blocks: blocks,
      metadata: {
        event_type: 'project_selection',
        event_payload: {
          file_id: fileId,
          timestamp: Date.now().toString()
        }
      }
    });
    
    // Store message timestamp for later reference
    fileData.selectionMessageTs = response.ts;
    fileDataStore.set(fileId, fileData);
    fileDataStore.set(`${fileId}_${channelId}`, fileData);
    
    logger.info(`Project selection message posted for file: ${fileId}`);
    
  } catch (error) {
    logger.error('Error processing file upload:', error);

    // Post error message with retry button
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `⚠️ *ファイル処理中にエラーが発生しました*\n\`\`\`${error.message}\`\`\``
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
              text: {
                type: "plain_text",
                text: "🔄 再試行",
                emoji: true
              },
              value: JSON.stringify({
                fileId: fileId,
                fileName: fileName,
                channelId: channelId,
                userId: userId,
                threadTs: threadTs
              }),
              action_id: "retry_file_processing",
              style: "primary"
            }
          ]
        }
      ]
    });
  }
}

/**
 * Create Slack blocks with summary and project selection
 * @param {Array} projects - List of projects from Airtable
 * @param {string} fileId - Slack file ID
 * @param {Object} fileData - File data object
 * @param {string} summary - Extracted summary text
 * @param {string} summaryError - Error message if summary extraction failed
 * @returns {Array} - Slack blocks
 */
function createBlocksWithSummary(projects, fileId, fileData, summary, summaryError) {
  const blocks = [];
  
  // Header
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: "📄 議事録がアップロードされました",
      emoji: true
    }
  });
  
  // File info
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*ファイル名:* ${fileData.fileName}\n*アップロード日時:* ${new Date(fileData.uploadedAt).toLocaleString('ja-JP')}`
    }
  });
  
  blocks.push({ type: "divider" });
  
  // Summary section
  if (summary && !summaryError) {
    // Parse the summary text to extract sections
    const summaryLines = summary.split('\n').filter(line => line.trim());
    let meetingSummary = '';
    let nextActions = [];
    let currentSection = '';
    
    for (const line of summaryLines) {
      if (line.includes('会議の概要')) {
        currentSection = 'summary';
      } else if (line.includes('ネクストアクション')) {
        currentSection = 'actions';
      } else if (currentSection === 'summary' && line.trim()) {
        meetingSummary += line.trim() + ' ';
      } else if (currentSection === 'actions' && line.startsWith('-')) {
        nextActions.push(line.trim());
      }
    }
    
    // Meeting summary
    if (meetingSummary) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*📝 会議の概要*\n${meetingSummary.trim()}`
        }
      });
    }
    
    // Next actions
    if (nextActions.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*✅ ネクストアクション*\n${nextActions.join('\n')}`
        }
      });
    }
    
    blocks.push({ type: "divider" });
  } else if (summaryError) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⚠️ *要約の抽出に失敗しました*\n${summaryError}`
      }
    });
    blocks.push({ type: "divider" });
  }
  
  // Project selection section
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "🎯 *このファイルを保存するプロジェクトを選択してください*"
    }
  });
  
  // Add project buttons using airtable integration method
  const airtableIntegration = new AirtableIntegration();
  
  // Make sure fileData includes summary before creating project blocks
  fileData.summary = summary;
  fileData.classificationResult = fileData.classificationResult || {};
  
  const projectBlocks = airtableIntegration.createProjectSelectionBlocks(projects, fileId, fileData);
  
  // Extract only the action blocks from the project blocks (skip header and divider)
  const actionBlocks = projectBlocks.filter(block => block.type === 'actions');
  blocks.push(...actionBlocks);
  
  return blocks;
}

module.exports = { processFileUpload };