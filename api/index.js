const { App, AwsLambdaReceiver } = require('@slack/bolt');
const { classifyMessage } = require('./n8n-integration');
const AirtableIntegration = require('./airtable-integration');

// Initialize Airtable integration
const airtableIntegration = new AirtableIntegration(process.env.N8N_AIRTABLE_ENDPOINT);

// Store file data temporarily (in production, use Redis or DynamoDB)
const fileDataStore = new Map();
// Track processed files to prevent duplicates
const processedFiles = new Set();

// Clean up old data every 30 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  const thirtyMinutesAgo = now - (30 * 60 * 1000);
  
  console.log('Starting cleanup process...');
  console.log(`Current time: ${new Date(now).toISOString()}`);
  console.log(`Cleanup threshold: ${new Date(thirtyMinutesAgo).toISOString()}`);
  
  // Clean up old file data
  let fileDataCleaned = 0;
  for (const [key, data] of fileDataStore.entries()) {
    if (data.timestamp && data.timestamp < thirtyMinutesAgo) {
      fileDataStore.delete(key);
      fileDataCleaned++;
      console.log(`Cleaned up old file data: ${key}`);
    }
  }
  
  // Clean up old processed file IDs (keep only last 1000)
  let processedFilesCleaned = 0;
  if (processedFiles.size > 1000) {
    const entries = Array.from(processedFiles);
    const toKeep = entries.slice(-500); // Keep last 500
    processedFiles.clear();
    toKeep.forEach(id => processedFiles.add(id));
    processedFilesCleaned = entries.length - toKeep.length;
    console.log(`Cleaned up ${processedFilesCleaned} old processed file IDs`);
  }
  
  console.log(`Cleanup completed. FileDataStore: ${fileDataStore.size}, ProcessedFiles: ${processedFiles.size}`);
  console.log(`Cleaned up: ${fileDataCleaned} file data entries, ${processedFilesCleaned} processed file IDs`);
}, 30 * 60 * 1000); // 30 minutes

// Initialize AWS Lambda receiver
const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

console.log('AWS Lambda receiver initialized');

// Initialize Slack app with Lambda receiver
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
});

console.log('Slack Bolt app initialized');
console.log('Environment check:');
console.log('- SLACK_BOT_TOKEN length:', process.env.SLACK_BOT_TOKEN ? process.env.SLACK_BOT_TOKEN.length : 0);
console.log('- SLACK_SIGNING_SECRET length:', process.env.SLACK_SIGNING_SECRET ? process.env.SLACK_SIGNING_SECRET.length : 0);

// Message classification handler
app.message(async ({ message, client, logger }) => {
  // 必ずログを出力してハンドラーが呼ばれていることを確認
  console.log('=== MESSAGE HANDLER CALLED ===');
  console.log('Message type:', message.type);
  console.log('Message subtype:', message.subtype);
  console.log('Bot ID:', message.bot_id);
  console.log('Bot profile:', message.bot_profile?.name);
  console.log('Has blocks:', !!message.blocks);
  console.log('Message text:', message.text);
  
  try {
    // Skip bot messages, messages without text, and messages with blocks (interactive messages)
    // Also skip messages from our own bot (Meeting Router)
    // Skip file_share subtype messages (automatic file upload messages)
    
    // Check if message contains project selection blocks
    const hasProjectSelectionBlocks = message.blocks && message.blocks.some(block => 
      block.type === 'section' && 
      block.text && 
      block.text.text && 
      block.text.text.includes('プロジェクトを選択してください')
    );
    
    // Check if message has project selection buttons
    const hasProjectButtons = message.blocks && message.blocks.some(block =>
      block.type === 'actions' && 
      block.elements && 
      block.elements.some(element => 
        element.action_id && element.action_id.startsWith('select_project_')
      )
    );
    
    console.log('hasProjectSelectionBlocks:', hasProjectSelectionBlocks);
    console.log('hasProjectButtons:', hasProjectButtons);
    
    if (message.subtype === 'bot_message' || 
        message.subtype === 'file_share' ||  // ファイルアップロード時の自動メッセージを除外
        !message.text || 
        message.bot_id || 
        message.blocks || 
        message.app_id ||
        (message.bot_profile && message.bot_profile.name === 'Meeting Router') ||
        message.text.includes('プロジェクトを選択してください') ||
        hasProjectSelectionBlocks ||
        hasProjectButtons) {
      
      console.log('=== SKIPPING MESSAGE ===');
      logger.info('Skipping message:', {
        subtype: message.subtype,
        hasText: !!message.text,
        botId: message.bot_id,
        hasBlocks: !!message.blocks,
        appId: message.app_id,
        botProfileName: message.bot_profile?.name,
        containsProjectSelection: message.text?.includes('プロジェクトを選択してください'),
        hasProjectSelectionBlocks: hasProjectSelectionBlocks,
        hasProjectButtons: hasProjectButtons,
        isFileShare: message.subtype === 'file_share'
      });
      return;
    }

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

// File upload handler with project selection
app.event('file_shared', async ({ event, client, logger }) => {
  try {
    logger.info('File shared event received:', JSON.stringify(event, null, 2));

    // Create unique identifier for this file event (file_id + channel_id only, no timestamp)
    // This prevents duplicates even if event.ts varies slightly
    const eventId = `${event.file_id}_${event.channel_id}`;
    
    logger.info('Generated eventId:', eventId);
    logger.info('Current processedFiles size:', processedFiles.size);
    logger.info('ProcessedFiles contains eventId:', processedFiles.has(eventId));
    
    // Check if we've already processed this file event
    if (processedFiles.has(eventId)) {
      logger.info('File event already processed, skipping:', eventId);
      return;
    }
    
    // Mark as processing immediately
    processedFiles.add(eventId);
    logger.info('Added eventId to processedFiles:', eventId);

    // Get file info
    const fileInfo = await client.files.info({
      file: event.file_id
    });

    const file = fileInfo.file;
    logger.info('File info retrieved:', {
      name: file.name,
      filetype: file.filetype,
      size: file.size
    });
    
    // Only process .txt files
    if (file.filetype === 'txt' || file.name.endsWith('.txt')) {
      logger.info('Processing .txt file:', file.name);
      
      // Store file data for later retrieval during project selection
      // Use consistent fileKey without timestamp to prevent duplicates
      const fileKey = `${event.file_id}_${event.channel_id}`;
      logger.info(`Generated fileKey: ${fileKey}`);
      
      // Check if we already have a message for this file in this channel
      const existingFileKey = Array.from(fileDataStore.keys()).find(key => 
        key.startsWith(`${event.file_id}_${event.channel_id}_`)
      );
      
      if (existingFileKey) {
        logger.info('File already being processed in this channel, skipping:', existingFileKey);
        return;
      }
      
      // Download file content
      const response = await fetch(file.url_private, {
        headers: {
          'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
        }
      });
      
      const content = await response.text();
      logger.info('File content downloaded, length:', content.length);
      
      // Store file data temporarily
      fileDataStore.set(fileKey, {
        fileName: file.name,
        content: content,
        uploadedBy: event.user_id,
        channel: event.channel_id,
        ts: event.ts,
        fileId: event.file_id,
        timestamp: Date.now(),
        eventId: eventId
      });
      
      logger.info('File data stored with key:', fileKey);

      // Get projects from Airtable
      const projects = await airtableIntegration.getProjects();
      logger.info('Retrieved projects from Airtable:', projects.length);
      
      if (projects.length === 0) {
        await client.chat.postMessage({
          channel: event.channel_id,
          text: `❌ プロジェクトが見つかりません。Airtableにプロジェクト情報を追加してください。`
        });
        return;
      }

      // Create interactive message with project selection buttons
      const blocks = airtableIntegration.createProjectSelectionBlocks(projects, fileKey);
      
      const messageResult = await client.chat.postMessage({
        channel: event.channel_id,
        text: `📁 ファイル "${file.name}" がアップロードされました。`,
        blocks: blocks,
        thread_ts: event.ts
      });
      
      logger.info('Project selection message posted:', messageResult.ts);

    } else {
      logger.info('Skipping non-txt file:', file.name, 'filetype:', file.filetype);
    }
  } catch (error) {
    logger.error('Error in file processing:', error);
    
    // Remove from processed set on error so it can be retried
    const eventId = `${event.file_id}_${event.channel_id}`;
    processedFiles.delete(eventId);
    logger.info('Removed eventId from processedFiles due to error:', eventId);
    
    try {
      await client.chat.postMessage({
        channel: event.channel_id,
        text: `❌ ファイル処理中にエラーが発生しました: ${error.message}`
      });
    } catch (replyError) {
      logger.error('Error sending error message:', replyError);
    }
  }
});

// Handle project selection button clicks - 統一されたハンドラー
app.action(/^select_project_/, async ({ ack, body, client, action, logger }) => {
  console.log('=== PROJECT SELECTION BUTTON HANDLER CALLED ===');
  console.log('Action ID:', action.action_id);
  console.log('Action type:', action.type);
  console.log('Action value:', action.value);
  console.log('Body type:', body.type);
  console.log('User ID:', body.user.id);
  
  try {
    // 最初にack()を呼び出す
    await ack();
    console.log('Action acknowledged successfully');
    
    logger.info('Project selection button clicked:', action.action_id);
    logger.info('Action value:', action.value);

    const actionValue = JSON.parse(action.value);
    const { projectId, projectName, fileId } = actionValue;
    
    logger.info(`Processing project selection: ${projectName} (${projectId}) for file: ${fileId}`);
    console.log(`Processing project selection: ${projectName} (${projectId}) for file: ${fileId}`);
    
    // Try multiple possible file keys to find the stored data
    const possibleKeys = [
      fileId, // Original format
      `${fileId.split('_')[0]}_${fileId.split('_')[1]}`, // Without timestamp
      actionValue.fileId // From action value
    ];
    
    let fileData = null;
    let foundKey = null;
    
    for (const key of possibleKeys) {
      if (fileDataStore.has(key)) {
        fileData = fileDataStore.get(key);
        foundKey = key;
        logger.info(`Found file data with key: ${foundKey}`);
        break;
      }
    }
    
    if (!fileData) {
      logger.error('File data not found for fileId:', fileId);
      console.error('File data not found for fileId:', fileId);
      console.log('Available file data keys:', Array.from(fileDataStore.keys()));
      
      // Try to reconstruct file data from fileId
      console.log('Attempting to reconstruct file data from fileId...');
      try {
        // Extract file ID from the composite fileId (format: F08TMQF3USK_C08SYTDR7R8_1748273406000)
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

// 全てのボタンクリックをキャッチするフォールバック - 簡素化
app.action(/.+/, async ({ ack, body, client, action, logger }) => {
  console.log('=== FALLBACK ACTION HANDLER CALLED ===');
  console.log('Action ID:', action.action_id);
  console.log('Action type:', action.type);
  
  // プロジェクト選択ボタンでない場合のみack
  if (!action.action_id.startsWith('select_project_')) {
    await ack();
    console.log('Fallback: Non-project action acknowledged:', action.action_id);
  } else {
    console.log('Fallback: Project selection action - skipping ack (handled by main handler)');
  }
});

// Handle cancel button click
app.action('cancel_project_selection', async ({ ack, body, client, action, logger }) => {
  try {
    await ack();
    logger.info('Cancel button clicked');

    const actionValue = JSON.parse(action.value);
    const { fileId } = actionValue;
    
    logger.info('Cancelling file processing for fileId:', fileId);
    
    // Clean up stored data
    fileDataStore.delete(fileId);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `❌ ファイル処理がキャンセルされました。`,
      blocks: []
    });

    logger.info('Cancel message sent');

  } catch (error) {
    logger.error('Error handling cancel action:', error);
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

// Lambda handler
exports.handler = async (event, context, callback) => {
  console.log('=== LAMBDA FUNCTION STARTED ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));
  
  console.log('=== ENVIRONMENT VARIABLES CHECK ===');
  console.log('- SLACK_BOT_TOKEN:', process.env.SLACK_BOT_TOKEN ? 'Set (length: ' + process.env.SLACK_BOT_TOKEN.length + ')' : 'Not set');
  console.log('- SLACK_SIGNING_SECRET:', process.env.SLACK_SIGNING_SECRET ? 'Set (length: ' + process.env.SLACK_SIGNING_SECRET.length + ')' : 'Not set');
  console.log('- N8N_AIRTABLE_ENDPOINT:', process.env.N8N_AIRTABLE_ENDPOINT ? 'Set' : 'Not set');
  console.log('- AIRTABLE_BASE:', process.env.AIRTABLE_BASE ? 'Set' : 'Not set');
  console.log('- AIRTABLE_TOKEN:', process.env.AIRTABLE_TOKEN ? 'Set' : 'Not set');
  
  try {
    // Handle Slack URL verification challenge (for initial setup)
    if (event.body) {
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        
        // Handle Slack URL verification challenge
        if (body.type === 'url_verification') {
          console.log('=== URL VERIFICATION CHALLENGE DETECTED ===');
          console.log('Challenge:', body.challenge);
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'text/plain'
            },
            body: body.challenge
          };
        }
        
        // Log interactive payload details for debugging
        if (body.payload) {
          console.log('=== INTERACTIVE PAYLOAD DETECTED ===');
          const payload = JSON.parse(body.payload);
          console.log('Payload type:', payload.type);
          console.log('Full payload:', JSON.stringify(payload, null, 2));
          if (payload.actions && payload.actions.length > 0) {
            console.log('Action details:', payload.actions[0]);
            console.log('Action ID:', payload.actions[0].action_id);
            console.log('Action value:', payload.actions[0].value);
          }
        }
        
        // Log all event types for debugging
        console.log('=== EVENT TYPE ANALYSIS ===');
        console.log('Body type:', body.type);
        console.log('Has payload:', !!body.payload);
        console.log('Has event:', !!body.event);
        if (body.event) {
          console.log('Event type:', body.event.type);
          console.log('Event subtype:', body.event.subtype);
        }
        
      } catch (parseError) {
        console.error('Error parsing body for challenge check:', parseError);
      }
    }
    
    console.log('=== PROCESSING THROUGH SLACK BOLT ===');
    console.log('Slack Bolt app initialized:', !!app);
    console.log('AWS Lambda receiver initialized:', !!awsLambdaReceiver);
    
    // Handle normal Slack events through Bolt
    const handler = await awsLambdaReceiver.start();
    console.log('Slack Bolt handler obtained');
    
    const result = await handler(event, context, callback);
    console.log('Slack Bolt processing completed, result:', result);
    
    return result;
    
  } catch (error) {
    console.error('=== ERROR IN LAMBDA HANDLER ===');
    console.error('Error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error message:', error.message);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

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
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `✅ ファイル "${fileData.fileName}" がプロジェクト "${projectName}" で正常に処理されました！\n\n📊 **プロジェクト情報:**\n• Owner: ${result.project.owner}\n• Repo: ${result.project.repo}\n• Path: ${result.project.path_prefix}\n• Branch: ${result.project.branch || 'main'}`,
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