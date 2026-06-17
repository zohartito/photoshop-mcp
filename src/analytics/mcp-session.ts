import { hasPostHogKey } from './config.js';
import { buildRuntimeProperties } from './events.js';
import { isAnalyticsEnabled } from './identity.js';
import { captureMcpPageleave } from './pageview.js';
import { getAnalytics } from './provider.js';

export type McpShutdownReason = 'sigint' | 'sigterm' | 'error' | 'stdio_closed';
export type McpToolBatchFlushReason = 'idle' | 'shutdown';

/** Flush batched tool usage after this idle gap (proxy for end of an agent turn). */
const IDLE_FLUSH_MS = 30_000;
const MAX_SUMMARY_LENGTH = 4_000;

interface ToolBatchEntry {
  ok: number;
  fail: number;
  errors: Map<string, number>;
  durationMs: number;
}

let startedAt: number | null = null;
let toolBatch = new Map<string, ToolBatchEntry>();
let idleFlushTimer: ReturnType<typeof setTimeout> | null = null;

function captureMcpEvent(
  name: string,
  properties: Record<string, unknown>
): void {
  if (!isAnalyticsEnabled() || !hasPostHogKey()) return;
  getAnalytics().capture({
    name,
    properties: buildRuntimeProperties(properties),
  });
}

function clearIdleFlushTimer(): void {
  if (!idleFlushTimer) return;
  clearTimeout(idleFlushTimer);
  idleFlushTimer = null;
}

function formatUsageSummary(batch: Map<string, ToolBatchEntry>): string {
  const parts = [...batch.entries()]
    .sort((a, b) => b[1].ok + b[1].fail - (a[1].ok + a[1].fail))
    .map(([name, entry]) => `${name}:${entry.ok + entry.fail}`);

  let summary = parts.join(',');
  if (summary.length > MAX_SUMMARY_LENGTH) {
    summary = `${summary.slice(0, MAX_SUMMARY_LENGTH)}…`;
  }
  return summary;
}

function formatErrorCodesSummary(batch: Map<string, ToolBatchEntry>): string | undefined {
  const totals = new Map<string, number>();
  for (const entry of batch.values()) {
    for (const [code, count] of entry.errors) {
      totals.set(code, (totals.get(code) ?? 0) + count);
    }
  }
  if (totals.size === 0) return undefined;

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => `${code}:${count}`)
    .join(',');
}

export function flushMcpToolBatch(reason: McpToolBatchFlushReason): void {
  if (toolBatch.size === 0) return;

  let toolsCalledCount = 0;
  let toolsErrorCount = 0;
  let totalDurationMs = 0;

  for (const entry of toolBatch.values()) {
    toolsCalledCount += entry.ok + entry.fail;
    toolsErrorCount += entry.fail;
    totalDurationMs += entry.durationMs;
  }

  const errorCodesSummary = formatErrorCodesSummary(toolBatch);

  captureMcpEvent('mcp_tool_batch', {
    tools_called_count: toolsCalledCount,
    tools_error_count: toolsErrorCount,
    unique_tools_count: toolBatch.size,
    tool_usage_summary: formatUsageSummary(toolBatch),
    ...(errorCodesSummary ? { error_codes_summary: errorCodesSummary } : {}),
    batch_flush_reason: reason,
    duration_ms: totalDurationMs,
    event_source: 'mcp',
  });

  toolBatch.clear();
  clearIdleFlushTimer();
}

function scheduleIdleFlush(): void {
  clearIdleFlushTimer();
  idleFlushTimer = setTimeout(() => {
    idleFlushTimer = null;
    flushMcpToolBatch('idle');
  }, IDLE_FLUSH_MS);
}

export function startMcpAnalyticsSession(): void {
  startedAt = Date.now();
}

export function recordMcpToolCall(params: {
  toolName: string;
  ok: boolean;
  errorCode?: string;
  durationMs: number;
}): void {
  const existing = toolBatch.get(params.toolName) ?? {
    ok: 0,
    fail: 0,
    errors: new Map<string, number>(),
    durationMs: 0,
  };

  if (params.ok) {
    existing.ok += 1;
  } else {
    existing.fail += 1;
    if (params.errorCode) {
      existing.errors.set(
        params.errorCode,
        (existing.errors.get(params.errorCode) ?? 0) + 1
      );
    }
  }
  existing.durationMs += params.durationMs;
  toolBatch.set(params.toolName, existing);

  scheduleIdleFlush();
}

export function endMcpAnalyticsSession(reason: McpShutdownReason): void {
  flushMcpToolBatch('shutdown');

  const durationMs = startedAt !== null ? Date.now() - startedAt : 0;
  captureMcpPageleave(durationMs, reason);
  captureMcpEvent('mcp_session_ended', {
    duration_ms: durationMs,
    shutdown_reason: reason,
    event_source: 'mcp',
  });

  startedAt = null;
  toolBatch.clear();
  clearIdleFlushTimer();
}
