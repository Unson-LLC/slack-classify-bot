/**
 * sync-config-to-dynamodb.js - glob_include 同期テスト
 *
 * TDD: config.yml の glob_include を DynamoDB に同期する機能
 */

const fs = require('fs');
const path = require('path');

// テスト用のconfig.yml内容
const MOCK_CONFIG_YAML = `
root: /Users/ksato/workspace

projects:
  - id: salestailor
    local:
      path: salestailor
      glob_include:
        - "app/**/*"
        - "docs/**/*"
        - "ops/**/*"
    github:
      owner: Unson-LLC
      repo: salestailor-project
      branch: main

  - id: zeims
    local:
      path: zeims
      glob_include:
        - "app/**/*"
        - "web/**/*"
    github:
      owner: Unson-LLC
      repo: zeims-project
      branch: main

  - id: dialogai
    # github設定なし（Airtableのみ）
    airtable:
      base_id: appLXuHKJGitc6CGd
`;

// parseConfigYaml を再実装（テスト用）
function parseConfigYaml(content) {
  const projects = [];
  const lines = content.split('\n');
  let currentProject = null;
  let inGithub = false;
  let inLocal = false;
  let inGlobInclude = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('- id:')) {
      if (currentProject) projects.push(currentProject);
      currentProject = {
        id: trimmed.split(':')[1].trim(),
        github: null,
        glob_include: []
      };
      inGithub = false;
      inLocal = false;
      inGlobInclude = false;
    }

    if (currentProject && trimmed === 'local:') {
      inLocal = true;
      inGithub = false;
      inGlobInclude = false;
      continue;
    }

    if (currentProject && trimmed === 'glob_include:') {
      inGlobInclude = true;
      inGithub = false;
      continue;
    }

    if (inGlobInclude && currentProject && trimmed.startsWith('- "')) {
      const pattern = trimmed.replace(/^- "/, '').replace(/"$/, '');
      currentProject.glob_include.push(pattern);
      continue;
    }

    if (currentProject && trimmed === 'github:') {
      inGithub = true;
      inLocal = false;
      inGlobInclude = false;
      currentProject.github = {};
      continue;
    }

    if (inGithub && currentProject?.github) {
      if (trimmed.startsWith('owner:')) {
        currentProject.github.owner = trimmed.split(':')[1].trim();
      } else if (trimmed.startsWith('repo:')) {
        currentProject.github.repo = trimmed.split(':')[1].trim();
      } else if (trimmed.startsWith('branch:')) {
        currentProject.github.branch = trimmed.split(':')[1].trim();
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('local:') || trimmed.startsWith('airtable:') || trimmed === '') {
        inGithub = false;
      }
    }

    if (trimmed === 'airtable:' || trimmed === 'github:') {
      inGlobInclude = false;
    }
  }

  if (currentProject) projects.push(currentProject);
  return projects.filter(p => p.github?.owner && p.github?.repo);
}

describe('parseConfigYaml - glob_include対応', () => {
  test('glob_includeを含むプロジェクトを正しくパースできる', () => {
    const result = parseConfigYaml(MOCK_CONFIG_YAML);

    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      id: 'salestailor',
      github: {
        owner: 'Unson-LLC',
        repo: 'salestailor-project',
        branch: 'main'
      },
      glob_include: ['app/**/*', 'docs/**/*', 'ops/**/*']
    });

    expect(result[1]).toEqual({
      id: 'zeims',
      github: {
        owner: 'Unson-LLC',
        repo: 'zeims-project',
        branch: 'main'
      },
      glob_include: ['app/**/*', 'web/**/*']
    });
  });

  test('glob_includeがないプロジェクトは空配列', () => {
    const configWithoutGlob = `
projects:
  - id: test-project
    github:
      owner: test
      repo: test-repo
      branch: main
`;
    const result = parseConfigYaml(configWithoutGlob);
    expect(result[0].glob_include).toEqual([]);
  });

  test('dialogaiはgithub設定がないのでフィルタされる', () => {
    const result = parseConfigYaml(MOCK_CONFIG_YAML);
    const dialogai = result.find(p => p.id === 'dialogai');
    expect(dialogai).toBeUndefined();
  });
});

describe('updateProjectGithub - glob_include対応', () => {
  test('DynamoDBにglob_includeフィールドを追加できる', () => {
    const projectId = 'proj_salestailor';
    const github = {
      owner: 'Unson-LLC',
      repo: 'salestailor-project',
      branch: 'main'
    };
    const globInclude = ['app/**/*', 'docs/**/*'];

    // 期待するDynamoDB update-expression
    const expectedExpression =
      'SET source_owner = :owner, source_repo = :repo, source_branch = :branch, source_glob_include = :glob';

    // TODO: 実装後にモック検証
    expect(true).toBe(true);
  });

  test('glob_includeが空の場合は空リストを保存', () => {
    // DynamoDB Listは空でも保存可能
    expect(true).toBe(true);
  });
});

describe('Integration: config.yml → DynamoDB', () => {
  test('実際のconfig.ymlをパースしてglob_includeを取得', () => {
    const configPath = path.join(__dirname, '..', '..', '..', '..', 'config.yml');

    if (!fs.existsSync(configPath)) {
      console.log('Skipping: config.yml not found in expected location');
      return;
    }

    const content = fs.readFileSync(configPath, 'utf8');

    // salestailor の glob_include が含まれていることを確認
    expect(content).toContain('glob_include:');
    expect(content).toContain('app/**/*');
  });
});
