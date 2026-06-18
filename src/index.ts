#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  capture,
  captureMcpPageview,
  endMcpAnalyticsSession,
  ensureAnalyticsIdentity,
  identifyAnalyticsPerson,
  onMcpClientDisconnected,
  shutdownAnalytics,
  startMcpAnalyticsSession,
} from './analytics/index.js';
import type { McpShutdownReason } from './analytics/mcp-session.js';
import { PhotoshopMCPServer } from './core/server.js';
import { Logger } from './utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const logger = new Logger('Main');

let mcpServer: PhotoshopMCPServer | null = null;
let shuttingDown = false;

async function main() {
  try {
    logger.info('Starting Photoshop MCP Server...');

    ensureAnalyticsIdentity();

    mcpServer = new PhotoshopMCPServer({ serverVersion: PKG_VERSION });
    await mcpServer.start();

    const photoshopVersion = await mcpServer.getPhotoshopVersion();
    identifyAnalyticsPerson({
      usage_surface: 'mcp',
      app_version: PKG_VERSION,
      event_source: 'mcp',
      ...(photoshopVersion ? { photoshop_version: photoshopVersion } : {}),
    });

    startMcpAnalyticsSession();
    captureMcpPageview();
    capture('mcp_session_started', {
      app_version: PKG_VERSION,
      photoshop_detected: mcpServer.isPhotoshopConnected(),
      tools_registered_count: mcpServer.getToolCount(),
      event_source: 'mcp',
    });

    logger.info('Photoshop MCP Server is running');
  } catch (error) {
    logger.error('Failed to start server:', error);
    capture('mcp_session_startup_failed', {
      ok: false,
      error_code: 'startup_failed',
      event_source: 'mcp',
    });
    await shutdownAnalytics();
    process.exit(1);
  }
}

async function handleShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal}, shutting down`);

  const reason: McpShutdownReason =
    signal === 'SIGTERM'
      ? 'sigterm'
      : signal === 'stdio_closed'
        ? 'stdio_closed'
        : signal === 'SIGINT'
          ? 'sigint'
          : 'error';

  if (mcpServer) {
    await mcpServer.stop();
    mcpServer = null;
  }

  onMcpClientDisconnected();
  endMcpAnalyticsSession(reason);
  await shutdownAnalytics();
  process.exit(0);
}

process.on('SIGINT', () => {
  void handleShutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void handleShutdown('SIGTERM');
});

process.stdin.on('end', () => {
  void handleShutdown('stdio_closed');
});

main();
