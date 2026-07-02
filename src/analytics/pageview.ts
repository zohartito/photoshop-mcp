import { hasAnalyticsKey } from './config.js';
import { buildRuntimeProperties } from './events.js';
import { isAnalyticsEnabled } from './identity.js';
import { getAnalytics } from './provider.js';

const MCP_VIRTUAL_URL = 'photoshop-mcp://mcp';

function capturePageEvent(
  name: string,
  properties: Record<string, unknown>
): void {
  if (!isAnalyticsEnabled() || !hasAnalyticsKey()) return;
  getAnalytics().capture({
    name,
    properties: buildRuntimeProperties(properties),
  });
}

export function captureMcpPageview(): void {
  capturePageEvent('$pageview', {
    $current_url: MCP_VIRTUAL_URL,
    $pathname: '/mcp',
    usage_surface: 'mcp',
    event_source: 'mcp',
  });
}

export function captureMcpPageleave(durationMs: number, reason: string): void {
  capturePageEvent('$pageleave', {
    $current_url: MCP_VIRTUAL_URL,
    duration_ms: durationMs,
    shutdown_reason: reason,
    usage_surface: 'mcp',
    event_source: 'mcp',
  });
}
