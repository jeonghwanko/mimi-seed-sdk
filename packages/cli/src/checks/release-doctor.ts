import fs from 'node:fs/promises';
import path from 'node:path';
import { checkBillingCompliance } from './billing.js';

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
]);
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
  coverage: {
    checked: string[];
    requiresStoreConnection: string[];
  };
}

interface ProjectFile {
  absolute: string;
  relative: string;
  text: string;
}

async function walk(root: string, maxSourceFiles = MAX_SOURCE_FILES, maxDepth = 7): Promise<{
  files: ProjectFile[];
  fcmSources: ProjectFile[];
  sourceScanTruncated: boolean;
}> {
  const files: ProjectFile[] = [];
  const sourceCandidates: Array<{ absolute: string; relative: string; depth: number }> = [];
  // `excluded`: inside a test/fixture/vendored tree or a nested repository (a directory with its own `.git`).
  // Manifest files there are still read exactly as before; Xcode pins and FCM source evidence are not.
  async function visit(dir: string, depth: number, excluded: boolean): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const nestedRepository = depth > 0 && entries.some((entry) => entry.name === '.git');
    const excludedHere = excluded || nestedRepository;
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await visit(absolute, depth + 1, excludedHere || EXCLUDED_EVIDENCE_DIRS.has(entry.name) || entry.name.startsWith('.next'));
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      if (isRelevantFile(entry.name, relative)) {
        if (excludedHere && isXcodePinFile(entry.name, relative)) continue;
        try {
          files.push({ absolute, relative, text: await fs.readFile(absolute, 'utf8') });
        } catch {
          // Unreadable files are ignored; other evidence can still produce a useful partial report.
        }
        continue;
      }
      if (excludedHere || !SOURCE_EXTENSIONS.has(path.extname(entry.name)) || TEST_SOURCE_FILE.test(entry.name)) continue;
      sourceCandidates.push({ absolute, relative, depth });
    }
  }
  await visit(root, 0, false);
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
async function readFcmSources(candidates: Array<{ absolute: string; relative: string }>): Promise<ProjectFile[]> {
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
        if (FCM_HINT.test(text)) matches.push({ absolute: candidate.absolute, relative: candidate.relative, text });
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
    || /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(relative);
}

function isRelevantFile(name: string, relative: string): boolean {
  return isXcodePinFile(name, relative)
    || name === 'app.json'
    || name === 'app.config.json'
    || /^app\.config\.(?:js|cjs|mjs|ts)$/.test(name)
    || name === 'build.gradle'
    || name === 'build.gradle.kts'
    || name === 'libs.versions.toml'
    || name === 'gradle.properties'
    || name === 'AndroidManifest.xml'
    || name === 'Info.plist'
    || name === 'project.pbxproj'
    || name === 'ProjectSettings.asset'
    || name === 'package.json';
}

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

async function parseExpo(files: ProjectFile[], root: string) {
  const androidPackageNames: string[] = [];
  const iosBundleIds: string[] = [];
  const platforms = new Set<string>();
  let detected = false;
  for (const file of files.filter((candidate) => /(?:^|\/)app(?:\.config)?\.(?:json|js|cjs|mjs|ts)$/.test(candidate.relative))) {
    try {
      const json = JSON.parse(file.text) as Record<string, unknown>;
      const hasExpoRoot = Boolean(json.expo && typeof json.expo === 'object');
      const expo = (hasExpoRoot ? json.expo : json) as {
        android?: { package?: unknown };
        ios?: { bundleIdentifier?: unknown };
        platforms?: unknown;
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
  return { androidPackageNames, iosBundleIds, platforms, detected };
}

async function detectProject(files: ProjectFile[], root: string) {
  const expo = await parseExpo(files, root);
  const gradleFiles = files.filter((file) => /build\.gradle(?:\.kts)?$/.test(file.relative));
  const pbxFiles = files.filter((file) => file.relative.endsWith('project.pbxproj'));
  const plistFiles = files.filter((file) => file.relative.endsWith('Info.plist'));
  const androidAppGradleFiles = gradleFiles.filter((file) =>
    /\bcom\.android\.application\b|\blibs\.plugins\.android\.application\b|\bapplicationId\b/.test(file.text));
  const androidAppManifestFiles = files.filter((file) =>
    /(?:^|\/)android\/app\/src\/main\/AndroidManifest\.xml$/.test(file.relative));
  const versionCatalogFiles = files.filter((file) => file.relative.endsWith('libs.versions.toml'));
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

  const androidPackageNames = [...expo.androidPackageNames, ...unityAndroidPackageNames];
  for (const file of androidAppGradleFiles) {
    for (const match of file.text.matchAll(/\bapplicationId\s*(?:=\s*)?["']([^"']+)["']/g)) {
      androidPackageNames.push(match[1]);
    }
  }

  const iosBundleIds = [...expo.iosBundleIds, ...unityIosBundleIds];
  for (const file of iosPbxFiles) {
    for (const match of file.text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)) {
      const value = match[1].trim().replace(/^["']|["']$/g, '');
      if (value && !value.includes('$') && !/(?:^|\.)(?:Tests?|UITests?|RunnerTests)$/i.test(value)) {
        iosBundleIds.push(value);
      }
    }
  }
  for (const file of iosPlistFiles) {
    const match = file.text.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
    if (match?.[1] && !match[1].includes('$')) iosBundleIds.push(match[1]);
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
  const androidGradleFiles = gradleFiles.filter((file) =>
    androidAppGradleFiles.includes(file) || /(?:^|\/)android\//.test(file.relative));

  return {
    android,
    ios,
    androidPackageNames: unique(androidPackageNames),
    iosBundleIds: unique(iosBundleIds),
    gradleFiles: [...androidGradleFiles, ...versionCatalogFiles],
    targetSdkEvidence: unityTargetSdkEvidence,
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

function targetSdkFindings(
  gradleFiles: ProjectFile[],
  now: Date,
  supplementalEvidence: Array<{ file: string; value: number }> = [],
): ReleaseDoctorFinding[] {
  const evidence: Array<{ file: string; value: number }> = [...supplementalEvidence];
  let hasUnresolvedExpression = false;
  const catalogs = new Map<string, { value: number; file: string }>();
  let reactNativeTargetSdk: { value: number; file: string } | undefined;
  for (const file of gradleFiles.filter((candidate) => candidate.relative.endsWith('libs.versions.toml'))) {
    let section = '';
    for (const rawLine of file.text.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+#.*$/, '').trim();
      const sectionMatch = line.match(/^\[([^\]]+)]$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        continue;
      }
      if (section !== 'versions') continue;
      const version = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*["'](\d+)["']/);
      if (version) {
        const parsed = { value: Number.parseInt(version[2], 10), file: file.relative };
        if (file.relative === 'node_modules/react-native/gradle/libs.versions.toml' && version[1] === 'targetSdk') {
          reactNativeTargetSdk = parsed;
        } else {
          catalogs.set(version[1], parsed);
        }
      }
    }
  }
  for (const file of gradleFiles.filter((candidate) => /build\.gradle(?:\.kts)?$/.test(candidate.relative))) {
    let resolvedIndirectly = false;
    for (const match of file.text.matchAll(/\btargetSdk(?:Version)?\s*(?:=\s*)?(\d+)/g)) {
      evidence.push({ file: file.relative, value: Number.parseInt(match[1], 10) });
    }
    for (const match of file.text.matchAll(/\btargetSdk(?:Version)?\s*(?:=\s*)?libs\.versions\.([A-Za-z0-9_.-]+?)(?=\.get\(\)|\s|$)/g)) {
      const resolved = catalogs.get(match[1]) ?? catalogs.get(match[1].replace(/\./g, '-'));
      if (resolved) {
        evidence.push({ file: resolved.file, value: resolved.value });
        resolvedIndirectly = true;
      }
    }
    if (/\btargetSdkVersion\s+rootProject\.ext\.targetSdkVersion\b/.test(file.text) && reactNativeTargetSdk) {
      evidence.push({ file: reactNativeTargetSdk.file, value: reactNativeTargetSdk.value });
      resolvedIndirectly = true;
    }
    if (/\btargetSdk(?:Version)?\b/.test(file.text) && !/\btargetSdk(?:Version)?\s*(?:=\s*)?\d+/.test(file.text)) {
      const catalogExpression = /\btargetSdk(?:Version)?\s*(?:=\s*)?libs\.versions\.([A-Za-z0-9_.-]+?)(?=\.get\(\)|\s|$)/.exec(file.text);
      const resolved = catalogExpression
        ? catalogs.get(catalogExpression[1]) ?? catalogs.get(catalogExpression[1].replace(/\./g, '-'))
        : undefined;
      if (!resolved && !resolvedIndirectly) hasUnresolvedExpression = true;
    }
  }

  const policy = targetPolicy(now);
  if (!policy.scheduleCurrent || policy.minimum === null) {
    return [{
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
    }];
  }

  if (evidence.length === 0) {
    return [{
      code: 'TARGET_SDK_UNRESOLVED',
      severity: 'warning',
      title: 'Android targetSdk could not be resolved locally',
      detail: hasUnresolvedExpression
        ? 'A targetSdk expression exists, but its numeric value is defined indirectly.'
        : 'No literal targetSdk value was found in the scanned Gradle files.',
      action: `Resolve the release variant and confirm targetSdk ${policy.minimum} or newer before submission.`,
      sourceUrl: TARGET_SDK_SOURCE,
      ko: {
        title: 'Android targetSdk 값을 로컬에서 확정하지 못함',
        detail: hasUnresolvedExpression
          ? 'targetSdk 표현식은 있지만 숫자 값이 다른 파일이나 변수에 정의되어 있습니다.'
          : '검사한 Gradle 파일에서 숫자로 된 targetSdk 값을 찾지 못했습니다.',
        action: `릴리스 variant의 값을 확인해 targetSdk ${policy.minimum} 이상인지 검증하세요.`,
      },
    }];
  }

  const below = evidence.filter((row) => row.value < policy.minimum!);
  if (below.length > 0) {
    const first = below.sort((left, right) => left.value - right.value)[0];
    return [{
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
    }];
  }

  const lowest = evidence.sort((left, right) => left.value - right.value)[0];
  return [{
    code: 'TARGET_SDK_OK',
    severity: 'info',
    title: `Android targetSdk ${lowest.value} meets the current minimum`,
    detail: `The lowest literal targetSdk found is at least ${policy.minimum}.`,
    file: lowest.file,
    sourceUrl: TARGET_SDK_SOURCE,
    ko: {
      title: `Android targetSdk ${lowest.value}은 현재 제출 기준 충족`,
      detail: `감지된 가장 낮은 targetSdk가 현재 최소값 ${policy.minimum} 이상입니다.`,
    },
  }];
}

interface XcodeEvidence {
  file: string;
  /** What was found, as written in the file (for the report). */
  raw: string;
  /** Xcode major version, when the evidence names one. */
  major?: number;
  beta: boolean;
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
  for (const file of files) {
    const name = path.posix.basename(file.relative);
    if (!isXcodePinFile(name, file.relative)) continue;
    evidence.push(...(name === 'eas.json' ? easXcodeEvidence(file) : ciXcodeEvidence(file)));
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
  const evidence = collectXcodeEvidence(files);
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

function ancestorsWithin(start: string, root: string): string[] {
  const result: string[] = [];
  let current = start;
  for (;;) {
    result.push(current);
    const relative = path.relative(root, current);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The firebase-admin version a lockfile resolved for the package in `packageDir`. */
async function lockedFirebaseAdmin(packageDir: string, lockDir: string, declared: string): Promise<string | undefined> {
  const fromLock = path.relative(lockDir, packageDir).replace(/\\/g, '/');
  const npmLock = await readText(path.join(lockDir, 'package-lock.json'));
  if (npmLock) {
    try {
      const lock = JSON.parse(npmLock) as {
        packages?: Record<string, { version?: unknown }>;
        dependencies?: Record<string, { version?: unknown }>;
      };
      const keys = [`${fromLock ? `${fromLock}/` : ''}node_modules/firebase-admin`, 'node_modules/firebase-admin'];
      for (const key of keys) {
        const version = lock.packages?.[key]?.version;
        if (typeof version === 'string') return version;
      }
      const legacy = lock.dependencies?.['firebase-admin']?.version;
      if (typeof legacy === 'string') return legacy;
    } catch {
      // Malformed lockfile: fall through to the next source.
    }
  }
  const pnpmLock = await readText(path.join(lockDir, 'pnpm-lock.yaml'));
  if (pnpmLock) {
    const lines = pnpmLock.split(/\r?\n/);
    const importers = lines.findIndex((line) => /^importers:\s*$/.test(line));
    const importer = importers >= 0
      ? lines.findIndex((line, index) => index > importers && line === `  ${fromLock || '.'}:`)
      : -1;
    for (let index = importer + 1; importer >= 0 && index < lines.length && /^(?:\s{3,}|\s*$)/.test(lines[index]); index++) {
      if (!/^\s+['"]?firebase-admin['"]?:\s*$/.test(lines[index])) continue;
      for (const next of lines.slice(index + 1, index + 4)) {
        const version = next.match(/^\s+version:\s*['"]?(\d+\.\d+\.\d+)/)?.[1];
        if (version) return version;
      }
    }
  }
  const yarnLock = await readText(path.join(lockDir, 'yarn.lock'));
  if (yarnLock) {
    const header = new RegExp(`(?:^|[\\s",])firebase-admin@(?:npm:)?${escapeRegExp(declared)}(?=["',:]|$)`);
    const blocks = yarnLock.split(/\r?\n(?=\S)/);
    for (const block of blocks) {
      const [first] = block.split(/\r?\n/, 1);
      if (!header.test(first)) continue;
      const version = block.match(/^\s+version:?\s+"?(\d+\.\d+\.\d+)/m)?.[1];
      if (version) return version;
    }
  }
  return undefined;
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
    const directories = ancestorsWithin(packageDir, root);

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
        const version = await lockedFirebaseAdmin(packageDir, directory, declared);
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

function hasSpecializedAndroidProfile(files: ProjectFile[]): boolean {
  return files
    .filter((file) => file.relative.endsWith('AndroidManifest.xml'))
    .some((file) => {
      const manifest = file.text.replace(/<!--[\s\S]*?-->/g, '');
      return /android\.hardware\.type\.(?:watch|automotive)|android\.(?:software|hardware)\.xr|LEANBACK_LAUNCHER/i.test(manifest)
        || /android\.software\.leanback[^>]*android:required\s*=\s*["']true["']/i.test(manifest);
    });
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
      relative: 'node_modules/react-native/gradle/libs.versions.toml',
      text: await fs.readFile(reactNativeCatalog, 'utf8'),
    });
  } catch {
    // The package may not be installed; the report will keep the indirect expression unresolved.
  }
  const detected = await detectProject(files, root);
  const platforms: Array<'android' | 'ios'> = [];
  if (detected.android) platforms.push('android');
  if (detected.ios) platforms.push('ios');

  const findings: ReleaseDoctorFinding[] = [];
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
      findings.push({
        code: 'ANDROID_PACKAGE_UNRESOLVED',
        severity: 'warning',
        title: 'Android application ID could not be resolved',
        detail: 'The Android project was detected, but no literal applicationId or Expo android.package was found.',
        action: 'Confirm the release variant applicationId before connecting Google Play.',
        ko: {
          title: 'Android application ID를 확정하지 못함',
          detail: 'Android 프로젝트는 감지했지만 applicationId 또는 Expo android.package의 문자열 값을 찾지 못했습니다.',
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
    if (hasSpecializedAndroidProfile(files)) {
      findings.push({
        code: 'TARGET_SDK_SPECIALIZED_APP_REVIEW',
        severity: 'warning',
        title: 'Specialized Android app type needs a category-specific Target API check',
        detail: 'Wear OS, Android TV, Android Automotive OS, or Android XR evidence was found. Their submission minimums differ from general mobile apps, so Release Doctor did not apply the generic API 36 rule.',
        action: 'Confirm the app category and its current Target API requirement in the official table.',
        sourceUrl: TARGET_SDK_SOURCE,
        ko: {
          title: '특수 Android 앱 유형은 카테고리별 Target API 확인 필요',
          detail: 'Wear OS, Android TV, Android Automotive OS 또는 Android XR 근거를 찾았습니다. 일반 모바일 앱과 제출 최소값이 달라 API 36 기준을 일괄 적용하지 않았습니다.',
          action: '앱 카테고리와 해당 Target API 요구사항을 공식 표에서 확인하세요.',
        },
      });
    } else {
      findings.push(...targetSdkFindings(detected.gradleFiles, now, detected.targetSdkEvidence));
    }

    const billing = await checkBillingCompliance(root, now);
    if (billing.status !== 'not_used') {
      const billingKoDetail = billing.status === 'pass'
        ? `감지된 Billing Library ${billing.detectedVersions.join(', ')}은 현재 제출 기준을 충족합니다.`
        : billing.status === 'blocker'
          ? `감지된 Billing Library ${billing.detectedVersions.join(', ')}은 현재 제출 최소 버전보다 낮습니다.`
          : billing.status === 'warning'
            ? `감지된 Billing Library ${billing.detectedVersions.join(', ')}은 현재 지원되지만 다음 지원 종료 대상입니다.`
            : 'Billing 의존성은 찾았지만 버전을 정적으로 확정하지 못했습니다.';
      findings.push({
        code: `BILLING_${billing.status.toUpperCase()}`,
        severity: billing.status === 'blocker' ? 'blocker' : billing.status === 'pass' ? 'info' : 'warning',
        title: billing.status === 'pass' ? 'Google Play Billing version is supported' : 'Google Play Billing needs attention',
        detail: billing.summary,
        action: billing.actions[0] ?? billing.upgrade.prompt,
        file: billing.evidence[0]?.file,
        sourceUrl: billing.policy.sourceUrl,
        ko: {
          title: billing.status === 'pass' ? 'Google Play Billing 버전 기준 충족' : 'Google Play Billing 확인 필요',
          detail: billingKoDetail,
          action: billing.actions[0]
            ? '공식 마감일과 보고된 Gradle 근거를 확인한 뒤 지원 버전으로 업그레이드하세요.'
            : 'Google Play Billing 업그레이드 Skill을 사용해 변경사항을 검토하세요.',
        },
      });
    }
  }

  if (detected.ios) {
    if (detected.iosBundleIds.length === 0) {
      findings.push({
        code: 'IOS_BUNDLE_ID_UNRESOLVED',
        severity: 'warning',
        title: 'iOS bundle identifier could not be resolved',
        detail: 'The iOS project was detected, but no literal bundle identifier was found in Expo config, Info.plist, or project.pbxproj.',
        action: 'Confirm PRODUCT_BUNDLE_IDENTIFIER for the release configuration before connecting App Store Connect.',
        ko: {
          title: 'iOS bundle identifier를 확정하지 못함',
          detail: 'iOS 프로젝트는 감지했지만 Expo 설정, Info.plist, project.pbxproj에서 문자열 bundle identifier를 찾지 못했습니다.',
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
      if (detected.iosBundleIds.length > 1) {
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
    findings.push(...iosXcodeFindings(files, now));
  }

  findings.push(...await fcmFindings(files, fcmSources, root, now));

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
    coverage: {
      checked: [
        'mobile project and app identifier detection',
        ...(detected.android ? ['Android targetSdk policy', 'Google Play Billing dependency policy'] : []),
        ...(detected.ios ? ['App Store Connect Xcode / SDK minimum (pinned build tooling)'] : []),
        sourceScanTruncated
          ? `Firebase Cloud Messaging legacy API usage (first ${maxSourceFiles} source files)`
          : 'Firebase Cloud Messaging legacy API usage',
      ],
      requiresStoreConnection: [
        'store listing metadata and screenshots',
        'uploaded build availability and processing state',
        'App Store age-rating answers and Google Play declarations',
        'review submission and rollout status',
      ],
    },
  };
}
