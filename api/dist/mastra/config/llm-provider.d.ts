export type ProviderType = 'bedrock' | 'anthropic' | 'cloudflare';
export declare function getLLMModel(provider?: ProviderType): import("ai").LanguageModelV1;
export declare const defaultProvider: ProviderType;
export declare const defaultModel: import("ai").LanguageModelV1;
//# sourceMappingURL=llm-provider.d.ts.map