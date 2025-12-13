/**
 * meeting-decision-extractor.js
 * 議事録テキストから決定事項とタスクを抽出する
 */

const { generateText } = require('ai');
const { anthropic } = require('@ai-sdk/anthropic');

/**
 * 抽出用プロンプトを生成
 * @param {string} transcript - 議事録テキスト
 * @param {string} projectContext - プロジェクトの説明
 * @returns {string}
 */
function buildExtractionPrompt(transcript, projectContext) {
  return `あなたは議事録から重要な情報を抽出するアシスタントです。

## プロジェクト情報
${projectContext}

## 議事録
${transcript}

## 指示
上記の議事録から以下を抽出してJSON形式で出力してください：

1. **decisions**: 会議で決定された事項（合意事項、方針決定など）
   - content: 決定内容
   - context: 決定に至った背景・理由

2. **actions**: 会議で決まったタスク・アクションアイテム
   - task: タスク内容
   - assignee: 担当者名
   - deadline: 期限（YYYY/MM/DD, MM/DD, 来週, 今週中 など）

## 出力形式
\`\`\`json
{
  "decisions": [
    { "content": "決定内容", "context": "背景" }
  ],
  "actions": [
    { "task": "タスク内容", "assignee": "担当者", "deadline": "期限" }
  ]
}
\`\`\`

決定事項やタスクが見つからない場合は空配列を返してください。
推測や補完はせず、議事録に明示的に記載されている内容のみを抽出してください。`;
}

/**
 * LLMの出力からJSON部分を抽出してパース
 * @param {string} llmOutput
 * @returns {{ decisions: Array, actions: Array, parseError?: string }}
 */
function parseExtractionResult(llmOutput) {
  const emptyResult = { decisions: [], actions: [] };

  if (!llmOutput || llmOutput.trim() === '') {
    return { ...emptyResult, parseError: 'Empty output' };
  }

  try {
    // JSONコードブロックを探す
    const jsonBlockMatch = llmOutput.match(/```json\s*([\s\S]*?)```/);
    const jsonString = jsonBlockMatch ? jsonBlockMatch[1].trim() : llmOutput.trim();

    const parsed = JSON.parse(jsonString);

    return {
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : []
    };
  } catch (error) {
    return { ...emptyResult, parseError: error.message };
  }
}

/**
 * 議事録から決定事項とタスクを抽出
 * @param {string} transcript - 議事録テキスト
 * @param {string} projectContext - プロジェクトの説明
 * @param {string} meetingDate - YYYY-MM-DD形式
 * @returns {Promise<{ decisions: Array, actions: Array, error?: string }>}
 */
async function extractDecisionsAndActions(transcript, projectContext, meetingDate) {
  // 空の議事録チェック
  if (!transcript || transcript.trim() === '') {
    return { decisions: [], actions: [] };
  }

  try {
    const prompt = buildExtractionPrompt(transcript, projectContext);

    const response = await generateText({
      model: anthropic('claude-3-5-haiku-20241022'),
      prompt,
      maxTokens: 2000
    });

    const result = parseExtractionResult(response.text);

    // 各決定事項にmeetingDateを付与
    result.decisions = result.decisions.map(decision => ({
      ...decision,
      date: meetingDate
    }));

    return result;
  } catch (error) {
    return {
      decisions: [],
      actions: [],
      error: error.message
    };
  }
}

module.exports = {
  extractDecisionsAndActions,
  parseExtractionResult,
  buildExtractionPrompt
};
