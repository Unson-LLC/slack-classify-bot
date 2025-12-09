// mastra/bridge.ts
// 既存JavaScriptコードからMastraエージェントを呼び出すブリッジ
// llm-integration.jsとの互換性を提供
import { getManaByTeamId, getAgent, allAgents, canAccessProject } from './index.js';
import { getDefaultWorkspace } from './config/workspaces.js';
import { getProjectByChannel, getAirtableConfigByChannel } from './config/projects.js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { setCurrentProjectId } from './tools/source-code.js';
const BEDROCK_REGION = 'us-east-1';
const BRAINBASE_CONTEXT_BUCKET = 'brainbase-context-593793022993';
// プロジェクト名のキーワードマッピング（質問文から検出用）
const PROJECT_KEYWORDS = {
    'zeims': ['zeims', 'ゼイムス', '採用管理', '採用'],
    'salestailor': ['salestailor', 'セールステイラー', 'セールスレター'],
    'techknight': ['techknight', 'テックナイト', 'tech knight', 'エンジニアリング'],
    'aitle': ['aitle', 'アイトル', 'タイトル生成'],
    'dialogai': ['dialogai', 'ダイアログ', '会議ファシリ'],
    'senrigan': ['senrigan', 'センリガン', '千里眼'],
    'baao': ['baao', 'バーオ', 'AI道場'],
    'brainbase': ['brainbase', 'ブレインベース'],
    'ncom': ['ncom', 'ドコモ', 'docomo', 'catalyst'],
};
/**
 * 質問文からプロジェクトIDを検出する
 */
function detectProjectFromQuestion(question) {
    const lowerQuestion = question.toLowerCase();
    for (const [projectId, keywords] of Object.entries(PROJECT_KEYWORDS)) {
        for (const keyword of keywords) {
            if (lowerQuestion.includes(keyword.toLowerCase())) {
                console.log(`Detected project "${projectId}" from keyword "${keyword}"`);
                return projectId;
            }
        }
    }
    return null;
}
/**
 * Slackクライアントを設定する
 * 既存のindex.jsから呼び出して、Slackツールが使えるようにする
 */
export function setSlackClient(client) {
    global.__manaSlackClient = client;
}
/**
 * S3からプロジェクトコンテキストを取得
 * ワークスペースのスコープをチェックしてからアクセス
 */
export async function getProjectContext(projectName, workspace) {
    if (!projectName)
        return null;
    // スコープチェック（ワークスペースが指定されている場合）
    if (workspace) {
        const projectId = `proj_${projectName}`;
        if (!canAccessProject(workspace, projectId)) {
            console.warn(`[越権] Workspace ${workspace.id} attempted to access project ${projectName}`);
            return null;
        }
    }
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
    }
    catch (error) {
        if (error.name === 'NoSuchKey') {
            console.log(`No brainbase context found for project: ${projectName}`);
        }
        else {
            console.warn(`Failed to load brainbase context for ${projectName}:`, error.message);
        }
        return null;
    }
}
/**
 * S3から共通用語集を取得
 */
export async function getCommonGlossary() {
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
    }
    catch (error) {
        console.warn('Failed to load common glossary:', error.message);
        return null;
    }
}
/**
 * 会議要約を生成する（llm-integration.js互換）
 * 既存のsummarizeText()を置き換え
 */
export async function summarizeText(text) {
    if (!text || text.trim() === '')
        return null;
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
    }
    catch (error) {
        console.error('Mastra summarizeText error:', error);
        return null;
    }
}
// 後方互換性のためのエイリアス
export const summarizeMeeting = summarizeText;
/**
 * Slackメッセージからタスクを抽出する（llm-integration.js互換）
 */
export async function extractTaskFromMessage(message, channelName = '', senderName = '') {
    if (!message || message.trim() === '')
        return null;
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
- baao: BAAO関連
- senrigan: Senrigan関連
- ncom: NTTCom関連
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
            if (parsed === null)
                return null;
            return parsed;
        }
        // Try parsing as raw JSON
        const trimmed = rawResponse.trim();
        if (trimmed === 'null')
            return null;
        if (trimmed.startsWith('{')) {
            return JSON.parse(trimmed);
        }
        return null;
    }
    catch (error) {
        console.error('Mastra extractTaskFromMessage error:', error);
        return null;
    }
}
// 後方互換性のためのエイリアス
export const extractTasks = extractTaskFromMessage;
/**
 * ワークスペースのManaエージェントに問い合わせる
 * Team IDからワークスペースを特定し、スコープ内のコンテキストのみアクセス
 */
// ツール名を日本語で表示
const TOOL_DISPLAY_NAMES = {
    'list_source_files': '📂 ファイル一覧を取得',
    'read_source_file': '📄 ファイルを読み取り',
    'search_source_code': '🔍 コードを検索',
    'web_search': '🌐 Web検索',
    'web_extract': '📰 Webページを解析',
    'airtable_list_records': '📊 Airtableからデータ取得',
    'airtable_search_records': '🔎 Airtableを検索',
    'gmail_search_messages': '📧 メールを検索',
    'gmail_get_message': '📧 メールを取得',
};
export async function askMana(question, options) {
    // 1. Team IDからワークスペースとManaを特定
    let workspace;
    let agent = null;
    if (options.teamId) {
        const mana = getManaByTeamId(options.teamId);
        if (mana) {
            agent = mana.agent;
            workspace = mana.workspace;
            console.log(`[INFO] Using ${workspace.id}Mana for team ${options.teamId}`);
        }
    }
    // 2. Team IDがない場合はデフォルト（unson）を使用
    if (!agent) {
        workspace = getDefaultWorkspace();
        agent = getAgent(`${workspace.id}Mana`);
        console.log(`[INFO] No team ID provided, using default workspace: ${workspace.id}`);
    }
    if (!agent) {
        return 'エージェントの初期化に失敗しました。';
    }
    // 3. プロジェクトIDを決定（優先順位: options.projectId > キーワード検出）
    let projectId = options.projectId || detectProjectFromQuestion(question);
    if (projectId && projectId !== 'general') {
        console.log(`[INFO] Project context: ${projectId} (from ${options.projectId ? 'channel mapping' : 'keyword detection'})`);
    }
    // 4. プロジェクトがスコープ内かチェック
    if (projectId && workspace) {
        if (!canAccessProject(workspace, `proj_${projectId}`)) {
            console.warn(`[越権] ${workspace.id}Mana cannot access project ${projectId}`);
            return `申し訳ありませんが、${projectId}プロジェクトの情報にはアクセス権限がありません。`;
        }
    }
    // 5. brainbaseコンテキストを取得（スコープチェック付き）
    let contextSection = '';
    if (options.includeContext !== false) {
        if (projectId) {
            const projectContext = await getProjectContext(projectId, workspace);
            if (projectContext) {
                contextSection = `
# プロジェクトコンテキスト（brainbase）
以下は${projectId}プロジェクトの最新情報です。回答時に参照してください。

${projectContext.substring(0, 30000)}

---

`;
            }
        }
        else {
            // プロジェクト不明の場合は共通用語集のみ
            const glossary = await getCommonGlossary();
            if (glossary) {
                contextSection = `
# 共通コンテキスト（brainbase）
${glossary}

---

`;
            }
        }
    }
    // 6. 質問者情報を付与
    const senderInfo = options.senderName ? `（質問者: ${options.senderName}）` : '';
    // 7. Slack mrkdwn形式の指示
    const formatInstruction = `
【出力フォーマット: Slack mrkdwn】
必ず以下のSlack記法で回答してください：
- 太字: *テキスト*（アスタリスク1つ）
- 箇条書き: • または - で開始
- 見出し: *見出し* + 改行

禁止：
- **太字**（アスタリスク2つ）は使わない
- # ## などのMarkdown見出しは使わない
- 番号付きリスト（1. 2. 3.）は使わない

`;
    // 8. スコープ制限の明示（重要：越権防止）
    const accessibleProjects = workspace?.projects.map(p => p.replace('proj_', '')).join(', ') || '';
    const scopeRestriction = workspace ? `
【アクセス制御（最重要）】
あなたは *${workspace.name}* ワークスペース専用のManaです。
アクセス可能なプロジェクト: ${accessibleProjects}

以下のルールを *必ず* 守ってください：
1. 上記リストにないプロジェクト（例：${workspace.id === 'salestailor' ? 'Zeims, BAAO, DialogAI, TechKnight' : workspace.id === 'techknight' ? 'Zeims, BAAO, SalesTailor, DialogAI' : 'SalesTailor, TechKnight'}等）について質問されても、*絶対に回答しない*
2. スコープ外のプロジェクトについて聞かれたら「${workspace.name}ワークスペースからはアクセス権限がありません」と返答
3. たとえ一般知識として知っていても、スコープ外の情報は提供しない

` : '';
    // 9. Airtableコンテキスト（チャンネル名からプロジェクトのBase IDを特定）
    let airtableContext = '';
    if (options.channelName) {
        const airtableConfig = getAirtableConfigByChannel(options.channelName);
        if (airtableConfig) {
            const detectedProject = getProjectByChannel(options.channelName);
            airtableContext = `
【Airtable設定（このチャンネルのプロジェクト用）】
プロジェクト: ${detectedProject?.name || 'unknown'}
- Base ID: ${airtableConfig.baseId}
- 機能要求テーブル: ${airtableConfig.productFeaturesTableId}
- 要件テーブル: ${airtableConfig.requirementsTableId}

Airtableツール使用時は必ずこのBase IDを使用してください。ユーザーにBase IDを聞く必要はありません。

`;
            console.log(`[INFO] Airtable context injected for ${detectedProject?.name}: baseId=${airtableConfig.baseId}`);
        }
    }
    const prompt = `${formatInstruction}${scopeRestriction}${airtableContext}${contextSection}${senderInfo}${question}`;
    try {
        // ソースコードツールにプロジェクトIDを設定
        if (projectId) {
            setCurrentProjectId(`proj_${projectId}`);
        }
        // 進捗表示用のスロットリング（2秒に1回まで）
        let lastProgressUpdate = 0;
        const PROGRESS_THROTTLE_MS = 2000;
        // ツール呼び出しを有効化（auto = LLMが必要に応じてツールを使う）
        const result = await agent.generate(prompt, {
            toolChoice: 'auto',
            maxSteps: 50, // ツール呼び出しの最大ステップ数（ソースコード調査には複数ステップ必要）
            onStepFinish: options.onProgress ? async (step) => {
                const now = Date.now();
                if (now - lastProgressUpdate < PROGRESS_THROTTLE_MS) {
                    return; // スロットリング
                }
                // ツール呼び出しがあれば進捗を表示
                if (step.toolCalls && step.toolCalls.length > 0) {
                    const toolCall = step.toolCalls[0];
                    // Mastraのtool call構造: { type, runId, from, payload: { toolCallId, toolName, args } }
                    const payload = toolCall.payload || toolCall;
                    const toolName = payload.toolName || payload.name || toolCall.toolName || toolCall.name;
                    console.log('[onStepFinish] toolName:', toolName, 'from payload:', payload.toolName);
                    const displayName = TOOL_DISPLAY_NAMES[toolName] || `🔧 ${toolName}`;
                    // ツールの引数から追加情報を取得
                    const args = payload.args || toolCall.args || {};
                    let detail = '';
                    if (args.filePath) {
                        detail = `: \`${args.filePath}\``;
                    }
                    else if (args.path) {
                        detail = `: \`${args.path}\``;
                    }
                    else if (args.query) {
                        detail = `: "${args.query}"`;
                    }
                    try {
                        await options.onProgress(`${displayName}${detail}...`);
                        lastProgressUpdate = now;
                    }
                    catch (e) {
                        console.warn('Progress update failed:', e);
                    }
                }
            } : undefined,
        });
        return result.text;
    }
    catch (error) {
        console.error('askMana error:', error);
        return 'すみません、回答の生成中にエラーが発生しました。';
    }
}
// 後方互換性のためのエイリアス（askProjectPMを呼び出すコードのため）
export async function askProjectPM(question, options) {
    // teamIdがあればaskManaを使用、なければデフォルトで動作
    return askMana(question, {
        teamId: options.teamId,
        channelName: options.channelName,
        threadId: options.threadId,
        senderName: options.senderName,
        includeContext: options.includeContext,
        projectId: options.projectId, // チャンネルから解決したプロジェクトID
        onProgress: options.onProgress, // 進捗コールバック
    });
}
/**
 * 文字起こしデータから詳細な議事録を生成する（llm-integration.js互換）
 */
export async function generateMeetingMinutes(text, projectName = null) {
    if (!text || text.trim() === '')
        return null;
    const agent = allAgents.meetingAgent;
    if (!agent) {
        throw new Error('Meeting agent not found');
    }
    // brainbaseコンテキストを取得（スコープチェックなし、会議エージェントは共通）
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
    }
    catch (error) {
        console.error('Mastra generateMeetingMinutes error:', error);
        return null;
    }
}
/**
 * 議事録を生成してGitHubにコミットする
 */
export async function generateAndCommitMinutes(transcript, options) {
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
// ESMエクスポート（named exportsで提供済み）
//# sourceMappingURL=bridge.js.map