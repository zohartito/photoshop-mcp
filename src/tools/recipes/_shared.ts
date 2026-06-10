import type { ToolResult } from '../../core/tool-registry.js';
import type { PhotoshopConnection } from '../../platform/connection.js';
import { PhotoshopAPIFactory } from '../../api/photoshop-api.js';
import { parseExtendScriptPayload } from '../../utils/extendscript-result.js';

export interface RecipeSuccess {
  ok: true;
  summary: string;
  created_layer_ids?: number[];
  output_paths?: string[];
  next_suggested_tool?: string;
  undo_history_states_consumed: number;
  details?: Record<string, unknown>;
}

export interface RecipeFailure {
  ok: false;
  code: string;
  message: string;
  suggested_next_tool?: string;
}

export function wrapInSuspendHistory(historyName: string, body: string): string {
  const escapedName = historyName.replace(/"/g, '\\"');
  return `
    if (app.documents.length === 0) {
      throw new Error('No active document');
    }
    var __mcp_recipe_doc = app.activeDocument;
    var __mcp_recipe_result = null;
    var __mcp_recipe_fn = function() {
      ${body}
    };
    __mcp_recipe_doc.suspendHistory(
      "${escapedName}",
      "try { __mcp_recipe_result = __mcp_recipe_fn(); } catch (eRecipe) { __mcp_recipe_result = { ok: false, code: 'recipe_runtime_error', message: eRecipe.message || String(eRecipe) }; }"
    );
    if (!__mcp_recipe_result) {
      __mcp_recipe_result = { ok: false, code: 'recipe_no_result', message: 'Recipe produced no result' };
    }
    return __mcp_recipe_result;
  `;
}

export function parseRecipeResult(raw: unknown): RecipeSuccess | RecipeFailure | null {
  const payload = parseExtendScriptPayload(raw);
  if (payload === null || typeof payload !== 'object') return null;
  const rec = payload as Record<string, unknown>;
  if (rec.ok === true) {
    return {
      ok: true,
      summary: typeof rec.summary === 'string' ? rec.summary : 'Recipe completed',
      created_layer_ids: Array.isArray(rec.created_layer_ids)
        ? (rec.created_layer_ids as number[])
        : undefined,
      output_paths: Array.isArray(rec.output_paths) ? (rec.output_paths as string[]) : undefined,
      next_suggested_tool:
        typeof rec.next_suggested_tool === 'string' ? rec.next_suggested_tool : undefined,
      undo_history_states_consumed:
        typeof rec.undo_history_states_consumed === 'number' ? rec.undo_history_states_consumed : 1,
      details:
        rec.details && typeof rec.details === 'object'
          ? (rec.details as Record<string, unknown>)
          : undefined,
    };
  }
  if (rec.ok === false) {
    return {
      ok: false,
      code: typeof rec.code === 'string' ? rec.code : 'recipe_unknown_error',
      message: typeof rec.message === 'string' ? rec.message : 'Unknown recipe error',
      suggested_next_tool:
        typeof rec.suggested_next_tool === 'string' ? rec.suggested_next_tool : undefined,
    };
  }
  return null;
}

export function toolSuccess(result: RecipeSuccess): ToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}

export function toolFailure(result: RecipeFailure): ToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    isError: true,
  };
}

export function toolException(error: unknown, code = 'recipe_exception'): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return toolFailure({ ok: false, code, message });
}

export async function executeRecipe(
  connection: PhotoshopConnection,
  historyName: string,
  body: string
): Promise<ToolResult> {
  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();
    const script = wrapInSuspendHistory(historyName, body);
    const raw = await api.executeScript(script);
    const parsed = parseRecipeResult(raw);
    if (!parsed) {
      return toolFailure({
        ok: false,
        code: 'recipe_no_result',
        message: `Recipe returned an unparseable payload: ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`,
      });
    }
    return parsed.ok ? toolSuccess(parsed) : toolFailure(parsed);
  } catch (error) {
    return toolException(error);
  }
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function jsString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
