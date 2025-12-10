/**
 * task-id-generator.test.js
 * タスクID生成器のテスト（TDD: RED -> GREEN -> REFACTOR）
 *
 * TASK-ID形式: T-YYMM-NNN（例: T-2412-001）
 * - T: タスクのプレフィックス
 * - YYMM: 年月（2桁年 + 2桁月）
 * - NNN: 月内連番（3桁、ゼロパディング）
 *
 * DynamoDBテーブル: brainbase-counters
 * - PK: counter_id (例: "task_id")
 * - SK: year_month (例: "2412")
 * - value: 連番の現在値
 */

const { TaskIdGenerator } = require('../task-id-generator');

// AWS SDK モック
jest.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: jest.fn().mockImplementation(() => ({}))
  };
});

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: {
      from: jest.fn().mockReturnValue({
        send: mockSend
      })
    },
    UpdateCommand: jest.fn().mockImplementation((params) => params),
    GetCommand: jest.fn().mockImplementation((params) => params),
    mockSend // テストからアクセスできるようにエクスポート
  };
});

describe('TaskIdGenerator', () => {
  let generator;
  let mockSend;

  beforeEach(() => {
    jest.clearAllMocks();
    generator = new TaskIdGenerator();
    // モックのsendを取得
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    mockSend = DynamoDBDocumentClient.from().send;
  });

  describe('formatYearMonth', () => {
    it('Dateオブジェクトから YYMM 形式の文字列を返す', () => {
      const date = new Date('2024-12-15');
      expect(generator.formatYearMonth(date)).toBe('2412');
    });

    it('1月は01としてゼロパディングする', () => {
      const date = new Date('2025-01-05');
      expect(generator.formatYearMonth(date)).toBe('2501');
    });

    it('引数なしの場合は現在日時を使用する', () => {
      const result = generator.formatYearMonth();
      expect(result).toMatch(/^\d{4}$/);
    });
  });

  describe('formatTaskId', () => {
    it('年月と連番からタスクIDを生成する', () => {
      expect(generator.formatTaskId('2412', 1)).toBe('T-2412-001');
    });

    it('連番は3桁でゼロパディングする', () => {
      expect(generator.formatTaskId('2412', 42)).toBe('T-2412-042');
    });

    it('3桁を超える連番もそのまま表示する', () => {
      expect(generator.formatTaskId('2412', 1234)).toBe('T-2412-1234');
    });
  });

  describe('generateNextId', () => {
    it('DynamoDBのatomic counterで次のIDを取得する', async () => {
      // UpdateCommandが新しい値を返すモック
      mockSend.mockResolvedValueOnce({
        Attributes: { value: 1 }
      });

      const taskId = await generator.generateNextId();

      expect(taskId).toMatch(/^T-\d{4}-001$/);
    });

    it('連番が増加した場合は正しくフォーマットされる', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { value: 47 }
      });

      const taskId = await generator.generateNextId();

      expect(taskId).toMatch(/^T-\d{4}-047$/);
    });

    it('特定の日付を指定してIDを生成できる', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { value: 5 }
      });

      const date = new Date('2025-03-20');
      const taskId = await generator.generateNextId(date);

      expect(taskId).toBe('T-2503-005');
    });

    it('DynamoDB UpdateCommandが正しいパラメータで呼ばれる', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { value: 1 }
      });

      const date = new Date('2024-12-15');
      await generator.generateNextId(date);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'brainbase-counters',
          Key: {
            counter_id: 'task_id',
            year_month: '2412'
          },
          UpdateExpression: 'SET #val = if_not_exists(#val, :zero) + :inc',
          ExpressionAttributeNames: {
            '#val': 'value'
          },
          ExpressionAttributeValues: {
            ':inc': 1,
            ':zero': 0
          },
          ReturnValues: 'ALL_NEW'
        })
      );
    });

    it('DynamoDBエラー時は例外を投げる', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB Error'));

      await expect(generator.generateNextId()).rejects.toThrow('DynamoDB Error');
    });
  });

  describe('getCurrentCounter', () => {
    it('現在のカウンター値を取得できる', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { counter_id: 'task_id', year_month: '2412', value: 47 }
      });

      const value = await generator.getCurrentCounter('2412');

      expect(value).toBe(47);
    });

    it('カウンターが存在しない場合は0を返す', async () => {
      mockSend.mockResolvedValueOnce({
        Item: undefined
      });

      const value = await generator.getCurrentCounter('2501');

      expect(value).toBe(0);
    });
  });

  describe('parseTaskId', () => {
    it('タスクIDをパースして構成要素を返す', () => {
      const parsed = generator.parseTaskId('T-2412-047');

      expect(parsed).toEqual({
        prefix: 'T',
        yearMonth: '2412',
        sequence: 47,
        year: 2024,
        month: 12
      });
    });

    it('無効なタスクIDはnullを返す', () => {
      expect(generator.parseTaskId('INVALID')).toBeNull();
      expect(generator.parseTaskId('SLACK-2024-12-10-ABC')).toBeNull();
      expect(generator.parseTaskId('')).toBeNull();
      expect(generator.parseTaskId(null)).toBeNull();
    });

    it('4桁以上の連番もパースできる', () => {
      const parsed = generator.parseTaskId('T-2412-1234');

      expect(parsed).toEqual({
        prefix: 'T',
        yearMonth: '2412',
        sequence: 1234,
        year: 2024,
        month: 12
      });
    });
  });

  describe('isValidTaskId', () => {
    it('有効なタスクIDはtrueを返す', () => {
      expect(generator.isValidTaskId('T-2412-001')).toBe(true);
      expect(generator.isValidTaskId('T-2501-999')).toBe(true);
      expect(generator.isValidTaskId('T-2412-1234')).toBe(true);
    });

    it('無効なタスクIDはfalseを返す', () => {
      expect(generator.isValidTaskId('SLACK-2024-12-10-ABC')).toBe(false);
      expect(generator.isValidTaskId('T2412001')).toBe(false);
      expect(generator.isValidTaskId('')).toBe(false);
      expect(generator.isValidTaskId(null)).toBe(false);
    });
  });
});
