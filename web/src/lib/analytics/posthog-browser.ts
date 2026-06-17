import posthog from 'posthog-js';

export interface BrowserAnalyticsConfig {
  enabled: boolean;
  key: string;
  apiHost: string;
  uiHost: string;
  distinctId: string;
}

let initialized = false;

export function initPostHogBrowser(config: BrowserAnalyticsConfig): void {
  if (initialized || !config.enabled || !config.key) return;

  posthog.init(config.key, {
    api_host: config.apiHost,
    ui_host: config.uiHost,
    person_profiles: 'identified_only',
    bootstrap: { distinctID: config.distinctId },
    capture_pageview: 'history_change',
    autocapture: false,
  });

  initialized = true;
}

export function registerBrowserAnalyticsContext(
  properties: Record<string, string | number | boolean>
): void {
  if (!initialized) return;
  posthog.register(properties);
}

export function captureBrowserEvent(
  name: string,
  properties?: Record<string, string | number | boolean>
): void {
  if (!initialized) return;
  posthog.capture(name, { ...properties, event_source: 'ui' });
}

export function optOutBrowserCapturing(): void {
  if (!initialized) return;
  posthog.opt_out_capturing();
}

export function optInBrowserCapturing(): void {
  if (!initialized) return;
  posthog.opt_in_capturing();
}

export function isBrowserAnalyticsInitialized(): boolean {
  return initialized;
}
