/**
 * Mixpanel browser analytics adapter for the standalone UI.
 * See docs/anonymous-usage-analytics.md.
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
  const installCohortProps = {
    ...localeProps,
    first_install_at: new Date().toISOString(),
    first_usage_surface: 'web',
  };

  mixpanel.identify(config.distinctId);
  mixpanel.register_once(localeProps);
  mixpanel.people.set_once(installCohortProps);

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
