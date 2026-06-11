<script setup lang="ts">
import { computed } from 'vue';
import { MessageSquarePlus } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import StatusBar from './StatusBar.vue';
import MessageList from './MessageList.vue';
import Composer from './Composer.vue';
import ModelSelector from './ModelSelector.vue';
import Footer from './Footer.vue';
import { apiUpdateChatModel, type ProviderId, type ProviderInfo } from '@/lib/api';
import type { useChatStore } from '@/stores/chat';

const props = defineProps<{
  providers: ProviderInfo[];
  store: ReturnType<typeof useChatStore>;
  settingsOpen: boolean;
}>();

const emit = defineEmits<{ 
  'new-chat': [];
  'open-settings': [];
}>();

const activeChat = computed(() => {
  const id = props.store.activeChatId.value;
  if (!id) return null;
  return props.store.chats.value.find((c) => c.id === id) ?? null;
});

const activeProviderInfo = computed(() => {
  const chat = activeChat.value;
  if (!chat) return null;
  return props.providers.find((p) => p.id === chat.provider) ?? null;
});

const subscriptionMode = computed(
  () => activeProviderInfo.value?.authMethod === 'cli_account'
);

async function onProviderChange(providerId: ProviderId): Promise<void> {
  const chat = activeChat.value;
  if (!chat) return;
  await apiUpdateChatModel(chat.id, { provider: providerId });
  await props.store.loadChats();
}

async function onModelChange(modelId: string): Promise<void> {
  const chat = activeChat.value;
  if (!chat) return;
  await apiUpdateChatModel(chat.id, { model: modelId });
  await props.store.loadChats();
}
</script>

<template>
  <div class="flex h-screen flex-col">
    <StatusBar
      :chat="activeChat"
      :totals="activeChat ? props.store.chatTotals.value : null"
      :subscription-mode="subscriptionMode"
    />

    <div v-if="!activeChat" class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p class="text-sm text-muted-foreground">Select a chat from the sidebar or start a new one.</p>
      <Button @click="emit('new-chat')">
        <MessageSquarePlus class="size-4" />
        New chat
      </Button>
    </div>

    <template v-else>
      <MessageList
        :messages="props.store.messages"
        :busy="props.store.sending.value"
        :providers="props.providers"
      />

      <div
        v-if="props.store.error.value"
        class="border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-xs text-destructive"
      >
        {{ props.store.error.value }}
      </div>

      <Composer
        :busy="props.store.sending.value"
        @send="(p) => props.store.send(p)"
        @abort="props.store.abort"
      >
        <template #actions>
      <ModelSelector
        :providers="props.providers"
        :current-provider="activeChat.provider"
        :current-model="activeChat.model"
        :disabled="props.store.sending.value"
        @update:provider="onProviderChange"
        @update:model="onModelChange"
        @open-settings="emit('open-settings')"
      />
        </template>
      </Composer>
    </template>

    <Footer />
  </div>
</template>
