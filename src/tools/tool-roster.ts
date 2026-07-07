/**
 * Single source of truth for the create*Tools factory roster.
 *
 * Both the MCP server (src/core/server.ts) and headless batch mode
 * (src/tools/batch-tools.ts, the CLI batch subcommand) need the *same* set of
 * tool handlers keyed by tool name. Batch recipe steps reuse the real tool
 * handlers rather than reimplementing any command (transport-layer.md §8: batch
 * sits ABOVE the transport and drives the existing tool layer). Keeping the
 * roster here means adding a tool wires it into both surfaces from one place.
 */
import type { ToolDefinition } from '../core/tool-registry.js';
import type { TransportRouter } from '../transport/index.js';

import { createDocumentTools } from './document-tools.js';
import { createLayerTools } from './layer-tools.js';
import { createImageTools } from './image-tools.js';
import { createImagePlacementTools } from './image-placement-tools.js';
import { createLayerTransformTools } from './layer-transform-tools.js';
import { createLayerPropertiesTools } from './layer-properties-tools.js';
import { createFilterTools } from './filter-tools.js';
import { createFilterGalleryTools } from './filter-gallery-tools.js';
import { createTransformExtraTools } from './transform-extra-tools.js';
import { createAdjustmentTools } from './adjustment-tools.js';
import { createAdjustmentLayerTools } from './adjustment-layer-tools.js';
import { createTextTools } from './text-tools.js';
import { createLayerStyleTools } from './layer-style-tools.js';
import { createSmartObjectTools } from './smart-object-tools.js';
import { createSelectionTools } from './selection-tools.js';
import { createMaskTools } from './mask-tools.js';
import { createActionTools } from './action-tools.js';
import { createHistoryTools } from './history-tools.js';
import { createLayerOrderingTools } from './layer-ordering-tools.js';
import { createStateTools } from './state-tools.js';
import { createGenerativeTools } from './generative-tools.js';
import { createNeuralTools } from './neural-tools.js';
import { createRecipeTools } from './recipes/index.js';
import { createHeavyFilterTools } from './heavy-filter-tools.js';
import { createFillPaintTools } from './fill-paint-tools.js';
import { createChannelPathTools } from './channel-path-tools.js';

/**
 * Build every command tool definition over one transport router. Order matches
 * the historical server registration order so tool listing is unchanged. Does
 * NOT include the two session-level meta tools (`photoshop_ping`,
 * `photoshop_get_version`) or `photoshop_batch_run` itself — those are server /
 * batch concerns, not command tools a recipe step would call.
 */
export function buildCommandToolDefinitions(transport: TransportRouter): ToolDefinition[] {
  return [
    ...createDocumentTools(transport),
    ...createLayerTools(transport),
    ...createImageTools(transport),
    ...createImagePlacementTools(transport),
    ...createLayerTransformTools(transport),
    ...createLayerPropertiesTools(transport),
    ...createFilterTools(transport),
    ...createFilterGalleryTools(transport),
    ...createTransformExtraTools(transport),
    ...createAdjustmentTools(transport),
    ...createAdjustmentLayerTools(transport),
    ...createTextTools(transport),
    ...createLayerStyleTools(transport),
    ...createSmartObjectTools(transport),
    ...createSelectionTools(transport),
    ...createMaskTools(transport),
    ...createActionTools(transport),
    ...createHistoryTools(transport),
    ...createLayerOrderingTools(transport),
    ...createStateTools(transport),
    ...createGenerativeTools(transport),
    ...createNeuralTools(transport),
    ...createRecipeTools(transport),
    ...createHeavyFilterTools(transport),
    ...createFillPaintTools(transport),
    ...createChannelPathTools(transport),
  ];
}
