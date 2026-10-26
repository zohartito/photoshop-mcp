import { createOpenAI } from '@ai-sdk/openai';
import type { ModelPricing, ProviderAdapter, ProviderModel } from './types.js';

// Curated to models known to support tool calling. Prices in USD per 1M tokens.
const MODELS: ProviderModel[] = [
  {
    id: 'gpt-6-astra',
    label: 'GPT-6 Astra',
    pricing: { inputUsdPerMTok: 10, outputUsdPerMTok: 50, cachedInputUsdPerMTok: 1 },
  },
  {
    id: 'gpt-6.1-sol',
    label: 'GPT-6.1 Sol',
    pricing: { inputUsdPerMTok: 2, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 0.1 },
  },
  {
    id: 'gpt-6-luna',
    label: 'GPT-6 Luna',
    pricing: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5, cachedInputUsdPerMTok: 0.01 },
  },
];

// Saved chats keep their model IDs even after a model leaves the picker.
const LEGACY_PRICING: Record<string, ModelPricing> = {
  'gpt-5': { inputUsdPerMTok: 1.25, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 0.125 },
  'gpt-5-mini': { inputUsdPerMTok: 0.25, outputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.025 },
  'gpt-4.1': { inputUsdPerMTok: 2, outputUsdPerMTok: 8, cachedInputUsdPerMTok: 0.5 },
  'gpt-4.1-mini': { inputUsdPerMTok: 0.4, outputUsdPerMTok: 1.6, cachedInputUsdPerMTok: 0.1 },
  'gpt-4o': { inputUsdPerMTok: 2.5, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 1.25 },
  'gpt-4o-mini': { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6, cachedInputUsdPerMTok: 0.075 },
};

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI',
  apiKeyHint: 'sk-...',
  apiKeyHelpUrl: 'https://platform.openai.com/api-keys',
  supportedAuthMethods: ['api_key'],
  validateApiKeyFormat(key) {
    return key.startsWith('sk-') && key.length > 20;
  },
  async validateApiKey(key) {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return { ok: false, error: text };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
  listModels() {
    return MODELS.map((m) => ({ ...m }));
  },
  defaultModel() {
    return 'gpt-6-luna';
  },
  getLanguageModel({ apiKey, modelId }) {
    return createOpenAI({ apiKey })(modelId);
  },
  getModelPricing(modelId) {
    return MODELS.find((m) => m.id === modelId)?.pricing
      ?? (Object.hasOwn(LEGACY_PRICING, modelId) ? LEGACY_PRICING[modelId] : undefined);
  },
};
