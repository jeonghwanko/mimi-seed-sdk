// Release Doctor project walk: which files are read, bounded source scanning, and Gradle convention builds.
// Internal to Release Doctor — import the public API (scanReleaseDoctor, report types) from ../release-doctor.js.

import fs from 'node:fs/promises';
import path from 'node:path';
import { closingBrace, stripGradleComments } from '../gradle-text.js';
import { FCM_HINT } from './fcm.js';
import { GRADLE_PLUGIN_BUILD, appliesAndroidAppPlugin } from './project.js';
import type { ProjectFile } from './types.js';
import { isWithin, isXcodePinFile, stripComments } from './util.js';

const SKIP_DIRS = new Set([
  '.git',
  '.gradle',
  '.idea',
  '.next',
  '.expo',
  'build',
  'dist',
  'node_modules',
  'Pods',
  'DerivedData',
  // Agent / git worktrees are full copies of the repository (often of other branches); scanning them doubles
  // every finding and floods the bounded source scan.
  '.worktrees',
  '.claude',
]);

// Bounded source scan for the FCM markers (FCM_HINT in ./fcm.ts; see readFcmSources).
const SOURCE_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx',
  '.py', '.go', '.java', '.kt', '.php', '.rb', '.cs', '.dart', '.swift', '.sh',
]);

const HASH_COMMENT_EXTENSIONS = new Set(['.py', '.rb', '.sh']);

const MAX_SOURCE_BYTES = 512 * 1024;

export const MAX_SOURCE_FILES = 4000;

const SOURCE_READ_CONCURRENCY = 32;

// Test, fixture, generated, or vendored trees say nothing about the shipped build or push code. Source files and
// Xcode pin files inside them are ignored (manifest files are still read, as before).
export const EXCLUDED_EVIDENCE_DIRS = new Set([
  '.cache', '.turbo', '.venv', '.vercel', '__pycache__', '__tests__', '__mocks__', '__fixtures__', 'coverage',
  'e2e', 'fixtures', 'Library', 'mocks', 'obj', 'out', 'spec', 'Temp', 'target', 'test', 'tests', 'vendor', 'venv',
  // Documentation and sample projects show pins and endpoints without building or running them. (An example app's
  // manifests are still read, so a library repo's xample/ app is detected as before.)
  'doc', 'docs', 'example', 'examples', 'sample', 'samples',
  // Third-party checkouts that carry their own CI and Xcode pins.
  'Carthage', '.build', '.symlinks', '.dart_tool', '.swiftpm',
  // Android instrumentation-test and test-fixture source sets.
  'androidTest', 'testFixtures',
]);

// Demo apps are often the real product of a small repository, so demo/ is only a *sample* tree: its app evidence,
// Xcode pins, and FCM sources count when no app exists outside sample trees (see `preferShipped`).
export const SAMPLE_ONLY_DIRS = new Set(['demo', 'demos']);

// Xcode test-target folders (UnitTests, UITests, WikipediaUITests, ...). Case-sensitive, so `contests` is not one.
export const TEST_TARGET_DIR = /Tests$/;

const TEST_SOURCE_FILE = /(?:\.(?:spec|test)\.[^.]+$|_test\.(?:go|py|dart)$|^test_[^/]+\.py$)/;

/** Codes whose check could not decide; see `coverage.unresolved`. */
export const UNRESOLVED_CODES = new Set([
  'TARGET_SDK_UNRESOLVED',
  'TARGET_SDK_POLICY_REFRESH_REQUIRED',
  'TARGET_SDK_SPECIALIZED_APP_REVIEW',
  'BILLING_UNRESOLVED',
  'IOS_XCODE_UNRESOLVED',
  'IOS_XCODE_MIXED_PINS',
  'IOS_SDK_POLICY_REFRESH_REQUIRED',
]);

interface ConventionRoot {
  dir: string;
  /** Flags of the place the convention build sits in (never of folders inside it, such as `com/example/`). */
  sample: boolean;
  demo: boolean;
  /** Known to build Gradle plugins (buildSrc/, build-logic/, a `pluginManagement { includeBuild(…) }` root): read first. */
  plugin: boolean;
}

/**
 * Every Gradle script and plugin source of the convention builds in the scan: buildSrc/ and build-logic/ folders at
 * any depth (also nested, as in `gradle/build-logic/`) and every `includeBuild("…")` root a settings script declares
 * inside the scanned tree, read with no depth limit of the project walk. Package folders inside them (`com/example/…`,
 * `test/`) never mark a file as a sample; a root several builds include is a sample only when every including build
 * is. Kotlin / Java / Groovy sources are read from every root except inside its Android application modules (the
 * app's own code, never a Gradle plugin). Plugin roots are read first, each within its own budget; a root the walk could not read completely is returned in
 * `truncated`, and the Target API check then cannot be OK. Included builds under node_modules/ are third-party
 * plugins, like binary plugins, and are not read.
 */
async function conventionFiles(root: string, files: ProjectFile[], found: ConventionRoot[]): Promise<{ files: ProjectFile[]; truncated: string[] }> {
  const declared: ConventionRoot[] = found.map((owner) => ({ ...owner, plugin: true }));
  for (const settings of files.filter((file) => /(?:^|\/)settings\.gradle(?:\.kts)?$/.test(file.relative))) {
    const dir = path.dirname(settings.absolute);
    const code = stripGradleComments(settings.text);
    const pluginManagement = /\bpluginManagement\s*\{/.exec(code);
    const pluginRange = pluginManagement
      ? [pluginManagement.index, closingBrace(code, pluginManagement.index + pluginManagement[0].length - 1)] as const
      : undefined;
    for (const match of code.matchAll(/\bincludeBuild\s*\(?\s*["']([^"'$]+)["']/g)) {
      const target = path.resolve(dir, match[1]);
      if (!isWithin(root, target) || isWithin(target, dir)) continue;
      if (path.relative(root, target).split(path.sep).some((segment) => SKIP_DIRS.has(segment))) continue;
      const plugin = Boolean(pluginRange && match.index > pluginRange[0] && (pluginRange[1] < 0 || match.index < pluginRange[1]));
      declared.push({ dir: target, sample: Boolean(settings.sample), demo: Boolean(settings.demo), plugin });
    }
  }
  // One entry per directory: a sample only when every build that includes it is one.
  const byDir = new Map<string, ConventionRoot>();
  for (const owner of declared) {
    const existing = byDir.get(owner.dir);
    byDir.set(owner.dir, existing
      ? { dir: owner.dir, sample: existing.sample && owner.sample, demo: existing.demo && owner.demo, plugin: existing.plugin || owner.plugin }
      : owner);
  }
  // Plugin builds first, then non-sample ones, then outer before inner: a directory is read once, by the first root
  // that reaches it, so a nested non-sample plugin root never takes an outer sample root's flags.
  const roots = [...byDir.values()].sort((left, right) => Number(right.plugin) - Number(left.plugin)
    || Number(left.sample) - Number(right.sample) || left.dir.length - right.dir.length);
  const result: ProjectFile[] = [];
  const truncated: string[] = [];
  const seen = new Set<string>();
  for (const owner of roots) {
    const scripts: string[] = [];
    const sources: string[] = [];
    let incomplete = false;
    const visit = async (dir: string, depth: number): Promise<void> => {
      if (seen.has(dir)) return;
      if (depth > MAX_CONVENTION_DEPTH || scripts.length + sources.length >= MAX_CONVENTION_PATHS) {
        incomplete = true;
        return;
      }
      seen.add(dir);
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) await visit(absolute, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const relative = path.relative(root, absolute).replace(/\\/g, '/');
        if (isRelevantFile(entry.name, relative)) scripts.push(absolute);
        else if (CONVENTION_SOURCE_FILE.test(entry.name)) sources.push(absolute);
      }
    };
    await visit(owner.dir, 0);
    const read = async (absolute: string): Promise<ProjectFile | undefined> => {
      try {
        if ((await fs.stat(absolute)).size > MAX_SOURCE_BYTES) return undefined;
        const relative = path.relative(root, absolute).replace(/\\/g, '/');
        return { absolute, relative, text: await fs.readFile(absolute, 'utf8'), sample: owner.sample, demo: owner.demo, convention: true };
      } catch {
        return undefined;
      }
    };
    const scriptFiles = (await Promise.all(scripts.map(read))).filter((file): file is ProjectFile => Boolean(file));
    result.push(...scriptFiles);
    // Plugin sources are read from every included build; only an Android application module's own sources (its
    // app code, never a Gradle plugin) are skipped — and never in a plugin root (buildSrc, build-logic, a
    // `pluginManagement { includeBuild }` root), whose every source is read.
    // A source belongs to the nearest project folder above it, so a plugin project nested in an app's folder is read.
    const projects = scriptFiles
      .filter((file) => /(?:^|\/)build\.gradle(?:\.kts)?$/.test(file.relative))
      .map((file) => ({ dir: path.dirname(file.absolute), app: !owner.plugin && appliesAndroidAppPlugin(file.text) && !GRADLE_PLUGIN_BUILD.test(stripGradleComments(file.text)) }))
      .sort((left, right) => right.dir.length - left.dir.length);
    const pluginSources = sources.filter((source) => !projects.find((project) => isWithin(project.dir, source))?.app);
    if (pluginSources.length > MAX_CONVENTION_FILES) incomplete = true;
    result.push(...(await Promise.all(pluginSources.slice(0, MAX_CONVENTION_FILES).map(read))).filter((file): file is ProjectFile => Boolean(file)));
    if (incomplete) truncated.push(path.relative(root, owner.dir).replace(/\\/g, '/') || '.');
  }
  return { files: result, truncated };
}

export async function walk(root: string, maxSourceFiles = MAX_SOURCE_FILES, maxDepth = 7): Promise<{
  files: ProjectFile[];
  fcmSources: ProjectFile[];
  sourceScanTruncated: boolean;
  /** Convention-build roots that could not be read completely. */
  conventionTruncated: string[];
}> {
  const files: ProjectFile[] = [];
  const conventionRoots: ConventionRoot[] = [];
  const sourceCandidates: Array<{ absolute: string; relative: string; depth: number; sample: boolean; demo: boolean }> = [];
  // `excluded`: inside a test/fixture/vendored tree or a nested repository (a directory with its own `.git`).
  // Manifest files there are still read exactly as before; Xcode pins and FCM source evidence are not.
  // `sample` additionally covers app projects inside a nested Swift package (a component library's demo app).
  async function visit(dir: string, depth: number, excluded: boolean, sample: boolean, demo: boolean): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const nestedRepository = depth > 0 && entries.some((entry) => entry.name === '.git');
    const excludedHere = excluded || nestedRepository;
    const sampleHere = sample || excludedHere || (depth > 0 && entries.some((entry) => entry.name === 'Package.swift'));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // A convention build is read whole by `conventionFiles` (no depth limit, no sample flags from inside it).
        if (CONVENTION_DIRS.has(entry.name)) {
          conventionRoots.push({ dir: absolute, sample: sampleHere, demo, plugin: true });
          continue;
        }
        if (!SKIP_DIRS.has(entry.name)) {
          const excludedChild = excludedHere
            || EXCLUDED_EVIDENCE_DIRS.has(entry.name)
            || TEST_TARGET_DIR.test(entry.name)
            || entry.name.startsWith('.next');
          const demoChild = demo || SAMPLE_ONLY_DIRS.has(entry.name);
          await visit(absolute, depth + 1, excludedChild, sampleHere || excludedChild || demoChild, demoChild);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      if (isRelevantFile(entry.name, relative)) {
        if (excludedHere && isXcodePinFile(entry.name, relative)) continue;
        try {
          files.push({ absolute, relative, text: await fs.readFile(absolute, 'utf8'), sample: sampleHere, demo });
        } catch {
          // Unreadable files are ignored; other evidence can still produce a useful partial report.
        }
        continue;
      }
      if (excludedHere || !SOURCE_EXTENSIONS.has(path.extname(entry.name)) || TEST_SOURCE_FILE.test(entry.name)) continue;
      sourceCandidates.push({ absolute, relative, depth, sample: sampleHere, demo });
    }
  }
  await visit(root, 0, false, false, false);
  // Files the project walk already read keep its flags (an included build can be a whole app, with its own samples),
  // except plugin sources under `src/main/{kotlin,java,groovy}/`, whose package folders (`com/example/…`) never make
  // them samples. The convention walk adds what that walk does not read (deep, or Kotlin/Java/Groovy plugin sources).
  const merged = new Map(files.map((file) => [file.absolute, file]));
  const convention = await conventionFiles(root, files, conventionRoots);
  for (const file of convention.files) {
    const pluginSource = /(?:^|\/)src\/main\/(?:kotlin|java|groovy)\//.test(file.relative)
      && !/(?:^|\/)(?:build|settings)\.gradle(?:\.kts)?$/.test(file.relative);
    if (!merged.has(file.absolute) || pluginSource) merged.set(file.absolute, file);
  }
  files.splice(0, files.length, ...merged.values());
  // Shallow files first, so a deep generated tree cannot crowd the project's own sources out of the cap.
  const prioritized = sourceCandidates
    .map((candidate, order) => ({ ...candidate, order }))
    .sort((left, right) => left.depth - right.depth || left.order - right.order);
  return {
    files,
    fcmSources: await readFcmSources(prioritized.slice(0, maxSourceFiles)),
    sourceScanTruncated: prioritized.length > maxSourceFiles,
    conventionTruncated: convention.truncated,
  };
}

// Source files are read only for the FCM markers; the text is kept only when a marker matches.
async function readFcmSources(
  candidates: Array<{ absolute: string; relative: string; sample: boolean; demo: boolean }>,
): Promise<ProjectFile[]> {
  const matches: ProjectFile[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < candidates.length) {
      const candidate = candidates[next++];
      try {
        // Oversized files are almost always generated bundles; skip them without reading megabytes.
        if ((await fs.stat(candidate.absolute)).size > MAX_SOURCE_BYTES) continue;
        const raw = await fs.readFile(candidate.absolute, 'utf8');
        if (!FCM_HINT.test(raw)) continue;
        const hash = HASH_COMMENT_EXTENSIONS.has(path.extname(candidate.absolute));
        const text = stripComments(raw, { slash: !hash, hash });
        if (FCM_HINT.test(text)) matches.push({ absolute: candidate.absolute, relative: candidate.relative, text, sample: candidate.sample, demo: candidate.demo });
      } catch {
        // Source files only add optional FCM evidence.
      }
    }
  }
  await Promise.all(Array.from({ length: SOURCE_READ_CONCURRENCY }, () => worker()));
  return matches.sort((left, right) => left.relative.localeCompare(right.relative));
}

function isRelevantFile(name: string, relative: string): boolean {
  return isXcodePinFile(name, relative)
    || name.endsWith('.xcconfig')
    || name === 'project.yml'
    || name === 'app.json'
    || name === 'app.config.json'
    || /^app\.config\.(?:js|cjs|mjs|ts)$/.test(name)
    // Every Gradle script (build, settings, applied scripts): the Target API net inventories each targetSdk setting
    // in them. Convention builds (buildSrc/, build-logic/, `includeBuild(…)` roots) are read by `conventionFiles`.
    || name.endsWith('.gradle')
    || name.endsWith('.gradle.kts')
    || name.endsWith('.versions.toml')
    || name === 'settings.gradle'
    || name === 'settings.gradle.kts'
    || name === 'gradle.properties'
    || name === 'AndroidManifest.xml'
    || name === 'Info.plist'
    || name === 'project.pbxproj'
    || name === 'ProjectSettings.asset'
    || name === 'package.json';
}

/** Directories holding a Gradle convention build, where a shared targetSdk is often set. */
const CONVENTION_DIRS = new Set(['buildSrc', 'build-logic', 'build_logic', 'buildLogic']);

/** Convention-build sources the Target API net reads: scripts and plugin sources in every JVM build language. */
export const CONVENTION_SOURCE_FILE = /\.(?:gradle|gradle\.kts|kts|kt|java|groovy)$/;

/**
 * Bounds for each root of the convention walk (it has no depth limit of its own, unlike the project walk): a root that
 * exceeds them is reported as not fully read, so the Target API check cannot pass on a partial read.
 */
const MAX_CONVENTION_DEPTH = 40;

const MAX_CONVENTION_PATHS = 20000;

const MAX_CONVENTION_FILES = 5000;
