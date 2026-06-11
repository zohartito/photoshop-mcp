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
import ProviderIcon from '@/components/ProviderIcon.vue';
import {
  apiListProviders,
  apiSaveKey,
  apiSetActive,
  apiSetAuthMethod,
  apiValidateCli,
  apiValidateKey,
  type AuthMethod,
  type ProviderId,
  type ProviderInfo,
} from '@/lib/api';

const emit = defineEmits<{ saved: [] }>();

const providers = ref<ProviderInfo[]>([]);
const selectedId = ref<ProviderId>('anthropic');
const authMethod = ref<AuthMethod>('api_key');
const apiKey = ref('');
const validating = ref(false);
const error = ref<string | null>(null);

const selected = computed<ProviderInfo | undefined>(() =>
  providers.value.find((p) => p.id === selectedId.value)
);

const supportsCliAccount = computed(
  () => selected.value?.supportedAuthMethods.includes('cli_account') ?? false
);

const CLI_INSTALL: Partial<Record<ProviderId, { install: string; login: string }>> = {
  anthropic: {
    install: 'npm install -g @anthropic-ai/claude-code',
    login: 'claude auth login',
  },
  google: {
    install: 'npm install -g @google/gemini-cli',
    login: 'gemini auth login',
  },
};

onMounted(async () => {
  providers.value = await apiListProviders();
});

async function selectProvider(id: ProviderId): Promise<void> {
  selectedId.value = id;
  const provider = providers.value.find((p) => p.id === id);
  authMethod.value = provider?.authMethod ?? 'api_key';
  error.value = null;
}

async function selectAuthMethod(method: AuthMethod): Promise<void> {
  authMethod.value = method;
  error.value = null;
  if (selected.value) {
    await apiSetAuthMethod(selected.value.id, method);
  }
}

async function submit(): Promise<void> {
  const provider = selected.value;
  if (!provider) return;
  error.value = null;
  validating.value = true;
  try {
    if (authMethod.value === 'api_key') {
      const validation = await apiValidateKey(provider.id, apiKey.value);
      if (!validation.ok) {
        error.value = validation.error || 'Could not validate this key.';
        return;
      }
      await apiSaveKey(provider.id, apiKey.value);
    } else {
      const validation = await apiValidateCli(provider.id);
      if (!validation.ok) {
        error.value = validation.error || 'CLI is not authenticated.';
        return;
      }
    }
    await apiSetActive({ activeProvider: provider.id, activeModel: provider.defaultModel });
    emit('saved');
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    validating.value = false;
  }
}

const canSubmit = computed(() => {
  if (!selected.value) return false;
  if (authMethod.value === 'api_key') return Boolean(apiKey.value.trim());
  return true;
});
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-6">
    <Card class="w-full max-w-md">
      <CardHeader>
        <AdobeAppIcon app="ps" :size="40" class="mb-2" />
        <CardTitle>Connect an AI provider</CardTitle>
        <CardDescription>
          Use your own API key or sign in with a CLI subscription account. Credentials
          are stored locally at
          <code class="text-xs">~/.photoshop-mcp/data.db</code> and never leave your
          machine.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label>Provider</Label>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="p in providers"
              :key="p.id"
              type="button"
              class="flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-xs font-medium transition"
              :class="
                selectedId === p.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-input text-muted-foreground hover:bg-accent'
              "
              @click="selectProvider(p.id)"
            >
              <ProviderIcon :provider="p.id" :size="22" />
              {{ p.label }}
            </button>
          </div>
        </div>

        <div v-if="supportsCliAccount" class="space-y-2">
          <Label>Authentication</Label>
          <div class="flex gap-2">
            <Button
              size="sm"
              class="flex-1"
              :variant="authMethod === 'api_key' ? 'default' : 'outline'"
              @click="selectAuthMethod('api_key')"
            >
              API key
            </Button>
            <Button
              size="sm"
              class="flex-1"
              :variant="authMethod === 'cli_account' ? 'default' : 'outline'"
              @click="selectAuthMethod('cli_account')"
            >
              Uses your account
            </Button>
          </div>
        </div>

        <template v-if="authMethod === 'api_key'">
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
        </template>

        <template v-else-if="selected && CLI_INSTALL[selected.id]">
          <div class="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            <p class="font-medium text-foreground">Set up the CLI first</p>
            <p class="mt-2">
              Install:
              <code class="text-foreground">{{ CLI_INSTALL[selected.id]!.install }}</code>
            </p>
            <p class="mt-1">
              Login:
              <code class="text-foreground">{{ CLI_INSTALL[selected.id]!.login }}</code>
            </p>
            <p class="mt-2">
              Then click validate — usage counts against your subscription quota, not API
              billing.
            </p>
          </div>
        </template>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      </CardContent>
      <CardFooter>
        <Button class="w-full" :disabled="validating || !canSubmit" @click="submit">
          <Loader2 v-if="validating" class="size-4 animate-spin" />
          {{
            validating
              ? 'Validating…'
              : authMethod === 'api_key'
                ? 'Validate & save'
                : 'Check connection & continue'
          }}
        </Button>
      </CardFooter>
    </Card>
  </div>
</template>
