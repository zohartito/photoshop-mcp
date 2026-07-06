import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { TransportRouter } from '../transport/index.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { layerIdFrom } from './atomic-shared.js';

export function createLayerPropertiesTools(transport: TransportRouter): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_rasterize_layer',
        description: 'Rasterize the active layer (convert text/smart object to normal layer)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => rasterizeLayer(transport),
    },
    {
      tool: {
        name: 'photoshop_set_layer_opacity',
        description: 'Set the opacity of the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            opacity: {
              type: 'number',
              description: 'Opacity value (0-100)',
              minimum: 0,
              maximum: 100,
            },
            layerId: {
              type: 'number',
              description:
                'Optional native layer id to target instead of the active layer (from a prior tool result). Prevents editing the wrong layer after duplicate/select.',
            },
          },
          required: ['opacity'],
        },
      },
      handler: async (args) => setLayerOpacity(transport, args),
    },
    {
      tool: {
        name: 'photoshop_set_layer_blend_mode',
        description: 'Set the blend mode of the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            layerId: {
              type: 'number',
              description:
                'Optional native layer id to target instead of the active layer (from a prior tool result).',
            },
            blendMode: {
              type: 'string',
              description: 'Blend mode name',
              enum: [
                'NORMAL',
                'DISSOLVE',
                'DARKEN',
                'MULTIPLY',
                'COLORBURN',
                'LINEARBURN',
                'DARKERCOLOR',
                'LIGHTEN',
                'SCREEN',
                'COLORDODGE',
                'LINEARDODGE',
                'LIGHTERCOLOR',
                'OVERLAY',
                'SOFTLIGHT',
                'HARDLIGHT',
                'VIVIDLIGHT',
                'LINEARLIGHT',
                'PINLIGHT',
                'HARDMIX',
                'DIFFERENCE',
                'EXCLUSION',
                'SUBTRACT',
                'DIVIDE',
                'HUE',
                'SATURATION',
                'COLOR',
                'LUMINOSITY',
              ],
            },
          },
          required: ['blendMode'],
        },
      },
      handler: async (args) => setLayerBlendMode(transport, args),
    },
    {
      tool: {
        name: 'photoshop_set_layer_visibility',
        description: 'Show or hide the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            visible: {
              type: 'boolean',
              description: 'Whether the layer should be visible',
            },
          },
          required: ['visible'],
        },
      },
      handler: async (args) => setLayerVisibility(transport, args),
    },
    {
      tool: {
        name: 'photoshop_set_layer_locked',
        description: 'Lock or unlock the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            locked: {
              type: 'boolean',
              description: 'Whether the layer should be locked',
            },
          },
          required: ['locked'],
        },
      },
      handler: async (args) => setLayerLocked(transport, args),
    },
    {
      tool: {
        name: 'photoshop_rename_layer',
        description: 'Rename the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'New name for the layer',
            },
          },
          required: ['name'],
        },
      },
      handler: async (args) => renameLayer(transport, args),
    },
    {
      tool: {
        name: 'photoshop_duplicate_layer',
        description:
          'Duplicate the active layer (or the layer given by layerId). Returns the new layer id.',
        inputSchema: {
          type: 'object',
          properties: {
            newName: {
              type: 'string',
              description: 'Name for the duplicated layer (optional)',
            },
            layerId: {
              type: 'number',
              description:
                'Optional native layer id to duplicate instead of the active layer (from a prior tool result).',
            },
          },
        },
      },
      handler: async (args) => duplicateLayer(transport, args),
    },
    {
      tool: {
        name: 'photoshop_merge_visible_layers',
        description: 'Merge all visible layers into one',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => mergeVisibleLayers(transport),
    },
    {
      tool: {
        name: 'photoshop_flatten_image',
        description: 'Flatten all layers into a single background layer',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => flattenImage(transport),
    },
  ];
}

async function setLayerOpacity(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const opacity = args.opacity as number;
  const layerId = typeof args.layerId === 'number' ? args.layerId : undefined;

  try {
    const result = await transport.run({
      name: 'set_layer_properties',
      params: {
        script: ExtendScriptSnippets.setLayerOpacity(opacity, layerId),
        layerId,
        opacity,
      },
    });
    const affectedId = layerIdFrom(result);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer opacity set to ${opacity}%${affectedId !== undefined ? ` (layerId ${affectedId})` : ''}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting layer opacity: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setLayerBlendMode(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const blendMode = args.blendMode as string;
  const layerId = typeof args.layerId === 'number' ? args.layerId : undefined;

  try {
    const result = await transport.run({
      name: 'set_layer_properties',
      params: {
        script: ExtendScriptSnippets.setLayerBlendMode(blendMode, layerId),
        layerId,
        blendMode,
      },
    });
    const affectedId = layerIdFrom(result);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer blend mode set to ${blendMode}${affectedId !== undefined ? ` (layerId ${affectedId})` : ''}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting blend mode: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setLayerVisibility(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const visible = args.visible as boolean;

  try {
    const script = ExtendScriptSnippets.setLayerVisibility(visible);
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer ${visible ? 'shown' : 'hidden'}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting layer visibility: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setLayerLocked(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const locked = args.locked as boolean;

  try {
    const script = ExtendScriptSnippets.setLayerLocked(locked);
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer ${locked ? 'locked' : 'unlocked'}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error locking/unlocking layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function renameLayer(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = args.name as string;

  try {
    const script = ExtendScriptSnippets.renameLayer(name);
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ok: true, summary: `Layer renamed to: ${name}`, details: result }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error renaming layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function duplicateLayer(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const newName = args.newName as string | undefined;
  const layerId = typeof args.layerId === 'number' ? args.layerId : undefined;

  try {
    const result = await transport.run({
      name: 'duplicate_layer',
      params: {
        script: ExtendScriptSnippets.duplicateLayer(newName, layerId),
        layerId,
        newName,
      },
    });
    // §6.8: the new layer's id is the affected-id the contract requires — surface
    // it at the top level so a follow-up mask/select can bind to the copy.
    const newLayerId = layerIdFrom(result);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { ok: true, summary: `Layer duplicated`, layerId: newLayerId, details: result },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error duplicating layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function mergeVisibleLayers(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.mergeVisibleLayers();
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: 'All visible layers merged',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error merging visible layers: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function flattenImage(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.flattenImage();
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: 'Image flattened (all layers merged to background)',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error flattening image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function rasterizeLayer(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.rasterizeLayer();
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ok: true, summary: `Layer rasterized`, details: result }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error rasterizing layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
