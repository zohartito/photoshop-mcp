import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderAdapter, ProviderModel } from './types.js';

// Curated to models known to support tool calling. Prices in USD per 1M tokens.
const MODELS: ProviderModel[] = [
  {
    id: 'gpt-5',
    label: 'GPT-5',
    pricing: { inputUsdPerMTok: 1.25, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 0.125 },
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 mini',
    pricing: { inputUsdPerMTok: 0.25, outputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.025 },
  },
  {
    id: 'gpt-4.1',
    label: 'GPT-4.1',
    pricing: { inputUsdPerMTok: 2, outputUsdPerMTok: 8, cachedInputUsdPerMTok: 0.5 },
  },
  {
    id: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    pricing: { inputUsdPerMTok: 0.4, outputUsdPerMTok: 1.6, cachedInputUsdPerMTok: 0.1 },
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    pricing: { inputUsdPerMTok: 2.5, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 1.25 },
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    pricing: { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6, cachedInputUsdPerMTok: 0.075 },
  },
];

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI',
  apiKeyHint: 'sk-...',
  apiKeyHelpUrl: 'https://platform.openai.com/api-keys',
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
    return 'gpt-4.1-mini';
  },
  getLanguageModel({ apiKey, modelId }) {
    return createOpenAI({ apiKey })(modelId);
  },
  getModelPricing(modelId) {
    return MODELS.find((m) => m.id === modelId)?.pricing;
  },
};
