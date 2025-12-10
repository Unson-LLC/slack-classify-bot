/**
 * airtable-mcp-client.js
 * Airtable MCP ツールの薄いラッパー
 *
 * 本番環境ではMCPツールを直接呼び出すため、このクライアントは
 * テスト用のモック境界として機能する。
 */

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE || 'app9oeZUNRWZyaSdb';
const AIRTABLE_TASKS_TABLE_ID = process.env.AIRTABLE_TASKS_TABLE_ID || 'tbl7m4SDujDG1ULR1';
// 環境変数名の互換性: AIRTABLE_API_KEY または AIRTABLE_TOKEN を使用
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_TOKEN;

class AirtableMCPClient {
  constructor(options = {}) {
    this.baseId = options.baseId || AIRTABLE_BASE_ID;
    this.tableId = options.tableId || AIRTABLE_TASKS_TABLE_ID;
  }

  /**
   * レコードを作成する
   * @param {Object} fields - レコードのフィールド
   * @returns {Promise<Object>} - 作成されたレコード
   */
  async createRecord(fields) {
    // Lambda環境ではMCPツール経由で呼び出される
    // この実装は直接Airtable APIを呼ぶフォールバック
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(this.baseId);

    return new Promise((resolve, reject) => {
      base(this.tableId).create([{ fields }], (err, records) => {
        if (err) {
          reject(err);
          return;
        }
        const record = records[0];
        resolve({
          id: record.id,
          fields: record.fields
        });
      });
    });
  }

  /**
   * レコードを更新する
   * @param {Array<{id: string, fields: Object}>} records - 更新するレコード
   * @returns {Promise<Object>} - 更新結果
   */
  async updateRecords(records) {
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(this.baseId);

    return new Promise((resolve, reject) => {
      base(this.tableId).update(records, (err, updatedRecords) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          records: updatedRecords.map(r => ({ id: r.id, fields: r.fields }))
        });
      });
    });
  }

  /**
   * レコード一覧を取得
   * @param {Object} options - 取得オプション
   * @returns {Promise<Object>} - レコード一覧
   */
  async listRecords(options = {}) {
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(this.baseId);

    return new Promise((resolve, reject) => {
      const records = [];
      base(this.tableId)
        .select({
          maxRecords: options.maxRecords || 100,
          filterByFormula: options.filterByFormula || ''
        })
        .eachPage(
          (pageRecords, fetchNextPage) => {
            records.push(...pageRecords.map(r => ({ id: r.id, fields: r.fields })));
            fetchNextPage();
          },
          (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve({ records });
          }
        );
    });
  }

  /**
   * テキスト検索
   * @param {string} searchTerm - 検索語
   * @param {Object} options - 検索オプション
   * @returns {Promise<Object>} - 検索結果
   */
  async searchRecords(searchTerm, options = {}) {
    // Airtableには直接の全文検索がないため、フィルタで代用
    const filterByFormula = `SEARCH("${searchTerm}", {task_id})`;
    return this.listRecords({ ...options, filterByFormula });
  }
}

module.exports = { AirtableMCPClient };
