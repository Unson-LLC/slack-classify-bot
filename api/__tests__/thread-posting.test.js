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

const axios = require('axios');
jest.mock('axios');
jest.mock('airtable');
jest.mock('../llm-integration', () => ({
  generateFilename: jest.fn().mockResolvedValue('test-content-meeting')
}));

describe('GitHub Commit Completion Message Thread Posting', () => {
  let mockClient;
  let mockLogger;
  let AirtableIntegration;
  let airtableIntegration;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
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
    
    // Require after environment setup
    AirtableIntegration = require('../airtable-integration');
    airtableIntegration = new AirtableIntegration();
  });
  
  afterEach(() => {
    delete process.env.AIRTABLE_TOKEN;
    delete process.env.AIRTABLE_BASE;
    delete process.env.N8N_ENDPOINT;
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
        content: 'Test content',
        channelId: 'C123456',
        userId: 'U123456',
        threadTs: '1234567890.100' // 元のスレッドTS
      });
    });
    
    test('GitHubコミット成功時にスレッド内に完了メッセージを投稿する', async () => {
      // Arrange
      axios.post.mockImplementation((url) => {
        if (url.endsWith('/slack-airtable')) {
          return Promise.resolve({
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
      
      // Assert - 完了メッセージがスレッドに投稿されることを確認
      expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C123456',
          thread_ts: '1234567890.100', // 元のスレッドTSが使用されている
          blocks: expect.any(Array),
          text: expect.stringContaining('GitHubにコミットしました')
        })
      );
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
      
      axios.post.mockResolvedValue({
        data: {
          status: 'success',
          data: {
            owner: 'test-owner',
            repo: 'test-repo'
          }
        }
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
      axios.post.mockResolvedValue({
        data: { status: 'success' }
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
          text: expect.stringContaining('n8nへの送信は失敗しました')
        })
      );
    });
  });
});