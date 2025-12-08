#!/usr/bin/env node
/**
 * channels.yml → channels.json → S3 同期スクリプト
 *
 * Usage: node scripts/sync-channels-to-s3.js
 *
 * 正本: _codex/common/meta/slack/channels.yml
 * 同期先: s3://brainbase-context-593793022993/channels.json
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const CHANNELS_YML_PATH = path.resolve(__dirname, '../../../_codex/common/meta/slack/channels.yml');
const S3_BUCKET = 'brainbase-context-593793022993';
const S3_KEY = 'channels.json';
const AWS_REGION = 'us-east-1';

async function main() {
  console.log('=== Sync channels.yml to S3 ===\n');

  // 1. channels.ymlを読み込み
  console.log(`Reading: ${CHANNELS_YML_PATH}`);
  const ymlContent = fs.readFileSync(CHANNELS_YML_PATH, 'utf8');
  const data = yaml.load(ymlContent);

  console.log(`Loaded ${data.channels.length} channels\n`);

  // 2. JSONに変換
  const jsonContent = JSON.stringify(data, null, 2);
  console.log('Converted to JSON');

  // 3. S3にアップロード
  const s3Client = new S3Client({ region: AWS_REGION });
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: S3_KEY,
    Body: jsonContent,
    ContentType: 'application/json'
  });

  console.log(`\nUploading to s3://${S3_BUCKET}/${S3_KEY}...`);
  await s3Client.send(command);
  console.log('Upload complete!\n');

  // 4. サマリー出力
  const projectIds = [...new Set(data.channels.map(c => c.project_id))];
  console.log('=== Summary ===');
  console.log(`Total channels: ${data.channels.length}`);
  console.log(`Unique projects: ${projectIds.length}`);
  console.log('Projects:', projectIds.join(', '));
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
