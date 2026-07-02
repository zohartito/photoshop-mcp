import { randomUUID } from 'node:crypto';
import { PostHog } from 'posthog-node';
import { Logger } from '../utils/logger.js';
import { resolvePostHogApiHost, resolvePostHogKey } from './config.js';
import { buildPersonIdentifyProperties, sanitizePersonOnceProperties } from './events.js';
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
    this.setPersonOnce({ first_install_at: new Date().toISOString() });
  }

  private identifyPerson(): void {
    this.identify({ event_source: 'server' });
  }

  identify(properties?: Record<string, unknown>): void {
    try {
      this.client.identify({
        distinctId: this.distinctId,
        properties: buildPersonIdentifyProperties(properties),
        disableGeoip: false,
      });
    } catch (err) {
      this.logger.debug('Failed to identify analytics person', err);
    }
  }

  setPersonOnce(properties: Record<string, unknown>): void {
    const props = sanitizePersonOnceProperties(properties);
    if (Object.keys(props).length === 0) return;

    try {
      this.client.identify({
        distinctId: this.distinctId,
        properties: {
          $set_once: props,
        },
        disableGeoip: false,
      });
    } catch (err) {
      this.logger.debug('Failed to set_once analytics person properties', err);
    }
  }

  async flush(): Promise<void> {
    try {
      await this.client.flush();
    } catch (err) {
      this.logger.debug('Failed to flush analytics client', err);
    }
  }

  capture(event: AnalyticsEvent): void {
    try {
      this.client.capture({
        distinctId: this.distinctId,
        event: event.name,
        properties: event.properties,
        uuid: event.insertId ?? randomUUID(),
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
