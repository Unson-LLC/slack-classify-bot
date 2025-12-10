#!/usr/bin/env node
/**
 * sync-members-to-s3.js
 *
 * _codex/common/meta/slack/members.yml を S3 members.json に同期
 * brainbase-uiのSettings画面で管理されるメンバー情報を
 * mana Lambdaが参照できるS3に同期する
 *
 * 使用方法:
 *   node scripts/sync-members-to-s3.js
 *
 * 前提:
 *   - AWS認証情報が設定されていること
 *   - _codex/common/meta/slack/members.yml が存在すること
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const REGION = 'us-east-1';
const BUCKET = 'brainbase-context-593793022993';
const S3_KEY = 'members.json';

// members.yml のパス（worktreeでもmainでも動くように）
const POSSIBLE_PATHS = [
  path.resolve(__dirname, '../../_codex/common/meta/slack/members.yml'),
  path.resolve(__dirname, '../../../_codex/common/meta/slack/members.yml'),
  '/Users/ksato/workspace/_codex/common/meta/slack/members.yml'
];

/**
 * フルネームから姓を抽出（Airtable assignee用）
 * "佐藤 圭吾" → "佐藤"
 */
function extractFamilyName(fullName) {
  if (!fullName) return null;
  const parts = fullName.trim().split(/\s+/);
  return parts[0];
}

/**
 * members.yml を読み込んでJSON形式に変換
 */
function loadAndConvertMembers() {
  let membersYmlPath = null;

  for (const p of POSSIBLE_PATHS) {
    if (fs.existsSync(p)) {
      membersYmlPath = p;
      break;
    }
  }

  if (!membersYmlPath) {
    throw new Error(`members.yml not found. Searched: ${POSSIBLE_PATHS.join(', ')}`);
  }

  console.log(`Loading: ${membersYmlPath}`);

  const ymlContent = fs.readFileSync(membersYmlPath, 'utf8');
  const data = yaml.load(ymlContent);

  const members = data.members.map(m => ({
    brainbase_name: extractFamilyName(m.brainbase_name),  // 姓のみ
    brainbase_fullname: m.brainbase_name,                 // フルネーム保持
    slack_id: m.slack_id || null,
    owner_id: m.slack_name || null,  // slack_name を owner_id として使用
    workspace: m.workspace || null,
    note: m.note || null
  }));

  return {
    members,
    source: 'brainbase-ui/_codex/common/meta/slack/members.yml',
    updated_at: new Date().toISOString(),
    description: 'Slack User ID to brainbase_name mapping for Airtable sync'
  };
}

/**
 * S3にアップロード
 */
async function uploadToS3(data) {
  const s3Client = new S3Client({ region: REGION });

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: S3_KEY,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json'
  });

  await s3Client.send(command);
  console.log(`Uploaded to s3://${BUCKET}/${S3_KEY}`);
}

async function main() {
  try {
    console.log('=== Syncing members.yml to S3 ===');

    const data = loadAndConvertMembers();
    console.log(`Found ${data.members.length} members`);

    // デバッグ出力
    console.log('\nSample mappings:');
    data.members.slice(0, 5).forEach(m => {
      console.log(`  ${m.slack_id} / ${m.owner_id} → ${m.brainbase_name}`);
    });

    await uploadToS3(data);

    console.log('\n✅ Sync completed successfully');
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    process.exit(1);
  }
}

main();
