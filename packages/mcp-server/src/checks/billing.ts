import fs from 'node:fs/promises';
import path from 'node:path';

const BILLING_MODULE = /com\.android\.billingclient:billing(?:-ktx)?/;
const LITERAL_DEPENDENCY = /com\.android\.billingclient:billing(?:-ktx)?:([0-9]+(?:\.[0-9A-Za-z_-]+){0,3})/g;
const VARIABLE_DEPENDENCY = /com\.android\.billingclient:billing(?:-ktx)?:\$\{?([A-Za-z_][A-Za-z0-9_.-]*)\}?/g;
const VERSION_ASSIGNMENT = /(?:^|\s)([A-Za-z_][A-Za-z0-9_.-]*)\s*(?:=|:)\s*["']([0-9]+(?:\.[0-9A-Za-z_-]+){0,3})["']/gm;

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
    minimumSupportedMajor: number;
    submissionDeadline: string;
    extensionDeadline: string;
    latestKnownMajor: number;
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
    if (section !== 'libraries') continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*\{(.+)}\s*$/);
    if (!match) continue;
    const body = match[2];
    const module = body.match(/module\s*=\s*["']([^"']+)["']/)?.[1];
    const version = body.match(/(?:^|,)\s*version\s*=\s*["']([^"']+)["']/)?.[1];
    const versionRef = body.match(/version\.ref\s*=\s*["']([^"']+)["']/)?.[1];
    libraries.set(match[1], { module, version, versionRef });
  }
  return { versions, libraries };
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
  const currentYear = now.getUTCFullYear();
  const deadlineThisYear = new Date(Date.UTC(currentYear, 7, 31, 23, 59, 59));
  const minimumSupportedMajor = now > deadlineThisYear ? currentYear - 2018 : currentYear - 2019;
  const unsupportedMajor = minimumSupportedMajor - 1;
  return {
    minimumSupportedMajor,
    submissionDeadline: `${unsupportedMajor + 2019}-08-31`,
    extensionDeadline: `${unsupportedMajor + 2019}-11-01`,
    latestKnownMajor: Math.max(9, minimumSupportedMajor + 1),
    sourceUrl: 'https://developer.android.com/google/play/billing/deprecation-faq',
  };
}

export async function checkBillingCompliance(
  projectPath: string,
  now = new Date(),
): Promise<BillingComplianceResult> {
  const root = path.resolve(projectPath);
  const files = await walk(root);
  const texts = new Map<string, string>();
  for (const file of files) texts.set(file, await fs.readFile(file, 'utf8'));

  const catalogFile = files.find((file) => path.basename(file) === 'libs.versions.toml');
  const catalog = catalogFile ? parseCatalog(texts.get(catalogFile) ?? '') : { versions: new Map(), libraries: new Map() };
  const allVariables = new Map<string, string>();
  for (const [file, text] of texts) {
    if (path.basename(file) === 'libs.versions.toml') continue;
    for (const [key, value] of collectVariables(text)) allVariables.set(key, value);
  }

  const evidence: BillingEvidence[] = [];
  for (const [file, text] of texts) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (path.basename(file) === 'libs.versions.toml') {
      for (const [alias, lib] of catalog.libraries) {
        if (!lib.module || !BILLING_MODULE.test(lib.module)) continue;
        const version = lib.version ?? (lib.versionRef ? catalog.versions.get(lib.versionRef) : undefined);
        evidence.push({
          file: relative,
          module: lib.module,
          version,
          expression: `libs.${alias.replace(/-/g, '.')}`,
          source: version ? 'version_catalog' : 'unresolved',
        });
      }
      continue;
    }

    for (const match of text.matchAll(LITERAL_DEPENDENCY)) {
      evidence.push({
        file: relative,
        module: match[0].slice(0, match[0].lastIndexOf(':')),
        version: match[1],
        source: 'literal',
      });
    }
    for (const match of text.matchAll(VARIABLE_DEPENDENCY)) {
      const version = allVariables.get(match[1]);
      evidence.push({
        file: relative,
        module: match[0].slice(0, match[0].lastIndexOf(':')),
        version,
        expression: match[1],
        source: version ? 'variable' : 'unresolved',
      });
    }
    for (const aliasMatch of text.matchAll(/\blibs\.([A-Za-z0-9_.-]+)/g)) {
      const alias = normalizeAlias(aliasMatch[1]);
      const lib = catalog.libraries.get(alias) ?? catalog.libraries.get(aliasMatch[1]);
      if (!lib?.module || !BILLING_MODULE.test(lib.module)) continue;
      const version = lib.version ?? (lib.versionRef ? catalog.versions.get(lib.versionRef) : undefined);
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
  } else if (majors.some((major) => major < policy.minimumSupportedMajor)) {
    status = 'blocker';
    summary = `Billing Library ${detectedVersions.join(', ')} is below the submission minimum major ${policy.minimumSupportedMajor}.`;
    actions.push(`Upgrade to a supported Billing Library before submitting a new app or update.`);
    actions.push(`If Google granted an extension, verify it in Play Console; the listed extension deadline is ${policy.extensionDeadline}.`);
  } else if (unresolved || majors.length === 0) {
    status = 'unresolved';
    summary = 'A Billing dependency was found, but at least one version expression could not be resolved statically.';
    actions.push('Resolve the reported Gradle variable or version catalog alias and run the check again.');
  } else if (majors.some((major) => major === policy.minimumSupportedMajor)) {
    status = 'warning';
    summary = `Billing Library ${detectedVersions.join(', ')} is currently supported but is the next major scheduled for deprecation.`;
    actions.push(`Plan an upgrade before ${policy.minimumSupportedMajor + 2019}-08-31.`);
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
