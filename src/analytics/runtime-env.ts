import { cpus, release, totalmem, type } from 'node:os';
import { getAppVersion } from './app-version.js';
import { getSystemLocale, resolveLocaleLanguage, resolveLocaleRegion } from './locale.js';

function bucketMemoryGb(totalBytes: number): number {
  const gb = totalBytes / 1024 ** 3;
  if (gb <= 4) return 4;
  if (gb <= 8) return 8;
  if (gb <= 16) return 16;
  if (gb <= 32) return 32;
  if (gb <= 64) return 64;
  return 128;
}

/** Rounded total installed RAM in GB — attached to the anonymous person profile only. */
export function getTotalRamGb(): number {
  return Math.round(totalmem() / 1024 ** 3);
}

/** Bucketed memory tier (GB) for person-profile cohort segmentation. */
export function getMemoryGbBucket(): number {
  return bucketMemoryGb(totalmem());
}

function getSystemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'unknown';
  }
}

function getNodeMajorVersion(): number | undefined {
  const match = process.version.match(/^v(\d+)/);
  if (!match) return undefined;
  const major = Number.parseInt(match[1], 10);
  return Number.isFinite(major) ? major : undefined;
}

function envFlag(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/** Anonymous machine/runtime signals safe to attach to every server-side event. */
export function buildAnonymousRuntimeEnv(): Record<string, string | number | boolean> {
  const systemLocale = getSystemLocale();
  const systemLocaleRegion = resolveLocaleRegion(systemLocale);
  const systemLocaleLanguage = resolveLocaleLanguage(systemLocale);
  const nodeMajor = getNodeMajorVersion();

  return {
    app_version: getAppVersion(),
    os: process.platform,
    arch: process.arch,
    os_type: type(),
    os_release: release(),
    node_version: process.version,
    ...(nodeMajor !== undefined ? { node_major: nodeMajor } : {}),
    cpu_count: cpus().length,
    system_locale: systemLocale,
    system_timezone: getSystemTimezone(),
    ...(systemLocaleRegion ? { system_locale_region: systemLocaleRegion } : {}),
    ...(systemLocaleLanguage ? { system_locale_language: systemLocaleLanguage } : {}),
    is_electron: Boolean(process.versions.electron),
    photoshop_path_configured: envFlag('PHOTOSHOP_PATH'),
    custom_data_dir_configured: envFlag('PHOTOSHOP_MCP_HOME'),
  };
}
