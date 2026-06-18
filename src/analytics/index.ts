import { captureBetaChatTurn } from './beta-telemetry.js';
import { getAppVersion } from './app-version.js';
import {
  hasPostHogKey,
  resolvePostHogApiHost,
  resolvePostHogKey,
  resolvePostHogUiHost,
} from './config.js';
import { buildPersonIdentifyProperties, buildRuntimeProperties } from './events.js';
import {
  getBetaTelemetryState,
  getOrCreateDistinctId,
  isAnalyticsEnabled,
  recordUsageSurface,
  setBetaTelemetryChoice,
} from './identity.js';
import {
  onMcpClientConnected,
  onMcpClientDisconnected,
} from './mcp-client.js';
import {
  endMcpAnalyticsSession,
  recordMcpToolCall,
  startMcpAnalyticsSession,
} from './mcp-session.js';
import { captureMcpPageleave, captureMcpPageview } from './pageview.js';
import { getAnalytics, resetAnalyticsProvider, shutdownAnalyticsClient } from './provider.js';
import type {
  AnalyticsEvent,
  AnalyticsProvider,
  AnalyticsRuntimeConfig,
  BetaTelemetryState,
  UsageSurface,
} from './types.js';
export type { McpShutdownReason } from './mcp-session.js';

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

export function identifyAnalyticsPerson(
  properties?: Record<string, unknown>
): void {
  if (!isAnalyticsEnabled() || !hasPostHogKey()) return;
  const props = { ...(properties ?? {}) };
  if (typeof props.usage_surface === 'string') {
    props.usage_surfaces = recordUsageSurface(props.usage_surface);
    delete props.usage_surface;
  }
  getAnalytics().identify(buildPersonIdentifyProperties(props));
}

/** Refresh the anonymous person profile when Photoshop version becomes known. */
export function identifyPhotoshopVersion(version: string): void {
  if (!version || version === 'Unknown') return;
  identifyAnalyticsPerson({ photoshop_version: version });
}

/** Record standalone UI provider/model choice on the person profile (no prompt content). */
export function identifyUiModelSelection(providerId: string, model: string): void {
  identifyAnalyticsPerson({
    usage_surface: 'server',
    active_provider: providerId,
    active_model: model,
    last_active_at: Date.now(),
  });
  capture('ui_model_selected', {
    provider_id: providerId,
    model,
    event_source: 'server',
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
  captureMcpPageleave,
  captureMcpPageview,
  endMcpAnalyticsSession,
  getAnalytics,
  getAppVersion,
  getBetaTelemetryState,
  onMcpClientConnected,
  onMcpClientDisconnected,
  recordMcpToolCall,
  resetAnalyticsProvider,
  setBetaTelemetryChoice,
  startMcpAnalyticsSession,
};
export type {
  AnalyticsEvent,
  AnalyticsProvider,
  AnalyticsRuntimeConfig,
  BetaTelemetryState,
  UsageSurface,
};
