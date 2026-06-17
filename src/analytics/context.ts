import { loadConfig } from '../ui/config.js';
import { isAnalyticsEnabled, isBetaTelemetryOptIn } from './identity.js';

export function getServerAnalyticsContext(): Record<string, boolean> {
  const config = loadConfig();
  const analyticsEnabled = isAnalyticsEnabled();
  return {
    privacy_mode: !analyticsEnabled,
    analytics_enabled: analyticsEnabled,
    beta_telemetry_opt_in: isBetaTelemetryOptIn(),
    action_plan_enabled: Boolean(config.actionPlanBeta),
  };
}
