export function jsString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Serialize untrusted data as one complete JavaScript/ExtendScript string literal.
 *
 * Keep the surrounding quotes with the encoded value so callers cannot accidentally
 * reuse double-quote escaping inside a single-quoted or bare expression context.
 */
export function jsxStringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
