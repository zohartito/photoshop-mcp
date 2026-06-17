import { safeJson } from '@/lib/tool-display';

export type JsonTokenType =
  | 'key'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'punctuation'
  | 'whitespace';

export type JsonToken = { type: JsonTokenType; text: string };

const TOKEN_CLASSES: Record<JsonTokenType, string> = {
  key: 'text-sky-600 dark:text-sky-400',
  string: 'text-emerald-600 dark:text-emerald-400',
  number: 'text-amber-600 dark:text-amber-400',
  boolean: 'text-purple-600 dark:text-purple-400',
  null: 'text-muted-foreground',
  punctuation: 'text-muted-foreground',
  whitespace: '',
};

export function tokenClass(type: JsonTokenType): string {
  return TOKEN_CLASSES[type];
}

function readString(json: string, start: number): { end: number; text: string } {
  let i = start + 1;
  while (i < json.length) {
    if (json[i] === '\\') {
      i += 2;
      continue;
    }
    if (json[i] === '"') {
      return { end: i + 1, text: json.slice(start, i + 1) };
    }
    i++;
  }
  return { end: json.length, text: json.slice(start) };
}

function isKeyAfter(json: string, pos: number): boolean {
  let i = pos;
  while (i < json.length && /\s/.test(json[i]!)) i++;
  return json[i] === ':';
}

function readNumber(json: string, start: number): string {
  let i = start;
  if (json[i] === '-') i++;

  while (i < json.length && /\d/.test(json[i]!)) i++;

  if (json[i] === '.') {
    i++;
    while (i < json.length && /\d/.test(json[i]!)) i++;
  }

  if (json[i] === 'e' || json[i] === 'E') {
    i++;
    if (json[i] === '+' || json[i] === '-') i++;
    while (i < json.length && /\d/.test(json[i]!)) i++;
  }

  return json.slice(start, i);
}

export function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let i = 0;

  function push(type: JsonTokenType, text: string): void {
    if (text) tokens.push({ type, text });
  }

  while (i < json.length) {
    const ch = json[i]!;

    if (/\s/.test(ch)) {
      const start = i;
      while (i < json.length && /\s/.test(json[i]!)) i++;
      push('whitespace', json.slice(start, i));
      continue;
    }

    if (ch === '"') {
      const { end, text } = readString(json, i);
      i = end;

      if (isKeyAfter(json, i)) {
        const colonStart = i;
        while (i < json.length && /\s/.test(json[i]!)) i++;
        if (json[i] === ':') {
          i++;
          push('key', text + json.slice(colonStart, i));
        } else {
          push('string', text);
        }
      } else {
        push('string', text);
      }
      continue;
    }

    if (ch === '-' || /\d/.test(ch)) {
      const text = readNumber(json, i);
      push('number', text);
      i += text.length;
      continue;
    }

    if (json.startsWith('true', i)) {
      push('boolean', 'true');
      i += 4;
      continue;
    }

    if (json.startsWith('false', i)) {
      push('boolean', 'false');
      i += 5;
      continue;
    }

    if (json.startsWith('null', i)) {
      push('null', 'null');
      i += 4;
      continue;
    }

    if ('{}[],:'.includes(ch)) {
      push('punctuation', ch);
      i++;
      continue;
    }

    push('string', ch);
    i++;
  }

  return tokens;
}

export function highlightJsonValue(value: unknown): JsonToken[] {
  return tokenizeJson(safeJson(value));
}
