/**
 * Design References:
 * - See docs/design/DYNAMODB-DEDUPLICATION-DESIGN.md for DynamoDB deduplication design
 * 
 * Related Classes:
 * - dynamodb-deduplication.js: Main service being tested
 * - index.js: Will integrate this service for event deduplication
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { EventDeduplicationService } = require('../dynamodb-deduplication');

// Mock AWS SDK
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    PutCommand: jest.fn((input) => ({ input })),
    DynamoDBDocumentClient: actual.DynamoDBDocumentClient
  };
});

describe('EventDeduplicationService', () => {
  let service;
  let mockDocClient;
  let mockSend;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock DynamoDB Document Client
    mockSend = jest.fn();
    mockDocClient = {
      send: mockSend
    };
    
    DynamoDBDocumentClient.from = jest.fn().mockReturnValue(mockDocClient);
    DynamoDBClient.mockImplementation(() => ({}));
    
    // Set environment variables
    process.env.DEDUP_TABLE_NAME = 'test-table';
    process.env.AWS_REGION = 'us-east-1';
    
    service = new EventDeduplicationService();
  });

  afterEach(() => {
    delete process.env.DEDUP_TABLE_NAME;
    delete process.env.AWS_REGION;
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      delete process.env.DEDUP_TABLE_NAME;
      delete process.env.AWS_REGION;
      
      const defaultService = new EventDeduplicationService();
      
      expect(DynamoDBClient).toHaveBeenCalledWith({ region: 'us-east-1' });
      expect(defaultService.tableName).toBe('slack-classify-bot-processed-events');
      expect(defaultService.ttlHours).toBe(6);
    });

    it('should use environment variables when provided', () => {
      expect(service.tableName).toBe('test-table');
      expect(DynamoDBClient).toHaveBeenCalledWith({ region: 'us-east-1' });
    });
  });

  describe('checkAndMarkProcessed', () => {
    const eventKey = 'test-event-123';
    const metadata = {
      file_id: 'F123456',
      channel_id: 'C123456',
      user_id: 'U123456',
      lambda_instance_id: 'instance-123'
    };

    beforeEach(() => {
      // Fix time for consistent testing
      jest.spyOn(Date, 'now').mockReturnValue(1703808000000); // 2023-12-29 00:00:00 UTC
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return isNew: true for new events', async () => {
      mockSend.mockResolvedValueOnce({});
      
      const result = await service.checkAndMarkProcessed(eventKey, metadata);
      
      expect(result).toEqual({ isNew: true });
      expect(mockSend).toHaveBeenCalledTimes(1);
      
      // Verify the command was created with correct parameters
      const putCommand = mockSend.mock.calls[0][0];
      expect(PutCommand).toHaveBeenCalledWith({
        TableName: 'test-table',
        Item: {
          event_key: eventKey,
          processed_at: 1703808000,
          ttl: 1703829600, // 6 hours later
          ...metadata
        },
        ConditionExpression: 'attribute_not_exists(event_key)'
      });
    });

    it('should return isNew: false for duplicate events', async () => {
      const error = new Error('The conditional request failed');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);
      
      const result = await service.checkAndMarkProcessed(eventKey, metadata);
      
      expect(result).toEqual({ 
        isNew: false, 
        reason: 'Already processed by another instance' 
      });
    });

    it('should throw other DynamoDB errors', async () => {
      const error = new Error('DynamoDB service error');
      error.name = 'ServiceUnavailableException';
      mockSend.mockRejectedValueOnce(error);
      
      await expect(service.checkAndMarkProcessed(eventKey, metadata))
        .rejects.toThrow('DynamoDB service error');
    });

    it('should calculate TTL correctly', async () => {
      mockSend.mockResolvedValueOnce({});
      
      await service.checkAndMarkProcessed(eventKey, {});
      
      expect(PutCommand).toHaveBeenCalled();
      const commandArgs = PutCommand.mock.calls[0][0];
      const item = commandArgs.Item;
      
      expect(item.processed_at).toBe(1703808000); // Current time in seconds
      expect(item.ttl).toBe(1703829600); // 6 hours later (21600 seconds)
      expect(item.ttl - item.processed_at).toBe(21600); // Exactly 6 hours
    });

    it('should include all metadata in the item', async () => {
      mockSend.mockResolvedValueOnce({});
      
      const extendedMetadata = {
        ...metadata,
        additional_field: 'test-value'
      };
      
      await service.checkAndMarkProcessed(eventKey, extendedMetadata);
      
      expect(PutCommand).toHaveBeenCalled();
      const commandArgs = PutCommand.mock.calls[PutCommand.mock.calls.length - 1][0];
      const item = commandArgs.Item;
      
      expect(item).toMatchObject({
        event_key: eventKey,
        ...extendedMetadata
      });
    });
  });

  describe('error handling', () => {
    it('should handle network timeouts gracefully', async () => {
      const error = new Error('Request timeout');
      error.name = 'TimeoutError';
      mockSend.mockRejectedValueOnce(error);
      
      await expect(service.checkAndMarkProcessed('test-key', {}))
        .rejects.toThrow('Request timeout');
    });

    it('should handle throttling errors', async () => {
      const error = new Error('Throughput exceeded');
      error.name = 'ProvisionedThroughputExceededException';
      mockSend.mockRejectedValueOnce(error);
      
      await expect(service.checkAndMarkProcessed('test-key', {}))
        .rejects.toThrow('Throughput exceeded');
    });
  });
});