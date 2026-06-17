import { createApp } from 'vue';
import latinWoff2 from '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?url';
import App from './App.vue';
import { applyTheme, getStoredTheme } from './composables/useTheme';
import { initAnalytics } from './lib/analytics';
import { router } from './router';
import './style.css';

applyTheme(getStoredTheme());

// Self-host only the Latin subset of Source Sans 3 Variable to keep the
// shipped tarball small. Other subsets are intentionally not bundled.
const fontFace = new FontFace(
  'Source Sans 3 Variable',
  `url(${latinWoff2}) format('woff2-variations')`,
  { style: 'normal', weight: '200 900', display: 'swap' }
);
fontFace.load().then((face) => document.fonts.add(face)).catch(() => undefined);

async function bootstrap(): Promise<void> {
  await initAnalytics();
  createApp(App).use(router).mount('#app');
}

void bootstrap();
