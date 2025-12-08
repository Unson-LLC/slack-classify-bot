const ReminderService = require('../reminder');

jest.mock('../task-parser');
jest.mock('../slack-name-resolver');

const TaskParser = require('../task-parser');
const { getSlackIdToBrainbaseName, getMembersMapping } = require('../slack-name-resolver');

describe('ReminderService.sendDailySummary - サポット風UI', () => {
  let reminder;
  let mockSlackClient;
  let mockTaskParser;

  beforeEach(() => {
    mockSlackClient = {
      chat: {
        postMessage: jest.fn().mockResolvedValue({ ts: '1234567890.123456' })
      }
    };

    mockTaskParser = {
      getTasksByOwner: jest.fn().mockResolvedValue([]),
      getTasksByRequester: jest.fn().mockResolvedValue([])
    };
    TaskParser.mockImplementation(() => mockTaskParser);

    reminder = new ReminderService(mockSlackClient);

    getSlackIdToBrainbaseName.mockResolvedValue(new Map([
      ['U123456789', 'keigo']
    ]));
    getMembersMapping.mockResolvedValue(new Map([
      ['keigo', 'U123456789']
    ]));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('formatDailySummaryBlocks', () => {
    it('ヘッダーに日付と曜日が表示される', () => {
      const tasks = [
        { id: 'TASK-001', title: 'テスト1', owner: 'keigo', status: 'todo' }
      ];
      const now = new Date('2024-12-05T09:00:00+09:00');

      const blocks = reminder.formatDailySummaryBlocks(tasks, [], now);

      const headerBlock = blocks.find(b => b.type === 'header');
      expect(headerBlock.text.text).toContain('12月5日');
      expect(headerBlock.text.text).toContain('木');
      expect(headerBlock.text.text).toContain('1件');
    });

    it('担当中セクションが表示される', () => {
      const ownedTasks = [
        { id: 'TASK-001', title: '担当タスク1', owner: 'keigo', status: 'todo', due: '2024-12-08' },
        { id: 'TASK-002', title: '担当タスク2', owner: 'keigo', status: 'todo', due: '2024-12-10' }
      ];
      const requestedTasks = [];
      const now = new Date('2024-12-05T09:00:00+09:00');

      const blocks = reminder.formatDailySummaryBlocks(ownedTasks, requestedTasks, now);

      const allText = JSON.stringify(blocks);
      expect(allText).toContain('担当中');
      expect(allText).toContain('担当タスク1');
    });

    it('依頼中セクションが表示される', () => {
      const ownedTasks = [];
      const requestedTasks = [
        { id: 'TASK-003', title: '依頼タスク1', owner: 'other', requester: 'keigo', status: 'todo', due: '2024-12-08' }
      ];
      const now = new Date('2024-12-05T09:00:00+09:00');

      const blocks = reminder.formatDailySummaryBlocks(ownedTasks, requestedTasks, now);

      const allText = JSON.stringify(blocks);
      expect(allText).toContain('依頼中');
      expect(allText).toContain('依頼タスク1');
    });

    it('期限が曜日付きで表示される', () => {
      const ownedTasks = [
        { id: 'TASK-001', title: 'テスト', owner: 'keigo', status: 'todo', due: '2024-12-08' }
      ];
      const now = new Date('2024-12-05T09:00:00+09:00');

      const blocks = reminder.formatDailySummaryBlocks(ownedTasks, [], now);

      const allText = JSON.stringify(blocks);
      expect(allText).toMatch(/12\/08.*日/);
    });

    it('各タスクに完了ボタンがある', () => {
      const ownedTasks = [
        { id: 'TASK-001', title: 'テスト', owner: 'keigo', status: 'todo' }
      ];
      const now = new Date('2024-12-05T09:00:00+09:00');

      const blocks = reminder.formatDailySummaryBlocks(ownedTasks, [], now);

      const actionBlock = blocks.find(b => b.type === 'actions');
      expect(actionBlock).toBeDefined();
      const completeButton = actionBlock.elements.find(e => e.text?.text?.includes('完了'));
      expect(completeButton).toBeDefined();
    });

    it('タスクがない場合はメッセージが表示される', () => {
      const blocks = reminder.formatDailySummaryBlocks([], [], new Date());

      const allText = JSON.stringify(blocks);
      expect(allText).toContain('ありません');
    });

    it('期限を見直すドロップダウンがある', () => {
      const ownedTasks = [
        { id: 'TASK-001', title: 'テスト', owner: 'keigo', status: 'todo' }
      ];
      const now = new Date('2024-12-05T09:00:00+09:00');

      const blocks = reminder.formatDailySummaryBlocks(ownedTasks, [], now);

      const actionBlock = blocks.find(b => b.type === 'actions');
      expect(actionBlock).toBeDefined();
      const selectElement = actionBlock.elements.find(e => e.type === 'static_select');
      expect(selectElement).toBeDefined();
      expect(selectElement.placeholder.text).toContain('期限を見直す');
    });
  });

  describe('sendDailySummary', () => {
    it('Slackにサポット風メッセージを送信する', async () => {
      mockTaskParser.getTasksByOwner.mockResolvedValue([
        { id: 'TASK-001', title: 'テスト', owner: 'keigo', status: 'todo', due: '2024-12-08' }
      ]);
      mockTaskParser.getTasksByRequester.mockResolvedValue([]);

      const result = await reminder.sendDailySummary('U123456789');

      expect(result.success).toBe(true);
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'U123456789',
          blocks: expect.arrayContaining([
            expect.objectContaining({ type: 'header' })
          ])
        })
      );
    });

    it('タスクがない場合は送信しない', async () => {
      mockTaskParser.getTasksByOwner.mockResolvedValue([]);
      mockTaskParser.getTasksByRequester.mockResolvedValue([]);

      const result = await reminder.sendDailySummary('U123456789');

      expect(result.success).toBe(true);
      expect(result.message).toBe('No pending tasks');
      expect(mockSlackClient.chat.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('formatDueDate', () => {
    it('期限を曜日付きでフォーマットする', () => {
      const result = reminder.formatDueDate('2024-12-08');
      expect(result).toContain('12/08');
      expect(result).toContain('日');
      expect(result).toContain('まで');
    });

    it('期限がnullの場合は空文字を返す', () => {
      const result = reminder.formatDueDate(null);
      expect(result).toBe('');
    });

    it('期限が"null"文字列の場合は空文字を返す', () => {
      const result = reminder.formatDueDate('null');
      expect(result).toBe('');
    });
  });

  describe('formatDateHeader', () => {
    it('日付を月日(曜日)形式でフォーマットする', () => {
      const now = new Date('2024-12-05T09:00:00+09:00');
      const result = reminder.formatDateHeader(now);
      expect(result).toContain('12月5日');
      expect(result).toContain('木');
    });
  });
});
