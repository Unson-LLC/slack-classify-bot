#!/usr/bin/env node

const { WebClient } = require('@slack/web-api');
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const S3_BUCKET = process.env.S3_BUCKET || 'brainbase-context-593793022993';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const DAYS_TO_SYNC = parseInt(process.env.DAYS_TO_SYNC || '30', 10);

const WORKSPACE_CONFIG = {
  unson: {
    name: '雲孫（UNSON）',
    tokenEnvVar: 'SLACK_BOT_TOKEN',
    priority: 'high'
  },
  techknight: {
    name: 'Tech Knight',
    tokenEnvVar: 'SLACK_BOT_TOKEN_TECHKNIGHT',
    priority: 'medium'
  }
};

const s3Client = new S3Client({ region: AWS_REGION });

function getDateStr(ts) {
  const date = new Date(parseFloat(ts) * 1000);
  return date.toISOString().split('T')[0];
}

function getS3Key(workspaceId, channelId, dateStr) {
  const monthStr = dateStr.slice(0, 7);
  return `slack/${workspaceId}/messages/${channelId}/${monthStr}/${dateStr}.json`;
}

async function getExistingMessages(key) {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key
    });
    const response = await s3Client.send(command);
    const jsonStr = await response.Body.transformToString();
    return JSON.parse(jsonStr);
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return { messages: [], last_updated: null };
    }
    throw error;
  }
}

async function saveMessages(key, data) {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json'
  });
  await s3Client.send(command);
}

async function getMemberName(slack, userId, memberCache) {
  if (memberCache.has(userId)) {
    return memberCache.get(userId);
  }
  try {
    const userInfo = await slack.users.info({ user: userId });
    const name = userInfo.user?.real_name || userInfo.user?.name || userId;
    memberCache.set(userId, name);
    return name;
  } catch (e) {
    memberCache.set(userId, userId);
    return userId;
  }
}

async function syncChannel(slack, workspaceId, channel, memberCache, daysToSync) {
  console.log(`  Syncing channel: #${channel.name} (${channel.id})`);

  const oldestTs = (Date.now() / 1000) - (daysToSync * 24 * 60 * 60);
  let cursor = undefined;
  let totalMessages = 0;
  const messagesByDate = new Map();

  do {
    try {
      const response = await slack.conversations.history({
        channel: channel.id,
        oldest: oldestTs.toString(),
        limit: 200,
        cursor: cursor
      });

      for (const msg of response.messages || []) {
        if (msg.subtype === 'channel_join' || msg.subtype === 'channel_leave') {
          continue;
        }

        const dateStr = getDateStr(msg.ts);
        if (!messagesByDate.has(dateStr)) {
          messagesByDate.set(dateStr, []);
        }

        const userName = msg.user ? await getMemberName(slack, msg.user, memberCache) : 'unknown';

        messagesByDate.get(dateStr).push({
          ts: msg.ts,
          user: msg.user,
          user_name: userName,
          text: msg.text || '',
          channel: channel.id,
          channel_name: channel.name,
          thread_ts: msg.thread_ts || null,
          reactions: msg.reactions || [],
          files: (msg.files || []).map(f => ({
            id: f.id,
            name: f.name,
            mimetype: f.mimetype
          })),
          subtype: msg.subtype || null,
          archived_at: new Date().toISOString()
        });

        totalMessages++;
      }

      cursor = response.response_metadata?.next_cursor;

      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      if (error.data?.error === 'ratelimited') {
        const retryAfter = parseInt(error.data?.headers?.['retry-after'] || '60', 10);
        console.log(`  Rate limited, waiting ${retryAfter}s...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      console.error(`  Error fetching messages for ${channel.name}:`, error.message);
      break;
    }
  } while (cursor);

  let savedCount = 0;
  for (const [dateStr, messages] of messagesByDate) {
    const key = getS3Key(workspaceId, channel.id, dateStr);
    const existing = await getExistingMessages(key);

    const existingTs = new Set(existing.messages.map(m => m.ts));
    const newMessages = messages.filter(m => !existingTs.has(m.ts));

    if (newMessages.length > 0) {
      existing.messages.push(...newMessages);
      existing.messages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
      existing.last_updated = new Date().toISOString();

      await saveMessages(key, existing);
      savedCount += newMessages.length;
    }
  }

  if (savedCount > 0) {
    console.log(`    +${savedCount} new messages`);
  }

  return totalMessages;
}

async function saveChannelsList(workspaceId, channels) {
  const key = `slack/${workspaceId}/channels.json`;
  const data = {
    channels: channels.map(c => ({
      id: c.id,
      name: c.name,
      is_private: c.is_private,
      num_members: c.num_members
    })),
    last_updated: new Date().toISOString()
  };
  await saveMessages(key, data);
  console.log(`  Saved ${channels.length} channels to ${key}`);
}

async function syncWorkspace(workspaceId, token, daysToSync = DAYS_TO_SYNC) {
  const config = WORKSPACE_CONFIG[workspaceId];
  const workspaceName = config?.name || workspaceId;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Workspace: ${workspaceName} (${workspaceId})`);
  console.log(`Days to sync: ${daysToSync}`);
  console.log(`${'='.repeat(50)}`);

  const slack = new WebClient(token);
  const memberCache = new Map();

  console.log('\nFetching channel list...');
  const channels = [];
  let cursor = undefined;

  do {
    const response = await slack.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      cursor: cursor
    });

    for (const channel of response.channels || []) {
      if (channel.is_member) {
        channels.push(channel);
      }
    }

    cursor = response.response_metadata?.next_cursor;
  } while (cursor);

  console.log(`Found ${channels.length} channels where bot is a member`);

  await saveChannelsList(workspaceId, channels);

  let totalMessages = 0;
  for (const channel of channels) {
    const count = await syncChannel(slack, workspaceId, channel, memberCache, daysToSync);
    totalMessages += count;
  }

  console.log(`\nWorkspace ${workspaceName}: ${totalMessages} messages processed`);
  return { workspaceId, workspaceName, totalMessages, channelCount: channels.length };
}

function getAvailableWorkspaces() {
  const available = [];
  for (const [id, config] of Object.entries(WORKSPACE_CONFIG)) {
    const token = process.env[config.tokenEnvVar];
    if (token) {
      available.push({ id, ...config, token });
    }
  }
  return available;
}

async function syncAllWorkspaces(options = {}) {
  const { workspaces = null, daysToSync = DAYS_TO_SYNC } = options;

  console.log('=== Slack History Sync (Multi-Workspace) ===');
  console.log(`S3 Bucket: ${S3_BUCKET}`);
  console.log(`Default days: ${daysToSync}`);

  const available = getAvailableWorkspaces();

  if (available.length === 0) {
    console.error('No workspace tokens configured');
    return { success: false, error: 'No tokens' };
  }

  console.log(`\nConfigured workspaces: ${available.map(w => w.id).join(', ')}`);

  const toSync = workspaces
    ? available.filter(w => workspaces.includes(w.id))
    : available;

  if (toSync.length === 0) {
    console.error('No matching workspaces to sync');
    return { success: false, error: 'No matching workspaces' };
  }

  const results = [];
  for (const workspace of toSync) {
    try {
      const result = await syncWorkspace(workspace.id, workspace.token, daysToSync);
      results.push({ ...result, success: true });
    } catch (error) {
      console.error(`Failed to sync ${workspace.id}:`, error.message);
      results.push({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        success: false,
        error: error.message
      });
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('=== Sync Summary ===');
  for (const r of results) {
    if (r.success) {
      console.log(`✅ ${r.workspaceName}: ${r.totalMessages} msgs, ${r.channelCount} channels`);
    } else {
      console.log(`❌ ${r.workspaceName}: ${r.error}`);
    }
  }

  return { success: true, results };
}

async function handler(event, context) {
  console.log('Lambda invoked with event:', JSON.stringify(event));

  const options = {
    workspaces: event.workspaces || null,
    daysToSync: event.daysToSync || DAYS_TO_SYNC
  };

  try {
    const result = await syncAllWorkspaces(options);
    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('Sync failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && args[i + 1]) {
      options.workspaces = [args[i + 1]];
      i++;
    } else if (args[i] === '--days' && args[i + 1]) {
      options.daysToSync = parseInt(args[i + 1], 10);
      i++;
    }
  }

  syncAllWorkspaces(options)
    .then(result => {
      console.log('\nDone.');
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { handler, syncAllWorkspaces, syncWorkspace, WORKSPACE_CONFIG };
