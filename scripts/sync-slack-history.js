#!/usr/bin/env node

const { WebClient } = require('@slack/web-api');
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const S3_BUCKET = process.env.S3_BUCKET || 'brainbase-context-593793022993';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const WORKSPACE_ID = process.env.SLACK_WORKSPACE_ID || 'unson';
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;

const DAYS_TO_SYNC = parseInt(process.env.DAYS_TO_SYNC || '30', 10);

if (!SLACK_TOKEN) {
  console.error('SLACK_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const slack = new WebClient(SLACK_TOKEN);
const s3Client = new S3Client({ region: AWS_REGION });

function getDateStr(ts) {
  const date = new Date(parseFloat(ts) * 1000);
  return date.toISOString().split('T')[0];
}

function getS3Key(channelId, dateStr) {
  const monthStr = dateStr.slice(0, 7);
  return `slack/${WORKSPACE_ID}/messages/${channelId}/${monthStr}/${dateStr}.json`;
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

async function getMemberName(userId, memberCache) {
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

async function syncChannel(channel, memberCache) {
  console.log(`\nSyncing channel: #${channel.name} (${channel.id})`);

  const oldestTs = (Date.now() / 1000) - (DAYS_TO_SYNC * 24 * 60 * 60);
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

        const userName = msg.user ? await getMemberName(msg.user, memberCache) : 'unknown';

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
        console.log(`Rate limited, waiting ${retryAfter}s...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      console.error(`Error fetching messages for ${channel.name}:`, error.message);
      break;
    }
  } while (cursor);

  for (const [dateStr, messages] of messagesByDate) {
    const key = getS3Key(channel.id, dateStr);
    const existing = await getExistingMessages(key);

    const existingTs = new Set(existing.messages.map(m => m.ts));
    const newMessages = messages.filter(m => !existingTs.has(m.ts));

    if (newMessages.length > 0) {
      existing.messages.push(...newMessages);
      existing.messages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
      existing.last_updated = new Date().toISOString();

      await saveMessages(key, existing);
      console.log(`  ${dateStr}: +${newMessages.length} messages (total: ${existing.messages.length})`);
    }
  }

  console.log(`  Total: ${totalMessages} messages processed`);
  return totalMessages;
}

async function saveChannelsList(channels) {
  const key = `slack/${WORKSPACE_ID}/channels.json`;
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
  console.log(`Saved ${channels.length} channels to ${key}`);
}

async function main() {
  console.log('=== Slack History Sync ===');
  console.log(`Workspace: ${WORKSPACE_ID}`);
  console.log(`Days to sync: ${DAYS_TO_SYNC}`);
  console.log(`S3 Bucket: ${S3_BUCKET}`);

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

  await saveChannelsList(channels);

  let totalMessages = 0;
  for (const channel of channels) {
    const count = await syncChannel(channel, memberCache);
    totalMessages += count;
  }

  console.log(`\n=== Sync Complete ===`);
  console.log(`Total messages synced: ${totalMessages}`);
}

main().catch(console.error);
