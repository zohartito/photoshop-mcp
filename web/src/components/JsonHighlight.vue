<script setup lang="ts">
import { computed } from 'vue';
import { highlightJsonValue, tokenClass } from '@/lib/json-highlight';

const props = defineProps<{ value: unknown }>();

const tokens = computed(() => highlightJsonValue(props.value));
</script>

<template>
  <!-- No whitespace inside <pre> — it would shift the opening bracket right -->
  <pre class="m-0 overflow-x-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-snug"><span
    v-for="(token, i) in tokens"
    :key="i"
    :class="tokenClass(token.type)"
  >{{ token.text }}</span></pre>
</template>
