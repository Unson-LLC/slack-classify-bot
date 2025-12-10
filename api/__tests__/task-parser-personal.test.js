/**
 * task-parser-personal.test.js
 * 個人タスク機能のテスト（TDD: RED -> GREEN -> REFACTOR）
 */

const TaskParser = require('../task-parser');

// モック設定
jest.mock('axios');
const axios = require('axios');

describe('TaskParser - Personal Tasks', () => {
  let parser;

  beforeEach(() => {
    parser = new TaskParser('test-token');
    jest.clearAllMocks();
  });

  describe('getPersonalTasksPath', () => {
    it('ユーザーIDから個人タスクファイルのパスを生成する', () => {
      const path = parser.getPersonalTasksPath('k.sato');
      expect(path).toBe('_tasks/personal/k.sato.md');
    });

    it('ユーザーIDがnullの場合はエラーを投げる', () => {
      expect(() => parser.getPersonalTasksPath(null)).toThrow('userId is required');
    });

    it('ユーザーIDが空文字の場合はエラーを投げる', () => {
      expect(() => parser.getPersonalTasksPath('')).toThrow('userId is required');
    });
  });

  describe('fetchPersonalTasksFile', () => {
    const mockPersonalTasksContent = `# 佐藤圭吾 個人タスク

---
id: PERSONAL-2025-12-11-001
title: サンプル個人タスク
project_id: personal
status: todo
owner: k.sato
priority: low
due: null
tags: [personal]
links: []
---

- 個人タスクのサンプル
`;

    it('個人タスクファイルを取得できる', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          content: Buffer.from(mockPersonalTasksContent).toString('base64')
        }
      });

      const content = await parser.fetchPersonalTasksFile('k.sato');
      expect(content).toBe(mockPersonalTasksContent);
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('_tasks/personal/k.sato.md'),
        expect.any(Object)
      );
    });

    it('ファイルが存在しない場合は空文字を返す', async () => {
      axios.get.mockRejectedValueOnce({ response: { status: 404 } });

      const content = await parser.fetchPersonalTasksFile('new-user');
      expect(content).toBe('');
    });
  });

  describe('getPersonalTasks', () => {
    const mockContent = `---
id: PERSONAL-2025-12-11-001
title: 買い物リスト作成
project_id: personal
status: todo
owner: k.sato
priority: high
due: 2025-12-15
tags: [personal, shopping]
links: []
---

- 個人タスク1

---
id: PERSONAL-2025-12-11-002
title: 読書メモ整理
project_id: personal
status: in-progress
owner: k.sato
priority: low
due: null
tags: [personal]
links: []
---

- 個人タスク2
`;

    beforeEach(() => {
      axios.get.mockResolvedValueOnce({
        data: {
          content: Buffer.from(mockContent).toString('base64')
        }
      });
    });

    it('個人タスク一覧を取得できる', async () => {
      const tasks = await parser.getPersonalTasks('k.sato');

      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('PERSONAL-2025-12-11-001');
      expect(tasks[0].title).toBe('買い物リスト作成');
      expect(tasks[0].priority).toBe('high');
      expect(tasks[1].id).toBe('PERSONAL-2025-12-11-002');
    });

    it('status=todoの個人タスクのみをフィルタできる', async () => {
      const tasks = await parser.getPersonalTasks('k.sato', { status: 'todo' });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('買い物リスト作成');
    });

    it('priority=highの個人タスクのみをフィルタできる', async () => {
      const tasks = await parser.getPersonalTasks('k.sato', { priority: 'high' });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('買い物リスト作成');
    });
  });

  describe('getPendingPersonalTasks', () => {
    const mockContent = `---
id: PERSONAL-001
title: 未完了タスク
project_id: personal
status: todo
owner: k.sato
priority: medium
due: null
tags: [personal]
---

- タスク1

---
id: PERSONAL-002
title: 完了タスク
project_id: personal
status: done
owner: k.sato
priority: low
due: null
tags: [personal]
---

- タスク2
`;

    it('未完了の個人タスクのみを取得する', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          content: Buffer.from(mockContent).toString('base64')
        }
      });

      const tasks = await parser.getPendingPersonalTasks('k.sato');

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('未完了タスク');
      expect(tasks[0].status).toBe('todo');
    });
  });

  describe('getOverduePersonalTasks', () => {
    it('期限切れの個人タスクを取得する', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      const mockContent = `---
id: PERSONAL-001
title: 期限切れタスク
project_id: personal
status: todo
owner: k.sato
priority: high
due: ${yesterdayStr}
tags: [personal]
---

- 期限切れ

---
id: PERSONAL-002
title: 期限内タスク
project_id: personal
status: todo
owner: k.sato
priority: medium
due: 2099-12-31
tags: [personal]
---

- 期限内
`;

      axios.get.mockResolvedValueOnce({
        data: {
          content: Buffer.from(mockContent).toString('base64')
        }
      });

      const tasks = await parser.getOverduePersonalTasks('k.sato');

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('期限切れタスク');
    });
  });
});
