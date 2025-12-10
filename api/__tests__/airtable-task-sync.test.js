/**
 * airtable-task-sync.test.js
 * AirtableへのタスクSync機能のテスト（TDD: RED -> GREEN -> REFACTOR）
 *
 * Airtable tblTasks スキーマ:
 * - task_id: singleLineText
 * - project_id: singleLineText
 * - title: singleLineText
 * - assignee: singleSelect (田中, 佐藤, 鈴木, 山田, 未割当)
 * - status: singleSelect (pending, in_progress, completed)
 * - priority: singleSelect (low, medium, high)
 * - due_date: date
 * - dependencies: multilineText
 * - blockers: multilineText
 */

// S3 モックデータ
const mockMembersJson = {
  members: [
    { brainbase_name: '佐藤', slack_id: 'U07LNUP582X', owner_id: 'k.sato' },
    { brainbase_name: '田中', slack_id: 'U07M7H08HQM', owner_id: 't.tanaka' },
    { brainbase_name: '鈴木', slack_id: null, owner_id: 's.suzuki' },
    { brainbase_name: '山田', slack_id: null, owner_id: 'h.yamada' }
  ]
};

// S3 Client のモック - グローバルで定義
const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockS3Send
  })),
  GetObjectCommand: jest.fn()
}));

// Airtable MCP のモック
const mockMCPMethods = {
  createRecord: jest.fn(),
  updateRecords: jest.fn(),
  listRecords: jest.fn(),
  searchRecords: jest.fn()
};

jest.mock('../airtable-mcp-client', () => ({
  AirtableMCPClient: jest.fn().mockImplementation(() => mockMCPMethods)
}));

describe('AirtableTaskSync', () => {
  let AirtableTaskSync;
  let clearOwnerMappingCache;
  let loadOwnerMappingFromS3;
  let sync;

  beforeEach(() => {
    // モックをリセット
    jest.clearAllMocks();
    mockS3Send.mockReset();
    Object.values(mockMCPMethods).forEach(fn => fn.mockReset());

    // S3モックのデフォルト動作を設定
    mockS3Send.mockResolvedValue({
      Body: {
        transformToString: jest.fn().mockResolvedValue(JSON.stringify(mockMembersJson))
      }
    });

    // モジュールを新しく読み込み（キャッシュをクリアするため）
    jest.resetModules();

    // 再度モック設定を適用
    jest.doMock('@aws-sdk/client-s3', () => ({
      S3Client: jest.fn().mockImplementation(() => ({
        send: mockS3Send
      })),
      GetObjectCommand: jest.fn()
    }));

    jest.doMock('../airtable-mcp-client', () => ({
      AirtableMCPClient: jest.fn().mockImplementation(() => mockMCPMethods)
    }));

    // 再度モジュールを読み込む
    const module = require('../airtable-task-sync');
    AirtableTaskSync = module.AirtableTaskSync;
    clearOwnerMappingCache = module.clearOwnerMappingCache;
    loadOwnerMappingFromS3 = module.loadOwnerMappingFromS3;

    // キャッシュクリア
    clearOwnerMappingCache();

    // インスタンス作成
    sync = new AirtableTaskSync();
  });

  describe('mapGitHubTaskToAirtable', () => {
    it('GitHubタスクをAirtable形式に変換する', async () => {
      const githubTask = {
        task_id: 'T-2412-001',
        source_id: 'SLACK-2024-12-10-ABC123',
        title: 'テストタスク',
        project_id: 'salestailor',
        status: 'todo',
        owner: 'k.sato',
        priority: 'high',
        due: '2024-12-15',
        tags: ['slack', 'auto-import'],
        source: 'slack',
        channel_id: 'C12345',
        created_at: '2024-12-10T10:00:00Z'
      };

      const airtableRecord = await sync.mapGitHubTaskToAirtable(githubTask);

      expect(airtableRecord).toEqual({
        task_id: 'T-2412-001',
        project_id: 'salestailor',
        title: 'テストタスク',
        assignee: '佐藤',
        status: 'pending',
        priority: 'high',
        due_date: '2024-12-15',
        dependencies: null,
        blockers: null
      });
    });

    it('owner を assignee にマッピングする（brainbase_name形式）', async () => {
      const testCases = [
        { owner: 'k.sato', expected: '佐藤' },
        { owner: 't.tanaka', expected: '田中' },
        { owner: 's.suzuki', expected: '鈴木' },
        { owner: 'h.yamada', expected: '山田' },
        { owner: 'unknown', expected: '未割当' },
        { owner: null, expected: '未割当' }
      ];

      for (const { owner, expected } of testCases) {
        clearOwnerMappingCache(); // 各テストケースでキャッシュクリア
        const result = await sync.mapGitHubTaskToAirtable({ task_id: 'T-2412-001', title: 'Test', owner });
        expect(result.assignee).toBe(expected);
      }
    });

    it('owner を assignee にマッピングする（Slack User ID形式）', async () => {
      const testCases = [
        { owner: 'U07LNUP582X', expected: '佐藤' },  // k.satoのSlack ID
        { owner: 'U07M7H08HQM', expected: '田中' },  // t.tanakaのSlack ID
        { owner: 'UUNKNOWN123', expected: '未割当' } // 未知のSlack ID
      ];

      for (const { owner, expected } of testCases) {
        clearOwnerMappingCache(); // 各テストケースでキャッシュクリア
        const result = await sync.mapGitHubTaskToAirtable({ task_id: 'T-2412-001', title: 'Test', owner });
        expect(result.assignee).toBe(expected);
      }
    });

    it('status を Airtable 形式にマッピングする', async () => {
      const testCases = [
        { status: 'todo', expected: 'pending' },
        { status: 'pending', expected: 'pending' },
        { status: 'in-progress', expected: 'in_progress' },
        { status: 'done', expected: 'completed' },
        { status: 'completed', expected: 'completed' }
      ];

      for (const { status, expected } of testCases) {
        const result = await sync.mapGitHubTaskToAirtable({ task_id: 'T-2412-001', title: 'Test', status });
        expect(result.status).toBe(expected);
      }
    });

    it('due が null の場合は due_date も null', async () => {
      const result = await sync.mapGitHubTaskToAirtable({
        task_id: 'T-2412-001',
        title: 'Test',
        due: null
      });

      expect(result.due_date).toBeNull();
    });
  });

  describe('syncTaskToAirtable', () => {
    it('新規タスクをAirtableに作成する', async () => {
      // 既存レコードなし
      mockMCPMethods.searchRecords.mockResolvedValueOnce({ records: [] });
      // 新規作成成功
      mockMCPMethods.createRecord.mockResolvedValueOnce({
        id: 'recABC123',
        fields: { task_id: 'T-2412-001' }
      });

      const task = {
        task_id: 'T-2412-001',
        title: '新規タスク',
        project_id: 'general',
        status: 'todo',
        owner: 'k.sato',
        priority: 'medium'
      };

      const result = await sync.syncTaskToAirtable(task);

      expect(result.success).toBe(true);
      expect(result.airtableRecordId).toBe('recABC123');
      expect(result.operation).toBe('create');
      expect(mockMCPMethods.createRecord).toHaveBeenCalled();
    });

    it('既存タスクがある場合は更新する', async () => {
      // 既存レコードあり
      mockMCPMethods.searchRecords.mockResolvedValueOnce({
        records: [{ id: 'recEXIST123', fields: { task_id: 'T-2412-001' } }]
      });
      // 更新成功
      mockMCPMethods.updateRecords.mockResolvedValueOnce({
        records: [{ id: 'recEXIST123', fields: { task_id: 'T-2412-001' } }]
      });

      const task = {
        task_id: 'T-2412-001',
        title: '更新タスク',
        project_id: 'general',
        status: 'in-progress',
        owner: 'k.sato',
        priority: 'high'
      };

      const result = await sync.syncTaskToAirtable(task);

      expect(result.success).toBe(true);
      expect(result.airtableRecordId).toBe('recEXIST123');
      expect(result.operation).toBe('update');
      expect(mockMCPMethods.updateRecords).toHaveBeenCalled();
    });

    it('task_id が無い場合はエラー', async () => {
      const task = { title: 'No ID Task' };

      await expect(sync.syncTaskToAirtable(task)).rejects.toThrow('task_id is required');
    });

    it('Airtableエラー時は例外を投げる', async () => {
      mockMCPMethods.searchRecords.mockRejectedValueOnce(new Error('Airtable API Error'));

      const task = { task_id: 'T-2412-001', title: 'Test' };

      await expect(sync.syncTaskToAirtable(task)).rejects.toThrow('Airtable API Error');
    });
  });

  describe('findTaskByTaskId', () => {
    it('task_id でAirtableレコードを検索する', async () => {
      mockMCPMethods.searchRecords.mockResolvedValueOnce({
        records: [{ id: 'recABC123', fields: { task_id: 'T-2412-001', title: 'Found Task' } }]
      });

      const result = await sync.findTaskByTaskId('T-2412-001');

      expect(result).toEqual({
        id: 'recABC123',
        fields: { task_id: 'T-2412-001', title: 'Found Task' }
      });
    });

    it('見つからない場合は null を返す', async () => {
      mockMCPMethods.searchRecords.mockResolvedValueOnce({ records: [] });

      const result = await sync.findTaskByTaskId('T-2412-999');

      expect(result).toBeNull();
    });
  });

  describe('getOwnerNameMapping', () => {
    it('S3からオーナーIDと日本語名のマッピングを返す', async () => {
      const mapping = await sync.getOwnerNameMapping();

      expect(mapping['k.sato']).toBe('佐藤');
      expect(mapping['t.tanaka']).toBe('田中');
      expect(mapping['s.suzuki']).toBe('鈴木');
      expect(mapping['h.yamada']).toBe('山田');
    });

    it('Slack User IDと日本語名のマッピングも含む', async () => {
      const mapping = await sync.getOwnerNameMapping();

      expect(mapping['U07LNUP582X']).toBe('佐藤');
      expect(mapping['U07M7H08HQM']).toBe('田中');
    });

    it('S3エラー時は空のマッピングを返す', async () => {
      mockS3Send.mockRejectedValueOnce(new Error('S3 Error'));
      clearOwnerMappingCache();

      const mapping = await sync.getOwnerNameMapping();

      expect(mapping).toEqual({});
    });
  });

  describe('getStatusMapping', () => {
    it('GitHubステータスとAirtableステータスのマッピングを返す', () => {
      const mapping = sync.getStatusMapping();

      expect(mapping['todo']).toBe('pending');
      expect(mapping['pending']).toBe('pending');
      expect(mapping['in-progress']).toBe('in_progress');
      expect(mapping['done']).toBe('completed');
      expect(mapping['completed']).toBe('completed');
    });
  });

  describe('bulkSyncTasks', () => {
    it('複数タスクを一括同期する', async () => {
      // 既存レコードなし
      mockMCPMethods.searchRecords.mockResolvedValue({ records: [] });
      // 新規作成成功
      mockMCPMethods.createRecord
        .mockResolvedValueOnce({ id: 'rec1', fields: { task_id: 'T-2412-001' } })
        .mockResolvedValueOnce({ id: 'rec2', fields: { task_id: 'T-2412-002' } });

      const tasks = [
        { task_id: 'T-2412-001', title: 'Task 1', status: 'todo' },
        { task_id: 'T-2412-002', title: 'Task 2', status: 'todo' }
      ];

      const results = await sync.bulkSyncTasks(tasks);

      expect(results.successful).toBe(2);
      expect(results.failed).toBe(0);
      expect(results.results).toHaveLength(2);
    });

    it('一部失敗しても継続して処理する', async () => {
      mockMCPMethods.searchRecords.mockResolvedValue({ records: [] });
      mockMCPMethods.createRecord
        .mockResolvedValueOnce({ id: 'rec1', fields: { task_id: 'T-2412-001' } })
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce({ id: 'rec3', fields: { task_id: 'T-2412-003' } });

      const tasks = [
        { task_id: 'T-2412-001', title: 'Task 1', status: 'todo' },
        { task_id: 'T-2412-002', title: 'Task 2', status: 'todo' },
        { task_id: 'T-2412-003', title: 'Task 3', status: 'todo' }
      ];

      const results = await sync.bulkSyncTasks(tasks);

      expect(results.successful).toBe(2);
      expect(results.failed).toBe(1);
      expect(results.errors[0].task_id).toBe('T-2412-002');
    });
  });

  describe('loadOwnerMappingFromS3', () => {
    it('S3からマッピングをロードしてキャッシュする', async () => {
      clearOwnerMappingCache();

      // 1回目: S3から取得
      const mapping1 = await loadOwnerMappingFromS3();
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      expect(mapping1['k.sato']).toBe('佐藤');

      // 2回目: キャッシュから取得（S3は呼ばれない）
      const mapping2 = await loadOwnerMappingFromS3();
      expect(mockS3Send).toHaveBeenCalledTimes(1); // 呼び出し回数は増えない
      expect(mapping2['k.sato']).toBe('佐藤');
    });
  });
});
