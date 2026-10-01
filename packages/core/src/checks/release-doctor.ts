import fs from 'node:fs/promises';
import path from 'node:path';
import { checkBillingCompliance, reactNativeIapUpgradeTarget, type BillingComplianceResult } from './billing.js';
import { blankComments, blockContents, closingBrace, maskStrings, removeBlocks, stripGradleComments } from './gradle-text.js';
import { lockedPackageVersion, lockfileDirectories, readText, repositoryRoot } from './lockfile.js';

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

const TARGET_SDK_POLICY = [
  { effectiveDate: '2025-08-31', minimum: 35 },
  { effectiveDate: '2026-08-31', minimum: 36 },
] as const;

const TARGET_SDK_SOURCE = 'https://support.google.com/googleplay/android-developer/answer/11926878';

// Apple's App Store Connect upload minimums. Each row cites the Apple Developer news post that announced it.
// Apple announces the next minimum each spring, so the table is treated as stale from April 1 of the year after
// the newest row — add the new row before then instead of letting Release Doctor guess.
const IOS_SDK_POLICY = [
  {
    effectiveDate: '2025-04-24',
    minimumXcode: 16,
    sdk: 'iOS 18',
    sourceUrl: 'https://developer.apple.com/news/?id=9s0rgdy9',
  },
  {
    effectiveDate: '2026-04-28',
    minimumXcode: 26,
    sdk: 'iOS 26',
    sourceUrl: 'https://developer.apple.com/news/?id=ueeok6yw',
  },
] as const;

const IOS_SDK_POLICY_SOURCE = 'https://developer.apple.com/news/upcoming-requirements/';

// App Store Connect release notes: beta Xcode builds are accepted for TestFlight only; App Store submission needs
// a release or Release Candidate Xcode.
const IOS_BETA_TOOLS_NOTE = {
  en: 'TestFlight also accepts builds from beta Xcode releases, but App Store submission requires a release or Release Candidate (RC) Xcode.',
  ko: 'TestFlight는 베타 Xcode로 만든 빌드도 받지만, App Store 제출에는 정식 또는 RC(Release Candidate) Xcode가 필요합니다.',
} as const;

// Firebase Cloud Messaging legacy surfaces.
// - Legacy HTTP/XMPP send (fcm/send) was deprecated 2023-06-20 and shut down from 2024-07-22; the replacement is
//   the HTTP v1 API.
// - Instance ID server APIs (iid.googleapis.com, incl. legacy topic management) and device group management
//   (fcm.googleapis.com/fcm/notification and its aliases) are decommissioned 2027-09-29 (FCM troubleshooting FAQ).
// - firebase-admin (Node) 14.5.0 moved subscribeToTopic/unsubscribeFromTopic off Instance ID onto the FCM v1 topic
//   subscription API and added deprecated *Legacy escape hatches that still use Instance ID. The FAQ lists Node
//   Admin SDK <= 14.4.0 as impacted. firebase-admin 14.x declares engines.node >= 22.
const FCM_LEGACY_SEND_SOURCE = 'https://firebase.google.com/docs/cloud-messaging/send/v1-api';
const FCM_DEPRECATION_SOURCE = 'https://firebase.google.com/docs/cloud-messaging/troubleshooting#fcm-26-deprecation';
const FCM_INSTANCE_ID_DECOMMISSION = '2027-09-29';
const FIREBASE_ADMIN_TOPICS_SOURCE = 'https://github.com/firebase/firebase-admin-node/releases/tag/v14.5.0';
const FIREBASE_ADMIN_TOPICS_VERSION = [14, 5, 0] as const;
const FIREBASE_ADMIN_14_NODE = '22';

const FCM_LEGACY_SEND = /\b(?:fcm\.googleapis\.com\/fcm\/send|gcm-http\.googleapis\.com\/gcm\/send)\b/;
const FCM_INSTANCE_ID = /\biid\.googleapis\.com\b/;
const FCM_DEVICE_GROUP = /\bfcm\.googleapis\.com\/(?:fcm\/|gcm\/|iid\/)?notification\b/;
const FCM_LEGACY_TOPIC_METHOD = /\b(?:subscribeToTopicLegacy|unsubscribeFromTopicLegacy)\b/;
const FCM_HINT = new RegExp([FCM_LEGACY_SEND, FCM_INSTANCE_ID, FCM_DEVICE_GROUP, FCM_LEGACY_TOPIC_METHOD]
  .map((re) => re.source).join('|'));

// Bounded source scan for the FCM markers above (see readFcmSources).
const SOURCE_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx',
  '.py', '.go', '.java', '.kt', '.php', '.rb', '.cs', '.dart', '.swift', '.sh',
]);
const HASH_COMMENT_EXTENSIONS = new Set(['.py', '.rb', '.sh']);
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_SOURCE_FILES = 4000;
const SOURCE_READ_CONCURRENCY = 32;
// Test, fixture, generated, or vendored trees say nothing about the shipped build or push code. Source files and
// Xcode pin files inside them are ignored (manifest files are still read, as before).
const EXCLUDED_EVIDENCE_DIRS = new Set([
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
const SAMPLE_ONLY_DIRS = new Set(['demo', 'demos']);
// Xcode test-target folders (UnitTests, UITests, WikipediaUITests, ...). Case-sensitive, so `contests` is not one.
const TEST_TARGET_DIR = /Tests$/;
const TEST_SOURCE_FILE = /(?:\.(?:spec|test)\.[^.]+$|_test\.(?:go|py|dart)$|^test_[^/]+\.py$)/;

export type ReleaseDoctorSeverity = 'blocker' | 'warning' | 'info';

export interface ReleaseDoctorFinding {
  code: string;
  severity: ReleaseDoctorSeverity;
  title: string;
  detail: string;
  action?: string;
  file?: string;
  sourceUrl?: string;
  ko?: {
    title: string;
    detail: string;
    action?: string;
  };
}

export interface ReleaseDoctorReport {
  projectPath: string;
  checkedAt: string;
  platforms: Array<'android' | 'ios'>;
  identifiers: {
    androidPackageNames: string[];
    iosBundleIds: string[];
  };
  counts: Record<ReleaseDoctorSeverity, number>;
  findings: ReleaseDoctorFinding[];
  /** Per judged Android app module: the targetSdk values proven, or why it is unresolved. */
  targetSdkModules?: TargetSdkModuleVerdict[];
  /**
   * Every targetSdk token in the scanned Gradle scripts and how it was classified (the fail-closed net): an
   * unrecognised in-scope token, or an unattributable one below the minimum, keeps the verdict from TARGET_SDK_OK.
   */
  targetSdkTokens?: TargetSdkToken[];
  coverage: {
    checked: string[];
    /**
     * Codes of findings for checks that ran but could not reach a verdict (a blocker could hide behind them). The
     * report is not an all-clear while this is non-empty.
     */
    unresolved: string[];
    requiresStoreConnection: string[];
  };
}

interface ProjectFile {
  absolute: string;
  relative: string;
  text: string;
  /**
   * Inside an example, sample, demo, test, vendored, or nested-repository tree, or an app project inside a nested
   * Swift package. Such files still detect the platform, but their app identifiers and targetSdk are used only
   * when the scan finds no app outside those trees (a library repository whose only app is its example).
   */
  sample?: boolean;
  /** Read from the enclosing repository root, outside the scanned `--path` (CI files, the root version catalog). */
  outside?: boolean;
  /** Inside a demo/ or demos/ tree (a subset of `sample`). */
  demo?: boolean;
}

/** Codes whose check could not decide; see `coverage.unresolved`. */
const UNRESOLVED_CODES = new Set([
  'TARGET_SDK_UNRESOLVED',
  'TARGET_SDK_POLICY_REFRESH_REQUIRED',
  'TARGET_SDK_SPECIALIZED_APP_REVIEW',
  'BILLING_UNRESOLVED',
  'IOS_XCODE_UNRESOLVED',
  'IOS_XCODE_MIXED_PINS',
  'IOS_SDK_POLICY_REFRESH_REQUIRED',
]);

async function walk(root: string, maxSourceFiles = MAX_SOURCE_FILES, maxDepth = 7): Promise<{
  files: ProjectFile[];
  fcmSources: ProjectFile[];
  sourceScanTruncated: boolean;
}> {
  const files: ProjectFile[] = [];
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
  // Shallow files first, so a deep generated tree cannot crowd the project's own sources out of the cap.
  const prioritized = sourceCandidates
    .map((candidate, order) => ({ ...candidate, order }))
    .sort((left, right) => left.depth - right.depth || left.order - right.order);
  return {
    files,
    fcmSources: await readFcmSources(prioritized.slice(0, maxSourceFiles)),
    sourceScanTruncated: prioritized.length > maxSourceFiles,
  };
}

/** Drops comments so a commented-out URL or pin never counts as live evidence. */
function stripComments(text: string, style: { slash: boolean; hash: boolean }): string {
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

function isXcodePinFile(name: string, relative: string): boolean {
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
function isXcodeCloudScript(relative: string): boolean {
  return /(?:^|\/)ci_scripts\/ci_(?:post_clone|pre_xcodebuild|post_xcodebuild)\.sh$/.test(relative);
}

function isRelevantFile(name: string, relative: string): boolean {
  return isXcodePinFile(name, relative)
    || name.endsWith('.xcconfig')
    || name === 'project.yml'
    || name === 'app.json'
    || name === 'app.config.json'
    || /^app\.config\.(?:js|cjs|mjs|ts)$/.test(name)
    // Every Gradle script (build, settings, applied and precompiled convention scripts) and the Kotlin sources of
    // buildSrc / build-logic convention plugins: the Target API net inventories each targetSdk setting in them.
    || name.endsWith('.gradle')
    || name.endsWith('.gradle.kts')
    || (name.endsWith('.kt') && CONVENTION_SOURCE.test(relative))
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

/** Sources of Gradle convention plugins (`buildSrc/`, `build-logic/`), where a shared targetSdk is often set. */
const CONVENTION_SOURCE = /(?:^|\/)(?:buildSrc|build-logic|build_logic|buildLogic)\//;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

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

const REACT_NATIVE_CATALOG = 'node_modules/react-native/gradle/libs.versions.toml';

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
const PLUGIN_MENTION = /\b(?:hasPlugin|withId|withPlugin|findPlugin|getPlugin|findByName|getByName|listOf|setOf|arrayOf|mutableListOf|mutableSetOf|contains|containsKey|equals|startsWith|endsWith|matches|filter|any|none)\s*\(|[=!]=|->|\bin\s*[[(]|\b(?:def|val|var|const)\s+[A-Za-z_]\w*\s*(?::\s*[\w<>?.]+\s*)?=|\bclasspath\b|\bapply\s*\(?\s*false\b/;

function appliesAndroidPlugin(text: string, id: RegExp): boolean {
  const lines = blankComments(text).split(/\r?\n/);
  return lines.some((line, index) => id.test(line)
    && !PLUGIN_MENTION.test(line)
    // `id(\n  "com.android.application"\n) apply false`
    && !lines.slice(index + 1, index + 3).some((next) => /^\s*\)?\s*(?:version\b[^\n]*?)?\bapply\s*\(?\s*false\b/.test(next)));
}

/** Applies the Android application plugin — a root `plugins { … apply false }` declaration only makes it available. */
function appliesAndroidAppPlugin(text: string): boolean {
  return appliesAndroidPlugin(text, ANDROID_APP_PLUGIN_ID);
}

/** Applies an Android library / test plugin and not the application plugin: its targetSdk is not the app's. */
function appliesOnlyAndroidLibraryPlugin(text: string): boolean {
  return appliesAndroidPlugin(text, ANDROID_LIBRARY_PLUGIN_ID) && !appliesAndroidAppPlugin(text);
}

/** `[versions]` entries of the scanned Gradle version catalogs (React Native's bundled catalog excluded unless asked). */
function catalogVersions(files: ProjectFile[], includeReactNative = false): Map<string, { value: string; file: string }> {
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
function nearestCatalog(file: ProjectFile, catalogs: ProjectFile[]): ProjectFile | undefined {
  const candidates = catalogs.filter((catalog) => catalog.relative !== REACT_NATIVE_CATALOG
    && path.posix.basename(catalog.relative) === 'libs.versions.toml');
  const containing = candidates
    .filter((catalog) => isWithin(catalogBuildRoot(catalog), file.absolute))
    .sort((left, right) => catalogBuildRoot(right).length - catalogBuildRoot(left).length);
  return containing[0] ?? (candidates.length === 1 ? candidates[0] : undefined);
}

type CatalogVersions = Map<string, { value: string; file: string }>;
/** Version catalogs visible to a Gradle file, by accessor (`libs`, `androidx`); null when declared but unreadable. */
type CatalogResolver = (file: ProjectFile) => Map<string, CatalogVersions | null>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
type PropertyScope = (file: ProjectFile) => Map<string, { value: string; file: string } | null>;

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
function catalogValue(catalogs: Map<string, CatalogVersions | null>, accessor: string, alias: string) {
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

/** The Gradle module directory a file belongs to (`app-wearos/src/main/AndroidManifest.xml` -> `app-wearos`). */
function moduleDir(relative: string): string {
  if (relative.startsWith('src/')) return '.';
  const source = relative.lastIndexOf('/src/');
  return source >= 0 ? relative.slice(0, source) : path.posix.dirname(relative);
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
function specializedAndroidModules(manifests: ProjectFile[], appModules: string[]): Set<string> {
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
function isOneAppWithExtensions(ids: string[]): boolean {
  return ids.some((main) => ids.every((id) => id === main || id.startsWith(`${main}.`))
    && !ids.some((parent) => parent !== main && !/watch/i.test(parent.slice(parent.lastIndexOf('.') + 1))
      && ids.some((child) => child.startsWith(`${parent}.`))));
}

async function detectProject(files: ProjectFile[], root: string) {
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
  const androidAppGradleFiles = gradleFiles.filter((file) => appliesAndroidAppPlugin(file.text)
    || APPLICATION_ID_ANY.test(gradleDslText(file.text)));
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

function targetPolicy(now: Date): { minimum: number | null; scheduleCurrent: boolean; effectiveDate?: string } {
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
   * `def targetSdk = 36`). `read`: reads it on a right-hand side or as an argument. `unknown`: a shape the scanner
   * does not model, which keeps the verdict from TARGET_SDK_OK.
   */
  kind: 'assign' | 'define' | 'read' | 'unknown';
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

/** The `{` blocks enclosing `index` in string-masked code (outermost first), each with the word before its brace. */
function enclosingBlocks(masked: string, index: number): Array<{ open: number; opener: string }> {
  const stack: Array<{ open: number; opener: string }> = [];
  for (let cursor = 0; cursor < index && cursor < masked.length; cursor++) {
    if (masked[cursor] === '{') {
      const opener = masked.slice(Math.max(0, cursor - 80), cursor).match(/([A-Za-z_]\w*)\s*(?:\([^()]*\))?\s*$/)?.[1] ?? '';
      stack.push({ open: cursor, opener });
    } else if (masked[cursor] === '}') {
      stack.pop();
    }
  }
  return stack;
}

/** End of the expression starting at `from` in masked code: a line break, `;`, or unmatched closer outside brackets. */
function statementEnd(masked: string, from: number): number {
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

interface ScannedToken {
  index: number;
  line: number;
  kind: TargetSdkToken['kind'];
  expression?: string;
  release?: number;
  block?: boolean;
}

/** After this (the last code before a token or its receiver chain), the token is a value being read. */
const READ_CONTEXT = /(?:[=(,+\-*/%<!&|?:[~^]|(?<!-)>|\b(?:return|println|print|assert|logger\.\w+|in|is|as))\s*$/;

/**
 * Every `targetSdk`, `targetSdkVersion`, `setTargetSdk(Version)` token of a script outside strings and comments,
 * classified. Assignments: `targetSdk 36` / `targetSdkVersion 36` (Groovy, also after a receiver chain such as
 * `android.defaultConfig.` or `p.android.defaultConfig.`), `targetSdk = x`, `targetSdkVersion(x)` and
 * `setTargetSdkVersion(x)` with balanced parentheses, `targetSdk { version = release(36) }`. Definitions: extra
 * properties (`ext.targetSdkVersion = 36`, inside `ext { }`) and locals (`def`/`val`/`var`). Reads: the token on a
 * right-hand side, in a condition, or as an argument. Anything else — a named argument (`f(targetSdk = 33)`), a
 * `targetSdk { … }` block other than `version = release(n)`, a bare statement — is `unknown`.
 */
function targetSdkTokens(text: string): ScannedToken[] {
  const masked = maskStrings(text);
  const code = blankComments(text);
  const result: ScannedToken[] = [];
  const pattern = /(?<![\w$])(?:setTargetSdk(?:Version)?|targetSdk(?:Version)?)\b/g;
  let consumed = -1;
  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    if (match.index < consumed) continue;
    const token = match;
    const setter = token[0].startsWith('set');
    const line = masked.slice(0, token.index).split('\n').length;
    const chain = masked.slice(Math.max(0, token.index - 200), token.index)
      .match(/((?:[A-Za-z_$][\w$]*\s*(?:\(\s*\))?\s*\??\.\s*)*)$/)?.[1] ?? '';
    const before = masked.slice(Math.max(0, token.index - chain.length - 200), token.index - chain.length);
    const readContext = READ_CONTEXT.test(before);
    const afterStart = token.index + token[0].length;
    const after = masked.slice(afterStart, afterStart + 200);
    const extraReceiver = /(?:^|\.)\s*(?:ext|extra)\s*\.\s*$/.test(chain);
    const inExtBlock = chain === '' && ['ext', 'extra'].includes(enclosingBlocks(masked, token.index).at(-1)?.opener ?? '');
    const push = (row: Omit<ScannedToken, 'index' | 'line'>) => result.push({ index: token.index, line, ...row });

    if (chain === '' && /\b(?:def|val|var)\s+$/.test(before)) {
      push({ kind: 'define' });
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
  return result;
}

/** Index ranges of `subprojects { … }` / `allprojects { … }` blocks (their nested closures included). */
function everyProjectBlocks(text: string): Array<readonly [number, number]> {
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
function targetSdkFindings(
  gradleFiles: ProjectFile[],
  now: Date,
  supplementalEvidence: Array<{ file: string; value: number }> = [],
  resolveCatalogs?: CatalogResolver,
  properties?: { scope: PropertyScope; ciOverrides: Set<string>; settingsTexts?: string[] },
  modules: TargetSdkModule[] = [],
  net: TargetSdkNetScript[] = [],
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
        new RegExp(`\\b(?:ext|extra)\\.${quoted}\\s*=(?!=)\\s*([^\\n;]+)`, 'g'),
        new RegExp(`\\b(?:ext|extra)\\s*\\[\\s*["']${quoted}["']\\s*\\]\\s*=(?!=)\\s*([^\\n;]+)`, 'g'),
        new RegExp(`\\bset\\s*\\(\\s*["']${quoted}["']\\s*,\\s*([^)\\n]+)\\)`, 'g'),
      ]) {
        for (const match of code.matchAll(pattern)) add(match[1], file.relative);
      }
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
      if (file !== use.script || index > use.index) return 'unresolved';
      const masked = maskStrings(file.text);
      const declaredIn = enclosingBlocks(masked, index).map((block) => block.open);
      const usedIn = enclosingBlocks(masked, use.index).map((block) => block.open);
      if (declaredIn.some((open, position) => usedIn[position] !== open)) return 'unresolved';
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
    const label = `${token.block || !token.expression ? token.expression ?? 'targetSdk' : `targetSdk = ${token.expression}`} (${script.relative}:${token.line})`;
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

  const evaluate = (module: TargetSdkModule): TargetSdkModuleVerdict => {
    const verdict: TargetSdkModuleVerdict = { module: moduleDir(module.file.relative), values: [], resolved: true, unresolved: [] };
    let assignments = 0;
    const consider = (script: ProjectFile, token: ScannedToken) => {
      if (token.kind === 'read' || token.kind === 'define') {
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
    for (const script of new Set(module.scripts)) for (const token of tokensOf(script)) consider(script, token);
    // The build root's every-project configuration always counts — a root `afterEvaluate` or `plugins.withId` may
    // override what the module sets.
    for (const script of new Set(module.inherited ?? [])) {
      if (module.scripts.includes(script)) continue;
      const ranges = everyProjectBlocks(script.text);
      for (const token of tokensOf(script)) {
        if (ranges.some(([open, close]) => token.index > open && token.index < close)) consider(script, token);
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
  const used = new Map(modules.flatMap((module) => [...module.scripts, ...(module.inherited ?? [])]).map((file) => [file.absolute, file]));
  const netScripts = new Map<string, TargetSdkNetScript>();
  for (const entry of net) netScripts.set(entry.file.absolute, { ...entry, file: used.get(entry.file.absolute) ?? entry.file });
  for (const file of used.values()) if (!netScripts.has(file.absolute)) netScripts.set(file.absolute, { file });
  const netIssues: string[] = [];
  for (const { file: script, excluded, inherited } of netScripts.values()) {
    for (const token of tokensOf(script)) {
      if (inventory.get(`${script.absolute}\u0000${token.index}`)?.attributed) continue;
      if (excluded || token.kind === 'read' || token.kind === 'define') {
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

interface XcodeEvidence {
  file: string;
  /** What was found, as written in the file (for the report). */
  raw: string;
  /** Xcode major version, when the evidence names one. */
  major?: number;
  beta: boolean;
  /** From the repository root, outside the scanned --path: it may build a different app, so it never decides. */
  outside?: boolean;
}

function xcodeEvidence(file: string, raw: string, version: string): XcodeEvidence {
  // Accepts `26.2`, `v26.2`, `Xcode_26.0`, `xcode-26`, `26.0-beta`.
  const major = version.replace(/^\s*xcode[\s_-]?/i, '').match(/^\D{0,3}?(\d+)(?:\.\d+)*/)?.[1];
  return {
    file,
    raw: raw.trim(),
    major: major ? Number.parseInt(major, 10) : undefined,
    beta: /beta/i.test(version),
  };
}

function easXcodeEvidence(file: ProjectFile): XcodeEvidence[] {
  let json: unknown;
  try {
    json = JSON.parse(file.text);
  } catch {
    return [];
  }
  const build = (json as { build?: unknown })?.build;
  if (!build || typeof build !== 'object') return [];
  const profiles = new Map(Object.entries(build as Record<string, unknown>)
    .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[1]) && typeof entry[1] === 'object'));

  // A profile inherits everything from its `extends` chain; `ios` is merged one level deep.
  function effective(name: string, seen = new Set<string>()): Record<string, unknown> {
    const profile = profiles.get(name);
    if (!profile || seen.has(name)) return {};
    seen.add(name);
    const parent = typeof profile.extends === 'string' ? effective(profile.extends, seen) : {};
    const parentIos = parent.ios && typeof parent.ios === 'object' ? parent.ios as Record<string, unknown> : {};
    const ownIos = profile.ios && typeof profile.ios === 'object' ? profile.ios as Record<string, unknown> : {};
    return { ...parent, ...profile, ios: { ...parentIos, ...ownIos } };
  }

  // Profiles that other profiles extend are shared bases, not builds of their own.
  const bases = new Set([...profiles.values()]
    .map((profile) => profile.extends)
    .filter((value): value is string => typeof value === 'string'));
  const storeProfiles = [...profiles.keys()]
    .filter((name) => !bases.has(name))
    .map((name) => [name, effective(name)] as const)
    .filter(([, profile]) => {
      const ios = profile.ios as Record<string, unknown>;
      return profile.developmentClient !== true
        && profile.distribution !== 'internal'
        && ios.simulator !== true;
    });

  const result: XcodeEvidence[] = [];
  for (const [name, profile] of storeProfiles) {
    const ios = profile.ios as Record<string, unknown>;
    const image = typeof ios.image === 'string' ? ios.image : undefined;
    if (!image) {
      result.push({ file: file.relative, raw: `build.${name}: no ios.image (EAS selects the image automatically)`, beta: false });
      continue;
    }
    // EAS iOS image names embed the Xcode version, e.g. macos-sequoia-15.6-xcode-26.2. Aliases such as
    // auto, default, latest, or sdk-NN move with every Expo SDK release, so they stay unresolved.
    const xcode = image.match(/xcode-(\d+(?:\.\d+)*)/i);
    result.push(xcode
      ? xcodeEvidence(file.relative, `build.${name}.ios.image: ${image}`, xcode[1])
      : { file: file.relative, raw: `build.${name}.ios.image: ${image}`, beta: false });
  }
  return result;
}

function ciXcodeEvidence(file: ProjectFile): XcodeEvidence[] {
  const result: XcodeEvidence[] = [];
  const groovy = file.relative.endsWith('Jenkinsfile');
  const text = stripComments(file.text, { slash: groovy, hash: !groovy });
  if (file.relative.endsWith('.xcode-version')) {
    const line = text.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
    if (line) result.push(xcodeEvidence(file.relative, line, line));
    return result;
  }
  // maxim-lobanov/setup-xcode and similar actions.
  for (const match of text.matchAll(/\bxcode-version:\s*['"]?([^'"\s,}]+)['"]?/g)) {
    result.push(xcodeEvidence(file.relative, match[0], match[1]));
  }
  // fastlane actions that select or assert an Xcode version.
  for (const match of text.matchAll(/\b(?:xcversion|xcodes|ensure_xcode_version)\b\s*\(?\s*version:\s*['"]([^'"]+)['"]/g)) {
    result.push(xcodeEvidence(file.relative, match[0], match[1]));
  }
  // Codemagic `environment: xcode: 16.2` (or latest / edge).
  if (/codemagic\.ya?ml$/.test(file.relative)) {
    for (const match of text.matchAll(/^\s*xcode:\s*['"]?([^'"\s]+)['"]?/gm)) {
      result.push(xcodeEvidence(file.relative, match[0], match[1]));
    }
  }
  // GitLab hosted macOS runners: `image: macos-26-xcode-26` (the image name embeds the Xcode version).
  if (file.relative.endsWith('.gitlab-ci.yml')) {
    for (const match of text.matchAll(/\bmacos-[\w.]+-xcode-(\d+(?:\.\d+)*)\b/g)) {
      result.push(xcodeEvidence(file.relative, `image: ${match[0]}`, match[1]));
    }
  }
  // xcode-select / DEVELOPER_DIR paths such as /Applications/Xcode_16.2.app or /Applications/Xcode-beta.app.
  for (const match of text.matchAll(/\/Applications\/Xcode([^/\s'"]*)\.app/g)) {
    const suffix = match[1];
    const version = suffix.match(/\d+(?:\.\d+)*/)?.[0];
    result.push(version
      ? { ...xcodeEvidence(file.relative, match[0], version), beta: /beta/i.test(suffix) }
      : { file: file.relative, raw: match[0], beta: /beta/i.test(suffix) });
  }
  // A macOS runner without an Xcode pin builds with whatever the runner image defaults to.
  if (result.length === 0 && /(?:^|\/)\.github\/workflows\//.test(file.relative)) {
    const runner = text.match(/\bruns-on:\s*['"]?(macos-[\w.-]+)/);
    if (runner) result.push({ file: file.relative, raw: `runs-on: ${runner[1]} (runner image default Xcode)`, beta: false });
  }
  return result;
}

function collectXcodeEvidence(files: ProjectFile[]): XcodeEvidence[] {
  const evidence: XcodeEvidence[] = [];
  const xcodeCloudDirs = new Set<string>();
  for (const file of files) {
    const name = path.posix.basename(file.relative);
    if (!isXcodePinFile(name, file.relative)) continue;
    if (isXcodeCloudScript(file.relative)) {
      // One row per ci_scripts/ folder: Xcode Cloud picks Xcode in the App Store Connect workflow, not in the repo.
      const dir = path.posix.dirname(file.relative);
      if (!xcodeCloudDirs.has(dir)) {
        xcodeCloudDirs.add(dir);
        evidence.push({ file: file.relative, raw: 'Xcode Cloud custom build script; the Xcode version is set in the App Store Connect workflow', beta: false, outside: file.outside });
      }
      continue;
    }
    const rows = name === 'eas.json' ? easXcodeEvidence(file) : ciXcodeEvidence(file);
    evidence.push(...rows.map((row) => ({ ...row, outside: file.outside })));
  }
  return evidence;
}

function iosSdkPolicy(now: Date) {
  const today = now.toISOString().slice(0, 10);
  const current = [...IOS_SDK_POLICY].filter((row) => row.effectiveDate <= today).at(-1);
  const refreshFrom = `${Number(IOS_SDK_POLICY.at(-1)!.effectiveDate.slice(0, 4)) + 1}-04-01`;
  return { current, scheduleCurrent: today < refreshFrom };
}

function describePins(rows: XcodeEvidence[]): string {
  const shown = rows.slice(0, 4).map((row) => `${row.file} (${row.raw})`).join('; ');
  return rows.length > 4 ? `${shown}; +${rows.length - 4}` : shown;
}

function iosXcodeFindings(files: ProjectFile[], now: Date): ReleaseDoctorFinding[] {
  const policy = iosSdkPolicy(now);
  if (!policy.scheduleCurrent) {
    return [{
      code: 'IOS_SDK_POLICY_REFRESH_REQUIRED',
      severity: 'warning',
      title: 'App Store Xcode / SDK minimum table needs a refresh',
      detail: 'The embedded App Store Connect upload minimums are no longer current enough for a definitive result.',
      action: 'Check the current Apple SDK minimum requirement before uploading to App Store Connect.',
      sourceUrl: IOS_SDK_POLICY_SOURCE,
      ko: {
        title: 'App Store Xcode / SDK 최소 요건표 갱신 필요',
        detail: '내장된 App Store Connect 업로드 최소 요건만으로는 현재 기준을 확정할 수 없습니다.',
        action: 'App Store Connect에 업로드하기 전에 Apple의 최신 SDK 최소 요건을 확인하세요.',
      },
    }];
  }
  // Before the first recorded requirement there is no minimum to check against.
  if (!policy.current) return [];

  const { minimumXcode, sdk, effectiveDate, sourceUrl } = policy.current;
  const allEvidence = collectXcodeEvidence(files);
  // The verdict comes from evidence inside the scanned path. CI files read from the repository root (outside a
  // --path) may build another app, so they can neither make nor cancel a verdict; when they are all there is, they
  // are only cited for the user to check.
  const evidence = allEvidence.filter((row) => !row.outside);
  const outside = allEvidence.filter((row) => row.outside);
  if (evidence.length === 0 && outside.length > 0) {
    const listed = describePins(outside);
    return [{
      code: 'IOS_XCODE_UNRESOLVED',
      severity: 'info',
      title: 'The Xcode version used for iOS release builds could not be resolved locally',
      detail: `No Xcode pin was found inside the scanned path. CI files at the repository root name: ${listed}. They may build a different app, so Release Doctor does not judge from them. ${IOS_BETA_TOOLS_NOTE.en}`,
      action: `Confirm the job that archives this app uses Xcode ${minimumXcode} or later with the ${sdk} SDK (run \`xcodebuild -version\` on the build machine).`,
      file: outside[0].file,
      sourceUrl,
      ko: {
        title: 'iOS 릴리스 빌드의 Xcode 버전을 로컬에서 확정하지 못함',
        detail: `검사 경로 안에서는 Xcode 고정값을 찾지 못했습니다. 저장소 루트의 CI 파일에 있는 값: ${listed}. 다른 앱을 빌드하는 job일 수 있어 이것만으로 판정하지 않습니다. ${IOS_BETA_TOOLS_NOTE.ko}`,
        action: `이 앱을 archive하는 job이 Xcode ${minimumXcode} 이상과 ${sdk} SDK를 쓰는지 빌드 머신에서 \`xcodebuild -version\`으로 확인하세요.`,
      },
    }];
  }
  const resolved = evidence.filter((row): row is XcodeEvidence & { major: number } => row.major !== undefined);

  if (resolved.length === 0) {
    const listed = describePins(evidence);
    return [{
      code: 'IOS_XCODE_UNRESOLVED',
      severity: 'info',
      title: 'The Xcode version used for iOS release builds could not be resolved locally',
      detail: `${listed
        ? `Xcode evidence was found but names no fixed version: ${listed}.`
        : 'No pinned Xcode version was found in .xcode-version, GitHub Actions, GitLab CI, Jenkinsfile, fastlane, Codemagic, or eas.json; the build uses whatever Xcode the build machine selects.'} ${IOS_BETA_TOOLS_NOTE.en}`,
      action: `Confirm the release build uses Xcode ${minimumXcode} or later with the ${sdk} SDK (run \`xcodebuild -version\` on the build machine), or pin the version in CI.`,
      file: evidence[0]?.file,
      sourceUrl,
      ko: {
        title: 'iOS 릴리스 빌드의 Xcode 버전을 로컬에서 확정하지 못함',
        detail: `${listed
          ? `Xcode 관련 설정은 찾았지만 고정된 버전이 없습니다: ${listed}.`
          : '.xcode-version, GitHub Actions, GitLab CI, Jenkinsfile, fastlane, Codemagic, eas.json에서 고정된 Xcode 버전을 찾지 못했습니다. 빌드 머신에서 선택된 Xcode가 그대로 사용됩니다.'} ${IOS_BETA_TOOLS_NOTE.ko}`,
        action: `릴리스 빌드가 Xcode ${minimumXcode} 이상과 ${sdk} SDK를 쓰는지 빌드 머신에서 \`xcodebuild -version\`으로 확인하거나 CI에 버전을 고정하세요.`,
      },
    }];
  }

  const sorted = [...resolved].sort((left, right) => left.major - right.major);
  const below = sorted.filter((row) => row.major < minimumXcode);
  const meeting = sorted.filter((row) => row.major >= minimumXcode);
  const unresolved = evidence.filter((row) => row.major === undefined);
  const lowest = sorted[0];

  // A definite blocker needs every piece of Xcode evidence to be a resolved pin below the minimum. A newer pin, or an
  // unpinned/auto-selected build (EAS without ios.image, an unpinned macOS runner), may be the one that uploads;
  // mixed evidence usually means a compatibility job, an unused variable, or a secondary lane.
  if (below.length > 0 && meeting.length === 0 && unresolved.length === 0) {
    return [{
      code: 'IOS_XCODE_BELOW_MINIMUM',
      severity: 'blocker',
      title: `Xcode ${lowest.major} is below the App Store Connect upload minimum`,
      detail: `Since ${effectiveDate}, apps uploaded to App Store Connect must be built with Xcode ${minimumXcode} or later using the ${sdk} SDK. Every pinned Xcode found is older: ${describePins(below)}.`,
      action: `Build the release with Xcode ${minimumXcode} or later and update the pinned version in ${lowest.file}.`,
      file: lowest.file,
      sourceUrl,
      ko: {
        title: `Xcode ${lowest.major}은 App Store Connect 업로드 최소 기준 미달`,
        detail: `${effectiveDate}부터 App Store Connect에 업로드하는 앱은 Xcode ${minimumXcode} 이상과 ${sdk} SDK로 빌드해야 합니다. 감지된 Xcode 고정값이 모두 이보다 낮습니다: ${describePins(below)}.`,
        action: `Xcode ${minimumXcode} 이상으로 릴리스 빌드를 만들고 ${lowest.file}의 고정 버전을 올리세요.`,
      },
    }];
  }

  if (below.length > 0) {
    return [{
      code: 'IOS_XCODE_MIXED_PINS',
      severity: 'warning',
      title: `A pinned Xcode is below the App Store Connect upload minimum (Xcode ${minimumXcode}), next to other Xcode evidence`,
      detail: [
        `Below the minimum: ${describePins(below)}.`,
        meeting.length ? `At or above it: ${describePins(meeting)}.` : '',
        unresolved.length ? `No fixed version (auto-selected or unpinned): ${describePins(unresolved)}.` : '',
        'Release Doctor cannot tell which job or lane uploads to App Store Connect.',
      ].filter(Boolean).join(' '),
      action: `Make sure the job that archives and uploads the release uses Xcode ${minimumXcode} or later; older pins are fine only for test or compatibility jobs.`,
      file: below[0].file,
      sourceUrl,
      ko: {
        title: `다른 Xcode 근거와 함께 App Store Connect 업로드 최소 기준(Xcode ${minimumXcode}) 미달 고정값이 있음`,
        detail: [
          `기준 미달: ${describePins(below)}.`,
          meeting.length ? `기준 충족: ${describePins(meeting)}.` : '',
          unresolved.length ? `고정 버전 없음(자동 선택 또는 미고정): ${describePins(unresolved)}.` : '',
          '어느 job 또는 lane이 App Store Connect에 업로드하는지는 저장소만으로 알 수 없습니다.',
        ].filter(Boolean).join(' '),
        action: `릴리스를 archive·업로드하는 job이 Xcode ${minimumXcode} 이상을 쓰는지 확인하세요. 낮은 버전은 테스트나 호환성 job에서만 괜찮습니다.`,
      },
    }];
  }

  const beta = resolved.some((row) => row.beta);
  return [{
    code: 'IOS_XCODE_OK',
    severity: 'info',
    title: `Xcode ${lowest.major} meets the App Store Connect upload minimum`,
    detail: `The lowest pinned Xcode found is at least Xcode ${minimumXcode} (${sdk} SDK).${beta ? ` ${IOS_BETA_TOOLS_NOTE.en}` : ''}`,
    file: lowest.file,
    sourceUrl,
    ko: {
      title: `Xcode ${lowest.major}은 App Store Connect 업로드 최소 기준 충족`,
      detail: `감지된 가장 낮은 Xcode 고정 버전이 Xcode ${minimumXcode}(${sdk} SDK) 이상입니다.${beta ? ` ${IOS_BETA_TOOLS_NOTE.ko}` : ''}`,
    },
  }];
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseExactVersion(value: string): number[] | undefined {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map((part) => Number.parseInt(part, 10)) : undefined;
}

/**
 * True when no version allowed by the npm range reaches `target` (its highest satisfiable version is lower),
 * false when some allowed version reaches it, undefined when the range is not a plain semver range.
 */
function rangeStaysBelow(range: string, target: readonly number[]): boolean | undefined {
  const alternatives = range.split('||').map((part) => part.trim());
  for (const alternative of alternatives) {
    if (alternative === '' || alternative === '*' || /^(?:x|X|latest)$/.test(alternative)) return false;
    let upper: { version: number[]; inclusive: boolean } | undefined;
    const tighten = (candidate: { version: number[]; inclusive: boolean }) => {
      if (!upper || compareVersions(candidate.version, upper.version) < 0) upper = candidate;
    };
    const hyphen = alternative.match(/^(\S+)\s+-\s+(\S+)$/);
    const comparators = hyphen
      ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`]
      : alternative.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/);
    for (const comparator of comparators) {
      const match = comparator.match(/^(\^|~|>=|<=|>|<|=|v)?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+][\w.-]*)?$/);
      if (!match) return undefined;
      const [, operator = '', majorPart, minorPart, patchPart] = match;
      const wild = (part?: string) => part === undefined || /^[xX*]$/.test(part);
      if (wild(majorPart)) {
        if (operator === '<' || operator === '<=') return undefined;
        continue;
      }
      const major = Number.parseInt(majorPart, 10);
      const minor = wild(minorPart) ? undefined : Number.parseInt(minorPart, 10);
      const patch = wild(patchPart) ? undefined : Number.parseInt(patchPart, 10);
      const partialCeiling = () => minor === undefined
        ? { version: [major + 1, 0, 0], inclusive: false }
        : patch === undefined
          ? { version: [major, minor + 1, 0], inclusive: false }
          : { version: [major, minor, patch], inclusive: true };
      if (operator === '>' || operator === '>=') continue;
      if (operator === '<') tighten({ version: [major, minor ?? 0, patch ?? 0], inclusive: false });
      else if (operator === '<=' || operator === '' || operator === '=' || operator === 'v') tighten(partialCeiling());
      else if (operator === '~') tighten(minor === undefined ? partialCeiling() : { version: [major, minor + 1, 0], inclusive: false });
      else if (operator === '^') {
        tighten(major > 0 || minor === undefined
          ? { version: [major + 1, 0, 0], inclusive: false }
          : minor > 0 || patch === undefined
            ? { version: [0, minor + 1, 0], inclusive: false }
            : { version: [0, 0, patch + 1], inclusive: false });
      }
    }
    if (!upper) return false;
    const reaches = upper.inclusive
      ? compareVersions(upper.version, target) >= 0
      : compareVersions(upper.version, target) > 0;
    if (reaches) return false;
  }
  return true;
}

interface FirebaseAdminEvidence {
  file: string;
  version: string;
  source: 'installed' | 'lockfile' | 'declared';
  major?: number;
}

async function firebaseAdminEvidence(files: ProjectFile[], root: string): Promise<FirebaseAdminEvidence[]> {
  const result: FirebaseAdminEvidence[] = [];
  for (const file of files.filter((candidate) => /(?:^|\/)package\.json$/.test(candidate.relative)
    && !candidate.relative.split('/').includes('node_modules'))) {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(file.text) as Record<string, unknown>;
    } catch {
      continue;
    }
    const declared = ['dependencies', 'devDependencies']
      .map((key) => manifest[key])
      .map((group) => (group && typeof group === 'object' ? (group as Record<string, unknown>)['firebase-admin'] : undefined))
      .find((value): value is string => typeof value === 'string');
    if (!declared) continue;
    const packageDir = path.dirname(file.absolute);
    // Ancestors up to the scan root, then on to the repository root (a --path into a workspace monorepo).
    const directories = await lockfileDirectories(packageDir, root);

    // 1. The installed copy (hoisted installs put it in an ancestor's node_modules).
    let resolved: FirebaseAdminEvidence | undefined;
    for (const directory of directories) {
      const text = await readText(path.join(directory, 'node_modules', 'firebase-admin', 'package.json'));
      if (!text) continue;
      try {
        const version = (JSON.parse(text) as { version?: unknown }).version;
        if (typeof version === 'string' && parseExactVersion(version)) {
          resolved = { file: file.relative, version, source: 'installed' };
          break;
        }
      } catch {
        // Keep looking.
      }
    }
    // 2. The nearest lockfile's resolution.
    if (!resolved) {
      for (const directory of directories) {
        const version = (await lockedPackageVersion('firebase-admin', packageDir, directory, declared))?.version;
        if (version && parseExactVersion(version)) {
          resolved = { file: file.relative, version, source: 'lockfile' };
          break;
        }
      }
    }
    if (resolved) {
      if (compareVersions(parseExactVersion(resolved.version)!, FIREBASE_ADMIN_TOPICS_VERSION) < 0) {
        result.push({ ...resolved, major: parseExactVersion(resolved.version)![0] });
      }
      continue;
    }
    // 3. The declared range, flagged only when no version it allows reaches 14.5.0.
    if (rangeStaysBelow(declared, FIREBASE_ADMIN_TOPICS_VERSION) === true) {
      const major = declared.match(/\d+/)?.[0];
      result.push({ file: file.relative, version: declared, source: 'declared', major: major ? Number.parseInt(major, 10) : undefined });
    }
  }
  return result;
}

function listFiles(files: ProjectFile[]): string {
  const names = unique(files.map((file) => file.relative));
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} (+${names.length - 3})` : names.join(', ');
}

async function fcmFindings(
  files: ProjectFile[],
  sources: ProjectFile[],
  root: string,
  now: Date,
): Promise<ReleaseDoctorFinding[]> {
  const findings: ReleaseDoctorFinding[] = [];
  const today = now.toISOString().slice(0, 10);
  const decommissioned = today >= FCM_INSTANCE_ID_DECOMMISSION;
  const scheduled = decommissioned ? 'decommissioned' : 'decommissions';
  const scheduledKo = decommissioned ? '종료했습니다' : '종료합니다';

  const legacySend = sources.filter((file) => FCM_LEGACY_SEND.test(file.text));
  if (legacySend.length > 0) {
    findings.push({
      code: 'FCM_LEGACY_SEND_API',
      severity: 'warning',
      title: 'Code calls the shut-down legacy FCM send endpoint',
      detail: `Found fcm/send in ${listFiles(legacySend)}. Firebase deprecated the legacy HTTP and XMPP send APIs in June 2023 and began shutting them down on 2024-07-22, so these push requests no longer deliver.`,
      action: 'Send through the FCM HTTP v1 API (projects.messages.send) or a Firebase Admin SDK instead.',
      file: legacySend[0].relative,
      sourceUrl: FCM_LEGACY_SEND_SOURCE,
      ko: {
        title: '종료된 레거시 FCM 발송 엔드포인트를 호출하는 코드',
        detail: `${listFiles(legacySend)}에서 fcm/send를 찾았습니다. Firebase는 레거시 HTTP·XMPP 발송 API를 2023년 6월 지원 중단하고 2024-07-22부터 종료했으므로 이 푸시 요청은 전달되지 않습니다.`,
        action: 'FCM HTTP v1 API(projects.messages.send) 또는 Firebase Admin SDK로 발송하세요.',
      },
    });
  }

  const instanceId = sources.filter((file) => FCM_INSTANCE_ID.test(file.text));
  if (instanceId.length > 0) {
    findings.push({
      code: 'FCM_INSTANCE_ID_API',
      severity: decommissioned ? 'warning' : 'info',
      title: decommissioned
        ? 'Code calls the decommissioned Instance ID server API'
        : 'Code calls the deprecated Instance ID server API',
      detail: `Found iid.googleapis.com in ${listFiles(instanceId)}. Firebase ${scheduled} the Instance ID server APIs (token info, legacy topic management, batch import) on ${FCM_INSTANCE_ID_DECOMMISSION}.`,
      action: 'Manage topics with the FCM topic subscription API, and validate tokens with an FCM v1 send using validate_only.',
      file: instanceId[0].relative,
      sourceUrl: FCM_DEPRECATION_SOURCE,
      ko: {
        title: decommissioned
          ? '종료된 Instance ID 서버 API를 호출하는 코드'
          : '지원 중단된 Instance ID 서버 API를 호출하는 코드',
        detail: `${listFiles(instanceId)}에서 iid.googleapis.com을 찾았습니다. Firebase는 Instance ID 서버 API(토큰 정보, 레거시 토픽 관리, 일괄 가져오기)를 ${FCM_INSTANCE_ID_DECOMMISSION}에 ${scheduledKo}.`,
        action: '토픽은 FCM 토픽 구독 API로 관리하고, 토큰 검증은 validate_only를 켠 FCM v1 발송으로 대체하세요.',
      },
    });
  }

  const deviceGroup = sources.filter((file) => FCM_DEVICE_GROUP.test(file.text));
  if (deviceGroup.length > 0) {
    findings.push({
      code: 'FCM_DEVICE_GROUP_API',
      severity: decommissioned ? 'warning' : 'info',
      title: decommissioned
        ? 'Code calls the decommissioned FCM device group management API'
        : 'Code calls the deprecated FCM device group management API',
      detail: `Found fcm/notification in ${listFiles(deviceGroup)}. Firebase ${scheduled} device group management and device group tokens on ${FCM_INSTANCE_ID_DECOMMISSION}.`,
      action: 'Send to individual registration tokens (or topics) with the FCM v1 API, following Firebase\'s guide for migrating off device groups.',
      file: deviceGroup[0].relative,
      sourceUrl: FCM_DEPRECATION_SOURCE,
      ko: {
        title: decommissioned
          ? '종료된 FCM 기기 그룹 관리 API를 호출하는 코드'
          : '지원 중단된 FCM 기기 그룹 관리 API를 호출하는 코드',
        detail: `${listFiles(deviceGroup)}에서 fcm/notification을 찾았습니다. Firebase는 기기 그룹 관리와 기기 그룹 토큰을 ${FCM_INSTANCE_ID_DECOMMISSION}에 ${scheduledKo}.`,
        action: 'Firebase의 기기 그룹 이전 가이드에 따라 FCM v1 API로 개별 등록 토큰(또는 토픽)에 발송하세요.',
      },
    });
  }

  const legacyTopic = sources.filter((file) => FCM_LEGACY_TOPIC_METHOD.test(file.text));
  if (legacyTopic.length > 0) {
    findings.push({
      code: 'FCM_LEGACY_TOPIC_METHODS',
      severity: decommissioned ? 'warning' : 'info',
      title: 'Code uses the deprecated firebase-admin *Legacy topic methods',
      detail: `Found subscribeToTopicLegacy / unsubscribeFromTopicLegacy in ${listFiles(legacyTopic)}. These escape hatches keep using the Instance ID API, which Firebase ${scheduled} on ${FCM_INSTANCE_ID_DECOMMISSION}.`,
      action: 'Call subscribeToTopic / unsubscribeFromTopic instead; since firebase-admin 14.5.0 they use the FCM v1 topic subscription API.',
      file: legacyTopic[0].relative,
      sourceUrl: FIREBASE_ADMIN_TOPICS_SOURCE,
      ko: {
        title: '지원 중단된 firebase-admin *Legacy 토픽 메서드를 사용하는 코드',
        detail: `${listFiles(legacyTopic)}에서 subscribeToTopicLegacy / unsubscribeFromTopicLegacy를 찾았습니다. 이 메서드는 Instance ID API를 계속 사용하며, Firebase는 이 API를 ${FCM_INSTANCE_ID_DECOMMISSION}에 ${scheduledKo}.`,
        action: 'subscribeToTopic / unsubscribeFromTopic을 사용하세요. firebase-admin 14.5.0부터 FCM v1 토픽 구독 API를 사용합니다.',
      },
    });
  }

  const outdated = await firebaseAdminEvidence(files, root);
  if (outdated.length > 0) {
    const first = outdated[0];
    const sourceLabel = { installed: 'installed', lockfile: 'lockfile', declared: 'declared range' }[first.source];
    const sourceLabelKo = { installed: '설치됨', lockfile: 'lockfile', declared: '선언 범위' }[first.source];
    const nodeNote = first.major !== undefined && first.major < 14;
    findings.push({
      code: 'FIREBASE_ADMIN_LEGACY_TOPIC_TRANSPORT',
      severity: decommissioned ? 'warning' : 'info',
      title: 'firebase-admin before 14.5.0 manages topics through the Instance ID API',
      detail: `${first.file} uses firebase-admin ${first.version} (${sourceLabel}). From 14.5.0, subscribeToTopic / unsubscribeFromTopic use the FCM v1 topic subscription API; earlier versions call the Instance ID API, which Firebase ${scheduled} on ${FCM_INSTANCE_ID_DECOMMISSION}. Only topic subscription calls are affected.`,
      action: `Upgrading firebase-admin to 14.5.0 or later is the migration; the method names stay the same. Run your topic subscription tests after upgrading.${nodeNote ? ` firebase-admin 14 requires Node.js ${FIREBASE_ADMIN_14_NODE} or later.` : ''}`,
      file: first.file,
      sourceUrl: FCM_DEPRECATION_SOURCE,
      ko: {
        title: 'firebase-admin 14.5.0 이전 버전은 Instance ID API로 토픽을 관리함',
        detail: `${first.file}의 firebase-admin 버전은 ${first.version}(${sourceLabelKo})입니다. 14.5.0부터 subscribeToTopic / unsubscribeFromTopic은 FCM v1 토픽 구독 API를 쓰고, 이전 버전은 Instance ID API를 호출합니다. Firebase는 이 API를 ${FCM_INSTANCE_ID_DECOMMISSION}에 ${scheduledKo}. 토픽 구독 호출만 영향을 받습니다.`,
        action: `firebase-admin을 14.5.0 이상으로 올리는 것이 마이그레이션입니다. 메서드 이름은 그대로이며, 업그레이드 후 토픽 구독 테스트를 실행하세요.${nodeNote ? ` firebase-admin 14는 Node.js ${FIREBASE_ADMIN_14_NODE} 이상이 필요합니다.` : ''}`,
      },
    });
  }

  return findings;
}

function isWithin(scope: string, target: string): boolean {
  const relative = path.relative(scope, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Scripts the given Gradle files pull in with `apply from: "…"` (one level), so values set in a shared
 * `common.gradle` count for every module that applies it. Paths may use `$rootDir` / `$rootProject.projectDir`.
 */
async function appliedGradleScripts(
  gradleFiles: ProjectFile[],
  root: string,
  limit: string,
  known: ProjectFile[],
): Promise<ProjectFile[]> {
  const result: ProjectFile[] = [];
  const seen = new Set([...known, ...gradleFiles].map((file) => file.absolute));
  for (const file of gradleFiles.filter((candidate) => /\.gradle(?:\.kts)?$/.test(candidate.relative))) {
    const text = stripComments(file.text, { slash: true, hash: false });
    const references = [
      ...[...text.matchAll(/\bapply\s*\(?\s*from\s*[:=]\s*["']([^"']+\.gradle(?:\.kts)?)["']/g)].map((match) => match[1]),
      // `apply(from = rootProject.file("x.gradle.kts"))`
      ...[...text.matchAll(/\bapply\s*\(?\s*from\s*[:=]\s*rootProject\.file\(\s*["']([^"'$]+\.gradle(?:\.kts)?)["']\s*\)/g)]
        .map((match) => `$rootDir/${match[1]}`),
    ];
    for (const reference of references) {
      if (/^[a-z]+:\/\//i.test(reference)) continue;
      const rooted = reference.match(/^\$\{?(?:rootDir|rootProject\.(?:projectDir|rootDir))\}?\/(.+)$/);
      if (!rooted && reference.includes('$')) continue;
      const candidates = rooted
        ? ancestorsUpTo(path.dirname(file.absolute), limit).map((directory) => path.join(directory, rooted[1]))
        : [path.resolve(path.dirname(file.absolute), reference)];
      for (const absolute of candidates) {
        if (!isWithin(limit, absolute)) continue;
        const existing = known.find((candidate) => candidate.absolute === absolute);
        if (existing) {
          if (!result.some((row) => row.absolute === absolute) && !gradleFiles.some((row) => row.absolute === absolute)) {
            result.push({ ...existing, text: stripGradleComments(existing.text) });
          }
          break;
        }
        if (seen.has(absolute)) break;
        const applied = await readText(absolute);
        if (applied === undefined) continue;
        seen.add(absolute);
        result.push({ absolute, relative: path.relative(root, absolute).replace(/\\/g, '/'), text: stripGradleComments(applied), outside: !isWithin(root, absolute) });
        break;
      }
    }
  }
  return result;
}

/** `start` and its ancestors up to `limit`, nearest first. */
function ancestorsUpTo(start: string, limit: string): string[] {
  const result: string[] = [];
  let current = start;
  for (;;) {
    result.push(current);
    if (current === limit || !isWithin(limit, current)) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

/**
 * When `--path` points inside a repository, CI and the root Gradle version catalog usually live at the repository
 * root. Read those few files from there (marked `outside`) so a narrowed scan keeps its Xcode pins and catalog values.
 */
async function repositoryRootFiles(root: string, repo: string): Promise<ProjectFile[]> {
  const result: ProjectFile[] = [];
  const add = async (absolute: string) => {
    const text = await readText(absolute);
    if (text !== undefined) {
      result.push({ absolute, relative: path.relative(root, absolute).replace(/\\/g, '/'), text, outside: true });
    }
  };
  for (const name of [
    '.xcode-version', '.gitlab-ci.yml', 'codemagic.yaml', 'codemagic.yml', 'Jenkinsfile',
    'gradle/libs.versions.toml', 'settings.gradle', 'settings.gradle.kts',
  ]) {
    await add(path.join(repo, name));
  }
  const workflows = path.join(repo, '.github', 'workflows');
  for (const entry of await fs.readdir(workflows).catch(() => [] as string[])) {
    if (/\.ya?ml$/.test(entry)) await add(path.join(workflows, entry));
  }
  const actions = path.join(repo, '.github', 'actions');
  for (const entry of await fs.readdir(actions, { recursive: true }).catch(() => [] as string[])) {
    if (/(?:^|[\\/])action\.ya?ml$/.test(String(entry))) await add(path.join(actions, String(entry)));
  }
  return result;
}

/** Evidence rows with the ones below the submission minimum first (they are what a blocker is about). */
function billingEvidenceRows(billing: BillingComplianceResult) {
  const minimum = billing.policy.minimumSupportedMajor;
  const failing = (row: BillingComplianceResult['evidence'][number]) =>
    minimum !== null && row.version !== undefined && Number.parseInt(row.version, 10) < minimum;
  return [...billing.evidence.filter(failing), ...billing.evidence.filter((row) => !failing(row))];
}

function billingEvidenceText(billing: BillingComplianceResult): string {
  const rows = billingEvidenceRows(billing).map((row) => {
    const what = row.expression
      ? `${row.expression}${row.version && !row.expression.includes(row.version) ? ` = ${row.version}` : ''}`
      : `${row.module}:${row.version ?? '?'}`;
    return `${row.file} (${what})`;
  });
  return rows.length > 3 ? `${rows.slice(0, 3).join('; ')}; +${rows.length - 3}` : rows.join('; ');
}

/** The Release Doctor finding for a Billing result, with the evidence in both languages and a status-specific action. */
function billingFinding(billing: BillingComplianceResult): ReleaseDoctorFinding {
  const versions = billing.detectedVersions.join(', ');
  const evidence = billingEvidenceText(billing);
  const minimum = billing.policy.minimumSupportedMajor;
  const schedule = (major: number | null) => billing.policy.knownSchedule.find((row) => row.major === major);
  const status = billing.status as Exclude<BillingComplianceResult['status'], 'not_used'>;
  const iapTarget = minimum === null ? undefined : reactNativeIapUpgradeTarget(minimum);
  const iapBelow = minimum !== null && billing.evidence.some((row) => row.wrapper?.name === 'react-native-iap'
    && row.version !== undefined && Number.parseInt(row.version, 10) < minimum);
  const belowMajors = minimum === null ? [] : [...new Set(billing.detectedVersions
    .map((version) => Number.parseInt(version, 10))
    .filter((major) => Number.isFinite(major) && major < minimum))].sort((left, right) => left - right);

  const copy = {
    pass: {
      title: 'Google Play Billing version is supported',
      koTitle: 'Google Play Billing 버전 기준 충족',
      koDetail: `감지된 Billing Library ${versions}은 현재 제출 기준을 충족합니다.`,
      action: undefined,
      koAction: undefined,
    },
    warning: {
      title: 'Google Play Billing Library is supported, but its major is next to be deprecated',
      koTitle: 'Google Play Billing Library는 지원되지만 다음 지원 종료 대상',
      koDetail: `감지된 Billing Library ${versions}은 현재 지원되지만 다음 지원 종료 대상입니다.`,
      action: billing.actions.join(' ') || undefined,
      koAction: schedule(minimum) ? `${schedule(minimum)!.submissionDeadline} 전에 업그레이드를 계획하세요.` : undefined,
    },
    blocker: {
      title: 'Google Play Billing Library is below the submission minimum',
      koTitle: 'Google Play Billing Library가 제출 최소 버전 미달',
      koDetail: `감지된 Billing Library ${billing.detectedVersions.filter((version) => Number.parseInt(version, 10) < (minimum ?? 0)).join(', ')}은 현재 제출 최소 major ${minimum}보다 낮습니다.`,
      action: billing.actions.join(' '),
      koAction: [
        '새 앱이나 업데이트를 제출하기 전에 지원되는 Billing Library로 업그레이드하세요.',
        iapBelow && iapTarget
          ? `react-native-iap가 Billing을 간접적으로 포함합니다: ${iapTarget.version} 이상(Billing ${iapTarget.billing})으로 올리세요. major 업그레이드이므로 마이그레이션 가이드를 따르세요.`
          : '',
        ...belowMajors.map((major) => schedule(major)
          ? `Billing Library ${major}: 기본 마감일 ${schedule(major)!.submissionDeadline}, 연장 마감일 ${schedule(major)!.extensionDeadline}(Play Console에서 연장을 받은 경우에만).`
          : `Billing Library ${major}: 마감일이 내장된 공식 표보다 이르므로 유효한 연장이 있다고 가정하지 마세요.`),
      ].filter(Boolean).join(' '),
    },
    unresolved: billing.policy.scheduleCurrent
      ? {
        title: 'Google Play Billing version could not be resolved locally',
        koTitle: 'Google Play Billing 버전을 로컬에서 확정하지 못함',
        koDetail: 'Billing 의존성은 찾았지만 버전을 정적으로 확정하지 못했습니다.',
        action: billing.actions.join(' '),
        koAction: '보고된 Gradle/version catalog 표현식을 확인하거나 선언된 IAP 패키지를 설치한 뒤 다시 검사하세요.',
      }
      : {
        title: 'Google Play Billing policy table needs a refresh',
        koTitle: 'Google Play Billing 정책표 갱신 필요',
        koDetail: `내장된 공식 일정은 Billing Library ${billing.policy.latestKnownMajor}에서 끝나므로 현재 정책을 출처에서 다시 확인해야 합니다.`,
        action: billing.actions.join(' '),
        koAction: '공식 Billing 지원 중단 표를 확인하고, 이 결과를 믿기 전에 Mimi Seed를 업데이트하세요.',
      },
  }[status];

  return {
    code: `BILLING_${status.toUpperCase()}`,
    severity: status === 'blocker' ? 'blocker' : status === 'pass' ? 'info' : 'warning',
    title: copy.title,
    detail: `${billing.summary} Evidence: ${evidence}.`,
    action: copy.action,
    file: billingEvidenceRows(billing)[0]?.file,
    sourceUrl: billing.policy.sourceUrl,
    ko: {
      title: copy.koTitle,
      detail: `${copy.koDetail} 근거: ${evidence}.`,
      action: copy.koAction,
    },
  };
}

export interface ReleaseDoctorScanOptions {
  /** Upper bound on source files read for FCM evidence (tests lower it). */
  maxSourceFiles?: number;
}

export async function scanReleaseDoctor(
  projectPath: string,
  now = new Date(),
  options: ReleaseDoctorScanOptions = {},
): Promise<ReleaseDoctorReport> {
  const maxSourceFiles = options.maxSourceFiles ?? MAX_SOURCE_FILES;
  const root = path.resolve(projectPath);
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    throw new Error(`Project path does not exist or is not readable: ${root}`);
  }
  if (!stat.isDirectory()) throw new Error(`Project path is not a directory: ${root}`);

  const { files, fcmSources, sourceScanTruncated } = await walk(root, maxSourceFiles);
  const reactNativeCatalog = path.join(root, 'node_modules', 'react-native', 'gradle', 'libs.versions.toml');
  try {
    files.push({
      absolute: reactNativeCatalog,
      relative: REACT_NATIVE_CATALOG,
      text: await fs.readFile(reactNativeCatalog, 'utf8'),
    });
  } catch {
    // The package may not be installed; the report will keep the indirect expression unresolved.
  }
  const repo = await repositoryRoot(root);
  if (repo && repo !== root && isWithin(repo, root)) files.push(...await repositoryRootFiles(root, repo));
  const detected = await detectProject(files, root);
  const platforms: Array<'android' | 'ios'> = [];
  if (detected.android) platforms.push('android');
  if (detected.ios) platforms.push('ios');

  const findings: ReleaseDoctorFinding[] = [];
  let targetSdkModules: TargetSdkModuleVerdict[] | undefined;
  let targetSdkTokens: TargetSdkToken[] | undefined;
  if (platforms.length === 0) {
    findings.push({
      code: 'NO_MOBILE_PROJECT',
      severity: 'blocker',
      title: 'No Android or iOS app project was detected',
      detail: 'Release Doctor could not find an Expo config, Android Gradle app, Xcode project, or iOS Info.plist.',
      action: 'Run this command from the mobile app repository root.',
      ko: {
        title: 'Android 또는 iOS 앱 프로젝트를 찾지 못함',
        detail: 'Expo 설정, Android Gradle 앱, Xcode 프로젝트, iOS Info.plist를 찾지 못했습니다.',
        action: '모바일 앱 저장소의 루트에서 다시 실행하세요.',
      },
    });
  }

  if (detected.android) {
    if (detected.androidPackageNames.length === 0) {
      const expressions = unique(detected.androidPackageExpressions.map((row) => `${row.expression} (${row.file})`));
      const listed = expressions.length > 3 ? `${expressions.slice(0, 3).join(', ')}, +${expressions.length - 3}` : expressions.join(', ');
      findings.push({
        code: 'ANDROID_PACKAGE_UNRESOLVED',
        severity: 'warning',
        title: 'Android application ID could not be resolved',
        detail: listed
          ? `The app module sets applicationId through an expression Release Doctor cannot evaluate statically: ${listed}. The Target API and Billing checks still ran.`
          : 'The Android project was detected, but no literal applicationId or Expo android.package was found.',
        action: 'Confirm the release variant applicationId before connecting Google Play.',
        file: detected.androidPackageExpressions[0]?.file,
        ko: {
          title: 'Android application ID를 확정하지 못함',
          detail: listed
            ? `앱 모듈이 정적으로 계산할 수 없는 표현식으로 applicationId를 지정합니다: ${listed}. Target API와 Billing 검사는 그대로 실행했습니다.`
            : 'Android 프로젝트는 감지했지만 applicationId 또는 Expo android.package의 문자열 값을 찾지 못했습니다.',
          action: 'Google Play 연결 전에 릴리스 variant의 applicationId를 확인하세요.',
        },
      });
    } else {
      findings.push({
        code: 'ANDROID_PACKAGE_FOUND',
        severity: 'info',
        title: 'Android application ID detected',
        detail: detected.androidPackageNames.join(', '),
        ko: {
          title: 'Android application ID 감지 완료',
          detail: detected.androidPackageNames.join(', '),
        },
      });
      if (detected.androidPackageNames.length > 1) {
        findings.push({
          code: 'MULTIPLE_ANDROID_APPLICATION_IDS',
          severity: 'warning',
          title: 'Multiple Android application IDs share this scan scope',
          detail: 'Repository-wide Target API and Billing evidence may belong to different apps or variants.',
          action: 'Run Release Doctor with --path set to one mobile app root before treating blockers as app-specific.',
          ko: {
            title: '검사 범위에 Android application ID가 여러 개 있음',
            detail: '저장소 전체에서 찾은 Target API와 Billing 근거가 서로 다른 앱 또는 variant에 속할 수 있습니다.',
            action: '블로커를 특정 앱의 결과로 판단하기 전에 --path로 모바일 앱 루트를 하나만 지정해 다시 검사하세요.',
          },
        });
      }
    }
    // Wear OS / TV / Automotive / XR minimums differ from phones, so those modules are left out of the generic rule
    // — per module: a phone app next to its Wear OS module is still checked.
    const specialized = specializedAndroidModules(detected.manifests, detected.androidAppModules);
    const generalModules = detected.androidAppModules.filter((module) => !specialized.has(module));
    const specializedList = [...specialized].map((module) => (module === '.' ? '(root)' : module)).sort().join(', ');
    if (specialized.size > 0 && generalModules.length === 0) {
      findings.push({
        code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW',
        severity: 'warning',
        title: 'Specialized Android app type needs a category-specific Target API check',
        detail: `Wear OS, Android TV, Android Automotive OS, or Android XR evidence was found (${specializedList}). Their submission minimums differ from general mobile apps, so Release Doctor did not apply the generic API ${targetPolicy(now).minimum ?? ''} rule.`,
        action: 'Confirm the app category and its current Target API requirement in the official table.',
        sourceUrl: TARGET_SDK_SOURCE,
        ko: {
          title: '특수 Android 앱 유형은 카테고리별 Target API 확인 필요',
          detail: `Wear OS, Android TV, Android Automotive OS 또는 Android XR 근거를 찾았습니다(${specializedList}). 일반 모바일 앱과 제출 최소값이 달라 API ${targetPolicy(now).minimum ?? ''} 기준을 적용하지 않았습니다.`,
          action: '앱 카테고리와 해당 Target API 요구사항을 공식 표에서 확인하세요.',
        },
      });
    } else {
      const scoped = detected.gradleFiles.filter((file) =>
        file.relative.endsWith('libs.versions.toml') || !specialized.has(moduleDir(file.relative)));
      const limit = repo && isWithin(repo, root) ? repo : root;
      const applied = await appliedGradleScripts(scoped, root, limit, files);
      // Each judged app module with the scripts it applies; its targetSdk is evaluated on its own.
      const settingsDirs = files
        .filter((file) => /(?:^|\/)settings\.gradle(?:\.kts)?$/.test(file.relative))
        .map((file) => path.dirname(file.absolute));
      const buildRootOf = (file: ProjectFile) => settingsDirs
        .filter((dir) => isWithin(dir, file.absolute))
        .sort((left, right) => right.length - left.length)[0];
      const projectScript = (dir: string) => files.find((candidate) =>
        /(?:^|\/)build\.gradle(?:\.kts)?$/.test(candidate.relative) && path.dirname(candidate.absolute) === dir);
      const judged = await Promise.all(detected.appGradleFiles
        .filter((file) => !specialized.has(moduleDir(file.relative)))
        .map(async (file) => {
          // The root project of the module's build (nearest settings directory) and the scripts it applies.
          const buildRoot = buildRootOf(file);
          const rootScript = buildRoot === undefined ? undefined : projectScript(buildRoot);
          const rootText = rootScript && rootScript.absolute !== file.absolute
            ? { ...rootScript, text: stripGradleComments(rootScript.text) }
            : undefined;
          // Parent projects between the build root and the module (their extra properties are visible to it).
          const hierarchy: ProjectFile[] = [];
          for (let dir = path.dirname(path.dirname(file.absolute)); buildRoot !== undefined && dir !== buildRoot && isWithin(buildRoot, dir); dir = path.dirname(dir)) {
            const parent = projectScript(dir);
            if (parent) hierarchy.push({ ...parent, text: stripGradleComments(parent.text) });
          }
          return {
            file,
            scripts: [file, ...await appliedGradleScripts([file], root, limit, files)],
            inherited: rootText ? [rootText, ...await appliedGradleScripts([rootText], root, limit, files)] : [],
            hierarchy,
          };
        }));
      // The net's scope: every Gradle script and convention-plugin source found, each out-of-scope one with why.
      const exclusion = (file: ProjectFile, text: string): string | undefined => {
        if (file.outside) return 'outside';
        if (file.sample && detected.shippedOnly) return 'sample';
        if (specialized.has(moduleDir(file.relative))) return 'specialized';
        // Unity's Gradle templates take targetSdk from ProjectSettings.asset (`**TARGETSDKVERSION**`).
        if (/Template\.gradle$/.test(file.relative) && /\*\*[A-Z]+\*\*/.test(text)) return 'template';
        if (appliesOnlyAndroidLibraryPlugin(text)) return 'library';
        return undefined;
      };
      const netFiles = files
        .filter((file) => /\.gradle(?:\.kts)?$/.test(file.relative) || (file.relative.endsWith('.kt') && CONVENTION_SOURCE.test(file.relative)))
        .map((file) => ({ ...file, text: stripGradleComments(file.text) }));
      // A script only out-of-scope projects `apply from:` (a library-only `gradle/android-library.gradle`) is out too.
      const referrers = new Map<string, Array<string | undefined>>();
      for (const file of netFiles.filter((candidate) => /(?:^|\/)build\.gradle(?:\.kts)?$/.test(candidate.relative))) {
        const reason = exclusion(file, file.text);
        for (const applied of await appliedGradleScripts([file], root, limit, files)) {
          referrers.set(applied.absolute, [...referrers.get(applied.absolute) ?? [], reason]);
        }
      }
      const rootScripts = new Map<string, Promise<ProjectFile[]>>();
      const rootScriptsOf = (file: ProjectFile): Promise<ProjectFile[]> => {
        const buildRoot = buildRootOf(file);
        if (buildRoot === undefined) return Promise.resolve([]);
        if (!rootScripts.has(buildRoot)) {
          const script = projectScript(buildRoot);
          const text = script ? { ...script, text: stripGradleComments(script.text) } : undefined;
          rootScripts.set(buildRoot, text
            ? appliedGradleScripts([text], root, limit, files).then((applied) => [text, ...applied])
            : Promise.resolve([]));
        }
        return rootScripts.get(buildRoot)!;
      };
      const net = await Promise.all(netFiles.map(async (file) => {
        const viaReferrers = referrers.get(file.absolute);
        const excluded = exclusion(file, file.text)
          ?? (viaReferrers && viaReferrers.every(Boolean) ? viaReferrers[0] : undefined);
        // The build root's scripts give the net the extra properties an unattributed script sees.
        return { file, excluded, inherited: (await rootScriptsOf(file)).filter((script) => script.absolute !== file.absolute) };
      }));
      const targetSdk = targetSdkFindings(
        [...scoped, ...applied], now, detected.targetSdkEvidence, detected.resolveCatalogs, detected.properties, judged, net,
      );
      findings.push(...targetSdk.findings);
      targetSdkModules = targetSdk.modules;
      targetSdkTokens = targetSdk.tokens;
      if (specialized.size > 0) {
        findings.push({
          code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW',
          severity: 'info',
          title: 'A Wear OS, TV, Automotive, or XR module needs its own Target API check',
          detail: `${specializedList} declares a specialized form factor whose submission minimum differs from phones, so it was left out of the check above; the other app modules (${generalModules.join(', ')}) were checked against the general rule.`,
          action: 'Confirm that module\'s Target API requirement in the official table.',
          sourceUrl: TARGET_SDK_SOURCE,
          ko: {
            title: 'Wear OS·TV·Automotive·XR 모듈은 별도 Target API 확인 필요',
            detail: `${specializedList} 모듈은 휴대전화와 제출 최소값이 다른 특수 기기용이라 위 검사에서 제외했습니다. 나머지 앱 모듈(${generalModules.join(', ')})은 일반 기준으로 검사했습니다.`,
            action: '해당 모듈의 Target API 요구사항을 공식 표에서 확인하세요.',
          },
        });
      }
    }

    // A real app kept in a demo/ or sample/ folder would otherwise be dropped silently: say which excluded app
    // modules would fail the general rule.
    const minimum = targetPolicy(now).minimum;
    const failingSamples = detected.sampleAppGradleFiles.flatMap((file) => {
      const verdict = targetSdkFindings([file], now, [], detected.resolveCatalogs, detected.properties, [{ file, scripts: [file] }]).findings[0];
      return verdict?.code === 'TARGET_SDK_BELOW_MINIMUM' ? [`${moduleDir(file.relative)} (${verdict.title.match(/targetSdk (\d+)/)?.[1]})`] : [];
    });
    if (failingSamples.length > 0 && minimum !== null) {
      const listed = failingSamples.length > 3 ? `${failingSamples.slice(0, 3).join(', ')}, +${failingSamples.length - 3}` : failingSamples.join(', ');
      findings.push({
        code: 'TARGET_SDK_SAMPLE_APPS_NOT_CHECKED',
        severity: 'info',
        title: 'App modules in example, sample, demo, or test folders were not judged',
        detail: `These app modules sit in example/sample/demo/test folders, so they were treated as sample apps and left out of the Target API verdict, but their targetSdk is below ${minimum}: ${listed}.`,
        action: `If one of them is published to Google Play, raise its targetSdk to ${minimum} or newer, or scan it on its own with --path.`,
        file: detected.sampleAppGradleFiles[0]?.relative,
        sourceUrl: TARGET_SDK_SOURCE,
        ko: {
          title: 'example·sample·demo·test 폴더의 앱 모듈은 판정하지 않음',
          detail: `다음 앱 모듈은 example/sample/demo/test 폴더에 있어 샘플 앱으로 보고 Target API 판정에서 제외했지만 targetSdk가 ${minimum} 미만입니다: ${listed}.`,
          action: `이 중 Google Play에 배포하는 앱이 있다면 targetSdk를 ${minimum} 이상으로 올리거나 --path로 그 앱만 따로 검사하세요.`,
        },
      });
    }

    const billing = await checkBillingCompliance(root, now);
    if (billing.status !== 'not_used') findings.push(billingFinding(billing));
  }

  if (detected.ios) {
    if (detected.iosBundleIds.length === 0) {
      const expressions = unique(detected.iosBundleIdExpressions.map((row) => `${row.expression} (${row.file})`));
      const listed = expressions.length > 3 ? `${expressions.slice(0, 3).join(', ')}, +${expressions.length - 3}` : expressions.join(', ');
      findings.push({
        code: 'IOS_BUNDLE_ID_UNRESOLVED',
        severity: 'warning',
        title: 'iOS bundle identifier could not be resolved',
        detail: listed
          ? `PRODUCT_BUNDLE_IDENTIFIER is set through build-setting variables that no .xcconfig or XcodeGen file in scope resolves: ${listed}.`
          : 'The iOS project was detected, but no literal bundle identifier was found in Expo config, Info.plist, or project.pbxproj.',
        action: 'Confirm PRODUCT_BUNDLE_IDENTIFIER for the release configuration before connecting App Store Connect.',
        file: detected.iosBundleIdExpressions[0]?.file,
        ko: {
          title: 'iOS bundle identifier를 확정하지 못함',
          detail: listed
            ? `PRODUCT_BUNDLE_IDENTIFIER가 검사 범위의 .xcconfig나 XcodeGen 파일로 해석되지 않는 빌드 설정 변수로 지정되어 있습니다: ${listed}.`
            : 'iOS 프로젝트는 감지했지만 Expo 설정, Info.plist, project.pbxproj에서 문자열 bundle identifier를 찾지 못했습니다.',
          action: 'App Store Connect 연결 전에 릴리스 구성의 PRODUCT_BUNDLE_IDENTIFIER를 확인하세요.',
        },
      });
    } else {
      findings.push({
        code: 'IOS_BUNDLE_ID_FOUND',
        severity: 'info',
        title: 'iOS bundle identifier detected',
        detail: detected.iosBundleIds.join(', '),
        ko: {
          title: 'iOS bundle identifier 감지 완료',
          detail: detected.iosBundleIds.join(', '),
        },
      });
      // One app plus its `<app>.<suffix>` extensions, widgets, and watch app is a single release, not several.
      if (detected.iosBundleIds.length > 1 && !isOneAppWithExtensions(detected.iosBundleIds)) {
        findings.push({
          code: 'MULTIPLE_IOS_BUNDLE_IDS',
          severity: 'warning',
          title: 'Multiple iOS bundle identifiers share this scan scope',
          detail: 'The identifiers may represent multiple apps, extensions, or release targets in the same repository.',
          action: 'Confirm which identifier belongs to the release target; use --path to narrow a monorepo scan.',
          ko: {
            title: '검사 범위에 iOS bundle identifier가 여러 개 있음',
            detail: '같은 저장소의 여러 앱, extension 또는 출시 타깃 식별자가 함께 감지됐을 수 있습니다.',
            action: '출시 타깃의 식별자를 확인하고, 모노레포라면 --path로 검사 범위를 좁히세요.',
          },
        });
      }
    }
    // Pins in demo/ count only when the iOS app itself lives there.
    findings.push(...iosXcodeFindings(detected.hasIosAppOutsideDemo ? files.filter((file) => !file.demo) : files, now));
  }

  findings.push(...await fcmFindings(files, detected.hasAppOutsideDemo ? fcmSources.filter((file) => !file.demo) : fcmSources, root, now));

  const counts = findings.reduce<Record<ReleaseDoctorSeverity, number>>(
    (result, finding) => ({ ...result, [finding.severity]: result[finding.severity] + 1 }),
    { blocker: 0, warning: 0, info: 0 },
  );

  return {
    projectPath: root,
    checkedAt: now.toISOString(),
    platforms,
    identifiers: {
      androidPackageNames: detected.androidPackageNames,
      iosBundleIds: detected.iosBundleIds,
    },
    counts,
    findings,
    ...(targetSdkModules ? { targetSdkModules } : {}),
    ...(targetSdkTokens ? { targetSdkTokens } : {}),
    coverage: {
      checked: [
        'mobile project and app identifier detection',
        ...(detected.android ? ['Android targetSdk policy', 'Google Play Billing dependency policy'] : []),
        ...(detected.ios ? ['App Store Connect Xcode / SDK minimum (pinned build tooling)'] : []),
        sourceScanTruncated
          ? `Firebase Cloud Messaging legacy API usage (first ${maxSourceFiles} source files)`
          : 'Firebase Cloud Messaging legacy API usage',
      ],
      unresolved: unique(findings.filter((finding) => UNRESOLVED_CODES.has(finding.code)).map((finding) => finding.code)),
      requiresStoreConnection: [
        'store listing metadata and screenshots',
        'uploaded build availability and processing state',
        'App Store age-rating answers and Google Play declarations',
        'review submission and rollout status',
      ],
    },
  };
}
