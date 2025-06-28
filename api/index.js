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
    await airtableIntegration.processFileWithProject(action, body, client, logger, fileDataStore);
  } catch (error) {
    logger.error('Error processing project selection:', error);
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

// Catch-all action handler for debugging (excluding already handled actions)
app.action(/^(?!select_project_|update_airtable_record).*/, async ({ ack, action, logger }) => {
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