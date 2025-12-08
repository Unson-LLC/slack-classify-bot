const SlackThreadReminderService = require('../slack-thread-reminder');

describe('SlackThreadReminderService', () => {
  let reminderService;
  let mockSlackClient;

  beforeEach(() => {
    mockSlackClient = {
      chat: {
        postMessage: jest.fn().mockResolvedValue({ ok: true, ts: '1234567890.123456' })
      }
    };
    reminderService = new SlackThreadReminderService(mockSlackClient);
  });

  describe('filterSlackTasks', () => {
    const sampleTasks = [
      {
        id: 'SLACK-2025-12-08-001',
        title: 'Slackからのタスク',
        source: 'slack',
        channel_id: 'C123456',
        thread_ts: '1733644800.123456',
        created_at: '2025-12-08T10:00:00Z',
        status: 'todo',
        owner: 'keigo'
      },
      {
        id: 'MANUAL-2025-12-08-001',
        title: '手動作成タスク',
        source: 'manual',
        status: 'todo',
        owner: 'keigo'
      },
      {
        id: 'SLACK-2025-12-08-002',
        title: 'Slackからの完了済みタスク',
        source: 'slack',
        channel_id: 'C123456',
        thread_ts: '1733644900.123456',
        created_at: '2025-12-08T11:00:00Z',
        status: 'done',
        owner: 'keigo'
      },
      {
        id: 'OLD-001',
        title: 'sourceフィールドなしタスク',
        status: 'todo',
        owner: 'keigo'
      }
    ];

    it('source: slackのタスクのみを抽出する', () => {
      const filtered = reminderService.filterSlackTasks(sampleTasks);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('SLACK-2025-12-08-001');
      expect(filtered[0].source).toBe('slack');
    });

    it('完了済みタスク（status: done）は除外する', () => {
      const filtered = reminderService.filterSlackTasks(sampleTasks);

      expect(filtered.every(t => t.status !== 'done')).toBe(true);
    });

    it('channel_idとthread_tsが必須', () => {
      const tasksWithMissingFields = [
        {
          id: 'SLACK-001',
          source: 'slack',
          channel_id: 'C123',
          status: 'todo'
        },
        {
          id: 'SLACK-002',
          source: 'slack',
          thread_ts: '123.456',
          status: 'todo'
        }
      ];

      const filtered = reminderService.filterSlackTasks(tasksWithMissingFields);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('getTasksToRemind', () => {
    it('作成から指定時間経過したタスクを返す', () => {
      const now = new Date('2025-12-09T10:00:00Z');
      const tasks = [
        {
          id: 'SLACK-001',
          source: 'slack',
          channel_id: 'C123',
          thread_ts: '123.456',
          created_at: '2025-12-08T10:00:00Z',
          status: 'todo'
        },
        {
          id: 'SLACK-002',
          source: 'slack',
          channel_id: 'C456',
          thread_ts: '456.789',
          created_at: '2025-12-09T09:00:00Z',
          status: 'todo'
        }
      ];

      const toRemind = reminderService.getTasksToRemind(tasks, now, 24 * 60 * 60 * 1000);

      expect(toRemind).toHaveLength(1);
      expect(toRemind[0].id).toBe('SLACK-001');
    });

    it('複数のリマインド間隔をサポートする（24h, 48h）', () => {
      const now = new Date('2025-12-10T10:00:00Z');
      const tasks = [
        {
          id: 'SLACK-001',
          source: 'slack',
          channel_id: 'C123',
          thread_ts: '123.456',
          created_at: '2025-12-08T10:00:00Z',
          status: 'todo',
          reminder_count: 0
        },
        {
          id: 'SLACK-002',
          source: 'slack',
          channel_id: 'C456',
          thread_ts: '456.789',
          created_at: '2025-12-09T10:00:00Z',
          status: 'todo',
          reminder_count: 0
        }
      ];

      const intervals = [24 * 60 * 60 * 1000, 48 * 60 * 60 * 1000];
      const toRemind = reminderService.getTasksToRemindWithIntervals(tasks, now, intervals);

      expect(toRemind).toHaveLength(2);
    });
  });

  describe('sendThreadReminder', () => {
    it('DMではなくスレッドにリプライを投稿する', async () => {
      const task = {
        id: 'SLACK-001',
        title: 'テストタスク',
        source: 'slack',
        channel_id: 'C123456',
        thread_ts: '1733644800.123456',
        owner: 'keigo',
        status: 'todo'
      };

      await reminderService.sendThreadReminder(task);

      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123456',
          thread_ts: '1733644800.123456'
        })
      );
    });

    it('リマインドメッセージに完了ボタンを含む', async () => {
      const task = {
        id: 'SLACK-001',
        title: 'テストタスク',
        source: 'slack',
        channel_id: 'C123456',
        thread_ts: '1733644800.123456',
        owner: 'keigo',
        owner_slack_id: 'U123456',
        status: 'todo'
      };

      await reminderService.sendThreadReminder(task);

      const callArg = mockSlackClient.chat.postMessage.mock.calls[0][0];
      expect(callArg.blocks).toBeDefined();

      const actionBlock = callArg.blocks.find(b => b.type === 'actions');
      expect(actionBlock).toBeDefined();

      const completeButton = actionBlock.elements.find(
        e => e.action_id && e.action_id.includes('complete')
      );
      expect(completeButton).toBeDefined();
    });

    it('担当者をメンションする', async () => {
      const task = {
        id: 'SLACK-001',
        title: 'テストタスク',
        source: 'slack',
        channel_id: 'C123456',
        thread_ts: '1733644800.123456',
        owner: 'keigo',
        owner_slack_id: 'U123456',
        status: 'todo'
      };

      await reminderService.sendThreadReminder(task);

      const callArg = mockSlackClient.chat.postMessage.mock.calls[0][0];
      expect(callArg.text).toContain('<@U123456>');
    });
  });

  describe('runSlackReminders', () => {
    it('Slackタスクのみにリマインドを送信する', async () => {
      const mockTaskParser = {
        getTasks: jest.fn().mockResolvedValue([
          {
            id: 'SLACK-001',
            title: 'Slackタスク',
            source: 'slack',
            channel_id: 'C123',
            thread_ts: '123.456',
            created_at: '2025-12-07T10:00:00Z',
            status: 'todo',
            owner: 'keigo',
            owner_slack_id: 'U123'
          },
          {
            id: 'MANUAL-001',
            title: '手動タスク',
            status: 'todo',
            owner: 'keigo'
          }
        ])
      };

      reminderService.taskParser = mockTaskParser;

      const now = new Date('2025-12-08T10:00:00Z');
      const results = await reminderService.runSlackReminders(now);

      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledTimes(1);
      expect(results.sent).toBe(1);
      expect(results.skipped).toBe(1);
    });
  });
});
