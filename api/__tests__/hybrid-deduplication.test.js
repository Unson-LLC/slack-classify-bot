/**
 * Design References:
 * - See docs/design/DYNAMODB-DEDUPLICATION-DESIGN.md section 5.2 for fallback strategy
 * 
 * Related Classes:
 * - dynamodb-deduplication.js: Core DynamoDB service
 * - index.js: Will use this hybrid service for resilient deduplication
 */

// Get the actual HybridDeduplicationService
const actualModule = jest.requireActual('../dynamodb-deduplication');
const { HybridDeduplicationService } = actualModule;

// Mock only EventDeduplicationService
jest.mock('../dynamodb-deduplication', () => {
  const actual = jest.requireActual('../dynamodb-deduplication');
  return {
    ...actual,
    EventDeduplicationService: jest.fn()
  };
});

// Import mocked EventDeduplicationService after mock setup
const { EventDeduplicationService } = require('../dynamodb-deduplication');

// Mock logger
const mockLogger = {
  error: jest.fn(),
  info: jest.fn()
};

describe('HybridDeduplicationService', () => {
  let service;
  let mockDynamoService;
  let mockCheckAndMarkProcessed;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Mock DynamoDB service
    mockCheckAndMarkProcessed = jest.fn();
    mockDynamoService = {
      checkAndMarkProcessed: mockCheckAndMarkProcessed
    };
    
    EventDeduplicationService.mockImplementation(() => mockDynamoService);
    
    service = new HybridDeduplicationService(mockLogger, mockDynamoService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('normal operation', () => {
    it('should use DynamoDB service when available', async () => {
      mockCheckAndMarkProcessed.mockResolvedValueOnce({ isNew: true });
      
      const result = await service.checkAndMarkProcessed('event-123', {});
      
      expect(result).toEqual({ isNew: true });
      expect(mockCheckAndMarkProcessed).toHaveBeenCalledWith('event-123', {});
      expect(service.useFallback).toBe(false);
      expect(service.dynamoService).toBe(mockDynamoService);
    });

    it('should handle duplicate detection from DynamoDB', async () => {
      mockCheckAndMarkProcessed.mockResolvedValueOnce({ 
        isNew: false, 
        reason: 'Already processed' 
      });
      
      const result = await service.checkAndMarkProcessed('event-123', {});
      
      expect(result).toEqual({ isNew: false, reason: 'Already processed' });
      expect(service.useFallback).toBe(false);
    });
  });

  describe('fallback behavior', () => {
    it('should switch to memory fallback on DynamoDB error', async () => {
      mockCheckAndMarkProcessed.mockRejectedValueOnce(new Error('DynamoDB unavailable'));
      
      const result = await service.checkAndMarkProcessed('event-123', {});
      
      expect(result).toEqual({ isNew: true });
      expect(mockLogger.error).toHaveBeenCalledWith(
        'DynamoDB error, falling back to memory:',
        expect.any(Error)
      );
      expect(service.useFallback).toBe(true);
    });

    it('should detect duplicates using memory fallback', async () => {
      // Force fallback mode
      mockCheckAndMarkProcessed.mockRejectedValueOnce(new Error('DynamoDB error'));
      await service.checkAndMarkProcessed('event-123', {});
      
      // Try same event again
      const result = await service.checkAndMarkProcessed('event-123', {});
      
      expect(result).toEqual({ 
        isNew: false, 
        reason: 'In-memory duplicate check' 
      });
    });

    it('should automatically retry DynamoDB after fallback timeout', async () => {
      // Trigger fallback
      mockCheckAndMarkProcessed.mockRejectedValueOnce(new Error('DynamoDB error'));
      await service.checkAndMarkProcessed('event-123', {});
      
      expect(service.useFallback).toBe(true);
      
      // Fast-forward 60 seconds
      jest.advanceTimersByTime(60000);
      
      // Should retry DynamoDB
      mockCheckAndMarkProcessed.mockResolvedValueOnce({ isNew: true });
      await service.checkAndMarkProcessed('event-456', {});
      
      expect(mockCheckAndMarkProcessed).toHaveBeenCalledWith('event-456', {});
      expect(service.useFallback).toBe(false);
    });

    it('should continue using memory fallback if still in fallback period', async () => {
      // Trigger fallback
      mockCheckAndMarkProcessed.mockRejectedValueOnce(new Error('DynamoDB error'));
      await service.checkAndMarkProcessed('event-123', {});
      
      // Fast-forward 30 seconds (still in fallback period)
      jest.advanceTimersByTime(30000);
      
      // Should still use memory fallback
      const result = await service.checkAndMarkProcessed('event-456', {});
      
      expect(result).toEqual({ isNew: true });
      expect(mockCheckAndMarkProcessed).toHaveBeenCalledTimes(1); // Only initial failed call
    });
  });

  describe('memory cleanup', () => {
    it('should clean up old entries from memory cache', async () => {
      // Force fallback mode
      service.useFallback = true;
      
      // Mock Date.now for consistent timestamps
      let currentTime = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
      
      // Add multiple events
      await service.checkAndMarkProcessed('event-1', {});
      
      // Fast-forward 5 minutes
      currentTime += 5 * 60 * 1000;
      
      await service.checkAndMarkProcessed('event-2', {});
      
      // Fast-forward another 6 minutes (event-1 should be cleaned up after 10 minutes)
      currentTime += 6 * 60 * 1000;
      
      // Trigger cleanup
      service.cleanupMemoryCache();
      
      // event-1 should be gone, event-2 should still exist
      const result1 = await service.checkAndMarkProcessed('event-1', {});
      const result2 = await service.checkAndMarkProcessed('event-2', {});
      
      expect(result1).toEqual({ isNew: true });
      expect(result2).toEqual({ isNew: false, reason: 'In-memory duplicate check' });
      
      // Restore Date.now
      Date.now.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle rapid successive errors gracefully', async () => {
      // Multiple rapid errors
      mockCheckAndMarkProcessed
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockRejectedValueOnce(new Error('Error 3'));
      
      await service.checkAndMarkProcessed('event-1', {});
      await service.checkAndMarkProcessed('event-2', {});
      await service.checkAndMarkProcessed('event-3', {});
      
      expect(service.useFallback).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledTimes(1); // Only logs first error
    });

    it('should handle metadata correctly in both modes', async () => {
      const metadata = { file_id: 'F123', channel_id: 'C123' };
      
      // DynamoDB mode
      mockCheckAndMarkProcessed.mockResolvedValueOnce({ isNew: true });
      await service.checkAndMarkProcessed('event-1', metadata);
      
      expect(mockCheckAndMarkProcessed).toHaveBeenCalledWith('event-1', metadata);
      
      // Memory fallback mode
      service.useFallback = true;
      const result = await service.checkAndMarkProcessed('event-2', metadata);
      
      expect(result).toEqual({ isNew: true });
    });
  });
});