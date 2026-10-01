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
}

/** The version a lockfile in `lockDir` resolved for dependency `name` (declared as `declared`) of the package in `packageDir`. */
export async function lockedPackageVersion(
  name: string,
  packageDir: string,
  lockDir: string,
  declared: string,
): Promise<LockedVersion | undefined> {
  const fromLock = path.relative(lockDir, packageDir).replace(/\\/g, '/');
  const npmLock = await readText(path.join(lockDir, 'package-lock.json'));
  if (npmLock) {
    try {
      const lock = JSON.parse(npmLock) as {
        packages?: Record<string, { version?: unknown }>;
        dependencies?: Record<string, { version?: unknown }>;
      };
      const keys = [`${fromLock ? `${fromLock}/` : ''}node_modules/${name}`, `node_modules/${name}`];
      for (const key of keys) {
        const version = lock.packages?.[key]?.version;
        if (typeof version === 'string') return { version, lockfile: 'package-lock.json' };
      }
      const legacy = lock.dependencies?.[name]?.version;
      if (typeof legacy === 'string') return { version: legacy, lockfile: 'package-lock.json' };
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
    const entry = new RegExp(`^\\s+['"]?${escapeRegExp(name)}['"]?:\\s*$`);
    for (let index = importer + 1; importer >= 0 && index < lines.length && /^(?:\s{3,}|\s*$)/.test(lines[index]); index++) {
      if (!entry.test(lines[index])) continue;
      for (const next of lines.slice(index + 1, index + 4)) {
        const version = next.match(/^\s+version:\s*['"]?(\d+\.\d+\.\d+[^\s('"]*)/)?.[1];
        if (version) return { version, lockfile: 'pnpm-lock.yaml' };
      }
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
      if (version) return { version, lockfile: 'yarn.lock' };
    }
  }
  return undefined;
}
