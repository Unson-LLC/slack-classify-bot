// search-lambda/index.mjs
// EFS + ripgrep を使った高速ソースコード検索Lambda

import { execSync, spawn } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, relative } from 'path';

const EFS_MOUNT_PATH = '/mnt/source';

/**
 * ディレクトリ構造: /mnt/source/{owner}/{repo}/{branch}/
 */

export const handler = async (event) => {
  console.log('[search-lambda] Event:', JSON.stringify(event));

  const { action, owner, repo, branch = 'main', ...params } = event;

  if (!owner || !repo) {
    return { success: false, error: 'owner and repo are required' };
  }

  const basePath = join(EFS_MOUNT_PATH, owner, repo, branch);

  if (!existsSync(basePath)) {
    return {
      success: false,
      error: `Source not found: ${owner}/${repo}/${branch}`,
      availablePaths: listAvailableProjects()
    };
  }

  try {
    switch (action) {
      case 'list':
        return listFiles(basePath, params);
      case 'read':
        return readFile(basePath, params);
      case 'search':
        return searchCode(basePath, params);
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    console.error('[search-lambda] Error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 利用可能なプロジェクト一覧
 */
function listAvailableProjects() {
  try {
    const projects = [];
    const owners = readdirSync(EFS_MOUNT_PATH);
    for (const owner of owners) {
      const ownerPath = join(EFS_MOUNT_PATH, owner);
      if (statSync(ownerPath).isDirectory()) {
        const repos = readdirSync(ownerPath);
        for (const repo of repos) {
          const repoPath = join(ownerPath, repo);
          if (statSync(repoPath).isDirectory()) {
            const branches = readdirSync(repoPath);
            for (const branch of branches) {
              projects.push(`${owner}/${repo}/${branch}`);
            }
          }
        }
      }
    }
    return projects;
  } catch (e) {
    return [];
  }
}

/**
 * ファイル一覧取得
 */
function listFiles(basePath, params) {
  const { path: dirPath = '', pattern, maxFiles = 100 } = params;
  const targetPath = join(basePath, dirPath);

  if (!existsSync(targetPath)) {
    return { success: false, error: `Directory not found: ${dirPath}` };
  }

  const files = [];
  const walk = (dir, depth = 0) => {
    if (files.length >= maxFiles || depth > 10) return;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      const fullPath = join(dir, entry.name);
      const relativePath = relative(basePath, fullPath);

      // Skip hidden files and common excludes
      if (entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === '__pycache__') continue;

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else {
        // Pattern matching
        if (pattern) {
          const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
          if (!regex.test(entry.name)) continue;
        }

        const stat = statSync(fullPath);
        files.push({
          path: relativePath,
          size: stat.size,
          lastModified: stat.mtime.toISOString()
        });
      }
    }
  };

  walk(targetPath);

  return {
    success: true,
    directory: dirPath || '/',
    files,
    count: files.length,
    truncated: files.length >= maxFiles
  };
}

/**
 * ファイル読み取り
 */
function readFile(basePath, params) {
  const { filePath, maxLines, startLine } = params;

  if (!filePath) {
    return { success: false, error: 'filePath is required' };
  }

  const fullPath = join(basePath, filePath);

  if (!existsSync(fullPath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  let content = readFileSync(fullPath, 'utf-8');
  const stat = statSync(fullPath);

  // Handle line range
  if (startLine || maxLines) {
    const lines = content.split('\n');
    const start = (startLine || 1) - 1;
    const end = maxLines ? start + maxLines : lines.length;
    content = lines.slice(start, end).join('\n');
  }

  // Truncate if too large (50KB)
  const MAX_SIZE = 50 * 1024;
  let truncated = false;
  if (content.length > MAX_SIZE) {
    content = content.substring(0, MAX_SIZE);
    truncated = true;
  }

  return {
    success: true,
    filePath,
    content,
    size: stat.size,
    truncated,
    lineRange: startLine || maxLines ? { start: startLine || 1, maxLines } : null
  };
}

/**
 * ripgrep を使った高速検索
 */
function searchCode(basePath, params) {
  const { query, path: dirPath, filePattern, maxResults = 20, caseSensitive = false } = params;

  if (!query) {
    return { success: false, error: 'query is required' };
  }

  const searchPath = dirPath ? join(basePath, dirPath) : basePath;

  // Build ripgrep command
  const args = [
    '--json',                    // JSON output for parsing
    '--max-count', '5',          // Max matches per file
    '-m', String(maxResults * 2), // Total max matches
    '--no-heading',
    '--line-number',
  ];

  if (!caseSensitive) {
    args.push('-i');
  }

  // File pattern filter
  if (filePattern) {
    args.push('-g', filePattern);
  }

  // Exclude common directories
  args.push('--glob', '!node_modules/**');
  args.push('--glob', '!.git/**');
  args.push('--glob', '!dist/**');
  args.push('--glob', '!.next/**');
  args.push('--glob', '!*.min.js');
  args.push('--glob', '!*.map');

  args.push(query, searchPath);

  console.log('[search-lambda] Running rg with args:', args.join(' '));

  try {
    // Use ripgrep binary
    const rgPath = '/opt/bin/rg';  // Lambda Layer path
    const result = execSync(`${rgPath} ${args.join(' ')}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,  // 30 second timeout
    });

    // Parse JSON lines output
    const results = [];
    const lines = result.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      if (results.length >= maxResults) break;

      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'match') {
          const data = parsed.data;
          results.push({
            file: relative(basePath, data.path.text),
            line: data.line_number,
            content: data.lines.text.trim().substring(0, 200)
          });
        }
      } catch (e) {
        // Skip invalid JSON lines
      }
    }

    return {
      success: true,
      query,
      results,
      count: results.length
    };

  } catch (error) {
    // ripgrep returns exit code 1 when no matches found
    if (error.status === 1) {
      return {
        success: true,
        query,
        results: [],
        count: 0
      };
    }

    console.error('[search-lambda] ripgrep error:', error.message);
    return {
      success: false,
      error: `Search failed: ${error.message}`
    };
  }
}
