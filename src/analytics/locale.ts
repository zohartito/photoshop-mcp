export function getSystemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'unknown';
  }
}

/** Region subtag from a BCP-47 locale (e.g. en-US -> US, tr-TR -> TR). */
export function resolveLocaleRegion(locale: string): string | undefined {
  const match = locale.trim().match(/-([A-Za-z]{2})\b/);
  return match?.[1]?.toUpperCase();
}

/** Primary language subtag from a BCP-47 locale (e.g. en-US -> en, tr-TR -> tr). */
export function resolveLocaleLanguage(locale: string): string | undefined {
  const primary = locale.trim().split('-')[0]?.toLowerCase();
  return primary || undefined;
}
