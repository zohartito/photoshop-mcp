import { captureBetaChatTurn } from './beta-telemetry.js';
import {
  hasPostHogKey,
  resolvePostHogApiHost,
  resolvePostHogKey,
  resolvePostHogUiHost,
} from './config.js';
import { buildRuntimeProperties } from './events.js';
import {
  getBetaTelemetryState,
  getOrCreateDistinctId,
  isAnalyticsEnabled,
  setBetaTelemetryChoice,
} from './identity.js';
import { getAnalytics, resetAnalyticsProvider, shutdownAnalyticsClient } from './provider.js';
import type {
  AnalyticsEvent,
  AnalyticsProvider,
  AnalyticsRuntimeConfig,
  BetaTelemetryState,
} from './types.js';

/** Persist the install ID and register one anonymous PostHog person per process. */
export function ensureAnalyticsIdentity(): void {
  if (!isAnalyticsEnabled() || !hasPostHogKey()) return;
  getOrCreateDistinctId();
  getAnalytics();
}

export function capture(
  name: string,
  properties?: Record<string, unknown>
): void {
  if (!isAnalyticsEnabled() || !hasPostHogKey()) return;
  getAnalytics().capture({
    name,
    properties: buildRuntimeProperties(properties),
  });
}

export async function shutdownAnalytics(): Promise<void> {
  await shutdownAnalyticsClient();
}

export function getAnalyticsRuntimeConfig(): AnalyticsRuntimeConfig {
  const enabled = isAnalyticsEnabled() && hasPostHogKey();
  const beta = getBetaTelemetryState();
  return {
    enabled,
    key: resolvePostHogKey(),
    apiHost: resolvePostHogApiHost(),
    uiHost: resolvePostHogUiHost(),
    distinctId: getOrCreateDistinctId(),
    betaTelemetryOptIn: beta.betaTelemetryOptIn,
    betaTelemetryPromptAnswered: beta.betaTelemetryPromptAnswered,
  };
}

export {
  captureBetaChatTurn,
  getAnalytics,
  getBetaTelemetryState,
  resetAnalyticsProvider,
  setBetaTelemetryChoice,
};
export type { AnalyticsEvent, AnalyticsProvider, AnalyticsRuntimeConfig, BetaTelemetryState };
