#!/usr/bin/env node
/**
 * config.yml + channels.yml → DynamoDB (mana-projects)
 * マスタは config.yml / channels.yml。DynamoDBは読み取り専用キャッシュとして上書きする。
 *
 * Usage:
 *   node scripts/sync-config-to-dynamodb.js [--dry-run] [--config <path>] [--channels <path>] [--table <name>] [--region <aws-region>]
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const {
  parseConfigYaml,
  parseChannelsYaml,
  buildProjectRecords
} = require('./lib/project-config');

const DEFAULT_CONFIG = '/Users/ksato/workspace/config.yml';
const DEFAULT_CHANNELS = '/Users/ksato/workspace/_codex/common/meta/slack/channels.yml';
const DEFAULT_TABLE = process.env.PROJECTS_TABLE_NAME || 'mana-projects';
const DEFAULT_REGION = process.env.AWS_REGION || 'us-east-1';

function readFileSafe(p) {
  return fs.readFileSync(p, 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const getArg = (flag, fallback) => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    return fallback;
  };

  const configPath = getArg('--config', DEFAULT_CONFIG);
  const channelsPath = getArg('--channels', DEFAULT_CHANNELS);
  const tableName = getArg('--table', DEFAULT_TABLE);
  const region = getArg('--region', DEFAULT_REGION);

  console.log('=== sync-config-to-dynamodb ===');
  console.log(`config   : ${configPath}`);
  console.log(`channels : ${channelsPath}`);
  console.log(`table    : ${tableName}`);
  console.log(`region   : ${region}`);
  console.log(`mode     : ${isDryRun ? 'DRY-RUN' : 'APPLY'}`);
  console.log('');

  const configYml = readFileSafe(configPath);
  const channelsYml = readFileSafe(channelsPath);

  const cfg = parseConfigYaml(configYml);
  const channels = parseChannelsYaml(channelsYml);
  const { records, warnings } = buildProjectRecords(cfg, channels);

  if (warnings.length) {
    console.warn('Warnings:');
    warnings.forEach(w => console.warn(` - ${w}`));
    console.log('');
  }

  const client = new DynamoDBClient({ region });
  const doc = DynamoDBDocumentClient.from(client);

  let updated = 0;
  for (const rec of records) {
    const params = {
      TableName: tableName,
      Item: rec
    };
    if (isDryRun) {
      console.log(`[DRY-RUN] Put ${rec.project_id}`);
    } else {
      await doc.send(new PutCommand(params));
      console.log(`[OK] Put ${rec.project_id}`);
      updated += 1;
    }
  }

  console.log('');
  console.log('Summary');
  console.log(`  total records : ${records.length}`);
  console.log(`  updated       : ${isDryRun ? 0 : updated}`);
  console.log('');
  if (isDryRun) {
    console.log('Dry-run finished. Run without --dry-run to apply.');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
