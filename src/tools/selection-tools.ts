import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { TransportRouter } from '../transport/index.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopDetector } from '../platform/detector.js';
import {
  atomicFailure,
  atomicFailureFromError,
  atomicSuccess,
  layerIdFrom,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

export function createSelectionTools(transport: TransportRouter): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_select_rectangle',
        description:
          'Create a rectangular pixel selection from corner coordinates.\n\n' +
          'Use when: masking, cropping a region, or preparing for layer mask.\n' +
          'Do NOT use when: subject isolation is needed — use photoshop_recipe_remove_background.\n\n' +
          'Returns: selection bounds [left, top, right, bottom].\n' +
          'Preconditions: active document. Side effects: replaces current selection.',
        inputSchema: {
          type: 'object',
          properties: {
            left: {
              type: 'number',
              description: 'Left edge in pixels',
            },
            top: {
              type: 'number',
              description: 'Top edge in pixels',
            },
            right: {
              type: 'number',
              description: 'Right edge in pixels',
            },
            bottom: {
              type: 'number',
              description: 'Bottom edge in pixels',
            },
          },
          required: ['left', 'top', 'right', 'bottom'],
        },
      },
      handler: async (args) => selectRectangle(transport, args),
    },
    {
      tool: {
        name: 'photoshop_select_all',
        description: 'Select the entire document',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => selectAll(transport),
    },
    {
      tool: {
        name: 'photoshop_deselect',
        description: 'Deselect all selections',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => deselect(transport),
    },
    {
      tool: {
        name: 'photoshop_invert_selection',
        description: 'Invert the current selection',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => invertSelection(transport),
    },
    {
      tool: {
        name: 'photoshop_create_layer_mask',
        description:
          'Create a layer mask on the active layer (or the layer given by layerId) from the current selection (reveal selection).\n\n' +
          'Users often say: mask this, hide the background, non-destructive cutout (after selection).\n\n' +
          'Use when: non-destructive hide/show after a selection exists.\n' +
          'Do NOT use when: no selection exists — create selection first or use remove_background recipe.\n\n' +
          'Returns: maskCreated confirmation and the masked layerId.\n' +
          'Preconditions: active document and active selection. Side effects: adds mask to the targeted layer.',
        inputSchema: {
          type: 'object',
          properties: {
            layerId: {
              type: 'number',
              description:
                'Optional native layer id to mask instead of the active layer (from a prior tool result, e.g. duplicate_layer). Prevents masking the wrong layer.',
            },
          },
        },
      },
      handler: async (args) => createLayerMask(transport, args),
    },
    {
      tool: {
        name: 'photoshop_delete_layer_mask',
        description: 'Delete the layer mask from active layer',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => deleteLayerMask(transport),
    },
    {
      tool: {
        name: 'photoshop_apply_layer_mask',
        description: 'Apply (merge) the layer mask to the layer',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => applyLayerMask(transport),
    },
    {
      tool: {
        name: 'photoshop_select_subject',
        description:
          'Run Select Subject on the active layer (creates a pixel selection only, no mask).\n\n' +
          'Users often say: cut out, isolate subject, select person, select object.\n\n' +
          'Use when: you need a subject selection for masking, fill, or further edits.\n' +
          'Do NOT use when: full background removal with mask — use photoshop_recipe_remove_background.\n\n' +
          'Returns: JSON { ok, summary, details: { selected, method } }.\n' +
          'Preconditions: PS ≥ 23, active document, non-Background active layer with a recognizable subject.\n' +
          'Side effects: replaces current selection.',
        inputSchema: {
          type: 'object',
          properties: {
            sample_all_layers: {
              type: 'boolean',
              description: 'Sample all layers for autoCutout fallback (default false)',
              default: false,
            },
          },
        },
      },
      handler: async (args) => selectSubject(transport, args),
    },
    {
      tool: {
        name: 'photoshop_content_aware_fill',
        description:
          'Fill the current pixel selection using Content-Aware Fill.\n\n' +
          'Users often say: remove distraction, erase object, content aware fill, inpaint selection.\n\n' +
          'Use when: a rectangular or other selection covers the area to remove/replace.\n' +
          'Do NOT use when: no selection exists — use photoshop_select_rectangle first.\n' +
          'Do NOT use when: generative remove is requested — not scriptable; use this fill or manual touch-up.\n\n' +
          'Returns: JSON { ok, summary, details: { filled } }.\n' +
          'Preconditions: active document and active pixel selection.\n' +
          'Side effects: modifies pixels inside selection; deselects afterward.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => contentAwareFill(transport),
    },
  ];
}

async function selectRectangle(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const left = args.left as number;
  const top = args.top as number;
  const right = args.right as number;
  const bottom = args.bottom as number;

  try {
    const script = ExtendScriptSnippets.selectRectangle(left, top, right, bottom);
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Rectangular selection created: (${left}, ${top}) to (${right}, ${bottom})`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error creating selection: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function selectAll(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.selectAll();
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: 'All selected',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error selecting all: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function deselect(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.deselect();
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: 'Selection cleared',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error deselecting: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function invertSelection(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.invertSelection();
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: 'Selection inverted',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error inverting selection: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function createLayerMask(
  transport: TransportRouter,
  args: Record<string, unknown> = {}
): Promise<ToolResult> {
  const layerId = typeof args.layerId === 'number' ? args.layerId : undefined;

  try {
    const result = await transport.run({
      name: 'create_layer_mask',
      params: {
        script: ExtendScriptSnippets.createLayerMask(layerId),
        layerId,
      },
    });
    const maskedId = layerIdFrom(result);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer mask created from selection${maskedId !== undefined ? ` (layerId ${maskedId})` : ''}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error creating layer mask: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function deleteLayerMask(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.deleteLayerMask();
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: 'Layer mask deleted',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error deleting layer mask: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function applyLayerMask(transport: TransportRouter): Promise<ToolResult> {
  try {
    const script = ExtendScriptSnippets.applyLayerMask();
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: 'Layer mask applied (merged to layer)',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error applying layer mask: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function selectSubject(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const sampleAllLayers = args.sample_all_layers === true;

  await transport.ping().catch(() => undefined);
  const info = transport.getPhotoshopInfo();
  if (info) {
    const detector = new PhotoshopDetector();
    if (!detector.supportsSelectSubjectV2(info.version)) {
      return atomicFailure({
        ok: false,
        code: 'version_unsupported',
        message: `Select Subject v2 requires Photoshop 23.0+; detected version ${info.version}. Upgrade Photoshop or select manually.`,
        suggested_next_tool: 'photoshop_get_capabilities',
      });
    }
  }

  try {
    const raw = await runSnippet(transport, ExtendScriptSnippets.selectSubject(sampleAllLayers));
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Snippet returned unparseable payload: ${String(raw)}`));
    }

    const method = typeof parsed.method === 'string' ? parsed.method : 'selectSubject';
    return atomicSuccess(`Subject selected via ${method}`, parsed);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function contentAwareFill(transport: TransportRouter): Promise<ToolResult> {
  try {
    const raw = await runSnippet(transport, ExtendScriptSnippets.contentAwareFill());
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Snippet returned unparseable payload: ${String(raw)}`));
    }

    return atomicSuccess('Content-aware fill applied', parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/selection_required/i.test(message)) {
      return atomicFailure({
        ok: false,
        code: 'selection_required',
        message: 'Active pixel selection required before content-aware fill',
        suggested_next_tool: 'photoshop_select_rectangle',
      });
    }
    return atomicFailureFromError(error);
  }
}
