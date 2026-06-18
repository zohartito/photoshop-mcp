import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPhotoshopMcpHomeDir } from '../lib/export-paths.js';
import { kvGet, kvSet } from '../ui/store/kv.js';
import { isPostHogDisabledByEnv } from './config.js';
import type { BetaTelemetryState } from './types.js';

const DISTINCT_ID_KEY = 'analytics_distinct_id';
const OPT_OUT_KEY = 'analytics_opt_out';
const BETA_TELEMETRY_OPT_IN_KEY = 'beta_telemetry_opt_in';
const BETA_TELEMETRY_PROMPT_ANSWERED_KEY = 'beta_telemetry_prompt_answered';
const USAGE_SURFACES_KEY = 'analytics_usage_surfaces';

interface AnalyticsStore {
  distinctId?: string;
  optedOut?: boolean;
  betaTelemetryOptIn?: boolean;
  betaTelemetryPromptAnswered?: boolean;
  usageSurfaces?: string[];
}

const STORE_FILE = 'analytics-store.json';

let memoryDistinctId: string | null = null;
let dbAvailable: boolean | null = null;

function getStorePath(): string {
  return join(getPhotoshopMcpHomeDir(), STORE_FILE);
}

function readFileStore(): AnalyticsStore {
  try {
    const raw = readFileSync(getStorePath(), 'utf8');
    return JSON.parse(raw) as AnalyticsStore;
  } catch {
    return {};
  }
}

function writeFileStore(store: AnalyticsStore): void {
  const dir = getPhotoshopMcpHomeDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(getStorePath(), JSON.stringify(store), { mode: 0o600 });
}

function canUseKv(): boolean {
  if (dbAvailable === false) return false;
  try {
    kvGet('__analytics_probe__');
    dbAvailable = true;
    return true;
  } catch {
    dbAvailable = false;
    return false;
  }
}

function readDistinctIdFromKv(): string | undefined {
  if (!canUseKv()) return undefined;
  try {
    return kvGet<string>(DISTINCT_ID_KEY);
  } catch {
    dbAvailable = false;
    return undefined;
  }
}

function writeDistinctIdToKv(id: string): void {
  if (!canUseKv()) return;
  try {
    kvSet(DISTINCT_ID_KEY, id);
  } catch {
    dbAvailable = false;
  }
}

function readOptOutFromKv(): boolean | undefined {
  if (!canUseKv()) return undefined;
  try {
    return kvGet<boolean>(OPT_OUT_KEY);
  } catch {
    dbAvailable = false;
    return undefined;
  }
}

function writeOptOutToKv(optedOut: boolean): void {
  if (!canUseKv()) return;
  try {
    kvSet(OPT_OUT_KEY, optedOut);
  } catch {
    dbAvailable = false;
  }
}

export function getOrCreateDistinctId(): string {
  if (memoryDistinctId) return memoryDistinctId;

  const fromKv = readDistinctIdFromKv();
  if (fromKv) {
    memoryDistinctId = fromKv;
    return fromKv;
  }

  const fromFile = readFileStore().distinctId;
  if (fromFile) {
    memoryDistinctId = fromFile;
    writeDistinctIdToKv(fromFile);
    return fromFile;
  }

  const id = randomUUID();
  memoryDistinctId = id;
  writeDistinctIdToKv(id);
  const store = readFileStore();
  writeFileStore({ ...store, distinctId: id });
  return id;
}

export function isAnalyticsOptedOut(): boolean {
  if (isPostHogDisabledByEnv()) return true;

  const fromKv = readOptOutFromKv();
  if (fromKv !== undefined) return fromKv;

  return readFileStore().optedOut === true;
}

export function setAnalyticsOptOut(optedOut: boolean): void {
  writeOptOutToKv(optedOut);
  const store = readFileStore();
  writeFileStore({ ...store, optedOut });
}

export function isAnalyticsEnabled(): boolean {
  return !isAnalyticsOptedOut();
}

function readBooleanFromKv(key: string): boolean | undefined {
  if (!canUseKv()) return undefined;
  try {
    return kvGet<boolean>(key);
  } catch {
    dbAvailable = false;
    return undefined;
  }
}

function writeBooleanToKv(key: string, value: boolean): void {
  if (!canUseKv()) return;
  try {
    kvSet(key, value);
  } catch {
    dbAvailable = false;
  }
}

export function getBetaTelemetryState(): BetaTelemetryState {
  const fromKvOptIn = readBooleanFromKv(BETA_TELEMETRY_OPT_IN_KEY);
  const fromKvAnswered = readBooleanFromKv(BETA_TELEMETRY_PROMPT_ANSWERED_KEY);
  const fileStore = readFileStore();

  return {
    betaTelemetryOptIn:
      fromKvOptIn ?? fileStore.betaTelemetryOptIn ?? false,
    betaTelemetryPromptAnswered:
      fromKvAnswered ?? fileStore.betaTelemetryPromptAnswered ?? false,
  };
}

export function isBetaTelemetryOptIn(): boolean {
  return getBetaTelemetryState().betaTelemetryOptIn;
}

export function setBetaTelemetryChoice(optedIn: boolean): void {
  writeBooleanToKv(BETA_TELEMETRY_OPT_IN_KEY, optedIn);
  writeBooleanToKv(BETA_TELEMETRY_PROMPT_ANSWERED_KEY, true);
  const store = readFileStore();
  writeFileStore({
    ...store,
    betaTelemetryOptIn: optedIn,
    betaTelemetryPromptAnswered: true,
  });
}

function readUsageSurfacesFromStore(): string[] {
  if (canUseKv()) {
    try {
      const fromKv = kvGet<string[]>(USAGE_SURFACES_KEY);
      if (Array.isArray(fromKv)) return fromKv.filter((s) => typeof s === 'string' && s.trim());
    } catch {
      dbAvailable = false;
    }
  }
  const fromFile = readFileStore().usageSurfaces;
  return Array.isArray(fromFile)
    ? fromFile.filter((s) => typeof s === 'string' && s.trim())
    : [];
}

function writeUsageSurfacesToStore(surfaces: string[]): void {
  if (canUseKv()) {
    try {
      kvSet(USAGE_SURFACES_KEY, surfaces);
    } catch {
      dbAvailable = false;
    }
  }
  const store = readFileStore();
  writeFileStore({ ...store, usageSurfaces: surfaces });
}

/** Accumulates usage surfaces on the anonymous person profile (mcp, server, web). */
export function recordUsageSurface(surface: string): string {
  const normalized = surface.trim();
  if (!normalized) {
    return readUsageSurfacesFromStore().sort().join(',');
  }
  const merged = [...new Set([...readUsageSurfacesFromStore(), normalized])].sort();
  writeUsageSurfacesToStore(merged);
  return merged.join(',');
}
