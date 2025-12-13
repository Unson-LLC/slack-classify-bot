/**
 * meeting-task-registration.js
 * 議事録から抽出したタスクをAirtableに登録する
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { AirtableMCPClient } = require('./airtable-mcp-client');

// config.yml の読み込み
let configCache = null;

function loadConfig() {
  if (configCache) return configCache;

  // 環境変数でオーバーライド可能
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
 * プロジェクトIDに対応するAirtable Base情報を取得
 * @param {string} projectId
 * @returns {{ baseId: string, baseName: string } | null}
 */
function getAirtableBaseForProject(projectId) {
  const config = loadConfig();
  const project = config.projects?.find(p => p.id === projectId);

  if (!project || !project.airtable) {
    return null;
  }

  return {
    baseId: project.airtable.base_id,
    baseName: project.airtable.base_name
  };
}

/**
 * 期限文字列をDate型に変換
 * @param {string} deadline
 * @returns {Date | null}
 */
function parseDeadline(deadline) {
  if (!deadline || deadline.trim() === '') {
    return null;
  }

  const trimmed = deadline.trim();
  const now = new Date();
  const currentYear = now.getFullYear();

  // MM/DD形式
  const mmddMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (mmddMatch) {
    const month = parseInt(mmddMatch[1], 10) - 1;
    const day = parseInt(mmddMatch[2], 10);
    return new Date(currentYear, month, day);
  }

  // YYYY/MM/DD形式
  const yyyymmddMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (yyyymmddMatch) {
    const year = parseInt(yyyymmddMatch[1], 10);
    const month = parseInt(yyyymmddMatch[2], 10) - 1;
    const day = parseInt(yyyymmddMatch[3], 10);
    return new Date(year, month, day);
  }

  // 「来週」
  if (trimmed === '来週') {
    const date = new Date(now);
    date.setDate(date.getDate() + 7);
    return date;
  }

  // 「今週中」→ 今週金曜
  if (trimmed === '今週中') {
    const date = new Date(now);
    const dayOfWeek = date.getDay();
    const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
    date.setDate(date.getDate() + daysUntilFriday);
    return date;
  }

  // パースできない場合
  return null;
}

/**
 * 議事録から抽出したタスクをAirtableに登録
 * @param {Array<{ task: string, assignee: string, deadline: string }>} actions
 * @param {string} projectId
 * @param {string} meetingDate - YYYY-MM-DD形式
 * @returns {Promise<{ success: boolean, registered: number, failed: number, errors: Array }>}
 */
async function registerMeetingTasks(actions, projectId, meetingDate) {
  // 空配列チェック
  if (!actions || actions.length === 0) {
    return { success: true, registered: 0, failed: 0, errors: [] };
  }

  // Airtable Base情報を取得
  const baseInfo = getAirtableBaseForProject(projectId);
  if (!baseInfo) {
    return {
      success: false,
      registered: 0,
      failed: actions.length,
      error: `Airtable設定がプロジェクト ${projectId} に存在しません`,
      errors: []
    };
  }

  const client = new AirtableMCPClient();
  const results = {
    success: true,
    registered: 0,
    failed: 0,
    errors: []
  };

  // 各タスクを登録
  for (const action of actions) {
    try {
      const dueDate = parseDeadline(action.deadline);

      const fields = {
        title: action.task,
        assignee: action.assignee,
        status: 'pending',
        source: 'meeting',
        meeting_date: meetingDate
      };

      // due_dateがパースできた場合のみ設定
      if (dueDate) {
        fields.due_date = dueDate.toISOString().split('T')[0];
      }

      await client.createRecord(baseInfo.baseId, 'タスク', fields);
      results.registered++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        task: action.task,
        error: error.message
      });
    }
  }

  return results;
}

module.exports = {
  registerMeetingTasks,
  parseDeadline,
  getAirtableBaseForProject,
  clearConfigCache
};
