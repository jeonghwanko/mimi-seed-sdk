import fs from 'node:fs/promises';
import path from 'node:path';

// Lockfile and repository-root lookups shared by the Release Doctor checks (firebase-admin, react-native-iap).
// Repository-only: these read files, never the network.

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The nearest directory at or above `start` that holds a `.git` entry (a checkout or a worktree), if any. */
export async function repositoryRoot(start: string): Promise<string | undefined> {
  let current = path.resolve(start);
  for (;;) {
    if (await exists(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isWithin(scope: string, target: string): boolean {
  const relative = path.relative(scope, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Directories that may hold the lockfile (or the hoisted `node_modules`) for the package in `packageDir`: every
 * ancestor up to the scan root, then — when the scan root sits inside a repository (`--path` into a workspace
 * monorepo) — on up to that repository's root, where Yarn/npm/pnpm workspaces keep the one lockfile.
 */
export async function lockfileDirectories(packageDir: string, root: string): Promise<string[]> {
  const result: string[] = [];
  const repo = await repositoryRoot(root);
  const limit = repo && isWithin(repo, root) ? repo : root;
  let current = path.resolve(packageDir);
  for (;;) {
    result.push(current);
    if (current === limit || !isWithin(limit, current)) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

export interface LockedVersion {
  version: string;
  /** The lockfile's base name, for evidence text. */
  lockfile: 'package-lock.json' | 'pnpm-lock.yaml' | 'yarn.lock';
  /**
   * The package actually installed under the dependency's name when it differs — an `npm:` alias such as
   * `"react-native-iap": "npm:@fork/react-native-iap@^12"`. The version is then that package's, not `name`'s.
   */
  aliasOf?: string;
}

/** `npm:@scope/pkg@^1.2.3` -> `@scope/pkg`. */
function aliasTarget(spec: string): string | undefined {
  return spec.match(/^npm:((?:@[^/@]+\/)?[^@]+)(?:@|$)/)?.[1];
}

const SEMVER_PREFIX = /^(\d+\.\d+\.\d+[^\s_('"]*)/;

/**
 * pnpm-lock.yaml: the importer block for the package (v6+ workspaces, and v5 workspaces), or the top level for a
 * single-project lockfile without `importers:` (v5 and v6). Entries are either `name: 1.2.3_peer@x` (v5 inline) or a
 * nested `specifier:` / `version: 1.2.3(peer@x)` pair (v6+).
 */
function pnpmLockedVersion(text: string, name: string, fromLock: string): { version?: string; alias?: string } | undefined {
  // (an aliased entry also carries the installed package's version: `react-native-iap@12.16.2`)
  const lines = text.split(/\r?\n/);
  const importers = lines.findIndex((line) => /^importers:\s*$/.test(line));
  let start: number;
  let end: number;
  let indent: number;
  if (importers >= 0) {
    const importer = lines.findIndex((line, index) => index > importers
      && new RegExp(`^  ['"]?${escapeRegExp(fromLock || '.')}['"]?:\\s*$`).test(line));
    if (importer < 0) return undefined;
    start = importer + 1;
    end = lines.findIndex((line, index) => index > importer && /^ {0,2}\S/.test(line));
    if (end < 0) end = lines.length;
    indent = 4;
  } else {
    if (fromLock) return undefined; // a single-project lockfile only describes its own directory
    start = 0;
    end = lines.length;
    indent = 0;
  }
  const group = new RegExp(`^ {${indent}}(?:dependencies|devDependencies|optionalDependencies):\\s*$`);
  const entry = new RegExp(`^ {${indent + 2}}['"]?${escapeRegExp(name)}['"]?:\\s*(.*?)\\s*$`);
  let inGroup = false;
  for (let index = start; index < end; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const lineIndent = line.match(/^ */)![0].length;
    if (lineIndent <= indent) inGroup = group.test(line);
    if (!inGroup) continue;
    const match = entry.exec(line);
    if (!match) continue;
    const values = match[1]
      ? [match[1]]
      : lines.slice(index + 1, index + 4).map((next) => next.match(/^\s+version:\s*(.*?)\s*$/)?.[1]).filter((value): value is string => Boolean(value));
    for (const raw of values) {
      const value = raw.replace(/^['"]|['"]$/g, '');
      const version = value.match(SEMVER_PREFIX)?.[1];
      if (version) return { version };
      // pnpm writes an aliased dependency's version as `/@fork/pkg/1.2.3`, `@fork/pkg@1.2.3`, or `npm:@fork/pkg@1.2.3`.
      const alias = value.match(/^(?:npm:|\/)?((?:@[^/@]+\/)?[^/@\s]+)[/@](\d+\.\d+\.\d+[^\s_('"]*)/);
      if (alias) return { alias: alias[1], version: alias[2] };
    }
  }
  return undefined;
}

/** The version a lockfile in `lockDir` resolved for dependency `name` (declared as `declared`) of the package in `packageDir`. */
export async function lockedPackageVersion(
  name: string,
  packageDir: string,
  lockDir: string,
  declared: string,
): Promise<LockedVersion | undefined> {
  const fromLock = path.relative(lockDir, packageDir).replace(/\\/g, '/');
  const declaredAlias = aliasTarget(declared);
  const npmLock = await readText(path.join(lockDir, 'package-lock.json'));
  if (npmLock) {
    try {
      const lock = JSON.parse(npmLock) as {
        packages?: Record<string, { version?: unknown; name?: unknown }>;
        dependencies?: Record<string, { version?: unknown }>;
      };
      const keys = [`${fromLock ? `${fromLock}/` : ''}node_modules/${name}`, `node_modules/${name}`];
      for (const key of keys) {
        const entry = lock.packages?.[key];
        if (typeof entry?.version !== 'string') continue;
        // An aliased install records the real package's name next to its version.
        const installed = typeof entry.name === 'string' && entry.name !== name ? entry.name : declaredAlias;
        return { version: entry.version, lockfile: 'package-lock.json', ...(installed ? { aliasOf: installed } : {}) };
      }
      const legacy = lock.dependencies?.[name]?.version;
      if (typeof legacy === 'string') {
        const legacyAlias = aliasTarget(legacy) ?? declaredAlias;
        const version = legacy.replace(/^npm:(?:@[^/@]+\/)?[^@]+@/, '');
        return { version, lockfile: 'package-lock.json', ...(legacyAlias ? { aliasOf: legacyAlias } : {}) };
      }
    } catch {
      // Malformed lockfile: fall through to the next source.
    }
  }
  const pnpmLock = await readText(path.join(lockDir, 'pnpm-lock.yaml'));
  if (pnpmLock) {
    const locked = pnpmLockedVersion(pnpmLock, name, fromLock);
    if (locked?.alias) return { version: locked.version ?? '', lockfile: 'pnpm-lock.yaml', aliasOf: locked.alias };
    if (locked?.version) {
      return { version: locked.version, lockfile: 'pnpm-lock.yaml', ...(declaredAlias ? { aliasOf: declaredAlias } : {}) };
    }
  }
  const yarnLock = await readText(path.join(lockDir, 'yarn.lock'));
  if (yarnLock) {
    const header = new RegExp(`(?:^|[\\s",])${escapeRegExp(name)}@(?:npm:)?${escapeRegExp(declared)}(?=["',:]|$)`);
    const blocks = yarnLock.split(/\r?\n(?=\S)/);
    for (const block of blocks) {
      const [first] = block.split(/\r?\n/, 1);
      if (!header.test(first)) continue;
      const version = block.match(/^\s+version:?\s+"?(\d+\.\d+\.\d+[^\s"]*)/m)?.[1];
      if (!version) continue;
      // Berry: `resolution: "@fork/pkg@npm:1.2.3"`; v1: `resolved "https://registry…/@fork/pkg/-/pkg-1.2.3.tgz"`.
      const berry = block.match(/^\s+resolution:\s+"?((?:@[^/@"]+\/)?[^@"]+)@/m)?.[1];
      const classic = block.match(/^\s+resolved\s+"?https?:\/\/[^"\s]*?\/((?:@[^/]+\/)?[^/]+)\/-\//m)?.[1];
      const installed = [berry, classic].find((candidate) => candidate && decodeURIComponent(candidate) !== name);
      const aliasOf = installed ? decodeURIComponent(installed) : declaredAlias;
      return { version, lockfile: 'yarn.lock', ...(aliasOf ? { aliasOf } : {}) };
    }
  }
  return undefined;
}
