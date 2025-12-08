/**
 * 会話メモリ統合テスト
 *
 * app_mention → Memory → AI PM の流れをテスト
 */

describe('ConversationMemory Integration', () => {
  let ConversationMemory;
  let memory;

  beforeEach(() => {
    jest.resetModules();
    ConversationMemory = require('../conversation-memory');
    // TTL: 24時間、最大50件
    memory = new ConversationMemory({ maxMessages: 50, ttlMs: 24 * 60 * 60 * 1000 });
  });

  describe('app_mention統合シナリオ', () => {
    it('質問→回答の会話フローを履歴に保存できる', async () => {
      // Arrange
      const projectId = 'salestailor';
      const userId = 'U07LNUP582X';
      const question = 'SalesTailorのKPI目標を教えて';
      const answer = '現在のKPI目標は月間100件の新規リード獲得です。';

      // Act: 質問を保存
      await memory.saveMessage(projectId, userId, {
        role: 'user',
        content: question
      });

      // AI PMからの回答を保存
      await memory.saveMessage(projectId, userId, {
        role: 'assistant',
        content: answer
      });

      // Assert
      const history = await memory.getHistory(projectId, userId);
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ role: 'user', content: question });
      expect(history[1]).toMatchObject({ role: 'assistant', content: answer });
    });

    it('連続した会話で文脈を維持できる', async () => {
      // Arrange
      const projectId = 'zeims';
      const userId = 'U001';

      // Act: 複数回の質問/回答
      await memory.saveMessage(projectId, userId, { role: 'user', content: 'ZeimsのCVRは？' });
      await memory.saveMessage(projectId, userId, { role: 'assistant', content: 'CVRは3.2%です' });
      await memory.saveMessage(projectId, userId, { role: 'user', content: 'それを上げるには？' });
      await memory.saveMessage(projectId, userId, { role: 'assistant', content: 'LP改善とフォーム最適化が効果的です' });

      // Assert: LLM用にフォーマット
      const llmMessages = await memory.formatForLLM(projectId, userId);
      expect(llmMessages).toHaveLength(4);
      expect(llmMessages).toEqual([
        { role: 'user', content: 'ZeimsのCVRは？' },
        { role: 'assistant', content: 'CVRは3.2%です' },
        { role: 'user', content: 'それを上げるには？' },
        { role: 'assistant', content: 'LP改善とフォーム最適化が効果的です' }
      ]);
    });

    it('最新10件のみをLLMに渡すことができる', async () => {
      // Arrange: 20件の会話を作成
      const projectId = 'techknight';
      const userId = 'U002';

      for (let i = 1; i <= 20; i++) {
        await memory.saveMessage(projectId, userId, {
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `メッセージ${i}`
        });
      }

      // Act: 最新10件を取得
      const recent = await memory.formatForLLM(projectId, userId, 10);

      // Assert
      expect(recent).toHaveLength(10);
      expect(recent[0].content).toBe('メッセージ11');
      expect(recent[9].content).toBe('メッセージ20');
    });
  });

  describe('プロジェクトIDの決定', () => {
    it('異なるプロジェクトの会話は完全に分離される', async () => {
      // Arrange
      const userId = 'U001';

      // Act
      await memory.saveMessage('salestailor', userId, { role: 'user', content: 'ST質問' });
      await memory.saveMessage('zeims', userId, { role: 'user', content: 'Zeims質問' });
      await memory.saveMessage('techknight', userId, { role: 'user', content: 'TK質問' });

      // Assert
      const stats = memory.getStats();
      expect(stats.totalConversations).toBe(3);

      const stHistory = await memory.getHistory('salestailor', userId);
      const zeimsHistory = await memory.getHistory('zeims', userId);
      const tkHistory = await memory.getHistory('techknight', userId);

      expect(stHistory).toHaveLength(1);
      expect(zeimsHistory).toHaveLength(1);
      expect(tkHistory).toHaveLength(1);
    });
  });

  describe('シングルトンパターン', () => {
    it('グローバルインスタンスを共有できる', () => {
      // Arrange: モジュールレベルのシングルトン
      const instance1 = require('../conversation-memory').getInstance();
      const instance2 = require('../conversation-memory').getInstance();

      // Assert: 同一インスタンス
      expect(instance1).toBe(instance2);
    });
  });
});
