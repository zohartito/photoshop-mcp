/**
 * Mixpanel Node analytics provider.
 * See docs/anonymous-usage-analytics.md.
 */
import { randomUUID } from 'node:crypto';
import Mixpanel from 'mixpanel';
import { Logger } from '../utils/logger.js';
import { resolveMixpanelNodeHost, resolveMixpanelToken } from './config.js';
import { buildPersonIdentifyProperties, sanitizePersonOnceProperties } from './events.js';
import { getOrCreateDistinctId } from './identity.js';
import type { AnalyticsEvent, AnalyticsProvider } from './types.js';

type MixpanelCallback = (err?: Error) => void;

function promisifyMixpanel(op: (callback: MixpanelCallback) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    op((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export class MixpanelNodeProvider implements AnalyticsProvider {
  private client: ReturnType<typeof Mixpanel.init>;
  private logger = new Logger('Analytics');
  private distinctId: string;
  private pending = new Set<Promise<void>>();

  constructor() {
    // Desktop app: Node runs on the user's machine, so Mixpanel can GeoIP the outbound request IP.
    this.client = Mixpanel.init(resolveMixpanelToken(), {
      host: resolveMixpanelNodeHost(),
      geolocate: true,
    });
    this.distinctId = getOrCreateDistinctId();
    this.identifyPerson();
    this.setPersonOnce({ first_install_at: new Date().toISOString() });
  }

  private trackPending(promise: Promise<void>): void {
    this.pending.add(promise);
    void promise.finally(() => {
      this.pending.delete(promise);
    });
  }

  private identifyPerson(): void {
    this.identify({ event_source: 'server' });
  }

  identify(properties?: Record<string, unknown>): void {
    const props = buildPersonIdentifyProperties(properties);
    const promise = promisifyMixpanel((callback) => {
      this.client.people.set(this.distinctId, props, callback);
    }).catch((err) => {
      this.logger.debug('Failed to identify analytics person', err);
    });
    this.trackPending(promise);
  }

  setPersonOnce(properties: Record<string, unknown>): void {
    const props = sanitizePersonOnceProperties(properties);
    if (Object.keys(props).length === 0) return;

    const promise = promisifyMixpanel((callback) => {
      this.client.people.set_once(this.distinctId, props, callback);
    }).catch((err) => {
      this.logger.debug('Failed to set_once analytics person properties', err);
    });
    this.trackPending(promise);
  }

  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    await Promise.allSettled([...this.pending]);
  }

  capture(event: AnalyticsEvent): void {
    const insertId = event.insertId ?? randomUUID();
    const properties = {
      distinct_id: this.distinctId,
      $insert_id: insertId,
      ...event.properties,
    };

    const promise = promisifyMixpanel((callback) => {
      this.client.track(event.name, properties, callback);
    }).catch((err) => {
      this.logger.debug('Failed to capture analytics event', err);
    });
    this.trackPending(promise);
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }
}
