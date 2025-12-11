// search-lambda/sync.mjs
// S3からEFSへソースコードを同期するLambda
// node_modules, .next, dist などの不要ディレクトリを自動除外

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const SOURCE_BUCKET = process.env.SOURCE_BUCKET || 'brainbase-source-593793022993';
const EFS_MOUNT_PATH = '/mnt/source';

// 除外パターン（これらのディレクトリ/ファイルはスキップ）
const EXCLUDE_PATTERNS = [
  /node_modules\//,
  /\.next\//,
  /dist\//,
  /\.git\//,
  /\.DS_Store$/,
  /__pycache__\//,
  /\.pyc$/,
  /\.pyo$/,
  /\.cache\//,
  /coverage\//,
  /\.turbo\//,
  /\.vercel\//,
];

/**
 * パスが除外パターンにマッチするかチェック
 */
function shouldExclude(path) {
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(path));
}

/**
 * S3からEFSにソースコードを同期
 *
 * Event:
 *   - owner: string (例: "Unson-LLC")
 *   - repo: string (例: "salestailor-project")
 *   - branch: string (デフォルト: "main")
 *   - clean: boolean (trueなら既存を削除して再同期)
 */
export const handler = async (event) => {
  console.log('[sync] Event:', JSON.stringify(event));

  const { owner, repo, branch = 'main', clean = false } = event;

  if (!owner || !repo) {
    return { success: false, error: 'owner and repo are required' };
  }

  const s3Prefix = `${owner}/${repo}/${branch}/`;
  const targetDir = join(EFS_MOUNT_PATH, owner, repo, branch);

  try {
    // Clean if requested
    if (clean && existsSync(targetDir)) {
      console.log(`[sync] Cleaning existing directory: ${targetDir}`);
      rmSync(targetDir, { recursive: true, force: true });
    }

    // Create target directory
    mkdirSync(targetDir, { recursive: true });

    // List and sync files from S3
    let continuationToken;
    let totalFiles = 0;
    let totalSize = 0;
    let skippedFiles = 0;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: SOURCE_BUCKET,
        Prefix: s3Prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      });

      const listResponse = await s3.send(listCommand);
      const objects = listResponse.Contents || [];

      for (const obj of objects) {
        // Skip directories
        if (obj.Key.endsWith('/')) continue;

        const relativePath = obj.Key.replace(s3Prefix, '');

        // 除外パターンチェック
        if (shouldExclude(relativePath)) {
          skippedFiles++;
          if (skippedFiles <= 10) {
            console.log(`[sync] Skipping: ${relativePath}`);
          } else if (skippedFiles === 11) {
            console.log('[sync] ... (more files skipped)');
          }
          continue;
        }

        const targetPath = join(targetDir, relativePath);

        // Create directory structure
        const dir = dirname(targetPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        // Download and save file
        try {
          const getCommand = new GetObjectCommand({
            Bucket: SOURCE_BUCKET,
            Key: obj.Key,
          });
          const getResponse = await s3.send(getCommand);
          const content = await getResponse.Body?.transformToByteArray();

          if (content) {
            writeFileSync(targetPath, content);
            totalFiles++;
            totalSize += content.length;
          }
        } catch (err) {
          console.warn(`[sync] Failed to sync ${obj.Key}: ${err.message}`);
        }

        // Log progress every 100 files
        if (totalFiles % 100 === 0 && totalFiles > 0) {
          console.log(`[sync] Progress: ${totalFiles} files synced...`);
        }
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    console.log(`[sync] Completed: ${totalFiles} files, ${(totalSize / 1024 / 1024).toFixed(2)} MB, ${skippedFiles} files skipped`);

    return {
      success: true,
      owner,
      repo,
      branch,
      filesSync: totalFiles,
      filesSkipped: skippedFiles,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      targetDir,
    };
  } catch (error) {
    console.error('[sync] Error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};
