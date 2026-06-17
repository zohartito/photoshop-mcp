<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { ArrowUp, Square } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { useTextareaAutosize } from '@/composables/useTextareaAutosize';

const props = defineProps<{ busy: boolean; disabled?: boolean }>();
const emit = defineEmits<{
  send: [prompt: string];
  abort: [];
}>();

const draft = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const { onInput, resize } = useTextareaAutosize(textareaRef, {
  minLines: 3,
  maxLines: 50,
  watch: draft,
});

function handleKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}

async function submit(): Promise<void> {
  const text = draft.value.trim();
  if (!text || props.busy || props.disabled) return;
  emit('send', text);
  draft.value = '';
  await nextTick(resize);
}
</script>

<template>
  <div class="mx-auto w-full max-w-3xl shrink-0 px-4 py-3">
    <div
      class="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-lg backdrop-blur-2xl backdrop-saturate-150 transition-shadow focus-within:border-white/20 focus-within:ring-1 focus-within:ring-white/10"
    >
      <textarea
        ref="textareaRef"
        v-model="draft"
        :disabled="busy || disabled"
        placeholder="Describe what you want the agent to do in Photoshop…"
        class="block w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
        @input="onInput"
        @keydown="handleKey"
      />
      <div class="flex items-center justify-between gap-2 px-2 pb-2">
        <div class="min-w-0 flex-1">
          <slot name="actions" />
        </div>
        <Button
          v-if="!busy"
          size="icon"
          :disabled="!draft.trim() || disabled"
          class="size-8 rounded-full disabled:opacity-40"
          @click="submit"
        >
          <ArrowUp class="size-4" />
        </Button>
        <Button
          v-else
          size="icon"
          variant="secondary"
          class="size-8 rounded-full"
          @click="emit('abort')"
        >
          <Square class="size-3.5" />
        </Button>
      </div>
    </div>
    <p class="mt-2 text-center text-[11px] text-muted-foreground">
      Press <kbd class="rounded border border-border px-1 py-px text-[10px]">Enter</kbd>
      to send · <kbd class="rounded border border-border px-1 py-px text-[10px]">Shift+Enter</kbd>
      for newline
    </p>
  </div>
</template>
