// Gradle build-script text helpers shared by the Release Doctor checks.

/**
 * Gradle (Groovy or Kotlin DSL) source with comments removed. String-aware: `'…'`, `"…"`, `'''…'''` and `"""…"""`
 * (with escapes and Kotlin/Groovy `${…}` templates) are copied verbatim, so `/*` in a glob such as
 * `pickFirst '**\/*.so'` or `//` in a URL is text, not a comment. Block comments become the newlines they spanned, so
 * line-based matching keeps working.
 */
export function stripGradleComments(text: string): string {
  let out = '';
  let index = 0;
  const length = text.length;

  /** Copies the string literal starting at `start` (a quote) and returns the index after it. */
  function copyString(start: number): number {
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
      if (text.startsWith(delimiter, cursor)) {
        cursor += delimiter.length;
        break;
      }
      // `${ … }` template (double-quoted strings): skip the expression, including nested strings and braces.
      if (quote === '"' && char === '$' && text[cursor + 1] === '{') {
        cursor = skipTemplate(cursor + 2);
        continue;
      }
      // An unterminated single-line string ends at the line break (keeps one bad quote from eating the file).
      if (!triple && char === '\n') break;
      cursor++;
    }
    out += text.slice(start, cursor);
    return cursor;
  }

  /** Index after the `}` closing a template whose expression starts at `start`. */
  function skipTemplate(start: number): number {
    let depth = 1;
    let cursor = start;
    while (cursor < length && depth > 0) {
      const char = text[cursor];
      if (char === '"' || char === "'") {
        // Nested string inside the template: measure it without emitting (the outer string is copied as a whole).
        const saved = out;
        cursor = copyString(cursor);
        out = saved;
        continue;
      }
      if (char === '{') depth++;
      else if (char === '}') depth--;
      cursor++;
    }
    return cursor;
  }

  while (index < length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '/' && next === '/') {
      while (index < length && text[index] !== '\n') index++;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      const stop = end < 0 ? length : end + 2;
      out += text.slice(index, stop).replace(/[^\n]/g, '');
      index = stop;
      continue;
    }
    if (char === '"' || char === "'") {
      index = copyString(index);
      continue;
    }
    out += char;
    index++;
  }
  return out;
}
