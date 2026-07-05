import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { TransportRouter } from '../transport/index.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';

export function createHistoryTools(transport: TransportRouter): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_undo',
        description: 'Undo the last operation(s) - equivalent to Ctrl/Cmd+Z',
        inputSchema: {
          type: 'object',
          properties: {
            steps: {
              type: 'number',
              description: 'Number of steps to undo (default: 1)',
              minimum: 1,
              default: 1,
            },
          },
        },
      },
      handler: async (args) => undo(transport, args),
    },
    {
      tool: {
        name: 'photoshop_redo',
        description: 'Redo the previously undone operation(s) - equivalent to Ctrl/Cmd+Shift+Z',
        inputSchema: {
          type: 'object',
          properties: {
            steps: {
              type: 'number',
              description: 'Number of steps to redo (default: 1)',
              minimum: 1,
              default: 1,
            },
          },
        },
      },
      handler: async (args) => redo(transport, args),
    },
    {
      tool: {
        name: 'photoshop_get_history',
        description: 'Get the history states of the active document',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => getHistory(transport),
    },
  ];
}

async function undo(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const steps = (args.steps as number) || 1;

  try {
    const script = ExtendScriptSnippets.undo(steps);
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ok: true, summary: `Undo successful (${steps} step${steps > 1 ? 's' : ''})`, details: result }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error undoing: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function redo(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const steps = (args.steps as number) || 1;

  try {
    const script = ExtendScriptSnippets.redo(steps);
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ok: true, summary: `Redo successful (${steps} step${steps > 1 ? 's' : ''})`, details: result }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error redoing: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function getHistory(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.getHistoryStates();
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `History States:\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error getting history: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
