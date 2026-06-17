import { PostHog } from 'posthog-node';
import { Logger } from '../utils/logger.js';
import { resolvePostHogApiHost, resolvePostHogKey } from './config.js';
import { getOrCreateDistinctId } from './identity.js';
import type { AnalyticsEvent, AnalyticsProvider } from './types.js';

export class PostHogNodeProvider implements AnalyticsProvider {
  private client: PostHog;
  private logger = new Logger('Analytics');

  constructor() {
    this.client = new PostHog(resolvePostHogKey(), {
      host: resolvePostHogApiHost(),
      flushAt: 10,
      flushInterval: 5000,
    });
  }

  capture(event: AnalyticsEvent): void {
    try {
      this.client.capture({
        distinctId: getOrCreateDistinctId(),
        event: event.name,
        properties: event.properties,
      });
    } catch (err) {
      this.logger.debug('Failed to capture analytics event', err);
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.client.shutdown();
    } catch (err) {
      this.logger.debug('Failed to shutdown analytics client', err);
    }
  }
}
