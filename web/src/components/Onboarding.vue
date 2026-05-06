<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ExternalLink, Loader2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import AdobeAppIcon from '@/components/AdobeAppIcon.vue';
import {
  apiListProviders,
  apiSaveKey,
  apiSetActive,
  apiValidateKey,
  type ProviderId,
  type ProviderInfo,
} from '@/lib/api';

const emit = defineEmits<{ saved: [] }>();

const providers = ref<ProviderInfo[]>([]);
const selectedId = ref<ProviderId>('anthropic');
const apiKey = ref('');
const validating = ref(false);
const error = ref<string | null>(null);

const selected = computed<ProviderInfo | undefined>(() =>
  providers.value.find((p) => p.id === selectedId.value)
);

onMounted(async () => {
  providers.value = await apiListProviders();
});

async function submit(): Promise<void> {
  const provider = selected.value;
  if (!provider) return;
  error.value = null;
  validating.value = true;
  try {
    const validation = await apiValidateKey(provider.id, apiKey.value);
    if (!validation.ok) {
      error.value = validation.error || 'Could not validate this key.';
      return;
    }
    await apiSaveKey(provider.id, apiKey.value);
    await apiSetActive({ activeProvider: provider.id, activeModel: provider.defaultModel });
    emit('saved');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    validating.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-6">
    <Card class="w-full max-w-md">
      <CardHeader>
        <AdobeAppIcon app="ps" :size="40" class="mb-2" />
        <CardTitle>Connect an AI provider</CardTitle>
        <CardDescription>
          Photoshop MCP UI uses your own API key to talk to a model. The key is stored
          locally at <code class="text-xs">~/.photoshop-mcp/data.db</code> and never
          leaves your machine.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label>Provider</Label>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="p in providers"
              :key="p.id"
              type="button"
              class="rounded-md border px-2 py-2 text-xs font-medium transition"
              :class="
                selectedId === p.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-input text-muted-foreground hover:bg-accent'
              "
              @click="selectedId = p.id"
            >
              {{ p.label }}
            </button>
          </div>
        </div>

        <div class="space-y-2">
          <Label for="api-key">API key</Label>
          <Input
            id="api-key"
            v-model="apiKey"
            type="password"
            :placeholder="selected?.apiKeyHint ?? ''"
            :disabled="validating"
            @keydown.enter="submit"
          />
        </div>

        <a
          v-if="selected"
          :href="selected.apiKeyHelpUrl"
          target="_blank"
          rel="noreferrer"
          class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Get an API key
          <ExternalLink class="size-3" />
        </a>
        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      </CardContent>
      <CardFooter>
        <Button class="w-full" :disabled="validating || !apiKey || !selected" @click="submit">
          <Loader2 v-if="validating" class="size-4 animate-spin" />
          {{ validating ? 'Validating…' : 'Validate & save' }}
        </Button>
      </CardFooter>
    </Card>
  </div>
</template>
