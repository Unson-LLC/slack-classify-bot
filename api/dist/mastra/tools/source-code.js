// mastra/tools/source-code.ts
// ソースコード読み取りツール - S3からプロジェクトのソースコードを取得
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const SOURCE_BUCKET = process.env.SOURCE_BUCKET || 'brainbase-source-593793022993';
// グローバル変数でプロジェクトIDを保持（askManaから設定される）
let currentProjectId = null;
export function setCurrentProjectId(projectId) {
    currentProjectId = projectId;
    console.log(`[source-code] Project ID set to: ${projectId}`);
}
// Helper: Get project's source repo config from DynamoDB
async function getSourceRepoConfig(projectId) {
    // Use require for CommonJS module
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ProjectRepository = require(process.cwd() + '/project-repository.js');
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
    execute: async (input) => {
        const { path: dirPath, pattern, maxFiles } = input;
        try {
            // Get project from global state
            const projectId = currentProjectId;
            if (!projectId) {
                return {
                    success: false,
                    error: 'プロジェクトIDが設定されていません。チャンネルからプロジェクトを特定できませんでした。',
                };
            }
            console.log(`[source-code] list_source_files called for project: ${projectId}`);
            const sourceConfig = await getSourceRepoConfig(projectId);
            const prefix = buildS3Prefix(sourceConfig.owner, sourceConfig.repo, sourceConfig.branch);
            const searchPrefix = dirPath ? `${prefix}${dirPath}` : prefix;
            // List objects from S3
            const command = new ListObjectsV2Command({
                Bucket: SOURCE_BUCKET,
                Prefix: searchPrefix,
                MaxKeys: maxFiles || 100,
            });
            const response = await s3.send(command);
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
        }
        catch (error) {
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
            // Get project from global state
            const projectId = currentProjectId;
            if (!projectId) {
                return {
                    success: false,
                    error: 'プロジェクトIDが設定されていません。',
                };
            }
            console.log(`[source-code] read_source_file called for: ${filePath}`);
            const sourceConfig = await getSourceRepoConfig(projectId);
            const s3Key = `${buildS3Prefix(sourceConfig.owner, sourceConfig.repo, sourceConfig.branch)}${filePath}`;
            // Get file from S3
            const command = new GetObjectCommand({
                Bucket: SOURCE_BUCKET,
                Key: s3Key,
            });
            const response = await s3.send(command);
            let content = await response.Body?.transformToString('utf-8') || '';
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
        }
        catch (error) {
            console.error('[source-code] read_source_file error:', error);
            if (error.name === 'NoSuchKey') {
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
            const prefix = buildS3Prefix(sourceConfig.owner, sourceConfig.repo, sourceConfig.branch);
            const searchPrefix = dirPath ? `${prefix}${dirPath}` : prefix;
            // First, list files
            const listCommand = new ListObjectsV2Command({
                Bucket: SOURCE_BUCKET,
                Prefix: searchPrefix,
                MaxKeys: 500,
            });
            const listResponse = await s3.send(listCommand);
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
                if (results.length >= (maxResults || 20))
                    break;
                try {
                    const getCommand = new GetObjectCommand({ Bucket: SOURCE_BUCKET, Key: fileKey });
                    const fileResponse = await s3.send(getCommand);
                    const content = await fileResponse.Body?.transformToString('utf-8') || '';
                    const lines = content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (results.length >= (maxResults || 20))
                            break;
                        if (searchRegex.test(lines[i])) {
                            results.push({
                                file: fileKey.replace(prefix, ''),
                                line: i + 1,
                                content: lines[i].trim().substring(0, 200),
                            });
                            searchRegex.lastIndex = 0; // Reset regex state
                        }
                    }
                }
                catch (e) {
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
        }
        catch (error) {
            console.error('[source-code] search_source_code error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    },
});
//# sourceMappingURL=source-code.js.map