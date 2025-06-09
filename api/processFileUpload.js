const AirtableIntegration = require('./airtable-integration');
const axios = require('axios');

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
      uploadedAt: new Date().toISOString()
    };
    
    // Store with multiple keys for better retrieval
    fileDataStore.set(fileId, fileData);
    fileDataStore.set(`${fileId}_${channelId}`, fileData);
    
    logger.info(`File data stored for: ${fileId}`);
    
    // Get project list from Airtable
    const projects = await airtableIntegration.getProjectList(logger);
    
    if (!projects || projects.length === 0) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'プロジェクトが見つかりませんでした。Airtableの設定を確認してください。'
      });
      return;
    }
    
    // Build project selection buttons
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📄 *${fileName}* がアップロードされました。\nプロジェクトを選択してください:`
        }
      },
      {
        type: "actions",
        elements: projects.slice(0, 5).map(project => ({
          type: "button",
          text: {
            type: "plain_text",
            text: project.text,
            emoji: true
          },
          value: JSON.stringify({
            projectId: project.value,
            projectName: project.text,
            fileId: fileId,
            fileName: fileName,
            channelId: channelId,
            classificationResult: { summary: `File uploaded: ${fileName}` }
          }),
          action_id: `select_project_${project.value}`
        }))
      }
    ];
    
    // Add more buttons if there are more projects
    if (projects.length > 5) {
      blocks.push({
        type: "actions",
        elements: projects.slice(5, 10).map(project => ({
          type: "button",
          text: {
            type: "plain_text",
            text: project.text,
            emoji: true
          },
          value: JSON.stringify({
            projectId: project.value,
            projectName: project.text,
            fileId: fileId,
            fileName: fileName,
            channelId: channelId,
            classificationResult: { summary: `File uploaded: ${fileName}` }
          }),
          action_id: `select_project_${project.value}`
        }))
      });
    }
    
    // Post project selection message
    const response = await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: blocks
    });
    
    // Store message timestamp for later reference
    fileData.selectionMessageTs = response.ts;
    fileDataStore.set(fileId, fileData);
    fileDataStore.set(`${fileId}_${channelId}`, fileData);
    
    logger.info(`Project selection message posted for file: ${fileId}`);
    
  } catch (error) {
    logger.error('Error processing file upload:', error);
    
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `ファイルの処理中にエラーが発生しました: ${error.message}`
    });
  }
}

module.exports = { processFileUpload };