const { createTaskMessageBlocks } = require('../task-ui');

describe('task-ui', () => {
  describe('createTaskMessageBlocks', () => {
    const baseTask = {
      taskId: 'SLACK-2025-12-03-TEST123',
      title: 'ダウンロードした名刺を小川さんへ渡す',
      requester: 'Tsuyoshi Uda',
      requesterSlackId: 'U09JZ1NBRDE',
      assignee: '佐藤 圭吾',
      assigneeSlackId: 'U07LNUP582X',
      priority: 'medium',
      due: null,
      slackLink: 'https://unson-inc.slack.com/archives/C123/p1234567890'
    };

    it('タスクタイトルを🎯絵文字付きで表示する', () => {
      const blocks = createTaskMessageBlocks(baseTask);

      const titleBlock = blocks.find(b =>
        b.type === 'section' &&
        b.text?.text?.includes('🎯')
      );

      expect(titleBlock).toBeDefined();
      expect(titleBlock.text.text).toContain('ダウンロードした名刺を小川さんへ渡す');
    });

    it('期限が未設定の場合「期限を教えてください」と表示する', () => {
      const blocks = createTaskMessageBlocks(baseTask);

      const dueSectionText = blocks
        .filter(b => b.type === 'section')
        .map(b => b.text?.text || '')
        .join('');

      expect(dueSectionText).toContain('期限を教えてください');
    });

    it('期限が設定されている場合はその日付を表示する', () => {
      const taskWithDue = { ...baseTask, due: '2025-12-10' };
      const blocks = createTaskMessageBlocks(taskWithDue);

      const dueSectionText = blocks
        .filter(b => b.type === 'section')
        .map(b => b.text?.text || '')
        .join('');

      expect(dueSectionText).toContain('2025-12-10');
      expect(dueSectionText).not.toContain('期限を教えてください');
    });

    it('依頼者をメンション形式で表示する', () => {
      const blocks = createTaskMessageBlocks(baseTask);

      const contextText = blocks
        .filter(b => b.type === 'section' || b.type === 'context')
        .map(b => b.text?.text || b.elements?.map(e => e.text).join('') || '')
        .join('');

      expect(contextText).toContain('依頼');
      expect(contextText).toMatch(/<@U09JZ1NBRDE>/);
    });

    it('担当者をメンション形式で表示する', () => {
      const blocks = createTaskMessageBlocks(baseTask);

      const contextText = blocks
        .filter(b => b.type === 'section' || b.type === 'context')
        .map(b => b.text?.text || b.elements?.map(e => e.text).join('') || '')
        .join('');

      expect(contextText).toContain('担当');
      expect(contextText).toMatch(/<@U07LNUP582X>/);
    });

    it('「期限を決める」ドロップダウンを含む', () => {
      const blocks = createTaskMessageBlocks(baseTask);

      const actionsBlock = blocks.find(b => b.type === 'actions');
      expect(actionsBlock).toBeDefined();

      const dueDateSelect = actionsBlock.elements.find(e =>
        e.type === 'static_select' &&
        e.placeholder?.text?.includes('期限')
      );
      expect(dueDateSelect).toBeDefined();
      expect(dueDateSelect.options.length).toBeGreaterThanOrEqual(3);
    });

    it('「編集」ボタンを含む', () => {
      const blocks = createTaskMessageBlocks(baseTask);

      const actionsBlock = blocks.find(b => b.type === 'actions');
      const editButton = actionsBlock.elements.find(e =>
        e.text?.text?.includes('編集')
      );
      expect(editButton).toBeDefined();
    });

    it('「完了」ボタンを含む', () => {
      const blocks = createTaskMessageBlocks(baseTask);

      const actionsBlock = blocks.find(b => b.type === 'actions');
      const completeButton = actionsBlock.elements.find(e =>
        e.text?.text?.includes('完了')
      );
      expect(completeButton).toBeDefined();
    });

    it('ボタンのaction_idにtaskIdが含まれる', () => {
      const blocks = createTaskMessageBlocks(baseTask);

      const actionsBlock = blocks.find(b => b.type === 'actions');
      const allActionIds = actionsBlock.elements.map(e => e.action_id);

      expect(allActionIds.some(id => id.includes('SLACK-2025-12-03-TEST123'))).toBe(true);
    });
  });
});
