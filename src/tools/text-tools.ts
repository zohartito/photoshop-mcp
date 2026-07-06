import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { TransportRouter } from '../transport/index.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';

export function createTextTools(transport: TransportRouter): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_list_fonts',
        description:
          'List installed fonts available to Photoshop.\n\n' +
          'Use when: choosing a font for photoshop_create_text_layer or photoshop_set_text_font.\n' +
          'TextItem.font requires the PostScript name — use postScriptName from results, or pass display name to set/create tools (they resolve automatically).\n\n' +
          'Returns: fonts array ({ name, postScriptName, family, style }), total count, truncated flag.\n' +
          'First call may be slow (app.fonts.length can exceed 1000). Side effects: none.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Optional substring filter (matches name, postScriptName, or family)',
            },
            limit: {
              type: 'number',
              description: 'Maximum fonts to return (default: 200)',
              default: 200,
              minimum: 1,
              maximum: 1000,
            },
          },
        },
      },
      handler: async (args) => listFonts(transport, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_font',
        description:
          'Set font family and size for active text layer.\n\n' +
          'Accepts display name (e.g. "Arial") or PostScript name (e.g. "ArialMT") — resolved via app.fonts.\n' +
          'Use photoshop_list_fonts to discover available fonts.',
        inputSchema: {
          type: 'object',
          properties: {
            fontName: {
              type: 'string',
              description: 'Font display or PostScript name (see photoshop_list_fonts)',
            },
            fontSize: {
              type: 'number',
              description: 'Font size in points (optional)',
              minimum: 1,
            },
          },
          required: ['fontName'],
        },
      },
      handler: async (args) => setTextFont(transport, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_color',
        description: 'Set color for active text layer',
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
      handler: async (args) => setTextColor(transport, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_alignment',
        description: 'Set text alignment for active text layer',
        inputSchema: {
          type: 'object',
          properties: {
            alignment: {
              type: 'string',
              description: 'Text alignment',
              enum: ['LEFT', 'CENTER', 'RIGHT', 'LEFTJUSTIFIED', 'CENTERJUSTIFIED', 'RIGHTJUSTIFIED', 'FULLYJUSTIFIED'],
            },
          },
          required: ['alignment'],
        },
      },
      handler: async (args) => setTextAlignment(transport, args),
    },
    {
      tool: {
        name: 'photoshop_update_text_content',
        description: 'Update the text content of active text layer',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'New text content',
            },
          },
          required: ['text'],
        },
      },
      handler: async (args) => updateTextContent(transport, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_tracking',
        description:
          'Set character tracking (letter-spacing) on the active text layer.\n\n' +
          'Users often say: tighten the letters, add letter spacing, track it out.\n' +
          'Tracking is in 1/1000 em (Photoshop units): 0 = default, positive = looser, negative = tighter.\n\n' +
          'Guard: active layer must be a text layer (clear error otherwise).\n' +
          'Returns: { ok, summary, details: { tracking } }.',
        inputSchema: {
          type: 'object',
          properties: {
            tracking: {
              type: 'number',
              description: 'Tracking in 1/1000 em (-1000..10000)',
              minimum: -1000,
              maximum: 10000,
            },
          },
          required: ['tracking'],
        },
      },
      handler: async (args) => setTextTracking(transport, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_leading',
        description:
          'Set leading (line spacing) in points on the active text layer, or enable auto-leading.\n\n' +
          'Users often say: change the line spacing, tighten the lines, set leading.\n' +
          'Pass auto=true for Photoshop auto-leading; otherwise pass leading (points). Only meaningful on multi-line text.\n\n' +
          'Guard: active layer must be a text layer (clear error otherwise).\n' +
          'Returns: { ok, summary, details: { autoLeading, leading } }.',
        inputSchema: {
          type: 'object',
          properties: {
            leading: {
              type: 'number',
              description: 'Leading in points (ignored when auto=true)',
              minimum: 0,
            },
            auto: {
              type: 'boolean',
              description: 'Enable auto-leading instead of a fixed value (default false)',
              default: false,
            },
          },
        },
      },
      handler: async (args) => setTextLeading(transport, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_kerning',
        description:
          'Set the kerning mode on the active text layer: metrics, optical, or manual.\n\n' +
          'Users often say: fix the kerning, use optical kerning, turn kerning off.\n' +
          '- metrics: use the font\'s built-in kerning pairs\n' +
          '- optical: let Photoshop kern by glyph shape\n' +
          '- manual: turn auto-kerning off (per-pair manual kerning applies)\n\n' +
          'Guard: active layer must be a text layer (clear error otherwise).\n' +
          'Returns: { ok, summary, details: { kerning, autoKerning } }.',
        inputSchema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              description: 'Kerning mode',
              enum: ['metrics', 'optical', 'manual'],
            },
          },
          required: ['mode'],
        },
      },
      handler: async (args) => setTextKerning(transport, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_case',
        description:
          'Set letter case (allCaps / smallCaps / normal) and/or toggle faux bold / faux italic on the active text layer.\n\n' +
          'Users often say: make it all caps, small caps, bold it, italicize (no bold/italic font variant needed — these are the faux styles).\n' +
          'Every field is optional; only the fields you pass are changed. Case does not alter the underlying characters, only their display.\n\n' +
          'Guard: active layer must be a text layer (clear error otherwise).\n' +
          'Returns: { ok, summary, details: { capitalization, fauxBold, fauxItalic } }.',
        inputSchema: {
          type: 'object',
          properties: {
            case: {
              type: 'string',
              description: 'Letter case display mode',
              enum: ['allCaps', 'smallCaps', 'normal'],
            },
            fauxBold: {
              type: 'boolean',
              description: 'Toggle faux bold (synthetic bold, no bold font needed)',
            },
            fauxItalic: {
              type: 'boolean',
              description: 'Toggle faux italic (synthetic slant, no italic font needed)',
            },
          },
        },
      },
      handler: async (args) => setTextCase(transport, args),
    },
    {
      tool: {
        name: 'photoshop_warp_text',
        description:
          'Warp the active text layer with a preset warp style, or remove the warp.\n\n' +
          'Users often say: arc the text, make it wave, bulge/flag/fisheye the title.\n' +
          'Style "none" removes any existing warp. bend, horizontalDistortion, and verticalDistortion are -100..100 (percent, matching the Warp Text dialog); ignored when style is "none".\n\n' +
          'Guard: active layer must be a text layer (clear error otherwise).\n' +
          'Returns: { ok, summary, details: { warpStyle, warpBend, warpHorizontalDistortion, warpVerticalDistortion } }.',
        inputSchema: {
          type: 'object',
          properties: {
            style: {
              type: 'string',
              description: 'Warp style',
              enum: [
                'none',
                'arc',
                'arcLower',
                'arcUpper',
                'arch',
                'bulge',
                'flag',
                'wave',
                'fish',
                'rise',
                'fisheye',
                'inflate',
                'squeeze',
                'twist',
              ],
            },
            bend: {
              type: 'number',
              description: 'Bend amount -100..100 (percent). Default 50.',
              minimum: -100,
              maximum: 100,
              default: 50,
            },
            horizontalDistortion: {
              type: 'number',
              description: 'Horizontal distortion -100..100 (percent). Default 0.',
              minimum: -100,
              maximum: 100,
              default: 0,
            },
            verticalDistortion: {
              type: 'number',
              description: 'Vertical distortion -100..100 (percent). Default 0.',
              minimum: -100,
              maximum: 100,
              default: 0,
            },
          },
          required: ['style'],
        },
      },
      handler: async (args) => warpText(transport, args),
    },
  ];
}

/** Warp-style token -> ExtendScript WarpStyle enum member. */
const WARP_STYLE_ENUM: Record<string, string> = {
  none: 'NONE',
  arc: 'ARC',
  arcLower: 'ARCLOWER',
  arcUpper: 'ARCUPPER',
  arch: 'ARCH',
  bulge: 'BULGE',
  flag: 'FLAG',
  wave: 'WAVE',
  fish: 'FISH',
  rise: 'RISE',
  fisheye: 'FISHEYE',
  inflate: 'INFLATE',
  squeeze: 'SQUEEZE',
  twist: 'TWIST',
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

async function listFonts(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const query = args.query as string | undefined;
  const limit = (args.limit as number | undefined) ?? 200;

  try {
    const script = ExtendScriptSnippets.listFonts(query, limit);
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ok: true, summary: `Fonts listed${query ? ` (query: "${query}")` : ''}`, details: result }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error listing fonts: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setTextFont(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const fontName = args.fontName as string;
  const fontSize = args.fontSize as number | undefined;

  try {
    const script = ExtendScriptSnippets.setTextFont(fontName, fontSize);
    const result = await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ok: true, summary: `Text font set to ${fontName}${fontSize ? `, size ${fontSize}pt` : ''}`, details: result }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting text font: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setTextColor(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const red = args.red as number;
  const green = args.green as number;
  const blue = args.blue as number;

  try {
    const script = ExtendScriptSnippets.setTextColor(red, green, blue);
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Text color set to RGB(${red}, ${green}, ${blue})`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting text color: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setTextAlignment(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const alignment = args.alignment as string;

  try {
    const script = ExtendScriptSnippets.setTextAlignment(alignment);
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Text alignment set to ${alignment}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting text alignment: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function updateTextContent(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const text = args.text as string;

  try {
    const script = ExtendScriptSnippets.updateTextContent(text);
    await transport.runScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Text content updated to: "${text}"`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error updating text content: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setTextTracking(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const tracking = clampNumber(args.tracking, -1000, 10000, 0);

  try {
    const script = ExtendScriptSnippets.setTextTracking(tracking);
    const result = await transport.runScript(script);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { ok: true, summary: `Text tracking set to ${tracking}`, details: result },
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
          text: `Error setting text tracking: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setTextLeading(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const auto = args.auto === true;
  const leading = auto ? undefined : clampNumber(args.leading, 0, 5000, 0);

  if (!auto && (typeof args.leading !== 'number' || !Number.isFinite(args.leading))) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: false,
              code: 'missing_leading',
              message: 'Provide leading (points) or set auto=true.',
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  try {
    const script = ExtendScriptSnippets.setTextLeading(leading, auto);
    const result = await transport.runScript(script);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: true,
              summary: auto ? 'Text leading set to auto' : `Text leading set to ${leading}pt`,
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
          text: `Error setting text leading: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setTextKerning(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const mode = args.mode;
  if (mode !== 'metrics' && mode !== 'optical' && mode !== 'manual') {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: false,
              code: 'invalid_kerning_mode',
              message: "mode must be one of: metrics, optical, manual.",
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  try {
    const script = ExtendScriptSnippets.setTextKerning(mode);
    const result = await transport.runScript(script);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { ok: true, summary: `Text kerning set to ${mode}`, details: result },
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
          text: `Error setting text kerning: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setTextCase(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const caseArg = args.case;
  const caseMode =
    caseArg === 'allCaps' || caseArg === 'smallCaps' || caseArg === 'normal' ? caseArg : undefined;
  const fauxBold = typeof args.fauxBold === 'boolean' ? args.fauxBold : undefined;
  const fauxItalic = typeof args.fauxItalic === 'boolean' ? args.fauxItalic : undefined;

  if (caseMode === undefined && fauxBold === undefined && fauxItalic === undefined) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: false,
              code: 'no_case_change',
              message: 'Provide at least one of: case, fauxBold, fauxItalic.',
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  try {
    const script = ExtendScriptSnippets.setTextCase(caseMode, fauxBold, fauxItalic);
    const result = await transport.runScript(script);
    const parts: string[] = [];
    if (caseMode !== undefined) parts.push(`case ${caseMode}`);
    if (fauxBold !== undefined) parts.push(`faux bold ${fauxBold ? 'on' : 'off'}`);
    if (fauxItalic !== undefined) parts.push(`faux italic ${fauxItalic ? 'on' : 'off'}`);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { ok: true, summary: `Text style updated: ${parts.join(', ')}`, details: result },
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
          text: `Error setting text case: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function warpText(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const styleToken = String(args.style ?? '');
  const styleEnum = WARP_STYLE_ENUM[styleToken];
  if (!styleEnum) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: false,
              code: 'invalid_warp_style',
              message: `Unknown warp style "${styleToken}". Valid: ${Object.keys(WARP_STYLE_ENUM).join(', ')}.`,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
  const bend = clampNumber(args.bend, -100, 100, 50);
  const horizontalDistortion = clampNumber(args.horizontalDistortion, -100, 100, 0);
  const verticalDistortion = clampNumber(args.verticalDistortion, -100, 100, 0);

  try {
    const script = ExtendScriptSnippets.warpText(
      styleEnum,
      bend,
      horizontalDistortion,
      verticalDistortion
    );
    const result = await transport.runScript(script);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: true,
              summary:
                styleToken === 'none'
                  ? 'Text warp removed'
                  : `Text warped: ${styleToken} (bend ${bend})`,
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
          text: `Error warping text: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
