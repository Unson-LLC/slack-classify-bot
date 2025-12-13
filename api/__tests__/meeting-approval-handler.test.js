/**
 * meeting-approval-handler.test.js
 * Slack UIの承認/却下ボタン押下を処理する機能のテスト
 * TDD: RED -> GREEN -> REFACTOR
 *
 * 機能仕様:
 * - 承認ボタン押下時: 該当項目をAirtable/GitHubに登録
 * - 却下ボタン押下時: 何もせずUIを更新
 * - 一括承認: 全ての項目を登録
 * - 処理完了後、UIを更新して結果を表示
 */

// モック設定
const mockRegisterMeetingTasks = jest.fn();
const mockCommitDecisions = jest.fn();

jest.mock('../meeting-task-registration', () => ({
  registerMeetingTasks: mockRegisterMeetingTasks
}));

jest.mock('../meeting-decision-commit', () => ({
  commitDecisions: mockCommitDecisions
}));

describe('MeetingApprovalHandler', () => {
  let handleApprovalAction;
  let handleRejectAction;
  let handleApproveAll;
  let handleRejectAll;
  let parseActionValue;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockRegisterMeetingTasks.mockReset();
    mockCommitDecisions.mockReset();

    // 実装モジュールを読み込む
    try {
      const module = require('../meeting-approval-handler');
      handleApprovalAction = module.handleApprovalAction;
      handleRejectAction = module.handleRejectAction;
      handleApproveAll = module.handleApproveAll;
      handleRejectAll = module.handleRejectAll;
      parseActionValue = module.parseActionValue;
    } catch (e) {
      // RED状態: モジュールが存在しない
    }
  });

  describe('parseActionValue', () => {
    it('ボタンのvalueをパースする', () => {
      const value = JSON.stringify({
        type: 'decision',
        index: 0,
        content: 'テスト決定'
      });

      const result = parseActionValue(value);

      expect(result.type).toBe('decision');
      expect(result.index).toBe(0);
      expect(result.content).toBe('テスト決定');
    });

    it('不正なJSONの場合はnullを返す', () => {
      const result = parseActionValue('invalid json');
      expect(result).toBeNull();
    });
  });

  describe('handleApprovalAction', () => {
    it('決定事項の承認時にGitHubにコミットする', async () => {
      const actionValue = {
        type: 'decision',
        index: 0,
        content: '価格は月額5万円に決定'
      };
      const context = {
        projectId: 'salestailor',
        meetingDate: '2025-12-14',
        decisions: [
          { content: '価格は月額5万円に決定', context: '背景', date: '2025-12-14' }
        ],
        actions: []
      };

      mockCommitDecisions.mockResolvedValue({ success: true, committed: 1 });

      const result = await handleApprovalAction(actionValue, context);

      expect(mockCommitDecisions).toHaveBeenCalledWith(
        [context.decisions[0]],
        'salestailor',
        '2025-12-14'
      );
      expect(result.success).toBe(true);
    });

    it('タスクの承認時にAirtableに登録する', async () => {
      const actionValue = {
        type: 'action',
        index: 0,
        task: 'LP作成',
        assignee: '佐藤',
        deadline: '12/20'
      };
      const context = {
        projectId: 'salestailor',
        meetingDate: '2025-12-14',
        decisions: [],
        actions: [
          { task: 'LP作成', assignee: '佐藤', deadline: '12/20' }
        ]
      };

      mockRegisterMeetingTasks.mockResolvedValue({ success: true, registered: 1 });

      const result = await handleApprovalAction(actionValue, context);

      expect(mockRegisterMeetingTasks).toHaveBeenCalledWith(
        [context.actions[0]],
        'salestailor',
        '2025-12-14'
      );
      expect(result.success).toBe(true);
    });

    it('登録失敗時はエラーを返す', async () => {
      const actionValue = { type: 'decision', index: 0, content: 'テスト' };
      const context = {
        projectId: 'salestailor',
        meetingDate: '2025-12-14',
        decisions: [{ content: 'テスト', context: '', date: '2025-12-14' }],
        actions: []
      };

      mockCommitDecisions.mockResolvedValue({ success: false, error: 'API Error' });

      const result = await handleApprovalAction(actionValue, context);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('handleRejectAction', () => {
    it('却下時は何も登録せずに成功を返す', async () => {
      const actionValue = {
        type: 'decision',
        index: 0,
        content: 'テスト決定'
      };

      const result = await handleRejectAction(actionValue);

      expect(mockCommitDecisions).not.toHaveBeenCalled();
      expect(mockRegisterMeetingTasks).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.rejected).toBe(true);
    });
  });

  describe('handleApproveAll', () => {
    it('全ての決定事項とタスクを登録する', async () => {
      const context = {
        projectId: 'salestailor',
        meetingDate: '2025-12-14',
        decisions: [
          { content: '決定1', context: '', date: '2025-12-14' },
          { content: '決定2', context: '', date: '2025-12-14' }
        ],
        actions: [
          { task: 'タスク1', assignee: '佐藤', deadline: '12/20' },
          { task: 'タスク2', assignee: '山田', deadline: '12/25' }
        ]
      };

      mockCommitDecisions.mockResolvedValue({ success: true, committed: 2 });
      mockRegisterMeetingTasks.mockResolvedValue({ success: true, registered: 2 });

      const result = await handleApproveAll(context);

      expect(mockCommitDecisions).toHaveBeenCalledWith(
        context.decisions,
        'salestailor',
        '2025-12-14'
      );
      expect(mockRegisterMeetingTasks).toHaveBeenCalledWith(
        context.actions,
        'salestailor',
        '2025-12-14'
      );
      expect(result.success).toBe(true);
      expect(result.decisionsCommitted).toBe(2);
      expect(result.actionsRegistered).toBe(2);
    });

    it('決定事項のみの場合も正常に動作する', async () => {
      const context = {
        projectId: 'project',
        meetingDate: '2025-12-14',
        decisions: [{ content: '決定', context: '', date: '2025-12-14' }],
        actions: []
      };

      mockCommitDecisions.mockResolvedValue({ success: true, committed: 1 });

      const result = await handleApproveAll(context);

      expect(mockCommitDecisions).toHaveBeenCalled();
      expect(mockRegisterMeetingTasks).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('タスクのみの場合も正常に動作する', async () => {
      const context = {
        projectId: 'project',
        meetingDate: '2025-12-14',
        decisions: [],
        actions: [{ task: 'タスク', assignee: '佐藤', deadline: '12/20' }]
      };

      mockRegisterMeetingTasks.mockResolvedValue({ success: true, registered: 1 });

      const result = await handleApproveAll(context);

      expect(mockCommitDecisions).not.toHaveBeenCalled();
      expect(mockRegisterMeetingTasks).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('一部失敗しても結果を返す', async () => {
      const context = {
        projectId: 'project',
        meetingDate: '2025-12-14',
        decisions: [{ content: '決定', context: '', date: '2025-12-14' }],
        actions: [{ task: 'タスク', assignee: '佐藤', deadline: '12/20' }]
      };

      mockCommitDecisions.mockResolvedValue({ success: true, committed: 1 });
      mockRegisterMeetingTasks.mockResolvedValue({ success: false, error: 'Error', registered: 0 });

      const result = await handleApproveAll(context);

      expect(result.decisionsCommitted).toBe(1);
      expect(result.actionsRegistered).toBe(0);
      expect(result.errors).toBeDefined();
    });
  });

  describe('handleRejectAll', () => {
    it('全て却下して成功を返す', async () => {
      const context = {
        projectId: 'project',
        meetingDate: '2025-12-14',
        decisions: [{ content: '決定', context: '', date: '2025-12-14' }],
        actions: [{ task: 'タスク', assignee: '佐藤', deadline: '12/20' }]
      };

      const result = await handleRejectAll(context);

      expect(mockCommitDecisions).not.toHaveBeenCalled();
      expect(mockRegisterMeetingTasks).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.rejected).toBe(true);
      expect(result.decisionsRejected).toBe(1);
      expect(result.actionsRejected).toBe(1);
    });
  });
});
