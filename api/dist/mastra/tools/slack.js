"use strict";
// mastra/tools/slack.ts
// Slackツール - メッセージ送信、リアクション等
Object.defineProperty(exports, "__esModule", { value: true });
exports.slackGetUserInfoTool = exports.slackAddReactionTool = exports.slackPostMessageTool = void 0;
const tools_1 = require("@mastra/core/tools");
const zod_1 = require("zod");
// メッセージ送信ツール
exports.slackPostMessageTool = (0, tools_1.createTool)({
    id: 'slack_post_message',
    description: 'Slackにメッセージを送信する',
    inputSchema: zod_1.z.object({
        channel: zod_1.z.string().describe('チャンネルID'),
        text: zod_1.z.string().describe('メッセージ本文'),
        threadTs: zod_1.z.string().optional().describe('スレッドのタイムスタンプ（返信時）'),
        blocks: zod_1.z.array(zod_1.z.any()).optional().describe('Block Kit形式のUI'),
    }),
    execute: async ({ context: inputContext }) => {
        const { channel, text, threadTs, blocks } = inputContext;
        // Slack Boltクライアントは外部から注入する想定
        // 実際の実行時はbridge経由でapp.clientを渡す
        const slackClient = global.__manaSlackClient;
        if (!slackClient) {
            return {
                success: false,
                error: 'Slack client not initialized',
            };
        }
        try {
            const result = await slackClient.chat.postMessage({
                channel,
                text,
                thread_ts: threadTs,
                blocks,
            });
            return {
                success: true,
                ts: result.ts,
                channel: result.channel,
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
// リアクション追加ツール
exports.slackAddReactionTool = (0, tools_1.createTool)({
    id: 'slack_add_reaction',
    description: 'Slackメッセージにリアクションを追加する',
    inputSchema: zod_1.z.object({
        channel: zod_1.z.string().describe('チャンネルID'),
        timestamp: zod_1.z.string().describe('メッセージのタイムスタンプ'),
        emoji: zod_1.z.string().describe('絵文字名（例: white_check_mark）'),
    }),
    execute: async ({ context: inputContext }) => {
        const { channel, timestamp, emoji } = inputContext;
        const slackClient = global.__manaSlackClient;
        if (!slackClient) {
            return {
                success: false,
                error: 'Slack client not initialized',
            };
        }
        try {
            await slackClient.reactions.add({
                channel,
                timestamp,
                name: emoji,
            });
            return {
                success: true,
                message: `Added :${emoji}: reaction`,
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
// ユーザー情報取得ツール
exports.slackGetUserInfoTool = (0, tools_1.createTool)({
    id: 'slack_get_user_info',
    description: 'SlackユーザーIDから名前等の情報を取得する',
    inputSchema: zod_1.z.object({
        userId: zod_1.z.string().describe('SlackユーザーID'),
    }),
    execute: async ({ context: inputContext }) => {
        const { userId } = inputContext;
        const slackClient = global.__manaSlackClient;
        if (!slackClient) {
            return {
                success: false,
                error: 'Slack client not initialized',
            };
        }
        try {
            const result = await slackClient.users.info({ user: userId });
            return {
                success: true,
                user: {
                    id: result.user?.id,
                    name: result.user?.name,
                    realName: result.user?.real_name,
                    displayName: result.user?.profile?.display_name,
                },
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
//# sourceMappingURL=slack.js.map