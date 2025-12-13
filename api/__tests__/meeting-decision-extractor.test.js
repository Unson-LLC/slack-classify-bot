/**
 * meeting-decision-extractor.test.js
 * 議事録テキストから決定事項とタスクを抽出する機能のテスト
 * TDD: RED -> GREEN -> REFACTOR
 *
 * 機能仕様:
 * - 議事録テキストをLLMに渡して決定事項とタスクを抽出
 * - 構造化されたJSONで返却
 * - LLMのレスポンスをパース
 */

// LLMクライアントのモック
const mockGenerateText = jest.fn();

jest.mock('ai', () => ({
  generateText: mockGenerateText
}));

// Anthropicモデルのモック
jest.mock('@ai-sdk/anthropic', () => ({
  anthropic: jest.fn().mockReturnValue('mock-model')
}));

describe('MeetingDecisionExtractor', () => {
  let extractDecisionsAndActions;
  let parseExtractionResult;
  let buildExtractionPrompt;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockGenerateText.mockReset();

    // 実装モジュールを読み込む
    try {
      const module = require('../meeting-decision-extractor');
      extractDecisionsAndActions = module.extractDecisionsAndActions;
      parseExtractionResult = module.parseExtractionResult;
      buildExtractionPrompt = module.buildExtractionPrompt;
    } catch (e) {
      // RED状態: モジュールが存在しない
    }
  });

  describe('buildExtractionPrompt', () => {
    it('議事録テキストを含むプロンプトを生成する', () => {
      const transcript = '本日の会議では価格を月額5万円に決定しました。佐藤さんがLPを12/20までに作成します。';
      const projectContext = 'SalesTailor - 営業支援SaaS';

      const result = buildExtractionPrompt(transcript, projectContext);

      expect(result).toContain(transcript);
      expect(result).toContain('decisions');
      expect(result).toContain('actions');
    });

    it('JSON形式での出力を指示する', () => {
      const result = buildExtractionPrompt('テスト議事録', 'テストプロジェクト');

      expect(result).toContain('JSON');
    });

    it('プロジェクトコンテキストを含める', () => {
      const result = buildExtractionPrompt('議事録', 'Zeims - AI税理士');

      expect(result).toContain('Zeims');
    });
  });

  describe('parseExtractionResult', () => {
    it('LLMの出力からJSON部分を抽出する', () => {
      const llmOutput = `
分析結果:
\`\`\`json
{
  "decisions": [
    { "content": "価格は月額5万円に決定", "context": "競合調査の結果" }
  ],
  "actions": [
    { "task": "LP作成", "assignee": "佐藤", "deadline": "12/20" }
  ]
}
\`\`\`
`;

      const result = parseExtractionResult(llmOutput);

      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0].content).toBe('価格は月額5万円に決定');
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].task).toBe('LP作成');
    });

    it('JSONブロックがない場合は直接パースを試みる', () => {
      const llmOutput = `{
  "decisions": [],
  "actions": []
}`;

      const result = parseExtractionResult(llmOutput);

      expect(result.decisions).toEqual([]);
      expect(result.actions).toEqual([]);
    });

    it('パースに失敗した場合は空の結果を返す', () => {
      const llmOutput = 'これは不正な出力です';

      const result = parseExtractionResult(llmOutput);

      expect(result.decisions).toEqual([]);
      expect(result.actions).toEqual([]);
      expect(result.parseError).toBeDefined();
    });

    it('decisionsがない場合は空配列を補完する', () => {
      const llmOutput = `{
  "actions": [{ "task": "テスト", "assignee": "佐藤", "deadline": "12/20" }]
}`;

      const result = parseExtractionResult(llmOutput);

      expect(result.decisions).toEqual([]);
      expect(result.actions).toHaveLength(1);
    });

    it('actionsがない場合は空配列を補完する', () => {
      const llmOutput = `{
  "decisions": [{ "content": "テスト決定", "context": "" }]
}`;

      const result = parseExtractionResult(llmOutput);

      expect(result.decisions).toHaveLength(1);
      expect(result.actions).toEqual([]);
    });
  });

  describe('extractDecisionsAndActions', () => {
    it('議事録から決定事項とタスクを抽出する', async () => {
      // Given
      const transcript = '本日の会議では価格を月額5万円に決定しました。佐藤さんがLPを12/20までに作成します。';
      const projectContext = 'SalesTailor';
      const meetingDate = '2025-12-14';

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          decisions: [
            { content: '価格は月額5万円に決定', context: '会議での合意' }
          ],
          actions: [
            { task: 'LP作成', assignee: '佐藤', deadline: '12/20' }
          ]
        })
      });

      // When
      const result = await extractDecisionsAndActions(transcript, projectContext, meetingDate);

      // Then
      expect(mockGenerateText).toHaveBeenCalled();
      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0].content).toBe('価格は月額5万円に決定');
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].task).toBe('LP作成');
    });

    it('抽出結果にmeetingDateを付与する', async () => {
      const meetingDate = '2025-12-14';

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          decisions: [{ content: 'テスト決定', context: '' }],
          actions: []
        })
      });

      const result = await extractDecisionsAndActions('議事録', 'Project', meetingDate);

      expect(result.decisions[0].date).toBe(meetingDate);
    });

    it('空の議事録の場合は空の結果を返す', async () => {
      const result = await extractDecisionsAndActions('', 'Project', '2025-12-14');

      expect(mockGenerateText).not.toHaveBeenCalled();
      expect(result.decisions).toEqual([]);
      expect(result.actions).toEqual([]);
    });

    it('LLM呼び出しに失敗した場合はエラーを含む結果を返す', async () => {
      mockGenerateText.mockRejectedValue(new Error('API Error'));

      const result = await extractDecisionsAndActions('議事録', 'Project', '2025-12-14');

      expect(result.decisions).toEqual([]);
      expect(result.actions).toEqual([]);
      expect(result.error).toBeDefined();
    });

    it('複数の決定事項とタスクを抽出できる', async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          decisions: [
            { content: '決定1', context: '背景1' },
            { content: '決定2', context: '背景2' }
          ],
          actions: [
            { task: 'タスク1', assignee: '佐藤', deadline: '12/20' },
            { task: 'タスク2', assignee: '山田', deadline: '12/25' },
            { task: 'タスク3', assignee: '田中', deadline: '来週' }
          ]
        })
      });

      const result = await extractDecisionsAndActions('長い議事録...', 'Project', '2025-12-14');

      expect(result.decisions).toHaveLength(2);
      expect(result.actions).toHaveLength(3);
    });
  });
});
