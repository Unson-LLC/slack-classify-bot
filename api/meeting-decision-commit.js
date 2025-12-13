/**
 * meeting-decision-commit.js
 * 議事録から抽出した決定事項をプロジェクトGitHubの_codex/decisions/にコミットする
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const axios = require('axios');

// config.yml の読み込み
let configCache = null;

function loadConfig() {
  if (configCache) return configCache;

  const envConfigPath = process.env.BRAINBASE_CONFIG_PATH;

  const configPaths = [
    envConfigPath,
    path.join(__dirname, '../../config.yml'),
    path.join(__dirname, '../../../config.yml'),
  ].filter(Boolean);

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      configCache = yaml.load(content);
      return configCache;
    }
  }

  return { projects: [] };
}

// テスト用: キャッシュクリア
function clearConfigCache() {
  configCache = null;
}

/**
 * プロジェクトIDに対応するGitHubリポジトリ情報を取得
 * @param {string} projectId
 * @returns {{ owner: string, repo: string, branch: string } | null}
 */
function getGitHubRepoForProject(projectId) {
  const config = loadConfig();
  const project = config.projects?.find(p => p.id === projectId);

  if (!project || !project.github) {
    return null;
  }

  return {
    owner: project.github.owner,
    repo: project.github.repo,
    branch: project.github.branch || 'main'
  };
}

/**
 * 決定事項の内容からslugを生成
 * @param {string} content
 * @returns {string}
 */
function generateDecisionSlug(content) {
  if (!content || content.trim() === '') {
    return 'decision';
  }

  // 日本語の内容を英語のslugに変換する簡易マッピング
  const mappings = {
    '価格': 'pricing',
    '月額': 'monthly',
    '5万円': '50k',
    '万円': 'k',
    'API': 'api',
    'REST': 'rest',
    'GraphQL': 'graphql',
    '設計': 'design',
    'ローンチ': 'launch',
    '予定': 'schedule',
  };

  let slug = content.trim().toLowerCase();

  // マッピングを適用
  for (const [jp, en] of Object.entries(mappings)) {
    slug = slug.replace(new RegExp(jp, 'gi'), en);
  }

  // 特殊文字をハイフンに変換
  slug = slug
    .replace(/[：:]/g, '-')
    .replace(/[\s　]/g, '-')
    .replace(/[^\w\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // 30文字で切り詰め
  if (slug.length > 30) {
    slug = slug.substring(0, 30).replace(/-$/, '');
  }

  return slug || 'decision';
}

/**
 * 決定事項からMarkdownを生成
 * @param {{ content: string, context?: string, date: string }} decision
 * @param {string} projectName
 * @param {string} meetingDate
 * @returns {string}
 */
function generateDecisionMarkdown(decision, projectName, meetingDate) {
  const lines = [
    `# ${decision.content}`,
    '',
    `- 決定日: ${decision.date || meetingDate}`,
    `- ステータス: 決定`,
    `- ソース: ${meetingDate} 会議`,
    '',
    '## 背景',
    '',
    decision.context || '（会議での議論に基づく決定）',
    '',
  ];

  return lines.join('\n');
}

/**
 * 決定事項をGitHubリポジトリにコミット
 * @param {Array<{ content: string, context?: string, date: string }>} decisions
 * @param {string} projectId
 * @param {string} meetingDate - YYYY-MM-DD形式
 * @returns {Promise<{ success: boolean, committed: number, failed: number, errors: Array }>}
 */
async function commitDecisions(decisions, projectId, meetingDate) {
  // 空配列チェック
  if (!decisions || decisions.length === 0) {
    return { success: true, committed: 0, failed: 0, errors: [] };
  }

  // GitHub設定を取得
  const repoInfo = getGitHubRepoForProject(projectId);
  if (!repoInfo) {
    return {
      success: false,
      committed: 0,
      failed: decisions.length,
      error: `GitHub設定がプロジェクト ${projectId} に存在しません`,
      errors: []
    };
  }

  const token = process.env.GITHUB_TOKEN;
  const baseUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents`;
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };

  const results = {
    success: true,
    committed: 0,
    failed: 0,
    errors: []
  };

  // 各決定事項をコミット
  for (const decision of decisions) {
    try {
      const slug = generateDecisionSlug(decision.content);
      const fileName = `${meetingDate}_${slug}.md`;
      const filePath = `_codex/decisions/${fileName}`;
      const fileUrl = `${baseUrl}/${filePath}`;

      // Markdown生成
      const markdown = generateDecisionMarkdown(decision, projectId, meetingDate);
      const content = Buffer.from(markdown).toString('base64');

      // 既存ファイルの確認
      let existingSha = null;
      try {
        const existingFile = await axios.get(fileUrl, { headers });
        existingSha = existingFile.data.sha;
      } catch (error) {
        // 404の場合は新規作成
        if (error.response?.status !== 404) {
          throw error;
        }
      }

      // コミット
      const payload = {
        message: `docs: 決定事項を追加 (${meetingDate} 会議)`,
        content,
        branch: repoInfo.branch
      };

      if (existingSha) {
        payload.sha = existingSha;
      }

      await axios.put(fileUrl, payload, { headers });
      results.committed++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        content: decision.content,
        error: error.message
      });
    }
  }

  return results;
}

module.exports = {
  commitDecisions,
  generateDecisionMarkdown,
  generateDecisionSlug,
  getGitHubRepoForProject,
  clearConfigCache
};
