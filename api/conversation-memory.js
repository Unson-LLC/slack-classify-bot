/**
 * 会話メモリ - プロジェクト×ユーザー単位の会話履歴管理
 *
 * Phase 1: インメモリ実装
 * 将来的にDynamoDB/S3に移行可能な設計
 */

class ConversationMemory {
  /**
   * @param {Object} options - 設定オプション
   * @param {number} [options.maxMessages=100] - 最大保持メッセージ数
   * @param {number} [options.ttlMs] - TTL（ミリ秒）。未設定の場合は期限なし
   */
  constructor(options = {}) {
    this.maxMessages = options.maxMessages ?? 100;
    this.ttlMs = options.ttlMs ?? null;
    // キー: `${projectId}:${userId}`
    this.store = new Map();
  }

  /**
   * キーを生成
   * @private
   */
  _key(projectId, userId) {
    return `${projectId}:${userId}`;
  }

  /**
   * メッセージを保存
   * @param {string} projectId - プロジェクトID
   * @param {string} userId - ユーザーID（Slack ID）
   * @param {Object} message - メッセージ
   * @param {string} message.role - 'user' | 'assistant'
   * @param {string} message.content - メッセージ内容
   */
  async saveMessage(projectId, userId, message) {
    const key = this._key(projectId, userId);
    let history = this.store.get(key) || [];

    history.push({
      ...message,
      timestamp: new Date().toISOString()
    });

    // maxMessages制限: 超過分を削除
    if (history.length > this.maxMessages) {
      history = history.slice(-this.maxMessages);
    }

    this.store.set(key, history);
  }

  /**
   * 履歴を取得
   * @param {string} projectId - プロジェクトID
   * @param {string} userId - ユーザーID
   * @param {number} [limit] - 取得件数（指定時は最新N件）
   * @returns {Array} メッセージ履歴
   */
  async getHistory(projectId, userId, limit) {
    const key = this._key(projectId, userId);
    let history = this.store.get(key) || [];

    // TTLフィルタリング
    if (this.ttlMs) {
      const now = Date.now();
      history = history.filter(msg => {
        const msgTime = new Date(msg.timestamp).getTime();
        return now - msgTime < this.ttlMs;
      });
      // フィルタ後の履歴を保存（クリーンアップ）
      if (history.length > 0) {
        this.store.set(key, history);
      } else {
        this.store.delete(key);
      }
    }

    if (limit && history.length > limit) {
      return history.slice(-limit);
    }

    return history;
  }

  /**
   * 履歴をクリア
   * @param {string} projectId - プロジェクトID
   * @param {string} userId - ユーザーID
   */
  async clearHistory(projectId, userId) {
    const key = this._key(projectId, userId);
    this.store.delete(key);
  }

  /**
   * LLM用のメッセージ形式に変換
   * @param {string} projectId - プロジェクトID
   * @param {string} userId - ユーザーID
   * @param {number} [limit] - 取得件数
   * @returns {Array} LLM用メッセージ配列
   */
  async formatForLLM(projectId, userId, limit) {
    const history = await this.getHistory(projectId, userId, limit);

    return history.map(({ role, content }) => ({
      role,
      content
    }));
  }

  /**
   * メモリの統計情報を取得
   * @returns {Object} 統計情報
   */
  getStats() {
    let totalMessages = 0;

    for (const history of this.store.values()) {
      totalMessages += history.length;
    }

    return {
      totalConversations: this.store.size,
      totalMessages
    };
  }
}

// シングルトンインスタンス
let instance = null;

/**
 * グローバルなConversationMemoryインスタンスを取得
 * @param {Object} [options] - 初回のみ適用される設定
 * @returns {ConversationMemory}
 */
function getInstance(options) {
  if (!instance) {
    instance = new ConversationMemory(options || {
      maxMessages: 50,
      ttlMs: 24 * 60 * 60 * 1000  // 24時間
    });
  }
  return instance;
}

/**
 * シングルトンインスタンスをリセット（テスト用）
 */
function resetInstance() {
  instance = null;
}

module.exports = ConversationMemory;
module.exports.getInstance = getInstance;
module.exports.resetInstance = resetInstance;
