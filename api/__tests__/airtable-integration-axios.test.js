/**
 * AirtableIntegration の axios 関連のテスト
 * 
 * Design References:
 * - processFileWithProject メソッドの外部API呼び出しをテスト
 * 
 * Related Classes:
 * - airtable-integration.js: テスト対象
 */

jest.mock('axios');

describe('AirtableIntegration - processFileWithProject axios tests', () => {
  let AirtableIntegration;
  let airtableIntegration;
  let axios;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // axios モジュールを取得
    axios = require('axios');

    // 環境変数を設定
    process.env.AIRTABLE_TOKEN = 'pat-test';
    process.env.AIRTABLE_BASE = 'app-test';
    process.env.N8N_ENDPOINT = 'http://test-n8n.com/webhook';
    process.env.N8N_AIRTABLE_ENDPOINT = 'http://test-n8n.com/webhook/airtable';

    // モジュールを require
    AirtableIntegration = require('../airtable-integration');
    airtableIntegration = new AirtableIntegration();
  });

  afterEach(() => {
    delete process.env.AIRTABLE_TOKEN;
    delete process.env.AIRTABLE_BASE;
    delete process.env.N8N_ENDPOINT;
    delete process.env.N8N_AIRTABLE_ENDPOINT;
  });

  describe('processFileWithProject メソッド', () => {
    const mockParams = {
      fileContent: 'Test file content',
      fileName: 'test.txt',
      projectId: 'proj123',
      userId: 'U12345',
      channelId: 'C12345',
      ts: '1234567890.123'
    };

    beforeEach(() => {
      // getProjects のモック
      axios.get = jest.fn().mockResolvedValue({
        data: {
          records: [
            {
              id: 'proj123',
              fields: {
                Name: 'Test Project',
                owner: 'test-owner',
                repo: 'test-repo',
                path_prefix: 'docs/',
                branch: 'main'
              }
            }
          ]
        }
      });
    });

    test('正常にファイルを処理してn8nに送信する', async () => {
      // Arrange
      axios.post = jest.fn().mockResolvedValue({
        data: { success: true, message: 'File processed' }
      });

      // Act
      const result = await airtableIntegration.processFileWithProject(mockParams);

      // Assert
      expect(result.success).toBe(true);
      expect(result.project.name).toBe('Test Project');
      expect(result.n8nResponse).toEqual({ success: true, message: 'File processed' });

      // axios.post が正しいエンドポイントで呼ばれたことを確認
      expect(axios.post).toHaveBeenCalledWith(
        'http://test-n8n.com/webhook/airtable',
        expect.objectContaining({
          type: 'file_processing',
          file: expect.objectContaining({
            name: 'test.txt',
            content: 'Test file content'
          }),
          project: expect.objectContaining({
            id: 'proj123',
            name: 'Test Project'
          })
        }),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        })
      );
    });

    test('N8N_AIRTABLE_ENDPOINT がない場合は N8N_ENDPOINT にフォールバック', async () => {
      // Arrange
      delete process.env.N8N_AIRTABLE_ENDPOINT;
      axios.post = jest.fn().mockResolvedValue({ data: { success: true } });

      // Act
      await airtableIntegration.processFileWithProject(mockParams);

      // Assert
      expect(axios.post).toHaveBeenCalledWith(
        'http://test-n8n.com/webhook', // フォールバック先
        expect.any(Object),
        expect.any(Object)
      );
    });

    test('N8N エンドポイントが設定されていない場合エラーを投げる', async () => {
      // Arrange
      delete process.env.N8N_ENDPOINT;
      delete process.env.N8N_AIRTABLE_ENDPOINT;

      // Act & Assert
      await expect(airtableIntegration.processFileWithProject(mockParams))
        .rejects.toThrow('N8N_AIRTABLE_ENDPOINT or N8N_ENDPOINT environment variable is not set');
    });

    test('プロジェクトが見つからない場合エラーを返す', async () => {
      // Arrange
      axios.get = jest.fn().mockResolvedValue({
        data: { records: [] } // 空の結果
      });

      // Act
      const result = await airtableIntegration.processFileWithProject(mockParams);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Project with ID proj123 not found');
    });

    test('n8n への送信が失敗した場合エラーを処理する', async () => {
      // Arrange
      axios.post = jest.fn().mockRejectedValue(new Error('Network error'));

      // Act
      const result = await airtableIntegration.processFileWithProject(mockParams);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(result.project).toBeNull();
    });

    test('axios タイムアウトが正しく設定される', async () => {
      // Arrange
      axios.post = jest.fn().mockResolvedValue({ data: { success: true } });

      // Act
      await airtableIntegration.processFileWithProject(mockParams);

      // Assert
      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          timeout: 30000 // 30秒
        })
      );
    });
  });

  describe('sendFileUpload メソッド', () => {
    const mockSlackEvent = {
      type: 'file_share',
      file_id: 'F12345',
      channel: 'C12345'
    };

    test('N8N_ENDPOINT が未設定の場合エラーを投げる', async () => {
      // Arrange
      delete process.env.N8N_ENDPOINT;

      // Act & Assert
      await expect(airtableIntegration.sendFileUpload(mockSlackEvent))
        .rejects.toThrow('N8N_ENDPOINT environment variable is not set');
    });

    test('正常にイベントを送信する', async () => {
      // Arrange
      axios.post = jest.fn().mockResolvedValue({ data: { processed: true } });

      // Act
      const result = await airtableIntegration.sendFileUpload(mockSlackEvent);

      // Assert
      expect(result).toEqual({ processed: true });
      expect(axios.post).toHaveBeenCalledWith(
        'http://test-n8n.com/webhook',
        expect.objectContaining({
          type: 'event_callback',
          event: mockSlackEvent
        }),
        expect.any(Object)
      );
    });
  });
});