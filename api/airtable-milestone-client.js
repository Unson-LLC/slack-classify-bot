/**
 * airtable-milestone-client.js
 * Airtable マイルストーン・スプリント管理クライアント
 *
 * 正本: Airtable（各プロジェクトBase）
 * - マイルストーン: 90日単位の目標
 * - スプリント: 週単位の計画・振り返り
 * - タスク: 具体的なやること
 */

const Airtable = require('airtable');

// 環境変数名の互換性
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;

// プロジェクト別Base ID マッピング
const PROJECT_BASE_MAPPING = {
  'salestailor': 'app8uhkD8PcnxPvVx',
  'zeims': 'appg1DeWomuFuYnri',
  'dialogai': 'appLXuHKJGitc6CGd',
  'eve-topi': 'appsticSxr1PQsZam',
  'hp-sales': 'appXvthGPhEO1ZEOv',
  'smartfront': 'appXLSkrAKrykJJQm',
  'aitle': 'appvZv4ybVDsBXtvC',
  'mywa': 'appJeMbMQcz507E9g',
  'senrigan': 'appDd7TdJf1t23PCm',
};

// テーブル名（各Baseで共通）
const TABLE_NAMES = {
  milestones: 'マイルストーン',
  sprints: 'スプリント',
  tasks: 'タスク',
};

/**
 * AirtableレコードURLを生成
 */
function buildAirtableUrl(baseId, tableId, recordId = null) {
  if (recordId) {
    return `https://airtable.com/${baseId}/${tableId}/${recordId}`;
  }
  return `https://airtable.com/${baseId}/${tableId}`;
}

class AirtableMilestoneClient {
  constructor(projectId) {
    if (!projectId) {
      throw new Error('projectId is required');
    }

    this.projectId = projectId.toLowerCase();
    this.baseId = PROJECT_BASE_MAPPING[this.projectId];

    if (!this.baseId) {
      throw new Error(`Unknown project: ${projectId}. Available: ${Object.keys(PROJECT_BASE_MAPPING).join(', ')}`);
    }

    this.base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(this.baseId);
  }

  /**
   * テーブルへのアクセサを取得
   */
  _table(tableName) {
    return this.base(TABLE_NAMES[tableName] || tableName);
  }

  // ========================================
  // マイルストーン操作
  // ========================================

  /**
   * 全マイルストーンを取得
   * @param {Object} options - フィルタオプション
   * @returns {Promise<Array>} マイルストーン一覧
   */
  async getMilestones(options = {}) {
    const records = [];
    const selectOptions = {
      maxRecords: options.maxRecords || 100,
    };

    if (options.status) {
      selectOptions.filterByFormula = `{ステータス} = "${options.status}"`;
    }

    if (options.sort) {
      selectOptions.sort = options.sort;
    } else {
      selectOptions.sort = [{ field: '期限', direction: 'asc' }];
    }

    return new Promise((resolve, reject) => {
      this._table('milestones')
        .select(selectOptions)
        .eachPage(
          (pageRecords, fetchNextPage) => {
            records.push(...pageRecords.map(r => ({
              id: r.id,
              name: r.fields['名前'],
              description: r.fields['説明'],
              deadline: r.fields['期限'],
              status: r.fields['ステータス'],
              progress: r.fields['進捗率'],
              blocker: r.fields['ブロッカー'],
              assignee: r.fields['担当者'],
              url: buildAirtableUrl(this.baseId, 'milestones', r.id),
              _raw: r.fields,
            })));
            fetchNextPage();
          },
          (err) => {
            if (err) reject(err);
            else resolve(records);
          }
        );
    });
  }

  /**
   * 進行中のマイルストーンを取得
   */
  async getActiveMilestones() {
    return this.getMilestones({ status: '進行中' });
  }

  /**
   * マイルストーンを作成
   */
  async createMilestone(data) {
    const fields = {
      '名前': data.name,
      '説明': data.description,
      '期限': data.deadline,
      'ステータス': data.status || '未着手',
      '進捗率': data.progress || 0,
      '担当者': data.assignee,
    };

    if (data.blocker) {
      fields['ブロッカー'] = data.blocker;
    }

    return new Promise((resolve, reject) => {
      this._table('milestones').create([{ fields }], (err, records) => {
        if (err) reject(err);
        else {
          const record = records[0];
          resolve({
            id: record.id,
            ...record.fields,
            url: buildAirtableUrl(this.baseId, 'milestones', record.id),
          });
        }
      });
    });
  }

  /**
   * マイルストーンを更新
   */
  async updateMilestone(recordId, data) {
    const fields = {};

    if (data.name) fields['名前'] = data.name;
    if (data.description) fields['説明'] = data.description;
    if (data.deadline) fields['期限'] = data.deadline;
    if (data.status) fields['ステータス'] = data.status;
    if (data.progress !== undefined) fields['進捗率'] = data.progress;
    if (data.blocker !== undefined) fields['ブロッカー'] = data.blocker;
    if (data.assignee) fields['担当者'] = data.assignee;

    return new Promise((resolve, reject) => {
      this._table('milestones').update([{ id: recordId, fields }], (err, records) => {
        if (err) reject(err);
        else resolve({ id: records[0].id, ...records[0].fields });
      });
    });
  }

  // ========================================
  // スプリント操作
  // ========================================

  /**
   * 全スプリントを取得
   */
  async getSprints(options = {}) {
    const records = [];
    const selectOptions = {
      maxRecords: options.maxRecords || 100,
    };

    if (options.sort) {
      selectOptions.sort = options.sort;
    } else {
      selectOptions.sort = [{ field: '開始日', direction: 'desc' }];
    }

    return new Promise((resolve, reject) => {
      this._table('sprints')
        .select(selectOptions)
        .eachPage(
          (pageRecords, fetchNextPage) => {
            records.push(...pageRecords.map(r => ({
              id: r.id,
              period: r.fields['期間'],
              startDate: r.fields['開始日'],
              endDate: r.fields['終了日'],
              goal: r.fields['目標'],
              milestone: r.fields['マイルストーン'],
              dailyLog: r.fields['日次ログ'],
              completedItems: r.fields['完了事項'],
              blocker: r.fields['ブロッカー'],
              learnings: r.fields['学び'],
              nextWeek: r.fields['来週の予定'],
              url: buildAirtableUrl(this.baseId, 'sprints', r.id),
              _raw: r.fields,
            })));
            fetchNextPage();
          },
          (err) => {
            if (err) reject(err);
            else resolve(records);
          }
        );
    });
  }

  /**
   * 現在のスプリントを取得（今日の日付を含むスプリント）
   */
  async getCurrentSprint() {
    const today = new Date().toISOString().split('T')[0];

    return new Promise((resolve, reject) => {
      this._table('sprints')
        .select({
          filterByFormula: `AND({開始日} <= "${today}", {終了日} >= "${today}")`,
          maxRecords: 1,
        })
        .firstPage((err, records) => {
          if (err) reject(err);
          else if (records.length === 0) resolve(null);
          else {
            const r = records[0];
            resolve({
              id: r.id,
              period: r.fields['期間'],
              startDate: r.fields['開始日'],
              endDate: r.fields['終了日'],
              goal: r.fields['目標'],
              milestone: r.fields['マイルストーン'],
              dailyLog: r.fields['日次ログ'],
              completedItems: r.fields['完了事項'],
              blocker: r.fields['ブロッカー'],
              learnings: r.fields['学び'],
              url: buildAirtableUrl(this.baseId, 'sprints', r.id),
              _raw: r.fields,
            });
          }
        });
    });
  }

  /**
   * スプリントを作成
   */
  async createSprint(data) {
    const fields = {
      '期間': data.period,
      '開始日': data.startDate,
      '終了日': data.endDate,
      '目標': data.goal,
    };

    if (data.milestoneIds) {
      fields['マイルストーン'] = data.milestoneIds;
    }

    return new Promise((resolve, reject) => {
      this._table('sprints').create([{ fields }], (err, records) => {
        if (err) reject(err);
        else {
          const record = records[0];
          resolve({
            id: record.id,
            ...record.fields,
            url: buildAirtableUrl(this.baseId, 'sprints', record.id),
          });
        }
      });
    });
  }

  /**
   * スプリントの日次ログを追記
   * @param {string} sprintId - スプリントレコードID
   * @param {string} logEntry - 追記するログ（マークダウン形式）
   */
  async appendDailyLog(sprintId, logEntry) {
    // 現在のログを取得
    return new Promise((resolve, reject) => {
      this._table('sprints').find(sprintId, (err, record) => {
        if (err) {
          reject(err);
          return;
        }

        const currentLog = record.fields['日次ログ'] || '';
        const newLog = currentLog ? `${currentLog}\n\n${logEntry}` : logEntry;

        this._table('sprints').update([{
          id: sprintId,
          fields: { '日次ログ': newLog },
        }], (updateErr, records) => {
          if (updateErr) reject(updateErr);
          else resolve({ id: records[0].id, dailyLog: records[0].fields['日次ログ'] });
        });
      });
    });
  }

  /**
   * スプリントを更新（振り返り用）
   */
  async updateSprintRetrospective(sprintId, data) {
    const fields = {};

    if (data.completedItems) fields['完了事項'] = data.completedItems;
    if (data.blocker) fields['ブロッカー'] = data.blocker;
    if (data.learnings) fields['学び'] = data.learnings;
    if (data.nextWeek) fields['来週の予定'] = data.nextWeek;

    return new Promise((resolve, reject) => {
      this._table('sprints').update([{ id: sprintId, fields }], (err, records) => {
        if (err) reject(err);
        else resolve({ id: records[0].id, ...records[0].fields });
      });
    });
  }

  // ========================================
  // 複合操作
  // ========================================

  /**
   * プロジェクト進捗サマリーを取得
   * @returns {Promise<Object>} サマリー情報
   */
  async getProjectSummary() {
    const [milestones, currentSprint] = await Promise.all([
      this.getMilestones(),
      this.getCurrentSprint(),
    ]);

    const activeMilestones = milestones.filter(m => m.status === '進行中');
    const completedMilestones = milestones.filter(m => m.status === '完了');
    const blockedMilestones = milestones.filter(m => m.blocker);

    return {
      projectId: this.projectId,
      baseId: this.baseId,
      milestones: {
        total: milestones.length,
        active: activeMilestones.length,
        completed: completedMilestones.length,
        blocked: blockedMilestones.length,
        list: activeMilestones,
      },
      currentSprint,
      blockers: blockedMilestones.map(m => ({
        milestone: m.name,
        blocker: m.blocker,
      })),
    };
  }

  /**
   * 次週のスプリントを自動生成
   * @param {Object} options - オプション
   * @returns {Promise<Object>} 作成されたスプリント
   */
  async createNextWeekSprint(options = {}) {
    const today = new Date();
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + (8 - today.getDay()) % 7);

    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);

    const weekNumber = getWeekNumber(nextMonday);
    const period = `W${weekNumber} (${formatDate(nextMonday)}-${formatDate(nextSunday)})`;

    return this.createSprint({
      period,
      startDate: nextMonday.toISOString().split('T')[0],
      endDate: nextSunday.toISOString().split('T')[0],
      goal: options.goal || '',
      milestoneIds: options.milestoneIds,
    });
  }
}

// ========================================
// ユーティリティ
// ========================================

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function formatDate(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
}

module.exports = {
  AirtableMilestoneClient,
  PROJECT_BASE_MAPPING,
  TABLE_NAMES,
  buildAirtableUrl,
};
