import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  buildGeminiProbeCliInvocation,
  createCliAccountWorkspace,
  type CliAccountWorkspace,
  type GeminiCliWorkspaceFiles,
  writeGeminiProbeWorkspaceFiles,
} from '../agent/cli-account-security.js';
import { resolveCliBinary, runCommand } from './cli-utils.js';
import type { ProviderAdapter, ProviderModel } from './types.js';

// Curated to Gemini models that support tool calling on the Google AI Studio
// (Generative Language) API. Prices in USD per 1M tokens; Pro tiers reflect
// the lower context bracket (<=200K for 2.5 Pro, <=128K for 1.5 Pro).
const MODELS: ProviderModel[] = [
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    pricing: { inputUsdPerMTok: 1.25, outputUsdPerMTok: 10, cachedInputUsdPerMTok: 0.31 },
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    pricing: { inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5, cachedInputUsdPerMTok: 0.075 },
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    pricing: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.4, cachedInputUsdPerMTok: 0.025 },
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    pricing: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.4 },
  },
  {
    id: 'gemini-1.5-pro',
    label: 'Gemini 1.5 Pro',
    pricing: { inputUsdPerMTok: 1.25, outputUsdPerMTok: 5 },
  },
  {
    id: 'gemini-1.5-flash',
    label: 'Gemini 1.5 Flash',
    pricing: { inputUsdPerMTok: 0.075, outputUsdPerMTok: 0.3 },
  },
];

export interface GoogleCliProbeWorkspace extends CliAccountWorkspace, GeminiCliWorkspaceFiles {}

export async function createGoogleCliProbeWorkspace(): Promise<GoogleCliProbeWorkspace> {
  const workspace = await createCliAccountWorkspace('gemini-probe');

  try {
    const files = await writeGeminiProbeWorkspaceFiles(workspace);
    return { ...workspace, ...files };
  } catch (error) {
    await workspace.cleanup();
    throw error;
  }
}

export const googleAdapter: ProviderAdapter = {
  id: 'google',
  label: 'Google AI Studio',
  apiKeyHint: 'AIza...',
  apiKeyHelpUrl: 'https://aistudio.google.com/apikey',
  supportedAuthMethods: ['api_key', 'cli_account'],
  cliBinaryName: 'gemini',
  validateApiKeyFormat(key) {
    return key.startsWith('AIza') && key.length >= 35;
  },
  async validateApiKey(key) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1`
      );
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return { ok: false, error: text };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
  async validateCliAccount({ cliPath } = {}) {
    const binary = await resolveCliBinary('gemini', cliPath);
    if (!binary) {
      return { ok: false, error: 'cli_not_found' };
    }
    const workspace = await createGoogleCliProbeWorkspace();
    try {
      const invocation = buildGeminiProbeCliInvocation(workspace);
      const result = await runCommand(binary, invocation.args, {
        timeoutMs: 60_000,
        cwd: invocation.cwd,
        env: invocation.env,
      });
      if (result.exitCode === 41) {
        return { ok: false, error: 'not_authenticated' };
      }
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        return { ok: false, error: detail || 'cli_probe_failed' };
      }
      return { ok: true };
    } finally {
      await workspace.cleanup();
    }
  },
  listModels() {
    return MODELS.map((m) => ({ ...m }));
  },
  defaultModel() {
    return 'gemini-2.5-flash';
  },
  getLanguageModel({ apiKey, modelId }) {
    return createGoogleGenerativeAI({ apiKey })(modelId);
  },
  getModelPricing(modelId) {
    return MODELS.find((m) => m.id === modelId)?.pricing;
  },
};
