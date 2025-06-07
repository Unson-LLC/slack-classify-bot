const { App, AwsLambdaReceiver } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const { Lambda } = require('@aws-sdk/client-lambda');
const { classifyMessage } = require('./n8n-integration');
const AirtableIntegration = require('./airtable-integration');

const lambda = new Lambda({ region: process.env.AWS_REGION || "us-east-1" });
const airtableIntegration = new AirtableIntegration(process.env.N8N_AIRTABLE_ENDPOINT);

const fileDataStore = new Map();
const processedFiles = new Set();

setInterval(() => {
  const now = Date.now();
  const thirtyMinutesAgo = now - (30 * 60 * 1000);
  console.log(`Starting cleanup... Current fileDataStore size: ${fileDataStore.size}, processedFiles size: ${processedFiles.size}`);
  for (const [key, data] of fileDataStore.entries()) {
    if (data.timestamp < thirtyMinutesAgo) {
      fileDataStore.delete(key);
    }
  }
  if (processedFiles.size > 2000) {
    const entries = Array.from(processedFiles).slice(-1000);
    processedFiles.clear();
    entries.forEach(id => processedFiles.add(id));
  }
  console.log(`Cleanup finished. FileDataStore size: ${fileDataStore.size}, processedFiles size: ${processedFiles.size}`);
}, 30 * 60 * 1000);

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
});

console.log('AWS Lambda receiver initialized');
console.log('Slack Bolt app initialized');
console.log('Environment check:');
console.log('- SLACK_BOT_TOKEN length:', process.env.SLACK_BOT_TOKEN ? process.env.SLACK_BOT_TOKEN.length : 0);
console.log('- SLACK_SIGNING_SECRET length:', process.env.SLACK_SIGNING_SECRET ? process.env.SLACK_SIGNING_SECRET.length : 0);

app.message(async ({ message, client, logger }) => {
  console.log('=== MESSAGE HANDLER CALLED ===');
  console.log(`Message type: ${message.type}`);
  console.log(`Message subtype: ${message.subtype}`);
  console.log(`Bot ID: ${message.bot_id}`);
  console.log(`Bot profile: ${message.bot_profile}`);
  console.log(`Has blocks: ${!!message.blocks}`);
  console.log(`Message text: ${message.text}`);
  console.log(`Has files: ${!!message.files}`);
  console.log(`Files count: ${message.files ? message.files.length : 0}`);

  // Check for project selection blocks and buttons
  const hasProjectSelectionBlocks = message.blocks && message.blocks.some(block => 
    block.type === 'section' && 
    block.text && 
    block.text.text && 
    block.text.text.includes('プロジェクトを選択してください')
  );
  
  const hasProjectButtons = message.blocks && message.blocks.some(block => 
    block.type === 'actions' && 
    block.elements && 
    block.elements.some(element => 
      element.action_id && element.action_id.startsWith('select_project_')
    )
  );

  console.log(`hasProjectSelectionBlocks: ${hasProjectSelectionBlocks}`);
  console.log(`hasProjectButtons: ${hasProjectButtons}`);

  // Skip bot messages (including our own messages)
  if (message.bot_id || message.app_id || (message.bot_profile && message.bot_profile.id)) {
    console.log('=== SKIPPING BOT MESSAGE ===');
    console.log(`[INFO]  bolt-app Skipping bot message: {
  botId: ${message.bot_id},
  appId: ${message.app_id},
  botProfileId: ${message.bot_profile ? message.bot_profile.id : 'undefined'},
  hasBlocks: ${!!message.blocks},
  hasProjectSelectionBlocks: ${hasProjectSelectionBlocks},
  hasProjectButtons: ${hasProjectButtons}
}`);
    return;
  }

  // Skip messages with files or file-related subtypes
  if (message.files || message.subtype === 'file_share' || message.subtype === 'file_comment') {
    console.log('=== SKIPPING MESSAGE ===');
    console.log(`[INFO]  bolt-app Skipping message: {
  subtype: '${message.subtype}',
  hasText: ${!!message.text},
  botId: ${message.bot_id},
  hasBlocks: ${!!message.blocks},
  appId: ${message.app_id},
  botProfileName: ${message.bot_profile ? message.bot_profile.name : 'undefined'},
  containsProjectSelection: ${hasProjectSelectionBlocks || hasProjectButtons},
  hasProjectSelectionBlocks: ${hasProjectSelectionBlocks},
  hasProjectButtons: ${hasProjectButtons},
  isFileShare: ${message.subtype === 'file_share'},
  hasFiles: ${!!message.files},
  filesCount: ${message.files ? message.files.length : 0}
}`);
    return;
  }

  // Skip messages that contain project selection UI
  if (hasProjectSelectionBlocks || hasProjectButtons) {
    console.log('=== SKIPPING PROJECT SELECTION MESSAGE ===');
    console.log(`[INFO]  bolt-app Skipping project selection message: {
  hasProjectSelectionBlocks: ${hasProjectSelectionBlocks},
  hasProjectButtons: ${hasProjectButtons},
  botId: ${message.bot_id},
  appId: ${message.app_id}
}`);
    return;
  }

  try {
    console.log('=== PROCESSING MESSAGE FOR CLASSIFICATION ===');
    logger.info('Processing message for classification:', message.text);

    // Classify the message using n8n
    const classification = await classifyMessage(message.text);
    
    if (classification && classification.category) {
      // React to the message with an emoji based on classification
      const emojiMap = {
        'bug': 'bug',
        'feature-request': 'bulb',
        'question': 'question',
        'feedback': 'speech_balloon',
        'urgent': 'rotating_light',
        'general': 'speech_balloon'
      };
      
      const emoji = emojiMap[classification.category] || 'speech_balloon';
      
      await client.reactions.add({
        channel: message.channel,
        timestamp: message.ts,
        name: emoji
      });

      // Post classification result in thread
      await client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.ts,
        text: `🤖 Message classified as: *${classification.category}*\nConfidence: ${classification.confidence || 'N/A'}`
      });
    }
  } catch (error) {
    console.error('=== ERROR IN MESSAGE HANDLER ===');
    console.error('Error:', error);
    logger.error('Error in message classification:', error);
  }
});

app.event('file_shared', async ({ event, context, logger }) => {
  console.log('=== FILE SHARED EVENT (BOLT) ===');
  const eventId = `${event.file_id}_${event.channel_id}_${event.event_ts}`;
  logger.info(`Generated eventId: ${eventId}`);

  if (processedFiles.has(eventId)) {
    logger.info('Duplicate file event. Skipping invocation.', eventId);
    return;
  }
  processedFiles.add(eventId);

  const payload = {
    source: 'slack-classify-bot.async',
    slackEvent: event,
    eventId: eventId,
  };

  const params = {
    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: JSON.stringify(payload),
  };

  try {
    await lambda.invoke(params);
    logger.info('Successfully invoked self for async processing.', eventId);
  } catch (error) {
    logger.error('Failed to invoke self for async processing.', error);
    processedFiles.delete(eventId);
  }
});

async function processFileUpload(event, client, logger, eventId) {
  try {
    console.log('=== ASYNC FILE PROCESSING STARTED ===');
    console.log(`Processing file: ${event.file_id} in channel: ${event.channel_id}`);

    const fileInfo = await client.files.info({ file: event.file_id });
    const file = fileInfo.file;
    logger.info('File info retrieved:', { name: file.name, filetype: file.filetype, size: file.size });

    if (file.filetype !== 'txt' && !file.name.endsWith('.txt')) {
      logger.info('Skipping non-txt file:', file.name);
      return;
    }

    const response = await fetch(file.url_private, {
      headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}` }
    });
    const content = await response.text();
    logger.info('File content downloaded, length:', content.length);

    fileDataStore.set(eventId, {
      fileName: file.name,
      content: content,
      uploadedBy: event.user_id,
      channel: event.channel_id,
      ts: event.event_ts,
      fileId: event.file_id,
      timestamp: Date.now(),
      eventId: eventId
    });
    logger.info('File data stored with key:', eventId);

    const projects = await airtableIntegration.getProjects();
    logger.info('Retrieved projects from Airtable:', projects.length);
    if (projects.length === 0) {
      await client.chat.postMessage({
        channel: event.channel_id,
        text: `❌ プロジェクトが見つかりません。Airtableにプロジェクト情報を追加してください。`,
        thread_ts: event.event_ts
      });
      return;
    }

    const blocks = airtableIntegration.createProjectSelectionBlocks(projects, eventId);
    await client.chat.postMessage({
      channel: event.channel_id,
      text: `📁 ファイル "${file.name}" がアップロードされました。`,
      blocks: blocks,
      thread_ts: event.event_ts,
    });
    logger.info('Project selection message posted.');
  } catch (error) {
    logger.error('Error in async file processing:', error);
    processedFiles.delete(eventId);
  }
}

module.exports.handler = async (event, context, callback) => {
  console.log('=== LAMBDA INVOCATION ===');
  if (event.source === 'slack-classify-bot.async') {
    console.log('=== ASYNC INVOCATION RECEIVED ===');
    try {
      const client = new WebClient(process.env.SLACK_BOT_TOKEN);
      const logger = console;
      const { slackEvent, eventId } = event;
      await processFileUpload(slackEvent, client, logger, eventId);
      return { statusCode: 200, body: 'Async processing finished.' };
    } catch (error) {
      console.error('=== ASYNC PROCESSING FAILED ===', error);
      return { statusCode: 500, body: 'Async processing failed.' };
    }
  }

  const handler = await awsLambdaReceiver.start();
  return handler(event, context, callback);
};

// Handle project selection button clicks - 統一されたハンドラー
app.action(/^select_project_/, async ({ ack, body, client, action, logger }) => {
  console.log('=== PROJECT SELECTION BUTTON HANDLER CALLED ===');
  console.log('Action ID:', action.action_id);
  console.log('Action type:', action.type);
  console.log('Action value:', action.value);
  console.log('Body type:', body.type);
  console.log('User ID:', body.user.id);
  
  // 最初にack()を呼び出して即座にSlackに応答
  await ack();
  console.log('Action acknowledged successfully');
  
  // 非同期で実際の処理を実行
  setImmediate(async () => {
    try {
      logger.info('Project selection button clicked:', action.action_id);
      logger.info('Action value:', action.value);

      const actionValue = JSON.parse(action.value);
      const { projectId, projectName, fileId } = actionValue;
      
      logger.info(`Processing project selection: ${projectName} (${projectId}) for file: ${fileId}`);
      console.log(`Processing project selection: ${projectName} (${projectId}) for file: ${fileId}`);
      
      // 新しいファイルキー形式に対応（eventId形式）
      let fileData = null;
      let foundKey = null;
      
      // まず完全なfileIdで検索
      if (fileDataStore.has(fileId)) {
        fileData = fileDataStore.get(fileId);
        foundKey = fileId;
        logger.info(`Found file data with exact key: ${foundKey}`);
      } else {
        // 古い形式との互換性のために、部分マッチも試行
        const possibleKeys = Array.from(fileDataStore.keys()).filter(key => 
          key.includes(fileId.split('_')[0]) || // ファイルIDが含まれる
          key.startsWith(fileId.split('_')[0]) // ファイルIDで始まる
        );
        
        console.log('Searching for file data with partial match...');
        console.log('FileId:', fileId);
        console.log('Possible keys:', possibleKeys);
        
        for (const key of possibleKeys) {
          if (fileDataStore.has(key)) {
            fileData = fileDataStore.get(key);
            foundKey = key;
            logger.info(`Found file data with partial match key: ${foundKey}`);
            break;
          }
        }
      }
      
      if (!fileData) {
        logger.error('File data not found for fileId:', fileId);
        console.error('File data not found for fileId:', fileId);
        console.log('Available file data keys:', Array.from(fileDataStore.keys()));
        
        // Try to reconstruct file data from fileId
        console.log('Attempting to reconstruct file data from fileId...');
        try {
          // Extract file ID from the composite fileId
          const actualFileId = fileId.split('_')[0];
          console.log('Extracted actual file ID:', actualFileId);
          
          // Get file info from Slack
          const fileInfo = await client.files.info({
            file: actualFileId
          });
          
          const file = fileInfo.file;
          console.log('Retrieved file info from Slack:', file.name);
          
          // Download file content
          const response = await fetch(file.url_private, {
            headers: {
              'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
            }
          });
          
          const content = await response.text();
          console.log('Downloaded file content, length:', content.length);
          
          // Reconstruct file data
          const reconstructedFileData = {
            fileName: file.name,
            content: content,
            uploadedBy: body.user.id, // Use current user as uploader
            channel: body.channel.id,
            ts: body.message.ts,
            fileId: actualFileId,
            timestamp: Date.now(),
            reconstructed: true
          };
          
          console.log('Successfully reconstructed file data');
          
          // Continue with processing using reconstructed data
          await processFileWithProject(reconstructedFileData, projectId, projectName, body, client, logger);
          return;
          
        } catch (reconstructError) {
          console.error('Failed to reconstruct file data:', reconstructError);
          
          await client.chat.update({
            channel: body.channel.id,
            ts: body.message.ts,
            text: `❌ ファイルデータが見つかりません。ファイルを再度アップロードしてください。\n\nエラー詳細: ${reconstructError.message}`,
            blocks: []
          });
          return;
        }
      }

      logger.info('Found file data:', fileData.fileName);
      console.log('Found file data:', fileData.fileName);

      // Process with existing file data
      await processFileWithProject(fileData, projectId, projectName, body, client, logger);
    } catch (error) {
      logger.error('Error handling project selection:', error);
      console.error('Error handling project selection:', error);
      console.error('Error stack:', error.stack);
      
      try {
        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          text: `❌ プロジェクト選択の処理中にエラーが発生しました: ${error.message}`,
          blocks: []
        });
      } catch (updateError) {
        logger.error('Error updating message:', updateError);
        console.error('Error updating message:', updateError);
      }
    }
  });
});

// 全てのボタンクリックをキャッチするフォールバック - 簡素化
app.action(/.+/, async ({ ack, body, client, action, logger }) => {
  console.log('=== FALLBACK ACTION HANDLER CALLED ===');
  console.log('Action ID:', action.action_id);
  console.log('Action type:', action.type);
  
  // プロジェクト選択ボタンとキャンセルボタンでない場合のみack
  if (!action.action_id.startsWith('select_project_') && action.action_id !== 'cancel_project_selection') {
    await ack();
    console.log('Fallback: Acknowledged unknown action:', action.action_id);
  } else {
    console.log('Fallback: Handled action detected - skipping ack (handled by main handler)');
  }
});

// Handle cancel button click
app.action('cancel_project_selection', async ({ ack, body, client, logger }) => {
  try {
    await ack();
    logger.info('Cancel button clicked');
    // メッセージを削除
    await client.chat.delete({
      channel: body.channel.id,
      ts: body.message.ts,
    });
    logger.info('Project selection message deleted.');
    
    // 関連するファイル処理の情報をクリア（もしあれば）
    if (body.message.blocks) {
      const fileId = body.message.blocks[1]?.block_id;
      if (fileId && fileDataStore.has(fileId)) {
        fileDataStore.delete(fileId);
        logger.info(`Cleared file data for fileId: ${fileId}`);
      }
    }
  } catch (error) {
    logger.error('Error in cancel_project_selection:', error);
  }
});

// Slash command: /classify
app.command('/classify', async ({ ack, body, client }) => {
  await ack();

  try {
    const text = body.text;
    
    if (!text) {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "Please provide text to classify. Usage: `/classify your message here`"
      });
      return;
    }

    // Show loading message
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "🤖 Classifying your message..."
    });

    // Classify the message
    const classification = await classifyMessage(text);
    
    if (classification && classification.category) {
      await client.chat.postMessage({
        channel: body.channel_id,
        text: `🤖 Classification result for: "${text}"\n\n*Category:* ${classification.category}\n*Confidence:* ${classification.confidence || 'N/A'}\n*Requested by:* <@${body.user_id}>`
      });
    } else {
      await client.chat.postEphemeral({
        channel: body.channel_id,
        user: body.user_id,
        text: "❌ Failed to classify the message. Please try again."
      });
    }
  } catch (error) {
    console.error('Error in /classify command:', error);
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "❌ An error occurred while classifying the message."
    });
  }
});

// Slash command: /process-file
app.command('/process-file', async ({ ack, body, client }) => {
  await ack();

  try {
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: "📁 **ファイル処理について**\n\n**自動処理:**\n1. .txtファイルをチャンネルにアップロード\n2. プロジェクト選択ボタンが表示されます\n3. 適切なプロジェクトを選択\n4. 自動的にAirtableとGitHubに保存されます\n\n**対応ファイル形式:** .txt\n**利用可能プロジェクト:** Airtableで管理されているプロジェクト一覧から選択"
    });
  } catch (error) {
    console.error('Error in /process-file command:', error);
  }
});

// Slash command: /hello-bolt-app
app.command('/hello-bolt-app', async ({ ack, body, client }) => {
  await ack();

  try {
    const result = await client.chat.postMessage({
      channel: body.channel_id,
      text: `Hello <@${body.user_id}>! 👋\n\n**Slack Classify Bot** (AWS Lambda版) 🚀\n\n**📋 利用可能な機能:**\n\n**🤖 自動メッセージ分類**\n• チャンネルのメッセージを自動分類\n• 分類結果に応じた絵文字リアクション\n• スレッドで分類結果を通知\n\n**📁 ファイル処理 (プロジェクト選択式)**\n• .txtファイルのアップロードを検出\n• Airtableからプロジェクト一覧を取得\n• インタラクティブボタンでプロジェクト選択\n• 選択されたプロジェクトのGitHubリポジトリに自動保存\n\n**⚡ スラッシュコマンド:**\n• \`/classify <message>\` - 指定メッセージを分類\n• \`/process-file\` - ファイル処理の詳細説明\n• \`/hello-bolt-app\` - このヘルプメッセージ\n\n**🔧 技術スタック:**\n• AWS Lambda + Slack Bolt\n• Airtable (プロジェクト管理)\n• n8n (ワークフロー自動化)\n• GitHub (ファイル保存)`
    });
    console.log(result);
  } catch (error) {
    console.error('Error in /hello-bolt-app command:', error);
  }
});

// Error handler
app.error(async (error) => {
  console.error('App error:', error);
});

// Helper function to process file with project
async function processFileWithProject(fileData, projectId, projectName, body, client, logger) {
  try {
    // Update message to show processing
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `🔄 プロジェクト "${projectName}" でファイル "${fileData.fileName}" を処理中...`,
      blocks: []
    });

    logger.info('Updated message to show processing');
    console.log('Updated message to show processing');

    // Process file with selected project
    const result = await airtableIntegration.processFileWithProject({
      fileContent: fileData.content,
      fileName: fileData.fileName,
      projectId: projectId,
      userId: fileData.uploadedBy,
      channelId: fileData.channel,
      ts: fileData.ts
    });

    logger.info('File processing result:', result);
    console.log('File processing result:', result);

    // Clean up stored data (only if not reconstructed)
    if (!fileData.reconstructed) {
      const fileId = `${fileData.fileId}_${fileData.channel}_${fileData.timestamp}`;
      fileDataStore.delete(fileId);
    }

    if (result.success) {
      const projectEmoji = result.project.emoji || '📁';
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `✅ ファイル "${fileData.fileName}" が ${projectEmoji} プロジェクト "${projectName}" で正常に処理されました！\n\n📊 **プロジェクト情報:**\n• 🏢 Owner: ${result.project.owner}\n• 📦 Repo: ${result.project.repo}\n• 📂 Path: ${result.project.path_prefix}\n• 🌿 Branch: ${result.project.branch || 'main'}`,
        blocks: []
      });
      logger.info('Success message sent');
      console.log('Success message sent');
    } else {
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `❌ ファイル処理に失敗しました: ${result.error}`,
        blocks: []
      });
      logger.error('File processing failed:', result.error);
      console.error('File processing failed:', result.error);
    }
  } catch (error) {
    logger.error('Error in processFileWithProject:', error);
    console.error('Error in processFileWithProject:', error);
    
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `❌ ファイル処理中にエラーが発生しました: ${error.message}`,
      blocks: []
    });
  }
} 