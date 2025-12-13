#!/usr/bin/env node
/**
 * sync-channels-to-s3.js
 * _codex/common/meta/slack/channels.yml を S3 に JSON として同期
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const S3_BUCKET = process.env.S3_BUCKET || 'brainbase-context-593793022993';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const CHANNELS_YML_PATH = process.env.CHANNELS_YML_PATH ||
  path.join(__dirname, '../../_codex/common/meta/slack/channels.yml');

async function syncChannelsToS3() {
  console.log('=== Sync channels.yml to S3 ===');
  console.log(`Source: ${CHANNELS_YML_PATH}`);
  console.log(`Target: s3://${S3_BUCKET}/channels.json`);

  // Read and parse YAML
  const yamlContent = fs.readFileSync(CHANNELS_YML_PATH, 'utf8');
  const data = yaml.load(yamlContent);

  if (!data || !data.channels) {
    throw new Error('Invalid channels.yml: missing channels array');
  }

  // Transform for easier lookup
  // proj_zeims -> zeims のマッピングも追加
  const transformedChannels = data.channels.map(ch => ({
    ...ch,
    // project_id から proj_ プレフィックスを除去した短縮形も追加
    project_id_short: ch.project_id?.replace(/^proj_/, '') || null,
  }));

  const jsonData = {
    channels: transformedChannels,
    last_synced: new Date().toISOString(),
    source: 'channels.yml',
    total_channels: transformedChannels.length,
  };

  // Upload to S3
  const s3Client = new S3Client({ region: AWS_REGION });
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: 'channels.json',
    Body: JSON.stringify(jsonData, null, 2),
    ContentType: 'application/json',
  });

  await s3Client.send(command);

  console.log(`✅ Synced ${transformedChannels.length} channels to S3`);

  // Summary by project
  const projectCounts = {};
  for (const ch of transformedChannels) {
    const project = ch.project_id_short || 'unknown';
    projectCounts[project] = (projectCounts[project] || 0) + 1;
  }

  console.log('\nChannels by project:');
  Object.entries(projectCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([project, count]) => {
      console.log(`  ${project}: ${count} channels`);
    });

  return jsonData;
}

// Run if called directly
if (require.main === module) {
  syncChannelsToS3()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

module.exports = { syncChannelsToS3 };
