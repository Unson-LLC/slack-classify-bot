/**
 * dm-task-handler.test.js
 * DM経由の個人タスク登録機能のテスト（TDD: RED -> GREEN -> REFACTOR）
 */

const { isDMChannel, getUserIdFromSlackId, determineTaskDestination } = require('../dm-task-handler');

describe('DM Task Handler', () => {
  describe('isDMChannel', () => {
    it('channel_type が "im" の場合は true を返す', () => {
      expect(isDMChannel('im')).toBe(true);
    });

    it('channel_type が "channel" の場合は false を返す', () => {
      expect(isDMChannel('channel')).toBe(false);
    });

    it('channel_type が "group" の場合は false を返す', () => {
      expect(isDMChannel('group')).toBe(false);
    });

    it('channel_type が undefined の場合は false を返す', () => {
      expect(isDMChannel(undefined)).toBe(false);
    });
  });

  describe('getUserIdFromSlackId', () => {
    it('Slack IDからユーザーIDを取得する（正常系）', async () => {
      const mockSlackIdMap = {
        'U08T9TC88BB': 'k.sato',
        'U12345ABCDE': 't.yamada'
      };

      const userId = await getUserIdFromSlackId('U08T9TC88BB', mockSlackIdMap);
      expect(userId).toBe('k.sato');
    });

    it('存在しないSlack IDの場合は null を返す', async () => {
      const mockSlackIdMap = {
        'U08T9TC88BB': 'k.sato'
      };

      const userId = await getUserIdFromSlackId('UUNKNOWN123', mockSlackIdMap);
      expect(userId).toBeNull();
    });
  });

  describe('determineTaskDestination', () => {
    const mockSlackIdMap = {
      'U08T9TC88BB': 'k.sato',
      'U12345ABCDE': 't.yamada'
    };

    it('DMからのタスクは個人タスクに登録する', async () => {
      const result = await determineTaskDestination({
        channelType: 'im',
        senderSlackId: 'U08T9TC88BB',
        slackIdMap: mockSlackIdMap
      });

      expect(result.isPersonal).toBe(true);
      expect(result.userId).toBe('k.sato');
      expect(result.destination).toBe('_tasks/personal/k.sato.md');
    });

    it('チャンネルからのタスクは共有タスクに登録する', async () => {
      const result = await determineTaskDestination({
        channelType: 'channel',
        senderSlackId: 'U08T9TC88BB',
        slackIdMap: mockSlackIdMap
      });

      expect(result.isPersonal).toBe(false);
      expect(result.destination).toBe('_tasks/index.md');
    });

    it('グループからのタスクは共有タスクに登録する', async () => {
      const result = await determineTaskDestination({
        channelType: 'group',
        senderSlackId: 'U08T9TC88BB',
        slackIdMap: mockSlackIdMap
      });

      expect(result.isPersonal).toBe(false);
      expect(result.destination).toBe('_tasks/index.md');
    });

    it('DMだがユーザーIDが解決できない場合は共有タスクにフォールバック', async () => {
      const result = await determineTaskDestination({
        channelType: 'im',
        senderSlackId: 'UUNKNOWN123',
        slackIdMap: mockSlackIdMap
      });

      expect(result.isPersonal).toBe(false);
      expect(result.destination).toBe('_tasks/index.md');
      expect(result.fallbackReason).toBe('unknown_user');
    });
  });
});
