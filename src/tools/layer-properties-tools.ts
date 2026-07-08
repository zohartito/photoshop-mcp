import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { TransportRouter } from '../transport/index.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';

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
        name: 'photoshop_rename_layers_batch',
        description:
          'Rename multiple layers in one call, each targeted by exact current name.\n\n' +
          'Use when: renaming several layers at once — one call instead of repeated photoshop_rename_layer.\n' +
          'Do NOT use when: renaming only the active layer — use photoshop_rename_layer.\n\n' +
          'Returns: renamedCount, renamed [{from, to}], notFound (names with no match — reported, not an error).\n' +
          'First depth-first name match wins when duplicate names exist in different groups.\n' +
          'Preconditions: active document. Side effects: adds history steps for renamed layers.',
        inputSchema: {
          type: 'object',
          properties: {
            renames: {
              type: 'array',
              description: 'Renames to apply, in order',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  from: {
                    type: 'string',
                    description: 'Exact current layer name (case-sensitive)',
                  },
                  to: {
                    type: 'string',
                    description: 'New name for the layer',
                  },
                },
                required: ['from', 'to'],
              },
            },
          },
          required: ['renames'],
        },
      },
      handler: async (args) => renameLayersBatch(transport, args),
    },
    {
      tool: {
        name: 'photoshop_duplicate_layer',
        description: 'Duplicate the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            newName: {
              type: 'string',
              description: 'Name for the duplicated layer (optional)',
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

  try {
    const script = ExtendScriptSnippets.setLayerOpacity(opacity);
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer opacity set to ${opacity}%`,
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

  try {
    const script = ExtendScriptSnippets.setLayerBlendMode(blendMode);
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer blend mode set to ${blendMode}`,
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

async function renameLayersBatch(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const renames = (args.renames ?? []) as Array<{ from: string; to: string }>;

  try {
    const result = await transport.run({
      name: 'rename_layers_batch',
      params: { script: ExtendScriptSnippets.renameLayersBatch(renames), renames },
    });

    const renamedCount = (result as { renamedCount?: number } | null)?.renamedCount ?? 0;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: true,
              summary: `Renamed ${renamedCount} of ${renames.length} layer(s)`,
              details: result,
            },
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
          text: `Error renaming layers: ${error instanceof Error ? error.message : String(error)}`,
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

  try {
    const script = ExtendScriptSnippets.duplicateLayer(newName);
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ok: true, summary: `Layer duplicated`, details: result }, null, 2),
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
