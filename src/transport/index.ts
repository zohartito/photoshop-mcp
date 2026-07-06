/**
 * Transport layer public surface (docs/design/transport-layer.md §4).
 * Tools import TransportRouter; the concrete backends and contracts are here too.
 */
export { TransportRouter } from './router.js';
export type { TransportPreference } from './router.js';
export { ExtendScriptTransport } from './extendscript-transport.js';
export { UxpTransport } from './uxp-transport.js';
export type {
  CommandMeta,
  PhotoshopTransport,
  PsCommand,
  TransportCapabilities,
  TransportId,
} from './types.js';
