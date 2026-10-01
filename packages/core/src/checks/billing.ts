import fs from 'node:fs/promises';
import path from 'node:path';
import { lockedPackageVersion, lockfileDirectories } from './lockfile.js';

const BILLING_MODULE = /com\.android\.billingclient:billing(?:-ktx)?/;
const LITERAL_DEPENDENCY = /com\.android\.billingclient:billing(?:-ktx)?:([0-9]+(?:\.[0-9A-Za-z_-]+){0,3})/g;
const VARIABLE_DEPENDENCY = /com\.android\.billingclient:billing(?:-ktx)?:\$\{?([A-Za-z_][A-Za-z0-9_.-]*)\}?/g;
const VERSION_ASSIGNMENT = /(?:^|\s)([A-Za-z_][A-Za-z0-9_.-]*)\s*(?:=|:)\s*["']([0-9]+(?:\.[0-9A-Za-z_-]+){0,3})["']/gm;

// Repository-only scans cannot fetch Maven metadata. Keep a deliberately small,
// source-verified cache for OpenIAP releases used by supported react-native-iap
// versions. Unknown releases remain unresolved instead of being guessed.
const KNOWN_OPENIAP_BILLING = new Map<string, { module: string; version: string }>([
  ['2.1.0', { module: 'com.android.billingclient:billing-ktx', version: '8.3.0' }],
  ['2.4.1', { module: 'com.android.billingclient:billing', version: '9.1.0' }],
]);

// react-native-iap release -> the Play Billing Library its Android module builds with by default, so a version
// pinned in a lockfile can be judged without node_modules. Verified 2026-10-01 against every stable release from
// 4.0.0 to 16.7.2 on npm (each tarball's android/build.gradle, android/gradle.properties and openiap-versions.json):
// - 4.0.0–12.5.0 and 14.0.0–14.2.x: a literal com.android.billingclient dependency in android/build.gradle.
// - 12.5.1–13.x: `billing-ktx:$playBillingSdkVersion`, defaulting to `RNIap_playBillingSdkVersion` in the
//   package's android/gradle.properties; the app can override it with a root `ext.playBillingSdkVersion`.
// - 14.3.0+: the io.github.hyochan.openiap:openiap-google version it pins (android/build.gradle, later
//   openiap-versions.json), resolved through that artifact's POM on Maven Central.
// Each row applies from its `from` version up to the next row. A release newer than REACT_NATIVE_IAP_VERIFIED_THROUGH
// or a prerelease stays unresolved instead of being guessed.
const REACT_NATIVE_IAP_VERIFIED_THROUGH = [16, 7, 2] as const;
const REACT_NATIVE_IAP_BILLING: ReadonlyArray<{
  from: readonly [number, number, number];
  module: 'com.android.billingclient:billing' | 'com.android.billingclient:billing-ktx';
  version: string;
  /** The app's root `ext.playBillingSdkVersion` replaces the default. */
  overridable?: true;
}> = [
  { from: [4, 0, 0], module: 'com.android.billingclient:billing', version: '2.0.3' },
  { from: [4, 6, 0], module: 'com.android.billingclient:billing', version: '3.0.0' },
  { from: [6, 0, 4], module: 'com.android.billingclient:billing', version: '3.0.3' },
  { from: [7, 0, 0], module: 'com.android.billingclient:billing', version: '4.0.0' },
  { from: [9, 0, 0], module: 'com.android.billingclient:billing-ktx', version: '5.0.0' },
  { from: [12, 5, 1], module: 'com.android.billingclient:billing-ktx', version: '5.1.0', overridable: true },
  { from: [12, 10, 6], module: 'com.android.billingclient:billing-ktx', version: '5.2.1', overridable: true },
  { from: [12, 11, 0], module: 'com.android.billingclient:billing-ktx', version: '6.0.1', overridable: true },
  { from: [12, 13, 1], module: 'com.android.billingclient:billing-ktx', version: '6.1.0', overridable: true },
  { from: [12, 15, 0], module: 'com.android.billingclient:billing-ktx', version: '7.0.0', overridable: true },
  { from: [14, 0, 0], module: 'com.android.billingclient:billing-ktx', version: '8.0.0' },
  { from: [14, 6, 0], module: 'com.android.billingclient:billing-ktx', version: '8.1.0' },
  { from: [14, 6, 3], module: 'com.android.billingclient:billing-ktx', version: '8.2.1' },
  { from: [14, 6, 4], module: 'com.android.billingclient:billing-ktx', version: '8.3.0' },
  { from: [15, 4, 0], module: 'com.android.billingclient:billing', version: '9.1.0' },
];

function compareTriples(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The Billing Library a stable react-native-iap release bundles by default, or null when it is not in the verified table. */
export function reactNativeIapBundledBilling(version: string): (typeof REACT_NATIVE_IAP_BILLING)[number] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null; // ranges, tags, and prereleases are not mapped
  const triple = match.slice(1, 4).map((part) => Number.parseInt(part, 10));
  if (compareTriples(triple, REACT_NATIVE_IAP_VERIFIED_THROUGH) > 0) return null;
  return [...REACT_NATIVE_IAP_BILLING].reverse().find((row) => compareTriples(triple, row.from) >= 0) ?? null;
}

/** The first react-native-iap release whose bundled Billing major is at least `minimumMajor`. */
export function reactNativeIapUpgradeTarget(minimumMajor: number): { version: string; billing: string } | undefined {
  const row = REACT_NATIVE_IAP_BILLING.find((candidate) => Number.parseInt(candidate.version, 10) >= minimumMajor);
  return row ? { version: row.from.join('.'), billing: row.version } : undefined;
}

const BILLING_SUPPORT_SCHEDULE = [
  { major: 5, submissionDeadline: '2024-08-31', extensionDeadline: '2024-11-01' },
  { major: 6, submissionDeadline: '2025-08-31', extensionDeadline: '2025-11-01' },
  { major: 7, submissionDeadline: '2026-08-31', extensionDeadline: '2026-11-01' },
  { major: 8, submissionDeadline: '2027-08-31', extensionDeadline: '2027-11-01' },
  { major: 9, submissionDeadline: '2028-08-31', extensionDeadline: '2028-11-01' },
] as const;

const SKIP_DIRS = new Set([
  '.git',
  '.gradle',
  '.idea',
  'build',
  'dist',
  'node_modules',
  'Pods',
  'DerivedData',
]);

export type BillingComplianceStatus = 'pass' | 'warning' | 'blocker' | 'unresolved' | 'not_used';

export interface BillingEvidence {
  file: string;
  module: string;
  version?: string;
  expression?: string;
  source: 'literal' | 'variable' | 'version_catalog' | 'transitive' | 'unresolved';
  /** The IAP wrapper package that brings Billing in transitively (e.g. react-native-iap), when there is one. */
  wrapper?: { name: string; version: string };
}
export interface BillingComplianceResult {
  projectPath: string;
  checkedAt: string;
  status: BillingComplianceStatus;
  detectedVersions: string[];
  evidence: BillingEvidence[];
  policy: {
    minimumSupportedMajor: number | null;
    submissionDeadline: string;
    extensionDeadline: string;
    latestKnownMajor: number;
    scheduleCurrent: boolean;
    knownSchedule: Array<{ major: number; submissionDeadline: string; extensionDeadline: string }>;
    sourceUrl: string;
  };
  summary: string;
  actions: string[];
  upgrade: {
    installCommand: string;
    prompt: string;
    automaticExecution: false;
  };
}

export type BillingTransitiveResolver = (
  openIapVersion: string,
) => Promise<{ module: string; version: string } | null>;

interface CatalogInfo {
  versions: Map<string, string>;
  libraries: Map<string, { module?: string; version?: string; versionRef?: string }>;
  bundles: Map<string, string[]>;
}

async function walk(root: string, maxDepth = 7): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await visit(path.join(dir, entry.name), depth + 1);
      } else if (
        entry.isFile()
        && (entry.name === 'build.gradle'
          || entry.name === 'build.gradle.kts'
          || entry.name === 'mainTemplate.gradle'
          || entry.name === 'baseProjectTemplate.gradle'
          || entry.name === 'launcherTemplate.gradle'
          || entry.name === 'libs.versions.toml'
          || entry.name === 'package.json')
      ) {
        result.push(path.join(dir, entry.name));
      }
    }
  }
  await visit(root, 0);
  return result;
}

function parseCatalog(text: string): CatalogInfo {
  const versions = new Map<string, string>();
  const libraries = new Map<string, { module?: string; version?: string; versionRef?: string }>();
  const bundles = new Map<string, string[]>();
  let section = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section === 'versions') {
      const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/);
      if (match) versions.set(match[1], match[2]);
      continue;
    }
    if (section === 'bundles') {
      const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*\[([^\]]*)]/);
      if (match) {
        bundles.set(match[1], [...match[2].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]));
      }
      continue;
    }
    if (section !== 'libraries') continue;
    const shorthand = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/);
    if (shorthand) {
      const coordinates = shorthand[2].split(':');
      libraries.set(shorthand[1], {
        module: coordinates.length >= 2 ? `${coordinates[0]}:${coordinates[1]}` : undefined,
        version: coordinates.length >= 3 ? coordinates.slice(2).join(':') : undefined,
      });
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*\{(.+)}\s*$/);
    if (!match) continue;
    const body = match[2];
    const explicitModule = body.match(/module\s*=\s*["']([^"']+)["']/)?.[1];
    const group = body.match(/group\s*=\s*["']([^"']+)["']/)?.[1];
    const name = body.match(/name\s*=\s*["']([^"']+)["']/)?.[1];
    const module = explicitModule ?? (group && name ? `${group}:${name}` : undefined);
    const version = body.match(/(?:^|,)\s*version\s*=\s*["']([^"']+)["']/)?.[1];
    const versionRef = body.match(/version\.ref\s*=\s*["']([^"']+)["']/)?.[1];
    libraries.set(match[1], { module, version, versionRef });
  }
  return { versions, libraries, bundles };
}

function collectVariables(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of text.matchAll(VERSION_ASSIGNMENT)) result.set(match[1], match[2]);
  return result;
}

function normalizeAlias(alias: string): string {
  return alias.replace(/^libs\./, '').replace(/\./g, '-');
}

function majorOf(version: string): number | null {
  const major = Number.parseInt(version.split('.')[0], 10);
  return Number.isFinite(major) ? major : null;
}

export function billingVersionFromPom(pom: string): { module: string; version: string } | null {
  for (const match of pom.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const block = match[1];
    const group = block.match(/<groupId>\s*([^<]+)\s*<\/groupId>/)?.[1]?.trim();
    const artifact = block.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/)?.[1]?.trim();
    const version = block.match(/<version>\s*([^<]+)\s*<\/version>/)?.[1]?.trim();
    if (group === 'com.android.billingclient' && /^billing(?:-ktx)?$/.test(artifact ?? '') && version) {
      return { module: `${group}:${artifact}`, version };
    }
  }
  return null;
}

async function nearestNodePackage(packageDir: string, root: string): Promise<string | null> {
  // Workspaces hoist node_modules toward the root — past the scan root when --path points into a monorepo.
  for (const directory of await lockfileDirectories(packageDir, root)) {
    const candidate = path.join(directory, 'node_modules', 'react-native-iap');
    try {
      if ((await fs.stat(candidate)).isDirectory()) return candidate;
    } catch {
      // Keep walking toward the repository root.
    }
  }
  return null;
}

function displayPath(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, '/');
}

/** An app's root `ext.playBillingSdkVersion`, which react-native-iap 12.5.1–13.x use instead of their default. */
export interface ReactNativeIapBillingOverride {
  file: string;
  version: string;
}

async function reactNativeIapEvidence(
  root: string,
  manifestFile: string,
  manifestText: string,
  resolveTransitive: BillingTransitiveResolver | undefined,
  override: ReactNativeIapBillingOverride | undefined,
): Promise<BillingEvidence | null> {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestText) as Record<string, unknown>;
  } catch {
    return null;
  }
  const dependencyGroups = ['dependencies', 'devDependencies', 'optionalDependencies']
    .map((key) => manifest[key])
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object');
  const declaredVersion = dependencyGroups
    .map((group) => group['react-native-iap'])
    .find((value): value is string => typeof value === 'string');
  if (!declaredVersion) return null;

  const relativeManifest = displayPath(root, manifestFile);
  const unresolved = (expression: string, wrapperVersion = declaredVersion): BillingEvidence => ({
    file: relativeManifest,
    module: 'com.android.billingclient:billing',
    expression,
    source: 'unresolved',
    wrapper: { name: 'react-native-iap', version: wrapperVersion },
  });
  // The verified react-native-iap -> Billing table (see REACT_NATIVE_IAP_BILLING).
  const fromTable = (version: string, origin: string): BillingEvidence | null => {
    const row = reactNativeIapBundledBilling(version);
    if (!row) return null;
    const wrapper = { name: 'react-native-iap', version };
    if (row.overridable && override) {
      return {
        file: override.file,
        module: row.module,
        version: override.version,
        expression: `react-native-iap ${version} from ${origin}, with ext.playBillingSdkVersion = ${override.version} replacing its default ${row.version}`,
        source: 'variable',
        wrapper,
      };
    }
    return {
      file: relativeManifest,
      module: row.module,
      version: row.version,
      expression: `react-native-iap ${version} from ${origin} bundles ${row.module}:${row.version}${row.overridable ? ' by default' : ''}`,
      source: 'transitive',
      wrapper,
    };
  };

  const packageDir = path.dirname(manifestFile);
  const installedDir = await nearestNodePackage(packageDir, root);
  if (!installedDir) {
    // Not installed (a fresh clone, or CI before `install`): the lockfile still says which release ships.
    for (const directory of await lockfileDirectories(packageDir, root)) {
      const locked = await lockedPackageVersion('react-native-iap', packageDir, directory, declaredVersion);
      if (!locked) continue;
      const origin = displayPath(root, path.join(directory, locked.lockfile));
      return fromTable(locked.version, origin) ?? unresolved(
        `react-native-iap ${locked.version} from ${origin} is not in the embedded react-native-iap -> Play Billing table; install dependencies so its Gradle file can be read`,
        locked.version,
      );
    }
    return fromTable(declaredVersion, 'declared') ?? unresolved(
      `react-native-iap ${declaredVersion} is declared but neither installed nor pinned in a lockfile; transitive Billing version is unresolved`,
    );
  }

  let installedVersion = declaredVersion;
  try {
    const installedManifest = JSON.parse(await fs.readFile(path.join(installedDir, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    if (typeof installedManifest.version === 'string') installedVersion = installedManifest.version;
  } catch {
    // The declaration still provides useful evidence when package metadata is unavailable.
  }
  const installedWrapper = { name: 'react-native-iap', version: installedVersion };

  const directCandidates = [
    path.join(installedDir, 'android', 'build.gradle'),
    path.join(installedDir, 'android', 'build.gradle.kts'),
  ];
  for (const candidate of directCandidates) {
    let text: string;
    try {
      text = await fs.readFile(candidate, 'utf8');
    } catch {
      continue; // Newer react-native-iap versions delegate Billing to the OpenIAP Maven artifact.
    }
    const direct = [...text.matchAll(LITERAL_DEPENDENCY)][0];
    if (direct) {
      return {
        file: relativeManifest,
        module: direct[0].slice(0, direct[0].lastIndexOf(':')),
        version: direct[1],
        expression: `react-native-iap ${installedVersion} native dependency`,
        source: 'transitive',
        wrapper: installedWrapper,
      };
    }
    // 12.5.1–13.x: `billing-ktx:$playBillingSdkVersion`, defaulting to the package's own gradle.properties.
    const variable = [...text.matchAll(VARIABLE_DEPENDENCY)][0];
    if (variable?.[1] === 'playBillingSdkVersion') {
      const module = variable[0].slice(0, variable[0].lastIndexOf(':'));
      if (override) {
        return {
          file: override.file,
          module,
          version: override.version,
          expression: `react-native-iap ${installedVersion} with ext.playBillingSdkVersion = ${override.version}`,
          source: 'variable',
          wrapper: installedWrapper,
        };
      }
      try {
        const properties = await fs.readFile(path.join(installedDir, 'android', 'gradle.properties'), 'utf8');
        const version = properties.match(/^\s*RNIap_playBillingSdkVersion\s*=\s*([0-9]+(?:\.[0-9A-Za-z_-]+){0,3})\s*$/m)?.[1];
        if (version) {
          return {
            file: relativeManifest,
            module,
            version,
            expression: `react-native-iap ${installedVersion} default RNIap_playBillingSdkVersion`,
            source: 'transitive',
            wrapper: installedWrapper,
          };
        }
      } catch {
        // Fall back to the verified table below.
      }
    }
  }

  let openIapVersion: string | undefined;
  try {
    const versions = JSON.parse(await fs.readFile(path.join(installedDir, 'openiap-versions.json'), 'utf8')) as {
      google?: unknown;
    };
    if (typeof versions.google === 'string') openIapVersion = versions.google;
  } catch {
    // Older releases may not use OpenIAP; fall through to the verified table, then to an unresolved, safe result.
  }
  if (!openIapVersion || !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(openIapVersion)) {
    return fromTable(installedVersion, 'installed')
      ?? unresolved(`react-native-iap ${installedVersion} detected; transitive Billing version is unresolved`, installedVersion);
  }

  const coordinate = `io.github.hyochan.openiap:openiap-google:${openIapVersion}`;
  const known = KNOWN_OPENIAP_BILLING.get(openIapVersion);
  if (!resolveTransitive) {
    if (known) {
      return {
        file: relativeManifest,
        module: known.module,
        version: known.version,
        expression: `react-native-iap ${installedVersion} -> ${coordinate} (embedded Maven metadata)`,
        source: 'transitive',
        wrapper: installedWrapper,
      };
    }
    return fromTable(installedVersion, 'installed') ?? unresolved(
      `react-native-iap ${installedVersion} -> ${coordinate}; transitive lookup unavailable in repository-only mode`,
      installedVersion,
    );
  }
  try {
    const resolved = await resolveTransitive(openIapVersion);
    if (resolved) {
      return {
        file: relativeManifest,
        module: resolved.module,
        version: resolved.version,
        expression: `react-native-iap ${installedVersion} -> ${coordinate}`,
        source: 'transitive',
        wrapper: installedWrapper,
      };
    }
  } catch {
    // Network failure must not turn a known IAP dependency into not_used.
  }
  if (known) {
    return {
      file: relativeManifest,
      module: known.module,
      version: known.version,
      expression: `react-native-iap ${installedVersion} -> ${coordinate} (embedded Maven metadata fallback)`,
      source: 'transitive',
      wrapper: installedWrapper,
    };
  }
  return unresolved(`react-native-iap ${installedVersion} -> ${coordinate}; Maven Billing version lookup failed`, installedVersion);
}

function policyAt(now: Date): BillingComplianceResult['policy'] {
  const deadlineEnd = (date: string) => new Date(`${date}T23:59:59.999Z`);
  const next = BILLING_SUPPORT_SCHEDULE.find((row) => now <= deadlineEnd(row.submissionDeadline));
  const lastExpired = [...BILLING_SUPPORT_SCHEDULE]
    .filter((row) => now > deadlineEnd(row.submissionDeadline))
    .at(-1);
  return {
    minimumSupportedMajor: next?.major ?? null,
    submissionDeadline: lastExpired?.submissionDeadline ?? BILLING_SUPPORT_SCHEDULE[0].submissionDeadline,
    extensionDeadline: lastExpired?.extensionDeadline ?? BILLING_SUPPORT_SCHEDULE[0].extensionDeadline,
    latestKnownMajor: BILLING_SUPPORT_SCHEDULE.at(-1)!.major,
    scheduleCurrent: Boolean(next),
    knownSchedule: BILLING_SUPPORT_SCHEDULE.map((row) => ({ ...row })),
    sourceUrl: 'https://developer.android.com/google/play/billing/deprecation-faq',
  };
}

function scheduleForMajor(major: number) {
  return BILLING_SUPPORT_SCHEDULE.find((row) => row.major === major);
}

function catalogScope(file: string): string {
  const parent = path.dirname(file);
  return path.basename(parent) === 'gradle' ? path.dirname(parent) : parent;
}

function isWithin(scope: string, file: string): boolean {
  const relative = path.relative(scope, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function checkBillingCompliance(
  projectPath: string,
  now = new Date(),
  options: { resolveTransitive?: BillingTransitiveResolver } = {},
): Promise<BillingComplianceResult> {
  const root = path.resolve(projectPath);
  let rootStat;
  try {
    rootStat = await fs.stat(root);
  } catch {
    throw new Error(`Android project path does not exist or is not readable: ${root}`);
  }
  if (!rootStat.isDirectory()) throw new Error(`Android project path is not a directory: ${root}`);
  const files = await walk(root);
  const texts = new Map<string, string>();
  for (const file of files) texts.set(file, await fs.readFile(file, 'utf8'));

  const catalogs = files
    .filter((file) => path.basename(file) === 'libs.versions.toml')
    .map((file) => ({ file, scope: catalogScope(file), info: parseCatalog(texts.get(file) ?? '') }));
  const variablesByFile = new Map<string, Map<string, string>>();
  for (const [file, text] of texts) {
    if (path.basename(file) === 'libs.versions.toml') continue;
    variablesByFile.set(file, collectVariables(text));
  }

  const catalogFor = (file: string): CatalogInfo | undefined => catalogs
    .filter((entry) => isWithin(entry.scope, file))
    .sort((left, right) => right.scope.length - left.scope.length)[0]?.info
    ?? (catalogs.length === 1 ? catalogs[0].info : undefined);

  const variableFor = (file: string, key: string): string | undefined => [...variablesByFile.entries()]
    .filter(([candidate]) => candidate === file || isWithin(path.dirname(candidate), file))
    .sort(([left], [right]) => path.dirname(right).length - path.dirname(left).length)
    .map(([, variables]) => variables.get(key))
    .find((value) => value !== undefined);

  // react-native-iap 12.5.1–13.x read `rootProject.ext.playBillingSdkVersion` before their own default.
  let iapOverride: ReactNativeIapBillingOverride | undefined;
  for (const [file, text] of texts) {
    if (!/build\.gradle(?:\.kts)?$/.test(file)) continue;
    const version = text.match(/\bplayBillingSdkVersion\s*=\s*["']([0-9]+(?:\.[0-9A-Za-z_-]+){0,3})["']/)?.[1];
    if (version) {
      iapOverride = { file: displayPath(root, file), version };
      break;
    }
  }

  const evidence: BillingEvidence[] = [];
  for (const [file, text] of texts) {
    if (path.basename(file) !== 'package.json') continue;
    const transitive = await reactNativeIapEvidence(
      root,
      file,
      text,
      options.resolveTransitive,
      iapOverride,
    );
    if (transitive && !evidence.some((row) => row.expression === transitive.expression)) evidence.push(transitive);
  }
  for (const [file, text] of texts) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (path.basename(file) === 'libs.versions.toml' || path.basename(file) === 'package.json') {
      continue;
    }

    const catalog = catalogFor(file);

    for (const match of text.matchAll(LITERAL_DEPENDENCY)) {
      evidence.push({
        file: relative,
        module: match[0].slice(0, match[0].lastIndexOf(':')),
        version: match[1],
        source: 'literal',
      });
    }
    for (const match of text.matchAll(VARIABLE_DEPENDENCY)) {
      const version = variableFor(file, match[1]);
      evidence.push({
        file: relative,
        module: match[0].slice(0, match[0].lastIndexOf(':')),
        version,
        expression: match[1],
        source: version ? 'variable' : 'unresolved',
      });
    }
    for (const bundleMatch of text.matchAll(/\blibs\.bundles\.([A-Za-z0-9_.-]+)/g)) {
      const bundleAlias = normalizeAlias(bundleMatch[1]);
      const libraryAliases = catalog?.bundles.get(bundleAlias) ?? catalog?.bundles.get(bundleMatch[1]) ?? [];
      for (const libraryAlias of libraryAliases) {
        const normalizedLibraryAlias = normalizeAlias(libraryAlias);
        const lib = catalog?.libraries.get(normalizedLibraryAlias) ?? catalog?.libraries.get(libraryAlias);
        if (!lib?.module || !BILLING_MODULE.test(lib.module)) continue;
        const version = lib.version ?? (lib.versionRef ? catalog?.versions.get(lib.versionRef) : undefined);
        if (!evidence.some((row) => row.file === relative && row.expression === bundleMatch[0] && row.module === lib.module)) {
          evidence.push({
            file: relative,
            module: lib.module,
            version,
            expression: bundleMatch[0],
            source: version ? 'version_catalog' : 'unresolved',
          });
        }
      }
    }
    for (const aliasMatch of text.matchAll(/\blibs\.([A-Za-z0-9_.-]+)/g)) {
      if (aliasMatch[1].startsWith('bundles.')) continue;
      const alias = normalizeAlias(aliasMatch[1]);
      const lib = catalog?.libraries.get(alias) ?? catalog?.libraries.get(aliasMatch[1]);
      if (!lib?.module || !BILLING_MODULE.test(lib.module)) continue;
      const version = lib.version ?? (lib.versionRef ? catalog?.versions.get(lib.versionRef) : undefined);
      if (!evidence.some((row) => row.file === relative && row.expression === aliasMatch[0])) {
        evidence.push({
          file: relative,
          module: lib.module,
          version,
          expression: aliasMatch[0],
          source: version ? 'version_catalog' : 'unresolved',
        });
      }
    }
    if (BILLING_MODULE.test(text) && !evidence.some((row) => row.file === relative)) {
      evidence.push({
        file: relative,
        module: 'com.android.billingclient:billing',
        expression: 'Billing dependency found but version could not be resolved',
        source: 'unresolved',
      });
    }
  }

  const detectedVersions = [...new Set(evidence.flatMap((row) => row.version ? [row.version] : []))].sort();
  const policy = policyAt(now);
  const majors = detectedVersions.map(majorOf).filter((major): major is number => major !== null);
  const unresolved = evidence.some((row) => !row.version);
  let status: BillingComplianceStatus;
  let summary: string;
  const actions: string[] = [];

  if (evidence.length === 0) {
    status = 'not_used';
    summary = 'Google Play Billing dependency was not found in the scanned Gradle project.';
  } else if (!policy.scheduleCurrent || policy.minimumSupportedMajor === null) {
    status = 'unresolved';
    summary = `The official schedule embedded in this release ends at Billing Library ${policy.latestKnownMajor}; current policy must be refreshed from the source.`;
    actions.push('Check the official Billing deprecation table and update Mimi Seed before relying on this result.');
  } else if (majors.some((major) => major < policy.minimumSupportedMajor!)) {
    status = 'blocker';
    summary = `Billing Library ${detectedVersions.join(', ')} is below the submission minimum major ${policy.minimumSupportedMajor}.`;
    actions.push(`Upgrade to a supported Billing Library before submitting a new app or update.`);
    const minimum = policy.minimumSupportedMajor;
    const iapTarget = reactNativeIapUpgradeTarget(minimum);
    if (iapTarget && evidence.some((row) => row.wrapper?.name === 'react-native-iap'
      && row.version && (majorOf(row.version) ?? minimum) < minimum)) {
      actions.push(`react-native-iap brings Billing in transitively: upgrade it to ${iapTarget.version} or later (Billing ${iapTarget.billing}); it is a major-version upgrade, so follow its migration guide.`);
    }
    for (const major of [...new Set(majors.filter((value) => value < policy.minimumSupportedMajor!))].sort()) {
      const schedule = scheduleForMajor(major);
      actions.push(schedule
        ? `Billing Library ${major}: standard deadline ${schedule.submissionDeadline}; extension deadline ${schedule.extensionDeadline} only if Google granted it in Play Console.`
        : `Billing Library ${major}: its deadline predates the embedded official table; no active extension should be assumed.`);
    }
  } else if (unresolved || majors.length === 0) {
    status = 'unresolved';
    const reasons = evidence.filter((row) => !row.version).map((row) => `${row.file}: ${row.expression ?? row.module}`);
    summary = `A Billing dependency was found, but at least one version expression could not be resolved statically (${reasons.slice(0, 3).join('; ')}${reasons.length > 3 ? `; +${reasons.length - 3}` : ''}).`;
    actions.push('Resolve the reported Gradle/version catalog expression or install the declared IAP package, then run the check again.');
  } else if (majors.some((major) => major === policy.minimumSupportedMajor)) {
    status = 'warning';
    summary = `Billing Library ${detectedVersions.join(', ')} is currently supported but is the next major scheduled for deprecation.`;
    const nextDeadline = scheduleForMajor(policy.minimumSupportedMajor);
    if (nextDeadline) actions.push(`Plan an upgrade before ${nextDeadline.submissionDeadline}.`);
  } else {
    status = 'pass';
    summary = `Billing Library ${detectedVersions.join(', ')} satisfies the current submission policy.`;
  }

  return {
    projectPath: root,
    checkedAt: now.toISOString(),
    status,
    detectedVersions,
    evidence,
    policy,
    summary,
    actions,
    upgrade: {
      installCommand: 'android skills add play-billing-library-version-upgrade',
      prompt: 'Help me upgrade my Play Billing Library implementation.',
      automaticExecution: false,
    },
  };
}
