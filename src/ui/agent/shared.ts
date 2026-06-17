import type { ModelMessage } from 'ai';
import type { ModelPricing, UsageCost } from '../providers/registry.js';

export type { UsageCost };
import type { LanguageModelUsage } from 'ai';

export interface ToolCallPersist {
  id: string;
  name: string;
  input: unknown;
  result?: { ok: boolean; content: string };
  status: 'pending' | 'success' | 'error';
}

export type PlanStepStatus = 'pending' | 'running' | 'done' | 'error';

export interface PlanStepView {
  id: string;
  tool: string;
  rationale?: string;
  status: PlanStepStatus;
}

export interface PlanView {
  summary: string;
  steps: PlanStepView[];
}

export type StreamActivityPhase = 'planning' | 'thinking' | 'tool-running';

export interface StreamActivityPayload {
  phase: StreamActivityPhase;
  detail?: string;
}

export interface AssistantBuffer {
  text: string;
  toolCalls: ToolCallPersist[];
  reasoning?: string;
  /** Present only for Action Plan (beta) runs; persisted so it survives reload. */
  plan?: PlanView;
}

export interface RunChatStreamEvent {
  type:
    | 'text-delta'
    | 'reasoning-delta'
    | 'activity'
    | 'tool-call'
    | 'tool-result'
    | 'finish'
    | 'error'
    | 'plan'
    | 'plan-partial'
    | 'plan-step'
    | 'plan-repair';
  payload: unknown;
}

export interface RunChatFinishInfo {
  usage: LanguageModelUsage;
  cost?: UsageCost;
}

export function stringifyToolOutput(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  if (typeof output === 'object' && output !== null && 'content' in output) {
    const content = (output as { content?: Array<{ type?: string; text?: string }> }).content;
    if (Array.isArray(content)) {
      return content
        .map((c) => (typeof c === 'string' ? c : c?.text ?? ''))
        .filter(Boolean)
        .join('\n');
    }
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

/** Parse structured tool envelopes from raw MCP / SDK output. */
export function parseToolEnvelope(output: unknown): Record<string, unknown> | null {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    if ('content' in output) {
      const text = stringifyToolOutput(output);
      try {
        const fromText = JSON.parse(text) as unknown;
        if (fromText && typeof fromText === 'object' && !Array.isArray(fromText)) {
          return fromText as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
    return output as Record<string, unknown>;
  }
  if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether a tool output represents success (not an error envelope or MCP error flag). */
export function isToolOutputOk(output: unknown): boolean {
  if (output == null) return true;

  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>;
    if (obj.is_error === true || obj.isError === true) return false;
    if ('error' in obj && obj.error) return false;
    if (obj.ok === false) return false;

    const envelope = parseToolEnvelope(output);
    if (envelope?.ok === false) return false;
  }

  if (typeof output === 'string') {
    const envelope = parseToolEnvelope(output);
    if (envelope?.ok === false) return false;
  }

  return true;
}

/** Prefer envelope `message` for repair / error display. */
export function toolFailureMessage(output: unknown, fallback: string): string {
  const envelope = parseToolEnvelope(output);
  if (envelope && envelope.ok === false && typeof envelope.message === 'string') {
    return envelope.message;
  }
  return fallback;
}

export function computeCost(usage: LanguageModelUsage, pricing: ModelPricing): UsageCost {
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const totalInput = usage.inputTokens ?? 0;
  const noCache =
    usage.inputTokenDetails?.noCacheTokens ??
    Math.max(0, totalInput - cacheRead - cacheWrite);
  const output = usage.outputTokens ?? 0;

  const inputUsd = (noCache / 1_000_000) * pricing.inputUsdPerMTok;
  const outputUsd = (output / 1_000_000) * pricing.outputUsdPerMTok;
  const cachedReadUsd =
    (cacheRead / 1_000_000) * (pricing.cachedInputUsdPerMTok ?? pricing.inputUsdPerMTok);
  const cachedWriteUsd =
    (cacheWrite / 1_000_000) * (pricing.cachedWriteUsdPerMTok ?? pricing.inputUsdPerMTok);

  return {
    totalUsd: inputUsd + outputUsd + cachedReadUsd + cachedWriteUsd,
    inputUsd,
    outputUsd,
    cachedReadUsd,
    cachedWriteUsd,
  };
}

export function buildPromptWithHistory(history: ModelMessage[], prompt: string): string {
  const parts: string[] = [];
  for (const m of history) {
    const text =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .map((part) => ('text' in part ? part.text : ''))
              .filter(Boolean)
              .join('\n')
          : '';
    const trimmed = text.trim();
    if (!trimmed) continue;
    parts.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${trimmed}`);
  }
  parts.push(`User: ${prompt}`);
  return parts.join('\n\n');
}
