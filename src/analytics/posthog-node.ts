import { PostHog } from 'posthog-node';
import { Logger } from '../utils/logger.js';
import { resolvePostHogApiHost, resolvePostHogKey } from './config.js';
import { buildRuntimeProperties } from './events.js';
import { getOrCreateDistinctId } from './identity.js';
import type { AnalyticsEvent, AnalyticsProvider } from './types.js';

export class PostHogNodeProvider implements AnalyticsProvider {
  private client: PostHog;
  private logger = new Logger('Analytics');
  private distinctId: string;

  constructor() {
    // Desktop app: Node runs on the user's machine, so PostHog can GeoIP the outbound request IP.
    this.client = new PostHog(resolvePostHogKey(), {
      host: resolvePostHogApiHost(),
      flushAt: 10,
      flushInterval: 5000,
      disableGeoip: false,
    });
    this.distinctId = getOrCreateDistinctId();
    this.identifyPerson();
  }

  private identifyPerson(): void {
    try {
      this.client.identify({
        distinctId: this.distinctId,
        properties: buildRuntimeProperties({ event_source: 'server' }),
        disableGeoip: false,
      });
    } catch (err) {
      this.logger.debug('Failed to identify analytics person', err);
    }
  }

  capture(event: AnalyticsEvent): void {
    try {
      this.client.capture({
        distinctId: this.distinctId,
        event: event.name,
        properties: event.properties,
        disableGeoip: false,
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
