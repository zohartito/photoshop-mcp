import { apiGetAnalyticsConfig, apiSetAnalyticsOptOut } from '@/lib/api';
import { syncAnalyticsContext } from './context';
import {
  captureBrowserEvent,
  initPostHogBrowser,
  isBrowserAnalyticsInitialized,
  optInBrowserCapturing,
  optOutBrowserCapturing,
} from './posthog-browser';

export { syncAnalyticsContext } from './context';

let enabled = false;

export async function initAnalytics(): Promise<void> {
  try {
    const config = await apiGetAnalyticsConfig();
    enabled = config.enabled;
    initPostHogBrowser(config);
    if (config.enabled) {
      await syncAnalyticsContext();
    }
  } catch {
    enabled = false;
  }
}

export function isAnalyticsEnabled(): boolean {
  return enabled && isBrowserAnalyticsInitialized();
}

export function capture(
  name: string,
  properties?: Record<string, string | number | boolean>
): void {
  if (!isAnalyticsEnabled()) return;
  captureBrowserEvent(name, properties);
}

export async function setAnalyticsOptOut(optedOut: boolean): Promise<void> {
  await apiSetAnalyticsOptOut(optedOut);
  if (optedOut) {
    enabled = false;
    optOutBrowserCapturing();
    return;
  }
  enabled = await refreshAnalyticsState();
  optInBrowserCapturing();
  await syncAnalyticsContext();
}

export async function refreshAnalyticsState(): Promise<boolean> {
  try {
    const config = await apiGetAnalyticsConfig();
    enabled = config.enabled;
    if (config.enabled && !isBrowserAnalyticsInitialized()) {
      initPostHogBrowser(config);
    }
    if (config.enabled) {
      await syncAnalyticsContext();
    }
    return config.enabled;
  } catch {
    enabled = false;
    return false;
  }
}
