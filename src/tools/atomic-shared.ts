import { ToolResult } from '../core/tool-registry.js';
import { TransportRouter } from '../transport/index.js';
import { classifyError, type PhotoshopErrorEnvelope } from '../errors/envelope.js';
import { parseExtendScriptPayload } from '../utils/extendscript-result.js';

export interface AtomicSuccess {
  ok: true;
  summary: string;
  details?: Record<string, unknown>;
  next_suggested_tool?: string;
}

export async function runSnippet(
  transport: TransportRouter,
  script: string
): Promise<unknown> {
  return transport.runScript(script);
}

export function parseSnippetResult(raw: unknown): Record<string, unknown> | null {
  const payload = parseExtendScriptPayload(raw);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

/**
 * §6.8 target-identity read-back: pull the affected `layerId` out of a transport
 * result. Works on both backends — the ExtendScript snippets and the UXP
 * normalizers both surface `layerId` as a top-level number — so a tool can report
 * (and a chain can reuse) the id of the layer it actually touched. Returns
 * undefined when absent (e.g. a PS build where layer.id was unreadable → null).
 */
export function layerIdFrom(result: unknown): number | undefined {
  const payload = parseSnippetResult(result);
  const id = payload?.layerId;
  return typeof id === 'number' ? id : undefined;
}

export function atomicSuccess(
  summary: string,
  details?: Record<string, unknown>,
  nextSuggestedTool = 'photoshop_get_preview'
): ToolResult {
  const body: AtomicSuccess = {
    ok: true,
    summary,
    ...(details ? { details } : {}),
    next_suggested_tool: nextSuggestedTool,
  };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
  };
}

export function atomicFailure(envelope: PhotoshopErrorEnvelope): ToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
    isError: true,
  };
}

export function atomicFailureFromError(
  error: unknown,
  overrides?: Partial<Pick<PhotoshopErrorEnvelope, 'code' | 'message' | 'suggested_next_tool'>>
): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const base = classifyError(message);
  return atomicFailure({
    ...base,
    ...overrides,
    message: overrides?.message ?? base.message,
  });
}
