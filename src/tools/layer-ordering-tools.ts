import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { TransportRouter } from '../transport/index.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';

export function createLayerOrderingTools(transport: TransportRouter): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_move_layer_to_position',
        description: 'Move the active layer relative to another layer',
        inputSchema: {
          type: 'object',
          properties: {
            targetLayerName: {
              type: 'string',
              description: 'Name of the layer to move relative to',
            },
            position: {
              type: 'string',
              description: 'Position relative to target layer',
              enum: ['ABOVE', 'BELOW', 'TOP', 'BOTTOM'],
            },
          },
          required: ['targetLayerName', 'position'],
        },
      },
      handler: async (args) => moveLayerToPosition(transport, args),
    },
    {
      tool: {
        name: 'photoshop_move_layer_to_top',
        description: 'Move the active layer to the top of the layer stack',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => moveLayerToTop(transport),
    },
    {
      tool: {
        name: 'photoshop_move_layer_to_bottom',
        description: 'Move the active layer to the bottom of the layer stack',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => moveLayerToBottom(transport),
    },
    {
      tool: {
        name: 'photoshop_move_layer_up',
        description: 'Move the active layer up one position in the layer stack',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => moveLayerUp(transport),
    },
    {
      tool: {
        name: 'photoshop_move_layer_down',
        description: 'Move the active layer down one position in the layer stack',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => moveLayerDown(transport),
    },
  ];
}

async function moveLayerToPosition(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const targetLayerName = args.targetLayerName as string;
  const position = args.position as string;

  try {
    const script = ExtendScriptSnippets.moveLayerToPosition(targetLayerName, position);
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer moved ${position} "${targetLayerName}"\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error moving layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function moveLayerToTop(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.moveLayerToTop();
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer moved to top\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error moving layer to top: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function moveLayerToBottom(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.moveLayerToBottom();
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer moved to bottom\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error moving layer to bottom: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function moveLayerUp(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.moveLayerUp();
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer moved up\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error moving layer up: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function moveLayerDown(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.moveLayerDown();
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer moved down\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error moving layer down: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
