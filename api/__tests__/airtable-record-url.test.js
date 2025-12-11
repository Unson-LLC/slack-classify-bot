/**
 * airtable-record-url.test.js
 * AirtableレコードURL生成機能のテスト（TDD: RED -> GREEN -> REFACTOR）
 *
 * 目的: タスク登録後のSlack表示で、GitHubではなくAirtableのURLを表示する
 *
 * Airtable URL形式:
 * https://airtable.com/{baseId}/{tableId}/{recordId}
 */

describe('Airtable Record URL', () => {
  describe('buildAirtableRecordUrl', () => {
    let buildAirtableRecordUrl;

    beforeEach(() => {
      // モジュールを読み込み
      const { buildAirtableRecordUrl: fn } = require('../airtable-mcp-client');
      buildAirtableRecordUrl = fn;
    });

    it('baseId, tableId, recordIdからAirtable URLを生成する', () => {
      const url = buildAirtableRecordUrl({
        baseId: 'app9oeZUNRWZyaSdb',
        tableId: 'tbl7m4SDujDG1ULR1',
        recordId: 'recABC123'
      });

      expect(url).toBe('https://airtable.com/app9oeZUNRWZyaSdb/tbl7m4SDujDG1ULR1/recABC123');
    });

    it('recordIdがない場合はテーブルURLを返す', () => {
      const url = buildAirtableRecordUrl({
        baseId: 'app9oeZUNRWZyaSdb',
        tableId: 'tbl7m4SDujDG1ULR1',
        recordId: null
      });

      expect(url).toBe('https://airtable.com/app9oeZUNRWZyaSdb/tbl7m4SDujDG1ULR1');
    });

    it('環境変数のデフォルト値を使用できる', () => {
      const url = buildAirtableRecordUrl({
        recordId: 'recXYZ789'
      });

      // デフォルトのbaseId, tableIdが使われる
      expect(url).toMatch(/^https:\/\/airtable\.com\/app[a-zA-Z0-9]+\/tbl[a-zA-Z0-9]+\/recXYZ789$/);
    });
  });

  describe('AirtableMCPClient.createRecord with URL', () => {
    let AirtableMCPClient;
    let buildAirtableRecordUrl;
    let mockAirtableCreate;

    beforeEach(() => {
      jest.resetModules();

      // Airtable SDKのモック
      mockAirtableCreate = jest.fn((records, callback) => {
        callback(null, [{
          id: 'recNEW123',
          fields: { task_id: 'T-2412-001', title: 'Test Task' }
        }]);
      });

      // Airtable SDKを正しくモック（base関数を返す）
      const mockTable = {
        create: mockAirtableCreate,
        select: jest.fn().mockReturnThis(),
        eachPage: jest.fn()
      };

      jest.doMock('airtable', () => {
        return jest.fn().mockImplementation(() => ({
          base: jest.fn().mockReturnValue(
            jest.fn().mockReturnValue(mockTable)  // base(tableId) が table を返す
          )
        }));
      });

      const module = require('../airtable-mcp-client');
      AirtableMCPClient = module.AirtableMCPClient;
      buildAirtableRecordUrl = module.buildAirtableRecordUrl;
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('createRecordの結果にrecordUrlが含まれる', async () => {
      const client = new AirtableMCPClient({
        baseId: 'app9oeZUNRWZyaSdb',
        tableId: 'tbl7m4SDujDG1ULR1'
      });

      const result = await client.createRecord({
        task_id: 'T-2412-001',
        title: 'Test Task'
      });

      expect(result.id).toBe('recNEW123');
      expect(result.recordUrl).toBe('https://airtable.com/app9oeZUNRWZyaSdb/tbl7m4SDujDG1ULR1/recNEW123');
    });
  });

  describe('AirtableTaskSync.syncTaskToAirtable with URL', () => {
    let AirtableTaskSync;
    let mockMCPMethods;
    let mockS3Send;

    beforeEach(() => {
      jest.resetModules();

      // S3モック
      mockS3Send = jest.fn().mockResolvedValue({
        Body: {
          transformToString: jest.fn().mockResolvedValue(JSON.stringify({
            members: [
              { brainbase_name: '佐藤', slack_id: 'U07LNUP582X', owner_id: 'k.sato' }
            ]
          }))
        }
      });

      jest.doMock('@aws-sdk/client-s3', () => ({
        S3Client: jest.fn().mockImplementation(() => ({
          send: mockS3Send
        })),
        GetObjectCommand: jest.fn()
      }));

      // Airtable MCPモック
      mockMCPMethods = {
        createRecord: jest.fn().mockResolvedValue({
          id: 'recNEW456',
          fields: { task_id: 'T-2412-002' },
          recordUrl: 'https://airtable.com/appXXX/tblYYY/recNEW456'
        }),
        updateRecords: jest.fn(),
        listRecords: jest.fn(),
        searchRecords: jest.fn().mockResolvedValue({ records: [] })
      };

      jest.doMock('../airtable-mcp-client', () => ({
        AirtableMCPClient: jest.fn().mockImplementation(() => mockMCPMethods),
        buildAirtableRecordUrl: jest.fn().mockImplementation(({ baseId, tableId, recordId }) =>
          `https://airtable.com/${baseId || 'appDefault'}/${tableId || 'tblDefault'}/${recordId}`
        )
      }));

      const module = require('../airtable-task-sync');
      AirtableTaskSync = module.AirtableTaskSync;
      module.clearOwnerMappingCache();
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('syncTaskToAirtableの結果にrecordUrlが含まれる', async () => {
      const sync = new AirtableTaskSync();

      const result = await sync.syncTaskToAirtable({
        task_id: 'T-2412-002',
        title: 'New Task',
        status: 'todo',
        owner: 'k.sato'
      });

      expect(result.success).toBe(true);
      expect(result.airtableRecordId).toBe('recNEW456');
      expect(result.recordUrl).toBe('https://airtable.com/appXXX/tblYYY/recNEW456');
    });
  });

  describe('GitHubIntegration.appendTask with Airtable URL', () => {
    let GitHubIntegration;
    let mockAxios;
    let mockAirtableSync;

    beforeEach(() => {
      jest.resetModules();

      // 環境変数設定
      process.env.GITHUB_TOKEN = 'test-token';

      // axiosモック
      mockAxios = {
        get: jest.fn(),
        put: jest.fn()
      };

      jest.doMock('axios', () => mockAxios);

      // TaskIdGeneratorモック
      jest.doMock('../task-id-generator', () => ({
        TaskIdGenerator: jest.fn().mockImplementation(() => ({
          generateTaskId: jest.fn().mockResolvedValue('T-2412-003'),
          generateSourceId: jest.fn().mockResolvedValue('SLACK-2024-12-11-ABC123')
        }))
      }));

      // AirtableTaskSyncモック
      mockAirtableSync = {
        syncTaskToAirtable: jest.fn().mockResolvedValue({
          success: true,
          airtableRecordId: 'recTASK789',
          operation: 'create',
          recordUrl: 'https://airtable.com/app9oeZUNRWZyaSdb/tbl7m4SDujDG1ULR1/recTASK789'
        })
      };

      jest.doMock('../airtable-task-sync', () => ({
        AirtableTaskSync: jest.fn().mockImplementation(() => mockAirtableSync)
      }));

      // GitHubのAPIレスポンスモック
      mockAxios.get.mockResolvedValue({
        data: {
          content: Buffer.from('# Tasks\n\n## Active\n\n').toString('base64'),
          sha: 'abc123'
        }
      });
      mockAxios.put.mockResolvedValue({
        data: {
          commit: { html_url: 'https://github.com/sintariran/brainbase/commit/xyz' },
          content: { html_url: 'https://github.com/sintariran/brainbase/blob/main/_tasks/index.md' }
        }
      });

      GitHubIntegration = require('../github-integration');
    });

    afterEach(() => {
      jest.clearAllMocks();
      delete process.env.GITHUB_TOKEN;
    });

    it('appendTaskの結果にairtableRecordUrlが含まれる', async () => {
      const github = new GitHubIntegration('test-token', {
        airtableSync: mockAirtableSync
      });

      const result = await github.appendTask({
        title: 'Test Task',
        project_id: 'zeims',
        assignee: '佐藤',
        assignee_slack_id: 'U07LNUP582X'
      }, 'https://slack.com/test');

      expect(result.success).toBe(true);
      expect(result.airtableRecordUrl).toBe('https://airtable.com/app9oeZUNRWZyaSdb/tbl7m4SDujDG1ULR1/recTASK789');
    });

    it('Airtable同期が失敗してもairtableRecordUrlはnull', async () => {
      mockAirtableSync.syncTaskToAirtable.mockResolvedValue({
        success: false,
        error: 'API Error'
      });

      const github = new GitHubIntegration('test-token', {
        airtableSync: mockAirtableSync
      });

      const result = await github.appendTask({
        title: 'Test Task',
        project_id: 'zeims',
        assignee: '佐藤',
        assignee_slack_id: 'U07LNUP582X'
      }, 'https://slack.com/test');

      expect(result.success).toBe(true);
      expect(result.airtableRecordUrl).toBeNull();
    });
  });
});
