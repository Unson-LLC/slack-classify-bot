"use strict";
// mastra/tools/github.ts
// GitHubツール - タスク追加、議事録コミット等
Object.defineProperty(exports, "__esModule", { value: true });
exports.githubCommitMinutesTool = exports.githubAppendTaskTool = void 0;
const tools_1 = require("@mastra/core/tools");
const zod_1 = require("zod");
// タスク追加ツール
exports.githubAppendTaskTool = (0, tools_1.createTool)({
    id: 'github_append_task',
    description: 'タスクを_tasks/index.mdに追加する',
    inputSchema: zod_1.z.object({
        title: zod_1.z.string().describe('タスクタイトル'),
        projectId: zod_1.z.string().describe('プロジェクトID（例: salestailor, zeims）'),
        assignee: zod_1.z.string().describe('担当者名（brainbase表記）'),
        due: zod_1.z.string().optional().describe('期限（YYYY-MM-DD）'),
        context: zod_1.z.string().optional().describe('背景・詳細'),
        slackLink: zod_1.z.string().optional().describe('Slackメッセージへのリンク'),
    }),
    execute: async ({ context: inputContext }) => {
        const { title, projectId, assignee, due, context, slackLink } = inputContext;
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
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },
});
// 議事録コミットツール
exports.githubCommitMinutesTool = (0, tools_1.createTool)({
    id: 'github_commit_minutes',
    description: '議事録をGitHubリポジトリにコミットする',
    inputSchema: zod_1.z.object({
        projectId: zod_1.z.string().describe('プロジェクトID'),
        date: zod_1.z.string().describe('日付（YYYY-MM-DD）'),
        topic: zod_1.z.string().describe('議題'),
        content: zod_1.z.string().describe('議事録内容（Markdown）'),
    }),
    execute: async ({ context: inputContext }) => {
        const { projectId, date, topic, content } = inputContext;
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
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },
});
//# sourceMappingURL=github.js.map