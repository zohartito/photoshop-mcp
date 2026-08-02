import { query, type Options as ClaudeQueryOptions } from '@anthropic-ai/claude-agent-sdk';
import type { ModelMessage } from 'ai';
import type { ProviderAdapter } from '../providers/registry.js';
import {
  buildClaudeAccountSecurityOptions,
  createCliAccountWorkspace,
  type CliAccountWorkspace,
} from './cli-account-security.js';
import { buildMcpServerConfig } from './mcp-transport.js';
import {
  buildPromptWithHistory,
  isToolOutputOk,
  stringifyToolOutput,
  type AssistantBuffer,
  type RunChatFinishInfo,
  type RunChatStreamEvent,
} from './shared.js';

export interface RunChatViaClaudeAccountOptions {
  prompt: string;
  history: ModelMessage[];
  provider: ProviderAdapter;
  modelId: string;
  chatId?: string;
  systemPrompt: string;
  abortSignal: AbortSignal;
  onAssistantBuffer?: (buf: AssistantBuffer) => void;
  onFinish?: (info: RunChatFinishInfo) => void;
}

export async function createClaudeAccountWorkspace(): Promise<CliAccountWorkspace> {
  return createCliAccountWorkspace('claude-account');
}

export function buildClaudeAccountQueryOptions({
  modelId,
  systemPrompt,
  chatId,
  workspaceDir,
  abortController,
}: {
  modelId: string;
  systemPrompt: string;
  chatId?: string;
  workspaceDir: string;
  abortController: AbortController;
}): ClaudeQueryOptions {
  return {
    model: modelId,
    systemPrompt,
    maxTurns: 20,
    abortController,
    ...buildClaudeAccountSecurityOptions({
      workspaceDir,
      photoshopMcpServer: buildMcpServerConfig(chatId),
    }),
  };
}

export async function* runChatViaClaudeAccount(
  opts: RunChatViaClaudeAccountOptions
): AsyncGenerator<RunChatStreamEvent> {
  const buffer: AssistantBuffer = { text: '', toolCalls: [] };
  const seenToolCalls = new Set<string>();
  const seenToolResults = new Set<string>();
  const abortController = new AbortController();
  let sawStreamText = false;
  let emittedThinking = false;
  const workspace = await createClaudeAccountWorkspace();
  const onAbort = () => abortController.abort();
  let q: ReturnType<typeof query> | undefined;
  let listeningForAbort = false;

  try {
    opts.abortSignal.addEventListener('abort', onAbort);
    listeningForAbort = true;
    const prompt = buildPromptWithHistory(opts.history, opts.prompt);

    q = query({
      prompt,
      options: buildClaudeAccountQueryOptions({
        modelId: opts.modelId,
        systemPrompt: opts.systemPrompt,
        chatId: opts.chatId,
        workspaceDir: workspace.workspaceDir,
        abortController,
      }),
    });

    for await (const message of q) {
      if (opts.abortSignal.aborted) break;

      if (message.type === 'stream_event') {
        const ev = message.event as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          sawStreamText = true;
          buffer.text += ev.delta.text;
          yield { type: 'text-delta', payload: { text: ev.delta.text } };
          opts.onAssistantBuffer?.(buffer);
        }
        continue;
      }

      if (message.type === 'assistant') {
        if (message.error === 'authentication_failed') {
          yield {
            type: 'error',
            payload: {
              message:
                'Claude account authentication failed. Run `claude auth login` and try again.',
            },
          };
          break;
        }

        if (!emittedThinking) {
          yield { type: 'activity', payload: { phase: 'thinking' } };
          emittedThinking = true;
        }

        for (const block of message.message.content) {
          if ('text' in block && typeof block.text === 'string' && block.text && !sawStreamText) {
            buffer.text += block.text;
            yield { type: 'text-delta', payload: { text: block.text } };
            opts.onAssistantBuffer?.(buffer);
          }
          if (block.type === 'tool_use' && !seenToolCalls.has(block.id)) {
            seenToolCalls.add(block.id);
            const tc = {
              id: block.id,
              name: block.name,
              input: block.input,
              status: 'pending' as const,
            };
            buffer.toolCalls.push(tc);
            yield {
              type: 'tool-call',
              payload: { id: tc.id, name: tc.name, input: tc.input },
            };
            yield {
              type: 'activity',
              payload: { phase: 'tool-running', detail: block.name },
            };
            opts.onAssistantBuffer?.(buffer);
          }
        }
        sawStreamText = false;
        emittedThinking = false;
        continue;
      }

      if (message.type === 'user' && message.tool_use_result !== undefined) {
        const toolUseId =
          typeof message.parent_tool_use_id === 'string'
            ? message.parent_tool_use_id
            : extractToolUseId(message);
        if (!toolUseId || seenToolResults.has(toolUseId)) continue;
        seenToolResults.add(toolUseId);

        const text = stringifyToolOutput(message.tool_use_result);
        const tc = buffer.toolCalls.find((c) => c.id === toolUseId);
        const ok = isToolOutputOk(message.tool_use_result);
        if (tc) {
          tc.result = { ok, content: text };
          tc.status = ok ? 'success' : 'error';
        }
        yield {
          type: 'tool-result',
          payload: { id: toolUseId, ok, content: text },
        };
        yield { type: 'activity', payload: { phase: 'thinking' } };
        opts.onAssistantBuffer?.(buffer);
        continue;
      }

      if (message.type === 'result') {
        const usage = {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          totalTokens: message.usage.input_tokens + message.usage.output_tokens,
          inputTokenDetails: {
            noCacheTokens: message.usage.input_tokens,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          outputTokenDetails: {
            textTokens: message.usage.output_tokens,
            reasoningTokens: 0,
          },
        };
        opts.onFinish?.({ usage });
        yield {
          type: 'finish',
          payload: {
            finishReason: message.subtype === 'success' ? 'stop' : message.subtype,
            usage,
            subscription: true,
          },
        };
        if (message.subtype !== 'success') {
          const errors = 'errors' in message && Array.isArray(message.errors) ? message.errors : [];
          if (errors.length) {
            yield { type: 'error', payload: { message: errors.join('; ') } };
          }
        }
      }
    }
  } finally {
    if (listeningForAbort) opts.abortSignal.removeEventListener('abort', onAbort);
    try {
      q?.close();
    } finally {
      await workspace.cleanup();
    }
  }
}

function extractToolUseId(message: { message: { content: unknown } }): string | null {
  const content = message.message.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      block.type === 'tool_result' &&
      'tool_use_id' in block &&
      typeof block.tool_use_id === 'string'
    ) {
      return block.tool_use_id;
    }
  }
  return null;
}
