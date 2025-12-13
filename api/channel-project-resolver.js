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
      // project_id_short: proj_zeims -> zeims (Airtable側のIDと合わせる)
      const projectIdShort = channel.project_id?.replace(/^proj_/, '') || null;
      mapping.set(channel.channel_id, {
        channel_name: channel.channel_name,
        project_id: channel.project_id,
        project_id_short: projectIdShort,
        workspace: channel.workspace,
        type: channel.type
      });
    }

    cachedMapping = mapping;
    cacheTimestamp = Date.now();

    console.log(`Loaded ${mapping.size} channel mappings from S3`);
    return mapping;
  } catch (error) {
    console.warn('Failed to load channel mapping from S3:', error.message);
    console.log('Using fallback embedded channel mapping');

    // Fallback: embedded channel data from channels.yml
    const fallbackChannels = [
      // Zeims
      { channel_id: 'C07LP2EPVQA', channel_name: '0010-zeims-biz', project_id: 'proj_zeims', workspace: 'unson', type: 'business' },
      { channel_id: 'C07QX6DN9M0', channel_name: '0011-zeims-dev', project_id: 'proj_zeims', workspace: 'unson', type: 'development' },
      { channel_id: 'C09V8RW3THS', channel_name: '0012-zeims-board', project_id: 'proj_zeims', workspace: 'unson', type: 'board' },
      // SalesTailor
      { channel_id: 'C08U2EX2NEA', channel_name: 'cxo', project_id: 'proj_salestailor', workspace: 'salestailor', type: 'executive' },
      { channel_id: 'C08SX913NER', channel_name: 'eng', project_id: 'proj_salestailor', workspace: 'salestailor', type: 'development' },
      { channel_id: 'C0A1620L4TS', channel_name: 'eng-deploy', project_id: 'proj_salestailor', workspace: 'salestailor', type: 'deployment' },
      // BAAO
      { channel_id: 'C08K58SUQ7N', channel_name: '0110-baao', project_id: 'proj_baao', workspace: 'unson', type: 'general' },
      { channel_id: 'C09L3EKAUEA', channel_name: '0111-baao-ai-dojo', project_id: 'proj_baao', workspace: 'unson', type: 'development' },
      // DialogAI
      { channel_id: 'C08E010PYKE', channel_name: '0030-dialogai-biz', project_id: 'proj_dialogai', workspace: 'unson', type: 'business' },
      { channel_id: 'C08A6ETSSR2', channel_name: '0031-dialogai-dev', project_id: 'proj_dialogai', workspace: 'unson', type: 'development' },
      // Brainbase
      { channel_id: 'C088CKDEJGN', channel_name: 'proj_brainbase', project_id: 'proj_brainbase', workspace: 'unson', type: 'project' },
    ];

    const mapping = new Map();
    for (const channel of fallbackChannels) {
      const projectIdShort = channel.project_id?.replace(/^proj_/, '') || null;
      mapping.set(channel.channel_id, {
        channel_name: channel.channel_name,
        project_id: channel.project_id,
        project_id_short: projectIdShort,
        workspace: channel.workspace,
        type: channel.type
      });
    }

    cachedMapping = mapping;
    cacheTimestamp = Date.now();

    console.log(`Loaded ${mapping.size} fallback channel mappings`);
    return mapping;
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
