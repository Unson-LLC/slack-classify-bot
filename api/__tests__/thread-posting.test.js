/**
 * GitHubコミット完了メッセージのスレッド投稿テスト
 * 
 * Design References:
 * - コミット完了メッセージは元のファイルアップロードと同じスレッドに投稿される必要がある
 * 
 * Related Classes:
 * - airtable-integration.js: プロジェクト選択とGitHub連携処理
 * - processFileUpload.js: ファイルアップロード処理
 */

// モックを最初に設定
jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn()
}));
jest.mock('airtable');
jest.mock('../llm-integration', () => ({
  generateFilename: jest.fn().mockResolvedValue('test-content-meeting')
}));

const axios = require('axios');

describe('GitHub Commit Completion Message Thread Posting', () => {
  let mockClient;
  let mockLogger;
  let AirtableIntegration;
  let airtableIntegration;
  let consoleLogSpy;
  let consoleErrorSpy;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // axiosモックをリセット
    axios.get.mockReset();
    axios.post.mockReset();
    
    // Spy on console - コメントアウトしてデバッグ出力を有効にする
    // consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    // consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    
    // Mock Slack client
    mockClient = {
      chat: {
        postMessage: jest.fn().mockResolvedValue({ ok: true, ts: '1234567890.123' }),
        update: jest.fn().mockResolvedValue({ ok: true })
      },
      files: {
        info: jest.fn().mockResolvedValue({
          file: {
            content: 'Test file content'
          }
        })
      }
    };
    
    // Mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    
    // Mock Airtable
    const Airtable = require('airtable');
    const mockFind = jest.fn().mockResolvedValue({
      fields: {
        Name: 'Test Project',
        owner: 'test-owner',
        repo: 'test-repo',
        path_prefix: 'meetings/',
        branch: 'main'
      }
    });
    const mockTable = jest.fn().mockReturnValue({ find: mockFind });
    Airtable.mockImplementation(() => ({
      base: jest.fn().mockReturnValue(mockTable)
    }));
    
    // Setup axios mock for getProjects
    axios.get.mockResolvedValue({
      data: {
        records: [
          {
            id: 'proj123',
            fields: {
              Name: 'Test Project',
              owner: 'test-owner',
              repo: 'test-repo',
              path_prefix: 'meetings/'
            }
          }
        ]
      }
    });
    
    // Set up environment
    process.env.AIRTABLE_TOKEN = 'test-token';
    process.env.AIRTABLE_BASE = 'test-base';
    process.env.N8N_ENDPOINT = 'http://test-n8n.com/webhook';
    process.env.N8N_AIRTABLE_ENDPOINT = 'http://test-n8n.com/webhook';
    
    // jest.resetModules()の後、axiosモックを再設定
    jest.doMock('axios', () => ({
      get: axios.get,
      post: axios.post
    }));
    
    // Require after environment setup
    AirtableIntegration = require('../airtable-integration');
    airtableIntegration = new AirtableIntegration();
  });
  
  afterEach(() => {
    delete process.env.AIRTABLE_TOKEN;
    delete process.env.AIRTABLE_BASE;
    delete process.env.N8N_ENDPOINT;
    delete process.env.N8N_AIRTABLE_ENDPOINT;
    // consoleLogSpy.mockRestore();
    // consoleErrorSpy.mockRestore();
  });
  
  describe('processFileWithProject メソッドのスレッド投稿', () => {
    const mockAction = {
      value: JSON.stringify({
        projectId: 'proj123',
        projectName: 'Test Project',
        fileId: 'F123456',
        fileName: 'test.txt',
        channelId: 'C123456'
      })
    };
    
    const mockBody = {
      message: { 
        ts: '1234567890.123',
        thread_ts: '1234567890.100' // 重要: スレッドのタイムスタンプ
      },
      channel: { id: 'C123456' },
      user: { id: 'U123456' },
      team: { id: 'T123456' }
    };
    
    const mockFileDataStore = new Map();
    
    beforeEach(() => {
      mockFileDataStore.clear();
      mockFileDataStore.set('F123456_C123456', {
        fileId: 'F123456',
        fileName: 'test.txt',
        content: 'Test file content for meeting',  // 追加: コンテンツが必要
        summary: '会議の概要: テスト会議の内容です',  // 追加: サマリーも必要
        channelId: 'C123456',
        userId: 'U123456',
        threadTs: '1234567890.100' // 元のスレッドTS
      });
      // fileIdだけでも取得できるように
      mockFileDataStore.set('F123456', {
        fileId: 'F123456',
        fileName: 'test.txt',
        content: 'Test file content for meeting',
        summary: '会議の概要: テスト会議の内容です',
        channelId: 'C123456',
        userId: 'U123456',
        threadTs: '1234567890.100'
      });
    });
    
    test('GitHubコミット成功時にスレッド内に完了メッセージを投稿する', async () => {
      // Arrange
      // axios.postのモック設定
      axios.post.mockImplementation(() => {
        // 成功レスポンスを返す
        const response = {
          data: {
            status: 'success',
            data: {
              owner: 'test-owner',
              repo: 'test-repo',
              commitUrl: 'https://github.com/test-owner/test-repo/commit/abc123',
              filePath: 'meetings/2025-06-28_test-content-meeting.md',
              commitMessage: 'Add meeting notes',
              commitSha: 'abc123'
            }
          }
        };
        return Promise.resolve(response);
      });
      
      // Act
      await airtableIntegration.processFileWithProject(
        mockAction,
        mockBody,
        mockClient,
        mockLogger,
        mockFileDataStore
      );
      
      // Assert - 完了メッセージがスレッドに投稿されることを確認
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123456',
          thread_ts: '1234567890.100', // 元のスレッドTSが使用されている
          blocks: expect.any(Array),
          text: 'ファイルをn8nワークフローに送信しました: test.txt → Test Project'
        })
      );
      
      // ブロックの内容も確認
      const messageCall = mockClient.chat.postMessage.mock.calls[0][0];
      expect(messageCall.blocks[0].text.text).toContain('ファイルをGitHubにコミットしました！');
      expect(messageCall.blocks[0].text.text).toContain('GitHubに保存されました');
    });
    
    test('thread_tsがない場合はmessage.tsをthread_tsとして使用する', async () => {
      // Arrange
      const bodyWithoutThread = {
        ...mockBody,
        message: { 
          ts: '1234567890.123'
          // thread_ts がない
        }
      };
      
      const fileDataWithoutThread = new Map([
        ['F123456_C123456', {
          fileId: 'F123456',
          fileName: 'test.txt',
          content: 'Test content',
          channelId: 'C123456',
          userId: 'U123456',
          threadTs: '1234567890.123' // message.tsと同じ
        }]
      ]);
      
      axios.post.mockImplementation((url) => {
        if (url === 'https://test.n8n.io/webhook/airtable/slack-airtable' || 
            url === 'https://test.n8n.io/webhook/test/slack-airtable' ||
            url === 'http://test-n8n.com/webhook/slack-airtable') {
          return Promise.resolve({
            data: {
              status: 'success',
              data: {
                owner: 'test-owner',
                repo: 'test-repo',
                commitUrl: 'https://github.com/test-owner/test-repo/commit/abc123',
                filePath: 'meetings/2025-06-28_test-content-meeting.md'
              }
            }
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });
      
      // Act
      await airtableIntegration.processFileWithProject(
        mockAction,
        bodyWithoutThread,
        mockClient,
        mockLogger,
        fileDataWithoutThread
      );
      
      // Assert
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123456',
          thread_ts: '1234567890.123', // message.tsが使用される
          blocks: expect.any(Array)
        })
      );
    });
    
    test('fileDataStoreからthreadTsを正しく取得する', async () => {
      // Arrange
      axios.post.mockImplementation((url) => {
        if (url === 'https://test.n8n.io/webhook/airtable/slack-airtable' || 
            url === 'https://test.n8n.io/webhook/test/slack-airtable' ||
            url === 'http://test-n8n.com/webhook/slack-airtable') {
          return Promise.resolve({
            data: {
              status: 'success',
              data: {
                owner: 'test-owner',
                repo: 'test-repo',
                commitUrl: 'https://github.com/test-owner/test-repo/commit/abc123',
                filePath: 'meetings/2025-06-28_test-content-meeting.md'
              }
            }
          });
        }
        return Promise.reject(new Error('Unexpected URL'));
      });
      
      // Act
      await airtableIntegration.processFileWithProject(
        mockAction,
        mockBody,
        mockClient,
        mockLogger,
        mockFileDataStore
      );
      
      // Assert - fileDataStoreからthreadTsが取得されて使用されることを確認
      const fileData = mockFileDataStore.get('F123456_C123456');
      expect(fileData.threadTs).toBe('1234567890.100');
      
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: fileData.threadTs
        })
      );
    });
  });
  
  describe('エラーメッセージもスレッドに投稿される', () => {
    const mockAction = {
      value: JSON.stringify({
        projectId: 'proj123',
        projectName: 'Test Project',
        fileId: 'F123456',
        fileName: 'test.txt',  // fileNameを追加
        channelId: 'C123456'
      })
    };
    
    const mockBody = {
      message: { 
        ts: '1234567890.123',
        thread_ts: '1234567890.100'
      },
      channel: { id: 'C123456' },
      user: { id: 'U123456' }
    };
    
    const mockFileDataStore = new Map([
      ['F123456_C123456', {
        fileId: 'F123456',
        threadTs: '1234567890.100'
      }]
    ]);
    
    test('n8nエラー時でもスレッド内にメッセージを投稿する', async () => {
      // Arrange
      axios.post.mockRejectedValue(new Error('Network error'));
      
      // Act
      await airtableIntegration.processFileWithProject(
        mockAction,
        mockBody,
        mockClient,
        mockLogger,
        mockFileDataStore
      );
      
      // Assert
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123456',
          thread_ts: '1234567890.100', // エラー時もスレッドに投稿
          blocks: expect.any(Array),
          text: 'ファイルをn8nワークフローに送信しました: test.txt → Test Project'
        })
      );
      
      // エラー時のメッセージ内容を確認
      const messageCall = mockClient.chat.postMessage.mock.calls[0][0];
      expect(messageCall.blocks[0].text.text).toContain('プロジェクトを選択しました（n8nへの送信は失敗しました）');
    });
  });
});