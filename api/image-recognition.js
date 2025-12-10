const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const axios = require('axios');

const BEDROCK_REGION = "us-east-1";
const DEFAULT_MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

const resolveModelId = () => process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;

// Supported image formats for Claude Vision
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

/**
 * Check if a Slack file is an image
 * @param {Object} file - Slack file object
 * @returns {boolean}
 */
function isImageFile(file) {
  if (!file) return false;

  // Check by mimetype first
  if (file.mimetype && SUPPORTED_IMAGE_TYPES.includes(file.mimetype)) {
    return true;
  }

  // Fallback to extension check
  if (file.name) {
    const lowerName = file.name.toLowerCase();
    return IMAGE_EXTENSIONS.some(ext => lowerName.endsWith(ext));
  }

  return false;
}

/**
 * Download image from Slack and encode to base64
 * @param {Object} file - Slack file object with url_private_download
 * @param {string} token - Slack bot token
 * @returns {Promise<{base64: string, mediaType: string}>}
 */
async function downloadAndEncodeImage(file, token) {
  if (!file || !file.url_private_download) {
    throw new Error('Invalid file object');
  }

  // Validate image format
  const mediaType = file.mimetype || 'image/png';
  if (!SUPPORTED_IMAGE_TYPES.includes(mediaType)) {
    throw new Error(`Unsupported image format: ${mediaType}`);
  }

  const response = await axios.get(file.url_private_download, {
    headers: {
      'Authorization': `Bearer ${token}`
    },
    responseType: 'arraybuffer'
  });

  const base64 = Buffer.from(response.data).toString('base64');

  return {
    base64,
    mediaType
  };
}

/**
 * Analyze image using Claude Vision
 * @param {Object} imageData - {base64: string, mediaType: string}
 * @param {string} prompt - User's question about the image
 * @returns {Promise<string|null>}
 */
async function analyzeImage(imageData, prompt = 'この画像について説明してください。') {
  if (!imageData || !imageData.base64) {
    return null;
  }

  const modelId = resolveModelId();

  const payload = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: imageData.mediaType,
            data: imageData.base64
          }
        },
        {
          type: "text",
          text: prompt
        }
      ]
    }]
  };

  const client = new BedrockRuntimeClient({
    region: BEDROCK_REGION,
    endpoint: `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com`,
    credentials: undefined
  });

  const command = new InvokeModelCommand({
    contentType: "application/json",
    body: JSON.stringify(payload),
    modelId: modelId,
  });

  const apiResponse = await client.send(command);
  const decoded = new TextDecoder().decode(apiResponse.body);
  const responseBody = JSON.parse(decoded);

  if (responseBody.content && responseBody.content.length > 0) {
    return responseBody.content[0].text;
  }

  return null;
}

module.exports = {
  isImageFile,
  downloadAndEncodeImage,
  analyzeImage,
  SUPPORTED_IMAGE_TYPES
};
