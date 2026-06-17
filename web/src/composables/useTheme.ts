import { ref } from 'vue';

export const THEME_STORAGE_KEY = 'photoshop-mcp-theme';

export type Theme = 'dark' | 'light';

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function useTheme() {
  const theme = ref<Theme>(getStoredTheme());

  function setTheme(next: Theme): void {
    theme.value = next;
    applyTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  function toggleTheme(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark');
  }

  return { theme, setTheme, toggleTheme };
}
