/**
 * User-configurable OpenAI- or Anthropic-compatible API adapter.
 * Reads endpoint, models, and credentials from `UIConfig.customProvider`.
 * See docs/plans/2026-06-26-1250-custom-api-provider-pr3/ (cap-phase-0-cherry-pick.md).
 */
import { CUSTOM_PROVIDER_DISABLED_MESSAGE, getCustomProvider } from '../config.js';
import type { ProviderAdapter, ProviderModel } from './types.js';

export const customAdapter: ProviderAdapter = {
  id: 'custom',
  supportedAuthMethods: ['api_key'],
  get label() {
    return getCustomProvider()?.name || 'Custom';
  },
  get apiKeyHint() {
    return 'Enter your API key';
  },
  get apiKeyHelpUrl() {
    return getCustomProvider()?.websiteUrl || '';
  },
  validateApiKeyFormat(_key: string) {
    return false;
  },
  async validateApiKey(_key: string) {
    return { ok: false, error: CUSTOM_PROVIDER_DISABLED_MESSAGE };
  },
  listModels(): ProviderModel[] {
    const cfg = getCustomProvider();
    if (!cfg) return [];
    return cfg.models.map((m) => ({ id: m.id, label: m.label }));
  },
  defaultModel() {
    return getCustomProvider()?.defaultModel || '';
  },
  getLanguageModel({ apiKey, modelId }) {
    void apiKey;
    void modelId;
    throw new Error(CUSTOM_PROVIDER_DISABLED_MESSAGE);
  },
  getModelPricing(_modelId: string) {
    return undefined;
  },
};
