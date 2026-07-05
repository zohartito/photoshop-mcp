import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { TransportRouter } from '../transport/index.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';

export function createImagePlacementTools(transport: TransportRouter): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_place_image',
        description:
          'Place an external image file as a new layer in the active document.\n\n' +
          'Use when: compositing assets into an open document at a specific offset.\n' +
          'Do NOT use when: opening a file as a new document — use photoshop_open_image.\n\n' +
          'Returns: placed layer name, bounds, and context.\n' +
          'Preconditions: active document; file must exist. Side effects: adds a new layer.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Full path to the image file (JPEG, PNG, PSD, etc.)',
            },
            x: {
              type: 'number',
              description: 'X position offset in pixels (default: 0)',
              default: 0,
            },
            y: {
              type: 'number',
              description: 'Y position offset in pixels (default: 0)',
              default: 0,
            },
          },
          required: ['filePath'],
        },
      },
      handler: async (args) => placeImage(transport, args),
    },
    {
      tool: {
        name: 'photoshop_open_image',
        description:
          'Open an image file as a new Photoshop document.\n\n' +
          'Use when: user provides a file path to edit or no document is open yet.\n' +
          'Do NOT use when: adding to an existing composite — use photoshop_place_image.\n\n' +
          'Returns: document id, name, width, height.\n' +
          'Preconditions: file must exist on disk. Side effects: opens document as active.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Full path to the image file',
            },
          },
          required: ['filePath'],
        },
      },
      handler: async (args) => openImage(transport, args),
    },
  ];
}

async function placeImage(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const filePath = args.filePath as string;
  const x = (args.x as number) || 0;
  const y = (args.y as number) || 0;

  try {
    const script = ExtendScriptSnippets.placeImage(filePath, x, y);
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Image placed successfully: ${filePath}\nPosition: (${x}, ${y})\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error placing image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function openImage(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const filePath = args.filePath as string;

  try {
    const script = ExtendScriptSnippets.openImage(filePath);
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Image opened as new document: ${filePath}\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error opening image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
