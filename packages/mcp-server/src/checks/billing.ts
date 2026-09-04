import fs from 'node:fs/promises';
import path from 'node:path';

const BILLING_MODULE = /com\.android\.billingclient:billing(?:-ktx)?/;
const LITERAL_DEPENDENCY = /com\.android\.billingclient:billing(?:-ktx)?:([0-9]+(?:\.[0-9A-Za-z_-]+){0,3})/g;
const VARIABLE_DEPENDENCY = /com\.android\.billingclient:billing(?:-ktx)?:\$\{?([A-Za-z_][A-Za-z0-9_.-]*)\}?/g;
const VERSION_ASSIGNMENT = /(?:^|\s)([A-Za-z_][A-Za-z0-9_.-]*)\s*(?:=|:)\s*["']([0-9]+(?:\.[0-9A-Za-z_-]+){0,3})["']/gm;

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
  source: 'literal' | 'variable' | 'version_catalog' | 'unresolved';
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
          || entry.name === 'libs.versions.toml')
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

  const evidence: BillingEvidence[] = [];
  for (const [file, text] of texts) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (path.basename(file) === 'libs.versions.toml') {
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
    for (const major of [...new Set(majors.filter((value) => value < policy.minimumSupportedMajor!))].sort()) {
      const schedule = scheduleForMajor(major);
      actions.push(schedule
        ? `Billing Library ${major}: standard deadline ${schedule.submissionDeadline}; extension deadline ${schedule.extensionDeadline} only if Google granted it in Play Console.`
        : `Billing Library ${major}: its deadline predates the embedded official table; no active extension should be assumed.`);
    }
  } else if (unresolved || majors.length === 0) {
    status = 'unresolved';
    summary = 'A Billing dependency was found, but at least one version expression could not be resolved statically.';
    actions.push('Resolve the reported Gradle variable or version catalog alias and run the check again.');
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
