/**
 * Routes browser analytics calls to Mixpanel (default) or dormant PostHog.
 * See docs/plans/2026-07-02-1141-mixpanel-analytics/ (mpa-phase-2.0-browser-analytics.md).
 */
import * as mixpanelBrowser from './mixpanel-browser';
import * as posthogBrowser from './posthog-browser';

export interface BrowserAnalyticsConfig {
  enabled: boolean;
  provider: 'mixpanel' | 'posthog';
  key: string;
  apiHost: string;
  uiHost: string;
  distinctId: string;
}

function usePostHog(config: BrowserAnalyticsConfig): boolean {
  return config.provider === 'posthog';
}

export function initBrowserAnalytics(config: BrowserAnalyticsConfig): void {
  if (usePostHog(config)) {
    posthogBrowser.initPostHogBrowser(config);
    return;
  }
  mixpanelBrowser.initMixpanelBrowser(config);
}

export function registerBrowserAnalyticsContext(
  properties: Record<string, string | number | boolean>
): void {
  if (posthogBrowser.isBrowserAnalyticsInitialized()) {
    posthogBrowser.registerBrowserAnalyticsContext(properties);
    return;
  }
  mixpanelBrowser.registerBrowserAnalyticsContext(properties);
}

export function captureBrowserEvent(
  name: string,
  properties?: Record<string, string | number | boolean>
): void {
  if (posthogBrowser.isBrowserAnalyticsInitialized()) {
    posthogBrowser.captureBrowserEvent(name, properties);
    return;
  }
  mixpanelBrowser.captureBrowserEvent(name, properties);
}

export function optOutBrowserCapturing(): void {
  if (posthogBrowser.isBrowserAnalyticsInitialized()) {
    posthogBrowser.optOutBrowserCapturing();
    return;
  }
  mixpanelBrowser.optOutBrowserCapturing();
}

export function optInBrowserCapturing(): void {
  if (posthogBrowser.isBrowserAnalyticsInitialized()) {
    posthogBrowser.optInBrowserCapturing();
    return;
  }
  mixpanelBrowser.optInBrowserCapturing();
}

export function isBrowserAnalyticsInitialized(): boolean {
  return (
    posthogBrowser.isBrowserAnalyticsInitialized() ||
    mixpanelBrowser.isBrowserAnalyticsInitialized()
  );
}
