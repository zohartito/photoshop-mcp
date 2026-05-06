<script setup lang="ts">
import { computed } from 'vue';

export type AdobeApp = 'ps' | 'ai' | 'ae' | 'pr' | 'id' | 'xd' | 'lr';

interface AppMeta {
  label: string;
  bg: string;
  fg: string;
}

const APP_META: Record<AdobeApp, AppMeta> = {
  ps: { label: 'Ps', bg: '#001E36', fg: '#31A8FF' },
  ai: { label: 'Ai', bg: '#330000', fg: '#FF9A00' },
  ae: { label: 'Ae', bg: '#00005B', fg: '#9999FF' },
  pr: { label: 'Pr', bg: '#00005B', fg: '#EA77FF' },
  id: { label: 'Id', bg: '#49021F', fg: '#F36' },
  xd: { label: 'Xd', bg: '#1E0033', fg: '#FF61F6' },
  lr: { label: 'Lr', bg: '#001E36', fg: '#31A8FF' },
};

const props = withDefaults(
  defineProps<{
    app: AdobeApp;
    size?: number;
  }>(),
  { size: 32 }
);

const meta = computed(() => APP_META[props.app]);

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  background: meta.value.bg,
  color: meta.value.fg,
  // Adobe icons use ~18.75% squircle radius
  borderRadius: `${Math.max(2, Math.round(props.size * 0.1875))}px`,
  fontSize: `${Math.round(props.size * 0.55)}px`,
}));
</script>

<template>
  <div class="adobe-app-icon" :style="style" :aria-label="meta.label">
    <span class="adobe-app-icon__label">{{ meta.label }}</span>
  </div>
</template>

<style scoped>
.adobe-app-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  user-select: none;
  font-family: var(--font-mnemonic);
}

.adobe-app-icon__label {
  font-weight: 900;
  /* Tight tracking matches Adobe Clean Display Mnemonic */
  letter-spacing: -0.06em;
  line-height: 1;
  /* Optical centering: Source Sans 3 Black sits a hair high in the box */
  transform: translateY(0.04em);
}
</style>
