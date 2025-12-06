/**
 * Design References:
 * - See docs/design/DYNAMODB-DEDUPLICATION-DESIGN.md for detailed design
 *
 * Related Classes:
 * - index.js: Integrates this service for Slack event deduplication
 * - processFileUpload.js: Uses deduplication to prevent duplicate file processing
 */

const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

class EventDeduplicationService {
  constructor() {
    this.tableName = process.env.DEDUP_TABLE_NAME || 'mana-processed-events';
    this.ttlHours = 6;
  }

  async checkAndMarkProcessed(eventKey, metadata) {
    const now = Math.floor(Date.now() / 1000);
    const ttl = now + (this.ttlHours * 3600);

    const params = {
      TableName: this.tableName,
      Item: {
        event_key: eventKey,
        processed_at: now,
        ttl: ttl,
        ...metadata
      },
      ConditionExpression: 'attribute_not_exists(event_key)'
    };

    try {
      await dynamodb.put(params).promise();
      return { isNew: true };
    } catch (error) {
      if (error.code === 'ConditionalCheckFailedException') {
        return { isNew: false, reason: 'Already processed by another instance' };
      }
      throw error;
    }
  }
}

class HybridDeduplicationService {
  constructor(logger, dynamoService = null) {
    this.dynamoService = dynamoService || new EventDeduplicationService();
    this.memoryFallback = new Map();
    this.useFallback = false;
    this.logger = logger || console;
    this.fallbackDuration = 60000; // 1 minute
    this.memoryCacheTTL = 10 * 60 * 1000; // 10 minutes
  }

  async checkAndMarkProcessed(eventKey, metadata) {
    try {
      if (!this.useFallback) {
        return await this.dynamoService.checkAndMarkProcessed(eventKey, metadata);
      }
    } catch (error) {
      if (!this.useFallback) {
        this.logger.error('DynamoDB error, falling back to memory:', error);
        this.useFallback = true;
        setTimeout(() => {
          this.useFallback = false;
        }, this.fallbackDuration);
      }
    }

    // Memory fallback
    if (this.memoryFallback.has(eventKey)) {
      return { isNew: false, reason: 'In-memory duplicate check' };
    }
    this.memoryFallback.set(eventKey, Date.now());
    return { isNew: true };
  }

  cleanupMemoryCache() {
    const now = Date.now();
    let cleanedCount = 0;
    for (const [key, timestamp] of this.memoryFallback.entries()) {
      if (now - timestamp > this.memoryCacheTTL) {
        this.memoryFallback.delete(key);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      this.logger.info(`Cleaned up ${cleanedCount} old entries from memory cache`);
    }
  }
}

module.exports = { EventDeduplicationService, HybridDeduplicationService };
