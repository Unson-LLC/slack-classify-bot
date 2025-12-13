/**
 * daily-log-generator.test.js
 * DailyLogGenerator のテスト
 */

const { DailyLogGenerator } = require('./daily-log-generator');

describe('DailyLogGenerator', () => {
  let generator;

  beforeEach(() => {
    generator = new DailyLogGenerator();
  });

  describe('isMeetingPost', () => {
    it('議事録投稿を検出できる - 会議要約パターン', () => {
      const message = {
        text: '📋 *会議要約*\nチームMTGの要約です。',
      };
      expect(generator.isMeetingPost(message)).toBe(true);
    });

    it('議事録投稿を検出できる - 詳細議事録パターン', () => {
      const message = {
        text: '📄 *詳細議事録*\n## 参加者\n- 田中\n- 鈴木',
      };
      expect(generator.isMeetingPost(message)).toBe(true);
    });

    it('議事録投稿を検出できる - AI生成署名パターン', () => {
      const message = {
        text: '会議の内容です。\n🤖 _この議事録はAIにより自動生成されました_',
      };
      expect(generator.isMeetingPost(message)).toBe(true);
    });

    it('議事録投稿を検出できる - ### 要約セクション', () => {
      const message = {
        text: '# MTG\n### 要約\n今回のMTGでは〜\n### 決定事項\n〜を決定',
      };
      expect(generator.isMeetingPost(message)).toBe(true);
    });

    it('通常のメッセージは検出しない', () => {
      const message = {
        text: 'タスク完了しました！',
      };
      expect(generator.isMeetingPost(message)).toBe(false);
    });

    it('空メッセージは検出しない', () => {
      const message = { text: '' };
      expect(generator.isMeetingPost(message)).toBe(false);
    });
  });

  describe('extractMeetingInfo', () => {
    it('会議タイトルを抽出できる', () => {
      const message = {
        text: '「チーム定例会議」の議事録です。\n### 要約\n今回は〜',
        ts: '1702454400.000000', // 2023-12-13 12:00:00 UTC
      };
      const info = generator.extractMeetingInfo(message);
      expect(info.title).toBe('チーム定例会議');
    });

    it('MTGタイトルを抽出できる', () => {
      const message = {
        text: '【プロジェクトMTG】\n### 要約\n進捗確認を実施',
        ts: '1702454400.000000',
      };
      const info = generator.extractMeetingInfo(message);
      expect(info.title).toBe('プロジェクトMTG');
    });

    it('タイトルがない場合はデフォルト値を使う', () => {
      const message = {
        text: '### 要約\n重要な決定を行った',
        ts: '1702454400.000000',
      };
      const info = generator.extractMeetingInfo(message);
      expect(info.title).toBe('会議');
    });

    it('### 要約セクションから内容を抽出できる', () => {
      const message = {
        text: '# MTG\n### 要約\n重要ポイント1\n重要ポイント2\n重要ポイント3\n### 決定事項\n〜',
        ts: '1702454400.000000',
      };
      const info = generator.extractMeetingInfo(message);
      expect(info.summary).toContain('重要ポイント1');
      expect(info.summary).toContain('重要ポイント2');
    });

    it('Next Action の有無を検出できる', () => {
      const message = {
        text: '### 要約\n内容\n### Next Action\n| 担当 | タスク | 期限 |',
        ts: '1702454400.000000',
      };
      const info = generator.extractMeetingInfo(message);
      expect(info.hasActions).toBe(true);
    });

    it('Next Action がない場合はfalse', () => {
      const message = {
        text: '### 要約\n内容のみ',
        ts: '1702454400.000000',
      };
      const info = generator.extractMeetingInfo(message);
      expect(info.hasActions).toBe(false);
    });

    it('投稿時刻を抽出できる', () => {
      const message = {
        text: '### 要約\n内容',
        ts: '1702454400.000000', // 2023-12-13 12:00:00 UTC = 21:00 JST
      };
      const info = generator.extractMeetingInfo(message);
      expect(info.timeStr).toMatch(/\d+:\d{2}/);
    });
  });

  describe('getTodayJST', () => {
    it('正しい形式で日付を返す', () => {
      const result = generator.getTodayJST();
      expect(result.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.displayDate).toMatch(/^\d{1,2}\/\d{1,2}$/);
      expect(['日', '月', '火', '水', '木', '金', '土']).toContain(result.weekday);
    });
  });
});
