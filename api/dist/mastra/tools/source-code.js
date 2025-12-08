// mastra/tools/source-code.ts
// ソースコード読み取りツール - S3からプロジェクトのソースコードを取得

import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';

const AWS = require('aws-sdk');
const path = require('path');

const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'us-east-1' });
const SOURCE_BUCKET = process.env.SOURCE_BUCKET || 'brainbase-source-593793022993';

// Helper: Get project's source repo config from context or DynamoDB
async function getSourceRepoConfig(projectId) {
  const ProjectRepository = require('../../project-repository');
  const projectRepo = new ProjectRepository();
  const project = await projectRepo.getProjectById(projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  if (!project.source_owner || !project.source_repo) {
    throw new Error(`Source repo not configured for project: ${projectId}`);
  }

  return {
    owner: project.source_owner,
    repo: project.source_repo,
    branch: project.source_branch || 'main',
  };
}

// Helper: Build S3 key prefix
function buildS3Prefix(owner, repo, branch) {
  return `${owner}/${repo}/${branch}/`;
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
  execute: async (input, context) => {
    const { path: dirPath, pattern, maxFiles } = input;

    try {
      // Get project from context (set by agent)
      const projectId = context?.projectId;
      if (!projectId) {
        return {
          success: false,
          error: 'Project context not available. Ensure projectId is set in context.',
        };
      }

      const sourceConfig = await getSourceRepoConfig(projectId);
      const prefix = buildS3Prefix(sourceConfig.owner, sourceConfig.repo, sourceConfig.branch);
      const searchPrefix = dirPath ? `${prefix}${dirPath}` : prefix;

      // List objects from S3
      const params = {
        Bucket: SOURCE_BUCKET,
        Prefix: searchPrefix,
        MaxKeys: maxFiles || 100,
      };

      const response = await s3.listObjectsV2(params).promise();
      let files = (response.Contents || []).map((obj) => ({
        path: obj.Key.replace(prefix, ''),
        size: obj.Size,
        lastModified: obj.LastModified,
      }));

      // Filter by pattern if specified
      if (pattern) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
        files = files.filter((f) => regex.test(path.basename(f.path)));
      }

      // Filter out directories and index files
      files = files.filter((f) => !f.path.endsWith('/') && f.path !== '_index.json');

      return {
        success: true,
        project: `${sourceConfig.owner}/${sourceConfig.repo}`,
        branch: sourceConfig.branch,
        directory: dirPath || '/',
        files: files,
        count: files.length,
        truncated: response.IsTruncated || false,
      };
    } catch (error) {
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
  execute: async (input, context) => {
    const { filePath, maxLines, startLine } = input;

    try {
      // Get project from context
      const projectId = context?.projectId;
      if (!projectId) {
        return {
          success: false,
          error: 'Project context not available. Ensure projectId is set in context.',
        };
      }

      const sourceConfig = await getSourceRepoConfig(projectId);
      const s3Key = `${buildS3Prefix(sourceConfig.owner, sourceConfig.repo, sourceConfig.branch)}${filePath}`;

      // Get file from S3
      const params = {
        Bucket: SOURCE_BUCKET,
        Key: s3Key,
      };

      const response = await s3.getObject(params).promise();
      let content = response.Body.toString('utf-8');

      // Handle line range if specified
      if (startLine || maxLines) {
        const lines = content.split('\n');
        const start = (startLine || 1) - 1;
        const end = maxLines ? start + maxLines : lines.length;
        content = lines.slice(start, end).join('\n');
      }

      // Truncate if too large (> 50KB)
      const MAX_SIZE = 50 * 1024;
      let truncated = false;
      if (content.length > MAX_SIZE) {
        content = content.substring(0, MAX_SIZE);
        truncated = true;
      }

      return {
        success: true,
        project: `${sourceConfig.owner}/${sourceConfig.repo}`,
        branch: sourceConfig.branch,
        filePath: filePath,
        content: content,
        size: response.ContentLength,
        truncated: truncated,
        lineRange: startLine || maxLines ? { start: startLine || 1, maxLines } : null,
      };
    } catch (error) {
      if (error.code === 'NoSuchKey') {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

/**
 * Search for text in source files
 */
export const searchSourceCodeTool = createTool({
  id: 'search_source_code',
  description: 'ソースコード内をキーワード検索する。ファイル名と行番号を返す。',
  inputSchema: z.object({
    query: z.string().describe('検索キーワードまたは正規表現'),
    path: z.string().optional().describe('検索対象ディレクトリ（例: "src/"）'),
    filePattern: z.string().optional().describe('ファイルパターン（例: "*.ts"）'),
    maxResults: z.number().optional().default(20).describe('最大結果数'),
    caseSensitive: z.boolean().optional().default(false).describe('大文字小文字を区別'),
  }),
  execute: async (input, context) => {
    const { query, path: dirPath, filePattern, maxResults, caseSensitive } = input;

    try {
      const projectId = context?.projectId;
      if (!projectId) {
        return {
          success: false,
          error: 'Project context not available.',
        };
      }

      const sourceConfig = await getSourceRepoConfig(projectId);
      const prefix = buildS3Prefix(sourceConfig.owner, sourceConfig.repo, sourceConfig.branch);
      const searchPrefix = dirPath ? `${prefix}${dirPath}` : prefix;

      // First, list files
      const listParams = {
        Bucket: SOURCE_BUCKET,
        Prefix: searchPrefix,
        MaxKeys: 500,
      };

      const listResponse = await s3.listObjectsV2(listParams).promise();
      let files = (listResponse.Contents || [])
        .filter((obj) => !obj.Key.endsWith('/') && !obj.Key.endsWith('_index.json'))
        .map((obj) => obj.Key);

      // Filter by file pattern
      if (filePattern) {
        const regex = new RegExp(filePattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
        files = files.filter((f) => regex.test(path.basename(f)));
      }

      // Search in files
      const results = [];
      const searchRegex = caseSensitive ? new RegExp(query, 'g') : new RegExp(query, 'gi');

      for (const fileKey of files) {
        if (results.length >= (maxResults || 20)) break;

        try {
          const fileResponse = await s3.getObject({ Bucket: SOURCE_BUCKET, Key: fileKey }).promise();
          const content = fileResponse.Body.toString('utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= (maxResults || 20)) break;

            if (searchRegex.test(lines[i])) {
              results.push({
                file: fileKey.replace(prefix, ''),
                line: i + 1,
                content: lines[i].trim().substring(0, 200),
              });
              searchRegex.lastIndex = 0; // Reset regex state
            }
          }
        } catch (e) {
          // Skip files that can't be read
          continue;
        }
      }

      return {
        success: true,
        project: `${sourceConfig.owner}/${sourceConfig.repo}`,
        query: query,
        results: results,
        count: results.length,
        searchedFiles: files.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
