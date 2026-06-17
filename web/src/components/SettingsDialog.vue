<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { Check, ExternalLink, Loader2, Moon, Sun, Trash2, X } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTheme, type Theme } from '@/composables/useTheme';
import ProviderIcon from './ProviderIcon.vue';
import {
  apiDeleteKey,
  apiGetAnalyticsConfig,
  apiListProviders,
  apiSaveKey,
  apiSetAuthMethod,
  apiSetCliPath,
  apiValidateCli,
  apiValidateKey,
  type AuthMethod,
  type ProviderInfo,
} from '@/lib/api';
import { refreshAnalyticsState, setAnalyticsOptOut, syncAnalyticsContext } from '@/lib/analytics';
import { apiSetBetaTelemetry } from '@/lib/api';

const props = defineProps<{
  chatCount: number;
  clearingHistory?: boolean;
  clearHistoryError?: string | null;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  'clear-history': [];
}>();

const { theme, setTheme } = useTheme();

const providers = ref<ProviderInfo[]>([]);
const loading = ref(true);
const drafts = ref<Record<string, string>>({});
const cliPathDrafts = ref<Record<string, string>>({});
const busy = ref<Record<string, boolean>>({});
const errors = ref<Record<string, string | null>>({});
const confirmClearHistory = ref(false);
const generalError = ref<string | null>(null);
const analyticsEnabled = ref(false);
const analyticsBusy = ref(false);
const betaTelemetryEnabled = ref(false);
const betaTelemetryBusy = ref(false);

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
  loading.value = true;
  try {
    providers.value = await apiListProviders();
    for (const p of providers.value) {
      if (p.cliPath) cliPathDrafts.value[p.id] = p.cliPath;
    }
    analyticsEnabled.value = await refreshAnalyticsState();
    const config = await apiGetAnalyticsConfig();
    betaTelemetryEnabled.value = config.betaTelemetryOptIn;
  } finally {
    loading.value = false;
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

function cliPathPlaceholder(provider: ProviderInfo): string {
  return provider.cliBinaryName
    ? `/usr/local/bin/${provider.cliBinaryName}`
    : 'Optional custom path';
}

function requestClearHistory(): void {
  if (props.chatCount === 0 || props.clearingHistory) return;
  generalError.value = null;
  confirmClearHistory.value = true;
}

function cancelClearHistory(): void {
  confirmClearHistory.value = false;
}

async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  if (analyticsEnabled.value === enabled || analyticsBusy.value) return;
  analyticsBusy.value = true;
  generalError.value = null;
  try {
    await setAnalyticsOptOut(!enabled);
    analyticsEnabled.value = enabled;
    if (!enabled) {
      betaTelemetryEnabled.value = false;
    }
  } catch (err) {
    generalError.value = (err as Error).message;
  } finally {
    analyticsBusy.value = false;
  }
}

async function setBetaTelemetryEnabled(enabled: boolean): Promise<void> {
  if (!analyticsEnabled.value || betaTelemetryEnabled.value === enabled || betaTelemetryBusy.value) {
    return;
  }
  betaTelemetryBusy.value = true;
  generalError.value = null;
  try {
    await apiSetBetaTelemetry(enabled);
    betaTelemetryEnabled.value = enabled;
    await syncAnalyticsContext();
  } catch (err) {
    generalError.value = (err as Error).message;
  } finally {
    betaTelemetryBusy.value = false;
  }
}

function onSetTheme(next: Theme): void {
  setTheme(next);
  void syncAnalyticsContext();
}

function confirmClearHistoryAction(): void {
  confirmClearHistory.value = false;
  emit('clear-history');
}

watch(
  () => props.clearHistoryError,
  (message) => {
    if (message) generalError.value = message;
  }
);
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

      <Tabs default-value="general">
        <TabsList class="mb-4 grid w-full grid-cols-2">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
        </TabsList>

        <TabsContent value="general" class="space-y-6">
          <div class="space-y-2">
            <Label>Theme</Label>
            <div class="flex gap-2">
              <Button
                size="sm"
                :variant="theme === 'light' ? 'default' : 'outline'"
                @click="onSetTheme('light')"
              >
                <Sun class="size-4" />
                Light
              </Button>
              <Button
                size="sm"
                :variant="theme === 'dark' ? 'default' : 'outline'"
                @click="onSetTheme('dark')"
              >
                <Moon class="size-4" />
                Dark
              </Button>
            </div>
          </div>

          <div class="space-y-2">
            <Label>Privacy mode</Label>
            <p class="text-xs text-muted-foreground">
              When on, anonymous usage analytics are disabled. No API keys, chat
              content, or account identifiers are collected.
            </p>
            <div class="flex gap-2">
              <Button
                size="sm"
                :variant="!analyticsEnabled ? 'default' : 'outline'"
                :disabled="analyticsBusy"
                @click="setAnalyticsEnabled(false)"
              >
                On
              </Button>
              <Button
                size="sm"
                :variant="analyticsEnabled ? 'default' : 'outline'"
                :disabled="analyticsBusy"
                @click="setAnalyticsEnabled(true)"
              >
                Off
              </Button>
            </div>
          </div>

          <div v-if="analyticsEnabled" class="space-y-2">
            <Label>Beta team content sharing</Label>
            <p class="text-xs text-muted-foreground">
              When enabled, prompts, AI responses, reasoning, and tool names are
              shared to help improve the product. Tool arguments, results, and
              file paths are never included.
            </p>
            <div class="flex gap-2">
              <Button
                size="sm"
                :variant="betaTelemetryEnabled ? 'default' : 'outline'"
                :disabled="betaTelemetryBusy"
                @click="setBetaTelemetryEnabled(true)"
              >
                On
              </Button>
              <Button
                size="sm"
                :variant="!betaTelemetryEnabled ? 'default' : 'outline'"
                :disabled="betaTelemetryBusy"
                @click="setBetaTelemetryEnabled(false)"
              >
                Off
              </Button>
            </div>
          </div>

          <div class="space-y-2">
            <Label>Chat history</Label>
            <p class="text-xs text-muted-foreground">
              Permanently delete all conversations.
            </p>
            <template v-if="confirmClearHistory">
              <p class="text-sm">
                Delete {{ chatCount }} chat{{ chatCount === 1 ? '' : 's' }}? This cannot be undone.
              </p>
              <div class="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  :disabled="clearingHistory"
                  @click="confirmClearHistoryAction"
                >
                  <Loader2 v-if="clearingHistory" class="size-4 animate-spin" />
                  {{ clearingHistory ? 'Deleting…' : 'Confirm delete' }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="clearingHistory"
                  @click="cancelClearHistory"
                >
                  Cancel
                </Button>
              </div>
            </template>
            <template v-else>
              <Button
                variant="outline"
                size="sm"
                class="text-destructive hover:text-destructive"
                :disabled="chatCount === 0 || clearingHistory"
                @click="requestClearHistory"
              >
                <Trash2 class="size-4" />
                Clear all chats
              </Button>
              <p v-if="chatCount === 0" class="text-xs text-muted-foreground">
                No chats to delete.
              </p>
            </template>
            <p v-if="generalError" class="text-xs text-destructive">
              {{ generalError }}
            </p>
          </div>
        </TabsContent>

        <TabsContent value="providers" class="space-y-4">
          <div
            v-if="loading"
            class="flex items-center justify-center gap-2 rounded-lg border border-border py-10 text-sm text-muted-foreground"
          >
            <Loader2 class="size-4 animate-spin" />
            Loading providers…
          </div>
          <template v-else>
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
                  <div
                    v-if="CLI_INSTALL[p.id]"
                    class="rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground"
                  >
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
                      :placeholder="cliPathPlaceholder(p)"
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
          </template>
        </TabsContent>
      </Tabs>

      <div class="mt-6 flex justify-end">
        <Button @click="emit('close')">Done</Button>
      </div>
    </div>
  </div>
</template>
