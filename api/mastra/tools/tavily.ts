// mastra/tools/tavily.ts
// Tavily Web検索ツール

import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';

// Tavily APIクライアント（動的インポート）
let tavilyClient: any = null;

async function getTavilyClient() {
  if (!tavilyClient) {
    const { tavily } = await import('@tavily/core');
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error('TAVILY_API_KEY environment variable is not set');
    }
    tavilyClient = tavily({ apiKey });
  }
  return tavilyClient;
}

/**
 * Web検索ツール
 * 最新の情報をWebから検索して取得
 */
export const webSearchTool = createTool({
  id: 'web_search',
  description: 'Web上の最新情報を検索します。企業情報、ニュース、技術情報など、リアルタイムの情報が必要な場合に使用してください。',
  inputSchema: z.object({
    query: z.string().describe('検索クエリ（日本語または英語）'),
    maxResults: z.number().optional().default(5).describe('取得する結果の最大数（デフォルト: 5）'),
    searchDepth: z.enum(['basic', 'advanced']).optional().default('basic').describe('検索の深さ（basic: 速い, advanced: より詳細）'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
      score: z.number().optional(),
    })),
    query: z.string(),
  }),
  execute: async (input) => {
    const { query, maxResults = 5, searchDepth = 'basic' } = input;

    console.log(`[Tavily] Searching: "${query}" (depth: ${searchDepth}, max: ${maxResults})`);

    try {
      const client = await getTavilyClient();
      const response = await client.search(query, {
        maxResults,
        searchDepth,
        includeAnswer: false,
      });

      const results = (response.results || []).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        score: r.score,
      }));

      console.log(`[Tavily] Found ${results.length} results`);

      return {
        results,
        query,
      };
    } catch (error: any) {
      console.error('[Tavily] Search error:', error.message);
      throw new Error(`Web検索に失敗しました: ${error.message}`);
    }
  },
});

/**
 * Webページ内容抽出ツール
 * 指定したURLの内容を抽出
 */
export const webExtractTool = createTool({
  id: 'web_extract',
  description: '指定したURLのWebページから内容を抽出します。検索結果のURLの詳細を確認したい場合に使用してください。',
  inputSchema: z.object({
    urls: z.array(z.string()).describe('抽出するURLのリスト（最大5つ）'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      url: z.string(),
      content: z.string(),
      success: z.boolean(),
    })),
  }),
  execute: async (input) => {
    const { urls } = input;

    // 最大5URLに制限
    const targetUrls = urls.slice(0, 5);
    console.log(`[Tavily] Extracting from ${targetUrls.length} URLs`);

    try {
      const client = await getTavilyClient();
      const response = await client.extract(targetUrls);

      const results = (response.results || []).map((r: any) => ({
        url: r.url || '',
        content: r.rawContent || r.content || '',
        success: true,
      }));

      // 失敗したURLも記録
      const failedUrls = (response.failedResults || []).map((r: any) => ({
        url: r.url || '',
        content: '',
        success: false,
      }));

      console.log(`[Tavily] Extracted ${results.length} pages, ${failedUrls.length} failed`);

      return {
        results: [...results, ...failedUrls],
      };
    } catch (error: any) {
      console.error('[Tavily] Extract error:', error.message);
      throw new Error(`Webページ抽出に失敗しました: ${error.message}`);
    }
  },
});
