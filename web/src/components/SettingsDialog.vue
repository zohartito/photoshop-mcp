<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Check, ExternalLink, Loader2, Trash2, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ProviderIcon from './ProviderIcon.vue';
import {
  apiDeleteKey,
  apiListProviders,
  apiSaveKey,
  apiSetAuthMethod,
  apiSetCliPath,
  apiValidateCli,
  apiValidateKey,
  type AuthMethod,
  type ProviderInfo,
} from '@/lib/api';

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const providers = ref<ProviderInfo[]>([]);
const drafts = ref<Record<string, string>>({});
const cliPathDrafts = ref<Record<string, string>>({});
const busy = ref<Record<string, boolean>>({});
const errors = ref<Record<string, string | null>>({});

const CLI_INSTALL: Partial<Record<ProviderInfo['id'], { install: string; login: string }>> = {
  anthropic: {
    install: 'npm install -g @anthropic-ai/claude-code',
    login: 'claude auth login',
  },
  google: {
    install: 'npm install -g @google/gemini-cli',
    login: 'gemini auth login',
  },
};

async function refresh(): Promise<void> {
  providers.value = await apiListProviders();
  for (const p of providers.value) {
    if (p.cliPath) cliPathDrafts.value[p.id] = p.cliPath;
  }
}

onMounted(refresh);

async function setAuthMethod(provider: ProviderInfo, authMethod: AuthMethod): Promise<void> {
  if (provider.authMethod === authMethod) return;
  errors.value[provider.id] = null;
  busy.value[provider.id] = true;
  try {
    await apiSetAuthMethod(provider.id, authMethod);
    await refresh();
    emit('saved');
  } catch (err) {
    errors.value[provider.id] = (err as Error).message;
  } finally {
    busy.value[provider.id] = false;
  }
}

async function saveKey(provider: ProviderInfo): Promise<void> {
  const key = drafts.value[provider.id]?.trim();
  if (!key) return;
  errors.value[provider.id] = null;
  busy.value[provider.id] = true;
  try {
    const validation = await apiValidateKey(provider.id, key);
    if (!validation.ok) {
      errors.value[provider.id] = validation.error || 'Invalid key';
      return;
    }
    await apiSaveKey(provider.id, key);
    drafts.value[provider.id] = '';
    await refresh();
    emit('saved');
  } catch (err) {
    errors.value[provider.id] = (err as Error).message;
  } finally {
    busy.value[provider.id] = false;
  }
}

async function removeKey(provider: ProviderInfo): Promise<void> {
  busy.value[provider.id] = true;
  try {
    await apiDeleteKey(provider.id);
    await refresh();
    emit('saved');
  } finally {
    busy.value[provider.id] = false;
  }
}

async function validateCli(provider: ProviderInfo): Promise<void> {
  errors.value[provider.id] = null;
  busy.value[provider.id] = true;
  try {
    const cliPath = cliPathDrafts.value[provider.id]?.trim();
    if (cliPath) {
      await apiSetCliPath(provider.id, cliPath);
    }
    const result = await apiValidateCli(provider.id);
    if (!result.ok) {
      errors.value[provider.id] = result.error || 'CLI not authenticated';
      return;
    }
    await refresh();
    emit('saved');
  } catch (err) {
    errors.value[provider.id] = (err as Error).message;
  } finally {
    busy.value[provider.id] = false;
  }
}

function supportsCliAccount(provider: ProviderInfo): boolean {
  return provider.supportedAuthMethods.includes('cli_account');
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur"
    @click.self="emit('close')"
  >
    <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-base font-semibold">Settings</h2>
        <Button variant="ghost" size="icon" @click="emit('close')">
          <X class="size-4" />
        </Button>
      </div>

      <div class="space-y-4">
        <h3 class="text-sm font-medium">Providers</h3>
        <div
          v-for="p in providers"
          :key="p.id"
          class="rounded-lg border border-border p-3"
        >
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <ProviderIcon :provider="p.id" :size="18" />
              <span class="text-sm font-semibold">{{ p.label }}</span>
              <span
                v-if="p.isAuthenticated"
                class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400"
              >
                <Check class="size-3" />
                {{
                  p.authMethod === 'cli_account'
                    ? p.accountLabel || 'Account connected'
                    : p.apiKeyMasked
                }}
              </span>
            </div>
            <a
              v-if="p.authMethod === 'api_key'"
              :href="p.apiKeyHelpUrl"
              target="_blank"
              rel="noreferrer"
              class="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Get key
              <ExternalLink class="size-3" />
            </a>
          </div>

          <div v-if="supportsCliAccount(p)" class="mb-3 space-y-2">
            <Label class="text-xs text-muted-foreground">Authentication</Label>
            <div class="flex gap-2">
              <Button
                size="sm"
                :variant="p.authMethod === 'api_key' ? 'default' : 'outline'"
                :disabled="busy[p.id]"
                @click="setAuthMethod(p, 'api_key')"
              >
                API key
              </Button>
              <Button
                size="sm"
                :variant="p.authMethod === 'cli_account' ? 'default' : 'outline'"
                :disabled="busy[p.id]"
                @click="setAuthMethod(p, 'cli_account')"
              >
                Uses your account
              </Button>
            </div>
          </div>

          <template v-if="p.authMethod === 'api_key'">
            <div class="flex items-center gap-2">
              <Input
                v-model="drafts[p.id]"
                type="password"
                :placeholder="p.hasApiKey ? 'Replace key…' : p.apiKeyHint"
                :disabled="busy[p.id]"
              />
              <Button
                size="sm"
                :disabled="busy[p.id] || !drafts[p.id]"
                @click="saveKey(p)"
              >
                <Loader2 v-if="busy[p.id]" class="size-4 animate-spin" />
                {{ busy[p.id] ? '…' : 'Save' }}
              </Button>
              <Button
                v-if="p.hasApiKey"
                size="icon"
                variant="ghost"
                :disabled="busy[p.id]"
                @click="removeKey(p)"
              >
                <Trash2 class="size-4 text-muted-foreground" />
              </Button>
            </div>
          </template>

          <template v-else>
            <div class="space-y-2">
              <div v-if="CLI_INSTALL[p.id]" class="rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
                <p>
                  Install:
                  <code class="text-foreground">{{ CLI_INSTALL[p.id]!.install }}</code>
                </p>
                <p class="mt-1">
                  Login:
                  <code class="text-foreground">{{ CLI_INSTALL[p.id]!.login }}</code>
                </p>
              </div>
              <div class="space-y-1">
                <Label class="text-xs text-muted-foreground">CLI path (optional)</Label>
                <Input
                  v-model="cliPathDrafts[p.id]"
                  placeholder="/usr/local/bin/claude"
                  :disabled="busy[p.id]"
                />
              </div>
              <Button size="sm" :disabled="busy[p.id]" @click="validateCli(p)">
                <Loader2 v-if="busy[p.id]" class="size-4 animate-spin" />
                {{ busy[p.id] ? 'Checking…' : 'Check connection' }}
              </Button>
            </div>
          </template>

          <p v-if="errors[p.id]" class="mt-2 text-xs text-destructive">
            {{ errors[p.id] }}
          </p>
        </div>
      </div>

      <div class="mt-6 flex justify-end">
        <Button @click="emit('close')">Done</Button>
      </div>
    </div>
  </div>
</template>
