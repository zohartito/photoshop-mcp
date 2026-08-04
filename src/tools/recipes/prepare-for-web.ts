import { ToolDefinition, ToolResult } from '../../core/tool-registry.js';
import type { TransportRouter } from '../../transport/index.js';
import { toolFailure } from './_shared.js';

const TOOL_NAME = 'photoshop_recipe_prepare_for_web';

export function bindPrepareForWeb(transport: TransportRouter): ToolDefinition {
  return {
    tool: {
      name: TOOL_NAME,
      description:
        'This recipe is security-disabled pending an atomic, user-authorized Photoshop export capability.\n' +
        '\n' +
        'Use when: the user wants a shareable JPEG/PNG sized for the web from the current artwork.\n' +
        'Do NOT use while disabled; no export is performed.\n' +
        '\n' +
        'Returns: a feature-disabled error envelope.\n' +
        '\n' +
        'Preconditions: none. Side effects: none while disabled.',
      inputSchema: { type: 'object', properties: {} },
    },
    handler: async (args) => runPrepareForWeb(transport, args),
  };
}

async function runPrepareForWeb(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  void transport;
  void args;
  return toolFailure({
    ok: false,
    code: 'feature_disabled',
    message:
      'Prepare-for-web is security-disabled pending an atomic, user-authorized Photoshop export capability.',
  });
}
