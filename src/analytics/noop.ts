import type { AnalyticsEvent, AnalyticsProvider } from './types.js';

export class NoopAnalyticsProvider implements AnalyticsProvider {
  capture(_event: AnalyticsEvent): void {
    // intentionally empty
  }

  async shutdown(): Promise<void> {
    // intentionally empty
  }
}
