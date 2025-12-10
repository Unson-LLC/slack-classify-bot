/**
 * Mastra Memory Semantic Recall設定のテスト
 *
 * Phase 3: Semantic Recall用ベクトルDB導入
 * - PgVector設定の検証
 * - Semantic Recall設定の検証
 * - resource-scoped検索のサポート確認
 *
 * t_wada式TDD: Red → Green → Refactor
 */

describe('SemanticRecallConfig', () => {
  let createSemanticMemory;
  let SEMANTIC_RECALL_DEFAULTS;

  beforeAll(() => {
    const config = require('../mastra/config/semantic-memory');
    createSemanticMemory = config.createSemanticMemory;
    SEMANTIC_RECALL_DEFAULTS = config.SEMANTIC_RECALL_DEFAULTS;
  });

  describe('デフォルト設定', () => {
    it('topKのデフォルト値は3', () => {
      expect(SEMANTIC_RECALL_DEFAULTS.topK).toBe(3);
    });

    it('messageRangeのデフォルト値は2', () => {
      expect(SEMANTIC_RECALL_DEFAULTS.messageRange).toBe(2);
    });

    it('scopeのデフォルト値はresource', () => {
      expect(SEMANTIC_RECALL_DEFAULTS.scope).toBe('resource');
    });
  });

  describe('createSemanticMemory', () => {
    it('connectionStringが必要', () => {
      expect(() => createSemanticMemory({})).toThrow();
    });

    it('有効なconnectionStringでMemoryオブジェクトを返す', () => {
      // モック環境では実際のDB接続はしない
      const mockConnectionString = 'postgresql://localhost:5432/test';

      // この関数は設定オブジェクトを返すのみ（実際のMemoryインスタンス化はしない）
      const config = createSemanticMemory({
        connectionString: mockConnectionString,
        skipValidation: true, // テスト用：接続検証をスキップ
      });

      expect(config).toBeDefined();
      expect(config.semanticRecall).toBeDefined();
      expect(config.semanticRecall.topK).toBe(3);
    });

    it('カスタムtopKを設定できる', () => {
      const config = createSemanticMemory({
        connectionString: 'postgresql://localhost:5432/test',
        skipValidation: true,
        topK: 5,
      });

      expect(config.semanticRecall.topK).toBe(5);
    });

    it('カスタムmessageRangeを設定できる', () => {
      const config = createSemanticMemory({
        connectionString: 'postgresql://localhost:5432/test',
        skipValidation: true,
        messageRange: 4,
      });

      expect(config.semanticRecall.messageRange).toBe(4);
    });

    it('scopeをthreadに変更できる', () => {
      const config = createSemanticMemory({
        connectionString: 'postgresql://localhost:5432/test',
        skipValidation: true,
        scope: 'thread',
      });

      expect(config.semanticRecall.scope).toBe('thread');
    });
  });

  describe('環境変数', () => {
    it('NEON_DATABASE_URLが設定されている場合はそれを使用', () => {
      const originalEnv = process.env.NEON_DATABASE_URL;
      process.env.NEON_DATABASE_URL = 'postgresql://neon.test/db';

      const { getConnectionString } = require('../mastra/config/semantic-memory');
      const connStr = getConnectionString();

      expect(connStr).toBe('postgresql://neon.test/db');

      // 環境変数を元に戻す
      if (originalEnv) {
        process.env.NEON_DATABASE_URL = originalEnv;
      } else {
        delete process.env.NEON_DATABASE_URL;
      }
    });
  });
});

describe('EmbedderConfig', () => {
  let EMBEDDER_OPTIONS;

  beforeAll(() => {
    const config = require('../mastra/config/semantic-memory');
    EMBEDDER_OPTIONS = config.EMBEDDER_OPTIONS;
  });

  it('fastembedがデフォルトの埋め込みモデル', () => {
    expect(EMBEDDER_OPTIONS.default).toBe('fastembed');
  });

  it('複数の埋め込みオプションが利用可能', () => {
    expect(EMBEDDER_OPTIONS.available).toContain('fastembed');
    expect(EMBEDDER_OPTIONS.available).toContain('openai');
  });
});
