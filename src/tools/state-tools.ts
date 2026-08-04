import { constants } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { TransportRouter } from '../transport/index.js';
import { resolvePhotoshopCapabilities } from '../platform/capabilities.js';
import { envelopeToToolResult, classifyError } from '../errors/envelope.js';
import { parseExtendScriptPayload } from '../utils/extendscript-result.js';
import { MAX_PREVIEW_DIMENSION_PX, validateIntegerInRange } from './resource-limits.js';

const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

async function readPreviewWithLimit(path: string, limit: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) {
      throw new Error(
        `Preview exceeds ${limit} byte limit (${info.size} bytes). Lower max_dimension_px or quality.`
      );
    }
    return await new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const stream = handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 });
      stream.on('data', (chunk: string | Buffer) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > limit) {
          stream.destroy(new Error(`Preview exceeds ${limit} byte limit while reading.`));
          return;
        }
        chunks.push(bytes);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks, size)));
    });
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function runScript(transport: TransportRouter, script: string): Promise<unknown> {
  return transport.runScript(script);
}

export function createStateTools(transport: TransportRouter): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_get_state',
        description:
          'Return a cheap read-only snapshot of Photoshop session state (active document, layer, selection).\n\n' +
          'Use when: before any tool that needs an active document/layer, or after an error to recover context.\n' +
          'Do NOT use when: you only need a visual preview — use photoshop_get_preview instead.\n\n' +
          'Returns: JSON with hasDocument, document dimensions/colorMode, activeLayer kind/name, hasSelection.\n' +
          'Preconditions: none (safe on empty session). Side effects: none.',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => getState(transport),
    },
    {
      tool: {
        name: 'photoshop_get_preview',
        description:
          'Export the active document as a base64 JPEG preview for visual verification.\n\n' +
          'Use when: after visual edits to confirm result before reporting success to the user.\n' +
          'Do NOT use when: you only need numeric state — use photoshop_get_state (much cheaper).\n\n' +
          'Returns: MCP image content block (JPEG) plus metadata text.\n' +
          'Preconditions: active document required. Side effects: creates and deletes a temp file; does not modify the document.',
        inputSchema: {
          type: 'object',
          properties: {
            max_dimension_px: {
              type: 'number',
              description: 'Maximum long edge in pixels (default 1024)',
              default: 1024,
              maximum: MAX_PREVIEW_DIMENSION_PX,
            },
            quality: {
              type: 'number',
              description: 'JPEG quality 1–12 (default 8)',
              minimum: 1,
              maximum: 12,
              default: 8,
            },
          },
        },
      },
      handler: async (args) => getPreview(transport, args),
    },
    {
      tool: {
        name: 'photoshop_get_capabilities',
        description:
          'Return version-aware feature flags for the installed Photoshop (Select Subject v2, Generative Fill, etc.).\n\n' +
          'Use when: once per session before suggesting AI-powered features or gated recipes.\n' +
          'Do NOT use when: Photoshop version is already known from photoshop_get_version.\n\n' +
          'Returns: JSON { version, features: { select_subject_v2, generative_fill, ... } }.\n' +
          'Preconditions: none. Side effects: none.',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => getCapabilities(transport),
    },
  ];
}

async function getState(transport: TransportRouter): Promise<ToolResult> {
  try {
    const raw = await transport.run({
      name: 'get_state',
      params: { script: ExtendScriptSnippets.getState() },
    });
    const result = parseExtendScriptPayload(raw);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return envelopeToToolResult(
      classifyError(error instanceof Error ? error.message : String(error))
    );
  }
}

async function getPreview(
  transport: TransportRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const maxDimension = args.max_dimension_px === undefined ? 1024 : args.max_dimension_px;
  const quality = args.quality === undefined ? 8 : args.quality;

  let tempDir: string | undefined;
  let tempPath: string | undefined;

  if (
    typeof maxDimension !== 'number' ||
    !Number.isInteger(maxDimension) ||
    maxDimension < 1 ||
    maxDimension > MAX_PREVIEW_DIMENSION_PX
  ) {
    return envelopeToToolResult(
      classifyError(`max_dimension_px must be an integer from 1 to ${MAX_PREVIEW_DIMENSION_PX}.`)
    );
  }
  const qualityError = validateIntegerInRange(quality, 1, 12, 'quality');
  if (qualityError) {
    return envelopeToToolResult(classifyError(qualityError));
  }

  try {
    tempDir = await mkdtemp(join(tmpdir(), 'photoshop-mcp-preview-'));
    tempPath = join(tempDir, 'preview.jpg');
    const result = (await runScript(
      transport,
      ExtendScriptSnippets.exportPreview(maxDimension, quality as number, tempPath)
    )) as { path: string; width: number; height: number; mimeType: string };

    if (result.path !== tempPath) {
      throw new Error('Photoshop preview returned an unexpected output path.');
    }
    const buffer = await readPreviewWithLimit(tempPath, PREVIEW_MAX_BYTES);

    const base64 = buffer.toString('base64');

    return {
      content: [
        {
          type: 'image',
          data: base64,
          mimeType: result.mimeType || 'image/jpeg',
        },
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              width: result.width,
              height: result.height,
              bytes: buffer.byteLength,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return envelopeToToolResult(
      classifyError(error instanceof Error ? error.message : String(error))
    );
  } finally {
    if (tempDir) {
      // The directory was freshly created by this process. Removing it after
      // closing the only descriptor cannot unlink an attacker-selected path.
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function getCapabilities(transport: TransportRouter): Promise<ToolResult> {
  try {
    const version = await transport.getVersion();
    const capabilities = await resolvePhotoshopCapabilities(version);
    return {
      content: [{ type: 'text', text: JSON.stringify(capabilities, null, 2) }],
    };
  } catch (error) {
    return envelopeToToolResult(
      classifyError(error instanceof Error ? error.message : String(error))
    );
  }
}
