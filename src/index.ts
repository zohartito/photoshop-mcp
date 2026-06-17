#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, shutdownAnalytics } from './analytics/index.js';
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

async function main() {
  try {
    logger.info('Starting Photoshop MCP Server...');

    const server = new PhotoshopMCPServer();
    await server.start();

    capture('mcp_server_started', {
      app_version: PKG_VERSION,
      photoshop_detected: server.isPhotoshopConnected(),
      event_source: 'mcp',
    });

    logger.info('Photoshop MCP Server is running');
  } catch (error) {
    logger.error('Failed to start server:', error);
    await shutdownAnalytics();
    process.exit(1);
  }
}

async function handleShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down`);
  await shutdownAnalytics();
  process.exit(0);
}

process.on('SIGINT', () => {
  void handleShutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void handleShutdown('SIGTERM');
});

main();
