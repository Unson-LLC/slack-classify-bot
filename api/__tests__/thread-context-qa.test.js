/**
 * 質問応答モードのスレッドコンテキスト取得テスト
 *
 * Design References:
 * - app_mentionでスレッド内の過去メッセージを取得し、文脈として使用
 * - タスク取り込み（message handler）と同様の仕組みを質問応答にも適用
 *
 * Related:
 * - api/index.js: app_mention handler
 * - api/mastra/bridge.ts: askProjectPM / askMana
 * - api/thread-context.js: スレッドコンテキスト取得（新規作成）
 */

describe('Thread Context for Q&A (app_mention)', () => {
  let getThreadContext;
  let mockSlackClient;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Slack client
    mockSlackClient = {
      conversations: {
        replies: jest.fn()
      }
    };
  });

  describe('getThreadContext', () => {
    beforeEach(() => {
      // thread-context.jsをインポート（まだ存在しない）
      jest.resetModules();
      getThreadContext = require('../thread-context').getThreadContext;
    });

    it('スレッド内の過去メッセージを取得して文脈を生成する', async () => {
      // Arrange: スレッド内に3つのメッセージがある状況
      mockSlackClient.conversations.replies.mockResolvedValue({
        messages: [
          { ts: '1234567890.000', user: 'U001', text: 'SalesTailorのKPI目標は？' },
          { ts: '1234567890.001', user: 'UBOT', text: '現在のKPIは月間100件の新規リードです' },
          { ts: '1234567890.002', user: 'U001', text: 'それを達成するための施策は？' }  // 現在のメッセージ
        ]
      });

      const slackIdToName = new Map([
        ['U001', '佐藤 圭吾'],
        ['UBOT', 'mana']
      ]);

      // Act
      const context = await getThreadContext({
        client: mockSlackClient,
        channel: 'C123456',
        threadTs: '1234567890.000',
        currentTs: '1234567890.002',
        slackIdToName
      });

      // Assert
      expect(mockSlackClient.conversations.replies).toHaveBeenCalledWith({
        channel: 'C123456',
        ts: '1234567890.000',
        limit: 10
      });
      expect(context).toContain('佐藤 圭吾: SalesTailorのKPI目標は？');
      expect(context).toContain('mana: 現在のKPIは月間100件の新規リードです');
      // 現在のメッセージは含まれない
      expect(context).not.toContain('それを達成するための施策は？');
    });

    it('スレッドでない場合（thread_tsがない）は空文字を返す', async () => {
      // Act
      const context = await getThreadContext({
        client: mockSlackClient,
        channel: 'C123456',
        threadTs: null,
        currentTs: '1234567890.000',
        slackIdToName: new Map()
      });

      // Assert
      expect(context).toBe('');
      expect(mockSlackClient.conversations.replies).not.toHaveBeenCalled();
    });

    it('スレッド内にメッセージが1つしかない場合は空文字を返す', async () => {
      // Arrange: 親メッセージのみ
      mockSlackClient.conversations.replies.mockResolvedValue({
        messages: [
          { ts: '1234567890.000', user: 'U001', text: '質問です' }
        ]
      });

      // Act
      const context = await getThreadContext({
        client: mockSlackClient,
        channel: 'C123456',
        threadTs: '1234567890.000',
        currentTs: '1234567890.000',
        slackIdToName: new Map([['U001', '佐藤 圭吾']])
      });

      // Assert
      expect(context).toBe('');
    });

    it('メンションを除去してテキストを整形する', async () => {
      // Arrange: メンション付きメッセージ
      mockSlackClient.conversations.replies.mockResolvedValue({
        messages: [
          { ts: '1234567890.000', user: 'U001', text: '<@UBOT> ZeimsのCVRを教えて' },
          { ts: '1234567890.001', user: 'UBOT', text: '現在のCVRは3.2%です' }
        ]
      });

      // Act
      const context = await getThreadContext({
        client: mockSlackClient,
        channel: 'C123456',
        threadTs: '1234567890.000',
        currentTs: '1234567890.001',
        slackIdToName: new Map([['U001', '佐藤 圭吾'], ['UBOT', 'mana']])
      });

      // Assert
      expect(context).toContain('佐藤 圭吾: ZeimsのCVRを教えて');
      expect(context).not.toContain('<@UBOT>');
    });

    it('API呼び出しが失敗した場合は空文字を返し、エラーをログに記録する', async () => {
      // Arrange
      mockSlackClient.conversations.replies.mockRejectedValue(new Error('Slack API error'));
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Act
      const context = await getThreadContext({
        client: mockSlackClient,
        channel: 'C123456',
        threadTs: '1234567890.000',
        currentTs: '1234567890.001',
        slackIdToName: new Map()
      });

      // Assert
      expect(context).toBe('');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get thread context'),
        expect.any(String)
      );

      consoleSpy.mockRestore();
    });

    it('最大10件のメッセージを取得する', async () => {
      // Arrange: 15件のメッセージ（limitが10なのでAPIが10件返す想定）
      const messages = Array.from({ length: 10 }, (_, i) => ({
        ts: `1234567890.${String(i).padStart(3, '0')}`,
        user: 'U001',
        text: `メッセージ ${i + 1}`
      }));
      mockSlackClient.conversations.replies.mockResolvedValue({ messages });

      // Act
      await getThreadContext({
        client: mockSlackClient,
        channel: 'C123456',
        threadTs: '1234567890.000',
        currentTs: '1234567890.009',
        slackIdToName: new Map([['U001', 'テストユーザー']])
      });

      // Assert
      expect(mockSlackClient.conversations.replies).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
    });
  });

  describe('formatThreadContext', () => {
    let formatThreadContext;

    beforeEach(() => {
      jest.resetModules();
      formatThreadContext = require('../thread-context').formatThreadContext;
    });

    it('メッセージ配列をフォーマットされた文脈文字列に変換する', () => {
      // Arrange
      const messages = [
        { user: '佐藤 圭吾', text: 'SalesTailorの進捗は？' },
        { user: 'mana', text: '今週は5件の新規リードがありました' }
      ];

      // Act
      const formatted = formatThreadContext(messages);

      // Assert
      expect(formatted).toBe(
        '\n\n【スレッドの文脈】\n' +
        '佐藤 圭吾: SalesTailorの進捗は？\n' +
        'mana: 今週は5件の新規リードがありました'
      );
    });

    it('空配列の場合は空文字を返す', () => {
      // Act
      const formatted = formatThreadContext([]);

      // Assert
      expect(formatted).toBe('');
    });
  });
});
