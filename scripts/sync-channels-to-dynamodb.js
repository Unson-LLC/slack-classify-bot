#!/usr/bin/env node
/**
 * Sync channels.yml to DynamoDB
 *
 * channels.ymlをマスタとして、DynamoDBのmana-projectsテーブルの
 * slack_channelsフィールドを更新する。
 *
 * Usage:
 *   node scripts/sync-channels-to-dynamodb.js [--dry-run]
 *
 * Options:
 *   --dry-run  実際には更新せず、変更内容を表示するのみ
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// Configuration
const CHANNELS_YML_PATH = '/Users/ksato/workspace/_codex/common/meta/slack/channels.yml';
const TABLE_NAME = 'mana-projects';
const REGION = 'us-east-1';

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

async function loadChannelsYml() {
  const content = fs.readFileSync(CHANNELS_YML_PATH, 'utf8');
  const data = yaml.load(content);
  return data.channels || [];
}

function groupChannelsByProject(channels) {
  const grouped = {};

  for (const channel of channels) {
    const projectId = channel.project_id;
    if (!projectId) continue;

    if (!grouped[projectId]) {
      grouped[projectId] = {
        channels: [],
        crosspost_channels: []
      };
    }

    const channelData = {
      channel_id: channel.channel_id,
      channel_name: channel.channel_name,
      workspace: channel.workspace,
      type: channel.type || 'general'
    };

    if (channel.is_crosspost_target) {
      grouped[projectId].crosspost_channels.push(channelData);
    } else {
      grouped[projectId].channels.push(channelData);
    }
  }

  return grouped;
}

async function getExistingProjects() {
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    ProjectionExpression: 'project_id, #name, slack_channels, crosspost_channels',
    ExpressionAttributeNames: {
      '#name': 'name'
    }
  }));

  return result.Items || [];
}

async function updateProjectChannels(projectId, channels, crosspostChannels) {
  const updateExpression = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  if (channels && channels.length > 0) {
    updateExpression.push('#sc = :channels');
    expressionAttributeNames['#sc'] = 'slack_channels';
    expressionAttributeValues[':channels'] = channels;
  }

  if (crosspostChannels && crosspostChannels.length > 0) {
    updateExpression.push('#cc = :crosspost');
    expressionAttributeNames['#cc'] = 'crosspost_channels';
    expressionAttributeValues[':crosspost'] = crosspostChannels;
  }

  updateExpression.push('#ua = :now');
  expressionAttributeNames['#ua'] = 'updated_at';
  expressionAttributeValues[':now'] = Math.floor(Date.now() / 1000);

  if (updateExpression.length === 1) {
    // Only updated_at, nothing to update
    return false;
  }

  const params = {
    TableName: TABLE_NAME,
    Key: { project_id: projectId },
    UpdateExpression: 'SET ' + updateExpression.join(', '),
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues
  };

  if (!isDryRun) {
    await docClient.send(new UpdateCommand(params));
  }

  return true;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Sync channels.yml to DynamoDB');
  console.log('='.repeat(60));
  console.log(`Source: ${CHANNELS_YML_PATH}`);
  console.log(`Target: ${TABLE_NAME} (${REGION})`);
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('='.repeat(60));
  console.log('');

  // Load channels.yml
  console.log('Loading channels.yml...');
  const channels = await loadChannelsYml();
  console.log(`Found ${channels.length} channel definitions`);

  // Group by project
  const grouped = groupChannelsByProject(channels);
  const projectIds = Object.keys(grouped);
  console.log(`Grouped into ${projectIds.length} projects`);
  console.log('');

  // Get existing projects from DynamoDB
  console.log('Fetching existing projects from DynamoDB...');
  const existingProjects = await getExistingProjects();
  const existingProjectIds = new Set(existingProjects.map(p => p.project_id));
  console.log(`Found ${existingProjects.length} existing projects`);
  console.log('');

  // Process each project
  let updatedCount = 0;
  let skippedCount = 0;
  let notFoundCount = 0;

  for (const projectId of projectIds) {
    const { channels: projectChannels, crosspost_channels: crosspostChannels } = grouped[projectId];

    if (!existingProjectIds.has(projectId)) {
      console.log(`[SKIP] ${projectId} - Project not found in DynamoDB`);
      notFoundCount++;
      continue;
    }

    const channelCount = projectChannels.length;
    const crosspostCount = crosspostChannels.length;

    if (channelCount === 0 && crosspostCount === 0) {
      console.log(`[SKIP] ${projectId} - No channels defined`);
      skippedCount++;
      continue;
    }

    const updated = await updateProjectChannels(projectId, projectChannels, crosspostChannels);

    if (updated) {
      console.log(`[${isDryRun ? 'WOULD UPDATE' : 'UPDATED'}] ${projectId}`);
      console.log(`         Channels: ${channelCount}, Crosspost: ${crosspostCount}`);

      if (crosspostCount > 0) {
        for (const cp of crosspostChannels) {
          console.log(`         -> ${cp.workspace}/${cp.channel_name} (${cp.channel_id})`);
        }
      }
      updatedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Summary:');
  console.log(`  Updated: ${updatedCount}`);
  console.log(`  Skipped: ${skippedCount}`);
  console.log(`  Not found in DynamoDB: ${notFoundCount}`);
  console.log('='.repeat(60));

  if (isDryRun) {
    console.log('');
    console.log('This was a dry run. Run without --dry-run to apply changes.');
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
