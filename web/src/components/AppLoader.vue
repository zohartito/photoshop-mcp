<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next';

defineProps<{
  message: string;
}>();
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
    <Loader2 class="size-5 animate-spin text-foreground/70" />
    <p>{{ message }}</p>
  </div>
</template>
