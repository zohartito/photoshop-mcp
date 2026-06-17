<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { User, Sparkles } from 'lucide-vue-next';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import StreamingMessage from './StreamingMessage.vue';
import ProviderIcon from './ProviderIcon.vue';
import type { ChatMessage } from '@/stores/chat';
import type { ProviderInfo } from '@/lib/api';

const props = defineProps<{
  messages: ChatMessage[];
  busy: boolean;
  providers: ProviderInfo[];
}>();

const scroller = ref<HTMLElement | null>(null);

async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (scroller.value) {
    scroller.value.scrollTop = scroller.value.scrollHeight;
  }
}

watch(
  () => [
    props.messages.length,
    props.busy,
    props.messages[props.messages.length - 1]?.text,
    props.messages[props.messages.length - 1]?.reasoning,
    props.messages[props.messages.length - 1]?.plan?.steps.length,
    props.messages[props.messages.length - 1]?.isStreaming,
  ],
  () => {
    void scrollToBottom();
  }
);

onMounted(scrollToBottom);

function assistantLabel(m: ChatMessage): string {
  if (!m.provider) return 'Assistant';
  const provider = props.providers.find((p) => p.id === m.provider);
  const providerLabel = provider?.label ?? m.provider;
  const modelLabel = provider?.models.find((mm) => mm.id === m.model)?.label ?? m.model;
  return modelLabel ? `${providerLabel} · ${modelLabel}` : providerLabel;
}

/** When an action plan is present, tool calls are shown inline on the plan rows. */
function standaloneToolCalls(m: ChatMessage) {
  if (!m.plan) return m.toolCalls;
  return m.toolCalls.slice(m.plan.steps.length);
}
</script>

<template>
  <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 pb-52">
      <div
        v-if="messages.length === 0"
        class="flex items-start gap-2.5 rounded-lg border border-dashed border-border/60 bg-card/30 px-3 py-2.5"
      >
        <Sparkles class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p class="min-w-0 text-xs leading-relaxed text-muted-foreground">
          <span class="font-medium text-foreground">Describe a Photoshop task</span>
          — e.g. "Create a 1920×1080 doc, add 'Hello' text, save as hello.psd on Desktop."
        </p>
      </div>

      <template v-for="m in messages" :key="m.id">
        <div
          v-if="m.role === 'user'"
          class="flex gap-3 rounded-lg border border-user-message-border bg-user-message-bg px-3 py-2.5 text-user-message-fg"
        >
          <div
            class="flex size-7 shrink-0 items-center justify-center rounded-md border border-user-message-border bg-user-message-avatar-bg text-user-message-avatar-fg"
          >
            <User class="size-4" />
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <div class="text-xs font-medium text-user-message-muted">You</div>
            <div
              v-if="m.text"
              class="whitespace-pre-wrap text-sm leading-relaxed"
            >
              {{ m.text }}
            </div>
          </div>
        </div>

        <div v-else class="flex gap-3">
          <TooltipProvider v-if="m.provider">
            <Tooltip>
              <TooltipTrigger as-child>
                <div
                  class="flex size-7 shrink-0 cursor-default items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
                >
                  <ProviderIcon :provider="m.provider" :size="16" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p class="text-xs">{{ assistantLabel(m) }}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div
            v-else
            class="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
          >
            <Sparkles class="size-4" />
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <StreamingMessage
              :message="m"
              :standalone-tool-calls="standaloneToolCalls(m)"
            />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
