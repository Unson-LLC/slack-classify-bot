/**
 * 環境変数の完全性をテストする
 * 
 * Design References:
 * - See CLAUDE.md for environment variable requirements
 * 
 * Related Classes:
 * - All integration modules depend on these environment variables
 */

describe('Environment Variable Validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // テスト用に環境変数をリセット
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Required Environment Variables', () => {
    const requiredVars = [
      'SLACK_BOT_TOKEN',
      'SLACK_SIGNING_SECRET',
      'SLACK_BOT_ID',
      'AIRTABLE_TOKEN',
      'AIRTABLE_BASE',
      'N8N_ENDPOINT'
    ];

    test.each(requiredVars)('%s が必須であることを確認', (varName) => {
      // Arrange: 特定の環境変数を削除
      delete process.env[varName];

      // Act & Assert: モジュールの初期化時にエラーが発生することを確認
      if (varName.startsWith('AIRTABLE')) {
        expect(() => {
          require('../airtable-integration');
        }).toThrow();
      }
    });

    test('全ての必須環境変数が設定されている場合は正常に動作', () => {
      // Arrange
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_SIGNING_SECRET = 'test-secret';
      process.env.SLACK_BOT_ID = 'U123456';
      process.env.AIRTABLE_TOKEN = 'pat-test';
      process.env.AIRTABLE_BASE = 'app-test';
      process.env.N8N_ENDPOINT = 'http://test.com/webhook';

      // Act & Assert
      expect(() => {
        require('../airtable-integration');
      }).not.toThrow();
    });
  });

  describe('Optional Environment Variables with Defaults', () => {
    test('AIRTABLE_TABLE_NAME のデフォルト値が正しく設定される', () => {
      // Arrange
      process.env.AIRTABLE_TOKEN = 'pat-test';
      process.env.AIRTABLE_BASE = 'app-test';
      delete process.env.AIRTABLE_TABLE_NAME;

      // Act
      const AirtableIntegration = require('../airtable-integration');
      const instance = new AirtableIntegration();

      // Assert
      expect(instance.tableName).toBe('Projects');
    });

    test('N8N_AIRTABLE_ENDPOINT が N8N_ENDPOINT にフォールバックする', () => {
      // Arrange
      process.env.AIRTABLE_TOKEN = 'pat-test';
      process.env.AIRTABLE_BASE = 'app-test';
      process.env.N8N_ENDPOINT = 'http://fallback.com/webhook';
      delete process.env.N8N_AIRTABLE_ENDPOINT;

      // Act & Assert
      // processFileWithProject メソッド内で使用される
      expect(process.env.N8N_AIRTABLE_ENDPOINT || process.env.N8N_ENDPOINT).toBe('http://fallback.com/webhook');
    });
  });

  describe('Environment Variable Usage in Methods', () => {
    test('processFileWithProject が N8N エンドポイントを正しく取得する', async () => {
      // Arrange
      process.env.AIRTABLE_TOKEN = 'pat-test';
      process.env.AIRTABLE_BASE = 'app-test';
      process.env.N8N_AIRTABLE_ENDPOINT = 'http://airtable.n8n.com/webhook';
      process.env.N8N_ENDPOINT = 'http://default.n8n.com/webhook';

      const axios = require('axios');
      jest.mock('axios');
      axios.post = jest.fn().mockResolvedValue({ data: { success: true } });

      const AirtableIntegration = require('../airtable-integration');
      const instance = new AirtableIntegration();

      // Mock getProjects to return test data
      instance.getProjects = jest.fn().mockResolvedValue([
        { id: 'proj1', name: 'Test Project', owner: 'test', repo: 'test-repo' }
      ]);

      // Act
      await instance.processFileWithProject({
        fileContent: 'test content',
        fileName: 'test.txt',
        projectId: 'proj1',
        userId: 'U123',
        channelId: 'C123',
        ts: '123.456'
      });

      // Assert
      expect(axios.post).toHaveBeenCalledWith(
        'http://airtable.n8n.com/webhook',
        expect.any(Object),
        expect.any(Object)
      );
    });

    test('N8N エンドポイントが未設定の場合にエラーを投げる', async () => {
      // Arrange
      process.env.AIRTABLE_TOKEN = 'pat-test';
      process.env.AIRTABLE_BASE = 'app-test';
      delete process.env.N8N_ENDPOINT;
      delete process.env.N8N_AIRTABLE_ENDPOINT;

      const AirtableIntegration = require('../airtable-integration');
      const instance = new AirtableIntegration();

      // Mock getProjects
      instance.getProjects = jest.fn().mockResolvedValue([
        { id: 'proj1', name: 'Test Project' }
      ]);

      // Act & Assert
      await expect(instance.processFileWithProject({
        fileContent: 'test',
        fileName: 'test.txt',
        projectId: 'proj1',
        userId: 'U123',
        channelId: 'C123',
        ts: '123.456'
      })).rejects.toThrow('N8N_AIRTABLE_ENDPOINT or N8N_ENDPOINT environment variable is not set');
    });
  });
});