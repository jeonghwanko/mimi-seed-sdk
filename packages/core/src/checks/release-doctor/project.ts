// Release Doctor project detection: platform/framework, Android application IDs, iOS bundle IDs.
// Internal to Release Doctor — import the public API (scanReleaseDoctor, report types) from ../release-doctor.js.

import fs from 'node:fs/promises';
import path from 'node:path';
import { blockContents, closingBrace, keepStrings, maskStrings, removeBlocks, stripGradleComments } from '../gradle-text.js';
import { readText } from '../lockfile.js';
import type { ProjectFile } from './types.js';
import { enclosingBlocks, isWithin, isXcodePinFile, moduleDir, statementEnd, unique } from './util.js';

function unityApplicationIdentifiers(text: string): { android?: string; ios?: string } {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*applicationIdentifier:\s*$/.test(line));
  if (start < 0) return {};
  const baseIndent = lines[start].match(/^\s*/)?.[0].length ?? 0;
  const result: { android?: string; ios?: string } = {};
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= baseIndent) break;
    const entry = line.match(/^\s+(Android|iPhone|iOS):\s*([^\s#]+)\s*$/);
    if (entry?.[1] === 'Android') result.android = entry[2];
    if (entry && entry[1] !== 'Android') result.ios = entry[2];
  }
  return result;
}

async function readStaticJsonImports(file: ProjectFile, root: string): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();
  const imports = [
    ...file.text.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.json)['"]/g),
    ...file.text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+\.json)['"]\s*\)/g),
  ];
  for (const match of imports) {
    if (!match[2].startsWith('.')) continue;
    const candidate = path.resolve(path.dirname(file.absolute), match[2]);
    const relative = path.relative(root, candidate);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) continue;
    try {
      const json = JSON.parse(await fs.readFile(candidate, 'utf8')) as unknown;
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        result.set(match[1], json as Record<string, unknown>);
      }
    } catch {
      // Dynamic configs remain useful even when one imported JSON file is absent or malformed.
    }
  }
  return result;
}

function resolveJsonMember(
  text: string,
  block: 'android' | 'ios',
  field: 'package' | 'bundleIdentifier',
  imports: Map<string, Record<string, unknown>>,
): string | undefined {
  const expression = new RegExp(`\\b${block}\\s*:\\s*\\{[\\s\\S]{0,5000}?\\b${field}\\s*:\\s*([A-Za-z_$][\\w$]*)\\.([A-Za-z_$][\\w$]*)`)
    .exec(text);
  if (!expression) return undefined;
  const value = imports.get(expression[1])?.[expression[2]];
  return typeof value === 'string' ? value : undefined;
}

/** `["expo-build-properties", { android: { targetSdkVersion: N } }]` in a parsed Expo config. */
function expoBuildPropertiesTargetSdk(plugins: unknown): number | undefined {
  if (!Array.isArray(plugins)) return undefined;
  for (const plugin of plugins) {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') continue;
    const value = (plugin[1] as { android?: { targetSdkVersion?: unknown } } | undefined)?.android?.targetSdkVersion;
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  return undefined;
}

async function parseExpo(files: ProjectFile[], root: string) {
  const androidPackageNames: string[] = [];
  const iosBundleIds: string[] = [];
  const platforms = new Set<string>();
  const targetSdkEvidence: Array<{ file: string; value: number }> = [];
  let detected = false;
  for (const file of files.filter((candidate) => /(?:^|\/)app(?:\.config)?\.(?:json|js|cjs|mjs|ts)$/.test(candidate.relative))) {
    try {
      const json = JSON.parse(file.text) as Record<string, unknown>;
      const hasExpoRoot = Boolean(json.expo && typeof json.expo === 'object');
      const expo = (hasExpoRoot ? json.expo : json) as {
        android?: { package?: unknown };
        ios?: { bundleIdentifier?: unknown };
        platforms?: unknown;
        plugins?: unknown;
      };
      if (hasExpoRoot
        || typeof expo.android?.package === 'string'
        || typeof expo.ios?.bundleIdentifier === 'string'
        || Array.isArray(expo.platforms)) detected = true;
      if (typeof expo.android?.package === 'string') androidPackageNames.push(expo.android.package);
      if (typeof expo.ios?.bundleIdentifier === 'string') iosBundleIds.push(expo.ios.bundleIdentifier);
      if (Array.isArray(expo.platforms)) {
        for (const platform of expo.platforms) if (typeof platform === 'string') platforms.add(platform);
      }
      const targetSdk = expoBuildPropertiesTargetSdk(expo.plugins);
      if (targetSdk !== undefined) targetSdkEvidence.push({ file: file.relative, value: targetSdk });
    } catch {
      // Dynamic Expo configs are common. Resolve only obvious literal identifiers and keep the rest as warnings.
      const android = file.text.match(/\bandroid\s*:\s*\{[\s\S]{0,3000}?\bpackage\s*:\s*['"]([^'"]+)['"]/);
      const ios = file.text.match(/\bios\s*:\s*\{[\s\S]{0,3000}?\bbundleIdentifier\s*:\s*['"]([^'"]+)['"]/);
      const imports = await readStaticJsonImports(file, root);
      const importedAndroid = resolveJsonMember(file.text, 'android', 'package', imports);
      const importedIos = resolveJsonMember(file.text, 'ios', 'bundleIdentifier', imports);
      if (android?.[1] || ios?.[1] || importedAndroid || importedIos || /\bexpo\s*:/.test(file.text)) detected = true;
      if (android?.[1] || importedAndroid) androidPackageNames.push(android?.[1] ?? importedAndroid!);
      if (ios?.[1] || importedIos) iosBundleIds.push(ios?.[1] ?? importedIos!);
      // A literal `targetSdkVersion: N` inside the expo-build-properties plugin's android block.
      const buildProperties = file.text.match(
        /['"]expo-build-properties['"]\s*,\s*\{[\s\S]{0,4000}?\bandroid\s*:\s*\{[^}]*?\btargetSdkVersion\s*:\s*(\d+)\b/,
      );
      if (buildProperties) targetSdkEvidence.push({ file: file.relative, value: Number.parseInt(buildProperties[1], 10) });
    }
  }
  for (const file of files.filter((candidate) => candidate.relative.endsWith('package.json'))) {
    try {
      const manifest = JSON.parse(file.text) as Record<string, unknown>;
      const groups = ['dependencies', 'devDependencies'].map((key) => manifest[key]);
      if (groups.some((group) => group && typeof group === 'object' && 'expo' in group)) detected = true;
    } catch {
      // A malformed package manifest cannot add Expo evidence.
    }
  }
  return { androidPackageNames, iosBundleIds, platforms, detected, targetSdkEvidence };
}

export const REACT_NATIVE_CATALOG = 'node_modules/react-native/gradle/libs.versions.toml';

// --- Android application ID -------------------------------------------------------------------------------------

/** Shape of an Android package name / applicationId (two or more Java-identifier segments). */
const ANDROID_APPLICATION_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

// `applicationId` as a DSL assignment: not inside a string ("$applicationId", "applicationId", ...) or a template,
// not a local Kotlin/Groovy variable that happens to be named so (`val applicationId = …`), and not an extra
// property (`ext.applicationId`, `project.ext.applicationId`; `ext { … }` blocks are removed before matching).
const APPLICATION_ID_ASSIGNMENT = String.raw`(?<![\w$"'{])(?<!\b(?:val|var|def|const)\s+)(?<!\b(?:ext|extra)\.)applicationId(?:\s*=\s*|[ \t]+)`;

const APPLICATION_ID_LITERAL = new RegExp(`${APPLICATION_ID_ASSIGNMENT}["']([^"'\\n]+)["']`, 'g');

const APPLICATION_ID_CATALOG = new RegExp(`${APPLICATION_ID_ASSIGNMENT}([A-Za-z_]\\w*)\\.versions\\.([A-Za-z0-9_.-]+?)\\.get\\(\\)`, 'g');

// `applicationId APPLICATION_ID` / `applicationId = project.APPLICATION_ID`: a gradle.properties key.
const APPLICATION_ID_PROPERTY = new RegExp(`${APPLICATION_ID_ASSIGNMENT}(?:project\\.)?([A-Za-z_]\\w*)[ \\t]*(?=$|[;)}])`, 'gm');

const APPLICATION_ID_ANY = new RegExp(`${APPLICATION_ID_ASSIGNMENT}\\S`);

const NAMESPACE_LITERAL = /(?<![\w$"'{.])namespace(?:\s*=\s*|[ \t]+)["']([^"'\n]+)["']/;

// `com.android.application` (not a Maven coordinate such as `com.android.application:…gradle.plugin`), catalog aliases
// (`libs.plugins.android.application`, KMP's `libs.plugins.androidApplication`, a convention alias
// `libs.plugins.myco.android.application`), and buildSrc constants (`id(BuildPlugins.androidApplication)`,
// `id(Plugins.ANDROID_APPLICATION)`).
const ANDROID_APP_PLUGIN_ID = /(?<![\w.:-])com\.android\.application(?![\w.:-])|\blibs\.plugins\.(?:\w+\.)*android[.-]?application\b|\b(?:id|alias)\s*\(?\s*[\w.]*\bandroid[._]?application\b/i;

// Android plugins whose targetSdk does not decide the Play submission: libraries, test modules, KMP libraries.
const ANDROID_LIBRARY_PLUGIN_ID = /(?<![\w.:-])com\.android\.(?:library|test|fused-library|kotlin\.multiplatform\.library)(?![\w.:-])|\blibs\.plugins\.(?:\w+\.)*android[.-]?(?:library|test)\b|\b(?:id|alias)\s*\(\s*["']?[\w.-]*\bandroid[._-]?library\b/i;

// A line that only MENTIONS a plugin id: a query (`hasPlugin`, `withId`, `withPlugin`, `findPlugin`), a collection or
// comparison (`listOf(…)`, `==`, `->` in a `when`), a variable holding the id, a classpath coordinate, or an
// `apply false` declaration. Every other line naming the id applies it — `id(…)` (also split over lines), `alias(…)`,
// `apply plugin:`, `apply { plugin(…) }`, `pluginManager.apply(…)`, `plugins.apply(…)`. A deny-list, so a new way of
// applying the plugin still finds the app.
const PLUGIN_MENTION = /\b(?:hasPlugin|withId|withPlugin|findPlugin|getPlugin|findByName|getByName|listOf|setOf|arrayOf|mutableListOf|mutableSetOf|contains|containsKey|equals|startsWith|endsWith|matches|filter|any|none)\s*\(|[=!]=|->|\bin\s*[[(]|\b(?:def|val|var|const)\s+[A-Za-z_]\w*\s*(?::\s*[\w<>?.]+\s*)?=|\b(?:classpath|implementation|api|compileOnly|runtimeOnly|testImplementation|androidTestImplementation|debugImplementation|releaseImplementation|annotationProcessor|kapt|ksp|lintChecks)\b|\.toDep\(\)|\bpluginId\b|\bid\s*=(?!=)|\bapply\s*\(?\s*false\b/;

/**
 * The call whose argument list encloses `index` in masked code: its name (`id`, `apply`, `listOf`, `[` for a list
 * literal) and where its `(` is, or undefined at statement level (`apply plugin: '…'`, `id '…'`).
 */
function enclosingCall(masked: string, index: number): { name: string; open: number } | undefined {
  let depth = 0;
  for (let cursor = index; cursor >= 0 && cursor > index - 2000; cursor--) {
    const char = masked[cursor];
    if (char === ')' || char === ']') depth++;
    else if (char === '(' || char === '[') {
      if (depth === 0) {
        if (char === '[') return { name: '[', open: cursor };
        const name = masked.slice(Math.max(0, cursor - 80), cursor).match(/([A-Za-z_$][\w$]*)\s*$/)?.[1] ?? '';
        return { name, open: cursor };
      }
      depth--;
    } else if ((char === '{' || char === '}' || char === ';') && depth === 0) {
      return undefined;
    }
  }
  return undefined;
}

/** Calls whose argument applies a plugin: `id(…)`, `alias(…)`, `apply(…)` / `pluginManager.apply(…)` / `plugins.apply(…)`. */
const PLUGIN_APPLYING_CALLS = new Set(['id', 'alias', 'apply']);

function appliesAndroidPlugin(text: string, id: RegExp): boolean {
  // Lexed code with only id-shaped string literals kept: an id inside a longer string (`description = "Applies
  // com.android.application"`) or a comment is never an application.
  const code = keepStrings(text, (literal) => /^(["'])[\w.:-]+\1$/.test(literal));
  const masked = maskStrings(text);
  // Inside `dependencies { … }` an id is a dependency notation (`implementation(plugin(libs.plugins.android.application))`).
  const dependencies = [...masked.matchAll(/\bdependencies\s*\{/g)]
    .map((match) => [match.index, closingBrace(code, match.index + match[0].length - 1)] as const);
  const applyFalseAfter = (from: number) => {
    const end = statementEnd(masked, from);
    const closer = [')', ']'].includes(masked[end]) ? statementEnd(masked, end + 1) : end;
    return /\bapply\s*\(?\s*false\b/.test(masked.slice(from, closer))
      || /^[^\n]*\n\s*\)?\s*(?:version\b[^\n]*?)?\bapply\s*\(?\s*false\b/.test(masked.slice(from, from + 400));
  };
  for (const match of code.matchAll(new RegExp(id.source, `${id.flags.replace('g', '')}g`))) {
    const at = match.index + match[0].length - 1;
    if (dependencies.some(([open, close]) => at > open && (close < 0 || at < close))) continue;
    let call = enclosingCall(masked, at);
    // Bare parentheses only group (`apply plugin: (isApp ? '…' : '…')`): the call around them decides.
    while (call && call.name === '') call = enclosingCall(masked, call.open - 1);
    if (call) {
      // `plugin(…)` applies only as the statement of an `apply { … }` block; inside another call
      // (`implementation(plugin(…))`, `buildConfigField("…", plugin(…))`) it is a mention.
      const outer = enclosingCall(masked, call.open - 1);
      const block = enclosingBlocks(masked, call.open).at(-1)?.opener;
      // A collection applies its ids when it is the map of `apply([plugin: '…'])`, or when it is iterated into
      // `apply` (`['com.android.application', …].each { apply plugin: it }`, `listOf(…).forEach { apply(plugin = it) }`).
      const collection = ['[', 'listOf', 'setOf', 'arrayOf', 'mutableListOf', 'mutableSetOf'].includes(call.name);
      const close = collection ? statementEnd(masked, call.open + 1) : -1;
      // The loop must apply each element unconditionally: `{ apply plugin: it }`, `{ id -> apply(plugin = id) }`.
      const loop = collection
        ? masked.slice(close + 1, close + 300).match(/^\s*\??\.\s*(?:each|forEach|eachWithIndex|forEachIndexed)\s*\{\s*(?:([A-Za-z_$][\w$]*)\s*->\s*)?apply\s*\(?\s*(?:plugin\s*[:=]\s*)?([A-Za-z_$][\w$]*)\b/)
        : null;
      const applies = PLUGIN_APPLYING_CALLS.has(call.name)
        || (call.name === 'plugin' && !outer && block === 'apply')
        || (call.name === 'mapOf' && outer?.name === 'apply')
        || (call.name === '[' && outer?.name === 'apply')
        || (loop !== null && (loop[2] === 'it' || loop[2] === loop[1]));
      if (applies && !applyFalseAfter(at)) return true;
      continue;
    }
    // Statement level (`apply plugin: '…'`, Groovy `id '…'`, a catalog alias in `plugins { }`): judged per statement,
    // so `classpath …; apply plugin: '…'` on one line still applies the plugin.
    const before = code.slice(0, match.index);
    const start = Math.max(before.lastIndexOf('\n'), before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}')) + 1;
    const statement = code.slice(start, statementEnd(masked, match.index));
    if (applyFalseAfter(at)) continue;
    // A Groovy command call that applies (`id '…' version libs.versions.x.get()`, `id libs.plugins….get().pluginId`,
    // `apply plugin: isApp ? '…' : '…'`, `plugin '…'` in `apply { }`) applies, whatever follows the id.
    if (/^\s*(?:[\w$]+\s*\.\s*)*(?:id|alias|apply|plugin)\b(?!\s*(?:=|->|\.))/.test(statement)) return true;
    if (PLUGIN_MENTION.test(statement) || /\.\s*get\s*\(|\bversion\s*=/.test(statement)) continue;
    return true;
  }
  return false;
}

/** A build script of a Gradle plugin project (convention plugins), not of an app. */
export const GRADLE_PLUGIN_BUILD = /\bgradlePlugin\s*\{|`(?:kotlin-dsl|java-gradle-plugin|groovy-gradle-plugin)`|["'](?:java-gradle-plugin|groovy-gradle-plugin|kotlin-dsl)["']|\bkotlin-dsl\b/;

/** A Gradle plugin project's build script: it builds plugins and applies no Android application plugin itself. */
function isGradlePluginBuild(text: string): boolean {
  const code = stripGradleComments(text);
  return GRADLE_PLUGIN_BUILD.test(code) && !appliesAndroidAppPlugin(code);
}

/** Applies the Android application plugin — a root `plugins { … apply false }` declaration only makes it available. */
export function appliesAndroidAppPlugin(text: string): boolean {
  return appliesAndroidPlugin(text, ANDROID_APP_PLUGIN_ID);
}

/** Applies an Android library / test plugin and not the application plugin: its targetSdk is not the app's. */
export function appliesOnlyAndroidLibraryPlugin(text: string): boolean {
  return appliesAndroidPlugin(text, ANDROID_LIBRARY_PLUGIN_ID) && !appliesAndroidAppPlugin(text);
}

/** `[versions]` entries of the scanned Gradle version catalogs (React Native's bundled catalog excluded unless asked). */
export function catalogVersions(files: ProjectFile[], includeReactNative = false): Map<string, { value: string; file: string }> {
  const result = new Map<string, { value: string; file: string }>();
  for (const file of files) {
    if (file.relative === REACT_NATIVE_CATALOG && !includeReactNative) continue;
    let section = '';
    for (const rawLine of file.text.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+#.*$/, '').trim();
      const sectionMatch = line.match(/^\[([^\]]+)]$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        continue;
      }
      if (section !== 'versions') continue;
      const version = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/);
      // The first catalog wins, so a nested build's catalog cannot overwrite the root one.
      if (version && !result.has(version[1])) result.set(version[1], { value: version[2], file: file.relative });
    }
  }
  return result;
}

/** The Gradle build a version catalog belongs to: `<build>/gradle/libs.versions.toml` -> `<build>`. */
function catalogBuildRoot(file: ProjectFile): string {
  const dir = path.dirname(file.absolute);
  return path.basename(dir) === 'gradle' ? path.dirname(dir) : dir;
}

/**
 * The catalog of the build `file` belongs to: the deepest catalog whose build directory contains it, so a nested
 * build's (or the --path build's) own catalog wins over the repository root's. With no containing catalog, a sole
 * catalog is used.
 */
export function nearestCatalog(file: ProjectFile, catalogs: ProjectFile[]): ProjectFile | undefined {
  const candidates = catalogs.filter((catalog) => catalog.relative !== REACT_NATIVE_CATALOG
    && path.posix.basename(catalog.relative) === 'libs.versions.toml');
  const containing = candidates
    .filter((catalog) => isWithin(catalogBuildRoot(catalog), file.absolute))
    .sort((left, right) => catalogBuildRoot(right).length - catalogBuildRoot(left).length);
  return containing[0] ?? (candidates.length === 1 ? candidates[0] : undefined);
}

export type CatalogVersions = Map<string, { value: string; file: string }>;

/** Version catalogs visible to a Gradle file, by accessor (`libs`, `androidx`); null when declared but unreadable. */
export type CatalogResolver = (file: ProjectFile) => Map<string, CatalogVersions | null>;

/** `[versions]` of one catalog file, whatever its name (a settings `from(files(…))` may point at any file). */
function parseCatalogFile(file: ProjectFile): CatalogVersions {
  return catalogVersions([file], true);
}

/**
 * The top-level `name { … }` / `create("name") { … }` entries of a `versionCatalogs { … }` block, braces matched on
 * lexed text (nested `version("x") { strictly(…) }` blocks stay inside their entry).
 */
function catalogEntries(block: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const opener = /\bcreate\(\s*["']([\w-]+)["']\s*\)\s*\{|(?:^|[\s;])([A-Za-z_]\w*)\s*\{/g;
  for (let match = opener.exec(block); match; match = opener.exec(block)) {
    const open = match.index + match[0].length - 1;
    const close = closingBrace(block, open);
    if (close < 0) break;
    entries.push([match[1] ?? match[2], block.slice(open + 1, close)]);
    opener.lastIndex = close + 1;
  }
  return entries;
}

/**
 * Resolves `<accessor>.versions.<key>` the way Gradle does: from the settings file of the build a module belongs to
 * (the nearest settings.gradle(.kts) above it), `versionCatalogs { create("x") { from(files("…")) } }` (Groovy
 * `x { from(files('…')) }`) plus the default `libs` = `<build>/gradle/libs.versions.toml`. Literal
 * `version("key", "33")` overrides in the entry win over the file; a non-literal override leaves that key
 * unresolved. A path using `$rootDir` is expanded to the settings directory; any other template, or a catalog
 * declared from a Maven coordinate, is unresolvable (null). Without a settings file in sight, the nearest
 * `gradle/libs.versions.toml` that contains the module (or a sole one) stands in for `libs`.
 */
async function catalogResolver(files: ProjectFile[], root: string): Promise<CatalogResolver> {
  const tomls = files.filter((file) => file.relative.endsWith('.versions.toml') && file.relative !== REACT_NATIVE_CATALOG);
  const byAbsolute = new Map(tomls.map((file) => [file.absolute, file]));
  const builds = new Map<string, Map<string, CatalogVersions | null>>();
  for (const settings of files.filter((file) => /(?:^|\/)settings\.gradle(?:\.kts)?$/.test(file.relative))) {
    const dir = path.dirname(settings.absolute);
    const code = stripGradleComments(settings.text);
    const catalogs = new Map<string, CatalogVersions | null>();
    const block = blockContents(code, /\bversionCatalogs\s*\{/);
    const defaultCatalog = byAbsolute.get(path.join(dir, 'gradle', 'libs.versions.toml'));
    for (const [name, body] of block === undefined ? [] : catalogEntries(block)) {
      let versions: CatalogVersions;
      if (!/\bfrom\s*\(/.test(body)) {
        // No `from(…)`: the entry only adds versions — to the default gradle/libs.versions.toml for `libs`.
        versions = name === 'libs' && defaultCatalog ? catalogVersions([defaultCatalog], true) : new Map();
      } else {
        const declared = body.match(/\bfrom\s*\(?\s*files\s*\(\s*["']([^"']+)["']/)?.[1];
        const expanded = declared?.replace(/^\$\{?rootDir\}?(?=\/)/, dir);
        // A Maven coordinate (`from("group:name:1.0")`) or a templated path cannot be read from the repository.
        if (!expanded || expanded.includes('$')) {
          catalogs.set(name, null);
          continue;
        }
        const absolute = path.resolve(dir, expanded);
        let catalog = byAbsolute.get(absolute);
        if (!catalog) {
          const text = await readText(absolute);
          if (text !== undefined) catalog = { absolute, relative: path.relative(root, absolute).replace(/\\/g, '/'), text };
        }
        if (!catalog) {
          catalogs.set(name, null);
          continue;
        }
        versions = parseCatalogFile(catalog);
      }
      // `version("targetSdk", "33")` — also Groovy's paren-less `version 'targetSdk', '33'` and a call split over lines
      // with a trailing comma — overrides the file. A non-literal value or a rich `version("k") { … }` leaves that key
      // unknown; a `version` call the scanner cannot parse makes the whole catalog unknown (never the TOML value).
      // `library("x", "g", "a").version("1.0")` (a chained call after `.`) declares a library, not a version key.
      let unparsed = false;
      for (const call of body.matchAll(/(?<![.\w])version\b(?=\s*[("'])/g)) {
        const rest = body.slice(call.index + call[0].length);
        const key = /^\s*\(?\s*["']([\w.-]+)["']/.exec(rest);
        if (!key) {
          unparsed = true;
          continue;
        }
        const after = rest.slice(key[0].length);
        const literal = /^\s*,\s*(["'])([^"'\n]*)\1/.exec(after);
        if (literal) versions.set(key[1], { value: literal[2], file: settings.relative });
        else if (/^\s*,/.test(after) || /^\s*\)?\s*\{/.test(after)) versions.set(key[1], { value: '', file: settings.relative });
        else unparsed = true;
      }
      catalogs.set(name, unparsed ? null : versions);
    }
    if (!catalogs.has('libs') && defaultCatalog) catalogs.set('libs', catalogVersions([defaultCatalog], true));
    builds.set(dir, catalogs);
  }
  const defaults = tomls.filter((file) => path.posix.basename(file.relative) === 'libs.versions.toml');
  return (file) => {
    const build = [...builds.keys()]
      .filter((dir) => isWithin(dir, file.absolute))
      .sort((left, right) => right.length - left.length)[0];
    if (build !== undefined) return builds.get(build)!;
    const nearest = nearestCatalog(file, defaults);
    return new Map(nearest ? [['libs', catalogVersions([nearest], true)]] : []);
  };
}

/**
 * gradle.properties a module actually sees: the files on the path from its build's root (nearest settings
 * directory) down to the module, outside sample/demo trees. Files of other modules, other (included) builds, and
 * example apps are out of scope. A key with two different values in scope is null (unresolved).
 */
export type PropertyScope = (file: ProjectFile) => Map<string, { value: string; file: string } | null>;

function gradlePropertyScope(files: ProjectFile[]): PropertyScope {
  const settingsDirs = files
    .filter((file) => /(?:^|\/)settings\.gradle(?:\.kts)?$/.test(file.relative))
    .map((file) => path.dirname(file.absolute));
  const propertyFiles = files
    .filter((file) => path.posix.basename(file.relative) === 'gradle.properties')
    .map((file) => ({
      sample: Boolean(file.sample),
      dir: path.dirname(file.absolute),
      file: file.relative,
      rows: new Map(file.text.split(/\r?\n/)
        .map((line) => line.match(/^\s*([A-Za-z_][\w.]*)\s*[=:]\s*(.*?)\s*$/))
        .filter((match): match is RegExpMatchArray => Boolean(match))
        .map((match) => [match[1], match[2]] as const)),
    }));
  return (file) => {
    const build = settingsDirs
      .filter((dir) => isWithin(dir, file.absolute))
      .sort((left, right) => right.length - left.length)[0];
    const result = new Map<string, { value: string; file: string } | null>();
    for (const properties of propertyFiles) {
      if (!isWithin(properties.dir, file.absolute) || (build !== undefined && !isWithin(build, properties.dir))) continue;
      // Sample/demo trees' properties apply only to a module that itself lives in such a tree.
      if (properties.sample && !file.sample) continue;
      for (const [key, value] of properties.rows) {
        const existing = result.get(key);
        result.set(key, existing === undefined ? { value, file: properties.file } : existing?.value === value ? existing : null);
      }
    }
    return result;
  };
}

/** `<accessor>.versions.<alias>` looked up in the resolved catalogs; undefined when unknown. */
export function catalogValue(catalogs: Map<string, CatalogVersions | null>, accessor: string, alias: string) {
  const catalog = catalogs.get(accessor);
  return catalog ? catalogLookup(catalog, alias) : undefined;
}

/** `libs.versions.a.b` may be declared as `a-b`, `a_b`, or `a.b` in the catalog. */
function catalogLookup<T>(catalog: Map<string, T>, alias: string): T | undefined {
  return catalog.get(alias) ?? catalog.get(alias.replace(/\./g, '-')) ?? catalog.get(alias.replace(/\./g, '_'));
}

/** gradle.properties keys whose value is the same everywhere they are set. */
function gradleProperties(files: ProjectFile[]): Map<string, string> {
  const values = new Map<string, Set<string>>();
  for (const file of files.filter((candidate) => candidate.relative.endsWith('gradle.properties'))) {
    for (const line of file.text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][\w.]*)\s*[=:]\s*(.*?)\s*$/);
      if (!match) continue;
      values.set(match[1], (values.get(match[1]) ?? new Set()).add(match[2]));
    }
  }
  return new Map([...values].filter(([, set]) => set.size === 1).map(([key, set]) => [key, [...set][0]]));
}

/**
 * Gradle text for app-module detection and ID extraction: comments removed (a commented-out `// applicationId "…"`
 * is not an ID) and `ext { … }` / `extra { … }` blocks removed (extra properties are not the DSL's applicationId).
 */
function gradleDslText(text: string): string {
  return removeBlocks(stripGradleComments(text), /\b(?:ext|extra)\s*\{/);
}

/** `applicationId = <expr>` assignments in an app module, as written (for an unresolved-ID report). */
function applicationIdAssignments(file: ProjectFile): string[] {
  return [...file.text.matchAll(new RegExp(`${APPLICATION_ID_ASSIGNMENT}[^\\n;]+`, 'g'))].map((match) => match[0].trim());
}

function androidApplicationIds(
  file: ProjectFile,
  catalogs: Map<string, CatalogVersions | null>,
  properties: Map<string, string>,
): string[] {
  const ids: string[] = [];
  for (const match of file.text.matchAll(APPLICATION_ID_LITERAL)) ids.push(match[1]);
  for (const match of file.text.matchAll(APPLICATION_ID_CATALOG)) {
    const value = catalogValue(catalogs, match[1], match[2])?.value;
    if (value) ids.push(value);
  }
  for (const match of file.text.matchAll(APPLICATION_ID_PROPERTY)) {
    const value = properties.get(match[1]);
    if (value) ids.push(value);
  }
  // AGP uses `namespace` as the applicationId when an app module sets none.
  if (ids.length === 0 && !APPLICATION_ID_ANY.test(file.text) && appliesAndroidAppPlugin(file.text)) {
    const namespace = file.text.match(NAMESPACE_LITERAL)?.[1];
    if (namespace) ids.push(namespace);
  }
  return ids.filter((id) => ANDROID_APPLICATION_ID.test(id));
}

const SPECIALIZED_MANIFEST = /android\.hardware\.type\.(?:watch|automotive)|android\.(?:software|hardware)\.xr/i;

const LEANBACK_REQUIRED = /android\.software\.leanback[^>]*android:required\s*=\s*["']true["']/i;

const PHONE_LAUNCHER = /android\.intent\.category\.LAUNCHER["']/;

/**
 * Module directories whose manifests declare Wear OS, TV, Automotive OS, or XR. A module is TV-only when its main
 * manifest requires leanback (no phone can install any variant), or when it has a TV signal (leanback required in a
 * flavor, or a LEANBACK_LAUNCHER) and no phone launcher reaches it: not in any of its own
 * manifests (main or a product flavor — a phone flavor next to a TV flavor keeps the phone rule) and not in a library
 * module's manifest (merged into the app). Debug-only manifests are ignored: a debug launcher never ships.
 */
export function specializedAndroidModules(manifests: ProjectFile[], appModules: string[]): Set<string> {
  const shipping = manifests.filter((file) => !/(?:^|\/)src\/debug[^/]*\//.test(file.relative));
  const byModule = new Map<string, string[]>();
  // leanback required in the module's main manifest: no phone can install any variant, so it is TV-only.
  const requiredInMain = new Set<string>();
  for (const file of shipping) {
    const module = moduleDir(file.relative);
    const text = file.text.replace(/<!--[\s\S]*?-->/g, '');
    byModule.set(module, [...(byModule.get(module) ?? []), text]);
    if (/(?:^|\/)src\/main\/AndroidManifest\.xml$/.test(file.relative) && LEANBACK_REQUIRED.test(text)) requiredInMain.add(module);
  }
  // A (non-debug) flavor manifest that removes the leanback requirement (`tools:node="remove"`) or relaxes it
  // (`android:required="false"` with `tools:replace`) makes that flavor installable on phones.
  for (const file of shipping) {
    if (/(?:^|\/)src\/main\//.test(file.relative)) continue;
    const feature = file.text.match(/<uses-feature\b[^>]*android\.software\.leanback[^>]*>/)?.[0] ?? '';
    if (/tools:node\s*=\s*["']remove["']/.test(feature)
      || (/tools:replace/.test(feature) && /android:required\s*=\s*["']false["']/.test(feature))) {
      requiredInMain.delete(moduleDir(file.relative));
    }
  }
  const libraryPhoneLauncher = [...byModule].some(([module, texts]) =>
    !appModules.includes(module) && texts.some((text) => PHONE_LAUNCHER.test(text)));
  const result = new Set<string>();
  for (const [module, texts] of byModule) {
    if (texts.some((text) => SPECIALIZED_MANIFEST.test(text))) {
      result.add(module);
      continue;
    }
    if (!appModules.includes(module) && appModules.length > 0) continue;
    const tvSignal = texts.some((text) => LEANBACK_REQUIRED.test(text) || /LEANBACK_LAUNCHER/.test(text));
    const phoneLauncher = libraryPhoneLauncher || texts.some((text) => PHONE_LAUNCHER.test(text));
    if ((tvSignal && !phoneLauncher) || requiredInMain.has(module)) result.add(module);
  }
  return result;
}

/** Keeps only the files outside example/sample/test trees, unless every candidate is inside one. */
function preferShipped<T extends ProjectFile>(candidates: T[]): T[] {
  const shipped = candidates.filter((file) => !file.sample);
  return shipped.length > 0 ? shipped : candidates;
}

// --- iOS bundle identifier -----------------------------------------------------------------------------------------

const IOS_TEST_BUNDLE_ID = /(?:^|\.)(?:Tests?|UITests?|RunnerTests)$/i;

// `…WikipediaUITests`, `…RunnerTests`: plural and case-sensitive, so `….SpeedTest` and `….contests` are kept.
const IOS_TEST_BUNDLE_SUFFIX = /Tests$/;

const IOS_BUNDLE_ID = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

const RELEASE_CONFIGURATION = /release|app\s*store|prod/i;

// Build configurations that are never archived for the App Store (Debug, Flutter's Profile, test configurations).
// `TestFlight` / `Beta-TestFlight` configurations ship, so `test` counts only when it is not `TestFlight`.
const DEVELOPMENT_CONFIGURATION = /debug|profile|test(?!flight)/i;

// Xcode product types that ship under their own bundle ID in an App Store record: apps, App Clips, watch apps, and
// app/ExtensionKit/watch extensions.
const APP_PRODUCT_TYPE = /\.(?:application|app-extension|watchkit2-extension|extensionkit-extension|tv-app-extension)(?:\.[\w-]+)*$/;

interface BuildSettingValue {
  value: string;
  file: string;
}

/**
 * Build-setting variables from `.xcconfig` files and XcodeGen specs (`project.yml` and the files it `include:`s), so
 * `PRODUCT_BUNDLE_IDENTIFIER = $(BASE_BUNDLE_IDENTIFIER)` can be resolved. Conditional assignments
 * (`KEY[config=Debug]`) are ignored except for Release.
 */
async function buildSettingVariables(files: ProjectFile[]): Promise<Map<string, BuildSettingValue[]>> {
  const result = new Map<string, BuildSettingValue[]>();
  const add = (key: string, value: string, file: string) => {
    const rows = result.get(key) ?? [];
    if (!rows.some((row) => row.value === value)) rows.push({ value, file });
    result.set(key, rows);
  };
  for (const file of files.filter((candidate) => candidate.relative.endsWith('.xcconfig'))) {
    for (const rawLine of file.text.split(/\r?\n/)) {
      const line = rawLine.replace(/\s*\/\/.*$/, '');
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)((?:\[[^\]]*\])*)\s*=\s*(.*?)\s*;?\s*$/);
      if (!match || (match[2] && !/config=Release/i.test(match[2]))) continue;
      add(match[1], match[3].replace(/^"(.*)"$/, '$1'), file.relative);
    }
  }
  const specs: ProjectFile[] = [];
  for (const spec of files.filter((candidate) => /(?:^|\/)project\.yml$/.test(candidate.relative))) {
    specs.push(spec);
    for (const include of spec.text.matchAll(/^\s*-\s*(?:path:\s*)?["']?([^"'\s#]+\.ya?ml)["']?\s*$/gm)) {
      const absolute = path.resolve(path.dirname(spec.absolute), include[1]);
      const text = await readText(absolute);
      if (text !== undefined) {
        specs.push({ absolute, relative: path.posix.join(path.posix.dirname(spec.relative), include[1]), text });
      }
    }
  }
  for (const spec of specs) {
    for (const match of spec.text.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*(.+?)\s*$/gm)) {
      const value = match[2].replace(/\s+#.*$/, '').replace(/^(["'])(.*)\1$/, '$2');
      if (value && !/^[[{|>&*]/.test(value)) add(match[1], value, spec.relative);
    }
  }
  return result;
}

/** Substitutes `$(VAR)` / `${VAR}`; undefined when any variable is unknown, ambiguous, or uses a modifier. */
function resolveBuildSetting(
  expression: string,
  local: Map<string, string>,
  variables: Map<string, BuildSettingValue[]>,
  depth = 0,
): string | undefined {
  if (depth > 8) return undefined;
  let failed = false;
  const resolved = expression.replace(/\$(?:\(([^)]+)\)|\{([^}]+)\})/g, (_whole, paren?: string, brace?: string) => {
    const name = (paren ?? brace)!;
    if (name === 'inherited') return '';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      failed = true; // `$(PRODUCT_NAME:rfc1034identifier)` and friends
      return '';
    }
    const own = local.get(name);
    let candidates = own !== undefined ? [own] : (variables.get(name) ?? []).map((row) => row.value);
    if (candidates.length > 1) {
      const release = (variables.get(name) ?? []).filter((row) => RELEASE_CONFIGURATION.test(path.posix.basename(row.file)));
      candidates = release.length === 1 ? [release[0].value] : candidates;
    }
    if (candidates.length !== 1) {
      failed = true;
      return '';
    }
    const value = candidates[0].includes('$') ? resolveBuildSetting(candidates[0], local, variables, depth + 1) : candidates[0];
    if (value === undefined) failed = true;
    return value ?? '';
  });
  return failed ? undefined : resolved;
}

interface PbxBundleIds {
  ids: string[];
  /** PRODUCT_BUNDLE_IDENTIFIER expressions that could not be resolved. */
  unresolved: string[];
}

/**
 * Bundle IDs a project ships: identifiers set only in Debug / Profile / Test configurations (`.debug`, a dev bundle
 * ID) and those of framework, library, and test-bundle targets are left out.
 */
function pbxBundleIds(file: ProjectFile, variables: Map<string, BuildSettingValue[]>): PbxBundleIds {
  // Configurations of targets that are not shipped as their own bundle ID (frameworks, libraries, test bundles,
  // resource bundles) say nothing about the App Store record.
  const nonAppConfigurations = new Set<string>();
  for (const target of file.text.matchAll(/\bisa = PBXNativeTarget;([\s\S]*?)\n\s*\};/g)) {
    const productType = target[1].match(/\bproductType = "?([^";]+)"?;/)?.[1];
    const list = target[1].match(/\bbuildConfigurationList = ([0-9A-Za-z]+)/)?.[1];
    if (!productType || !list || APP_PRODUCT_TYPE.test(productType)) continue;
    const configurations = new RegExp(`\\b${list}\\b[^=\\n]*=\\s*\\{\\s*isa = XCConfigurationList;\\s*buildConfigurations = \\(([^)]*)\\)`)
      .exec(file.text)?.[1] ?? '';
    for (const id of configurations.matchAll(/\b([0-9A-Za-z]{16,})\b/g)) nonAppConfigurations.add(id[1]);
  }
  const blocks = [...file.text.matchAll(
    /\b([0-9A-Za-z]{16,})\b[^=\n]*=\s*\{\s*isa = XCBuildConfiguration;[\s\S]*?buildSettings = \{([\s\S]*?)\n\s*\};\s*name = "?([^";]+)"?;/g,
  )].map((match) => ({ id: match[1], settings: match[2], name: match[3] }));
  const withId = blocks.filter((block) => /\bPRODUCT_BUNDLE_IDENTIFIER\s*=/.test(block.settings)
    && !nonAppConfigurations.has(block.id));
  const shipping = withId.filter((block) => !DEVELOPMENT_CONFIGURATION.test(block.name));
  const scopes = withId.length === 0 ? [file.text] : (shipping.length > 0 ? shipping : withId).map((block) => block.settings);
  const result: PbxBundleIds = { ids: [], unresolved: [] };
  for (const settings of scopes) {
    const local = new Map([...settings.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*"?([^";\n]*)"?;/gm)]
      .filter((match) => match[1] !== 'PRODUCT_BUNDLE_IDENTIFIER')
      .map((match) => [match[1], match[2]] as [string, string]));
    for (const match of settings.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)) {
      const raw = match[1].trim().replace(/^["']|["']$/g, '');
      if (!raw) continue;
      const value = raw.includes('$') ? resolveBuildSetting(raw, local, variables) : raw;
      if (value === undefined) {
        // Test targets are not release identifiers even when they are unresolved.
        if (!IOS_TEST_BUNDLE_ID.test(raw) && !IOS_TEST_BUNDLE_SUFFIX.test(raw)) result.unresolved.push(raw);
        continue;
      }
      if (IOS_BUNDLE_ID.test(value) && !IOS_TEST_BUNDLE_ID.test(value) && !IOS_TEST_BUNDLE_SUFFIX.test(value)) {
        result.ids.push(value);
      }
    }
  }
  return result;
}

/**
 * True when every ID is the main app's or `<main>.<suffix>` (its extensions, widgets, and watch app). A nested ID
 * that has extensions of its own (`<main>.beta` next to `<main>.beta.Widgets`) is a separate app record, unless it is
 * a watch app (`<main>.watchkitapp.watchkitextension`).
 */
export function isOneAppWithExtensions(ids: string[]): boolean {
  return ids.some((main) => ids.every((id) => id === main || id.startsWith(`${main}.`))
    && !ids.some((parent) => parent !== main && !/watch/i.test(parent.slice(parent.lastIndexOf('.') + 1))
      && ids.some((child) => child.startsWith(`${parent}.`))));
}

export async function detectProject(files: ProjectFile[], root: string) {
  const expo = await parseExpo(files, root);
  // Comment-free Gradle text throughout (module detection, IDs, targetSdk): commented-out lines are not evidence.
  const gradleFiles = files
    .filter((file) => /(?:^|\/)build\.gradle(?:\.kts)?$/.test(file.relative))
    .map((file) => ({ ...file, text: stripGradleComments(file.text) }));
  const pbxFiles = files.filter((file) => file.relative.endsWith('project.pbxproj'));
  const plistFiles = files.filter((file) => file.relative.endsWith('Info.plist'));
  const allCatalogs = files.filter((file) => path.posix.basename(file.relative) === 'libs.versions.toml');
  const resolveCatalogs = await catalogResolver(files, root);
  const properties = gradleProperties(files);
  // An app module applies the Android application plugin or assigns `applicationId` in the DSL (any value, so a
  // convention-plugin module with `applicationId = AppConfig.applicationId` still counts; only the extracted ID
  // must be well-formed). The word inside a string, a template, or a local variable name does not count.
  // A Gradle plugin build (build-logic/, buildSrc/, a `gradlePlugin { … }` / kotlin-dsl project) registers plugins
  // whose ids may name the application plugin; it is never an app module itself.
  const androidAppGradleFiles = gradleFiles.filter((file) => !file.convention && !isGradlePluginBuild(file.text)
    && (appliesAndroidAppPlugin(file.text) || APPLICATION_ID_ANY.test(gradleDslText(file.text))));
  const androidAppManifestFiles = files.filter((file) =>
    /(?:^|\/)android\/app\/src\/main\/AndroidManifest\.xml$/.test(file.relative));
  const iosPbxFiles = pbxFiles.filter((file) =>
    /(?:^|\/)ios\//.test(file.relative)
    || /\b(?:SDKROOT\s*=\s*iphoneos|IPHONEOS_DEPLOYMENT_TARGET|TARGETED_DEVICE_FAMILY)\b/.test(file.text));
  const iosPlistFiles = plistFiles.filter((file) =>
    /(?:^|\/)ios\//.test(file.relative) || iosPbxFiles.length > 0);
  const unitySettingsFiles = files.filter((file) => /(?:^|\/)ProjectSettings\/ProjectSettings\.asset$/.test(file.relative));
  const unityAndroidPackageNames: string[] = [];
  const unityIosBundleIds: string[] = [];
  const unityTargetSdkEvidence: Array<{ file: string; value: number }> = [];
  for (const file of unitySettingsFiles) {
    const identifiers = unityApplicationIdentifiers(file.text);
    const androidId = identifiers.android;
    const iosId = identifiers.ios;
    const targetSdk = file.text.match(/^\s*AndroidTargetSdkVersion:\s*(-?\d+)\s*$/m)?.[1];
    if (androidId) unityAndroidPackageNames.push(androidId);
    if (iosId) unityIosBundleIds.push(iosId);
    if (targetSdk && Number.parseInt(targetSdk, 10) > 0) {
      unityTargetSdkEvidence.push({ file: file.relative, value: Number.parseInt(targetSdk, 10) });
    }
  }

  // Identifiers and targetSdk come from shipped app modules; an example/sample/test app counts only when it is the
  // only app in scope (a library repository).
  const shippedAppGradleFiles = preferShipped(androidAppGradleFiles);
  const androidPackageNames = [...expo.androidPackageNames, ...unityAndroidPackageNames];
  // Assignments whose value could not be resolved (a buildSrc constant, a Kotlin expression) are reported as such.
  const androidPackageExpressions: Array<{ file: string; expression: string }> = [];
  for (const file of shippedAppGradleFiles) {
    const dsl = { ...file, text: gradleDslText(file.text) };
    const ids = androidApplicationIds(dsl, resolveCatalogs(file), properties);
    androidPackageNames.push(...ids);
    if (ids.length === 0) {
      for (const expression of applicationIdAssignments(dsl)) androidPackageExpressions.push({ file: file.relative, expression });
    }
  }

  const iosBundleIds = [...expo.iosBundleIds, ...unityIosBundleIds];
  const iosBundleIdExpressions: Array<{ file: string; expression: string }> = [];
  const variables = await buildSettingVariables(files);
  const shippedPbx = preferShipped(iosPbxFiles)
    .map((file) => ({ file, depth: file.relative.split('/').length, ...pbxBundleIds(file, variables) }))
    .filter((project) => project.ids.length > 0 || project.unresolved.length > 0);
  // When the outermost Xcode project only has unresolvable identifiers, a deeper project's literal ID (a component
  // package's sample app) is not the app's ID: report the unresolved expression instead of borrowing it.
  const primaryDepth = Math.min(...shippedPbx.map((project) => project.depth));
  const primary = shippedPbx.filter((project) => project.depth === primaryDepth);
  const primaryUnresolved = primary.length > 0 && primary.every((project) => project.ids.length === 0);
  for (const project of primaryUnresolved ? primary : shippedPbx) {
    iosBundleIds.push(...project.ids);
    for (const expression of project.unresolved) iosBundleIdExpressions.push({ file: project.file.relative, expression });
  }
  if (!primaryUnresolved) {
    for (const file of preferShipped(iosPlistFiles)) {
      const match = file.text.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
      if (match?.[1] && !match[1].includes('$')) iosBundleIds.push(match[1]);
    }
  }

  const expoTargetsAndroid = expo.detected && (expo.platforms.size === 0 || expo.platforms.has('android'));
  const expoTargetsIos = expo.detected && (expo.platforms.size === 0 || expo.platforms.has('ios'));
  const android = androidAppGradleFiles.length > 0
    || expo.androidPackageNames.length > 0
    || expoTargetsAndroid
    || androidAppManifestFiles.length > 0
    || unityAndroidPackageNames.length > 0
    || unityTargetSdkEvidence.length > 0;
  const ios = iosPbxFiles.length > 0
    || iosPlistFiles.some((file) => /(?:^|\/)ios\//.test(file.relative))
    || expo.iosBundleIds.length > 0
    || expoTargetsIos
    || unityIosBundleIds.length > 0;
  const shippedOnly = shippedAppGradleFiles.some((file) => !file.sample);
  // App modules, everything under android/ (React Native, Flutter), and the root build script, which often holds
  // the shared `ext { targetSdkVersion = … }`.
  const androidGradleFiles = gradleFiles.filter((file) =>
    (androidAppGradleFiles.includes(file) || /(?:^|\/)android\//.test(file.relative) || /^build\.gradle(?:\.kts)?$/.test(file.relative))
    && (!shippedOnly || !file.sample));
  const manifests = files.filter((file) => file.relative.endsWith('AndroidManifest.xml') && (!shippedOnly || !file.sample));

  return {
    android,
    ios,
    androidPackageNames: unique(androidPackageNames),
    androidPackageExpressions,
    iosBundleIds: unique(iosBundleIds),
    iosBundleIdExpressions,
    androidAppModules: unique(shippedAppGradleFiles.map((file) => moduleDir(file.relative))),
    appGradleFiles: shippedAppGradleFiles,
    // An app project outside demo/ trees: then demo/ evidence (Xcode pins, FCM sources) describes a demo, not the app.
    // iOS-specific for the Xcode check (an Android app elsewhere says nothing about which Xcode builds the demo's
    // iOS app); any platform for FCM.
    hasIosAppOutsideDemo: iosPbxFiles.some((file) => !file.demo)
      || unityIosBundleIds.length > 0
      || (expoTargetsIos && files.some((file) => !file.demo && /(?:^|\/)app(?:\.config)?\.(?:json|js|cjs|mjs|ts)$/.test(file.relative))),
    hasAppOutsideDemo: [...androidAppGradleFiles, ...iosPbxFiles, ...unitySettingsFiles].some((file) => !file.demo)
      || (expo.detected && files.some((file) => !file.demo && /(?:^|\/)app(?:\.config)?\.(?:json|js|cjs|mjs|ts)$/.test(file.relative))),
    // App modules left out as example/sample/demo/test apps because a shipped app exists.
    sampleAppGradleFiles: shippedOnly ? androidAppGradleFiles.filter((file) => file.sample) : [],
    resolveCatalogs,
    // Gradle properties for targetSdk names, and the ones CI overrides (`-PNAME=`, ORG_GRADLE_PROJECT_NAME).
    properties: {
      scope: gradlePropertyScope(files),
      ciOverrides: new Set(files
        .filter((file) => isXcodePinFile(path.posix.basename(file.relative), file.relative))
        .flatMap((file) => [...file.text.matchAll(/(?:-P|\bORG_GRADLE_PROJECT_)([A-Za-z_][\w.]*)=?/g)].map((match) => match[1]))),
      // Settings scripts can configure every project (`gradle.beforeProject { p -> p.ext.x = … }`).
      settingsTexts: files
        .filter((file) => /(?:^|\/)settings\.gradle(?:\.kts)?$/.test(file.relative) && (!shippedOnly || !file.sample))
        .map((file) => stripGradleComments(file.text)),
    },
    shippedOnly,
    manifests,
    gradleFiles: [...androidGradleFiles, ...(shippedOnly ? allCatalogs.filter((file) => !file.sample) : allCatalogs)],
    targetSdkEvidence: [...unityTargetSdkEvidence, ...expo.targetSdkEvidence],
  };
}
