import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { ModelPricing, ProviderAdapter, ProviderModel } from './types.js';

// Curated to models known to support tool calling on OpenRouter. Prices in USD
// per 1M tokens; OpenRouter passes provider rates through without markup.
const MODELS: ProviderModel[] = [
  {
    id: 'anthropic/claude-sonnet-5.5',
    label: 'Claude Sonnet 5.5',
    pricing: {
      inputUsdPerMTok: 2,
      outputUsdPerMTok: 10,
      cachedInputUsdPerMTok: 0.1,
      cachedWriteUsdPerMTok: 2.5,
    },
  },
  {
    id: 'anthropic/claude-opus-4.5',
    label: 'Claude Opus 4.5',
    pricing: {
      inputUsdPerMTok: 5,
      outputUsdPerMTok: 25,
      cachedInputUsdPerMTok: 0.5,
      cachedWriteUsdPerMTok: 6.25,
    },
  },
  {
    id: 'openai/gpt-6.1-sol',
    label: 'GPT-6.1 Sol',
    pricing: { inputUsdPerMTok: 2, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 0.1 },
  },
  {
    id: 'openai/gpt-6-luna',
    label: 'GPT-6 Luna',
    pricing: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5, cachedInputUsdPerMTok: 0.01 },
  },
  {
    id: 'google/gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    pricing: { inputUsdPerMTok: 1.25, outputUsdPerMTok: 10 },
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    label: 'Llama 3.3 70B',
    pricing: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.32 },
  },
];

// Preserve cost accounting for saved conversations using older picker entries.
const LEGACY_PRICING: Record<string, ModelPricing> = {
  'anthropic/claude-sonnet-4.5': {
    inputUsdPerMTok: 3, outputUsdPerMTok: 15,
    cachedInputUsdPerMTok: 0.3, cachedWriteUsdPerMTok: 3.75,
  },
  'openai/gpt-5': { inputUsdPerMTok: 1.25, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 0.125 },
  'openai/gpt-4.1-mini': { inputUsdPerMTok: 0.4, outputUsdPerMTok: 1.6, cachedInputUsdPerMTok: 0.1 },
};

export const openrouterAdapter: ProviderAdapter = {
  id: 'openrouter',
  label: 'OpenRouter',
  apiKeyHint: 'sk-or-v1-...',
  apiKeyHelpUrl: 'https://openrouter.ai/keys',
  supportedAuthMethods: ['api_key'],
  validateApiKeyFormat(key) {
    return key.startsWith('sk-or-');
  },
  async validateApiKey(key) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
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
    return 'anthropic/claude-sonnet-5.5';
  },
  getLanguageModel({ apiKey, modelId }) {
    return createOpenRouter({ apiKey })(modelId);
  },
  getModelPricing(modelId) {
    return MODELS.find((m) => m.id === modelId)?.pricing
      ?? (Object.hasOwn(LEGACY_PRICING, modelId) ? LEGACY_PRICING[modelId] : undefined);
  },
};
