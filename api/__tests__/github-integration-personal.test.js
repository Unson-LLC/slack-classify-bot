/**
 * github-integration-personal.test.js
 * 個人タスク追加機能のテスト（TDD: RED -> GREEN -> REFACTOR）
 */

const GitHubIntegration = require('../github-integration');

// モック設定
jest.mock('axios');
const axios = require('axios');

describe('GitHubIntegration - Personal Tasks', () => {
  let github;

  beforeEach(() => {
    github = new GitHubIntegration('test-token');
    jest.clearAllMocks();
  });

  describe('getPersonalTasksPath', () => {
    it('ユーザーIDから個人タスクファイルのパスを生成する', () => {
      const path = github.getPersonalTasksPath('k.sato');
      expect(path).toBe('_tasks/personal/k.sato.md');
    });

    it('ユーザーIDがnullの場合はエラーを投げる', () => {
      expect(() => github.getPersonalTasksPath(null)).toThrow('userId is required');
    });

    it('ユーザーIDが空文字の場合はエラーを投げる', () => {
      expect(() => github.getPersonalTasksPath('')).toThrow('userId is required');
    });
  });

  describe('appendPersonalTask', () => {
    const mockExistingContent = `# 佐藤圭吾 個人タスク

---

## アクティブタスク

---
id: PERSONAL-2025-12-01-EXISTING
title: 既存のタスク
project_id: personal
status: todo
owner: k.sato
priority: low
due: null
tags: [personal]
links: []
---

- 既存のタスク

---

## 完了済みタスク
`;

    beforeEach(() => {
      // getFileContent のモック（appendPersonalTask内）
      axios.get.mockResolvedValueOnce({
        data: {
          content: Buffer.from(mockExistingContent).toString('base64'),
          sha: 'existing-sha'
        }
      });

      // createOrUpdateFile 内部の getFileContent チェック用
      axios.get.mockResolvedValueOnce({
        data: {
          sha: 'existing-sha'
        }
      });

      // createOrUpdateFile のモック
      axios.put.mockResolvedValueOnce({
        data: {
          content: { sha: 'new-content-sha', html_url: 'https://github.com/file' },
          commit: { sha: 'new-commit-sha', html_url: 'https://github.com/commit' }
        }
      });
    });

    it('個人タスクを追加できる', async () => {
      const task = {
        title: '買い物リスト作成',
        priority: 'high',
        due: '2025-12-15',
        context: 'スーパーで買うものリスト'
      };

      const result = await github.appendPersonalTask('k.sato', task);

      expect(result.success).toBe(true);
      expect(result.taskId).toMatch(/^PERSONAL-\d{4}-\d{2}-\d{2}-/);

      // コミットメッセージを確認
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining('_tasks/personal/k.sato.md'),
        expect.objectContaining({
          message: expect.stringContaining('買い物リスト作成')
        }),
        expect.any(Object)
      );
    });

    it('タスクがYAML形式で追加される', async () => {
      const task = {
        title: 'テストタスク',
        priority: 'medium',
        due: null,
        context: 'テスト用'
      };

      await github.appendPersonalTask('k.sato', task);

      // axios.putに渡されたcontentをデコードして確認
      const putCall = axios.put.mock.calls[0];
      const encodedContent = putCall[1].content;
      const decodedContent = Buffer.from(encodedContent, 'base64').toString('utf-8');

      expect(decodedContent).toContain('id: PERSONAL-');
      expect(decodedContent).toContain('title: テストタスク');
      expect(decodedContent).toContain('project_id: personal');
      expect(decodedContent).toContain('status: todo');
      expect(decodedContent).toContain('owner: k.sato');
      expect(decodedContent).toContain('priority: medium');
    });

    it('ファイルが存在しない場合はテンプレートから作成する', async () => {
      // 404エラー（ファイル存在しない）をシミュレート
      axios.get.mockReset();
      // getFileContent 用（404 = ファイル存在しない）
      axios.get.mockRejectedValueOnce({ response: { status: 404 } });
      // createOrUpdateFile 内部のチェック用（404 = 新規作成）
      axios.get.mockRejectedValueOnce({ response: { status: 404 } });

      axios.put.mockResolvedValueOnce({
        data: {
          content: { sha: 'new-sha', html_url: 'https://github.com/file' },
          commit: { sha: 'commit-sha', html_url: 'https://github.com/commit' }
        }
      });

      const task = {
        title: '新規ユーザーのタスク',
        priority: 'low'
      };

      const result = await github.appendPersonalTask('new-user', task);

      expect(result.success).toBe(true);

      // 新規作成されたコンテンツにヘッダーがあることを確認
      const putCall = axios.put.mock.calls[0];
      const encodedContent = putCall[1].content;
      const decodedContent = Buffer.from(encodedContent, 'base64').toString('utf-8');

      expect(decodedContent).toContain('# new-user 個人タスク');
      expect(decodedContent).toContain('Airtableには同期されません');
    });

    it('tagsにpersonalが含まれる', async () => {
      const task = {
        title: 'タグテスト',
        priority: 'low'
      };

      await github.appendPersonalTask('k.sato', task);

      const putCall = axios.put.mock.calls[0];
      const encodedContent = putCall[1].content;
      const decodedContent = Buffer.from(encodedContent, 'base64').toString('utf-8');

      expect(decodedContent).toContain('tags: [personal]');
    });
  });

  describe('isPersonalTask', () => {
    it('project_id: personal のタスクを個人タスクと判定する', () => {
      const task = { project_id: 'personal' };
      expect(github.isPersonalTask(task)).toBe(true);
    });

    it('他のproject_idは共有タスクと判定する', () => {
      const task = { project_id: 'salestailor' };
      expect(github.isPersonalTask(task)).toBe(false);
    });

    it('personalタグがあれば個人タスクと判定する', () => {
      const task = { project_id: 'general', tags: ['personal', 'shopping'] };
      expect(github.isPersonalTask(task)).toBe(true);
    });
  });
});
