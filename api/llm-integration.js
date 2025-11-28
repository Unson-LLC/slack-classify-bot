const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

// Force region to us-east-1 - Claude Sonnet 4 and 3.7 are available here
const BEDROCK_REGION = "us-east-1";

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
 * テキストを要約し、ネクストアクションを抽出します。
 * @param {string} text - 要約するテキスト
 * @returns {Promise<string|null>} - 要約結果、またはエラー時にnull
 */
async function summarizeText(text) {
  if (!text || text.trim() === "") {
    return null;
  }

  // モデルの最大トークン数を超えないようにテキストを切り詰める（安全策）
  const maxChars = 180000;
  const truncatedText = text.length > maxChars ? text.substring(0, maxChars) : text;

  // Use Claude Sonnet 4 via inference profile
  const modelId = resolveModelId();
  
  // Log the exact configuration being used
  console.log('=== BEDROCK CALL DEBUG ===');
  console.log('Forced Region:', BEDROCK_REGION);
  console.log('Model ID:', modelId);
  console.log('Original AWS_REGION env var:', process.env.AWS_REGION);
  console.log('Forced endpoint:', `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com`);

  const prompt = `以下の会議議事録を読み、次の2つの点を抽出・要約してください。

1.  **サマリー**: 会議全体の目的と結論を2〜3文で簡潔にまとめる。

# 制約
- 「会議の概要」と「ネクストアクション」の2つの見出しで構成してください。
- ネクストアクションは箇条書き（-）で、担当者がいれば（担当：〇〇）のように明記してください。
- ネクストアクションが存在しない場合は、「ネクストアクションはありません。」と記載してください。
- 全体として簡潔で分かりやすくまとめてください。

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
 * @returns {Promise<string|null>} - 議事録、またはエラー時にnull
 */
async function generateMeetingMinutes(text) {
  if (!text || text.trim() === "") {
    return null;
  }

  // モデルの最大トークン数を超えないようにテキストを切り詰める（安全策）
  const maxChars = 180000;
  const truncatedText = text.length > maxChars ? text.substring(0, maxChars) : text;

  const modelId = resolveModelId();
  
  const prompt = `以下の文字起こしデータから、Slack投稿用の質の高い議事録を作成してください。

# 出力形式（Slack mrkdwn記法を使用）
*📅 会議情報*
• 日時: [推定される日時]
• 参加者: [推定される参加者]

*📋 議題・内容*
[主要な議題と内容を整理。重要な部分は*太字*で強調]

*✅ 決定事項*
[会議で決定されたことを箇条書き。重要な決定は*太字*で強調]

*📝 課題・懸念事項*
[議論された課題や懸念事項。緊急度の高いものは*太字*で強調]

*🎯 次回までのアクション*
[担当者と期限を含む具体的なアクション。担当者は*太字*で強調]

# 制約
- Slack mrkdwn記法を使用: *太字*、_斜体_、~取り消し線~、\`コード\`
- 項目は「•」(bulletpoint)を使用
- 読みやすく構造化された議事録を作成
- 重要な決定事項や課題を漏らさない
- 担当者や期限が明確な場合は必ず記載し、担当者名は*太字*にする
- 不明な情報は「不明」や「要確認」と記載
- コードや技術用語は\`バッククォート\`で囲む
- セクションヘッダーは*太字*で強調

# 文字起こしデータ
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
    console.error("Bedrockでの議事録生成中にエラーが発生しました:", error);
    // エラーが発生した場合はnullを返すことで、メインの処理フローを止めない
    return null;
  }
}

module.exports = { summarizeText, generateFilename, generateMeetingMinutes }; 
