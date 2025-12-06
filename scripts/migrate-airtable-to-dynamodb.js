#!/usr/bin/env node
/**
 * Migrate Airtable CSV data to DynamoDB
 *
 * Usage:
 *   AWS_PROFILE=k.sato NODE_PATH=./node_modules node ../scripts/migrate-airtable-to-dynamodb.js
 */

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);
const tableName = 'mana-projects';

// Parse CSV (simple parser)
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/^﻿/, '')); // Remove BOM

  return lines.slice(1).map(line => {
    const values = [];
    let currentValue = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(currentValue.trim());
        currentValue = '';
      } else {
        currentValue += char;
      }
    }
    values.push(currentValue.trim());

    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = values[idx] || '';
    });
    return obj;
  });
}

async function migrateData() {
  console.log('📊 Migrating Airtable data to DynamoDB...\n');

  // Parse CSVs
  const projectsCSV = parseCSV(path.join(__dirname, '../project_id-Grid view.csv'));
  const channelsCSV = parseCSV(path.join(__dirname, '../slack_channels-Grid view.csv'));

  console.log(`Found ${projectsCSV.length} projects and ${channelsCSV.length} channels\n`);

  // Create channel name -> channel info mapping
  const channelMap = new Map();
  channelsCSV.forEach(ch => {
    if (ch.channel_name && ch.channel_id) {
      channelMap.set(ch.channel_name, {
        channel_id: ch.channel_id,
        channel_name: ch.channel_name
      });
    }
  });

  // Migrate projects
  let successCount = 0;
  let errorCount = 0;

  for (const proj of projectsCSV) {
    try {
      // Parse slack_channels (comma-separated channel names)
      const channelNames = proj.slack_channels
        ? proj.slack_channels.split(',').map(n => n.trim()).filter(n => n)
        : [];

      // Convert channel names to channel objects
      const slackChannels = channelNames
        .map(name => channelMap.get(name))
        .filter(ch => ch); // Remove undefined

      const project = {
        project_id: `proj_${proj.Name}`,
        name: proj.Name,
        owner: proj.owner || 'Unson-LLC',
        repo: proj.repo || 'ai_food',
        path_prefix: proj.path_prefix || 'meetings/',
        branch: proj.branch || 'main',
        emoji: proj.emoji || '📁',
        description: proj.description || '',
        slack_channels: slackChannels,
        is_active: true,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000)
      };

      // Optional fields from Airtable
      if (proj.asana_project_id) {
        project.asana_project_id = proj.asana_project_id;
      }
      if (proj.airtable_base_id) {
        project.airtable_base_id = proj.airtable_base_id;
      }

      const params = {
        TableName: tableName,
        Item: project
      };

      await docClient.send(new PutCommand(params));
      console.log(`✅ Migrated: ${project.name} (${slackChannels.length} channels)`);
      successCount++;

    } catch (error) {
      console.error(`❌ Failed to migrate ${proj.Name}:`, error.message);
      errorCount++;
    }
  }

  console.log(`\n✨ Migration complete!`);
  console.log(`   Success: ${successCount}`);
  console.log(`   Errors: ${errorCount}`);
}

// Run migration
migrateData().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
