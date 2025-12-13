const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeProjectId,
  deriveName,
  parseConfigYaml,
  parseChannelsYaml,
  buildProjectRecords
} = require('../scripts/lib/project-config');

test('normalizeProjectId adds prefix when missing', () => {
  assert.equal(normalizeProjectId('salestailor'), 'proj_salestailor');
  assert.equal(normalizeProjectId('proj_foo'), 'proj_foo');
});

test('deriveName generates human readable name', () => {
  assert.equal(deriveName('proj_salestailor'), 'Salestailor');
  assert.equal(deriveName('proj_ai-wolf'), 'Ai Wolf');
});

test('parseConfigYaml extracts root and projects', () => {
  const yml = `
root: /Users/ksato/workspace
projects:
  - id: salestailor
    github:
      owner: foo
      repo: bar
  `;
  const parsed = parseConfigYaml(yml);
  assert.equal(parsed.root, '/Users/ksato/workspace');
  assert.equal(parsed.projects.length, 1);
  assert.equal(parsed.projects[0].id, 'salestailor');
});

test('parseChannelsYaml returns channels array', () => {
  const yml = `
channels:
  - channel_id: C123
    channel_name: eng
    project_id: proj_salestailor
    workspace: salestailor
`;
  const list = parseChannelsYaml(yml);
  assert.equal(list.length, 1);
  assert.equal(list[0].channel_id, 'C123');
});

test('buildProjectRecords merges config and channels, warns missing config', () => {
  const configYml = `
projects:
  - id: salestailor
    github:
      owner: Foo
      repo: salestailor-repo
    airtable:
      base_id: base123
      base_name: SalesTailor
    local:
      path: salestailor
      glob_include:
        - app/**
`;
  const channelsYml = `
channels:
  - channel_id: C1
    channel_name: eng
    workspace: salestailor
    project_id: proj_salestailor
  - channel_id: C2
    channel_name: other
    workspace: unson
    project_id: proj_missing
`;

  const cfg = parseConfigYaml(configYml);
  const ch = parseChannelsYaml(channelsYml);
  const { records, warnings } = buildProjectRecords(cfg, ch);

  const main = records.find(r => r.project_id === 'proj_salestailor');
  assert(main, 'main project exists');
  assert.equal(main.slack_channels.length, 1);
  assert.equal(main.github_owner, 'Foo');
  assert.equal(main.airtable_base_id, 'base123');

  const missing = records.find(r => r.project_id === 'proj_missing');
  assert(missing, 'missing project surfaced');
  assert.equal(missing.is_active, false);
  assert.equal(warnings.length, 1);
});
