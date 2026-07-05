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
