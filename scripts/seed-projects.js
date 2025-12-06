#!/usr/bin/env node
/**
 * Seed sample projects data into DynamoDB
 *
 * Usage:
 *   node scripts/seed-projects.js
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);
const tableName = 'mana-projects';

// Sample projects data
const sampleProjects = [
  {
    project_id: 'proj_slack_classify_bot',
    name: 'mana',
    owner: 'Unson-LLC',
    repo: 'mana',
    path_prefix: 'docs/meetings/',
    description: 'Slack bot for message classification and file processing',
    emoji: '🤖',
    branch: 'main',
    slack_channels: [
      { channel_id: 'C07LL657U1Z', channel_name: 'general' }
    ],
    is_active: true,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000)
  },
  {
    project_id: 'proj_test_project',
    name: 'Test Project',
    owner: 'Unson-LLC',
    repo: 'test-repo',
    path_prefix: 'meetings/',
    description: 'Test project for development',
    emoji: '🧪',
    branch: 'main',
    slack_channels: [
      { channel_id: 'C07LL657U1Z', channel_name: 'general' }
    ],
    is_active: true,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000)
  }
];

async function seedProjects() {
  console.log(`📊 Seeding ${sampleProjects.length} projects into ${tableName}...\n`);

  for (const project of sampleProjects) {
    try {
      const params = {
        TableName: tableName,
        Item: project
      };

      await docClient.send(new PutCommand(params));
      console.log(`✅ Seeded project: ${project.name} (${project.project_id})`);

    } catch (error) {
      console.error(`❌ Failed to seed project ${project.name}:`, error.message);
    }
  }

  console.log(`\n✨ Seeding complete!`);
}

// Run the seed script
seedProjects().catch(error => {
  console.error('❌ Seed script failed:', error);
  process.exit(1);
});
