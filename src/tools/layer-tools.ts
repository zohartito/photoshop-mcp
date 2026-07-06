import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { TransportRouter } from '../transport/index.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { layerIdFrom } from './atomic-shared.js';

export function createLayerTools(transport: TransportRouter): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_create_layer',
        description:
          'Create a new empty layer above the active layer.\n\n' +
          'Use when: user needs a blank layer for painting, fills, or stacking content.\n' +
          'Do NOT use when: adding text — use photoshop_create_text_layer.\n\n' +
          'Returns: created layer name and context.\n' +
          'Preconditions: active document. Side effects: adds layer to history.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name for the new layer (optional)',
            },
          },
        },
      },
      handler: async (args) => createLayer(transport, args),
    },
    {
      tool: {
        name: 'photoshop_delete_layer',
        description: 'Delete the active layer',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => deleteLayer(transport),
    },
    {
      tool: {
        name: 'photoshop_create_text_layer',
        description:
          'Create a text layer with content, position, font size, and optional font.\n\n' +
          'Use when: adding labels, titles, or typography to the design.\n' +
          'Do NOT use when: editing existing text — use photoshop_update_text_content.\n\n' +
          'Returns: layer name, text, position, final bounds, fontSize, font/color (when set), context.\n' +
          'Use photoshop_list_fonts to discover font names; photoshop_set_text_font to change font later.\n' +
          'Tip: pass center to place the text on the canvas without guessing x/y; pass red/green/blue to color it in one call.\n' +
          'Preconditions: active document. Side effects: adds text layer.',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text content',
            },
            x: {
              type: 'number',
              description: 'X position in pixels (default: 100). Ignored on an axis that center covers.',
              default: 100,
            },
            y: {
              type: 'number',
              description: 'Y position in pixels (default: 100). Ignored on an axis that center covers.',
              default: 100,
            },
            fontSize: {
              type: 'number',
              description: 'Font size in points (default: 24)',
              default: 24,
            },
            fontName: {
              type: 'string',
              description:
                'Optional font display or PostScript name (resolved via app.fonts; see photoshop_list_fonts)',
            },
            center: {
              type: 'string',
              description:
                'Optional. Center the text layer on the canvas: "horizontal", "vertical", or "both". Overrides x/y on the centered axis.',
              enum: ['horizontal', 'vertical', 'both'],
            },
            red: {
              type: 'number',
              description: 'Optional text color red (0-255). Provide red, green, and blue together to color at creation.',
              minimum: 0,
              maximum: 255,
            },
            green: {
              type: 'number',
              description: 'Optional text color green (0-255)',
              minimum: 0,
              maximum: 255,
            },
            blue: {
              type: 'number',
              description: 'Optional text color blue (0-255)',
              minimum: 0,
              maximum: 255,
            },
          },
          required: ['text'],
        },
      },
      handler: async (args) => createTextLayer(transport, args),
    },
    {
      tool: {
        name: 'photoshop_fill_layer',
        description: 'Fill the active layer with a color',
        inputSchema: {
          type: 'object',
          properties: {
            red: {
              type: 'number',
              description: 'Red component (0-255)',
              minimum: 0,
              maximum: 255,
            },
            green: {
              type: 'number',
              description: 'Green component (0-255)',
              minimum: 0,
              maximum: 255,
            },
            blue: {
              type: 'number',
              description: 'Blue component (0-255)',
              minimum: 0,
              maximum: 255,
            },
          },
          required: ['red', 'green', 'blue'],
        },
      },
      handler: async (args) => fillLayer(transport, args),
    },
    {
      tool: {
        name: 'photoshop_get_layers',
        description:
          'List all layers in the active document with kind, visibility, and opacity.\n\n' +
          'Use when: choosing a layer to edit, debugging structure, or after organize_layers.\n' +
          'Do NOT use when: only session summary is needed — use photoshop_get_state (lighter).\n\n' +
          'Returns: layerCount, layers array, context.\n' +
          'Preconditions: active document. Side effects: none.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => getLayers(transport),
    },
    {
      tool: {
        name: 'photoshop_select_layer_by_name',
        description:
          'Select the active layer by exact name, including layers inside groups.\n\n' +
          'Use when: a transform or property tool must target a named layer (photoshop_scale_layer, etc.).\n' +
          'Do NOT use when: the layer is already active — check photoshop_get_state first.\n\n' +
          'Returns: selected, layerName, kind, bounds (best-effort), context.\n' +
          'First depth-first name match wins when duplicate names exist in different groups.\n' +
          'Preconditions: active document. Side effects: changes active layer.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Exact layer name (case-sensitive)',
            },
            layerId: {
              type: 'number',
              description:
                'Optional native layer id to select instead of searching by name (from a prior tool result, e.g. duplicate_layer). When set, name is ignored.',
            },
          },
          required: ['name'],
        },
      },
      handler: async (args) => selectLayerByName(transport, args),
    },
  ];
}

async function createLayer(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = args.name as string | undefined;

  try {
    const script = ExtendScriptSnippets.newLayer(name);
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer created${name ? `: ${name}` : ''}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error creating layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function deleteLayer(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.deleteLayer();
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: 'Layer deleted successfully',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error deleting layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function createTextLayer(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const text = args.text as string;
  const x = (args.x as number) || 100;
  const y = (args.y as number) || 100;
  const fontSize = (args.fontSize as number) || 24;
  const fontName = args.fontName as string | undefined;
  const center = args.center as 'horizontal' | 'vertical' | 'both' | undefined;
  const color =
    typeof args.red === 'number' &&
    typeof args.green === 'number' &&
    typeof args.blue === 'number'
      ? { red: args.red as number, green: args.green as number, blue: args.blue as number }
      : undefined;

  try {
    const script = ExtendScriptSnippets.createTextLayer(
      text,
      x,
      y,
      fontSize,
      fontName,
      center,
      color
    );
    const result = await transport.runScript(script);

    const where = center ? `centered (${center})` : `at (${x}, ${y})`;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: true,
              summary: `Text layer created: "${text}" ${where}${fontName ? ` with font ${fontName}` : ''}${color ? ` in RGB(${color.red}, ${color.green}, ${color.blue})` : ''}`,
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
          text: `Error creating text layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function fillLayer(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const red = args.red as number;
  const green = args.green as number;
  const blue = args.blue as number;

  try {
    const script = ExtendScriptSnippets.fillLayer(red, green, blue);
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer filled with RGB(${red}, ${green}, ${blue})`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error filling layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function getLayers(transport: TransportRouter): Promise<ToolResult> {
  try {
    const result = await transport.run({
      name: 'get_layers',
      params: { script: ExtendScriptSnippets.getLayerNames() },
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layers:\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error getting layers: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function selectLayerByName(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = args.name as string;
  const layerId = typeof args.layerId === 'number' ? args.layerId : undefined;

  try {
    const result = await transport.run({
      name: 'select_layer',
      params: {
        script: ExtendScriptSnippets.selectLayerByName(name, layerId),
        layerId,
      },
    });
    const affectedId = layerIdFrom(result);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer selected${affectedId !== undefined ? ` (layerId ${affectedId})` : ''}:\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error selecting layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
