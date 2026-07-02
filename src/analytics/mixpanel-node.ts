/**
 * Mixpanel Node analytics provider.
 * See docs/plans/2026-07-02-1141-mixpanel-analytics/ (mpa-phase-1.0-server-analytics.md).
 */
import Mixpanel from 'mixpanel';
import { Logger } from '../utils/logger.js';
import { resolveMixpanelNodeHost, resolveMixpanelToken } from './config.js';
import { buildPersonIdentifyProperties } from './events.js';
import { getOrCreateDistinctId } from './identity.js';
import type { AnalyticsEvent, AnalyticsProvider } from './types.js';

export class MixpanelNodeProvider implements AnalyticsProvider {
  private client: ReturnType<typeof Mixpanel.init>;
  private logger = new Logger('Analytics');
  private distinctId: string;

  constructor() {
    // Desktop app: Node runs on the user's machine, so Mixpanel can GeoIP the outbound request IP.
    this.client = Mixpanel.init(resolveMixpanelToken(), {
      host: resolveMixpanelNodeHost(),
      geolocate: true,
    });
    this.distinctId = getOrCreateDistinctId();
    this.identifyPerson();
  }

  private identifyPerson(): void {
    this.identify({ event_source: 'server' });
  }

  identify(properties?: Record<string, unknown>): void {
    try {
      this.client.people.set(
        this.distinctId,
        buildPersonIdentifyProperties(properties)
      );
    } catch (err) {
      this.logger.debug('Failed to identify analytics person', err);
    }
  }

  async flush(): Promise<void> {
    // Mixpanel batches internally; no explicit flush API.
  }

  capture(event: AnalyticsEvent): void {
    try {
      this.client.track(event.name, {
        distinct_id: this.distinctId,
        ...event.properties,
      });
    } catch (err) {
      this.logger.debug('Failed to capture analytics event', err);
    }
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }
}
