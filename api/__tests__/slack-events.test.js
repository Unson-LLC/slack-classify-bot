// Mock dependencies before requiring the module
jest.mock('@slack/bolt', () => ({
  App: jest.fn().mockImplementation(() => ({
    message: jest.fn(),
    action: jest.fn(),
    start: jest.fn()
  })),
  AwsLambdaReceiver: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(jest.fn())
  }))
}));

jest.mock('../processFileUpload', () => ({
  processFileUpload: jest.fn()
}));

// Mock AirtableIntegration class
jest.mock('../airtable-integration', () => {
  return jest.fn().mockImplementation(() => ({
    processFileWithProject: jest.fn(),
    getProjectList: jest.fn(),
    buildProjectSelectionBlocks: jest.fn()
  }));
});

const { App } = require('@slack/bolt');
const { processFileUpload } = require('../processFileUpload');
const AirtableIntegration = require('../airtable-integration');

describe('Slack Events Integration Tests', () => {
  let app;
  let messageHandler;
  let actionHandlers = {};

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set up environment variables
    process.env.SLACK_BOT_TOKEN = 'test-token';
    process.env.SLACK_SIGNING_SECRET = 'test-secret';
    process.env.AIRTABLE_TOKEN = 'test-airtable-token';
    process.env.AIRTABLE_BASE = 'test-base';
    
    // Capture the app instance and handlers
    App.mockImplementation(() => {
      app = {
        message: jest.fn((handler) => {
          messageHandler = handler;
        }),
        action: jest.fn((pattern, handler) => {
          const key = pattern.toString ? pattern.toString() : pattern;
          actionHandlers[key] = handler;
        })
      };
      return app;
    });

    // Require the module to trigger app initialization
    jest.resetModules();
    require('../index');
  });

  describe('File Upload Event', () => {
    it('should process file uploads from users', async () => {
      const message = {
        subtype: 'file_share',
        files: [{ id: 'F12345', name: 'test.txt' }],
        channel: 'C12345',
        user: 'U12345',
        ts: '1234567890.123'
      };
      
      const client = { chat: { postMessage: jest.fn() } };
      const logger = { info: jest.fn(), warn: jest.fn() };

      await messageHandler({ message, client, logger });

      expect(logger.info).toHaveBeenCalledWith('Processing file upload for file: F12345');
      expect(processFileUpload).toHaveBeenCalledWith(message, client, logger, expect.any(Map));
    });

    it('should ignore file uploads from bots', async () => {
      const message = {
        subtype: 'file_share',
        bot_id: 'B12345',
        files: [{ id: 'F12345' }]
      };
      
      const client = { chat: { postMessage: jest.fn() } };
      const logger = { info: jest.fn(), warn: jest.fn() };

      await messageHandler({ message, client, logger });

      expect(processFileUpload).not.toHaveBeenCalled();
    });

    it('should handle missing files gracefully', async () => {
      const message = {
        subtype: 'file_share',
        files: []
      };
      
      const client = { chat: { postMessage: jest.fn() } };
      const logger = { info: jest.fn(), warn: jest.fn() };

      await messageHandler({ message, client, logger });

      expect(logger.warn).toHaveBeenCalledWith('File share event, but no files found.');
      expect(processFileUpload).not.toHaveBeenCalled();
    });

    it('should handle processFileUpload errors', async () => {
      processFileUpload.mockRejectedValue(new Error('Processing error'));
      
      const message = {
        subtype: 'file_share',
        files: [{ id: 'F12345' }]
      };
      
      const client = { chat: { postMessage: jest.fn() } };
      const logger = { info: jest.fn(), error: jest.fn() };

      await messageHandler({ message, client, logger });

      expect(logger.error).toHaveBeenCalledWith(
        'Error in processFileUpload async call:',
        expect.any(Error)
      );
    });
  });

  describe('Project Selection Button Click', () => {
    const projectOptions = [
      { text: 'Project Alpha', value: 'alpha-123' },
      { text: 'Project Beta', value: 'beta-456' }
    ];

    it('should process project selection', async () => {
      const ack = jest.fn();
      const action = {
        value: '{"projectId":"alpha-123","projectName":"Alpha Project","fileId":"F12345"}'
      };
      const body = {
        message: { ts: '123' },
        channel: { id: 'C12345' },
        user: { id: 'U12345' }
      };
      const client = { chat: { update: jest.fn() } };
      const logger = { info: jest.fn() };

      // Find the action handler for project selection
      const actionPattern = Object.keys(actionHandlers).find(key => 
        key.includes('select_project')
      );
      
      expect(actionPattern).toBeDefined();
      
      const handler = actionHandlers[actionPattern];
      
      // Create a mock AirtableIntegration instance
      const mockAirtableInstance = {
        processFileWithProject: jest.fn().mockResolvedValue()
      };
      AirtableIntegration.mockReturnValue(mockAirtableInstance);
      
      await handler({ ack, action, body, client, logger });

      expect(ack).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('--- Project Selection Button Clicked ---');
      expect(mockAirtableInstance.processFileWithProject).toHaveBeenCalledWith(
        action,
        body,
        client,
        logger,
        expect.any(Map)
      );
    });

    it('should handle project selection errors', async () => {
      const ack = jest.fn();
      const action = { value: 'invalid-json' };
      const body = { message: { ts: '123' } };
      const client = {};
      const logger = { info: jest.fn(), error: jest.fn() };

      const actionPattern = Object.keys(actionHandlers).find(key => 
        key.includes('select_project')
      );
      
      const handler = actionHandlers[actionPattern];
      
      // Create a mock that throws an error
      const mockAirtableInstance = {
        processFileWithProject: jest.fn().mockRejectedValue(new Error('Processing error'))
      };
      AirtableIntegration.mockReturnValue(mockAirtableInstance);
      
      await handler({ ack, action, body, client, logger });

      expect(logger.error).toHaveBeenCalledWith(
        'Error processing project selection:',
        expect.any(Error)
      );
    });
  });

  describe('Update Airtable Record Button Click', () => {
    it('should handle update record action', async () => {
      const ack = jest.fn();
      const body = {
        message: { ts: '123' },
        channel: { id: 'C12345' },
        user: { id: 'U12345' }
      };
      const client = { chat: { update: jest.fn() } };
      const logger = { info: jest.fn() };
      
      const projectOptions = [
        { text: 'Project Alpha', value: 'alpha-123' }
      ];
      
      const mockBlocks = [
        { type: 'section', text: { text: 'Select project' } }
      ];

      const mockAirtableInstance = {
        getProjectList: jest.fn().mockResolvedValue(projectOptions),
        buildProjectSelectionBlocks: jest.fn().mockReturnValue(mockBlocks)
      };
      AirtableIntegration.mockReturnValue(mockAirtableInstance);

      await actionHandlers['update_airtable_record']({ ack, body, client, logger });

      expect(ack).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('--- Update Airtable Record Button Clicked ---');
      expect(mockAirtableInstance.getProjectList).toHaveBeenCalledWith(logger);
      expect(mockAirtableInstance.buildProjectSelectionBlocks).toHaveBeenCalledWith(
        'プロジェクトを再選択してください:',
        projectOptions,
        body.message.ts
      );
      expect(client.chat.update).toHaveBeenCalledWith({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: mockBlocks,
        text: 'プロジェクトを再選択してください。'
      });
    });
  });
});