/**
 * task-id-generator.js
 * タスクID生成器（DynamoDB atomic counter使用）
 *
 * TASK-ID形式: T-YYMM-NNN（例: T-2412-001）
 * - T: タスクのプレフィックス
 * - YYMM: 年月（2桁年 + 2桁月）
 * - NNN: 月内連番（3桁、ゼロパディング）
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.COUNTER_TABLE_NAME || 'brainbase-counters';
const COUNTER_ID = 'task_id';

class TaskIdGenerator {
  constructor(options = {}) {
    const client = new DynamoDBClient({
      region: options.region || process.env.AWS_REGION || 'us-east-1'
    });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = options.tableName || TABLE_NAME;
    this.counterId = options.counterId || COUNTER_ID;
  }

  /**
   * Dateオブジェクトから YYMM 形式の文字列を生成
   * @param {Date} date - 日付（省略時は現在日時）
   * @returns {string} - YYMM形式（例: "2412"）
   */
  formatYearMonth(date = new Date()) {
    const year = date.getFullYear() % 100;
    const month = date.getMonth() + 1;
    return `${year.toString().padStart(2, '0')}${month.toString().padStart(2, '0')}`;
  }

  /**
   * 年月と連番からタスクIDを生成
   * @param {string} yearMonth - YYMM形式
   * @param {number} sequence - 連番
   * @returns {string} - タスクID（例: "T-2412-001"）
   */
  formatTaskId(yearMonth, sequence) {
    const seqStr = sequence.toString().padStart(3, '0');
    return `T-${yearMonth}-${seqStr}`;
  }

  /**
   * DynamoDB atomic counterを使用して次のタスクIDを生成
   * @param {Date} date - 日付（省略時は現在日時）
   * @returns {Promise<string>} - 新しいタスクID
   */
  async generateNextId(date = new Date()) {
    const yearMonth = this.formatYearMonth(date);

    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        counter_id: this.counterId,
        year_month: yearMonth
      },
      UpdateExpression: 'SET #val = if_not_exists(#val, :zero) + :inc',
      ExpressionAttributeNames: {
        '#val': 'value'
      },
      ExpressionAttributeValues: {
        ':inc': 1,
        ':zero': 0
      },
      ReturnValues: 'ALL_NEW'
    });

    const response = await this.docClient.send(command);
    const newValue = response.Attributes.value;

    return this.formatTaskId(yearMonth, newValue);
  }

  /**
   * 現在のカウンター値を取得
   * @param {string} yearMonth - YYMM形式
   * @returns {Promise<number>} - 現在の値（存在しない場合は0）
   */
  async getCurrentCounter(yearMonth) {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        counter_id: this.counterId,
        year_month: yearMonth
      }
    });

    const response = await this.docClient.send(command);
    return response.Item?.value || 0;
  }

  /**
   * タスクIDをパースして構成要素を取得
   * @param {string} taskId - タスクID
   * @returns {Object|null} - パース結果（無効な場合はnull）
   */
  parseTaskId(taskId) {
    if (!taskId || typeof taskId !== 'string') {
      return null;
    }

    const match = taskId.match(/^(T)-(\d{4})-(\d+)$/);
    if (!match) {
      return null;
    }

    const [, prefix, yearMonth, seqStr] = match;
    const year = 2000 + parseInt(yearMonth.slice(0, 2), 10);
    const month = parseInt(yearMonth.slice(2, 4), 10);
    const sequence = parseInt(seqStr, 10);

    return {
      prefix,
      yearMonth,
      sequence,
      year,
      month
    };
  }

  /**
   * タスクIDの形式が有効かどうかを検証
   * @param {string} taskId - タスクID
   * @returns {boolean} - 有効な場合はtrue
   */
  isValidTaskId(taskId) {
    return this.parseTaskId(taskId) !== null;
  }
}

module.exports = { TaskIdGenerator };
