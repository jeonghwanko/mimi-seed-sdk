// Release Doctor helpers shared by several checks: path containment, text scanning, and file classification.
// Internal to Release Doctor — import the public API (scanReleaseDoctor, report types) from ../release-doctor.js.

import path from 'node:path';

/** Drops comments so a commented-out URL or pin never counts as live evidence. */
export function stripComments(text: string, style: { slash: boolean; hash: boolean }): string {
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trimStart();
    if (style.slash && (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*'))) return '';
    if (style.hash && trimmed.startsWith('#')) return '';
    let result = line;
    // A comment tail starts after whitespace; `https://` and `#fragment` inside a URL are left alone.
    if (style.slash) result = result.replace(/(^|\s)\/\/.*$/, '$1');
    if (style.hash) result = result.replace(/(^|\s)#.*$/, '$1');
    return result;
  }).join('\n');
}

export function isXcodePinFile(name: string, relative: string): boolean {
  return name === '.xcode-version'
    || name === 'Fastfile'
    || name === 'eas.json'
    || name === 'codemagic.yaml'
    || name === 'codemagic.yml'
    || name === 'Jenkinsfile'
    || name === '.gitlab-ci.yml'
    || /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(relative)
    // Composite actions that workflows call (`uses: ./.github/actions/<name>`).
    || /(?:^|\/)\.github\/actions\/(?:[^/]+\/)+action\.ya?ml$/.test(relative)
    || isXcodeCloudScript(relative);
}

/** Xcode Cloud custom build scripts; their presence means the workflow (and Xcode) is set in App Store Connect. */
export function isXcodeCloudScript(relative: string): boolean {
  return /(?:^|\/)ci_scripts\/ci_(?:post_clone|pre_xcodebuild|post_xcodebuild)\.sh$/.test(relative);
}

export function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The Gradle module directory a file belongs to (`app-wearos/src/main/AndroidManifest.xml` -> `app-wearos`). */
export function moduleDir(relative: string): string {
  if (relative.startsWith('src/')) return '.';
  const source = relative.lastIndexOf('/src/');
  return source >= 0 ? relative.slice(0, source) : path.posix.dirname(relative);
}

/**
 * The `{` blocks enclosing `index` in string-masked code (outermost first): each with the word before its brace and
 * the statement head that opens it (`project('…').afterEvaluate`, `def configure()`).
 */
export function enclosingBlocks(masked: string, index: number): Array<{ open: number; opener: string; head: string }> {
  const stack: Array<{ open: number; opener: string; head: string }> = [];
  for (let cursor = 0; cursor < index && cursor < masked.length; cursor++) {
    if (masked[cursor] === '{') {
      const before = masked.slice(Math.max(0, cursor - 200), cursor);
      const head = before.slice(Math.max(before.lastIndexOf('{'), before.lastIndexOf('}'), before.lastIndexOf(';'), before.lastIndexOf('\n')) + 1);
      const opener = before.match(/([A-Za-z_]\w*)\s*(?:\([^()]*\))?\s*$/)?.[1] ?? '';
      stack.push({ open: cursor, opener, head });
    } else if (masked[cursor] === '}') {
      stack.pop();
    }
  }
  return stack;
}

/** End of the expression starting at `from` in masked code: a line break, `;`, or unmatched closer outside brackets. */
export function statementEnd(masked: string, from: number): number {
  let depth = 0;
  for (let cursor = from; cursor < masked.length; cursor++) {
    const char = masked[cursor];
    if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) return cursor;
      depth--;
    } else if ((char === '\n' || char === ';') && depth === 0) return cursor;
  }
  return masked.length;
}

export function isWithin(scope: string, target: string): boolean {
  const relative = path.relative(scope, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** The package folder a node_modules/ path belongs to (`…/node_modules/@scope/name`). */
export function packageDir(file: string): string | undefined {
  const match = file.replace(/\\/g, '/').match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)/);
  return match?.[1];
}
