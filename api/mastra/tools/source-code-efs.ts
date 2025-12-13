// mastra/tools/source-code-efs.ts
// ソースコード読み取りツール - EFS + ripgrep 版（Search Lambda経由）

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const SEARCH_LAMBDA_NAME = process.env.SEARCH_LAMBDA_NAME || 'mana-search';

// グローバル変数でプロジェクトIDを保持（askManaから設定される）
let currentProjectId: string | null = null;

export function setCurrentProjectId(projectId: string) {
  currentProjectId = projectId;
  console.log(`[source-code] Project ID set to: ${projectId}`);
}

// Helper: Get project's source repo config from DynamoDB
async function getSourceRepoConfig(projectId: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ProjectRepository = require(process.cwd() + '/project-repository.js');
  const projectRepo = new ProjectRepository();
  console.log(`Fetching project from DynamoDB: ${projectId}`);
  const project = await projectRepo.getProjectById(projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  if (!project.source_owner || !project.source_repo) {
    throw new Error(`Source repo not configured for project: ${projectId}`);
  }

  // glob_include からディレクトリプレフィックスを抽出
  // 例: ["app/**/*", "docs/**/*"] → ["app/", "docs/"]
  const globInclude: string[] = project.source_glob_include || [];
  const includePaths = globInclude
    .map((pattern: string) => {
      // "app/**/*" → "app/"
      const match = pattern.match(/^([^*]+)/);
      return match ? match[1].replace(/\/$/, '') + '/' : null;
    })
    .filter((p: string | null): p is string => p !== null && p !== '/');

  console.log(`[source-code] glob_include: ${JSON.stringify(globInclude)}, includePaths: ${JSON.stringify(includePaths)}`);

  return {
    owner: project.source_owner,
    repo: project.source_repo,
    branch: project.source_branch || 'main',
    globInclude,
    includePaths,
  };
}

// Helper: Invoke search lambda
async function invokeSearchLambda(payload: Record<string, unknown>): Promise<any> {
  const command = new InvokeCommand({
    FunctionName: SEARCH_LAMBDA_NAME,
    Payload: JSON.stringify(payload),
  });

  const response = await lambda.send(command);

  if (response.FunctionError) {
    const errorPayload = JSON.parse(new TextDecoder().decode(response.Payload));
    throw new Error(`Search Lambda error: ${errorPayload.errorMessage || 'Unknown error'}`);
  }

  const result = JSON.parse(new TextDecoder().decode(response.Payload));
  return result;
}

/**
 * List source files in a project
 */
export const listSourceFilesTool = createTool({
  id: 'list_source_files',
  description: 'プロジェクトのソースファイル一覧を取得する。パスを指定して特定ディレクトリのみ取得可能。',
  inputSchema: z.object({
    path: z.string().optional().describe('ディレクトリパス（例: "src/", "api/handlers/"）'),
    pattern: z.string().optional().describe('ファイル名パターン（例: "*.ts", "*.js"）'),
    maxFiles: z.number().optional().default(100).describe('最大取得件数'),
  }),
  execute: async (input) => {
    const { path: dirPath, pattern, maxFiles } = input;

    try {
      const projectId = currentProjectId;
      if (!projectId) {
        return {
          success: false,
          error: 'プロジェクトIDが設定されていません。チャンネルからプロジェクトを特定できませんでした。',
        };
      }

      console.log(`[source-code] list_source_files called for project: ${projectId}`);

      const sourceConfig = await getSourceRepoConfig(projectId);

      const result = await invokeSearchLambda({
        action: 'list',
        owner: sourceConfig.owner,
        repo: sourceConfig.repo,
        branch: sourceConfig.branch,
        path: dirPath,
        pattern,
        maxFiles: maxFiles || 100,
        // includePaths を Lambda に渡す（複数ディレクトリ対応）
        includePaths: dirPath ? undefined : sourceConfig.includePaths,
      });

      if (!result.success) {
        return result;
      }

      return {
        success: true,
        project: `${sourceConfig.owner}/${sourceConfig.repo}`,
        branch: sourceConfig.branch,
        directory: dirPath || '/',
        files: result.files,
        count: result.count,
        truncated: result.truncated || false,
      };
    } catch (error) {
      console.error('[source-code] list_source_files error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

/**
 * Read a source file's content
 */
export const readSourceFileTool = createTool({
  id: 'read_source_file',
  description: 'ソースファイルの内容を読み取る',
  inputSchema: z.object({
    filePath: z.string().describe('ファイルパス（例: "src/index.ts", "api/handlers/slack.js"）'),
    maxLines: z.number().optional().describe('最大行数（省略時は全行）'),
    startLine: z.number().optional().describe('開始行（1から）'),
  }),
  execute: async (input) => {
    const { filePath, maxLines, startLine } = input;

    try {
      const projectId = currentProjectId;
      if (!projectId) {
        return {
          success: false,
          error: 'プロジェクトIDが設定されていません。',
        };
      }

      console.log(`[source-code] read_source_file called for: ${filePath}`);

      const sourceConfig = await getSourceRepoConfig(projectId);

      const result = await invokeSearchLambda({
        action: 'read',
        owner: sourceConfig.owner,
        repo: sourceConfig.repo,
        branch: sourceConfig.branch,
        filePath,
        maxLines,
        startLine,
      });

      if (!result.success) {
        return result;
      }

      return {
        success: true,
        project: `${sourceConfig.owner}/${sourceConfig.repo}`,
        branch: sourceConfig.branch,
        filePath: filePath,
        content: result.content,
        size: result.size,
        truncated: result.truncated,
        lineRange: result.lineRange,
      };
    } catch (error: any) {
      console.error('[source-code] read_source_file error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

/**
 * Search for text in source files using ripgrep
 */
export const searchSourceCodeTool = createTool({
  id: 'search_source_code',
  description: 'ソースコード内をキーワード検索する（ripgrepで高速検索）。ファイル名と行番号を返す。',
  inputSchema: z.object({
    query: z.string().describe('検索キーワードまたは正規表現'),
    path: z.string().optional().describe('検索対象ディレクトリ（例: "src/"）'),
    filePattern: z.string().optional().describe('ファイルパターン（例: "*.ts"）'),
    maxResults: z.number().optional().default(20).describe('最大結果数'),
    caseSensitive: z.boolean().optional().default(false).describe('大文字小文字を区別'),
  }),
  execute: async (input) => {
    const { query, path: dirPath, filePattern, maxResults, caseSensitive } = input;

    try {
      const projectId = currentProjectId;
      if (!projectId) {
        return {
          success: false,
          error: 'プロジェクトIDが設定されていません。',
        };
      }

      console.log(`[source-code] search_source_code called for: ${query}`);

      const sourceConfig = await getSourceRepoConfig(projectId);

      // includePaths が設定されている場合、パスを制限
      // ユーザー指定のpathがあればそれを優先、なければincludePathsを使用
      const searchPath = dirPath || (sourceConfig.includePaths.length > 0 ? undefined : undefined);

      const result = await invokeSearchLambda({
        action: 'search',
        owner: sourceConfig.owner,
        repo: sourceConfig.repo,
        branch: sourceConfig.branch,
        query,
        path: searchPath,
        filePattern,
        maxResults: maxResults || 20,
        caseSensitive: caseSensitive || false,
        // includePaths を Lambda に渡す（複数ディレクトリ対応）
        includePaths: dirPath ? undefined : sourceConfig.includePaths,
      });

      if (!result.success) {
        return result;
      }

      return {
        success: true,
        project: `${sourceConfig.owner}/${sourceConfig.repo}`,
        query: query,
        results: result.results,
        count: result.count,
      };
    } catch (error) {
      console.error('[source-code] search_source_code error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
