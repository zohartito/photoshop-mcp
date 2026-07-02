/**
 * Mixpanel browser analytics adapter for the standalone UI.
 * See docs/plans/2026-07-02-1141-mixpanel-analytics/ (mpa-phase-2.0-browser-analytics.md).
 */
import mixpanel from 'mixpanel-browser';
import { buildBrowserLocaleProperties } from './locale';

export interface MixpanelBrowserConfig {
  enabled: boolean;
  key: string;
  apiHost: string;
  distinctId: string;
}

let initialized = false;

export function initMixpanelBrowser(config: MixpanelBrowserConfig): void {
  if (initialized || !config.enabled || !config.key) return;

  mixpanel.init(config.key, {
    api_host: config.apiHost,
    autocapture: true,
    record_sessions_percent: 100,
  });
  const localeProps = buildBrowserLocaleProperties();

  mixpanel.identify(config.distinctId);
  mixpanel.people.set(localeProps);
  mixpanel.register(localeProps);

  initialized = true;
}

export function registerBrowserAnalyticsContext(
  properties: Record<string, string | number | boolean>
): void {
  if (!initialized) return;
  mixpanel.register(properties);
  mixpanel.people.set(properties);
}

export function captureBrowserEvent(
  name: string,
  properties?: Record<string, string | number | boolean>
): void {
  if (!initialized) return;
  mixpanel.track(name, { ...properties, event_source: 'ui' });
}

export function optOutBrowserCapturing(): void {
  if (!initialized) return;
  mixpanel.opt_out_tracking();
}

export function optInBrowserCapturing(): void {
  if (!initialized) return;
  mixpanel.opt_in_tracking();
}

export function isBrowserAnalyticsInitialized(): boolean {
  return initialized;
}
