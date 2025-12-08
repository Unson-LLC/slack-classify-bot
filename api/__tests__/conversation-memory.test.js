/**
 * 会話メモリ機能のテスト
 *
 * Phase 1: プロジェクト単位の会話履歴
 * - プロジェクト×ユーザー単位でメッセージを保存
 * - 履歴を取得して文脈として利用
 * - セッション〜数週間の保持
 *
 * t_wada式TDD: Red → Green → Refactor
 */

describe('ConversationMemory', () => {
  let ConversationMemory;
  let memory;

  beforeEach(() => {
    jest.resetModules();
    ConversationMemory = require('../conversation-memory');
    memory = new ConversationMemory();
  });

  describe('saveMessage', () => {
    it('プロジェクト×ユーザー単位でメッセージを保存できる', async () => {
      // Arrange
      const projectId = 'salestailor';
      const userId = 'U07LNUP582X'; // 佐藤のSlack ID

      // Act
      await memory.saveMessage(projectId, userId, {
        role: 'user',
        content: 'SalesTailorのKPI目標を教えて'
      });

      // Assert
      const history = await memory.getHistory(projectId, userId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        role: 'user',
        content: 'SalesTailorのKPI目標を教えて'
      });
      expect(history[0].timestamp).toBeDefined();
    });
  });

  describe('getHistory', () => {
    it('保存順に履歴を取得できる', async () => {
      // Arrange
      const projectId = 'zeims';
      const userId = 'U001';

      await memory.saveMessage(projectId, userId, {
        role: 'user',
        content: '質問1'
      });
      await memory.saveMessage(projectId, userId, {
        role: 'assistant',
        content: '回答1'
      });
      await memory.saveMessage(projectId, userId, {
        role: 'user',
        content: '質問2'
      });

      // Act
      const history = await memory.getHistory(projectId, userId);

      // Assert
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('質問1');
      expect(history[1].content).toBe('回答1');
      expect(history[2].content).toBe('質問2');
    });

    it('limitを指定すると最新N件を取得できる', async () => {
      // Arrange
      const projectId = 'techknight';
      const userId = 'U002';

      for (let i = 1; i <= 5; i++) {
        await memory.saveMessage(projectId, userId, {
          role: 'user',
          content: `メッセージ${i}`
        });
      }

      // Act
      const history = await memory.getHistory(projectId, userId, 3);

      // Assert
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('メッセージ3');
      expect(history[1].content).toBe('メッセージ4');
      expect(history[2].content).toBe('メッセージ5');
    });

    it('履歴がない場合は空配列を返す', async () => {
      // Act
      const history = await memory.getHistory('unknown', 'U999');

      // Assert
      expect(history).toEqual([]);
    });

    it('異なるプロジェクトの履歴は分離される', async () => {
      // Arrange
      const userId = 'U001';

      await memory.saveMessage('salestailor', userId, {
        role: 'user',
        content: 'SalesTailorの質問'
      });
      await memory.saveMessage('zeims', userId, {
        role: 'user',
        content: 'Zeimsの質問'
      });

      // Act
      const stHistory = await memory.getHistory('salestailor', userId);
      const zeimsHistory = await memory.getHistory('zeims', userId);

      // Assert
      expect(stHistory).toHaveLength(1);
      expect(stHistory[0].content).toBe('SalesTailorの質問');
      expect(zeimsHistory).toHaveLength(1);
      expect(zeimsHistory[0].content).toBe('Zeimsの質問');
    });

    it('異なるユーザーの履歴は分離される', async () => {
      // Arrange
      const projectId = 'salestailor';

      await memory.saveMessage(projectId, 'U001', {
        role: 'user',
        content: 'ユーザー1の質問'
      });
      await memory.saveMessage(projectId, 'U002', {
        role: 'user',
        content: 'ユーザー2の質問'
      });

      // Act
      const u1History = await memory.getHistory(projectId, 'U001');
      const u2History = await memory.getHistory(projectId, 'U002');

      // Assert
      expect(u1History).toHaveLength(1);
      expect(u1History[0].content).toBe('ユーザー1の質問');
      expect(u2History).toHaveLength(1);
      expect(u2History[0].content).toBe('ユーザー2の質問');
    });
  });

  describe('clearHistory', () => {
    it('指定したプロジェクト×ユーザーの履歴をクリアできる', async () => {
      // Arrange
      await memory.saveMessage('salestailor', 'U001', {
        role: 'user',
        content: 'テスト'
      });

      // Act
      await memory.clearHistory('salestailor', 'U001');

      // Assert
      const history = await memory.getHistory('salestailor', 'U001');
      expect(history).toEqual([]);
    });

    it('他のプロジェクト×ユーザーの履歴には影響しない', async () => {
      // Arrange
      await memory.saveMessage('salestailor', 'U001', { role: 'user', content: 'ST U001' });
      await memory.saveMessage('salestailor', 'U002', { role: 'user', content: 'ST U002' });
      await memory.saveMessage('zeims', 'U001', { role: 'user', content: 'Zeims U001' });

      // Act
      await memory.clearHistory('salestailor', 'U001');

      // Assert
      expect(await memory.getHistory('salestailor', 'U001')).toEqual([]);
      expect(await memory.getHistory('salestailor', 'U002')).toHaveLength(1);
      expect(await memory.getHistory('zeims', 'U001')).toHaveLength(1);
    });
  });

  describe('formatForLLM', () => {
    it('履歴をLLM用のメッセージ形式に変換できる', async () => {
      // Arrange
      await memory.saveMessage('salestailor', 'U001', {
        role: 'user',
        content: 'KPIを教えて'
      });
      await memory.saveMessage('salestailor', 'U001', {
        role: 'assistant',
        content: '月間100件のリード獲得です'
      });

      // Act
      const formatted = await memory.formatForLLM('salestailor', 'U001');

      // Assert
      expect(formatted).toEqual([
        { role: 'user', content: 'KPIを教えて' },
        { role: 'assistant', content: '月間100件のリード獲得です' }
      ]);
    });
  });

  describe('maxMessages制限', () => {
    it('maxMessagesを超えると古いメッセージが削除される', async () => {
      // Arrange: maxMessages=3で設定
      const limitedMemory = new ConversationMemory({ maxMessages: 3 });
      const projectId = 'test';
      const userId = 'U001';

      // Act: 5件保存
      for (let i = 1; i <= 5; i++) {
        await limitedMemory.saveMessage(projectId, userId, {
          role: 'user',
          content: `メッセージ${i}`
        });
      }

      // Assert: 最新3件のみ残る
      const history = await limitedMemory.getHistory(projectId, userId);
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('メッセージ3');
      expect(history[1].content).toBe('メッセージ4');
      expect(history[2].content).toBe('メッセージ5');
    });

    it('デフォルトは100件まで保持', async () => {
      // Arrange
      const defaultMemory = new ConversationMemory();

      // Assert
      expect(defaultMemory.maxMessages).toBe(100);
    });
  });

  describe('TTL（有効期限）', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('TTLを超えたメッセージは取得時に除外される', async () => {
      // Arrange: TTL=1時間
      const ttlMemory = new ConversationMemory({ ttlMs: 60 * 60 * 1000 });
      const projectId = 'test';
      const userId = 'U001';

      // 1時間前のメッセージを保存（時間を巻き戻す）
      jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
      await ttlMemory.saveMessage(projectId, userId, {
        role: 'user',
        content: '古いメッセージ'
      });

      // 現在時刻に戻す
      jest.setSystemTime(new Date('2025-01-01T01:30:00Z'));
      await ttlMemory.saveMessage(projectId, userId, {
        role: 'user',
        content: '新しいメッセージ'
      });

      // Act
      const history = await ttlMemory.getHistory(projectId, userId);

      // Assert: TTLを超えた古いメッセージは除外
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('新しいメッセージ');
    });

    it('TTL未設定の場合は期限なし', async () => {
      // Arrange
      const noTtlMemory = new ConversationMemory();
      const projectId = 'test';
      const userId = 'U001';

      jest.setSystemTime(new Date('2020-01-01T00:00:00Z'));
      await noTtlMemory.saveMessage(projectId, userId, {
        role: 'user',
        content: '5年前のメッセージ'
      });

      jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));

      // Act
      const history = await noTtlMemory.getHistory(projectId, userId);

      // Assert: 期限なしなので残る
      expect(history).toHaveLength(1);
    });
  });

  describe('getStats', () => {
    it('メモリの統計情報を取得できる', async () => {
      // Arrange
      await memory.saveMessage('proj1', 'U001', { role: 'user', content: 'msg1' });
      await memory.saveMessage('proj1', 'U001', { role: 'assistant', content: 'msg2' });
      await memory.saveMessage('proj2', 'U001', { role: 'user', content: 'msg3' });

      // Act
      const stats = memory.getStats();

      // Assert
      expect(stats.totalConversations).toBe(2);  // proj1:U001, proj2:U001
      expect(stats.totalMessages).toBe(3);
    });
  });
});
