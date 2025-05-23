const { App, ExpressReceiver } = require('@slack/bolt');
const N8nIntegration = require('./n8n-integration');
const AirtableIntegration = require('./airtable-integration');
require('dotenv').config();

// Create an ExpressReceiver
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // You can specify an endpoint for Slack events, e.g., '/slack/events'
  // By default, it's '/slack/events'
  // endpoints: '/slack/events' 
});

// Initialize integrations
const n8nIntegration = new N8nIntegration(process.env.N8N_ENDPOINT);
const airtableIntegration = new AirtableIntegration(process.env.N8N_AIRTABLE_ENDPOINT || process.env.N8N_ENDPOINT);

// Initializes your app with your bot token and the receiver
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: receiver // Use the receiver
  // socketMode and appToken are removed for HTTP mode
});

// Listen for file uploads (specifically .txt files)
app.event('file_shared', async ({ event, client }) => {
  try {
    // Get file details
    const fileInfo = await client.files.info({
      file: event.file_id
    });
    
    const file = fileInfo.file;
    
    // Check if it's a supported file type
    if (!airtableIntegration.isSupportedFile(file)) {
      console.log(`Unsupported file type: ${file.filetype}. Only .txt files are processed.`);
      return;
    }
    
    // Extract project ID from filename
    const projectId = airtableIntegration.extractProjectId(file.name);
    
    console.log('Processing file upload:', {
      filename: file.name,
      filetype: file.filetype,
      projectId: projectId,
      channel: event.channel_id
    });
    
    // Create file event for n8n
    const fileEvent = {
      type: 'file_shared',
      files: [file],
      user: event.user_id,
      channel: event.channel_id,
      ts: event.event_ts,
      file_id: event.file_id
    };
    
    // Send to n8n for processing
    await airtableIntegration.sendFileUpload(fileEvent);
    
    console.log('File sent to n8n for processing');
    
  } catch (error) {
    console.error('Error processing file upload:', error.message);
    
    // Try to notify user of error
    try {
      await client.chat.postMessage({
        channel: event.channel_id,
        text: `❌ Error processing file upload: ${error.message}`
      });
    } catch (notificationError) {
      console.error('Error sending error notification:', notificationError.message);
    }
  }
});

// Listen for messages and classify them
app.message(async ({ message, client }) => {
  try {
    // Skip bot messages and thread replies to avoid loops
    if (message.bot_id || message.thread_ts) {
      return;
    }

    // Classify the message
    const classification = n8nIntegration.classifyMessage(message.text);
    
    // Send to n8n for GitHub storage
    await n8nIntegration.sendClassification(message, classification);
    
    console.log(`Message classified as: ${classification}`, {
      user: message.user,
      channel: message.channel,
      text: message.text?.substring(0, 100) + '...'
    });
  } catch (error) {
    console.error('Error processing message:', error.message);
  }
});

// Listen for a slash command to manually trigger file processing
app.command('/process-file', async ({ ack, body, client }) => {
  await ack();
  
  try {
    const text = body.text || '';
    const parts = text.split(' ');
    const fileId = parts[0];
    
    if (!fileId) {
      await client.chat.postMessage({
        channel: body.channel_id,
        text: '❌ Please provide a file ID. Usage: `/process-file <file_id>`'
      });
      return;
    }
    
    // Get file details
    const fileInfo = await client.files.info({
      file: fileId
    });
    
    const file = fileInfo.file;
    
    // Check if it's a supported file type
    if (!airtableIntegration.isSupportedFile(file)) {
      await client.chat.postMessage({
        channel: body.channel_id,
        text: `❌ Unsupported file type: ${file.filetype}. Only .txt files are supported.`
      });
      return;
    }
    
    // Create file event for n8n
    const fileEvent = {
      type: 'manual_file_processing',
      files: [file],
      user: body.user_id,
      channel: body.channel_id,
      ts: Date.now() / 1000,
      file_id: fileId
    };
    
    await client.chat.postMessage({
      channel: body.channel_id,
      text: `🔄 Processing file: ${file.name}...`
    });
    
    // Send to n8n for processing
    await airtableIntegration.sendFileUpload(fileEvent);
    
  } catch (error) {
    console.error('Error in manual file processing:', error);
    await client.chat.postMessage({
      channel: body.channel_id,
      text: `❌ Error processing file: ${error.message}`
    });
  }
});

// Listen for a slash command invocation
app.command('/classify', async ({ ack, body, client }) => {
  // Acknowledge the command request
  await ack();

  try {
    const text = body.text || '';
    const classification = n8nIntegration.classifyMessage(text);
    
    // Create a mock event for the classification
    const mockEvent = {
      user: body.user_id,
      channel: body.channel_id,
      text: text,
      ts: Date.now() / 1000
    };
    
    // Send to n8n
    await n8nIntegration.sendClassification(mockEvent, classification);
    
    // Call views.publish with the built-in client
    const result = await client.chat.postMessage({
      channel: body.channel_id,
      text: `📊 Message classified as: *${classification}*\n🔗 Data saved to GitHub repository.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📊 *Classification Result*\n\n*Category:* ${classification}\n*Text:* "${text}"\n*User:* <@${body.user_id}>\n\n✅ Data has been saved to the GitHub repository.`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "💡 Available categories: bug, feature-request, question, feedback, urgent, performance, security, documentation, general"
            }
          ]
        }
      ]
    });
    console.log(result);
  }
  catch (error) {
    console.error(error);
    try {
      await client.chat.postMessage({
        channel: body.channel_id,
        text: "❌ Error classifying message. Please try again."
      });
    } catch (err) {
      console.error('Error sending error message:', err);
    }
  }
});

// Listen for a slash command invocation
app.command('/hello-bolt-app', async ({ ack, body, client }) => {
  // Acknowledge the command request
  await ack();

  try {
    // Call views.publish with the built-in client
    const result = await client.chat.postMessage({
      channel: body.channel_id,
      text: "Hello world"
    });
    console.log(result);
  }
  catch (error) {
    console.error(error);
  }
});

// Listen for a button press
app.action('button_click', async ({ ack, body, client }) => {
  // Acknowledge the action
  await ack();

  try {
    // Update the message
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: 'Button clicked!',
      blocks: [] // Remove buttons after click, or update as needed
    });
  } catch (error) {
    console.error(error);
  }
});

// Example of handling block_actions specifically (e.g., from a modal or interactive message)
app.action({ type: 'block_actions' }, async ({ ack, body, client }) => {
  await ack();
  try {
    if (body.message) {
      const result = await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `Action ${body.actions[0].action_id} was triggered by <@${body.user.id}>`,
        blocks: [] 
      });
      console.log('Chat updated:', result);
    } else if (body.view) {
      console.log('Block action from view:', body.actions[0]);
    }
  } catch (error) {
    console.error('Error handling block_actions:', error);
  }
});

// Example of handling a view submission (e.g., from a modal)
app.view('modal_view_1', async ({ ack, body, view, client }) => {
  await ack();

  const user = body.user.id;
  // const val = view.state.values.input_block_id.input_action_id.value;

  try {
    // await client.chat.postMessage({
    //   channel: user,
    //   text: `Thanks for your submission: ${val}`
    // });
    console.log('Modal submitted by user:', user);
  } catch (error) {
    console.error('Error handling modal submission:', error);
  }
});

// Catch all for errors
app.error(async (error) => {
  console.error(error);
});

// Export the receiver's Express app for Vercel
module.exports = receiver.app; 