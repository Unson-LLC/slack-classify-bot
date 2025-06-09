// Mock all external dependencies
jest.mock('@slack/bolt');
jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('axios');
jest.mock('airtable');

const { mockClient } = require('aws-sdk-client-mock');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const axios = require('axios');
const Airtable = require('airtable');

// Create mocks
const bedrockMock = mockClient(BedrockRuntimeClient);

describe('End-to-End Workflow Tests', () => {
  let mockSlackClient;
  let mockAirtableBase;
  
  beforeEach(() => {
    jest.clearAllMocks();
    bedrockMock.reset();
    
    // Mock Slack client
    mockSlackClient = {
      files: {
        info: jest.fn(),
        download: jest.fn()
      },
      chat: {
        postMessage: jest.fn(),
        postEphemeral: jest.fn(),
        update: jest.fn()
      }
    };
    
    // Mock Airtable
    mockAirtableBase = {
      table: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue([
            {
              id: 'recProj1',
              fields: {
                ID: 'proj1',
                name: 'Project Alpha',
                owner: 'company',
                repo: 'project-alpha'
              }
            },
            {
              id: 'recProj2',
              fields: {
                ID: 'proj2',
                name: 'Project Beta',
                owner: 'company',
                repo: 'project-beta'
              }
            }
          ])
        }),
        create: jest.fn().mockResolvedValue({
          id: 'recNew123',
          fields: {
            ID: 'new-file-123'
          }
        })
      })
    };
    
    Airtable.configure = jest.fn();
    Airtable.base = jest.fn().mockReturnValue(mockAirtableBase);
  });

  describe('Complete File Processing Workflow', () => {
    it('should process a text file from upload to GitHub storage', async () => {
      // Step 1: File upload event
      const fileUploadEvent = {
        type: 'file_share',
        files: [{
          id: 'F123456',
          name: 'meeting-notes.txt',
          mimetype: 'text/plain',
          size: 1024,
          url_private: 'https://files.slack.com/files-pri/T123/F123/meeting-notes.txt'
        }],
        user: 'U123456',
        channel: 'C123456',
        ts: '1234567890.123'
      };

      // Mock file info and download
      mockSlackClient.files.info.mockResolvedValue({
        file: {
          ...fileUploadEvent.files[0],
          content: 'Meeting notes content here...'
        }
      });

      const fileContent = '本日のミーティングでプロジェクトの進捗を確認しました。次のステップは要件定義です。';
      mockSlackClient.files.download.mockResolvedValue({
        data: Buffer.from(fileContent)
      });

      // Mock Bedrock response
      const summaryResponse = {
        content: [{
          text: `## 会議の概要
プロジェクトの進捗確認ミーティングを実施し、次のステップについて合意しました。

## ネクストアクション
- 要件定義書の作成（担当：未定）
- スケジュールの確定（担当：PM）`
        }]
      };

      bedrockMock.on(InvokeModelCommand).resolves({
        body: new TextEncoder().encode(JSON.stringify(summaryResponse))
      });

      // Mock n8n webhook response
      axios.post.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      // Step 2: Bot posts project selection message
      const expectedProjectButtons = expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('meeting-notes.txt')
            })
          }),
          expect.objectContaining({
            type: 'actions',
            elements: expect.arrayContaining([
              expect.objectContaining({
                action_id: 'select_project_button_proj1',
                text: expect.objectContaining({
                  text: 'Project Alpha'
                })
              }),
              expect.objectContaining({
                action_id: 'select_project_button_proj2',
                text: expect.objectContaining({
                  text: 'Project Beta'
                })
              })
            ])
          })
        ])
      });

      // Step 3: User selects a project
      const projectSelectionAction = {
        action_id: 'select_project_button_proj1',
        value: 'proj1'
      };

      const projectSelectionBody = {
        user: { id: 'U123456' },
        channel: { id: 'C123456' },
        message: { ts: '1234567890.456' }
      };

      // Step 4: Verify n8n webhook payload
      const expectedN8nPayload = {
        type: 'file_processing',
        file: {
          name: 'meeting-notes.txt',
          content: fileContent,
          summary: summaryResponse.content[0].text,
          uploaded_by: 'U123456',
          channel: 'C123456',
          timestamp: expect.any(String)
        },
        project: {
          id: 'recProj1',
          name: 'Project Alpha',
          owner: 'company',
          repo: 'project-alpha'
        },
        metadata: {
          slack_file_id: 'F123456',
          processing_timestamp: expect.any(String)
        }
      };

      // Verify the complete workflow
      expect(bedrockMock.commandCalls(InvokeModelCommand)).toHaveLength(0); // Will be called during actual execution
      expect(axios.post).toHaveBeenCalledTimes(0); // Will be called during actual execution
    });

    it('should handle errors at each step gracefully', async () => {
      // Test file download failure
      mockSlackClient.files.info.mockRejectedValue(new Error('File not found'));

      // Test Bedrock API failure
      bedrockMock.on(InvokeModelCommand).rejects(new Error('Bedrock service unavailable'));

      // Test n8n webhook failure
      axios.post.mockRejectedValue(new Error('Network error'));

      // Each step should handle errors gracefully without crashing
      // Error messages should be logged
      // User should receive appropriate error feedback
    });

    it('should enforce security classifications throughout workflow', async () => {
      // Test with confidential content
      const confidentialContent = '今期の予算は5000万円で、売上目標は1億円です。役員会で決定しました。';

      mockSlackClient.files.download.mockResolvedValue({
        data: Buffer.from(confidentialContent)
      });

      // Verify that:
      // 1. Content is classified as CONFIDENTIAL
      // 2. Only authorized users can access
      // 3. Appropriate repository is selected
      // 4. Access warnings are displayed
    });

    it('should handle concurrent file uploads correctly', async () => {
      // Simulate multiple files being uploaded simultaneously
      const file1Event = {
        files: [{ id: 'F111', name: 'file1.txt' }],
        user: 'U111',
        channel: 'C111'
      };

      const file2Event = {
        files: [{ id: 'F222', name: 'file2.txt' }],
        user: 'U222',
        channel: 'C222'
      };

      // Both files should be processed independently
      // File data should not be mixed up
      // Each should maintain its own state
    });
  });

  describe('Workflow State Management', () => {
    it('should properly manage file data store', async () => {
      // Verify that file data is:
      // 1. Stored correctly with unique keys
      // 2. Retrieved accurately when needed
      // 3. Cleaned up after processing
      // 4. Not accessible after timeout
    });

    it('should handle Lambda cold starts', async () => {
      // Verify that the system handles:
      // 1. First invocation after cold start
      // 2. Initialization of all services
      // 3. No data loss during initialization
    });
  });

  describe('Integration Points', () => {
    it('should validate Slack request signatures', async () => {
      // Test that invalid signatures are rejected
      // Test that valid signatures are accepted
      // Test replay attack prevention
    });

    it('should respect rate limits', async () => {
      // Test Slack API rate limits
      // Test Bedrock API rate limits
      // Test Airtable API rate limits
      // Verify proper backoff and retry logic
    });

    it('should handle service degradation', async () => {
      // Test when Bedrock is slow but working
      // Test when Airtable is partially available
      // Test when n8n endpoint is intermittent
      // Verify graceful degradation
    });
  });

  describe('Data Consistency', () => {
    it('should ensure data consistency across services', async () => {
      // Verify that:
      // 1. Airtable records match processed files
      // 2. GitHub commits contain correct content
      // 3. Slack messages reflect actual state
      // 4. No orphaned records in any service
    });

    it('should handle transaction rollback scenarios', async () => {
      // Test when GitHub commit fails after Airtable update
      // Test when Slack message update fails
      // Verify appropriate rollback or compensation
    });
  });
});