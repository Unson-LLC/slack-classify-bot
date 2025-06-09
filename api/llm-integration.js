const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

// Force region to us-east-1 - Claude Sonnet 4 and 3.7 are available here
const BEDROCK_REGION = "us-east-1";

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
  const modelId = 'us.anthropic.claude-sonnet-4-20250514-v1:0';
  
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

  // Log the command being sent
  console.log('InvokeModelCommand parameters:');
  console.log('- contentType:', 'application/json');
  console.log('- modelId:', modelId);
  console.log('- payload keys:', Object.keys(payload));

  // Create bedrock client with COMPLETE configuration override
  const requestClient = new BedrockRuntimeClient({
    region: BEDROCK_REGION,
    // Completely override all configuration
    endpoint: `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com`,
    // Use default credentials from Lambda execution role
    credentials: undefined
  });

  const command = new InvokeModelCommand({
    contentType: "application/json",
    body: JSON.stringify(payload),
    modelId,
  });

  try {
    console.log('Sending request to Bedrock with fresh client...');
    const apiResponse = await requestClient.send(command);
    const decoded = new TextDecoder().decode(apiResponse.body);
    const responseBody = JSON.parse(decoded);
    
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

module.exports = { summarizeText }; 