// Release Doctor Android targetSdk check against the Google Play target API policy.
// Internal to Release Doctor — import the public API (scanReleaseDoctor, report types) from ../release-doctor.js.

import { blankComments, closingBrace, maskStrings } from '../gradle-text.js';
import { type CatalogResolver, type CatalogVersions, type PropertyScope, REACT_NATIVE_CATALOG, catalogValue, catalogVersions, nearestCatalog } from './project.js';
import type { ProjectFile, ReleaseDoctorFinding } from './types.js';
import { enclosingBlocks, escapeRegExp, moduleDir, statementEnd } from './util.js';

const TARGET_SDK_POLICY = [
  { effectiveDate: '2025-08-31', minimum: 35 },
  { effectiveDate: '2026-08-31', minimum: 36 },
] as const;

export const TARGET_SDK_SOURCE = 'https://support.google.com/googleplay/android-developer/answer/11926878';

export function targetPolicy(now: Date): { minimum: number | null; scheduleCurrent: boolean; effectiveDate?: string } {
  const today = now.toISOString().slice(0, 10);
  const current = [...TARGET_SDK_POLICY].filter((row) => row.effectiveDate <= today).at(-1);
  const refreshAfter = `${Number(TARGET_SDK_POLICY.at(-1)!.effectiveDate.slice(0, 4)) + 1}-08-31`;
  return {
    minimum: current?.minimum ?? null,
    scheduleCurrent: today <= refreshAfter,
    effectiveDate: current?.effectiveDate,
  };
}

/** An app module judged against the Target API rule: its build script plus the scripts it `apply from:`s. */
interface TargetSdkModule {
  file: ProjectFile;
  scripts: ProjectFile[];
  /**
   * The module's build-root project script and the scripts it applies: their `subprojects { … }` /
   * `allprojects { … }` blocks (with any `afterEvaluate`, `plugins.withId`, `pluginManager.withPlugin` inside)
   * configure every module, so their targetSdk assignments always count for the module.
   */
  inherited?: ProjectFile[];
  /** Build scripts of the module's parent projects (between the build root and the module): extra properties only. */
  hierarchy?: ProjectFile[];
  /**
   * Scripts the build root applies inside `subprojects { … }` / `allprojects { … }` (`apply from:` there): they run in
   * every module, so all their targetSdk settings count for the module, wherever the script lives.
   */
  everyProject?: ProjectFile[];
  /** `apply from:` references of the module or its build root that could not be read (a URL, a computed path, …). */
  unfollowed?: string[];
}

/** How one judged module's targetSdk was resolved (also in the JSON report as `targetSdkModules`). */
export interface TargetSdkModuleVerdict {
  module: string;
  /** Values the module was proven to use (several with flavors or inherited every-project settings). */
  values: Array<{ value: number; file: string }>;
  /** False when any targetSdk assignment of the module could not be evaluated, or none was found. */
  resolved: boolean;
  /** Why the module is unresolved, as written in the build script. */
  unresolved: string[];
}

/**
 * One `targetSdk` / `targetSdkVersion` / `setTargetSdkVersion` token in a scanned script — the fail-closed net's
 * inventory (in the JSON report as `targetSdkTokens`).
 */
export interface TargetSdkToken {
  file: string;
  line: number;
  /**
   * `assign`: sets targetSdk. `define`: defines an extra property or local of that name (`ext.targetSdkVersion = 36`,
   * `def targetSdk = 36`). `read`: reads it on a right-hand side or as an argument. `other`: lint's or the test
   * runner's own targetSdk. `unknown`: a shape the scanner does not model, which keeps the verdict from TARGET_SDK_OK.
   */
  kind: 'assign' | 'define' | 'read' | 'other' | 'unknown';
  /** The value an `assign` token resolved to, when it did. */
  value?: number;
  /** Evaluated as part of a judged app module (its own scripts or its build root's every-project blocks). */
  attributed: boolean;
  /** Why the script is out of the net (`sample`, `library`, `specialized`, `template`, `outside`). */
  excluded?: string;
}

/** A Gradle script for the net, with the reason it is out of scope (then its tokens are only inventoried). */
interface TargetSdkNetScript {
  file: ProjectFile;
  excluded?: string;
  /** Its build root's scripts, whose extra properties the script sees. */
  inherited?: ProjectFile[];
}

type TargetSdkExpression =
  | { kind: 'literal'; value: number }
  | { kind: 'catalog'; accessor: string; alias: string }
  | { kind: 'name'; name: string; hasDefault: boolean; rootExt: boolean }
  | { kind: 'unknown' };

/** Classifies the right-hand side of a targetSdk assignment; only shapes the scanner fully understands are named. */
function classifyTargetSdk(raw: string): TargetSdkExpression {
  let expression = raw.trim();
  let hasDefault = false;
  for (let previous = ''; previous !== expression;) {
    previous = expression;
    expression = expression
      .replace(/\s+as\s+\w+\??\s*$/, '')
      .replace(/\??\.(?:toInt|toInteger|toString)\(\)\s*$/, '')
      .replace(/^\((.*)\)$/s, '$1')
      .replace(/^(?:java\.lang\.)?Integer\.(?:parseInt|valueOf)\((.*)\)$/s, '$1')
      .trim();
    if (/\?:/.test(expression)) {
      hasDefault = true;
      expression = expression.replace(/\s*\?:.*$/s, '').trim();
    }
    if (/\.(?:getOrElse|orElse)\([^()]*\)$/.test(expression)) {
      hasDefault = true;
      expression = expression.replace(/\.(?:getOrElse|orElse)\([^()]*\)$/, '').trim();
    }
  }
  if (/^\d+$/.test(expression)) return { kind: 'literal', value: Number.parseInt(expression, 10) };
  const catalog = expression.match(/^([A-Za-z_]\w*)\.versions\.([A-Za-z0-9_.-]+?)\.get\(\)$/);
  if (catalog) return { kind: 'catalog', accessor: catalog[1], alias: catalog[2] };
  const name = expression.match(/^(?:(?:rootProject|project)\.)?(?:(?:ext|extra|properties)\.)?([A-Za-z_]\w*)$/)?.[1]
    ?? expression.match(/^(?:(?:rootProject|project)\.)?(?:property|findProperty)\(\s*["']([\w.]+)["']\s*\)$/)?.[1]
    ?? expression.match(/^providers\.gradleProperty\(\s*["']([\w.]+)["']\s*\)(?:\.get\(\))?$/)?.[1]
    ?? expression.match(/^(?:(?:rootProject|project)\.)?(?:ext|extra|properties)\s*\[\s*["']([\w.]+)["']\s*\]$/)?.[1];
  if (name && !['rootProject', 'project', 'ext', 'extra', 'properties', 'true', 'false', 'null'].includes(name)) {
    return { kind: 'name', name, hasDefault, rootExt: /^rootProject\.ext\./.test(expression) };
  }
  return { kind: 'unknown' };
}

/**
 * Configures another project: settings there are not the enclosing module's own. In a project's own script,
 * `allprojects { … }` includes the project itself; in a library script, an `afterEvaluate` may be another project's
 * (`project(':app').afterEvaluate { … }`).
 */
// The Gradle object (`gradle.`, `project.gradle.`, `this.gradle.`, `getGradle().`) reaches every project.
const GRADLE_OBJECT = String.raw`(?:(?<![.\w$])(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:gradle|getGradle\s*\(\s*\))\s*\.|(?<![.\w$])configure\s*\()`;

const CROSS_PROJECT_FROM_SELF = new RegExp(String.raw`\b(?:project\s*\(|findProject\s*\(|rootProject\b|subprojects\b)|${GRADLE_OBJECT}`);

const CROSS_PROJECT_FROM_LIBRARY = new RegExp(String.raw`\b(?:project\s*\(|findProject\s*\(|rootProject\b|allprojects\b|subprojects\b|afterEvaluate\b)|${GRADLE_OBJECT}`);

/** Inside a library-only block, a setting that reaches another project (`project(':app')…`, a bare `configure(…)`). */
const LIBRARY_REACH = new RegExp(String.raw`\b(?:project\s*\(|findProject\s*\(|rootProject\b|allprojects\b|subprojects\b)|${GRADLE_OBJECT}`);

/** A Groovy method declaration head (`def configure()`, `void apply(Project p)`): script locals are not visible in its body. */
const GROOVY_METHOD = /^\s*(?:(?:public|private|protected|static|final|synchronized)\s+)*(?:def|void|int|long|boolean|double|float|short|byte|char|[A-Z]\w*(?:<[^<>]*>)?)\s+[A-Za-z_]\w*\s*\([^()]*\)\s*(?:throws\s+[\w.,\s]+)?$/;

/** Blocks whose `targetSdk` is a different property (lint's and the test runner's), not the app's. */
const OTHER_TARGET_SDK_BLOCKS = new Set(['lint', 'lintOptions', 'testOptions']);

/**
 * The full head of the block opened at `open`: the call or condition right before the brace, joined across lines
 * (`if (a ||\n b) {`, `plugins.withId('…') {`, `} else {`).
 */
function blockHead(masked: string, code: string, open: number): string {
  return code.slice(blockHeadStart(masked, open), open).trim();
}

/** Where the head of the block opened at `open` starts (see `blockHead`). */
function blockHeadStart(masked: string, open: number): number {
  let cursor = open - 1;
  while (cursor >= 0 && /\s/.test(masked[cursor])) cursor--;
  if (masked[cursor] === ')') {
    let depth = 0;
    for (; cursor >= 0; cursor--) {
      if (masked[cursor] === ')') depth++;
      else if (masked[cursor] === '(' && --depth === 0) break;
    }
    cursor--;
  }
  // The receiver chain and keyword before it (`project.plugins.hasPlugin`, `if`, `else if`), also when the chain is
  // split over lines (`project.plugins\n    .withId(…)`).
  for (;;) {
    while (cursor >= 0 && /[\w$.?\t ]/.test(masked[cursor])) cursor--;
    if (masked[cursor] === '\n' && /^\s*\??\./.test(masked.slice(cursor + 1, open))) {
      cursor--;
      continue;
    }
    break;
  }
  return cursor + 1;
}

/**
 * A block that runs only for Android library modules: a single positive `withId` / `withPlugin` / `hasPlugin` whose
 * literal argument is a library plugin id. Anything else — `||`, `&&`, `!`, `else`, a ternary, a non-literal id, or
 * the application id — runs for the app too.
 */
const LIBRARY_PLUGIN_ID_LITERAL = String.raw`["']com\.android\.(?:library|test|fused-library|kotlin\.multiplatform\.library)["']`;

/** Receivers that name the project the script is configuring (implicit receivers); any other name is a variable. */
const SELF_RECEIVERS = new Set(['plugins', 'pluginManager', 'project', 'this']);

/**
 * A single positive check that THIS project has a library plugin: `withId` / `withPlugin` / `hasPlugin` with a
 * literal library id, on no receiver or on the project itself (`plugins.`, `project.plugins.`, `pluginManager.`,
 * `this.`, `it.`, or a closure parameter such as `p.plugins.`). A check on another project (`rootProject.plugins…`,
 * `lib.plugins…` where `lib = project(':lib')`) is not. `receiver` is the explicit variable it was written on
 * (`p`, `it`), when there is one.
 */
function selfLibraryCheck(text: string, receivers: Set<string>): { receiver?: string } | undefined {
  const call = text.trim().replace(/\?\./g, '.').replace(/\s*\.\s*/g, '.');
  const match = call.match(new RegExp(`^(?:([A-Za-z_$][\\w$]*)\\.)?(?:project\\.)?(?:(?:plugins|pluginManager)\\.)?(?:withId|withPlugin|hasPlugin)\\s*\\(\\s*${LIBRARY_PLUGIN_ID_LITERAL}\\s*\\)$`));
  if (!match) return undefined;
  const first = match[1];
  if (first === undefined || SELF_RECEIVERS.has(first)) return {};
  return first === 'it' || receivers.has(first) ? { receiver: first } : undefined;
}

/**
 * The ranges of `structure[from, to)` between top-level (outside parentheses and brackets) matches of `separator`
 * (a sticky regular expression). `structure` is the string-masked code, so brackets in strings never count.
 */
function splitRanges(structure: string, from: number, to: number, separator: RegExp): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let depth = 0;
  let start = from;
  for (let cursor = from; cursor < to; cursor++) {
    const char = structure[cursor];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (depth === 0) {
      separator.lastIndex = cursor;
      const match = separator.exec(structure);
      if (match && match.index === cursor && cursor + match[0].length <= to) {
        ranges.push([start, cursor]);
        start = cursor + match[0].length;
        cursor = start - 1;
      }
    }
  }
  ranges.push([start, to]);
  return ranges;
}

/**
 * A condition that holds only for library projects: a conjunction (`&&`, Kotlin infix `and`) with no top-level `||`,
 * `or` / `xor`, `,` alternative, Elvis `?:`, ternary, or `else`, one of whose conjuncts is a single positive library
 * check of this project (`!a && plugins.hasPlugin(lib)` is library-only; `hasPlugin(app) || hasPlugin(lib)` and
 * `!hasPlugin(lib)` are not). `code` keeps the strings (for the library id), `structure` is the same text with
 * strings and comments blanked (for the operators); both are indexed alike, over `[from, to)`.
 */
function libraryOnlyCondition(code: string, structure: string, from: number, to: number, receivers: Set<string>): { receiver?: string } | undefined {
  const text = structure.slice(from, to);
  if (!text.trim()) return undefined;
  // A condition that names the application plugin (`listOf("com.android.application", …).any { … } && lib`) is
  // never treated as library-only.
  if (/com\.android\.application/.test(code.slice(from, to))) return undefined;
  const alternatives = splitRanges(structure, from, to, /\|\||(?<![\w$])(?:or|xor)(?![\w$])|,/y);
  if (alternatives.length > 1 || /\?:|\belse\b/.test(text) || /\?(?![.:])/.test(text.replace(/\?\./g, ''))) return undefined;
  for (const [start, end] of splitRanges(structure, from, to, /&&|(?<![\w$])and(?![\w$])/y)) {
    const found = selfLibraryCheck(code.slice(start, end).trim().replace(/^\((.*)\)$/s, '$1'), receivers);
    if (found) return found;
  }
  return undefined;
}

/** Names the script binds to the Gradle object (`def g = getGradle()`, `val g = project.gradle`): their calls reach every project. */
function gradleAliases(masked: string): string[] {
  return [...masked.matchAll(/\b(?:def|val|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:(?:project|this)\s*\.\s*)?(?:gradle\b|getGradle\s*\(\s*\))/g)].map((match) => match[1]);
}

/** Parameter names declared by the closure / lambda opened at `open` (`p ->`, `Project p ->`, `def p ->`, `p: Project ->`, `p, q ->`). */
function closureParameters(masked: string, open: number): string[] {
  const header = masked.slice(open + 1, open + 160).match(/^\s*([^{}\n;]*?)->/)?.[1];
  if (header === undefined) return [];
  return header.split(',').map((part) => part.replace(/:[^,]*$/, '').trim().match(/([A-Za-z_$][\w$]*)$/)?.[1])
    .filter((name): name is string => Boolean(name));
}

/** Roots a library-only block may configure through: the project's own DSL objects (never another project's variable). */
const LIBRARY_OWN_ROOTS = new Set(['android', 'extensions', 'project', 'this', 'plugins', 'pluginManager', 'defaultConfig', 'ext', 'java', 'kotlin']);

/** True when the token at `index` (with receiver `chain`) configures another project, or sits inside such a block. */
function crossProjectToken(masked: string, index: number, chain: string, mode: 'self' | 'library'): boolean {
  const base = mode === 'library' ? CROSS_PROJECT_FROM_LIBRARY : CROSS_PROJECT_FROM_SELF;
  const aliases = gradleAliases(masked);
  const pattern = aliases.length === 0 ? base : new RegExp(`${base.source}|\\b(?:${aliases.map(escapeRegExp).join('|')})\\s*\\.`);
  return pattern.test(chain) || pattern.test(statementPrefix(masked, index))
    || enclosingBlocks(masked, index).some((block) => pattern.test(block.head));
}

/** The statement text before `index` (from the last line break, `;`, `{` or `}`): the full receiver of a token. */
function statementPrefix(masked: string, index: number): string {
  const before = masked.slice(Math.max(0, index - 300), index);
  return before.slice(Math.max(before.lastIndexOf('\n'), before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}')) + 1);
}

interface ScannedToken {
  index: number;
  line: number;
  kind: TargetSdkToken['kind'];
  expression?: string;
  release?: number;
  block?: boolean;
  /** The receiver chain written before the token (`android.defaultConfig.`). */
  chain?: string;
}

/** After this on the same line (the last code before a token or its receiver chain), the token is a value being read. */
const READ_CONTEXT = /(?:[=(,+\-*/%<!&|?:[~^]|(?<!-)>|\b(?:return|println|print|assert|logger\.\w+|in|is|as))[ \t]*$/;

/** A previous line ending in one of these continues into the token's line as an argument or right-hand side. */
const ARGUMENT_CONTINUATION = /[=(,[][ \t]*\n\s*$/;

/** A previous line ending in an operator: the token's line may be the rest of an expression the scanner cannot see. */
const OPERATOR_CONTINUATION = /(?:[+\-*/%<!&|?:~^]|(?<!-)>)[ \t]*\n\s*$/;

/** A receiver chain that ends at an extra-properties object (`ext.`, `rootProject.extra.`, `extensions.extraProperties.`). */
const EXTRA_RECEIVER = /(?:^|\.)\s*(?:ext|extra|extraProperties)\s*\.\s*$/;

/**
 * Every `targetSdk`, `targetSdkVersion`, `setTargetSdk(Version)` token of a script, classified.
 *
 * Code tokens (outside strings and comments): assignments — `targetSdk 36` / `targetSdkVersion 36` (Groovy, also
 * after a receiver chain such as `android.defaultConfig.` or `p.android.defaultConfig.`), `targetSdk = x`,
 * `targetSdkVersion(x)` and `setTargetSdkVersion(x)` with balanced parentheses, `targetSdk { version = release(36) }`.
 * Definitions: extra properties (`ext.targetSdkVersion = 36`, inside `ext { }`) and locals (`def`/`val`/`var`).
 * Reads: the token on a right-hand side, in a condition, or as an argument. `other`: lint's and the test runner's own
 * `targetSdk` (`lint { targetSdk 34 }`, `testOptions.targetSdk`). Anything else is `unknown`: a named argument or map
 * key (`f(targetSdk = 33)`, `setProperties(targetSdk: 33)`), `++` / `--` / compound assignment (`targetSdk -= 3`,
 * also on `ext.`), a `targetSdk { … }` block other than `version = release(n)`, a bare statement.
 *
 * String-keyed tokens (`"targetSdk"` / `'targetSdkVersion'` literals): `defaultConfig.setProperty('targetSdk', 33)`,
 * `defaultConfig['targetSdk'] = 33`, `defaultConfig."targetSdk" = 33` are `unknown`; the same keys on an
 * extra-properties receiver (`ext['targetSdkVersion'] = 36`, `extra["targetSdk"]`, `setProperty('targetSdkVersion',
 * 36)` on the project) are definitions or reads.
 */
function targetSdkTokens(text: string): ScannedToken[] {
  // Unity template placeholders (`**TARGETSDKVERSION**`) read as names, not as `*` operators.
  const masked = maskStrings(text).replace(/\*\*[A-Z0-9_]+\*\*/g, (placeholder) => '_'.repeat(placeholder.length));
  const code = blankComments(text);
  const result: ScannedToken[] = [];
  const lineOf = (index: number) => masked.slice(0, index).split('\n').length;
  const pattern = /(?<![\w$])(?:setTargetSdk(?:Version)?|targetSdk(?:Version)?)\b/g;
  let consumed = -1;
  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    if (match.index < consumed) continue;
    const token = match;
    const setter = token[0].startsWith('set');
    const line = lineOf(token.index);
    const chain = masked.slice(Math.max(0, token.index - 200), token.index)
      .match(/((?:[A-Za-z_$][\w$]*\s*(?:\(\s*\))?\s*\??\.\s*)*)$/)?.[1] ?? '';
    const before = masked.slice(Math.max(0, token.index - chain.length - 200), token.index - chain.length);
    const readContext = (READ_CONTEXT.test(before) || ARGUMENT_CONTINUATION.test(before)) && !/(?:\+\+|--)\s*$/.test(before);
    const afterStart = token.index + token[0].length;
    const after = masked.slice(afterStart, afterStart + 200);
    const extraReceiver = EXTRA_RECEIVER.test(chain);
    const parent = enclosingBlocks(masked, token.index).at(-1)?.opener ?? '';
    const inExtBlock = chain === '' && ['ext', 'extra'].includes(parent);
    const push = (row: Omit<ScannedToken, 'index' | 'line'>) => result.push({ index: token.index, line, chain, ...row });

    // `targetSdk++`, `--ext.targetSdkVersion`, `targetSdk -= 3`: a computed change the scanner does not evaluate.
    // After a line ending in an operator, the token may be part of an expression: also not a shape it models.
    if (/(?:\+\+|--)\s*$/.test(before) || (!readContext && OPERATOR_CONTINUATION.test(before)) || /^\s*(?:\+\+|--|(?:[-+*/%&|^]|<<|>>>?)=)/.test(after)) {
      push({ kind: 'unknown', expression: `${chain}${token[0]}${after.match(/^\s*(?:\+\+|--|\S+=)/)?.[0] ?? ''}`.trim() });
      continue;
    }
    if (chain === '' && /\b(?:def|val|var)\s+$/.test(before)) {
      push({ kind: 'define' });
      continue;
    }
    // lint's and the test runner's targetSdk are other properties.
    if (OTHER_TARGET_SDK_BLOCKS.has(chain === '' ? parent : '') || /(?:^|\.)\s*(?:lint|lintOptions|testOptions)\s*\.\s*$/.test(chain)) {
      push({ kind: 'other' });
      continue;
    }
    const assigned = /^\s*=(?!=)\s*/.exec(after);
    if (assigned) {
      const start = afterStart + assigned[0].length;
      const end = statementEnd(masked, start);
      consumed = end;
      if (extraReceiver || inExtBlock) push({ kind: 'define' });
      // `f(targetSdk = 33)` (a named argument of some function) or `x = targetSdk = 33`: not a shape it models.
      else if (setter || readContext) push({ kind: 'unknown' });
      else push({ kind: 'assign', expression: code.slice(start, end).trim() });
      continue;
    }
    // `fun configure(targetSdk: Int)`: a parameter declaration. `setProperties(targetSdk: 33)`: a map key — unknown.
    if (/^\s*:(?!:)/.test(after) && !/\?\s*$/.test(before)) {
      push({ kind: /[(,]\s*$/.test(before) && /^\s*:\s*[A-Z][\w.<>?]*\s*[,)=]/.test(after) ? 'define' : 'unknown' });
      continue;
    }
    if (/^\s*\(/.test(after)) {
      const open = masked.indexOf('(', afterStart);
      const end = statementEnd(masked, open + 1);
      consumed = end + 1;
      if (readContext) push({ kind: 'read' });
      else if (masked[end] === ')' && code.slice(open + 1, end).trim() && !extraReceiver) {
        push({ kind: 'assign', expression: code.slice(open + 1, end).trim() });
      } else push({ kind: 'unknown' });
      continue;
    }
    if (/^\s*\{/.test(after)) {
      const release = code.slice(afterStart).match(/^\s*\{\s*version\s*=\s*release\(\s*(\d+)\s*\)\s*\}/);
      push(release
        ? { kind: 'assign', block: true, release: Number.parseInt(release[1], 10), expression: `targetSdk${release[0].trim()}` }
        : { kind: 'unknown', block: true, expression: 'targetSdk { … }' });
      continue;
    }
    const groovy = /^[ \t]+(?=[^\s=}\]),.?:])/.exec(after);
    if (groovy && !setter && !readContext && !/^[ \t]+(?:as|in|is|instanceof)\b/.test(after)) {
      const start = afterStart + groovy[0].length;
      const end = statementEnd(masked, start);
      consumed = end;
      if (extraReceiver || inExtBlock) push({ kind: 'define' });
      else push({ kind: 'assign', expression: code.slice(start, end).trim() });
      continue;
    }
    // `x = android.defaultConfig.targetSdk`, `foo(targetSdk)`, `targetSdk >= 34`, `targetSdk?.let`: a read.
    if (readContext || /^\s*(?:[.)\],?:+\-*/<>!=&|]|\b(?:as|in|is|instanceof)\b)/.test(after)) {
      push({ kind: 'read' });
      continue;
    }
    push({ kind: 'unknown' });
  }

  // String-keyed property access: the key is invisible in masked code, so read it from the literals themselves.
  for (const literal of code.matchAll(/(["'])(targetSdk(?:Version)?)\1/g)) {
    const index = literal.index;
    // Only a literal the lexer reads as a whole string (not text inside a longer string or a template).
    if (masked[index] !== literal[1] || masked[index + literal[0].length - 1] !== literal[1]) continue;
    if (masked.slice(index + 1, index + literal[0].length - 1).trim() !== '') continue;
    const before = masked.slice(Math.max(0, index - 200), index);
    const after = masked.slice(index + literal[0].length, index + literal[0].length + 80);
    const receiverOf = (tail: RegExp) => before.replace(tail, '').match(/((?:[A-Za-z_$][\w$]*\s*(?:\(\s*\))?\s*\??\.\s*)*[A-Za-z_$][\w$]*)\s*$/)?.[1] ?? '';
    const extra = (receiver: string) => /(?:^|\.)\s*(?:ext|extra|extraProperties|properties)\s*$/.test(receiver);
    const assigned = /^\s*\]?\s*=(?!=)/.test(after);
    let kind: TargetSdkToken['kind'] | undefined;
    if (/\bsetProperty\s*\(\s*$/.test(before)) {
      const receiver = before.match(/((?:[A-Za-z_$][\w$]*\s*\.\s*)*)setProperty\s*\(\s*$/)?.[1].replace(/\s/g, '') ?? '';
      // Receiver-less inside `defaultConfig { }` (or any block but ext/extra), Groovy delegates it to that block's
      // object: `setProperty('targetSdk', 33)` there sets the DSL property itself.
      const block = enclosingBlocks(masked, index).at(-1)?.opener;
      const projectLevel = receiver !== '' || block === undefined || ['ext', 'extra'].includes(block);
      kind = projectLevel && /^(?:(?:rootProject|project)\.)?(?:(?:ext|extra)\.)?$/.test(receiver) ? 'define' : 'unknown';
    } else if (/\[\s*$/.test(before)) {
      kind = extra(receiverOf(/\[\s*$/)) ? (assigned ? 'define' : 'read') : 'unknown';
    } else if (/\.\s*$/.test(before)) {
      kind = extra(receiverOf(/\.\s*$/)) ? (assigned ? 'define' : 'read') : 'unknown';
    }
    if (kind) {
      const restStart = index + literal[0].length;
      const restEnd = statementEnd(masked, restStart);
      // Past the call's `)` or the index's `]` to the end of the statement (`['targetSdk'] = 33`).
      const rest = code.slice(restStart, [')', ']'].includes(masked[restEnd]) ? statementEnd(masked, restEnd + 1) : restEnd);
      const statement = `${before.match(/[\w.$]*[[.(]?\s*$/)?.[0] ?? ''}${literal[0]}${rest}`;
      result.push({ index, line: lineOf(index), kind, expression: statement.trim() });
    }
  }
  return result.sort((left, right) => left.index - right.index);
}

/** Index ranges of `subprojects { … }` / `allprojects { … }` blocks (their nested closures included). */
export function everyProjectBlocks(text: string): Array<readonly [number, number]> {
  const masked = maskStrings(text);
  return [...masked.matchAll(/\b(?:subprojects|allprojects)\s*\{/g)]
    .map((opener) => [opener.index, closingBrace(text, opener.index + opener[0].length - 1)] as const)
    .filter(([, close]) => close >= 0);
}

/**
 * The Target API verdict, fail-closed in two layers.
 *
 * Per module: each judged app module is evaluated on its own scripts AND the `subprojects` / `allprojects` blocks of
 * its build root (with any `afterEvaluate`, `plugins.withId`, `pluginManager.withPlugin` inside); every value found
 * counts, so the lowest wins. A module with any assignment it cannot evaluate — or none at all — is unresolved.
 *
 * Global net: every targetSdk token in the in-scope Gradle scripts (non-sample, non-library, non-specialized:
 * build, settings, applied, and convention scripts) is inventoried. A token of a shape the scanner does not model, or
 * an assignment it cannot attribute to a judged module (a root project's own configuration, `project(':x') { … }`, a
 * settings `gradle.beforeProject`, a convention plugin) whose value is unresolved or below the minimum, keeps the
 * verdict at TARGET_SDK_UNRESOLVED, citing the file and line.
 *
 * INVARIANT: TARGET_SDK_OK only when every judged module resolved AND the net found every in-scope token recognised
 * with every value at or above the minimum. A judged module's proven value below the minimum is a blocker, even next
 * to unresolved modules (blockers win).
 */
export function targetSdkFindings(
  gradleFiles: ProjectFile[],
  now: Date,
  supplementalEvidence: Array<{ file: string; value: number }> = [],
  resolveCatalogs?: CatalogResolver,
  properties?: { scope: PropertyScope; ciOverrides: Set<string>; settingsTexts?: string[] },
  modules: TargetSdkModule[] = [],
  net: TargetSdkNetScript[] = [],
  /** Convention-build roots the walk could not read completely: the net is incomplete there. */
  unreadConventionRoots: string[] = [],
): { findings: ReleaseDoctorFinding[]; modules: TargetSdkModuleVerdict[]; tokens: TargetSdkToken[] } {
  const catalogFiles = gradleFiles.filter((candidate) => candidate.relative.endsWith('.versions.toml'));
  const reactNativeCatalog = catalogFiles.find((candidate) => candidate.relative === REACT_NATIVE_CATALOG);
  const reactNativeValue = reactNativeCatalog ? catalogVersions([reactNativeCatalog], true).get('targetSdk') : undefined;
  const reactNativeTargetSdk = reactNativeValue && /^\d+$/.test(reactNativeValue.value)
    ? { value: Number.parseInt(reactNativeValue.value, 10), file: reactNativeValue.file }
    : undefined;
  const policy = targetPolicy(now);
  const tokenCache = new Map<ProjectFile, ScannedToken[]>();
  const tokensOf = (file: ProjectFile) => {
    let tokens = tokenCache.get(file);
    if (!tokens) {
      tokens = targetSdkTokens(file.text);
      tokenCache.set(file, tokens);
    }
    return tokens;
  };
  // Settings scripts that configure projects (`gradle.beforeProject { p -> p.ext.x = … }`): a name they mention may
  // be set there, out of the scanner's sight.
  const settingsHooks = (properties?.settingsTexts ?? [])
    .filter((text) => /\b(?:beforeProject|afterProject|allprojects|beforeEvaluate|afterEvaluate|projectsLoaded|projectsEvaluated)\b/.test(text));

  /**
   * Definitions of a name in the module's own project hierarchy (its scripts, its parent projects' scripts, its build
   * root's scripts): extra properties (`ext.x = 36`, `ext["x"] = 36`, `ext { x = 36 }`, `extra["x"] = 36`,
   * `set("x", 36)`, `val x by extra(36)`) and local declarations (`def/val/var x …`), with their position.
   */
  const definitions = (name: string, scripts: ProjectFile[]) => {
    const quoted = escapeRegExp(name);
    const rows: Array<{ value?: number; file: string }> = [];
    const locals: Array<{ tail: string; file: ProjectFile; index: number }> = [];
    const add = (raw: string, file: string) => {
      const value = raw.trim();
      rows.push({ value: /^\d+$/.test(value) ? Number.parseInt(value, 10) : undefined, file });
    };
    for (const file of new Set(scripts)) {
      const code = blankComments(file.text);
      for (const local of code.matchAll(new RegExp(`\\b(?:def|val|var)\\s+${quoted}\\b([^\\n;]*)`, 'g'))) {
        const extra = local[1].match(/^\s*(?::\s*[\w?<>.]+\s*)?by\s+extra\s*\(\s*(.*?)\s*\)\s*$/);
        if (extra) add(extra[1], file.relative);
        else locals.push({ tail: local[1], file, index: local.index });
      }
      for (const pattern of [
        new RegExp(`\\b(?:ext|extra|extraProperties)\\.${quoted}\\s*=(?!=)\\s*([^\\n;]+)`, 'g'),
        new RegExp(`\\b(?:ext|extra|extraProperties)\\s*\\[\\s*["']${quoted}["']\\s*\\]\\s*=(?!=)\\s*([^\\n;]+)`, 'g'),
        new RegExp(`\\b(?:set|setProperty)\\s*\\(\\s*["']${quoted}["']\\s*,\\s*([^)\\n]+)\\)`, 'g'),
      ]) {
        for (const match of code.matchAll(pattern)) {
          // A receiver-less `setProperty(…)` inside a DSL block sets that block's property, not an extra property.
          if (/^setProperty/.test(match[0]) && !/\.\s*$/.test(code.slice(Math.max(0, match.index - 40), match.index))) {
            const block = enclosingBlocks(maskStrings(file.text), match.index).at(-1)?.opener;
            if (block !== undefined && !['ext', 'extra'].includes(block)) continue;
          }
          add(match[1], file.relative);
        }
      }
      // `ext.x -= 3`, `ext.x++`, `--ext.x`: a computed change — the property is no longer a plain number.
      const changed = new RegExp(`\\b(?:ext|extra|extraProperties)\\s*\\.\\s*${quoted}\\s*(?:\\+\\+|--|(?:[-+*/%&|^]|<<|>>>?)=)|(?:\\+\\+|--)\\s*(?:[\\w$]+\\s*\\.\\s*)*(?:ext|extra|extraProperties)\\s*\\.\\s*${quoted}\\b`, 'g');
      for (const _ of maskStrings(file.text).matchAll(changed)) add('changed', file.relative);
      for (const opener of code.matchAll(/\b(?:ext|extra)\s*\{/g)) {
        const open = opener.index + opener[0].length - 1;
        const close = closingBrace(code, open);
        const body = close < 0 ? '' : code.slice(open + 1, close);
        for (const match of body.matchAll(new RegExp(`(?:^|[\\s;])${quoted}\\s*=(?!=)\\s*([^\\n;}]+)`, 'g'))) add(match[1], file.relative);
      }
    }
    return { rows, locals };
  };

  /**
   * A Gradle/extra property as the module sees it. Unresolved when CI overrides it, a project-configuring settings
   * script mentions it, any definition is not a plain number, or sources disagree; undefined when nothing in scope
   * defines it.
   */
  const resolveProperty = (module: ProjectFile, name: string, rows: Array<{ value?: number; file: string }>) => {
    if (properties?.ciOverrides.has(name)) return 'unresolved' as const;
    if (settingsHooks.some((text) => new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`).test(text))) return 'unresolved' as const;
    if (rows.some((row) => row.value === undefined)) return 'unresolved' as const;
    const candidates = rows.map((row) => ({ value: row.value!, file: row.file }));
    const property = properties?.scope(module).get(name);
    if (property === null) return 'unresolved' as const;
    if (property) {
      if (!/^\d+$/.test(property.value)) return 'unresolved' as const;
      candidates.push({ value: Number.parseInt(property.value, 10), file: property.file });
    }
    if (candidates.length === 0) return undefined;
    return new Set(candidates.map((row) => row.value)).size === 1 ? candidates[0] : 'unresolved' as const;
  };

  /**
   * A name used as targetSdk at `use`. A local is followed only when it is the name's single declaration, in the same
   * script, declared BEFORE the use, at depth 0 or in a block that encloses the use (Groovy/Kotlin scoping): then a
   * plain number, a catalog version, or a plain property alias (`val x: String by project`,
   * `def x = project.property('x') as int`, `= findProperty('x')`, `= providers.gradleProperty('x').get()`).
   */
  const nameRegExp = (name: string) => escapeRegExp(name);
  const resolveName = (
    module: TargetSdkModule,
    name: string,
    visible: Map<string, CatalogVersions | null>,
    use: { script: ProjectFile; index: number },
    depth = 0,
  ): { value: number; file: string } | 'unresolved' | undefined => {
    if (depth > 4) return 'unresolved';
    const { rows, locals } = definitions(name, [...module.scripts, ...(module.inherited ?? []), ...(module.hierarchy ?? [])]);
    if (locals.length > 1) return 'unresolved';
    if (locals.length === 1) {
      const { tail, file, index } = locals[0];
      if (file !== use.script) return 'unresolved';
      const masked = maskStrings(file.text);
      const declaredIn = enclosingBlocks(masked, index);
      const usedIn = enclosingBlocks(masked, use.index);
      const shared = declaredIn.findIndex((block, position) => usedIn[position]?.open !== block.open);
      const common = shared < 0 ? declaredIn.length : shared;
      // A Groovy method body does not see the script's locals: there the name is the project property.
      if (!/\.kts?$/.test(file.relative) && usedIn.slice(common).some((block) => GROOVY_METHOD.test(block.head))) {
        return resolveProperty(module.file, name, rows);
      }
      if (index > use.index || common < declaredIn.length) return 'unresolved';
      // Reassigned anywhere in the script (`x = 33`, `x++`, `x -= 3`, also in a branch or a later closure): unresolved.
      const declaration = masked.indexOf(name, index);
      const reassigned = new RegExp(`(?<![\\w$.])${nameRegExp(name)}\\s*(?:\\+\\+|--|(?:[-+*/%&|^]|<<|>>>?)?=(?!=))|(?:\\+\\+|--)\\s*${nameRegExp(name)}(?![\\w$])`, 'g');
      if ([...masked.matchAll(reassigned)].some((match) => match.index !== declaration)) return 'unresolved';
      if (/^\s*(?::\s*[\w?<>.]+\s*)?by\s+project\b/.test(tail)) return resolveProperty(module.file, name, rows);
      const assigned = tail.match(/^\s*(?::\s*[\w?<>.]+\s*)?=\s*(.+)$/)?.[1];
      const alias = assigned ? classifyTargetSdk(assigned) : undefined;
      if (alias?.kind === 'literal' && rows.length === 0) return { value: alias.value, file: file.relative };
      if (alias?.kind === 'catalog' && rows.length === 0) {
        const row = catalogValue(visible, alias.accessor, alias.alias);
        return row && /^\d+$/.test(row.value) ? { value: Number.parseInt(row.value, 10), file: row.file } : 'unresolved';
      }
      if (alias?.kind !== 'name' || alias.hasDefault) return 'unresolved';
      if (alias.name === name) return resolveProperty(module.file, name, rows);
      return resolveName(module, alias.name, visible, use, depth + 1);
    }
    return resolveProperty(module.file, name, rows);
  };

  const visibleFor = (file: ProjectFile): Map<string, CatalogVersions | null> => {
    if (resolveCatalogs) return resolveCatalogs(file);
    const nearest = nearestCatalog(file, catalogFiles);
    return new Map(nearest ? [['libs', catalogVersions([nearest], true)]] : []);
  };

  /** The value of one assignment token, or why it is unresolved (as written, with file and line). */
  const valueOf = (module: TargetSdkModule, script: ProjectFile, token: ScannedToken): { value: number; file: string } | string => {
    const label = `${token.kind === 'assign' && !token.block ? `targetSdk = ${token.expression}` : token.expression ?? 'targetSdk'} (${script.relative}:${token.line})`;
    if (token.kind !== 'assign') return label;
    if (token.block) return token.release === undefined ? label : { value: token.release, file: script.relative };
    const expression = classifyTargetSdk(token.expression ?? '');
    if (expression.kind === 'literal') return { value: expression.value, file: script.relative };
    const visible = visibleFor(module.file);
    if (expression.kind === 'catalog') {
      const row = catalogValue(visible, expression.accessor, expression.alias);
      return row && /^\d+$/.test(row.value) ? { value: Number.parseInt(row.value, 10), file: row.file } : label;
    }
    if (expression.kind === 'name') {
      // `findProperty("x") ?: N`: N is never evidence; only the property itself, when in scope, decides.
      const resolved = resolveName(module, expression.name, visible, { script, index: token.index });
      if (resolved && resolved !== 'unresolved') return resolved;
      if (resolved === undefined && expression.rootExt && expression.name === 'targetSdkVersion' && reactNativeTargetSdk) {
        return reactNativeTargetSdk;
      }
    }
    return label;
  };

  const inventory = new Map<string, TargetSdkToken>();
  const record = (script: ProjectFile, token: ScannedToken, row: Omit<TargetSdkToken, 'file' | 'line' | 'kind'>) => {
    const key = `${script.absolute}\u0000${token.index}`;
    if (inventory.get(key)?.attributed) return;
    inventory.set(key, { file: script.relative, line: token.line, kind: token.kind, ...row });
  };

  // `plugins.withId('com.android.library') { … }` (or withPlugin / hasPlugin) configures libraries only: those
  // settings are inventoried as library settings, never as an app's.
  const libraryOnlyTokens = new Set<string>();
  const libraryOnly = (script: ProjectFile, token: ScannedToken) => {
    const masked = maskStrings(script.text);
    const code = blankComments(script.text);
    const blocks = enclosingBlocks(masked, token.index);
    // Closure parameters of the enclosing blocks (`subprojects { p -> … }`, `{ Project p -> … }`, `{ p: Project -> … }`):
    // `p.plugins.hasPlugin(…)` checks this project.
    const receivers = new Set(blocks.flatMap((block) => closureParameters(masked, block.open)));
    // `if (…) {`, `else if (…) {`, or the call itself (`plugins.withId('…') {`).
    const headOnly = (open: number) => {
      const start = blockHeadStart(masked, open);
      const head = code.slice(start, open).trim();
      const conditionOpen = head.match(/^(?:else\s+)?if\s*\(/);
      if (!conditionOpen) return selfLibraryCheck(head, receivers);
      const from = start + code.slice(start, open).indexOf('(') + 1;
      const to = masked.lastIndexOf(')', open);
      return to > from ? libraryOnlyCondition(code, masked, from, to, receivers) : undefined;
    };
    // A subject-less Kotlin `when { cond -> … }` branch. FAIL-CLOSED: the condition starts where the previous branch
    // clearly ended (a line with `->` or ending in `}`, or the `when {` line with nothing after the brace); any
    // other preceding line — a comment-separated or blank-separated continuation, an infix `or`, anything unexpected
    // — is read as part of the condition, which then counts for the app.
    const branchOnly = (at: number) => {
      const lineStart = masked.lastIndexOf('\n', at - 1) + 1;
      const arrow = masked.slice(lineStart, at).lastIndexOf('->');
      if (arrow < 0) return undefined;
      const end = lineStart + arrow;
      // The arrow must belong to this branch: nothing that ends a statement or block between it and `at`.
      if (/[;}]/.test(masked.slice(end + 2, at))) return undefined;
      const when = enclosingBlocks(masked, end).at(-1);
      if (!when || blockHead(masked, code, when.open) !== 'when') return undefined;
      // The `when` must enclose `at` (a `when { … }` already closed earlier on the line is not this branch).
      if (!enclosingBlocks(masked, at).some((block) => block.open === when.open)) return undefined;
      let start = Math.max(lineStart, when.open + 1);
      // The arrow's own line may hold the end of an earlier branch before the condition.
      if (/->|[;}]/.test(masked.slice(start, end))) return undefined;
      for (let guard = 0; guard < 200; guard++) {
        const lines = masked.slice(when.open + 1, start).split('\n');
        let offset = when.open + 1;
        const starts = lines.map((line) => {
          const here = offset;
          offset += line.length + 1;
          return here;
        });
        let index = lines.length - 1;
        while (index >= 0 && !lines[index].trim()) index--;
        if (index < 0) break;
        const previous = lines[index].trim();
        const operatorEnd = /(?:\|\||&&|[,(!.|&]|\?:|\?\.|(?<![\w$])(?:or|and|xor))$/.test(previous);
        if (!operatorEnd && (previous.includes('->') || previous.endsWith('}'))) break;
        start = starts[index];
      }
      return libraryOnlyCondition(code, masked, start, end, receivers);
    };
    let library: { index: number; receiver?: string } | undefined;
    blocks.some((block, index) => {
      const found = headOnly(block.open) ?? branchOnly(block.open);
      if (found) library = { index, receiver: found.receiver };
      return Boolean(found);
    });
    // A `when` branch without braces: `plugins.hasPlugin("com.android.library") -> android.defaultConfig.targetSdk = 30`.
    if (!library) {
      const found = branchOnly(token.index);
      if (found) library = { index: blocks.length, receiver: found.receiver };
    }
    if (!library) return false;
    // Inside it, a setting that reaches another project (`project(':app').android…`, `p.gradle.…`, a Gradle-object
    // alias) configures that project.
    const reach = new RegExp(`${LIBRARY_REACH.source}${gradleAliases(masked).map((name) => `|\\b${escapeRegExp(name)}\\s*\\.`).join('')}`);
    const heads = blocks.slice(library.index + 1).map((block) => block.head);
    if (reach.test(token.chain ?? '') || reach.test(statementPrefix(masked, token.index)) || heads.some((head) => reach.test(head))) return false;
    // A check on one project must configure that same project: `it.plugins.hasPlugin(lib)` guarding `self.android…`
    // or `q.android…` is about another project.
    if (library.receiver !== undefined) {
      const roots = [token.chain ?? '', statementPrefix(masked, token.index), ...heads]
        .map((text) => text.trim().match(/^([A-Za-z_$][\w$]*)\s*\??\./)?.[1])
        .filter((root): root is string => Boolean(root));
      if (roots.some((root) => root !== library!.receiver && !LIBRARY_OWN_ROOTS.has(root))) return false;
    }
    return true;
  };

  const evaluate = (module: TargetSdkModule): TargetSdkModuleVerdict => {
    const verdict: TargetSdkModuleVerdict = { module: moduleDir(module.file.relative), values: [], resolved: true, unresolved: [] };
    let assignments = 0;
    const consider = (script: ProjectFile, token: ScannedToken) => {
      if (token.kind === 'read' || token.kind === 'define' || token.kind === 'other') {
        record(script, token, { attributed: true });
        return;
      }
      assignments++;
      const result = valueOf(module, script, token);
      if (typeof result === 'string') {
        verdict.resolved = false;
        verdict.unresolved.push(result);
        record(script, token, { attributed: true });
      } else {
        verdict.values.push(result);
        record(script, token, { attributed: true, value: result.value });
      }
    };
    for (const reference of module.unfollowed ?? []) {
      verdict.resolved = false;
      verdict.unresolved.push(`${reference} could not be read`);
    }
    for (const script of new Set(module.scripts)) {
      const masked = maskStrings(script.text);
      for (const token of tokensOf(script)) {
        // `project(':wear') { … }` in the app's script configures another project: left to the net.
        if (!crossProjectToken(masked, token.index, token.chain ?? '', 'self')) consider(script, token);
      }
    }
    // Scripts the build root applies to every project count whole, except their library-only blocks.
    for (const script of new Set(module.everyProject ?? [])) {
      if (module.scripts.includes(script)) continue;
      for (const token of tokensOf(script)) {
        if (libraryOnly(script, token)) libraryOnlyTokens.add(`${script.absolute}\u0000${token.index}`);
        else consider(script, token);
      }
    }
    // The build root's every-project configuration always counts — a root `afterEvaluate` or `plugins.withId` may
    // override what the module sets.
    for (const script of new Set(module.inherited ?? [])) {
      if (module.scripts.includes(script) || (module.everyProject ?? []).includes(script)) continue;
      const ranges = everyProjectBlocks(script.text);
      for (const token of tokensOf(script)) {
        if (!ranges.some(([open, close]) => token.index > open && token.index < close)) continue;
        if (libraryOnly(script, token)) libraryOnlyTokens.add(`${script.absolute}\u0000${token.index}`);
        else consider(script, token);
      }
    }
    if (assignments === 0) {
      verdict.resolved = false;
      verdict.unresolved.push(`no targetSdk assignment in ${module.file.relative} or the scripts it applies`);
    }
    return verdict;
  };

  const verdicts = modules.map(evaluate);

  // The net: every other token in scope. The module and inherited scripts are the same objects evaluated above, so
  // their tokens are matched by position; any token left over is not attributable to one judged module.
  const used = new Map(modules.flatMap((module) => [...module.scripts, ...(module.inherited ?? []), ...(module.everyProject ?? [])])
    .map((file) => [file.absolute, file]));
  const netScripts = new Map<string, TargetSdkNetScript>();
  // A script a judged module or its build root applies is never out of scope, wherever it lives (a vendored or
  // submodule `shared/android-defaults.gradle`).
  for (const entry of net) {
    const file = used.get(entry.file.absolute);
    netScripts.set(entry.file.absolute, file ? { ...entry, file, excluded: undefined } : entry);
  }
  for (const file of used.values()) if (!netScripts.has(file.absolute)) netScripts.set(file.absolute, { file });
  const netIssues: string[] = unreadConventionRoots.map((dir) => `${dir} (a convention build too large to read completely)`);
  for (const { file: script, excluded: scriptExcluded, inherited } of netScripts.values()) {
    const masked = maskStrings(script.text);
    for (const token of tokensOf(script)) {
      if (inventory.get(`${script.absolute}\u0000${token.index}`)?.attributed) continue;
      let excluded = scriptExcluded;
      // A library or Wear module that configures another project (`project(':app').afterEvaluate { … }`) stays in.
      if ((excluded === 'library' || excluded === 'specialized') && crossProjectToken(masked, token.index, token.chain ?? '', 'library')) excluded = undefined;
      if (!excluded && libraryOnlyTokens.has(`${script.absolute}\u0000${token.index}`)) excluded = 'library';
      // Unity templates: only a `**PLACEHOLDER**` value is Unity's to fill; a literal in the template counts.
      if (!excluded && token.kind === 'assign' && /^\*\*[A-Z0-9_]+\*\*$/.test(token.expression ?? '')) excluded = 'template';
      if (excluded || token.kind === 'read' || token.kind === 'define' || token.kind === 'other') {
        record(script, token, { attributed: false, ...(excluded ? { excluded } : {}) });
        continue;
      }
      const result = valueOf({ file: script, scripts: [script], inherited }, script, token);
      if (typeof result === 'string') {
        netIssues.push(token.kind === 'unknown'
          ? `${script.relative}:${token.line} (a targetSdk use the scanner does not model)`
          : `${script.relative}:${token.line} (${result.replace(/ \([^()]*\)$/, '')}, not attributable to one app module)`);
        record(script, token, { attributed: false });
      } else {
        if (policy.minimum !== null && result.value < policy.minimum) {
          netIssues.push(`${script.relative}:${token.line} (targetSdk ${result.value}, not attributable to one app module)`);
        }
        record(script, token, { attributed: false, value: result.value });
      }
    }
  }
  const tokens = [...inventory.values()].sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);

  // Without a Gradle app module (Expo CNG, Unity), the supplemental evidence alone decides.
  const values = [...supplementalEvidence, ...verdicts.flatMap((verdict) => verdict.values)];
  const unresolvedModules = verdicts.filter((verdict) => !verdict.resolved);

  if (!policy.scheduleCurrent || policy.minimum === null) {
    return { modules: verdicts, tokens, findings: [{
      code: 'TARGET_SDK_POLICY_REFRESH_REQUIRED',
      severity: 'warning',
      title: 'Target API policy table needs a refresh',
      detail: 'The embedded Google Play Target API schedule is no longer current enough for a definitive result.',
      action: 'Check the current Google Play Target API requirement before submission.',
      sourceUrl: TARGET_SDK_SOURCE,
      ko: {
        title: 'Target API 정책표 갱신 필요',
        detail: '내장된 Google Play Target API 일정만으로는 현재 제출 요건을 확정할 수 없습니다.',
        action: '제출 전에 최신 Google Play Target API 요구사항을 확인하세요.',
      },
    }] };
  }

  // Blockers win: a value proven below the minimum for a judged module is reported even next to unresolved ones.
  const below = values.filter((row) => row.value < policy.minimum!);
  if (below.length > 0) {
    const first = [...below].sort((left, right) => left.value - right.value)[0];
    return { modules: verdicts, tokens, findings: [{
      code: 'TARGET_SDK_BELOW_MINIMUM',
      severity: 'blocker',
      title: `Android targetSdk ${first.value} is below the submission minimum`,
      detail: `Google Play requires targetSdk ${policy.minimum} or newer for new apps and updates after ${policy.effectiveDate}.`,
      action: `Upgrade targetSdk to ${policy.minimum} or newer and test the release build.`,
      file: first.file,
      sourceUrl: TARGET_SDK_SOURCE,
      ko: {
        title: `Android targetSdk ${first.value}은 현재 제출 기준 미달`,
        detail: `${policy.effectiveDate} 이후 신규 앱과 업데이트는 targetSdk ${policy.minimum} 이상이어야 합니다.`,
        action: `targetSdk를 ${policy.minimum} 이상으로 올리고 릴리스 빌드를 테스트하세요.`,
      },
    }] };
  }

  if (unresolvedModules.length > 0 || netIssues.length > 0 || values.length === 0) {
    const reasons = [
      ...unresolvedModules.flatMap((verdict) => verdict.unresolved.map((reason) => `${verdict.module}: ${reason}`)),
      ...netIssues,
    ];
    const listed = reasons.length > 3 ? `${reasons.slice(0, 3).join('; ')}; +${reasons.length - 3}` : reasons.join('; ');
    return { modules: verdicts, tokens, findings: [{
      code: 'TARGET_SDK_UNRESOLVED',
      severity: 'warning',
      title: 'Android targetSdk could not be resolved locally',
      detail: listed
        ? `Not every targetSdk setting could be evaluated from the repository: ${listed}.`
        : 'No literal targetSdk value was found in the scanned Gradle files.',
      action: `Resolve the release variant and confirm targetSdk ${policy.minimum} or newer before submission.`,
      sourceUrl: TARGET_SDK_SOURCE,
      ko: {
        title: 'Android targetSdk 값을 로컬에서 확정하지 못함',
        detail: listed
          ? `저장소만으로 계산할 수 없는 targetSdk 설정이 있습니다: ${listed}.`
          : '검사한 Gradle 파일에서 숫자로 된 targetSdk 값을 찾지 못했습니다.',
        action: `릴리스 variant의 값을 확인해 targetSdk ${policy.minimum} 이상인지 검증하세요.`,
      },
    }] };
  }

  const lowest = [...values].sort((left, right) => left.value - right.value)[0];
  return { modules: verdicts, tokens, findings: [{
    code: 'TARGET_SDK_OK',
    severity: 'info',
    title: `Android targetSdk ${lowest.value} meets the current minimum`,
    detail: `Every app module's targetSdk was resolved and every targetSdk setting in scope was recognised; the lowest is at least ${policy.minimum}.`,
    file: lowest.file,
    sourceUrl: TARGET_SDK_SOURCE,
    ko: {
      title: `Android targetSdk ${lowest.value}은 현재 제출 기준 충족`,
      detail: `모든 앱 모듈의 targetSdk를 확인했고 검사 범위의 targetSdk 설정을 모두 인식했으며, 가장 낮은 값이 현재 최소값 ${policy.minimum} 이상입니다.`,
    },
  }] };
}
