import assert from 'node:assert/strict';
import { openaiAdapter } from '../src/ui/providers/openai.js';
import { openrouterAdapter } from '../src/ui/providers/openrouter.js';
import { googleAdapter } from '../src/ui/providers/google.js';

for (const adapter of [openaiAdapter, openrouterAdapter, googleAdapter]) {
  assert.ok(adapter.listModels().some((model) => model.id === adapter.defaultModel()));
  for (const model of adapter.listModels()) {
    assert.deepEqual(adapter.getModelPricing(model.id), model.pricing);
  }
  for (const unknown of ['missing-model', '__proto__', 'constructor']) {
    assert.equal(adapter.getModelPricing(unknown), undefined);
  }
}
for (const [adapter, modelId] of [
  [openaiAdapter, 'gpt-4.1-mini'],
  [openrouterAdapter, 'openai/gpt-4.1-mini'],
] as const) {
  assert.equal(adapter.listModels().some((model) => model.id === modelId), false);
  assert.deepEqual(adapter.getModelPricing(modelId), {
    inputUsdPerMTok: 0.4, outputUsdPerMTok: 1.6, cachedInputUsdPerMTok: 0.1,
  });
}
for (const modelId of ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini']) {
  assert.ok(openaiAdapter.getModelPricing(modelId));
}
assert.equal(openrouterAdapter.getModelPricing('anthropic/claude-sonnet-4.5')?.cachedWriteUsdPerMTok, 3.75);
assert.equal(openrouterAdapter.getModelPricing('openai/gpt-5')?.inputUsdPerMTok, 1.25);
for (const [modelId, input, output] of [
  ['gemini-2.0-flash', 0.1, 0.4], ['gemini-1.5-pro', 1.25, 5], ['gemini-1.5-flash', 0.075, 0.3],
] as const) {
  assert.equal(googleAdapter.listModels().some((model) => model.id === modelId), false);
  assert.deepEqual(googleAdapter.getModelPricing(modelId), {
    inputUsdPerMTok: input, outputUsdPerMTok: output,
  });
}
console.log('Provider pricing regression checks passed.');
