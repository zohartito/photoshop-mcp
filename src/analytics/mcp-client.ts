import { hasAnalyticsKey } from './config.js';
import { buildPersonIdentifyProperties, buildRuntimeProperties } from './events.js';
import { isAnalyticsEnabled, recordUsageSurface } from './identity.js';
import {
  clearActiveMcpClient,
  getActiveMcpClient,
  hasActiveMcpClient,
  setActiveMcpClient,
} from './mcp-client-state.js';
import { flushMcpToolBatchOnClientDisconnect } from './mcp-session.js';
import { flushAnalyticsClient, getAnalytics } from './provider.js';

let clientConnectCount = 0;

function captureMcpClientEvent(
  name: string,
  properties: Record<string, unknown>
): void {
  if (!isAnalyticsEnabled() || !hasAnalyticsKey()) return;
  getAnalytics().capture({
    name,
    properties: buildRuntimeProperties(properties),
  });
}

function identifyMcpClientPerson(properties: Record<string, unknown>): void {
  if (!isAnalyticsEnabled() || !hasAnalyticsKey()) return;
  const props = { ...properties };
  if (typeof props.usage_surface === 'string') {
    props.usage_surfaces = recordUsageSurface(props.usage_surface);
    delete props.usage_surface;
  }
  getAnalytics().identify(buildPersonIdentifyProperties(props));
}

/**
 * Fires when an MCP client completes the initialize handshake.
 * See docs/anonymous-usage-analytics.md — distinguishes real client usage from process-only starts.
 */
export function onMcpClientConnected(
  client: { name: string; version: string } | undefined
): void {
  clientConnectCount += 1;
  setActiveMcpClient(client);

  captureMcpClientEvent('mcp_client_connected', {
    mcp_client_name: client?.name ?? 'unknown',
    mcp_client_version: client?.version ?? 'unknown',
    mcp_client_connect_count: clientConnectCount,
    event_source: 'mcp',
  });

  identifyMcpClientPerson({
    usage_surface: 'mcp',
    mcp_client_name: client?.name ?? 'unknown',
    mcp_client_version: client?.version ?? 'unknown',
    last_active_at: Date.now(),
  });
}

/** Fires when the MCP transport closes; flushes any pending tool batch first. */
export function onMcpClientDisconnected(): void {
  if (!hasActiveMcpClient()) return;

  const client = getActiveMcpClient();
  flushMcpToolBatchOnClientDisconnect();

  captureMcpClientEvent('mcp_client_disconnected', {
    ...(client.name ? { mcp_client_name: client.name } : {}),
    ...(client.version ? { mcp_client_version: client.version } : {}),
    event_source: 'mcp',
  });

  clearActiveMcpClient();
  void flushAnalyticsClient().catch(() => {});
}
