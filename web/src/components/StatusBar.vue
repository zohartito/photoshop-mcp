<script setup lang="ts">
import { computed } from 'vue';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ChatSummary } from '@/lib/api';
import type { ChatTotals } from '@/stores/chat';

const props = defineProps<{
  chat: ChatSummary | null;
  totals: ChatTotals | null;
  subscriptionMode?: boolean;
}>();

const tokenFormatter = new Intl.NumberFormat('en-US');

function formatUsd(value: number): string {
  if (value <= 0) return '$0.0000';
  if (value < 0.0001) return '< $0.0001';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatTokens(value: number): string {
  return tokenFormatter.format(value);
}

const hasData = computed(() => {
  const t = props.totals;
  return Boolean(t && t.assistantTurns > 0);
});

const hasUnpricedTurn = computed(() => {
  const t = props.totals;
  return Boolean(t && t.assistantTurns > 0 && t.pricedTurns < t.assistantTurns);
});

const costLabel = computed(() => {
  const t = props.totals;
  if (!t || t.assistantTurns === 0) return null;
  if (t.pricedTurns === 0) return null;
  return formatUsd(t.totalUsd);
});
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur"
  >
    <div class="min-w-0 flex-1 truncate text-sm font-medium">
      {{ chat?.title ?? 'New chat' }}
    </div>

    <span
      v-if="chat && subscriptionMode"
      class="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground"
    >
      Included in subscription
    </span>

    <TooltipProvider v-else-if="chat && hasData">
      <Tooltip>
        <TooltipTrigger
          class="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground hover:bg-muted"
        >
          {{ costLabel ?? '—' }}
        </TooltipTrigger>
        <TooltipContent align="end" class="w-64">
          <div class="space-y-2">
            <div class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Conversation usage
            </div>

            <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span class="text-muted-foreground">Input</span>
              <span class="text-right tabular-nums">
                {{ formatTokens(totals!.inputTokens) }} tok · {{ formatUsd(totals!.inputUsd) }}
              </span>

              <template v-if="totals!.cachedReadTokens > 0">
                <span class="text-muted-foreground">Cached read</span>
                <span class="text-right tabular-nums">
                  {{ formatTokens(totals!.cachedReadTokens) }} tok · {{ formatUsd(totals!.cachedReadUsd) }}
                </span>
              </template>

              <template v-if="totals!.cachedWriteTokens > 0">
                <span class="text-muted-foreground">Cached write</span>
                <span class="text-right tabular-nums">
                  {{ formatTokens(totals!.cachedWriteTokens) }} tok · {{ formatUsd(totals!.cachedWriteUsd) }}
                </span>
              </template>

              <span class="text-muted-foreground">Output</span>
              <span class="text-right tabular-nums">
                {{ formatTokens(totals!.outputTokens) }} tok · {{ formatUsd(totals!.outputUsd) }}
              </span>

              <template v-if="totals!.reasoningTokens > 0">
                <span class="text-muted-foreground">Reasoning</span>
                <span class="text-right tabular-nums">
                  {{ formatTokens(totals!.reasoningTokens) }} tok
                </span>
              </template>
            </div>

            <div class="border-t border-border pt-2 text-xs">
              <div class="flex items-center justify-between font-medium">
                <span>Total</span>
                <span class="tabular-nums">
                  {{ formatTokens(totals!.totalTokens) }} tok · {{ formatUsd(totals!.totalUsd) }}
                </span>
              </div>
            </div>

            <p
              v-if="hasUnpricedTurn"
              class="text-[11px] leading-snug text-muted-foreground"
            >
              Some turns lack pricing data, so this total may underestimate cost.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </header>
</template>
