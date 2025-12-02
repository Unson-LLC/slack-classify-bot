const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const BEDROCK_REGION = "us-east-1";
const BRAINBASE_CONTEXT_BUCKET = "brainbase-context-593793022993";

let cachedMembers = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getMembersMapping() {
  if (cachedMembers && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL_MS)) {
    return cachedMembers;
  }

  const s3Client = new S3Client({ region: BEDROCK_REGION });

  try {
    const command = new GetObjectCommand({
      Bucket: BRAINBASE_CONTEXT_BUCKET,
      Key: 'members.json'
    });

    const response = await s3Client.send(command);
    const jsonStr = await response.Body.transformToString();
    const data = JSON.parse(jsonStr);

    const mapping = new Map();
    for (const member of data.members) {
      mapping.set(member.brainbase_name, member.slack_id);
      const familyName = member.brainbase_name.split(' ')[0];
      if (!mapping.has(familyName)) {
        mapping.set(familyName, member.slack_id);
      }
    }

    cachedMembers = mapping;
    cacheTimestamp = Date.now();

    console.log(`Loaded ${mapping.size} member mappings from S3`);
    return mapping;
  } catch (error) {
    console.warn('Failed to load members mapping:', error.message);
    return new Map();
  }
}

async function resolveNamesToMentions(text) {
  if (!text) return text;

  const mapping = await getMembersMapping();
  if (mapping.size === 0) return text;

  let result = text;

  const patterns = [
    /（\*([^*]+)\*、/g,
    /\(\*([^*]+)\*、/g,
    /（\*([^*]+)\*[,、]/g,
    /担当[:：]\s*\*([^*]+)\*/g,
    /担当者[:：]\s*\*([^*]+)\*/g,
  ];

  for (const pattern of patterns) {
    result = result.replace(pattern, (match, name) => {
      const trimmedName = name.trim();
      let slackId = mapping.get(trimmedName);

      if (!slackId) {
        const familyName = trimmedName.split(' ')[0];
        slackId = mapping.get(familyName);
      }

      if (slackId) {
        return match.replace(`*${name}*`, `<@${slackId}>`);
      }
      return match;
    });
  }

  return result;
}

function clearCache() {
  cachedMembers = null;
  cacheTimestamp = null;
}

module.exports = { getMembersMapping, resolveNamesToMentions, clearCache };
