/**
 * Normalize values returned from ExtendScript via AppleScript stdout.
 * Repository-generated scripts serialize objects as strict JSON. Any result
 * that is not valid JSON remains an inert string; returned Photoshop text is
 * never evaluated in the Node process.
 */
export function parseExtendScriptPayload(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== 'string') return raw;

  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}
