/**
 * airtable-task-sync.js
 * GitHub タスクを Airtable に同期するモジュール
 *
 * 同期方向: GitHub → Airtable（単方向）
 *
 * フィールドマッピング:
 * - task_id: T-YYMM-NNN 形式
 * - project_id: そのまま
 * - title: そのまま
 * - owner → assignee: k.sato → 佐藤（S3 members.jsonから動的取得）
 * - status: todo → pending, in-progress → in_progress, done → completed
 * - priority: そのまま
 * - due → due_date: そのまま
 */

const { AirtableMCPClient } = require('./airtable-mcp-client');
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const BEDROCK_REGION = "us-east-1";
const BRAINBASE_CONTEXT_BUCKET = "brainbase-context-593793022993";

// キャッシュ（5分間有効）
let cachedOwnerMapping = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * S3からmembers.jsonを取得してowner_id/slack_id → brainbase_nameのマッピングを構築
 * @returns {Promise<Object>} マッピングオブジェクト
 */
async function loadOwnerMappingFromS3() {
  // キャッシュが有効ならそれを返す
  if (cachedOwnerMapping && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL_MS)) {
    return cachedOwnerMapping;
  }

  const s3Client = new S3Client({ region: BEDROCK_REGION });

  try {
    const command = new GetObjectCommand({
      Bucket: BRAINBASE_CONTEXT_BUCKET,
      Key: 'members.json'
    });

    const response = await s3Client.send(command);
    const jsonStr = await response.Body.transformToString();
    const data = JSON.parse(jsonStr);

    const mapping = {};
    for (const member of data.members) {
      // owner_id（k.sato形式）でマッピング
      if (member.owner_id) {
        mapping[member.owner_id] = member.brainbase_name;
      }
      // slack_id（U07LNUP582X形式）でもマッピング
      if (member.slack_id) {
        mapping[member.slack_id] = member.brainbase_name;
      }
    }

    cachedOwnerMapping = mapping;
    cacheTimestamp = Date.now();

    console.log(`Loaded ${Object.keys(mapping).length} owner mappings from S3`);
    return mapping;
  } catch (error) {
    console.warn('Failed to load owner mapping from S3:', error.message);
    // フォールバック: 空のマッピングを返す
    return {};
  }
}

/**
 * キャッシュをクリア（テスト用）
 */
function clearOwnerMappingCache() {
  cachedOwnerMapping = null;
  cacheTimestamp = null;
}

// GitHub status → Airtable status のマッピング
const STATUS_MAPPING = {
  'todo': 'pending',
  'pending': 'pending',
  'in-progress': 'in_progress',
  'done': 'completed',
  'completed': 'completed'
};

class AirtableTaskSync {
  constructor(options = {}) {
    this.mcpClient = options.mcpClient || new AirtableMCPClient(options);
  }

  /**
   * オーナーID → 日本語名のマッピングを取得（S3から動的取得）
   * @returns {Promise<Object>} マッピングオブジェクト
   */
  async getOwnerNameMapping() {
    return await loadOwnerMappingFromS3();
  }

  /**
   * ステータスマッピングを取得
   * @returns {Object} マッピングオブジェクト
   */
  getStatusMapping() {
    return { ...STATUS_MAPPING };
  }

  /**
   * オーナーIDから日本語名を取得（S3から動的取得）
   * @param {string} ownerId - オーナーID（例: k.sato または U07LNUP582X）
   * @returns {Promise<string>} 日本語名（例: 佐藤）、マッチしない場合は「未割当」
   */
  async mapOwnerToAssignee(ownerId) {
    if (!ownerId) {
      return '未割当';
    }
    const mapping = await loadOwnerMappingFromS3();
    return mapping[ownerId] || '未割当';
  }

  /**
   * GitHubステータスをAirtableステータスに変換
   * @param {string} status - GitHubステータス
   * @returns {string} Airtableステータス
   */
  mapStatus(status) {
    if (!status) {
      return 'pending';
    }
    return STATUS_MAPPING[status] || 'pending';
  }

  /**
   * GitHubタスクをAirtable形式に変換（非同期：S3からマッピング取得）
   * @param {Object} githubTask - GitHubタスク
   * @returns {Promise<Object>} Airtableレコードのfields
   */
  async mapGitHubTaskToAirtable(githubTask) {
    return {
      task_id: githubTask.task_id,
      project_id: githubTask.project_id || null,
      title: githubTask.title,
      assignee: await this.mapOwnerToAssignee(githubTask.owner),
      status: this.mapStatus(githubTask.status),
      priority: githubTask.priority || null,
      due_date: githubTask.due || null,
      dependencies: githubTask.dependencies || null,
      blockers: githubTask.blockers || null
    };
  }

  /**
   * task_id で Airtable レコードを検索
   * @param {string} taskId - タスクID
   * @returns {Promise<Object|null>} レコード（見つからない場合はnull）
   */
  async findTaskByTaskId(taskId) {
    const result = await this.mcpClient.searchRecords(taskId);
    if (result.records && result.records.length > 0) {
      return result.records[0];
    }
    return null;
  }

  /**
   * タスクをAirtableに同期（新規作成または更新）
   * @param {Object} task - タスクデータ
   * @returns {Promise<Object>} 同期結果
   */
  async syncTaskToAirtable(task) {
    if (!task.task_id) {
      throw new Error('task_id is required');
    }

    // 既存レコードをチェック
    const existingRecord = await this.findTaskByTaskId(task.task_id);
    const airtableFields = await this.mapGitHubTaskToAirtable(task);

    if (existingRecord) {
      // 更新
      const result = await this.mcpClient.updateRecords([
        { id: existingRecord.id, fields: airtableFields }
      ]);
      return {
        success: true,
        airtableRecordId: existingRecord.id,
        operation: 'update',
        recordUrl: result.recordUrl || (result.records && result.records[0]?.recordUrl),
        result
      };
    } else {
      // 新規作成
      const result = await this.mcpClient.createRecord(airtableFields);
      return {
        success: true,
        airtableRecordId: result.id,
        operation: 'create',
        recordUrl: result.recordUrl,
        result
      };
    }
  }

  /**
   * 複数タスクを一括同期
   * @param {Array<Object>} tasks - タスク配列
   * @returns {Promise<Object>} 同期結果サマリー
   */
  async bulkSyncTasks(tasks) {
    const results = [];
    const errors = [];
    let successful = 0;
    let failed = 0;

    for (const task of tasks) {
      try {
        const result = await this.syncTaskToAirtable(task);
        results.push({ task_id: task.task_id, ...result });
        successful++;
      } catch (error) {
        errors.push({
          task_id: task.task_id,
          error: error.message
        });
        failed++;
      }
    }

    return {
      successful,
      failed,
      results,
      errors
    };
  }
}

module.exports = { AirtableTaskSync, clearOwnerMappingCache, loadOwnerMappingFromS3 };
