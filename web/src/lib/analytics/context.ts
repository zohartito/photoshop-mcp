import { getStoredTheme, type Theme } from '@/composables/useTheme';
import { apiGetAnalyticsConfig, apiStatus } from '@/lib/api';
import { buildBrowserLocaleProperties } from '@/lib/analytics/locale';
import { registerBrowserAnalyticsContext, isBrowserAnalyticsInitialized } from './posthog-browser';

export interface BrowserAnalyticsContext {
  privacy_mode: boolean;
  beta_telemetry_opt_in: boolean;
  theme: Theme;
  action_plan_enabled: boolean;
  browser_language: string;
  browser_timezone: string;
  browser_locale_region?: string;
}

export async function buildBrowserAnalyticsContext(): Promise<BrowserAnalyticsContext> {
  const [config, status] = await Promise.all([apiGetAnalyticsConfig(), apiStatus()]);
  return {
    privacy_mode: !config.enabled,
    beta_telemetry_opt_in: config.betaTelemetryOptIn,
    theme: getStoredTheme(),
    action_plan_enabled: status.actionPlanBeta,
    ...buildBrowserLocaleProperties(),
  };
}

export async function syncAnalyticsContext(): Promise<void> {
  if (!isBrowserAnalyticsInitialized()) return;
  try {
    const context = await buildBrowserAnalyticsContext();
    registerBrowserAnalyticsContext({ ...context });
  } catch {
    // Analytics context is best-effort; settings APIs may be unavailable during startup.
  }
}
