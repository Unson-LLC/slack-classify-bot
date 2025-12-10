#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { App } = require(path.join(__dirname, '..', 'api', 'node_modules', '@slack', 'bolt'));

function loadSlackToken() {
  if (process.env.SLACK_BOT_TOKEN) {
    return process.env.SLACK_BOT_TOKEN;
  }
  const backOfficeEnvPath = '/Users/ksato/workspace/unson/app/back_office/.env';
  if (fs.existsSync(backOfficeEnvPath)) {
    try {
      const envContent = fs.readFileSync(backOfficeEnvPath, 'utf8');
      const match = envContent.match(/SLACK_BOT_TOKEN=(.+)/);
      if (match) {
        return match[1].trim();
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}

async function getChannelInfo(channelId) {
  const token = loadSlackToken();
  if (!token) {
    console.error('SLACK_BOT_TOKEN not found');
    process.exit(1);
  }

  const app = new App({
    token: token,
    signingSecret: 'dummy'
  });

  try {
    const result = await app.client.conversations.info({
      channel: channelId
    });
    console.log('Channel ID:', result.channel.id);
    console.log('Channel Name:', result.channel.name);
    console.log('Is Private:', result.channel.is_private);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

const channelId = process.argv[2];
if (!channelId) {
  console.error('Usage: node get-channel-info.js <channel_id>');
  process.exit(1);
}

getChannelInfo(channelId);
