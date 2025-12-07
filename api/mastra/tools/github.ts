// mastra/tools/github.ts
// GitHubツール - タスク追加、議事録コミット等

import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';

// タスク追加ツール
export const githubAppendTaskTool = createTool({
  id: 'github_append_task',
  description: 'タスクを_tasks/index.mdに追加する',
  inputSchema: z.object({
    title: z.string().describe('タスクタイトル'),
    projectId: z.string().describe('プロジェクトID（例: salestailor, zeims）'),
    assignee: z.string().describe('担当者名（brainbase表記）'),
    due: z.string().optional().describe('期限（YYYY-MM-DD）'),
    context: z.string().optional().describe('背景・詳細'),
    slackLink: z.string().optional().describe('Slackメッセージへのリンク'),
  }),
  execute: async (input) => {
    const { title, projectId, assignee, due, context, slackLink } = input;

    // 既存のgithub-integration.jsのappendTask関数を呼び出し
    // 将来的にはここで直接GitHub APIを呼び出す
    const GitHubIntegration = require('../../github-integration');
    const github = new GitHubIntegration();

    try {
      const result = await github.appendTask({
        title,
        project_id: projectId,
        assignee,
        due,
        context,
        slack_link: slackLink,
      });

      return {
        success: true,
        taskId: result.taskId,
        message: `タスク "${title}" を追加しました`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

// 議事録コミットツール
export const githubCommitMinutesTool = createTool({
  id: 'github_commit_minutes',
  description: '議事録をGitHubリポジトリにコミットする',
  inputSchema: z.object({
    projectId: z.string().describe('プロジェクトID'),
    date: z.string().describe('日付（YYYY-MM-DD）'),
    topic: z.string().describe('議題'),
    content: z.string().describe('議事録内容（Markdown）'),
  }),
  execute: async (input) => {
    const { projectId, date, topic, content } = input;

    const GitHubIntegration = require('../../github-integration');
    const github = new GitHubIntegration();

    try {
      const result = await github.commitMinutes({
        project_id: projectId,
        date,
        topic,
        content,
      });

      return {
        success: true,
        path: result.path,
        message: `議事録をコミットしました: ${result.path}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
