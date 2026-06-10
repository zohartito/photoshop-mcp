import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import { stepCountIs, streamText, type LanguageModelUsage, type ModelMessage } from 'ai';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelPricing, ProviderAdapter, UsageCost } from './providers/registry.js';
import { buildPhotoshopInstructions } from '../prompts/instructions.js';
import { PHOTOSHOP_EXPORT_CHAT_ID_ENV } from '../lib/export-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In production (`dist/ui/agent.js`) we point at the compiled `dist/index.js`.
// In development (`tsx watch src/ui/cli.ts`) the source `.ts` is loaded directly,
// so we resolve the TS entry and spawn it through Node's tsx loader.
const IS_DEV_SOURCE = __filename.endsWith('.ts');
const PHOTOSHOP_MCP_ENTRY = IS_DEV_SOURCE
  ? resolve(__dirname, '..', 'index.ts')
  : resolve(__dirname, '..', 'index.js');

export interface ToolCallPersist {
  id: string;
  name: string;
  input: unknown;
  result?: { ok: boolean; content: string };
  status: 'pending' | 'success' | 'error';
}

export interface AssistantBuffer {
  text: string;
  toolCalls: ToolCallPersist[];
}

export interface RunChatStreamEvent {
  type: 'text-delta' | 'tool-call' | 'tool-result' | 'finish' | 'error';
  payload: unknown;
}

export interface RunChatFinishInfo {
  usage: LanguageModelUsage;
  cost?: UsageCost;
}

export interface RunChatOptions {
  prompt: string;
  history: ModelMessage[];
  provider: ProviderAdapter;
  apiKey: string;
  modelId: string;
  chatId?: string;
  abortSignal: AbortSignal;
  onAssistantBuffer?: (buf: AssistantBuffer) => void;
  onFinish?: (info: RunChatFinishInfo) => void;
}

export const PHOTOSHOP_SYSTEM_PROMPT = `
You are an assistant that controls Adobe Photoshop on the user's machine through
the photoshop-mcp server. Use photoshop_* tools and photoshop_recipe_* recipes
to fulfill requests: open documents, manage layers, place images, apply filters,
write text, save files, and run multi-step workflows.

${buildPhotoshopInstructions()}

Additional UI constraints:
- After meaningful state changes, briefly describe in plain language what you did.
- If a tool call fails, surface the error envelope to the user and follow
  suggested_next_tool when present before asking the user to retry.
- Only Photoshop MCP tools are available. Do not attempt shell, filesystem,
  web, or general coding operations; respond in natural language instead.
`.trim();

export async function* runChat(opts: RunChatOptions): AsyncGenerator<RunChatStreamEvent> {
  let mcp: MCPClient | undefined;
  const buffer: AssistantBuffer = { text: '', toolCalls: [] };

  try {
    const spawnArgs = IS_DEV_SOURCE
      ? ['--import', 'tsx', PHOTOSHOP_MCP_ENTRY]
      : [PHOTOSHOP_MCP_ENTRY];
    mcp = await createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command: process.execPath,
        args: spawnArgs,
        env: {
          ...sanitizedEnv(),
          LOG_LEVEL: process.env.LOG_LEVEL ?? '2',
          ...(opts.chatId ? { [PHOTOSHOP_EXPORT_CHAT_ID_ENV]: opts.chatId } : {}),
        },
      }),
    });

    const tools = await mcp.tools();

    const result = streamText({
      model: opts.provider.getLanguageModel({
        apiKey: opts.apiKey,
        modelId: opts.modelId,
      }),
      tools,
      system: PHOTOSHOP_SYSTEM_PROMPT,
      messages: [...opts.history, { role: 'user', content: opts.prompt }],
      stopWhen: stepCountIs(20),
      abortSignal: opts.abortSignal,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta': {
          buffer.text += part.text;
          yield { type: 'text-delta', payload: { text: part.text } };
          opts.onAssistantBuffer?.(buffer);
          break;
        }
        case 'tool-call': {
          const tc: ToolCallPersist = {
            id: part.toolCallId,
            name: part.toolName,
            input: part.input,
            status: 'pending',
          };
          buffer.toolCalls.push(tc);
          yield {
            type: 'tool-call',
            payload: { id: tc.id, name: tc.name, input: tc.input },
          };
          opts.onAssistantBuffer?.(buffer);
          break;
        }
        case 'tool-result': {
          const tc = buffer.toolCalls.find((c) => c.id === part.toolCallId);
          const text = stringifyToolOutput(part.output);
          if (tc) {
            tc.result = { ok: true, content: text };
            tc.status = 'success';
          }
          yield {
            type: 'tool-result',
            payload: { id: part.toolCallId, ok: true, content: text },
          };
          opts.onAssistantBuffer?.(buffer);
          break;
        }
        case 'tool-error': {
          const tc = buffer.toolCalls.find((c) => c.id === part.toolCallId);
          const text = (part.error as Error)?.message ?? String(part.error);
          if (tc) {
            tc.result = { ok: false, content: text };
            tc.status = 'error';
          }
          yield {
            type: 'tool-result',
            payload: { id: part.toolCallId, ok: false, content: text },
          };
          opts.onAssistantBuffer?.(buffer);
          break;
        }
        case 'finish': {
          const usage = part.totalUsage;
          const pricing = opts.provider.getModelPricing(opts.modelId);
          const cost = pricing ? computeCost(usage, pricing) : undefined;
          opts.onFinish?.({ usage, cost });
          yield {
            type: 'finish',
            payload: { finishReason: part.finishReason, usage, cost },
          };
          break;
        }
        case 'error': {
          yield {
            type: 'error',
            payload: { message: (part.error as Error)?.message ?? String(part.error) },
          };
          break;
        }
        default:
          break;
      }
    }
  } finally {
    if (mcp) await mcp.close().catch(() => undefined);
  }
}

export function computeCost(usage: LanguageModelUsage, pricing: ModelPricing): UsageCost {
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  // Prefer the explicit non-cache count when the provider reports it; otherwise
  // derive it from the total minus cache buckets so we don't double-bill.
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

function stringifyToolOutput(output: unknown): string {
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

function sanitizedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function buildHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: { text: string } }>
): ModelMessage[] {
  // Persisted history is rebuilt as plain text turns. Tool-call traces are
  // intentionally not replayed, since their results are already reflected in
  // the assistant's prior response text and re-issuing them would duplicate work.
  const history: ModelMessage[] = [];
  for (const m of messages) {
    const text = m.content.text?.trim();
    if (!text) continue;
    history.push({ role: m.role, content: text });
  }
  return history;
}
