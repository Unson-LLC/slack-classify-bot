const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

// Mastra切り替えフラグ（環境変数で制御）
const USE_MASTRA = process.env.USE_MASTRA === 'true';

// Mastraブリッジの遅延読み込み
let mastraBridge = null;
function getMastraBridge() {
  if (!mastraBridge && USE_MASTRA) {
    try {
      mastraBridge = require('./dist/mastra/bridge.js');
      console.log('Mastra bridge loaded successfully');
    } catch (error) {
      console.warn('Failed to load Mastra bridge, falling back to Bedrock:', error.message);
      return null;
    }
  }
  return mastraBridge;
}

// Force region to us-east-1 - Claude Sonnet 4 and 3.7 are available here
const BEDROCK_REGION = "us-east-1";
const BRAINBASE_CONTEXT_BUCKET = "brainbase-context-593793022993";

// Sonnet 4.5 inference profile for US regions (supports us-east-1)
const DEFAULT_MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const FALLBACK_MODEL_ID = 'us.anthropic.claude-sonnet-4-20250514-v1:0';

const resolveModelId = () => process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;

async function invokeBedrock(payload, initialModelId) {
  const modelId = initialModelId || resolveModelId();

  const send = async (model) => {
    const requestClient = new BedrockRuntimeClient({
      region: BEDROCK_REGION,
      endpoint: `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com`,
      credentials: undefined
    });

    const command = new InvokeModelCommand({
      contentType: "application/json",
      body: JSON.stringify(payload),
      modelId: model,
    });

    const apiResponse = await requestClient.send(command);
    const decoded = new TextDecoder().decode(apiResponse.body);
    return JSON.parse(decoded);
  };

  try {
    return await send(modelId);
  } catch (error) {
    const message = error?.message || '';
    const shouldFallback = (
      modelId !== FALLBACK_MODEL_ID &&
      (
        error.name === 'AccessDeniedException' ||
        error.name === 'ValidationException' ||
        message.includes('Marketplace') ||
        message.includes('throughput isn’t supported')
      )
    );

    if (shouldFallback) {
      console.warn(`Primary model ${modelId} failed with ${error.name}. Falling back to ${FALLBACK_MODEL_ID}`);
      try {
        return await send(FALLBACK_MODEL_ID);
      } catch (fallbackError) {
        console.error('Fallback Bedrock call failed:', fallbackError);
        throw fallbackError;
      }
    }

    throw error;
  }
}

// DO NOT create global client - create fresh client for each request

/**
 * S3から共通用語集（brainbase.txt）を取得します。
 * 初回要約時にプロジェクト不明でも固有名詞を修正するために使用。
 * @returns {Promise<string|null>} - 用語集テキスト、または取得失敗時にnull
 */
async function getCommonGlossary() {
  const s3Client = new S3Client({ region: BEDROCK_REGION });

  try {
    const command = new GetObjectCommand({
      Bucket: BRAINBASE_CONTEXT_BUCKET,
      Key: 'brainbase.txt'
    });

    const response = await s3Client.send(command);
    const context = await response.Body.transformToString();

    // 用語集セクションのみ抽出
    const glossaryMatch = context.match(/## 用語集[\s\S]*?(?=##|$)/);
    if (glossaryMatch) {
      console.log(`Loaded common glossary (${glossaryMatch[0].length} chars)`);
      return glossaryMatch[0];
    }

    console.log('No glossary section found in brainbase.txt');
    return null;
  } catch (error) {
    console.warn('Failed to load common glossary:', error.message);
    return null;
  }
}

/**
 * S3からプロジェクトコンテキストを取得します。
 * @param {string} projectName - プロジェクト名（例: "ncom", "baao"）
 * @returns {Promise<string|null>} - コンテキストテキスト、または取得失敗時にnull
 */
async function getProjectContext(projectName) {
  if (!projectName) {
    return null;
  }

  const s3Client = new S3Client({ region: BEDROCK_REGION });

  try {
    const command = new GetObjectCommand({
      Bucket: BRAINBASE_CONTEXT_BUCKET,
      Key: `${projectName}.txt`
    });

    const response = await s3Client.send(command);
    const context = await response.Body.transformToString();

    console.log(`Loaded brainbase context for project: ${projectName} (${context.length} chars)`);
    return context;
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      console.log(`No brainbase context found for project: ${projectName}`);
    } else {
      console.warn(`Failed to load brainbase context for ${projectName}:`, error.message);
    }
    return null;
  }
}

/**
 * テキストを要約し、ネクストアクションを抽出します。
 * @param {string} text - 要約するテキスト
 * @returns {Promise<string|null>} - 要約結果、またはエラー時にnull
 */
async function summarizeText(text) {
  if (!text || text.trim() === "") {
    return null;
  }

  // Mastraブリッジが有効な場合は委譲
  const bridge = getMastraBridge();
  if (bridge) {
    console.log('Using Mastra bridge for summarizeText');
    return bridge.summarizeText(text);
  }

  // 共通用語集を取得（固有名詞の修正用）
  const glossary = await getCommonGlossary();

  // モデルの最大トークン数を超えないようにテキストを切り詰める（安全策）
  const glossaryLength = glossary ? glossary.length : 0;
  const maxChars = 180000 - glossaryLength;
  const truncatedText = text.length > maxChars ? text.substring(0, maxChars) : text;

  // Use Claude Sonnet 4 via inference profile
  const modelId = resolveModelId();

  // Log the exact configuration being used
  console.log('=== BEDROCK CALL DEBUG ===');
  console.log('Forced Region:', BEDROCK_REGION);
  console.log('Model ID:', modelId);
  console.log('Glossary loaded:', glossary ? 'yes' : 'no');

  // 用語集セクション
  const glossarySection = glossary ? `
# 固有名詞の修正ルール（最重要）
以下の用語集に従って、音声認識の誤りを正しい表記に修正してください：
- 「運送」「運尊」「うんそん」→「UNSON」
- 「運送OS」「運尊OS」→「UNSON OS」
- 「場面」「ゼイムス」「ジェームス」→「Zeims」
- 「千里眼」「せんりがん」→「Senrigan」
- 「アイドル」「アイトル」→「Aitle」
- 「前側」「まえがわ」「マイワ」→「MyWa」
- 「テックナイト」→「TechKnight」
- 「バーオ」「バオ」→「BAAO」
- 「先生AI」→「生成AI」

${glossary}
` : '';

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
${truncatedText}
`;

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: prompt
      }]
    }]
  };

  try {
    const responseBody = await invokeBedrock(payload, modelId);

    if (responseBody.content && responseBody.content.length > 0) {
      return responseBody.content[0].text;
    } else {
      throw new Error("Bedrockからのレスポンス形式が不正です。");
    }
  } catch (error) {
    console.error("Bedrockでのテキスト要約中にエラーが発生しました:", error);
    // エラーが発生した場合はnullを返すことで、メインの処理フローを止めない
    return null;
  }
}

/**
 * Generate a meaningful filename from transcript content
 * @param {string} text - The transcript text
 * @returns {Promise<string|null>} - Generated filename or null on error
 */
async function generateFilename(text) {
  if (!text || text.trim() === "") {
    return null;
  }

  // Take first 2000 chars for filename generation
  const truncatedText = text.length > 2000 ? text.substring(0, 2000) : text;

  const modelId = resolveModelId();
  
  const prompt = `以下の会議議事録の内容から、GitHubに保存する際の短いファイル名を生成してください。

# 要件
- 内容を表す簡潔な名前（3-5単語程度）
- 英語で、全て小文字
- 単語間はハイフン（-）で接続
- 特殊文字や記号は使用しない
- 例: "weekly-team-standup", "product-roadmap-review", "client-meeting-abc-corp"

# 議事録（冒頭部分）
${truncatedText}

ファイル名のみを返してください（拡張子や日付は不要）。`;

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 100,
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: prompt
      }]
    }]
  };

  try {
    const responseBody = await invokeBedrock(payload, modelId);
    
    if (responseBody.content && responseBody.content.length > 0) {
      // Clean the generated filename
      const filename = responseBody.content[0].text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 50); // Max 50 chars
      
      return filename || null;
    }
    return null;
  } catch (error) {
    console.error("Error generating filename with Bedrock:", error);
    return null;
  }
}

/**
 * 文字起こしデータから詳細な議事録を生成します。
 * @param {string} text - 文字起こしデータ
 * @param {string} projectName - プロジェクト名（コンテキスト取得用、オプショナル）
 * @returns {Promise<string|null>} - 議事録、またはエラー時にnull
 */
async function generateMeetingMinutes(text, projectName = null) {
  if (!text || text.trim() === "") {
    return null;
  }

  // Mastraブリッジが有効な場合は委譲
  const bridge = getMastraBridge();
  if (bridge) {
    console.log('Using Mastra bridge for generateMeetingMinutes');
    return bridge.generateMeetingMinutes(text, projectName);
  }

  // brainbaseコンテキストを取得
  const projectContext = await getProjectContext(projectName);

  // モデルの最大トークン数を超えないようにテキストを切り詰める（安全策）
  // コンテキストがある場合は、その分を考慮して切り詰め
  const contextLength = projectContext ? projectContext.length : 0;
  const maxChars = 180000 - Math.min(contextLength, 50000);
  const truncatedText = text.length > maxChars ? text.substring(0, maxChars) : text;

  const modelId = resolveModelId();

  // コンテキストセクションを構築
  const contextSection = projectContext ? `
# プロジェクトコンテキスト

## 固有名詞の修正ルール（最重要）
**必ず以下のルールに従ってください：**
1. コンテキスト内の「用語集」セクションを最初に確認する
2. 用語集に記載された「誤認識パターン」を見つけたら、必ず「正しい表記」に置換する
3. 特に以下の誤変換に注意：
   - 「運送」「運尊」→「UNSON」
   - 「場面」「ジェームス」→「Zeims」
   - 「前側」「マイワ」→「MyWa」
   - 「運送OS」「運尊OS」→「UNSON OS」
   - 「先生AI」→「生成AI」

${projectContext}

---

` : '';

  const prompt = `あなたは優秀な議事録作成者です。以下の会議の文字起こしデータから、読み手がすぐに状況を理解し行動できる議事録を作成してください。
${contextSection}
# 最重要ルール：情報密度を維持する
- *会議が長ければ議事録も長くなる*：30分の会議と2時間の会議で同じ長さの議事録にしてはいけない
- *議論された内容は漏らさず記録する*：要約しすぎて情報が失われることを避ける
- *各トピックに十分な文脈を記述する*：1トピックにつき最低3〜5文の説明を含める
- 会議に参加していない人が読んでも「何が起きたか」「なぜそうなったか」が完全に理解できるレベルの詳細さを目指す

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

### 1. タイトル行
\`MM-DD 会議名: トピック1・トピック2・トピック3\`

### 2. 導入文（1〜2文）
会議の目的と主要な成果を端的に説明

### 3. トピック別セクション（メイン部分）
会議で議論された*すべてのトピック*について、以下の構造で詳細に記述：

*[トピック名]について*

_[サブトピック1]_
[現状・背景]：なぜこの議論が必要だったか、前提となる状況は何か
[議論の内容]：誰がどのような意見を述べたか、どのような選択肢が検討されたか
[結論・決定]：何が決まったか、または決まらなかったか
[理由・根拠]：なぜその結論に至ったか、どのような判断基準が使われたか

※*各サブトピックは必ず複数の文で説明する*（1行の箇条書きで終わらせない）
※議論の経緯、代替案、却下された理由なども含める
※具体的な数字、日付、人名、システム名は漏らさず記載

## actionsフィールドの内容

アクションアイテムを配列で記載：
- task: 具体的なアクション内容
- assignee: 担当者の「苗字 名前」形式のフルネーム（例：佐藤 圭吾、山本 力弥）
  ※役職（CTO、PM等）は含めない
- deadline: 期限（例：今週中、12/5、来週まで）

## Slack mrkdwn記法（minutesフィールド内で使用）
- *太字*: 重要なキーワード、決定事項
- _斜体_: サブ見出し
- \`コード\`: 技術用語、システム名

## 詳細さの基準
- 15分の会議 → 約500〜800文字の議事録
- 30分の会議 → 約1000〜1500文字の議事録
- 60分の会議 → 約2000〜3000文字の議事録
- 90分以上の会議 → 約3000〜5000文字の議事録

# 文字起こしデータ
${truncatedText}
`;

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: [{
        type: "text",
        text: prompt
      }]
    }]
  };

  try {
    const responseBody = await invokeBedrock(payload, modelId);

    if (responseBody.content && responseBody.content.length > 0) {
      const rawResponse = responseBody.content[0].text;

      // Parse JSON response
      const parsed = parseMinutesJson(rawResponse);
      if (!parsed) {
        console.warn('Failed to parse JSON response, returning raw text as fallback');
        // Return legacy format for backward compatibility
        return { raw: rawResponse, minutes: rawResponse, actions: [] };
      }

      // Return structured data for callers to format appropriately
      return {
        raw: rawResponse,
        minutes: parsed.minutes || '',
        actions: parsed.actions || []
      };
    } else {
      throw new Error("Bedrockからのレスポンス形式が不正です。");
    }
  } catch (error) {
    console.error("Bedrockでの議事録生成中にエラーが発生しました:", error);
    return null;
  }
}

/**
 * JSONレスポンスをパースする
 */
function parseMinutesJson(text) {
  try {
    // Try to extract JSON from markdown code block
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    // Try to parse as raw JSON
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed);
    }

    return null;
  } catch (error) {
    console.error('JSON parse error:', error.message);
    return null;
  }
}

/**
 * GitHub用にフォーマット（メンションなし、人名そのまま）
 */
function formatMinutesForGitHub(minutesData) {
  if (!minutesData) return '';
  if (typeof minutesData === 'string') return minutesData;

  const { minutes, actions } = minutesData;

  if (!actions || actions.length === 0) {
    return minutes || '';
  }

  const actionLines = actions.map(action => {
    return `- ${action.task}（${action.assignee}、${action.deadline}）`;
  });

  const actionsSection = `\n\n*📅 次の手配・アクション*\n${actionLines.join('\n')}`;

  return (minutes || '') + actionsSection;
}

/**
 * Slack用にフォーマット（メンション付き）
 */
async function formatMinutesForSlack(minutesData) {
  if (!minutesData) return '';
  if (typeof minutesData === 'string') return minutesData;

  const { minutes, actions } = minutesData;

  if (!actions || actions.length === 0) {
    return minutes || '';
  }

  // Import mention resolver
  const { getMembersMapping } = require('./slack-name-resolver');
  const mapping = await getMembersMapping();

  const actionLines = actions.map(action => {
    let assigneeDisplay = action.assignee;

    // Try to convert assignee to Slack mention
    if (mapping.size > 0 && action.assignee) {
      const slackId = findAssigneeSlackId(mapping, action.assignee);
      if (slackId) {
        assigneeDisplay = `<@${slackId}>`;
      }
    }

    return `- ${action.task}（${assigneeDisplay}、${action.deadline}）`;
  });

  const actionsSection = `\n\n*📅 次の手配・アクション*\n${actionLines.join('\n')}`;

  return (minutes || '') + actionsSection;
}

/**
 * 担当者名からSlack IDを検索する
 */
function findAssigneeSlackId(mapping, name) {
  const roleSuffixes = ['CTO', 'CEO', 'CFO', 'COO', 'CMO', 'PM', 'CS', 'PdM', 'EM', 'TL', 'リーダー', 'さん', '氏'];

  // Try exact match
  let slackId = mapping.get(name);
  if (slackId) return slackId;

  // Strip role suffix and try again
  let nameWithoutRole = name.trim();
  for (const suffix of roleSuffixes) {
    if (nameWithoutRole.endsWith(suffix)) {
      nameWithoutRole = nameWithoutRole.slice(0, -suffix.length).trim();
      break;
    }
  }
  slackId = mapping.get(nameWithoutRole);
  if (slackId) return slackId;

  // Try family name only
  const familyName = nameWithoutRole.split(' ')[0];
  slackId = mapping.get(familyName);

  return slackId;
}

/**
 * Follow-upメール（お礼＋決定事項共有）を生成
 */
async function generateFollowupMessage({
  projectName = '',
  summary = '',
  actions = [],
  minutes = '',
  recipient = 'ご担当者様',
  sender = '',
  brainbaseName = '',
  userNotes = ''
}) {
  const projectContext = await getProjectContext(projectName);

  const actionLines = Array.isArray(actions) && actions.length > 0
    ? actions.map(a => `- ${a.task}（${a.assignee || '担当未設定'}、${a.deadline || '期限未設定'}）`).join('\n')
    : '- なし';

  const minutesExcerpt = minutes ? minutes.slice(0, 4000) : '';

  // Build sender context with brainbase name
  const senderName = brainbaseName || sender || '（未指定）';
  const senderContext = brainbaseName
    ? `${brainbaseName}（brainbase登録名。この人の所属・役割情報がプロジェクトコンテキストにあれば参照して署名に活用）`
    : senderName;

  const prompt = `あなたはビジネスメール作成アシスタントです。以下の情報を基に、日本語で丁寧なお礼メールを作成してください。

# 入力
- 宛先: ${recipient || 'ご担当者様'}
- 送り手: ${senderContext}
- プロジェクト: ${projectName || '不明'}
- 会議サマリ: ${summary || '未設定'}
- 決定事項・Next Action:
${actionLines}
- 会議議事録（抜粋・Slack mrkdwn可）:
${minutesExcerpt || '(なし)'}
- 送り手メモ（トーンや伝えたい意図）:
${userNotes || '(なし)'}

${projectContext ? `# 参照用プロジェクトコンテキスト\n${projectContext.slice(0, 6000)}` : ''}

# 出力形式（JSONのみ）
\`\`\`json
{
  "subject": "メール件名",
  "body": "本文（宛先敬称と署名まで含める。段落は改行で整形）"
}
\`\`\`

# ガイドライン
- 社外宛想定で丁寧語。社内っぽい場合でも丁寧めでよい。
- 冒頭でお礼 → 本日の要約 → 決定事項/Next Action → 次のアクション依頼 → 締め。
- 必要に応じて「ご確認事項」「期日」も短く入れる。
- 署名は送り手名を末尾に入れる。brainbase名がある場合はその人の所属（会社名）も署名に含める。`;

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1200,
    messages: [{
      role: "user",
      content: [{ type: "text", text: prompt }]
    }]
  };

  const modelId = resolveModelId();

  try {
    const responseBody = await invokeBedrock(payload, modelId);
    const text = responseBody.content?.[0]?.text || '';
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    if (text.trim().startsWith('{')) {
      return JSON.parse(text);
    }
    return null;
  } catch (error) {
    console.error("Failed to generate followup message:", error);
    return null;
  }
}

/**
 * Slackメッセージからタスクを抽出する
 * @param {string} message - Slackメッセージ本文
 * @param {string} channelName - チャンネル名（プロジェクト推定用）
 * @param {string} senderName - 送信者名
 * @returns {Promise<Object|null>} - 抽出されたタスク情報
 */
async function extractTaskFromMessage(message, channelName = '', senderName = '') {
  if (!message || message.trim() === '') {
    return null;
  }

  // Mastraブリッジが有効な場合は委譲
  const bridge = getMastraBridge();
  if (bridge) {
    console.log('Using Mastra bridge for extractTaskFromMessage');
    return bridge.extractTaskFromMessage(message, channelName, senderName);
  }

  const modelId = resolveModelId();

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
- ncom: ncom/docomo関連
- tech-knight: Tech Knight関連
- baao: BAAO関連
- zeims: Zeims関連
- general: その他/不明

# 重要ルール
- このメッセージは @bot と @担当者 へのメンションを含む「タスク依頼」です
- メンション（<@XXXXX>）を除去した部分がそのままタスク内容になります
- 仕事タスクに限らず、個人的なタスク（運動、食事、買い物等）もすべてタスクとして抽出
- 内容が短くても必ずJSON形式で出力してください
- nullを返してはいけません。必ずJSONを出力してください
`;

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [{ type: "text", text: prompt }]
    }]
  };

  try {
    const responseBody = await invokeBedrock(payload, modelId);

    if (responseBody.content && responseBody.content.length > 0) {
      const rawResponse = responseBody.content[0].text;

      // Parse JSON from response
      const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/);
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
    }
  } catch (error) {
    console.error('タスク抽出エラー:', error);
    return null;
  }

  return null;
}

module.exports = {
  summarizeText,
  generateFilename,
  generateMeetingMinutes,
  getProjectContext,
  formatMinutesForGitHub,
  formatMinutesForSlack,
  generateFollowupMessage,
  extractTaskFromMessage
};
