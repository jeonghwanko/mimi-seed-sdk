// Release Doctor resolution of `apply from:` Gradle scripts (workspace packages, node_modules, globs).
// Internal to Release Doctor — import the public API (scanReleaseDoctor, report types) from ../release-doctor.js.

import fs from 'node:fs/promises';
import path from 'node:path';
import { blankComments, maskStrings, stripGradleComments } from '../gradle-text.js';
import { readText } from '../lockfile.js';
import { EXCLUDED_EVIDENCE_DIRS, SAMPLE_ONLY_DIRS, TEST_TARGET_DIR } from './files.js';
import type { ProjectFile } from './types.js';
import { escapeRegExp, isWithin, packageDir, statementEnd } from './util.js';

/** The `apply from:` arguments of a script, as written (`"$rootDir/gradle/x.gradle"`, `rootProject.file("x")`). */
function applyFromReferences(text: string): string[] {
  const masked = maskStrings(text);
  const code = blankComments(text);
  return [...masked.matchAll(/\bapply\s*\(?\s*from\s*[:=]\s*/g)].map((match) => {
    const start = match.index + match[0].length;
    const raw = code.slice(start, statementEnd(masked, start)).trim();
    // `apply from: 'x.gradle', to: buildscript`: only the first argument is the script.
    return raw.match(/^(["'])[^"'\n]*\1(?=\s*,)/)?.[0] ?? raw;
  });
}

/** A path through a node_modules/ folder: a third-party package's file. */
function inNodeModules(file: string): boolean {
  return /(?:^|[\\/])node_modules[\\/]/.test(file);
}

/** How an `apply from:` argument resolved. */
interface AppliedScriptResolution {
  /** The readable file it names. */
  absolute?: string;
  /** The script belongs to a third-party package (read when it resolves, otherwise only noted). */
  thirdParty: boolean;
  /** Why it was not read. */
  reason?: string;
  /** The package folder is missing: installing the JavaScript dependencies would make it readable. */
  installHint?: boolean;
}

interface ApplyContext {
  /** The applying project's directory (relative paths resolve against it). */
  projectDir: string;
  /** The directory of the script that contains the `apply from:` (for `buildscript.sourceFile`). */
  scriptDir: string;
  limit: string;
  known: ProjectFile[];
}

/** Whether a file exists (known to the walk or readable). */
async function exists(absolute: string, known: ProjectFile[]): Promise<boolean> {
  return known.some((candidate) => candidate.absolute === absolute) || await readText(absolute) !== undefined;
}

/** A resolved file path's outcome: read it, or say why not (third-party when it is inside node_modules/). */
async function resolvedPath(candidates: string[], context: ApplyContext, thirdParty = false): Promise<AppliedScriptResolution> {
  for (const absolute of candidates) {
    if (!isWithin(context.limit, absolute)) continue;
    if (!await exists(absolute, context.known)) continue;
    // A package linked into node_modules/ from a local folder (yarn / pnpm / npm workspaces, `link:`) is local code,
    // even when the folder lies outside the scanned path. Only node_modules paths are resolved: a scan root reached
    // through a symlink (or macOS /tmp → /private/tmp) keeps every other path as the walk saw it.
    if (inNodeModules(absolute)) {
      const real = await fs.realpath(absolute).catch(() => absolute);
      if (!inNodeModules(real)) {
        // Back in the walk's coordinates: under the nearest ancestor of the scan limit whose real path holds it.
        for (let directory = context.limit; ; directory = path.dirname(directory)) {
          const realDirectory = await fs.realpath(directory).catch(() => directory);
          if (isWithin(realDirectory, real)) return { absolute: path.join(directory, path.relative(realDirectory, real)), thirdParty: false };
          if (path.dirname(directory) === directory) return { absolute: real, thirdParty: false };
        }
      }
    }
    return { absolute, thirdParty: thirdParty || inNodeModules(absolute) };
  }
  const first = candidates.find((candidate) => isWithin(context.limit, candidate)) ?? candidates[0];
  const external = thirdParty || (first !== undefined && inNodeModules(first));
  if (!external) return { thirdParty: false };
  const pkg = first === undefined ? undefined : packageDir(first);
  // Not installed, but the package is the repository's own (a workspace package, or a `file:` / `link:` /
  // `portal:` / `workspace:` dependency): read the file from its folder in the repository, or leave it unresolved.
  if (first !== undefined && pkg !== undefined) {
    const workspace = await workspacePackage(pkg.replace(/^.*[\\/]node_modules[\\/]/, '').replace(/\\/g, '/'), context);
    if (workspace === null) return { thirdParty: false };
    if (workspace !== undefined) {
      const mapped = path.join(workspace, path.relative(pkg, first));
      return isWithin(context.limit, mapped) && await exists(mapped, context.known) ? { absolute: mapped, thirdParty: false } : { thirdParty: false };
    }
  }
  const installed = pkg !== undefined && await readText(path.join(pkg, 'package.json')) !== undefined;
  return installed
    ? { thirdParty: true, reason: 'not in the installed package' }
    : { thirdParty: true, reason: 'its package is not installed', installHint: pkg !== undefined };
}

/** Bounds of a workspace glob expansion: at most this many directories are examined, to this depth. */
const MAX_GLOB_DIRECTORIES = 2000;

const MAX_GLOB_DEPTH = 12;

/**
 * The folders a workspace glob names below `base`: `packages/*`, `apps/*\/mobile`, `packages/**` (any depth,
 * node_modules and dot folders skipped), `packages/**\/native`, or a plain path. Breadth-first, so nearer packages
 * are never crowded out by a deep sibling; a literal segment counts only when that folder exists. `capped` is true
 * when the expansion stopped at its bounds (the list may be incomplete).
 */
async function expandWorkspaceGlob(base: string, glob: string): Promise<{ dirs: string[]; capped: boolean }> {
  const segments = glob.replace(/^\.\//, '').replace(/\/+$/, '').split('/').filter(Boolean);
  let capped = false;
  let examined = 0;
  const isDirectory = (dir: string) => fs.stat(dir).then((stat) => stat.isDirectory(), () => false);
  const subdirectories = async (dir: string) => {
    examined++;
    return fs.readdir(dir, { withFileTypes: true })
      .then((entries) => entries.filter((entry) => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
        .map((entry) => entry.name).sort())
      .catch(() => [] as string[]);
  };
  // Frontier of [directory, next segment index, depth]; processed level by level (breadth-first).
  let frontier: Array<[string, number, number]> = [[base, 0, 0]];
  const result: string[] = [];
  while (frontier.length > 0) {
    const next: Array<[string, number, number]> = [];
    for (const [dir, index, depth] of frontier) {
      if (examined >= MAX_GLOB_DIRECTORIES || result.length >= MAX_GLOB_DIRECTORIES) {
        capped = true;
        continue;
      }
      if (index === segments.length) {
        result.push(dir);
        continue;
      }
      const segment = segments[index];
      if (segment === '**') {
        next.push([dir, index + 1, depth]);
        const children = await subdirectories(dir);
        if (depth >= MAX_GLOB_DEPTH) {
          if (children.length > 0) capped = true;
          continue;
        }
        for (const child of children) next.push([path.join(dir, child), index, depth + 1]);
      } else if (segment.includes('*')) {
        const pattern = new RegExp(`^${segment.split('*').map(escapeRegExp).join('[^/]*')}$`);
        for (const child of await subdirectories(dir)) if (pattern.test(child)) next.push([path.join(dir, child), index + 1, depth + 1]);
      } else {
        const literal = path.join(dir, segment);
        if (await isDirectory(literal)) next.push([literal, index + 1, depth + 1]);
      }
    }
    frontier = next;
  }
  return { dirs: result, capped };
}

/**
 * The repository folder of a JavaScript package named `name`, when the repository itself provides it: a package.json
 * outside node_modules/ with that name (in the scan, or matched by the root's `workspaces` / pnpm-workspace.yaml
 * globs), or a `file:` / `link:` / `portal:` dependency spec. Null when a dependency spec says the package is the
 * repository's own (`workspace:`) but its folder cannot be found; undefined for an ordinary third-party package.
 */
async function workspacePackage(name: string, context: ApplyContext): Promise<string | null | undefined> {
  // A glob expansion that hit its bounds may have missed the package: then it is unresolved, not third-party.
  let capped = false;
  // `declared`: a member a workspace glob names, trusted wherever it lives.
  const manifests: Array<{ dir: string; json: Record<string, unknown>; declared?: boolean }> = [];
  const parse = (text: string | undefined) => {
    try {
      return text === undefined ? undefined : JSON.parse(text) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  };
  // Test fixtures, samples, and vendored trees may hold a package.json with the same name: never the package.
  const excludedTree = (dir: string) => path.relative(context.limit, dir).split(path.sep)
    .some((segment) => EXCLUDED_EVIDENCE_DIRS.has(segment) || SAMPLE_ONLY_DIRS.has(segment) || TEST_TARGET_DIR.test(segment) || segment === 'node_modules');
  for (const file of context.known) {
    if (path.posix.basename(file.relative) !== 'package.json' || inNodeModules(file.absolute)) continue;
    const json = parse(file.text);
    if (json) manifests.push({ dir: path.dirname(file.absolute), json });
  }
  // Workspace roots above the scanned folder (a `--path` scan of one app in a monorepo).
  for (const directory of ancestorsUpTo(context.projectDir, context.limit)) {
    const json = parse(await readText(path.join(directory, 'package.json')));
    const pnpm = await readText(path.join(directory, 'pnpm-workspace.yaml'));
    if (json && !manifests.some((manifest) => manifest.dir === directory)) manifests.push({ dir: directory, json });
    const globs = [
      ...(Array.isArray(json?.workspaces) ? json.workspaces as unknown[] : []),
      ...(Array.isArray((json?.workspaces as { packages?: unknown } | undefined)?.packages) ? (json!.workspaces as { packages: unknown[] }).packages : []),
      ...[...(pnpm ?? '').matchAll(/^\s*-\s*["']?([^"'\n#]+?)["']?\s*$/gm)].map((match) => match[1]),
    ].filter((glob): glob is string => typeof glob === 'string' && !glob.startsWith('!'));
    for (const glob of globs) {
      const expanded = await expandWorkspaceGlob(directory, glob);
      if (expanded.capped) capped = true;
      for (const dir of expanded.dirs) {
        const known = manifests.find((manifest) => manifest.dir === dir);
        if (known) {
          known.declared = true;
          continue;
        }
        const member = parse(await readText(path.join(dir, 'package.json')));
        if (member) manifests.push({ dir, json: member, declared: true });
      }
    }
  }
  const own = manifests.find((manifest) => manifest.json.name === name && isWithin(context.limit, manifest.dir)
    && (manifest.declared || !excludedTree(manifest.dir)));
  if (own) return own.dir;
  for (const manifest of manifests) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const spec = (manifest.json[field] as Record<string, unknown> | undefined)?.[name];
      if (typeof spec !== 'string') continue;
      const local = spec.match(/^(?:file|link|portal):(.+)$/)?.[1];
      if (local) {
        const target = path.resolve(manifest.dir, local);
        const stat = await fs.stat(target).catch(() => undefined);
        // A folder is the package; a packed tarball (`file:vendor/pkg-1.0.0.tgz`) installs like a registry package.
        if (stat?.isDirectory()) return target;
        if (stat) continue;
        // A missing folder (an uninitialised submodule): the repository's own package, unreadable — unless it lies
        // outside the repository or names a tarball.
        if (isWithin(context.limit, target) && !/\.(?:tgz|tar|tar\.gz)$/i.test(target)) return null;
        continue;
      }
      if (spec.startsWith('workspace:')) return null;
    }
  }
  return capped ? null : undefined;
}

/**
 * The Gradle project directory `:name` maps to: a settings `project(':name').projectDir = new File(rootProject.projectDir,
 * '…')` / `file('…')`, otherwise React Native autolinking's `node_modules/<name>/android` when present, otherwise the
 * default `<settings dir>/<name>`. Third-party when it lies in node_modules/ or names a package.json dependency.
 */
async function projectDirectory(name: string, context: ApplyContext): Promise<{ dir?: string; thirdParty: boolean }> {
  const settingsFiles = context.known.filter((file) => /(?:^|\/)settings\.gradle(?:\.kts)?$/.test(file.relative)
    && isWithin(path.dirname(file.absolute), context.projectDir))
    .sort((left, right) => right.absolute.length - left.absolute.length);
  const settingsDir = settingsFiles[0] ? path.dirname(settingsFiles[0].absolute) : context.projectDir;
  const quoted = escapeRegExp(name);
  for (const settings of settingsFiles) {
    const code = stripGradleComments(settings.text);
    const mapping = code.match(new RegExp(`project\\(\\s*["']:${quoted}["']\\s*\\)\\.projectDir\\s*=\\s*(?:new\\s+File\\(\\s*(?:rootProject\\.projectDir|settingsDir|rootDir)\\s*,\\s*["']([^"'$]+)["']\\s*\\)|file\\(\\s*["']([^"'$]+)["']\\s*\\))`));
    if (mapping) {
      const dir = path.resolve(path.dirname(settings.absolute), mapping[1] ?? mapping[2]);
      return { dir, thirdParty: inNodeModules(dir) };
    }
  }
  // A project the settings include by name, without a mapping, lives in its default folder (a repository module that
  // happens to share an npm package's name).
  // …only when that folder exists and no settings script assigns the project a folder in a form not parsed above
  // (`project(':x').projectDir = new File(nodeModules, 'x/android')`): then the package lookup below decides.
  const included = settingsFiles.some((settings) => new RegExp(`\\binclude\\b[^\\n]*["']:${quoted}["']`).test(stripGradleComments(settings.text)));
  const assignment = settingsFiles.map((settings) => stripGradleComments(settings.text)
    .match(new RegExp(`project\\(\\s*["']:${quoted}["']\\s*\\)\\.projectDir\\s*=[^\\n;]*`))?.[0]).find(Boolean);
  const assigned = assignment !== undefined;
  // An assignment not parsed above that does not point into node_modules (`new File(modulesDir, 'x')`) names a
  // repository folder the scanner cannot compute: unresolved, never an npm package of the same name.
  if (assigned && !/node_?modules|nodemodule/i.test(assignment)) return { thirdParty: false };
  const defaultDir = path.join(settingsDir, ...name.split(':'));
  if (included && !assigned && await fs.stat(defaultDir).then((stat) => stat.isDirectory(), () => false)) return { dir: defaultDir, thirdParty: false };
  // React Native names an autolinked `@scope/pkg` project `:scope_pkg`.
  const packageNames = [name, ...(/^([^_]+)_(.+)$/.test(name) ? [name.replace(/^([^_]+)_(.+)$/, '@$1/$2')] : [])];
  for (const directory of ancestorsUpTo(context.projectDir, context.limit)) {
    for (const packageName of packageNames) {
      if (await readText(path.join(directory, 'node_modules', packageName, 'package.json')) !== undefined) {
        return { dir: path.join(directory, 'node_modules', packageName, 'android'), thirdParty: true };
      }
    }
  }
  const dependency = packageNames.find((packageName) => context.known.some((file) => path.posix.basename(file.relative) === 'package.json'
    && new RegExp(`"(?:dependencies|devDependencies)"\\s*:\\s*\\{[^}]*"${escapeRegExp(packageName)}"\\s*:`).test(file.text)));
  return dependency
    ? { dir: path.join(settingsDir, '..', 'node_modules', dependency, 'android'), thirdParty: true }
    : { dir: path.join(settingsDir, ...name.split(':')), thirdParty: false };
}

/**
 * The file an `apply from:` argument names. Repository paths: a literal path (relative to the applying project's
 * directory, or rooted with `$rootDir` / `${rootProject.projectDir}` / `$projectDir`), `file("…")`,
 * `project.file("…")`, `rootProject.file("…")`, `new File(rootDir, "…")`. Third-party package scripts (React
 * Native): a path through node_modules/, `project(':pkg').projectDir…` (react-native-config's `dotenv.gradle`),
 * `new File(buildscript.sourceFile.parentFile, "…")` relative to the applying script (@sentry/react-native 8's
 * `sentry.gradle.kts` shim), and Expo's `new File(["node", "--print", "require.resolve('…')"].execute(…).text.trim(),
 * "…")`. Without a file: a repository reference (a URL, another computed path, a missing file, one outside the
 * repository) is unresolved; a third-party one comes with the reason it was not read.
 */
async function appliedScriptPath(reference: string, context: ApplyContext): Promise<AppliedScriptResolution> {
  const literal = (value: string) => value.match(/^(["'])([^"'\n]*)\1$/)?.[2];
  const fromScript = inNodeModules(context.scriptDir);

  // Expo bare templates: the folder comes from running node.
  const nodeResolve = reference.match(/\bnode\b[\s\S]*--print[\s\S]*require\.resolve\(\s*\\?["']([^"'\\]+)\\?["']/);
  if (nodeResolve && /\.execute\(/.test(reference)) {
    const child = reference.match(/,\s*(["'])([^"'\n]+)\1\s*\)\s*$/)?.[2] ?? '';
    const candidates = ancestorsUpTo(context.projectDir, context.limit)
      .map((directory) => path.resolve(path.join(directory, 'node_modules', nodeResolve[1]), child));
    const resolution = await resolvedPath(candidates, context, true);
    return resolution.absolute ? resolution : { ...resolution, reason: `${resolution.reason ?? 'not found'} (the path is computed by running node)` };
  }

  // `new File(buildscript.sourceFile.parentFile, "x")`, `"${buildscript.sourceFile.parent}/x"`.
  const sourceRelative = reference.match(/^new\s+File\(\s*buildscript\.sourceFile\.parentFile\s*,\s*(["'])([^"'$\n]+)\1\s*\)$/)?.[2]
    ?? reference.match(/^(["'])\$\{buildscript\.sourceFile\.parent(?:File)?\}\/([^"'$\n]+)\1$/)?.[2];
  if (sourceRelative !== undefined) return resolvedPath([path.resolve(context.scriptDir, sourceRelative)], context, fromScript);

  // `project(':pkg').projectDir.getPath() + "/x"`, `"${project(':pkg').projectDir}/x"`, `new File(project(':pkg').projectDir, "x")`.
  const projectForms: Array<[RegExp, number, number]> = [
    [/^project\(\s*["']:([^"']+)["']\s*\)\.projectDir(?:\.getPath\(\)|\.path|\.absolutePath)?\s*\+\s*(["'])\/?([^"'$\n]+)\2$/, 1, 3],
    [/^(["'])\$\{project\(\s*["']:([^"']+)["']\s*\)\.projectDir\}\/([^"'$\n]+)\1$/, 2, 3],
    [/^new\s+File\(\s*project\(\s*["']:([^"']+)["']\s*\)\.projectDir\s*,\s*(["'])([^"'$\n]+)\2\s*\)$/, 1, 3],
  ];
  for (const [form, nameGroup, fileGroup] of projectForms) {
    const match = reference.match(form);
    if (!match) continue;
    const project = await projectDirectory(match[nameGroup], context);
    if (project.dir === undefined) return { thirdParty: fromScript, reason: 'the project folder is computed' };
    return resolvedPath([path.resolve(project.dir, match[fileGroup])], context, project.thirdParty || fromScript);
  }

  let target = literal(reference);
  const call = reference.match(/^(rootProject\.|project\.)?file\(\s*(.+?)\s*\)$/);
  if (target === undefined && call) {
    const inner = literal(call[2]);
    if (inner !== undefined) target = call[1] === 'rootProject.' && !inner.startsWith('$') ? `$rootDir/${inner}` : inner;
  }
  const rootFile = reference.match(/^new\s+File\(\s*(?:rootDir|rootProject\.(?:rootDir|projectDir))\s*,\s*(.+?)\s*\)$/);
  if (target === undefined && rootFile && literal(rootFile[1]) !== undefined) target = `$rootDir/${literal(rootFile[1])}`;
  const computed = { thirdParty: fromScript || inNodeModules(reference), reason: 'the path is computed' };
  if (target === undefined || /^[a-z][a-z0-9+.-]*:/i.test(target)) return computed;
  const rooted = target.match(/^\$\{?(?:rootDir|rootProject\.(?:projectDir|rootDir)|project\.rootDir)\}?\/(.+)$/);
  const projectDirRelative = target.match(/^\$\{?(?:projectDir|project\.projectDir)\}?\/(.+)$/);
  if (!rooted && !projectDirRelative && target.includes('$')) return computed;
  const candidates = rooted
    ? ancestorsUpTo(context.projectDir, context.limit).map((directory) => path.join(directory, rooted[1]))
    : [path.resolve(context.projectDir, projectDirRelative ? projectDirRelative[1] : target)];
  return resolvedPath(candidates, context, fromScript);
}

/**
 * Scripts the given Gradle files pull in with `apply from:`, followed transitively (a script applied by an applied
 * script runs in the same project), whatever their extension (`.gradle`, `.gradle.kts`, `.groovy`). Values set in a
 * shared `common.gradle` count for every module that applies it. A repository reference that cannot be followed — a
 * URL, a computed path, a missing file, a file outside the repository — is added to `missed`; a third-party package
 * script that cannot be read (like a binary plugin, which is never read either) is added to `notes` with the reason.
 */
export async function appliedGradleScripts(
  gradleFiles: ProjectFile[],
  root: string,
  limit: string,
  known: ProjectFile[],
  missed?: string[],
  notes?: Array<{ reference: string; reason: string; installHint: boolean }>,
): Promise<ProjectFile[]> {
  const result: ProjectFile[] = [];
  const seen = new Set(gradleFiles.map((file) => file.absolute));
  const queue = gradleFiles
    .filter((candidate) => /\.gradle(?:\.kts)?$/.test(candidate.relative))
    .map((file) => ({ file, projectDir: path.dirname(file.absolute) }));
  for (let next = queue.shift(); next; next = queue.shift()) {
    const { file, projectDir } = next;
    for (const reference of applyFromReferences(file.text)) {
      const resolution = await appliedScriptPath(reference, { projectDir, scriptDir: path.dirname(file.absolute), limit, known });
      const absolute = resolution.absolute;
      if (!absolute) {
        if (resolution.thirdParty) {
          notes?.push({ reference: `apply from: ${reference} (${file.relative})`, reason: resolution.reason ?? 'not readable', installHint: Boolean(resolution.installHint) });
        } else {
          missed?.push(`apply from: ${reference} (${file.relative})`);
        }
        continue;
      }
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      const existing = known.find((candidate) => candidate.absolute === absolute);
      const text = existing?.text ?? await readText(absolute);
      if (text === undefined) continue;
      const applied: ProjectFile = existing
        ? { ...existing, text: stripGradleComments(text) }
        : { absolute, relative: path.relative(root, absolute).replace(/\\/g, '/'), text: stripGradleComments(text), outside: !isWithin(root, absolute) };
      result.push(applied);
      queue.push({ file: applied, projectDir });
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
export async function repositoryRootFiles(root: string, repo: string): Promise<ProjectFile[]> {
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
