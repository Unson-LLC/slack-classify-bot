/**
 * Slackクライアントを設定する
 * 既存のindex.jsから呼び出して、Slackツールが使えるようにする
 */
export declare function setSlackClient(client: any): void;
/**
 * 会議要約を生成する
 * 既存のllm-integration.jsのsummarizeText()を置き換え
 */
export declare function summarizeMeeting(transcript: string, options?: {
    projectId?: string;
    threadId?: string;
}): Promise<string>;
/**
 * タスクを抽出する
 * 既存のllm-integration.jsのextractTaskFromMessage()を置き換え
 */
export declare function extractTasks(message: string, options?: {
    projectId?: string;
    channelName?: string;
}): Promise<{
    tasks: Array<{
        title: string;
        assignee: string;
        due?: string;
        context?: string;
    }>;
}>;
/**
 * プロジェクトAI PMに問い合わせる
 * チャンネル名またはプロジェクトIDでAI PMを特定
 */
export declare function askProjectPM(question: string, options: {
    projectId?: string;
    channelName?: string;
    threadId?: string;
}): Promise<string>;
/**
 * 議事録を生成してGitHubにコミットする
 */
export declare function generateAndCommitMinutes(transcript: string, options: {
    projectId: string;
    date: string;
    topic: string;
    channelId?: string;
}): Promise<{
    summary: string;
    nextActions: string;
    commitPath?: string;
}>;
//# sourceMappingURL=bridge.d.ts.map