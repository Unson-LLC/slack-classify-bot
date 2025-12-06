// mastra/bridge.ts
// 既存JavaScriptコードからMastraエージェントを呼び出すブリッジ
// llm-integration.jsとの互換性を提供

import { mastra, getProjectPMByChannel, getAgent, allAgents } from './index.js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const BEDROCK_REGION = 'us-east-1';
const BRAINBASE_CONTEXT_BUCKET = 'brainbase-context-593793022993';

/**
 * Slackクライアントを設定する
 * 既存のindex.jsから呼び出して、Slackツールが使えるようにする
 */
export function setSlackClient(client: any): void {
  (global as any).__manaSlackClient = client;
}

/**
 * S3からプロジェクトコンテキストを取得（llm-integration.js互換）
 */
export async function getProjectContext(projectName: string): Promise<string | null> {
  if (!projectName) return null;

  const s3Client = new S3Client({ region: BEDROCK_REGION });

  try {
    const command = new GetObjectCommand({
      Bucket: BRAINBASE_CONTEXT_BUCKET,
      Key: `${projectName}.txt`,
    });

    const response = await s3Client.send(command);
    const context = await response.Body?.transformToString();
    console.log(`Loaded brainbase context for project: ${projectName} (${context?.length || 0} chars)`);
    return context || null;
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      console.log(`No brainbase context found for project: ${projectName}`);
    } else {
      console.warn(`Failed to load brainbase context for ${projectName}:`, error.message);
    }
    return null;
  }
}

/**
 * S3から共通用語集を取得
 */
export async function getCommonGlossary(): Promise<string | null> {
  const s3Client = new S3Client({ region: BEDROCK_REGION });

  try {
    const command = new GetObjectCommand({
      Bucket: BRAINBASE_CONTEXT_BUCKET,
      Key: 'brainbase.txt',
    });

    const response = await s3Client.send(command);
    const context = await response.Body?.transformToString();

    // 用語集セクションのみ抽出
    const glossaryMatch = context?.match(/## 用語集[\s\S]*?(?=##|$)/);
    if (glossaryMatch) {
      console.log(`Loaded common glossary (${glossaryMatch[0].length} chars)`);
      return glossaryMatch[0];
    }

    console.log('No glossary section found in brainbase.txt');
    return null;
  } catch (error: any) {
    console.warn('Failed to load common glossary:', error.message);
    return null;
  }
}

/**
 * 会議要約を生成する（llm-integration.js互換）
 * 既存のsummarizeText()を置き換え
 */
export async function summarizeText(text: string): Promise<string | null> {
  if (!text || text.trim() === '') return null;

  const agent = allAgents.meetingAgent;
  if (!agent) {
    throw new Error('Meeting agent not found');
  }

  // 共通用語集を取得
  const glossary = await getCommonGlossary();

  const glossarySection = glossary
    ? `
# 固有名詞の修正ルール（最重要）
以下の用語集に従って、音声認識の誤りを正しい表記に修正してください：
- 「運送」「運尊」「うんそん」→「UNSON」
- 「場面」「ゼイムス」「ジェームス」→「Zeims」
- 「千里眼」「せんりがん」→「Senrigan」
- 「アイドル」「アイトル」→「Aitle」
- 「テックナイト」→「TechKnight」

${glossary}
`
    : '';

  const prompt = `以下の会議議事録を読み、会議の概要を抽出・要約してください。
${glossarySection}
# 要件
- 会議全体の目的と結論を2〜3文で簡潔にまとめる
- 「会議の概要」という見出しは不要で、本文のみを出力

# 制約
- ネクストアクションやTODOは含めない
- 詳細な議論内容は省略し、核心部分のみを短く記述
- **固有名詞は必ず上記の用語集に従って正しい表記に修正すること。**

# 議事録
${text.substring(0, 180000)}
`;

  try {
    const result = await agent.generate(prompt);
    return result.text;
  } catch (error) {
    console.error('Mastra summarizeText error:', error);
    return null;
  }
}

// 後方互換性のためのエイリアス
export const summarizeMeeting = summarizeText;

/**
 * Slackメッセージからタスクを抽出する（llm-integration.js互換）
 */
export async function extractTaskFromMessage(
  message: string,
  channelName: string = '',
  senderName: string = ''
): Promise<{
  title: string;
  project_id: string;
  priority: string;
  due: string | null;
  context: string;
  requester: string;
} | null> {
  if (!message || message.trim() === '') return null;

  const agent = allAgents.taskAgent;
  if (!agent) {
    throw new Error('Task agent not found');
  }

  const prompt = `あなたはタスク抽出AIです。以下のSlackメッセージからタスク情報を抽出してJSON形式で出力してください。

# メッセージ情報
- チャンネル: ${channelName || '不明'}
- 送信者: ${senderName || '不明'}
- メッセージ: ${message}

# 出力形式
JSONのみを出力してください。

\`\`\`json
{
  "title": "タスクの簡潔なタイトル（30文字以内）",
  "project_id": "プロジェクトID（チャンネル名から推測、不明ならgeneral）",
  "priority": "high/medium/low（依頼の緊急度から判断）",
  "due": "期限（YYYY-MM-DD形式、明示されていればnull）",
  "context": "タスクの背景・詳細（元のメッセージを要約）",
  "requester": "依頼者名"
}
\`\`\`

# プロジェクトID候補
- salestailor: SalesTailor関連
- techknight: Tech Knight関連
- zeims: Zeims関連
- dialogai: DialogAI関連
- aitle: Aitle関連
- general: その他/不明

# 重要ルール
- このメッセージは @bot と @担当者 へのメンションを含む「タスク依頼」です
- 内容が短くても必ずJSON形式で出力してください
`;

  try {
    const result = await agent.generate(prompt);
    const rawResponse = result.text;

    // Parse JSON from response
    const jsonMatch = rawResponse.match(/\`\`\`json\s*([\s\S]*?)\s*\`\`\`/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed === null) return null;
      return parsed;
    }

    // Try parsing as raw JSON
    const trimmed = rawResponse.trim();
    if (trimmed === 'null') return null;
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed);
    }

    return null;
  } catch (error) {
    console.error('Mastra extractTaskFromMessage error:', error);
    return null;
  }
}

// 後方互換性のためのエイリアス
export const extractTasks = extractTaskFromMessage;

/**
 * プロジェクトAI PMに問い合わせる
 * チャンネル名またはプロジェクトIDでAI PMを特定し、brainbaseコンテキストを付与
 */
export async function askProjectPM(
  question: string,
  options: {
    projectId?: string;
    channelName?: string;
    threadId?: string;
    senderName?: string;
    includeContext?: boolean;
  }
): Promise<string> {
  let agent: any = null;
  let projectId: string | undefined = options.projectId;

  if (projectId) {
    const pmId = `${projectId}PM`;
    agent = getAgent(pmId);
  } else if (options.channelName) {
    agent = getProjectPMByChannel(options.channelName);
    // チャンネル名からプロジェクトIDを推定
    const { getProjectByChannel } = await import('./config/projects.js');
    const project = getProjectByChannel(options.channelName);
    projectId = project?.id;
  }

  if (!agent) {
    return 'このチャンネルに対応するAI PMが見つかりません。';
  }

  // brainbaseコンテキストを取得（デフォルトで有効）
  let contextSection = '';
  if (options.includeContext !== false && projectId) {
    const projectContext = await getProjectContext(projectId);
    if (projectContext) {
      contextSection = `
# プロジェクトコンテキスト（brainbase）
以下は${projectId}プロジェクトの最新情報です。回答時に参照してください。

${projectContext.substring(0, 30000)}

---

`;
    }
  }

  // 質問者情報を付与
  const senderInfo = options.senderName ? `（質問者: ${options.senderName}）` : '';

  const prompt = `${contextSection}${senderInfo}${question}`;

  try {
    const result = await agent.generate(prompt);
    return result.text;
  } catch (error) {
    console.error('askProjectPM error:', error);
    return 'すみません、回答の生成中にエラーが発生しました。';
  }
}

interface MeetingMinutesResult {
  raw: string;
  minutes: string;
  actions: Array<{
    task: string;
    assignee: string;
    deadline: string;
  }>;
}

/**
 * 文字起こしデータから詳細な議事録を生成する（llm-integration.js互換）
 */
export async function generateMeetingMinutes(
  text: string,
  projectName: string | null = null
): Promise<MeetingMinutesResult | null> {
  if (!text || text.trim() === '') return null;

  const agent = allAgents.meetingAgent;
  if (!agent) {
    throw new Error('Meeting agent not found');
  }

  // brainbaseコンテキストを取得
  const projectContext = projectName ? await getProjectContext(projectName) : null;

  const contextSection = projectContext
    ? `
# プロジェクトコンテキスト

## 固有名詞の修正ルール（最重要）
**必ず以下のルールに従ってください：**
- 「運送」「運尊」→「UNSON」
- 「場面」「ジェームス」→「Zeims」
- 「テックナイト」→「TechKnight」

${projectContext.substring(0, 50000)}

---

`
    : '';

  const prompt = `あなたは優秀な議事録作成者です。以下の会議の文字起こしデータから、読み手がすぐに状況を理解し行動できる議事録を作成してください。
${contextSection}
# 出力形式：JSON

以下のJSON形式で出力してください。JSONのみを出力し、前後に説明文を付けないでください。

\`\`\`json
{
  "minutes": "議事録本文（Slack mrkdwn記法）",
  "actions": [
    {
      "task": "具体的なアクション内容",
      "assignee": "担当者のフルネーム",
      "deadline": "期限"
    }
  ]
}
\`\`\`

## minutesフィールドの内容（Slack mrkdwn記法）
- タイトル行: MM-DD 会議名
- 導入文（1〜2文）
- トピック別セクション
- *太字*: 重要なキーワード
- _斜体_: サブ見出し

## actionsフィールドの内容
- task: 具体的なアクション内容
- assignee: 担当者の「苗字 名前」形式のフルネーム
- deadline: 期限（例：今週中、12/5）

# 文字起こしデータ
${text.substring(0, 180000)}
`;

  try {
    const result = await agent.generate(prompt);
    const rawResponse = result.text;

    // Parse JSON response
    const jsonMatch = rawResponse.match(/\`\`\`json\s*([\s\S]*?)\s*\`\`\`/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      return {
        raw: rawResponse,
        minutes: parsed.minutes || '',
        actions: parsed.actions || [],
      };
    }

    // Try parsing as raw JSON
    const trimmed = rawResponse.trim();
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      return {
        raw: rawResponse,
        minutes: parsed.minutes || '',
        actions: parsed.actions || [],
      };
    }

    // Return as fallback
    return { raw: rawResponse, minutes: rawResponse, actions: [] };
  } catch (error) {
    console.error('Mastra generateMeetingMinutes error:', error);
    return null;
  }
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
  const minutesData = await generateMeetingMinutes(transcript, options.projectId);

  if (!minutesData) {
    return { summary: '', nextActions: '' };
  }

  const nextActions = minutesData.actions
    .map(a => `- ${a.task}（${a.assignee}、${a.deadline}）`)
    .join('\n');

  return {
    summary: minutesData.minutes,
    nextActions,
  };
}

// CommonJS互換エクスポート（既存JSから使用するため）
module.exports = {
  setSlackClient,
  summarizeText,
  summarizeMeeting,
  extractTaskFromMessage,
  extractTasks,
  generateMeetingMinutes,
  askProjectPM,
  generateAndCommitMinutes,
  getProjectContext,
  getCommonGlossary,
  mastra,
};
