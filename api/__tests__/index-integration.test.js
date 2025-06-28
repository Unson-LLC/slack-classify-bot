/**
 * Integration test for DynamoDB deduplication in index.js
 */

const { HybridDeduplicationService } = require('../dynamodb-deduplication');

// Mock dependencies before requiring index
jest.mock('@slack/bolt');
jest.mock('../processFileUpload');
jest.mock('../airtable-integration');
jest.mock('../dynamodb-deduplication', () => ({
  HybridDeduplicationService: jest.fn()
}));

describe('index.js integration with DynamoDB deduplication', () => {
  let mockApp;
  let mockDeduplicationService;
  let mockCheckAndMarkProcessed;
  let messageHandler;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock console to prevent output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock deduplication service
    mockCheckAndMarkProcessed = jest.fn();
    mockDeduplicationService = {
      checkAndMarkProcessed: mockCheckAndMarkProcessed
    };
    
    HybridDeduplicationService.mockImplementation(() => mockDeduplicationService);
    
    // Mock Slack app
    const { App, AwsLambdaReceiver } = require('@slack/bolt');
    
    AwsLambdaReceiver.mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn()
    }));
    
    mockApp = {
      message: jest.fn(),
      action: jest.fn()
    };
    
    App.mockImplementation(() => mockApp);
    
    // Mock environment variables
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SLACK_SIGNING_SECRET = 'test-secret';
    
    // Mock setInterval to prevent hanging tests
    jest.spyOn(global, 'setInterval').mockImplementation(() => 123);
    
    // Import index.js to trigger initialization
    require('../index');
    
    // Capture the message handler
    messageHandler = mockApp.message.mock.calls[0][0];
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
  });
  
  it('should initialize HybridDeduplicationService on startup', () => {
    expect(HybridDeduplicationService).toHaveBeenCalledWith(console);
  });
  
  it('should process new file uploads with DynamoDB deduplication', async () => {
    // Verify messageHandler was captured
    expect(messageHandler).toBeDefined();
    expect(typeof messageHandler).toBe('function');
    
    mockCheckAndMarkProcessed.mockResolvedValueOnce({ isNew: true });
    
    const { processFileUpload } = require('../processFileUpload');
    processFileUpload.mockResolvedValueOnce();
    
    const mockContext = {
      message: {
        subtype: 'file_share',
        ts: '1234567890.123456',
        user: 'U123456',
        channel: 'C123456',
        files: [{ id: 'F123456', name: 'test.txt' }]
      },
      client: { post: jest.fn() },
      logger: { 
        info: jest.fn(), 
        warn: jest.fn(), 
        error: jest.fn() 
      },
      event: { event_id: 'Ev123456' }
    };
    
    await messageHandler(mockContext);
    
    // Log for debugging
    console.log('mockCheckAndMarkProcessed calls:', mockCheckAndMarkProcessed.mock.calls);
    console.log('processFileUpload calls:', processFileUpload.mock.calls);
    
    expect(mockCheckAndMarkProcessed).toHaveBeenCalledWith(
      'Ev123456',
      expect.objectContaining({
        file_id: 'F123456',
        channel_id: 'C123456',
        user_id: 'U123456',
        lambda_instance_id: 'unknown' // Since global.context is not set
      })
    );
    
    expect(processFileUpload).toHaveBeenCalledWith(
      mockContext.message,
      mockContext.client,
      mockContext.logger,
      expect.any(Map)
    );
  });
  
  it('should skip duplicate file uploads', async () => {
    mockCheckAndMarkProcessed.mockResolvedValueOnce({ 
      isNew: false, 
      reason: 'Already processed by another instance' 
    });
    
    const { processFileUpload } = require('../processFileUpload');
    
    const mockContext = {
      message: {
        subtype: 'file_share',
        ts: '1234567890.123456',
        user: 'U123456',
        channel: 'C123456',
        files: [{ id: 'F123456', name: 'test.txt' }]
      },
      client: { post: jest.fn() },
      logger: { 
        info: jest.fn(), 
        warn: jest.fn(), 
        error: jest.fn() 
      },
      event: { event_id: 'Ev123456' }
    };
    
    await messageHandler(mockContext);
    
    expect(mockCheckAndMarkProcessed).toHaveBeenCalled();
    expect(processFileUpload).not.toHaveBeenCalled();
    expect(mockContext.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate event detected')
    );
  });
  
  it('should handle DynamoDB errors with fallback', async () => {
    mockCheckAndMarkProcessed.mockRejectedValueOnce(new Error('deduplication error'));
    
    const { processFileUpload } = require('../processFileUpload');
    processFileUpload.mockResolvedValueOnce();
    
    const mockContext = {
      message: {
        subtype: 'file_share',
        ts: '1234567890.123456',
        user: 'U123456',
        channel: 'C123456',
        files: [{ id: 'F123456', name: 'test.txt' }]
      },
      client: { post: jest.fn() },
      logger: { 
        info: jest.fn(), 
        warn: jest.fn(), 
        error: jest.fn() 
      },
      event: { event_id: 'Ev123456' }
    };
    
    await messageHandler(mockContext);
    
    expect(mockContext.logger.error).toHaveBeenCalledWith(
      'Error in file upload processing:',
      expect.any(Error)
    );
    
    // Should still process the file (fallback to in-memory)
    expect(processFileUpload).toHaveBeenCalled();
  });
  
  it('should not process messages from own bot', async () => {
    process.env.SLACK_BOT_ID = 'B123456';
    
    const mockContext = {
      message: {
        subtype: 'file_share',
        ts: '1234567890.123456',
        user: 'U123456',
        channel: 'C123456',
        bot_id: 'B123456',
        files: [{ id: 'F123456', name: 'test.txt' }]
      },
      client: { post: jest.fn() },
      logger: { 
        info: jest.fn(), 
        warn: jest.fn(), 
        error: jest.fn() 
      },
      event: { event_id: 'Ev123456' }
    };
    
    await messageHandler(mockContext);
    
    // Should not check deduplication for own bot messages
    expect(mockCheckAndMarkProcessed).not.toHaveBeenCalled();
    
    delete process.env.SLACK_BOT_ID;
  });
});