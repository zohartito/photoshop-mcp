export type AnalyticsEventSource = 'ui' | 'server' | 'mcp';

export interface AnalyticsEvent {
  name: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
}

export interface BetaTelemetryState {
  betaTelemetryOptIn: boolean;
  betaTelemetryPromptAnswered: boolean;
}

export interface AnalyticsRuntimeConfig {
  enabled: boolean;
  provider: 'mixpanel' | 'posthog';
  key: string;
  apiHost: string;
  uiHost: string;
  distinctId: string;
  betaTelemetryOptIn: boolean;
  betaTelemetryPromptAnswered: boolean;
}

export type UsageSurface = 'mcp' | 'server' | 'ui';

export interface AnalyticsProvider {
  capture(event: AnalyticsEvent): void;
  identify(properties?: Record<string, unknown>): void;
  /** Push queued events without shutting down the client. */
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
