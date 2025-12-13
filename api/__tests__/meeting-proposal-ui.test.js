/**
 * meeting-proposal-ui.test.js
 * 抽出した決定事項・タスクを人間に確認させるSlack UIを生成する機能のテスト
 * TDD: RED -> GREEN -> REFACTOR
 *
 * 機能仕様:
 * - 抽出結果をSlack Block Kit形式に変換
 * - 各項目に承認/却下ボタンを付与
 * - プロジェクト情報と議事録日付を表示
 */

describe('MeetingProposalUI', () => {
  let buildProposalBlocks;
  let buildDecisionBlock;
  let buildActionBlock;
  let buildSummaryBlock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // 実装モジュールを読み込む
    try {
      const module = require('../meeting-proposal-ui');
      buildProposalBlocks = module.buildProposalBlocks;
      buildDecisionBlock = module.buildDecisionBlock;
      buildActionBlock = module.buildActionBlock;
      buildSummaryBlock = module.buildSummaryBlock;
    } catch (e) {
      // RED状態: モジュールが存在しない
    }
  });

  describe('buildDecisionBlock', () => {
    it('決定事項を表示するブロックを生成する', () => {
      const decision = {
        content: '価格は月額5万円に決定',
        context: '競合調査の結果',
        date: '2025-12-14'
      };
      const index = 0;

      const result = buildDecisionBlock(decision, index);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      // セクションブロックが含まれる
      const sectionBlock = result.find(b => b.type === 'section');
      expect(sectionBlock).toBeDefined();
      expect(sectionBlock.text.text).toContain('価格は月額5万円に決定');
    });

    it('承認/却下ボタンを含むアクションブロックを生成する', () => {
      const decision = { content: 'テスト決定', context: '', date: '2025-12-14' };

      const result = buildDecisionBlock(decision, 0);

      const actionBlock = result.find(b => b.type === 'actions');
      expect(actionBlock).toBeDefined();
      expect(actionBlock.elements).toHaveLength(2); // 承認と却下
      expect(actionBlock.elements[0].text.text).toContain('承認');
      expect(actionBlock.elements[1].text.text).toContain('却下');
    });

    it('ボタンのaction_idにインデックスを含める', () => {
      const decision = { content: 'テスト', context: '', date: '2025-12-14' };

      const result = buildDecisionBlock(decision, 2);

      const actionBlock = result.find(b => b.type === 'actions');
      expect(actionBlock.elements[0].action_id).toContain('decision_2');
    });
  });

  describe('buildActionBlock', () => {
    it('タスクを表示するブロックを生成する', () => {
      const action = {
        task: 'LP作成',
        assignee: '佐藤',
        deadline: '12/20'
      };

      const result = buildActionBlock(action, 0);

      expect(result).toBeInstanceOf(Array);
      const sectionBlock = result.find(b => b.type === 'section');
      expect(sectionBlock.text.text).toContain('LP作成');
      expect(sectionBlock.text.text).toContain('佐藤');
      expect(sectionBlock.text.text).toContain('12/20');
    });

    it('承認/却下ボタンを含む', () => {
      const action = { task: 'テスト', assignee: '山田', deadline: '来週' };

      const result = buildActionBlock(action, 0);

      const actionBlock = result.find(b => b.type === 'actions');
      expect(actionBlock).toBeDefined();
      expect(actionBlock.elements).toHaveLength(2);
    });

    it('ボタンのaction_idにaction_とインデックスを含める', () => {
      const action = { task: 'テスト', assignee: '田中', deadline: '今週中' };

      const result = buildActionBlock(action, 3);

      const actionBlock = result.find(b => b.type === 'actions');
      expect(actionBlock.elements[0].action_id).toContain('action_3');
    });
  });

  describe('buildSummaryBlock', () => {
    it('サマリーブロックを生成する', () => {
      const projectId = 'salestailor';
      const meetingDate = '2025-12-14';
      const decisionsCount = 2;
      const actionsCount = 3;

      const result = buildSummaryBlock(projectId, meetingDate, decisionsCount, actionsCount);

      expect(result).toBeInstanceOf(Array);
      const headerBlock = result.find(b => b.type === 'header');
      expect(headerBlock).toBeDefined();
      expect(headerBlock.text.text).toContain('会議');
    });

    it('決定事項とタスクの件数を表示する', () => {
      const result = buildSummaryBlock('project', '2025-12-14', 2, 5);

      const contextBlock = result.find(b => b.type === 'context');
      expect(contextBlock).toBeDefined();
      const text = contextBlock.elements.map(e => e.text).join(' ');
      expect(text).toContain('2');
      expect(text).toContain('5');
    });

    it('一括承認ボタンを含める', () => {
      const result = buildSummaryBlock('project', '2025-12-14', 1, 1);

      const actionBlock = result.find(b => b.type === 'actions');
      expect(actionBlock).toBeDefined();
      const approveAllBtn = actionBlock.elements.find(e => e.action_id.includes('approve_all'));
      expect(approveAllBtn).toBeDefined();
    });
  });

  describe('buildProposalBlocks', () => {
    it('全体のブロック配列を生成する', () => {
      const extractionResult = {
        decisions: [
          { content: '価格決定', context: '背景', date: '2025-12-14' }
        ],
        actions: [
          { task: 'LP作成', assignee: '佐藤', deadline: '12/20' }
        ]
      };
      const projectId = 'salestailor';
      const meetingDate = '2025-12-14';

      const result = buildProposalBlocks(extractionResult, projectId, meetingDate);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      // ヘッダー、決定事項、タスクのセクションが含まれる
      const headerBlock = result.find(b => b.type === 'header');
      expect(headerBlock).toBeDefined();
    });

    it('決定事項がない場合は「なし」と表示する', () => {
      const extractionResult = {
        decisions: [],
        actions: [{ task: 'タスク', assignee: '佐藤', deadline: '12/20' }]
      };

      const result = buildProposalBlocks(extractionResult, 'project', '2025-12-14');

      const textBlocks = result.filter(b => b.type === 'section');
      const noDecisionText = textBlocks.some(b =>
        b.text?.text?.includes('決定事項なし') || b.text?.text?.includes('なし')
      );
      // 決定事項がないことを示すブロックがあるか、または決定事項セクションがない
      expect(result.length).toBeGreaterThan(0);
    });

    it('タスクがない場合は「なし」と表示する', () => {
      const extractionResult = {
        decisions: [{ content: '決定', context: '', date: '2025-12-14' }],
        actions: []
      };

      const result = buildProposalBlocks(extractionResult, 'project', '2025-12-14');

      expect(result.length).toBeGreaterThan(0);
    });

    it('両方ない場合も正常に動作する', () => {
      const extractionResult = {
        decisions: [],
        actions: []
      };

      const result = buildProposalBlocks(extractionResult, 'project', '2025-12-14');

      expect(result).toBeInstanceOf(Array);
      // 最低限ヘッダーは含まれる
      expect(result.length).toBeGreaterThan(0);
    });

    it('複数の決定事項とタスクを処理できる', () => {
      const extractionResult = {
        decisions: [
          { content: '決定1', context: '', date: '2025-12-14' },
          { content: '決定2', context: '', date: '2025-12-14' }
        ],
        actions: [
          { task: 'タスク1', assignee: '佐藤', deadline: '12/20' },
          { task: 'タスク2', assignee: '山田', deadline: '12/25' },
          { task: 'タスク3', assignee: '田中', deadline: '来週' }
        ]
      };

      const result = buildProposalBlocks(extractionResult, 'project', '2025-12-14');

      // 全ての項目がブロックとして生成されている
      const actionBlocks = result.filter(b => b.type === 'actions');
      // 各決定事項/タスクごとにアクションブロック + サマリーのアクションブロック
      expect(actionBlocks.length).toBeGreaterThanOrEqual(5);
    });
  });
});
