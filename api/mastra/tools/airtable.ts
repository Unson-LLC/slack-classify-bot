// mastra/tools/airtable.ts
// Airtable MCP ツール

import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';
import Airtable from 'airtable';
import axios from 'axios';

// Airtable APIクライアント（シングルトン）
let airtableClient: any = null;

function getAirtableClient(): any {
  if (!airtableClient) {
    const apiKey = process.env.AIRTABLE_TOKEN;
    if (!apiKey) {
      throw new Error('AIRTABLE_TOKEN environment variable is not set');
    }
    airtableClient = new Airtable({ apiKey });
  }
  return airtableClient;
}

/**
 * Airtable Base一覧取得ツール
 */
export const airtableListBasesTool = createTool({
  id: 'airtable_list_bases',
  description: 'Airtableで利用可能なBase（データベース）の一覧を取得します。',
  inputSchema: z.object({}),
  outputSchema: z.object({
    bases: z.array(z.object({
      id: z.string(),
      name: z.string(),
    })),
  }),
  execute: async () => {
    try {
      const apiKey = process.env.AIRTABLE_TOKEN;

      const response = await axios.get('https://api.airtable.com/v0/meta/bases', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      const bases = (response.data.bases || []).map((base: any) => ({
        id: base.id,
        name: base.name,
      }));

      console.log(`[Airtable] Found ${bases.length} bases`);
      return { bases };
    } catch (error: any) {
      console.error('[Airtable] List bases error:', error.message);
      throw new Error(`Airtable Base一覧取得に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Airtable Table一覧取得ツール
 */
export const airtableListTablesTool = createTool({
  id: 'airtable_list_tables',
  description: '指定したAirtable Base内のテーブル一覧を取得します。',
  inputSchema: z.object({
    baseId: z.string().describe('Base ID（例: appXXXXXXXXXXXXXX）'),
  }),
  outputSchema: z.object({
    tables: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
    })),
  }),
  execute: async (input) => {
    const { baseId } = input;

    try {
      const apiKey = process.env.AIRTABLE_TOKEN;

      const response = await axios.get(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      const tables = (response.data.tables || []).map((table: any) => ({
        id: table.id,
        name: table.name,
        description: table.description || '',
      }));

      console.log(`[Airtable] Found ${tables.length} tables in base ${baseId}`);
      return { tables };
    } catch (error: any) {
      console.error('[Airtable] List tables error:', error.message);
      throw new Error(`Airtable Table一覧取得に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Airtable レコード一覧取得ツール
 */
export const airtableListRecordsTool = createTool({
  id: 'airtable_list_records',
  description: '指定したAirtable Tableからレコード一覧を取得します。',
  inputSchema: z.object({
    baseId: z.string().describe('Base ID'),
    tableId: z.string().describe('Table IDまたはテーブル名'),
    maxRecords: z.number().optional().default(100).describe('取得する最大レコード数（デフォルト: 100）'),
    filterByFormula: z.string().optional().describe('フィルター用のAirtable式（例: {Status} = "Active"）'),
    view: z.string().optional().describe('ビュー名'),
  }),
  outputSchema: z.object({
    records: z.array(z.object({
      id: z.string(),
      fields: z.record(z.string(), z.unknown()),
      createdTime: z.string().optional(),
    })),
    total: z.number(),
  }),
  execute: async (input) => {
    const { baseId, tableId, maxRecords = 100, filterByFormula, view } = input;

    try {
      const client = getAirtableClient();
      const base = client.base(baseId);

      const selectOptions: any = {
        maxRecords,
      };

      if (filterByFormula) {
        selectOptions.filterByFormula = filterByFormula;
      }
      if (view) {
        selectOptions.view = view;
      }

      const records: any[] = [];
      await base(tableId).select(selectOptions).eachPage((pageRecords: any[], fetchNextPage: () => void) => {
        pageRecords.forEach(record => {
          records.push({
            id: record.id,
            fields: record.fields,
            createdTime: record._rawJson?.createdTime,
          });
        });
        fetchNextPage();
      });

      console.log(`[Airtable] Found ${records.length} records in ${tableId}`);
      return { records, total: records.length };
    } catch (error: any) {
      console.error('[Airtable] List records error:', error.message);
      throw new Error(`Airtable レコード取得に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Airtable レコード検索ツール
 */
export const airtableSearchRecordsTool = createTool({
  id: 'airtable_search_records',
  description: 'Airtable Tableで特定のテキストを含むレコードを検索します。',
  inputSchema: z.object({
    baseId: z.string().describe('Base ID'),
    tableId: z.string().describe('Table IDまたはテーブル名'),
    searchTerm: z.string().describe('検索するテキスト'),
    searchFields: z.array(z.string()).optional().describe('検索対象フィールド名のリスト（指定しない場合は全フィールド）'),
    maxRecords: z.number().optional().default(50).describe('取得する最大レコード数'),
  }),
  outputSchema: z.object({
    records: z.array(z.object({
      id: z.string(),
      fields: z.record(z.string(), z.unknown()),
    })),
    total: z.number(),
  }),
  execute: async (input) => {
    const { baseId, tableId, searchTerm, searchFields, maxRecords = 50 } = input;

    try {
      const client = getAirtableClient();
      const base = client.base(baseId);

      // Build search formula
      let formula = '';
      if (searchFields && searchFields.length > 0) {
        const conditions = searchFields.map(field =>
          `SEARCH("${searchTerm}", {${field}})`
        );
        formula = `OR(${conditions.join(', ')})`;
      } else {
        // Search in RECORD_ID as fallback (Airtable doesn't have full-text search)
        formula = `SEARCH("${searchTerm}", RECORD_ID())`;
      }

      const records: any[] = [];
      await base(tableId).select({
        maxRecords,
        filterByFormula: formula,
      }).eachPage((pageRecords: any[], fetchNextPage: () => void) => {
        pageRecords.forEach(record => {
          records.push({
            id: record.id,
            fields: record.fields,
          });
        });
        fetchNextPage();
      });

      console.log(`[Airtable] Search found ${records.length} records for "${searchTerm}"`);
      return { records, total: records.length };
    } catch (error: any) {
      console.error('[Airtable] Search error:', error.message);
      throw new Error(`Airtable 検索に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Airtable レコード取得ツール
 */
export const airtableGetRecordTool = createTool({
  id: 'airtable_get_record',
  description: '特定のAirtableレコードをIDで取得します。',
  inputSchema: z.object({
    baseId: z.string().describe('Base ID'),
    tableId: z.string().describe('Table IDまたはテーブル名'),
    recordId: z.string().describe('レコードID（例: recXXXXXXXXXXXXXX）'),
  }),
  outputSchema: z.object({
    id: z.string(),
    fields: z.record(z.string(), z.unknown()),
    createdTime: z.string().optional(),
  }),
  execute: async (input) => {
    const { baseId, tableId, recordId } = input;

    try {
      const client = getAirtableClient();
      const base = client.base(baseId);

      const record = await base(tableId).find(recordId);

      console.log(`[Airtable] Retrieved record ${recordId}`);
      return {
        id: record.id,
        fields: record.fields,
        createdTime: record._rawJson?.createdTime,
      };
    } catch (error: any) {
      console.error('[Airtable] Get record error:', error.message);
      throw new Error(`Airtable レコード取得に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Airtable レコード作成ツール
 */
export const airtableCreateRecordTool = createTool({
  id: 'airtable_create_record',
  description: 'Airtable Tableに新しいレコードを作成します。',
  inputSchema: z.object({
    baseId: z.string().describe('Base ID'),
    tableId: z.string().describe('Table IDまたはテーブル名'),
    fields: z.record(z.string(), z.unknown()).describe('作成するフィールドのキー・バリュー（例: {"Name": "田中太郎", "Email": "tanaka@example.com"}）'),
  }),
  outputSchema: z.object({
    id: z.string(),
    fields: z.record(z.string(), z.unknown()),
    createdTime: z.string().optional(),
  }),
  execute: async (input) => {
    const { baseId, tableId, fields } = input;

    try {
      const client = getAirtableClient();
      const base = client.base(baseId);

      const record = await base(tableId).create(fields);

      console.log(`[Airtable] Created record ${record.id}`);
      return {
        id: record.id,
        fields: record.fields,
        createdTime: record._rawJson?.createdTime,
      };
    } catch (error: any) {
      console.error('[Airtable] Create record error:', error.message);
      throw new Error(`Airtable レコード作成に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Airtable レコード更新ツール
 */
export const airtableUpdateRecordTool = createTool({
  id: 'airtable_update_record',
  description: '既存のAirtableレコードを更新します。',
  inputSchema: z.object({
    baseId: z.string().describe('Base ID'),
    tableId: z.string().describe('Table IDまたはテーブル名'),
    recordId: z.string().describe('更新するレコードID'),
    fields: z.record(z.string(), z.unknown()).describe('更新するフィールドのキー・バリュー'),
  }),
  outputSchema: z.object({
    id: z.string(),
    fields: z.record(z.string(), z.unknown()),
  }),
  execute: async (input) => {
    const { baseId, tableId, recordId, fields } = input;

    try {
      const client = getAirtableClient();
      const base = client.base(baseId);

      const record = await base(tableId).update(recordId, fields);

      console.log(`[Airtable] Updated record ${record.id}`);
      return {
        id: record.id,
        fields: record.fields,
      };
    } catch (error: any) {
      console.error('[Airtable] Update record error:', error.message);
      throw new Error(`Airtable レコード更新に失敗しました: ${error.message}`);
    }
  },
});
