const { mockClient } = require('aws-sdk-client-mock');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { summarizeText } = require('../llm-integration');

// Create mock
const bedrockMock = mockClient(BedrockRuntimeClient);

describe('llm-integration', () => {
  beforeEach(() => {
    bedrockMock.reset();
    jest.clearAllMocks();
  });

  describe('summarizeText', () => {
    it('should return null for empty text', async () => {
      const result = await summarizeText('');
      expect(result).toBeNull();
    });

    it('should return null for null text', async () => {
      const result = await summarizeText(null);
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only text', async () => {
      const result = await summarizeText('   \n\t  ');
      expect(result).toBeNull();
    });

    it('should successfully summarize text with Bedrock', async () => {
      const mockResponse = {
        content: [{
          text: '## 会議の概要\nプロジェクトのキックオフミーティングを実施しました。\n\n## ネクストアクション\n- 要件定義書の作成（担当：田中）\n- スケジュール案の作成（担当：佐藤）'
        }]
      };

      bedrockMock.on(InvokeModelCommand).resolves({
        body: new TextEncoder().encode(JSON.stringify(mockResponse))
      });

      const result = await summarizeText('本日はプロジェクトのキックオフミーティングを行いました。');
      
      expect(result).toBe(mockResponse.content[0].text);
      expect(bedrockMock.commandCalls(InvokeModelCommand)).toHaveLength(1);
      
      const call = bedrockMock.commandCalls(InvokeModelCommand)[0];
      expect(call.args[0].input.modelId).toBe('us.anthropic.claude-sonnet-4-20250514-v1:0');
      expect(call.args[0].input.contentType).toBe('application/json');
    });

    it('should truncate text longer than maxChars', async () => {
      const longText = 'a'.repeat(200000); // 200,000 characters
      const mockResponse = {
        content: [{
          text: '## 会議の概要\n長いテキストの要約です。'
        }]
      };

      bedrockMock.on(InvokeModelCommand).resolves({
        body: new TextEncoder().encode(JSON.stringify(mockResponse))
      });

      await summarizeText(longText);

      const call = bedrockMock.commandCalls(InvokeModelCommand)[0];
      const payload = JSON.parse(call.args[0].input.body);
      const actualText = payload.messages[0].content[0].text;
      
      // Check that text was truncated (180000 chars + prompt template)
      expect(actualText.length).toBeLessThan(185000);
      expect(actualText).toContain('a'.repeat(1000)); // Should contain the truncated text
    });

    it('should use correct region configuration', async () => {
      const mockResponse = {
        content: [{
          text: '要約されたテキスト'
        }]
      };

      bedrockMock.on(InvokeModelCommand).resolves({
        body: new TextEncoder().encode(JSON.stringify(mockResponse))
      });

      await summarizeText('テストテキスト');

      // Verify that the client was created with the correct region
      expect(bedrockMock.clients[0].config.region).toBe('us-east-1');
    });

    it('should handle Bedrock API errors gracefully', async () => {
      bedrockMock.on(InvokeModelCommand).rejects(new Error('Bedrock API error'));

      const result = await summarizeText('テストテキスト');
      
      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        'Bedrockでのテキスト要約中にエラーが発生しました:',
        expect.any(Error)
      );
    });

    it('should handle malformed response from Bedrock', async () => {
      const malformedResponse = {
        // Missing 'content' field
        someOtherField: 'value'
      };

      bedrockMock.on(InvokeModelCommand).resolves({
        body: new TextEncoder().encode(JSON.stringify(malformedResponse))
      });

      const result = await summarizeText('テストテキスト');
      
      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        'Bedrockでのテキスト要約中にエラーが発生しました:',
        expect.any(Error)
      );
    });

    it('should handle empty content array in response', async () => {
      const emptyContentResponse = {
        content: []
      };

      bedrockMock.on(InvokeModelCommand).resolves({
        body: new TextEncoder().encode(JSON.stringify(emptyContentResponse))
      });

      const result = await summarizeText('テストテキスト');
      
      expect(result).toBeNull();
    });

    it('should include correct prompt structure', async () => {
      const mockResponse = {
        content: [{
          text: '要約結果'
        }]
      };

      bedrockMock.on(InvokeModelCommand).resolves({
        body: new TextEncoder().encode(JSON.stringify(mockResponse))
      });

      const testText = 'ミーティングの内容です。';
      await summarizeText(testText);

      const call = bedrockMock.commandCalls(InvokeModelCommand)[0];
      const payload = JSON.parse(call.args[0].input.body);
      
      expect(payload.anthropic_version).toBe('bedrock-2023-05-31');
      expect(payload.max_tokens).toBe(4096);
      expect(payload.messages).toHaveLength(1);
      expect(payload.messages[0].role).toBe('user');
      expect(payload.messages[0].content[0].type).toBe('text');
      expect(payload.messages[0].content[0].text).toContain(testText);
      expect(payload.messages[0].content[0].text).toContain('サマリー');
      expect(payload.messages[0].content[0].text).toContain('ネクストアクション');
    });
  });
});