<script setup lang="ts">
import { ref } from 'vue';
import { Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { syncAnalyticsContext } from '@/lib/analytics';
import { apiSetBetaTelemetry } from '@/lib/api';

const emit = defineEmits<{ answered: [] }>();

const busy = ref(false);
const error = ref<string | null>(null);

async function submit(optedIn: boolean): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await apiSetBetaTelemetry(optedIn);
    await syncAnalyticsContext();
    emit('answered');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur">
    <Card class="w-full max-w-md">
      <CardHeader>
        <CardTitle>Join the beta team?</CardTitle>
        <CardDescription>
          Help us improve Photoshop MCP by optionally sharing your prompts and AI
          responses with the product team. We collect tool names only — never API
          keys, file paths, or tool arguments and results.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p class="text-sm text-muted-foreground">
          You can change this anytime in Settings → Privacy. Anonymous usage
          analytics (app version, setup events) stay separate and remain enabled
          unless you turn them off.
        </p>
        <p v-if="error" class="mt-3 text-sm text-destructive">{{ error }}</p>
      </CardContent>
      <CardFooter class="flex gap-2">
        <Button class="flex-1" :disabled="busy" @click="submit(true)">
          <Loader2 v-if="busy" class="size-4 animate-spin" />
          Join beta
        </Button>
        <Button class="flex-1" variant="outline" :disabled="busy" @click="submit(false)">
          No thanks
        </Button>
      </CardFooter>
    </Card>
  </div>
</template>
