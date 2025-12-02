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

// Common role suffixes to strip when matching names
const ROLE_SUFFIXES = ['CTO', 'CEO', 'CFO', 'COO', 'CMO', 'PM', 'CS', 'PdM', 'EM', 'TL', 'リーダー', 'さん', '氏'];

function stripRoleSuffix(name) {
  let result = name.trim();
  for (const suffix of ROLE_SUFFIXES) {
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length).trim();
      break;
    }
  }
  return result;
}

function findSlackId(mapping, name) {
  // Try exact match first
  let slackId = mapping.get(name);
  if (slackId) return slackId;

  // Strip role suffix and try again
  const nameWithoutRole = stripRoleSuffix(name);
  slackId = mapping.get(nameWithoutRole);
  if (slackId) return slackId;

  // Try family name only (first part before space)
  const familyName = name.split(' ')[0];
  slackId = mapping.get(familyName);
  if (slackId) return slackId;

  // Try family name from stripped version
  const familyNameStripped = nameWithoutRole.split(' ')[0];
  if (familyNameStripped !== familyName) {
    slackId = mapping.get(familyNameStripped);
  }

  return slackId;
}

async function resolveNamesToMentions(text) {
  if (!text) return text;

  const mapping = await getMembersMapping();
  if (mapping.size === 0) return text;

  // Only convert mentions in the action items section
  const actionSectionMarker = '📅 次の手配・アクション';
  const markerIndex = text.indexOf(actionSectionMarker);

  if (markerIndex === -1) {
    // No action section found, return as-is
    return text;
  }

  // Split into before and after action section
  const beforeAction = text.substring(0, markerIndex);
  let actionSection = text.substring(markerIndex);

  // Pattern 1: （*name*、deadline） - expected format from prompt
  actionSection = actionSection.replace(/（\*([^*]+)\*、([^）]+)）/g, (match, name, deadline) => {
    const slackId = findSlackId(mapping, name);
    if (slackId) {
      return `（<@${slackId}>、${deadline}）`;
    }
    return match;
  });

  // Pattern 2: （name、deadline） - fallback without asterisks
  actionSection = actionSection.replace(/（([^（）、*]+)、([^）]+)）/g, (match, name, deadline) => {
    const slackId = findSlackId(mapping, name);
    if (slackId) {
      return `（<@${slackId}>、${deadline}）`;
    }
    return match;
  });

  // Pattern 3: (name、deadline) - half-width parentheses
  actionSection = actionSection.replace(/\(([^()、*]+)、([^)]+)\)/g, (match, name, deadline) => {
    const slackId = findSlackId(mapping, name);
    if (slackId) {
      return `(<@${slackId}>、${deadline})`;
    }
    return match;
  });

  return beforeAction + actionSection;
}

function clearCache() {
  cachedMembers = null;
  cacheTimestamp = null;
}

module.exports = { getMembersMapping, resolveNamesToMentions, clearCache };
