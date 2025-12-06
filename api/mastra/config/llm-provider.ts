// mastra/config/llm-provider.ts
// LLMプロバイダー抽象化 - Bedrock/Anthropic/Cloudflare切り替え可能

import { bedrock } from '@ai-sdk/amazon-bedrock';
import { anthropic } from '@ai-sdk/anthropic';

export type ProviderType = 'bedrock' | 'anthropic' | 'cloudflare';

export function getLLMModel(provider: ProviderType = 'bedrock') {
  switch (provider) {
    case 'bedrock':
      return bedrock('anthropic.claude-sonnet-4-20250514-v1:0');
    case 'anthropic':
      return anthropic('claude-sonnet-4-20250514');
    case 'cloudflare':
      // Cloudflare Workers AI対応時に追加
      throw new Error('Cloudflare provider not yet implemented');
    default:
      return bedrock('anthropic.claude-sonnet-4-20250514-v1:0');
  }
}

// デフォルトプロバイダー（環境変数で切り替え可能）
export const defaultProvider: ProviderType =
  (process.env.LLM_PROVIDER as ProviderType) || 'bedrock';

export const defaultModel = getLLMModel(defaultProvider);
