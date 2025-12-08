/**
 * チャンネル→プロジェクト マッピング解決
 *
 * S3のchannels.jsonを参照してチャンネルIDからプロジェクトIDを取得
 * 正本: _codex/common/meta/slack/channels.yml
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const BEDROCK_REGION = 'us-east-1';
const BRAINBASE_CONTEXT_BUCKET = 'brainbase-context-593793022993';

let cachedMapping = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分

// テスト用のS3クライアント注入
let s3ClientOverride = null;

/**
 * S3クライアントを設定（テスト用）
 */
function setS3Client(client) {
  s3ClientOverride = client;
}

/**
 * S3クライアントを取得
 */
function getS3Client() {
  return s3ClientOverride || new S3Client({ region: BEDROCK_REGION });
}

/**
 * S3からチャンネルマッピングを取得
 * @returns {Promise<Map>} channel_id → {channel_name, project_id, workspace, type}
 */
async function getChannelMapping() {
  // キャッシュが有効ならそれを返す
  if (cachedMapping && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL_MS)) {
    return cachedMapping;
  }

  const s3Client = getS3Client();

  try {
    const command = new GetObjectCommand({
      Bucket: BRAINBASE_CONTEXT_BUCKET,
      Key: 'channels.json'
    });

    const response = await s3Client.send(command);
    const jsonStr = await response.Body.transformToString();
    const data = JSON.parse(jsonStr);

    const mapping = new Map();
    for (const channel of data.channels) {
      mapping.set(channel.channel_id, {
        channel_name: channel.channel_name,
        project_id: channel.project_id,
        workspace: channel.workspace,
        type: channel.type
      });
    }

    cachedMapping = mapping;
    cacheTimestamp = Date.now();

    console.log(`Loaded ${mapping.size} channel mappings from S3`);
    return mapping;
  } catch (error) {
    console.warn('Failed to load channel mapping:', error.message);
    return new Map();
  }
}

/**
 * チャンネルIDからプロジェクトIDを取得
 * @param {string} channelId - SlackチャンネルID
 * @returns {Promise<string>} プロジェクトID（見つからない場合は'general'）
 */
async function getProjectIdByChannel(channelId) {
  const mapping = await getChannelMapping();
  const channelInfo = mapping.get(channelId);
  return channelInfo?.project_id || 'general';
}

/**
 * キャッシュをクリア（テスト用）
 */
function clearCache() {
  cachedMapping = null;
  cacheTimestamp = null;
}

module.exports = {
  getChannelMapping,
  getProjectIdByChannel,
  clearCache,
  setS3Client  // テスト用
};
