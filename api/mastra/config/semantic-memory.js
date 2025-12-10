/**
 * Mastra Memory Semantic Recall設定
 *
 * Phase 3: Semantic Recall用ベクトルDB（PgVector）
 * - Neon DB（サーバーレスPostgreSQL）との連携
 * - resource-scopedセマンティック検索
 * - fastembed埋め込みモデル
 */

// Semantic Recallのデフォルト設定
const SEMANTIC_RECALL_DEFAULTS = {
  topK: 3, // 類似メッセージ3件を取得
  messageRange: 2, // 前後2メッセージを含める
  scope: 'resource', // ユーザー単位で全スレッド検索
};

// 埋め込みモデルオプション
const EMBEDDER_OPTIONS = {
  default: 'fastembed',
  available: ['fastembed', 'openai'],
};

/**
 * 接続文字列を取得する
 * @returns {string|undefined} PostgreSQL接続文字列
 */
function getConnectionString() {
  return process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
}

/**
 * Semantic Memory設定を作成する
 *
 * 注意: この関数は設定オブジェクトを返すのみ。
 * 実際のMemoryインスタンス化は呼び出し側で行う。
 *
 * @param {Object} options - 設定オプション
 * @param {string} options.connectionString - PostgreSQL接続文字列（必須）
 * @param {boolean} [options.skipValidation=false] - 接続検証をスキップ（テスト用）
 * @param {number} [options.topK=3] - 取得する類似メッセージ数
 * @param {number} [options.messageRange=2] - 前後に含めるメッセージ数
 * @param {'resource'|'thread'} [options.scope='resource'] - 検索スコープ
 * @returns {Object} Semantic Recall設定オブジェクト
 * @throws {Error} connectionStringが未指定の場合
 */
function createSemanticMemory(options = {}) {
  const {
    connectionString,
    skipValidation = false,
    topK = SEMANTIC_RECALL_DEFAULTS.topK,
    messageRange = SEMANTIC_RECALL_DEFAULTS.messageRange,
    scope = SEMANTIC_RECALL_DEFAULTS.scope,
  } = options;

  // 接続文字列の検証
  if (!connectionString && !skipValidation) {
    throw new Error(
      'connectionString is required. Set NEON_DATABASE_URL or DATABASE_URL environment variable.',
    );
  }

  // 設定オブジェクトを返す
  return {
    connectionString: connectionString || 'postgresql://localhost:5432/test',
    semanticRecall: {
      topK,
      messageRange,
      scope,
    },
    embedder: EMBEDDER_OPTIONS.default,
  };
}

module.exports = {
  SEMANTIC_RECALL_DEFAULTS,
  EMBEDDER_OPTIONS,
  getConnectionString,
  createSemanticMemory,
};
