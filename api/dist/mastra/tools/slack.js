// mastra/tools/slack.ts
// Slackツール - メッセージ送信、リアクション等
import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';
// メッセージ送信ツール
export const slackPostMessageTool = createTool({
    id: 'slack_post_message',
    description: 'Slackにメッセージを送信する',
    inputSchema: z.object({
        channel: z.string().describe('チャンネルID'),
        text: z.string().describe('メッセージ本文'),
        threadTs: z.string().optional().describe('スレッドのタイムスタンプ（返信時）'),
    }),
    execute: async (input) => {
        const { channel, text, threadTs } = input;
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
export const slackAddReactionTool = createTool({
    id: 'slack_add_reaction',
    description: 'Slackメッセージにリアクションを追加する',
    inputSchema: z.object({
        channel: z.string().describe('チャンネルID'),
        timestamp: z.string().describe('メッセージのタイムスタンプ'),
        emoji: z.string().describe('絵文字名（例: white_check_mark）'),
    }),
    execute: async (input) => {
        const { channel, timestamp, emoji } = input;
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
export const slackGetUserInfoTool = createTool({
    id: 'slack_get_user_info',
    description: 'SlackユーザーIDから名前等の情報を取得する',
    inputSchema: z.object({
        userId: z.string().describe('SlackユーザーID'),
    }),
    execute: async (input) => {
        const { userId } = input;
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