/**
 * meeting-task-registration.test.js
 * 議事録から抽出したタスクをAirtableに登録する機能のテスト
 * TDD: RED -> GREEN -> REFACTOR
 *
 * 機能仕様:
 * - 議事録生成時に抽出されたactions配列を受け取る
 * - プロジェクトIDに対応するAirtable Baseを特定
 * - Tasksテーブルに登録
 * - 担当者名をAirtableのassigneeフィールド形式に変換
 * - 期限をDate型に変換
 */

// モックの設定
const mockAirtableMethods = {
  createRecord: jest.fn(),
  listRecords: jest.fn(),
};

jest.mock('../airtable-mcp-client', () => ({
  AirtableMCPClient: jest.fn().mockImplementation(() => mockAirtableMethods)
}));

// config.yml のモック
const mockConfig = {
  projects: [
    {
      id: 'salestailor',
      airtable: { base_id: 'app8uhkD8PcnxPvVx', base_name: 'SalesTailor' }
    },
    {
      id: 'zeims',
      airtable: { base_id: 'appg1DeWomuFuYnri', base_name: 'Zeims' }
    },
    {
      id: 'tech-knight',
      // airtable設定なし
    }
  ]
};

jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue(JSON.stringify(mockConfig)),
  existsSync: jest.fn().mockReturnValue(true)
}));

jest.mock('js-yaml', () => ({
  load: jest.fn().mockImplementation((content) => JSON.parse(content))
}));

describe('MeetingTaskRegistration', () => {
  let registerMeetingTasks;
  let parseDeadline;
  let getAirtableBaseForProject;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAirtableMethods.createRecord.mockReset();
    mockAirtableMethods.listRecords.mockReset();

    // モジュールをリセットして再読み込み
    jest.resetModules();

    // 実装モジュールを読み込む（まだ存在しないのでエラーになる = RED）
    try {
      const module = require('../meeting-task-registration');
      registerMeetingTasks = module.registerMeetingTasks;
      parseDeadline = module.parseDeadline;
      getAirtableBaseForProject = module.getAirtableBaseForProject;
    } catch (e) {
      // RED状態: モジュールが存在しない
    }
  });

  describe('parseDeadline', () => {
    it('MM/DD形式の期限を今年のDate型に変換する', () => {
      // Given
      const deadline = '12/20';
      const currentYear = new Date().getFullYear();

      // When
      const result = parseDeadline(deadline);

      // Then
      expect(result).toBeInstanceOf(Date);
      expect(result.getMonth()).toBe(11); // 12月 = 11
      expect(result.getDate()).toBe(20);
      expect(result.getFullYear()).toBe(currentYear);
    });

    it('YYYY/MM/DD形式の期限をDate型に変換する', () => {
      const result = parseDeadline('2025/01/15');
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(0); // 1月 = 0
      expect(result.getDate()).toBe(15);
    });

    it('「来週」を7日後に変換する', () => {
      const result = parseDeadline('来週');
      const expected = new Date();
      expected.setDate(expected.getDate() + 7);

      expect(result.getDate()).toBe(expected.getDate());
    });

    it('「今週中」を今週金曜に変換する', () => {
      const result = parseDeadline('今週中');
      expect(result).toBeInstanceOf(Date);
      // 金曜日 = 5
      expect(result.getDay()).toBe(5);
    });

    it('パースできない場合はnullを返す', () => {
      const result = parseDeadline('未定');
      expect(result).toBeNull();
    });

    it('空文字の場合はnullを返す', () => {
      const result = parseDeadline('');
      expect(result).toBeNull();
    });
  });

  describe('getAirtableBaseForProject', () => {
    it('プロジェクトIDに対応するAirtable Base IDを返す', () => {
      const result = getAirtableBaseForProject('salestailor');
      expect(result).toEqual({
        baseId: 'app8uhkD8PcnxPvVx',
        baseName: 'SalesTailor'
      });
    });

    it('Airtable設定がないプロジェクトはnullを返す', () => {
      const result = getAirtableBaseForProject('tech-knight');
      expect(result).toBeNull();
    });

    it('存在しないプロジェクトはnullを返す', () => {
      const result = getAirtableBaseForProject('unknown-project');
      expect(result).toBeNull();
    });
  });

  describe('registerMeetingTasks', () => {
    it('actionsをAirtable Tasksテーブルに登録する', async () => {
      // Given
      const actions = [
        { task: 'LP作成', assignee: '佐藤 圭吾', deadline: '12/20' },
        { task: '価格表更新', assignee: '山田', deadline: '12/18' }
      ];
      const projectId = 'salestailor';
      const meetingDate = '2025-12-14';

      mockAirtableMethods.createRecord.mockResolvedValue({ id: 'rec123' });

      // When
      const result = await registerMeetingTasks(actions, projectId, meetingDate);

      // Then
      expect(mockAirtableMethods.createRecord).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.registered).toBe(2);
    });

    it('Airtable登録時に正しいフィールドを設定する', async () => {
      // Given
      const actions = [
        { task: 'LP作成', assignee: '佐藤 圭吾', deadline: '12/20' }
      ];
      const projectId = 'salestailor';
      const meetingDate = '2025-12-14';

      mockAirtableMethods.createRecord.mockResolvedValue({ id: 'rec123' });

      // When
      await registerMeetingTasks(actions, projectId, meetingDate);

      // Then
      expect(mockAirtableMethods.createRecord).toHaveBeenCalledWith(
        'app8uhkD8PcnxPvVx',
        'タスク',
        expect.objectContaining({
          title: 'LP作成',
          assignee: '佐藤 圭吾',
          status: 'pending',
          source: 'meeting',
          meeting_date: meetingDate
        })
      );
    });

    it('空のactions配列の場合は何もしない', async () => {
      const result = await registerMeetingTasks([], 'salestailor', '2025-12-14');

      expect(mockAirtableMethods.createRecord).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.registered).toBe(0);
    });

    it('Airtable設定がないプロジェクトはエラーを返す', async () => {
      const actions = [{ task: 'テスト', assignee: '佐藤', deadline: '12/20' }];

      const result = await registerMeetingTasks(actions, 'tech-knight', '2025-12-14');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Airtable');
    });

    it('一部の登録が失敗しても他は継続する', async () => {
      const actions = [
        { task: 'タスク1', assignee: '佐藤', deadline: '12/20' },
        { task: 'タスク2', assignee: '山田', deadline: '12/21' },
        { task: 'タスク3', assignee: '田中', deadline: '12/22' }
      ];

      mockAirtableMethods.createRecord
        .mockResolvedValueOnce({ id: 'rec1' })
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce({ id: 'rec3' });

      const result = await registerMeetingTasks(actions, 'salestailor', '2025-12-14');

      expect(result.registered).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('議事録由来であることを示すsourceフィールドを設定する', async () => {
      const actions = [{ task: 'テスト', assignee: '佐藤', deadline: '12/20' }];
      mockAirtableMethods.createRecord.mockResolvedValue({ id: 'rec123' });

      await registerMeetingTasks(actions, 'salestailor', '2025-12-14');

      expect(mockAirtableMethods.createRecord).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          source: 'meeting'
        })
      );
    });
  });
});
