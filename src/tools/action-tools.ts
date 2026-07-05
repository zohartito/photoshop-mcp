import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { TransportRouter } from '../transport/index.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';

export function createActionTools(transport: TransportRouter): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_play_action',
        description: 'Play a recorded action from the Actions palette',
        inputSchema: {
          type: 'object',
          properties: {
            actionName: {
              type: 'string',
              description: 'Name of the action to play',
            },
            actionSetName: {
              type: 'string',
              description: 'Name of the action set containing the action',
            },
          },
          required: ['actionName', 'actionSetName'],
        },
      },
      handler: async (args) => playAction(transport, args),
    },
    {
      tool: {
        name: 'photoshop_execute_script',
        description:
          'Execute custom ExtendScript (JSX) code inside Photoshop (advanced escape hatch).\n\n' +
          'Use when: no existing tool covers the operation and you can write safe JSX.\n' +
          'Do NOT use when: a recipe or atomic tool exists — prefer photoshop_recipe_* or photoshop_* tools.\n\n' +
          'Returns: script return value serialized as text/JSON.\n' +
          'IMPORTANT: Your code runs inside a wrapping IIFE. Use an explicit `return` to pass data back — ' +
          'a bare trailing expression returns undefined. Example: `return { ok: true };` ' +
          'Objects are serialized with toSource() and parsed automatically on macOS and Windows.\n' +
          'Preconditions: valid ExtendScript; active document if script expects one. Side effects: depends on code.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'ExtendScript code to execute',
            },
          },
          required: ['code'],
        },
      },
      handler: async (args) => executeCustomScript(transport, args),
    },
  ];
}

async function playAction(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const actionName = args.actionName as string;
  const actionSetName = args.actionSetName as string;

  try {
    const script = ExtendScriptSnippets.playAction(actionName, actionSetName);
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Action played: "${actionName}" from set "${actionSetName}"`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error playing action: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function executeCustomScript(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const code = args.code as string;

  try {
    const script = ExtendScriptSnippets.executeCustomScript(code);
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ok: true, summary: `Custom script executed`, details: result }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error executing custom script: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
