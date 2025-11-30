#!/usr/bin/env node

/**
 * Slack Channels List Script
 *
 * Slackのチャンネル一覧を取得して表示します。
 *
 * 使用方法:
 *   node scripts/list-slack-channels.js [検索キーワード]
 *
 * 例:
 *   node scripts/list-slack-channels.js              # 全チャンネル表示
 *   node scripts/list-slack-channels.js senrigan     # "senrigan"を含むチャンネル
 *   node scripts/list-slack-channels.js 0050         # "0050"を含むチャンネル
 *
 * 環境変数:
 *   SLACK_BOT_TOKEN: Slackボットトークン（api/env.jsonまたは環境変数から読み込み）
 */

const fs = require('fs');
const path = require('path');

// api/node_modules から @slack/bolt を読み込む
const { App } = require(path.join(__dirname, '..', 'api', 'node_modules', '@slack', 'bolt'));

function loadSlackToken() {
  // 1. 環境変数から
  if (process.env.SLACK_BOT_TOKEN) {
    return process.env.SLACK_BOT_TOKEN;
  }

  // 2. api/env.json から
  const envJsonPath = path.join(__dirname, '..', 'api', 'env.json');
  if (fs.existsSync(envJsonPath)) {
    try {
      const envJson = JSON.parse(fs.readFileSync(envJsonPath, 'utf8'));
      if (envJson.SLACK_BOT_TOKEN) {
        return envJson.SLACK_BOT_TOKEN;
      }
    } catch (e) {
      // ignore
    }
  }

  // 3. back_office/.env から（フォールバック）
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

async function listSlackChannels(filter) {
  const token = loadSlackToken();

  if (!token) {
    console.error('❌ SLACK_BOT_TOKEN が見つかりません');
    console.error('   以下のいずれかを設定してください:');
    console.error('   - 環境変数 SLACK_BOT_TOKEN');
    console.error('   - api/env.json の SLACK_BOT_TOKEN');
    process.exit(1);
  }

  const app = new App({
    token: token,
    signingSecret: 'dummy'
  });

  console.log('📡 Slackからチャンネル一覧を取得中...\n');

  try {
    const result = await app.client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000
    });

    let channels = result.channels;

    // フィルタリング
    if (filter) {
      const filterLower = filter.toLowerCase();
      channels = channels.filter(c =>
        c.name.toLowerCase().includes(filterLower)
      );
      console.log(`🔍 "${filter}" を含むチャンネル:\n`);
    } else {
      console.log(`📋 全チャンネル (${channels.length}件):\n`);
    }

    // 名前でソート
    channels.sort((a, b) => a.name.localeCompare(b.name));

    // 表示
    console.log('チャンネルID\t\tチャンネル名');
    console.log('─'.repeat(50));

    channels.forEach(channel => {
      const privateFlag = channel.is_private ? '🔒' : '  ';
      console.log(`${channel.id}\t${privateFlag} ${channel.name}`);
    });

    console.log('─'.repeat(50));
    console.log(`\n合計: ${channels.length}件`);

    if (filter && channels.length > 0) {
      console.log('\n💡 DynamoDBに追加する場合:');
      console.log('aws dynamodb update-item \\');
      console.log('  --table-name slack-classify-bot-projects \\');
      console.log('  --key \'{"project_id": {"S": "proj_XXX"}}\' \\');
      console.log('  --update-expression "SET slack_channels = :channels" \\');
      const channelIds = channels.map(c => `{"S": "${c.id}"}`).join(', ');
      console.log(`  --expression-attribute-values '{":channels": {"L": [${channelIds}]}}' \\`);
      console.log('  --profile k.sato --region us-east-1');
    }

  } catch (error) {
    console.error('❌ チャンネル取得に失敗:', error.message);
    process.exit(1);
  }
}

// 実行
const filter = process.argv[2] || null;
listSlackChannels(filter);
