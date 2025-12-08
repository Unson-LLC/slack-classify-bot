/**
 * チャンネル→プロジェクト マッピング解決のテスト
 *
 * S3のchannels.jsonを参照してチャンネルIDからプロジェクトIDを取得
 * 正本: _codex/common/meta/slack/channels.yml
 */

// テスト用のchannels.jsonデータ
const mockChannelsData = {
  channels: [
    {
      channel_id: 'C08K58SUQ7N',
      channel_name: '0110-baao',
      workspace: 'unson',
      project_id: 'proj_baao',
      type: 'general'
    },
    {
      channel_id: 'C08E010PYKE',
      channel_name: '0030-dialogai-biz',
      workspace: 'unson',
      project_id: 'proj_dialogai',
      type: 'business'
    },
    {
      channel_id: 'C08A6ETSSR2',
      channel_name: '0031-dialogai-dev',
      workspace: 'unson',
      project_id: 'proj_dialogai',
      type: 'development'
    },
    {
      channel_id: 'CSALESTAILOR',
      channel_name: '0050-salestailor',
      workspace: 'unson',
      project_id: 'proj_salestailor',
      type: 'general'
    },
    {
      channel_id: 'CZEIMS001',
      channel_name: '0060-zeims-biz',
      workspace: 'unson',
      project_id: 'proj_zeims',
      type: 'business'
    }
  ]
};

// S3クライアントのモック
function createMockS3Client(responseData) {
  let callCount = 0;
  return {
    send: jest.fn(async () => {
      callCount++;
      return {
        Body: {
          transformToString: async () => JSON.stringify(responseData)
        }
      };
    }),
    getCallCount: () => callCount
  };
}

function createErrorS3Client(errorMessage) {
  return {
    send: jest.fn(async () => {
      throw new Error(errorMessage);
    })
  };
}

function createInvalidJsonS3Client() {
  return {
    send: jest.fn(async () => ({
      Body: {
        transformToString: async () => 'invalid json'
      }
    }))
  };
}

describe('ChannelProjectResolver', () => {
  let getProjectIdByChannel;
  let getChannelMapping;
  let clearCache;
  let setS3Client;
  let mockS3Client;

  beforeEach(() => {
    jest.resetModules();
    const resolver = require('../channel-project-resolver');
    getProjectIdByChannel = resolver.getProjectIdByChannel;
    getChannelMapping = resolver.getChannelMapping;
    clearCache = resolver.clearCache;
    setS3Client = resolver.setS3Client;

    // デフォルトのモックS3クライアント
    mockS3Client = createMockS3Client(mockChannelsData);
    setS3Client(mockS3Client);
    clearCache();
  });

  describe('getProjectIdByChannel', () => {
    it('チャンネルIDからプロジェクトIDを取得できる', async () => {
      const projectId = await getProjectIdByChannel('C08K58SUQ7N');
      expect(projectId).toBe('proj_baao');
    });

    it('同じプロジェクトの別チャンネルでも同じプロジェクトIDを返す', async () => {
      const biz = await getProjectIdByChannel('C08E010PYKE');
      const dev = await getProjectIdByChannel('C08A6ETSSR2');

      expect(biz).toBe('proj_dialogai');
      expect(dev).toBe('proj_dialogai');
    });

    it('未登録のチャンネルIDは"general"を返す', async () => {
      const projectId = await getProjectIdByChannel('CUNKNOWN123');
      expect(projectId).toBe('general');
    });

    it('S3から取得したマッピングをキャッシュする', async () => {
      // 1回目の呼び出し
      await getProjectIdByChannel('C08K58SUQ7N');
      // 2回目の呼び出し
      await getProjectIdByChannel('C08E010PYKE');

      // S3は1回しか呼ばれない
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('getChannelMapping', () => {
    it('全チャンネルのマッピングをMapで返す', async () => {
      const mapping = await getChannelMapping();

      expect(mapping).toBeInstanceOf(Map);
      expect(mapping.size).toBe(5);
      expect(mapping.get('C08K58SUQ7N')).toEqual({
        channel_name: '0110-baao',
        project_id: 'proj_baao',
        workspace: 'unson',
        type: 'general'
      });
    });
  });

  describe('エラーハンドリング', () => {
    it('S3エラー時は"general"を返す', async () => {
      setS3Client(createErrorS3Client('S3 access denied'));
      clearCache();

      const projectId = await getProjectIdByChannel('C08K58SUQ7N');
      expect(projectId).toBe('general');
    });

    it('JSONパースエラー時は"general"を返す', async () => {
      setS3Client(createInvalidJsonS3Client());
      clearCache();

      const projectId = await getProjectIdByChannel('C08K58SUQ7N');
      expect(projectId).toBe('general');
    });
  });

  describe('キャッシュTTL', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('キャッシュは5分で期限切れになる', async () => {
      const trackingS3Client = createMockS3Client(mockChannelsData);
      setS3Client(trackingS3Client);
      clearCache();

      // 1回目: S3から取得
      await getProjectIdByChannel('C08K58SUQ7N');
      expect(trackingS3Client.send).toHaveBeenCalledTimes(1);

      // 4分後: まだキャッシュ有効
      jest.advanceTimersByTime(4 * 60 * 1000);
      await getProjectIdByChannel('C08K58SUQ7N');
      expect(trackingS3Client.send).toHaveBeenCalledTimes(1);

      // 6分後: キャッシュ切れ、再取得
      jest.advanceTimersByTime(2 * 60 * 1000);
      await getProjectIdByChannel('C08K58SUQ7N');
      expect(trackingS3Client.send).toHaveBeenCalledTimes(2);
    });
  });
});
