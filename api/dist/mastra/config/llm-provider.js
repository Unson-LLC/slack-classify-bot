"use strict";
// mastra/config/llm-provider.ts
// LLMプロバイダー抽象化 - Bedrock/Anthropic/Cloudflare切り替え可能
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultModel = exports.defaultProvider = void 0;
exports.getLLMModel = getLLMModel;
const amazon_bedrock_1 = require("@ai-sdk/amazon-bedrock");
const anthropic_1 = require("@ai-sdk/anthropic");
function getLLMModel(provider = 'bedrock') {
    switch (provider) {
        case 'bedrock':
            return (0, amazon_bedrock_1.bedrock)('anthropic.claude-sonnet-4-20250514-v1:0');
        case 'anthropic':
            return (0, anthropic_1.anthropic)('claude-sonnet-4-20250514');
        case 'cloudflare':
            // Cloudflare Workers AI対応時に追加
            throw new Error('Cloudflare provider not yet implemented');
        default:
            return (0, amazon_bedrock_1.bedrock)('anthropic.claude-sonnet-4-20250514-v1:0');
    }
}
// デフォルトプロバイダー（環境変数で切り替え可能）
exports.defaultProvider = process.env.LLM_PROVIDER || 'bedrock';
exports.defaultModel = getLLMModel(exports.defaultProvider);
//# sourceMappingURL=llm-provider.js.map