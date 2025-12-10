/**
 * Mastra Memory Semantic Recall設定
 *
 * Phase 3: Semantic Recall用ベクトルDB（PgVector）
 * - Neon DB（サーバーレスPostgreSQL）との連携
 * - resource-scopedセマンティック検索
 * - fastembed埋め込みモデル
 */
// Semantic Recallのデフォルト設定
export const SEMANTIC_RECALL_DEFAULTS = {
    topK: 3, // 類似メッセージ3件を取得
    messageRange: 2, // 前後2メッセージを含める
    scope: 'resource', // ユーザー単位で全スレッド検索
};
// 埋め込みモデルオプション
export const EMBEDDER_OPTIONS = {
    default: 'fastembed',
    available: ['fastembed', 'openai'],
};
/**
 * 接続文字列を取得する
 */
export function getConnectionString() {
    return process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
}
/**
 * Semantic Memory設定を作成する
 *
 * 注意: この関数は設定オブジェクトを返すのみ。
 * 実際のMemoryインスタンス化は呼び出し側で行う。
 *
 * @throws {Error} connectionStringが未指定の場合
 */
export function createSemanticMemory(options = {}) {
    const { connectionString, skipValidation = false, topK = SEMANTIC_RECALL_DEFAULTS.topK, messageRange = SEMANTIC_RECALL_DEFAULTS.messageRange, scope = SEMANTIC_RECALL_DEFAULTS.scope, } = options;
    // 接続文字列の検証
    if (!connectionString && !skipValidation) {
        throw new Error('connectionString is required. Set NEON_DATABASE_URL or DATABASE_URL environment variable.');
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
//# sourceMappingURL=semantic-memory.js.map