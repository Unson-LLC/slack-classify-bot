/**
 * DynamoDB Integration Tests
 * 
 * これは実際のAWS DynamoDBサービスに接続する統合テストです。
 * 通常のユニットテストとは異なり、実際のインフラストラクチャを使用します。
 * 
 * 実行方法:
 * 1. AWS認証情報が設定されていることを確認
 *    - AWS_ACCESS_KEY_ID
 *    - AWS_SECRET_ACCESS_KEY
 *    - AWS_REGION (デフォルト: us-east-1)
 * 
 * 2. 統合テストのみを実行:
 *    npm test -- --testNamePattern="DynamoDB Integration"
 * 
 * 3. 全てのテストを実行（統合テストを含む）:
 *    INTEGRATION_TEST=true npm test
 * 
 * 注意: このテストは実際のAWSリソースを作成し、料金が発生する可能性があります。
 */

const { DynamoDBClient, CreateTableCommand, DeleteTableCommand, DescribeTableCommand, UpdateTimeToLiveCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { EventDeduplicationService } = require('../dynamodb-deduplication');

// 統合テストのスキップ条件
const skipIntegrationTests = !process.env.INTEGRATION_TEST && !process.env.CI;
const describeIntegration = skipIntegrationTests ? describe.skip : describe;

// 既存のテーブルを使用（CreateTable権限がないため）
const TEST_TABLE_NAME = 'mana-processed-events';

describeIntegration('DynamoDB Integration', () => {
  let dynamoClient;
  let docClient;
  let eventService;
  
  beforeAll(async () => {
    // AWS設定
    const region = process.env.AWS_REGION || 'us-east-1';
    dynamoClient = new DynamoDBClient({ region });
    docClient = DynamoDBDocumentClient.from(dynamoClient);
    
    // 既存のテーブルを使用
    console.log(`Using existing table: ${TEST_TABLE_NAME}`);
    
    try {
      // テーブルが存在することを確認
      await dynamoClient.send(new DescribeTableCommand({ TableName: TEST_TABLE_NAME }));
      console.log(`Table ${TEST_TABLE_NAME} exists`);
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        console.error(`Table ${TEST_TABLE_NAME} does not exist. Please create it first.`);
        throw new Error('Test table does not exist. Run: aws dynamodb create-table --table-name mana-processed-events --attribute-definitions AttributeName=event_key,AttributeType=S --key-schema AttributeName=event_key,KeyType=HASH --billing-mode PAY_PER_REQUEST');
      }
      throw error;
    }
    
    // テスト用の環境変数を設定
    process.env.DEDUP_TABLE_NAME = TEST_TABLE_NAME;
    
    // EventDeduplicationServiceインスタンスの作成
    eventService = new EventDeduplicationService();
  });
  
  afterAll(async () => {
    // 環境変数をクリーンアップ
    delete process.env.DEDUP_TABLE_NAME;
    
    // 注意: 本番テーブルを使用しているため、削除しない
    console.log('Test completed. Table not deleted as it is the production table.');
  });
  
  describe('テーブルアクセス', () => {
    test('テーブルが存在しアクセスできることを確認', async () => {
      // Arrange & Act
      const result = await dynamoClient.send(new DescribeTableCommand({ TableName: TEST_TABLE_NAME }));
      
      // Assert
      expect(result.Table).toBeDefined();
      expect(result.Table.TableName).toBe(TEST_TABLE_NAME);
      expect(result.Table.TableStatus).toBe('ACTIVE');
      expect(result.Table.KeySchema).toEqual([
        { AttributeName: 'event_key', KeyType: 'HASH' }
      ]);
    });
  });
  
  describe('データの読み書き', () => {
    test('イベントを正しく保存できることを確認', async () => {
      // Arrange
      const eventKey = 'integration-test-' + Date.now() + '-' + Math.random().toString(36).substring(7);
      const metadata = {
        file_id: 'F123456',
        channel_id: 'C123456',
        user_id: 'U123456',
        test_type: 'integration'
      };
      
      // Act
      const result = await eventService.checkAndMarkProcessed(eventKey, metadata);
      
      // Assert
      expect(result.isNew).toBe(true);
      
      // 実際にDynamoDBに保存されたことを確認
      const getResult = await docClient.send(new GetCommand({
        TableName: TEST_TABLE_NAME,
        Key: { event_key: eventKey }
      }));
      
      expect(getResult.Item).toBeDefined();
      expect(getResult.Item.event_key).toBe(eventKey);
      expect(getResult.Item.processed_at).toBeDefined();
      expect(getResult.Item.ttl).toBeDefined();
      expect(getResult.Item.file_id).toBe(metadata.file_id);
      expect(getResult.Item.channel_id).toBe(metadata.channel_id);
      expect(getResult.Item.user_id).toBe(metadata.user_id);
      expect(getResult.Item.test_type).toBe('integration');
    });
    
    test('重複するイベントは検出されることを確認', async () => {
      // Arrange
      const eventKey = 'duplicate-event-' + Date.now();
      const metadata = { file_id: 'F123' };
      
      // Act
      const firstResult = await eventService.checkAndMarkProcessed(eventKey, metadata);
      const secondResult = await eventService.checkAndMarkProcessed(eventKey, metadata);
      
      // Assert
      expect(firstResult.isNew).toBe(true);
      expect(secondResult.isNew).toBe(false);
      expect(secondResult.reason).toBe('Already processed by another instance');
    });
    
  });
  
  describe('TTL（Time To Live）動作', () => {
    test('TTL値が正しく設定されることを確認', async () => {
      // Arrange
      const eventKey = 'ttl-test-' + Date.now();
      const ttlHours = 6; // EventDeduplicationServiceのデフォルト値
      
      // Act
      await eventService.checkAndMarkProcessed(eventKey, {});
      
      // TTL値を確認
      const getResult = await docClient.send(new GetCommand({
        TableName: TEST_TABLE_NAME,
        Key: { event_key: eventKey }
      }));
      
      // Assert
      const item = getResult.Item;
      expect(item.ttl).toBeDefined();
      
      // TTLは現在時刻 + 6時間（秒単位）のはず
      const currentTime = Math.floor(Date.now() / 1000);
      const expectedTtl = currentTime + (ttlHours * 3600);
      
      // 多少の誤差を許容（テスト実行時間を考慮）
      expect(item.ttl).toBeGreaterThanOrEqual(expectedTtl - 10);
      expect(item.ttl).toBeLessThanOrEqual(expectedTtl + 10);
    });
    
  });
  
  describe('エラーハンドリング', () => {
    test('存在しないテーブルへのアクセスが適切にエラーを返すことを確認', async () => {
      // Arrange
      const originalTableName = process.env.DEDUP_TABLE_NAME;
      process.env.DEDUP_TABLE_NAME = 'non-existing-table-' + Date.now();
      const invalidService = new EventDeduplicationService();
      
      // Act & Assert
      await expect(invalidService.checkAndMarkProcessed('test-event', {})).rejects.toThrow();
      
      // Cleanup
      process.env.DEDUP_TABLE_NAME = originalTableName;
    });
  });
  
  describe('大量データ処理', () => {
    test('複数のイベントを並行して追加できることを確認', async () => {
      // Arrange
      const eventCount = 10;
      const eventKeys = Array.from({ length: eventCount }, (_, i) => `bulk-event-${Date.now()}-${i}`);
      
      // Act
      const results = await Promise.all(
        eventKeys.map(key => eventService.checkAndMarkProcessed(key, { bulk_test: true }))
      );
      
      // Assert
      expect(results).toHaveLength(eventCount);
      expect(results.every(result => result.isNew === true)).toBe(true);
      
      // 全てのイベントが保存されたことを確認
      const verifyResults = await Promise.all(
        eventKeys.map(async (key) => {
          const result = await docClient.send(new GetCommand({
            TableName: TEST_TABLE_NAME,
            Key: { event_key: key }
          }));
          return result.Item !== undefined;
        })
      );
      expect(verifyResults.every(result => result === true)).toBe(true);
    });
  });
});

/**
 * テーブルがアクティブになるまで待機するヘルパー関数
 * @param {AWS.DynamoDB} dynamoClient - DynamoDBクライアント
 * @param {string} tableName - テーブル名
 * @param {number} maxWaitTime - 最大待機時間（ミリ秒）
 */
