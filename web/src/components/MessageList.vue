<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { User, Sparkles } from 'lucide-vue-next';
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

      <div v-for="m in messages" :key="m.id" class="flex gap-3">
        <div
          class="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground"
        >
          <User v-if="m.role === 'user'" class="size-4" />
          <ProviderIcon v-else-if="m.provider" :provider="m.provider" :size="16" />
          <Sparkles v-else class="size-4" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <div class="text-xs font-medium text-muted-foreground">
            {{ m.role === 'user' ? 'You' : assistantLabel(m) }}
          </div>
          <div
            v-if="m.role === 'user' && m.text"
            class="whitespace-pre-wrap text-sm leading-relaxed text-foreground"
          >
            {{ m.text }}
          </div>
          <StreamingMessage
            v-else-if="m.role === 'assistant'"
            :message="m"
            :standalone-tool-calls="standaloneToolCalls(m)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
