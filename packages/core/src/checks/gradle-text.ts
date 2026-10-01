// Gradle build-script text helpers shared by the Release Doctor checks.

/** Characters after which a Groovy `/` starts a slashy string rather than a division (`~ = ( , :` and `?:`). */
const SLASHY_CONTEXT = new Set(['~', '=', '(', ',', ':', '?']);

/**
 * Scans Gradle (Groovy or Kotlin DSL) source and reports each token span to `visit`: `code` (outside strings and
 * comments), `string` (any string literal, copied verbatim), or `comment`. String-aware: `'…'`, `"…"`, `'''…'''`,
 * `"""…"""` (escapes, `${…}` templates with nested strings), Groovy slashy `/…/` (after `~ = ( , :` or `?:`, as in
 * `exclude group: /a{/`) and dollar-slashy `$/…/$` strings. Degrades safely: an unterminated single-line string or
 * template ends at the line break, and a `/*` with no closing `*\/` is text, not a comment that deletes the rest of
 * the file.
 */
function scanGradle(text: string, visit: (kind: 'code' | 'string' | 'comment', start: number, end: number) => void): void {
  const length = text.length;

  /** Index after the string literal starting at `start` (a quote). */
  function stringEnd(start: number): number {
    const quote = text[start];
    const triple = text.startsWith(quote.repeat(3), start);
    const delimiter = triple ? quote.repeat(3) : quote;
    let cursor = start + delimiter.length;
    while (cursor < length) {
      const char = text[cursor];
      if (char === '\\' && !triple) {
        cursor += 2;
        continue;
      }
      if (text.startsWith(delimiter, cursor)) return cursor + delimiter.length;
      if (quote === '"' && char === '$' && text[cursor + 1] === '{') {
        cursor = templateEnd(cursor + 2, !triple);
        continue;
      }
      if (!triple && char === '\n') return cursor;
      cursor++;
    }
    return cursor;
  }

  /** Index after the `}` closing a template expression starting at `start` (or at the line break, single-line). */
  function templateEnd(start: number, singleLine: boolean): number {
    let depth = 1;
    let cursor = start;
    while (cursor < length && depth > 0) {
      const char = text[cursor];
      if (singleLine && char === '\n') return cursor;
      if (char === '"' || char === "'") {
        cursor = stringEnd(cursor);
        continue;
      }
      if (char === '{') depth++;
      else if (char === '}') depth--;
      cursor++;
    }
    return cursor;
  }

  let index = 0;
  let codeStart = 0;
  let lastSignificant = '';
  const flushCode = (end: number) => {
    if (end > codeStart) visit('code', codeStart, end);
  };
  while (index < length) {
    const char = text[index];
    const next = text[index + 1];
    let tokenEnd = -1;
    let kind: 'string' | 'comment' = 'string';
    if (char === '/' && next === '/') {
      tokenEnd = text.indexOf('\n', index);
      if (tokenEnd < 0) tokenEnd = length;
      kind = 'comment';
    } else if (char === '/' && next === '*') {
      const close = text.indexOf('*/', index + 2);
      if (close >= 0) {
        tokenEnd = close + 2;
        kind = 'comment';
      }
    } else if (char === '"' || char === "'") {
      tokenEnd = stringEnd(index);
    } else if (char === '$' && next === '/') {
      const close = text.indexOf('/$', index + 2);
      if (close >= 0) tokenEnd = close + 2;
    } else if (char === '/' && SLASHY_CONTEXT.has(lastSignificant)) {
      let cursor = index + 1;
      while (cursor < length && text[cursor] !== '/') cursor += text[cursor] === '\\' ? 2 : 1;
      if (cursor < length) tokenEnd = cursor + 1;
    }
    if (tokenEnd < 0) {
      if (!/\s/.test(char)) lastSignificant = char;
      index++;
      continue;
    }
    flushCode(index);
    visit(kind, index, tokenEnd);
    if (kind === 'string') lastSignificant = '"';
    index = tokenEnd;
    codeStart = tokenEnd;
  }
  flushCode(length);
}

/**
 * Gradle source with comments removed and strings kept verbatim, so `/*` in a glob such as `pickFirst '**\/*.so'`
 * or `//` in a URL is text, not a comment. Block comments become the newlines they spanned, so line-based matching
 * keeps working.
 */
export function stripGradleComments(text: string): string {
  let out = '';
  scanGradle(text, (kind, start, end) => {
    const slice = text.slice(start, end);
    out += kind === 'comment' ? slice.replace(/[^\n]/g, '') : slice;
  });
  return out;
}

/** Gradle source with comments blanked to spaces (same length and line breaks, so indexes still line up). */
export function blankComments(text: string): string {
  let out = '';
  scanGradle(text, (kind, start, end) => {
    const slice = text.slice(start, end);
    out += kind === 'comment' ? slice.replace(/[^\n]/g, ' ') : slice;
  });
  return out;
}

/**
 * Gradle source with comments and string contents blanked (same length, line breaks kept): only code is left to
 * match tokens against, so `"targetSdk 33"` in a string or a comment is never read as an assignment. Each string
 * literal keeps its first and last character so `x = "…"` still shows a value is there.
 */
export function maskStrings(text: string): string {
  let out = '';
  scanGradle(text, (kind, start, end) => {
    const slice = text.slice(start, end);
    if (kind === 'code') out += slice;
    else if (kind === 'comment' || slice.length < 2) out += slice.replace(/[^\n]/g, ' ');
    else out += slice[0] + slice.slice(1, -1).replace(/[^\n]/g, ' ') + slice.at(-1);
  });
  return out;
}

/**
 * Like `maskStrings`, but string literals for which `keep(literal)` is true stay verbatim (`literal` includes its
 * quotes). Comments are blanked. Same length and line breaks as `text`.
 */
export function keepStrings(text: string, keep: (literal: string) => boolean): string {
  let out = '';
  scanGradle(text, (kind, start, end) => {
    const slice = text.slice(start, end);
    if (kind === 'code' || (kind === 'string' && keep(slice))) out += slice;
    else if (kind === 'comment' || slice.length < 2) out += slice.replace(/[^\n]/g, ' ');
    else out += slice[0] + slice.slice(1, -1).replace(/[^\n]/g, ' ') + slice.at(-1);
  });
  return out;
}

/**
 * Index of the `}` that closes the `{` at `open`, counting braces only in code (not inside strings or comments);
 * -1 when it is never closed.
 */
export function closingBrace(text: string, open: number): number {
  let depth = 0;
  let result = -1;
  scanGradle(text.slice(open), (kind, start, end) => {
    if (kind !== 'code' || result >= 0) return;
    for (let index = start; index < end; index++) {
      const char = text[open + index];
      if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        result = open + index;
        return;
      }
    }
  });
  return result;
}

/** `text` without every block opened by `opener` (a regex ending at `{`), braces matched with `closingBrace`. */
export function removeBlocks(text: string, opener: RegExp): string {
  let result = text;
  for (;;) {
    const start = new RegExp(opener.source).exec(result);
    if (!start) return result;
    const close = closingBrace(result, start.index + start[0].length - 1);
    // An unclosed block (malformed or truncated script) loses only its opener, never the rest of the file.
    result = result.slice(0, start.index) + result.slice(close < 0 ? start.index + start[0].length : close + 1);
  }
}

/** The contents of the first block opened by `opener` (a regex ending at `{`), or undefined. */
export function blockContents(text: string, opener: RegExp): string | undefined {
  const start = new RegExp(opener.source).exec(text);
  if (!start) return undefined;
  const open = start.index + start[0].length - 1;
  const close = closingBrace(text, open);
  return close < 0 ? undefined : text.slice(open + 1, close);
}
