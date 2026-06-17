/** Region subtag from a BCP-47 locale (e.g. en-US -> US, tr-TR -> TR). */
export function resolveLocaleRegion(locale: string): string | undefined {
  const match = locale.trim().match(/-([A-Za-z]{2})\b/);
  return match?.[1]?.toUpperCase();
}

export interface BrowserLocaleProperties {
  browser_language: string;
  browser_timezone: string;
  browser_locale_region?: string;
}

export function buildBrowserLocaleProperties(): BrowserLocaleProperties {
  const browser_language = navigator.language;
  const browser_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const browser_locale_region = resolveLocaleRegion(browser_language);
  return {
    browser_language,
    browser_timezone,
    ...(browser_locale_region ? { browser_locale_region } : {}),
  };
}
