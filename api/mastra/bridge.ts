// mastra/bridge.ts
// 既存JavaScriptコードからMastraエージェントを呼び出すブリッジ

import { mastra, getProjectPMByChannel, getAgent, allAgents } from './index.js';

/**
 * Slackクライアントを設定する
 * 既存のindex.jsから呼び出して、Slackツールが使えるようにする
 */
export function setSlackClient(client: any): void {
  (global as any).__manaSlackClient = client;
}

/**
 * 会議要約を生成する
 * 既存のllm-integration.jsのsummarizeText()を置き換え
 */
export async function summarizeMeeting(
  transcript: string,
  _options?: { projectId?: string; threadId?: string }
): Promise<string> {
  const agent = allAgents.meetingAgent;
  if (!agent) {
    throw new Error('Meeting agent not found');
  }

  const prompt = `以下の会議の文字起こしを要約してください:\n\n${transcript}`;

  const result = await agent.generate(prompt);

  return result.text;
}

/**
 * タスクを抽出する
 * 既存のllm-integration.jsのextractTaskFromMessage()を置き換え
 */
export async function extractTasks(
  message: string,
  _options?: { projectId?: string; channelName?: string }
): Promise<{
  tasks: Array<{
    title: string;
    assignee: string;
    due?: string;
    context?: string;
  }>;
}> {
  const agent = allAgents.taskAgent;
  if (!agent) {
    throw new Error('Task agent not found');
  }

  const prompt = `以下のメッセージからタスクを抽出してJSON形式で返してください:\n\n${message}`;

  const result = await agent.generate(prompt);

  // JSONをパース
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Failed to parse task extraction result:', e);
  }

  return { tasks: [] };
}

/**
 * プロジェクトAI PMに問い合わせる
 * チャンネル名またはプロジェクトIDでAI PMを特定
 */
export async function askProjectPM(
  question: string,
  options: { projectId?: string; channelName?: string; threadId?: string }
): Promise<string> {
  let agent: any = null;

  if (options.projectId) {
    const pmId = `${options.projectId}PM`;
    agent = getAgent(pmId);
  } else if (options.channelName) {
    agent = getProjectPMByChannel(options.channelName);
  }

  if (!agent) {
    return 'このチャンネルに対応するAI PMが見つかりません。';
  }

  const result = await agent.generate(question);

  return result.text;
}

/**
 * 議事録を生成してGitHubにコミットする
 */
export async function generateAndCommitMinutes(
  transcript: string,
  options: {
    projectId: string;
    date: string;
    topic: string;
    channelId?: string;
  }
): Promise<{ summary: string; nextActions: string; commitPath?: string }> {
  const agent = allAgents.meetingAgent;
  if (!agent) {
    throw new Error('Meeting agent not found');
  }

  const prompt = `以下の会議文字起こしから議事録を生成してください。
プロジェクト: ${options.projectId}
日付: ${options.date}
議題: ${options.topic}

文字起こし:
${transcript}`;

  const result = await agent.generate(prompt);

  // TODO: 議事録をパースしてGitHubにコミット
  // 現時点では要約のみ返す

  return {
    summary: result.text,
    nextActions: '', // 将来的にはNext Actionを抽出
  };
}

// CommonJS互換エクスポート（既存JSから使用するため）
module.exports = {
  setSlackClient,
  summarizeMeeting,
  extractTasks,
  askProjectPM,
  generateAndCommitMinutes,
  mastra,
};
