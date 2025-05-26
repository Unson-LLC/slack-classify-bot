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
  
  // Clean up old file data
  for (const [key, data] of fileDataStore.entries()) {
    if (data.timestamp && data.timestamp < thirtyMinutesAgo) {
      fileDataStore.delete(key);
    }
  }
  
  // Clean up old processed file IDs (keep only last 1000)
  if (processedFiles.size > 1000) {
    const entries = Array.from(processedFiles);
    const toKeep = entries.slice(-500); // Keep last 500
    processedFiles.clear();
    toKeep.forEach(id => processedFiles.add(id));
  }
  
  console.log(`Cleanup completed. FileDataStore: ${fileDataStore.size}, ProcessedFiles: ${processedFiles.size}`);
}, 30 * 60 * 1000); // 30 minutes

// Initialize AWS Lambda receiver
const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Initialize Slack app with Lambda receiver
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
});

// Message classification handler
app.message(async ({ message, client, logger }) => {
  try {
    // Skip bot messages and messages without text
    if (message.subtype === 'bot_message' || !message.text) {
      return;
    }

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
    logger.error('Error in message classification:', error);
  }
});

// File upload handler with project selection
app.event('file_shared', async ({ event, client, logger }) => {
  try {
    logger.info('File shared event received:', event);

    // Create unique identifier for this file event
    const eventId = `${event.file_id}_${event.ts}`;
    
    // Check if we've already processed this file event
    if (processedFiles.has(eventId)) {
      logger.info('File event already processed, skipping:', eventId);
      return;
    }
    
    // Mark as processing
    processedFiles.add(eventId);

    // Get file info
    const fileInfo = await client.files.info({
      file: event.file_id
    });

    const file = fileInfo.file;
    
    // Only process .txt files
    if (file.filetype === 'txt' || file.name.endsWith('.txt')) {
      logger.info('Processing .txt file:', file.name);
      
      // Download file content
      const response = await fetch(file.url_private, {
        headers: {
          'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
        }
      });
      
      const content = await response.text();
      
      // Store file data temporarily
      const fileKey = `${event.file_id}_${Date.now()}`;
      fileDataStore.set(fileKey, {
        fileName: file.name,
        content: content,
        uploadedBy: event.user_id,
        channel: event.channel_id,
        ts: event.ts,
        fileId: event.file_id,
        timestamp: Date.now()
      });

      // Get projects from Airtable
      const projects = await airtableIntegration.getProjects();
      
      if (projects.length === 0) {
        await client.chat.postMessage({
          channel: event.channel_id,
          text: `❌ プロジェクトが見つかりません。Airtableにプロジェクト情報を追加してください。`
        });
        return;
      }

      // Create interactive message with project selection buttons
      const blocks = airtableIntegration.createProjectSelectionBlocks(projects, fileKey);
      
      await client.chat.postMessage({
        channel: event.channel_id,
        text: `📁 ファイル "${file.name}" がアップロードされました。`,
        blocks: blocks,
        thread_ts: event.ts
      });

    } else {
      logger.info('Skipping non-txt file:', file.name);
    }
  } catch (error) {
    logger.error('Error in file processing:', error);
    
    // Remove from processed set on error so it can be retried
    const eventId = `${event.file_id}_${event.ts}`;
    processedFiles.delete(eventId);
    
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

// Handle project selection button clicks
app.action(/^select_project_/, async ({ ack, body, client, action, logger }) => {
  await ack();

  try {
    const actionValue = JSON.parse(action.value);
    const { projectId, projectName, fileId } = actionValue;
    
    // Get stored file data
    const fileData = fileDataStore.get(fileId);
    if (!fileData) {
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `❌ ファイルデータが見つかりません。再度アップロードしてください。`,
        blocks: []
      });
      return;
    }

    // Update message to show processing
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `🔄 プロジェクト "${projectName}" でファイル "${fileData.fileName}" を処理中...`,
      blocks: []
    });

    // Process file with selected project
    const result = await airtableIntegration.processFileWithProject({
      fileContent: fileData.content,
      fileName: fileData.fileName,
      projectId: projectId,
      userId: fileData.uploadedBy,
      channelId: fileData.channel,
      ts: fileData.ts
    });

    // Clean up stored data
    fileDataStore.delete(fileId);

    if (result.success) {
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `✅ ファイル "${fileData.fileName}" がプロジェクト "${projectName}" で正常に処理されました！\n\n📊 **プロジェクト情報:**\n• Owner: ${result.project.owner}\n• Repo: ${result.project.repo}\n• Path: ${result.project.path_prefix}\n• Branch: ${result.project.branch || 'main'}`,
        blocks: []
      });
    } else {
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `❌ ファイル処理に失敗しました: ${result.error}`,
        blocks: []
      });
    }

  } catch (error) {
    logger.error('Error handling project selection:', error);
    
    try {
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `❌ プロジェクト選択の処理中にエラーが発生しました: ${error.message}`,
        blocks: []
      });
    } catch (updateError) {
      logger.error('Error updating message:', updateError);
    }
  }
});

// Handle cancel button click
app.action('cancel_project_selection', async ({ ack, body, client, action, logger }) => {
  await ack();

  try {
    const actionValue = JSON.parse(action.value);
    const { fileId } = actionValue;
    
    // Clean up stored data
    fileDataStore.delete(fileId);

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: `❌ ファイル処理がキャンセルされました。`,
      blocks: []
    });

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
  console.log('Lambda function started');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Handle Slack URL verification challenge (for initial setup)
    if (event.body) {
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        
        // Handle Slack URL verification challenge
        if (body.type === 'url_verification') {
          console.log('URL verification challenge detected');
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'text/plain'
            },
            body: body.challenge
          };
        }
      } catch (parseError) {
        console.error('Error parsing body for challenge check:', parseError);
      }
    }
    
    // Handle normal Slack events through Bolt
    const handler = await awsLambdaReceiver.start();
    return handler(event, context, callback);
    
  } catch (error) {
    console.error('Error in Lambda handler:', error);
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