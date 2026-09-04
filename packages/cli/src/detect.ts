// 프로젝트 루트에서 Android applicationId / iOS bundleId / 앱 이름 감지.
// 경량 정규식 파서. 모노레포/비표준 구조는 수동 입력 폴백.

import fs from "node:fs/promises";
import path from "node:path";

export interface AppHint {
  name?: string;
  packageName?: string;
  bundleId?: string;
  source: string[];
}

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function importedJsonObjects(
  configPath: string,
  text: string,
  root: string,
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();
  const imports = [
    ...text.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+\.json)["']/g),
    ...text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']([^"']+\.json)["']\s*\)/g),
  ];
  for (const match of imports) {
    if (!match[2].startsWith(".")) continue;
    const candidate = path.resolve(path.dirname(configPath), match[2]);
    const relative = path.relative(root, candidate);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) continue;
    const jsonText = await readIfExists(candidate);
    if (!jsonText) continue;
    try {
      const json = JSON.parse(jsonText) as unknown;
      if (json && typeof json === "object" && !Array.isArray(json)) {
        result.set(match[1], json as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed imported JSON and keep the remaining static evidence.
    }
  }
  return result;
}

function importedMember(
  text: string,
  block: "android" | "ios",
  field: "package" | "bundleIdentifier",
  imports: Map<string, Record<string, unknown>>,
): string | undefined {
  const match = new RegExp(
    `\\b${block}\\s*:\\s*\\{[\\s\\S]{0,5000}?\\b${field}\\s*:\\s*([A-Za-z_$][\\w$]*)\\.([A-Za-z_$][\\w$]*)`,
  ).exec(text);
  if (!match) return undefined;
  const value = imports.get(match[1])?.[match[2]];
  return typeof value === "string" ? value : undefined;
}

async function walk(
  root: string,
  match: (name: string) => boolean,
  maxDepth = 5,
): Promise<string[]> {
  const found: string[] = [];
  const skipDirs = new Set([
    "node_modules",
    ".git",
    "build",
    "dist",
    ".next",
    ".expo",
    "Pods",
    "DerivedData",
  ]);

  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        await visit(path.join(dir, e.name), depth + 1);
      } else if (e.isFile() && match(e.name)) {
        found.push(path.join(dir, e.name));
      }
    }
  }

  await visit(root, 0);
  return found;
}

export async function detectHints(cwd: string): Promise<AppHint[]> {
  const hints: AppHint[] = [];

  // 1. app.json / app.config.json (Expo, React Native)
  for (const fname of ["app.json", "app.config.json"]) {
    const txt = await readIfExists(path.join(cwd, fname));
    if (!txt) continue;
    try {
      const json = JSON.parse(txt);
      const expo = json.expo ?? json;
      const pkg = expo?.android?.package;
      const bid = expo?.ios?.bundleIdentifier;
      const name = expo?.name;
      if (pkg || bid) {
        hints.push({
          name,
          packageName: typeof pkg === "string" ? pkg : undefined,
          bundleId: typeof bid === "string" ? bid : undefined,
          source: [fname],
        });
      }
    } catch {
      // 무시
    }
  }

  // 1b. app.config.{js,cjs,mjs,ts} — literal values and imported JSON SSOTs.
  for (const fname of ["app.config.js", "app.config.cjs", "app.config.mjs", "app.config.ts"]) {
    const configPath = path.join(cwd, fname);
    const txt = await readIfExists(configPath);
    if (!txt) continue;
    const imports = await importedJsonObjects(configPath, txt, cwd);
    const pkg = txt.match(/\bandroid\s*:\s*\{[\s\S]{0,5000}?\bpackage\s*:\s*["']([^"']+)["']/)?.[1]
      ?? importedMember(txt, "android", "package", imports);
    const bid = txt.match(/\bios\s*:\s*\{[\s\S]{0,5000}?\bbundleIdentifier\s*:\s*["']([^"']+)["']/)?.[1]
      ?? importedMember(txt, "ios", "bundleIdentifier", imports);
    if (pkg || bid) {
      hints.push({ packageName: pkg, bundleId: bid, source: [fname] });
    }
  }

  // 2. Android build.gradle(.kts) — applicationId
  const gradleFiles = await walk(
    cwd,
    (n) => n === "build.gradle" || n === "build.gradle.kts",
    4,
  );
  for (const f of gradleFiles) {
    const txt = await readIfExists(f);
    if (!txt) continue;
    const m = txt.match(/applicationId[\s=]+["']([^"']+)["']/);
    if (m?.[1]) {
      const pkg = m[1];
      if (!hints.some((h) => h.packageName === pkg)) {
        hints.push({ packageName: pkg, source: [path.relative(cwd, f)] });
      }
    }
  }

  // 3. iOS Info.plist — CFBundleIdentifier
  const plistFiles = await walk(cwd, (n) => n === "Info.plist", 5);
  for (const f of plistFiles) {
    const txt = await readIfExists(f);
    if (!txt) continue;
    const m = txt.match(
      /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/,
    );
    if (m?.[1]) {
      const bid = m[1];
      if (bid.includes("$(PRODUCT_BUNDLE_IDENTIFIER)")) continue; // 변수 참조는 pbxproj에서 해결
      if (!hints.some((h) => h.bundleId === bid)) {
        hints.push({ bundleId: bid, source: [path.relative(cwd, f)] });
      }
    }
  }

  // 4. .pbxproj — PRODUCT_BUNDLE_IDENTIFIER
  const pbxFiles = await walk(cwd, (n) => n === "project.pbxproj", 5);
  for (const f of pbxFiles) {
    const txt = await readIfExists(f);
    if (!txt) continue;
    const matches = [...txt.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)];
    for (const m of matches) {
      const bid = m[1].trim().replace(/^["']|["']$/g, "");
      if (!bid || bid.includes("$")) continue;
      if (!hints.some((h) => h.bundleId === bid)) {
        hints.push({ bundleId: bid, source: [path.relative(cwd, f)] });
      }
    }
  }

  // 5. Unity PlayerSettings — generated Gradle/Xcode projects need not exist yet.
  const unitySettings = path.join(cwd, "ProjectSettings", "ProjectSettings.asset");
  const unityText = await readIfExists(unitySettings);
  if (unityText) {
    const lines = unityText.split(/\r?\n/);
    const identifierStart = lines.findIndex((line) => /^\s*applicationIdentifier:\s*$/.test(line));
    const baseIndent = identifierStart >= 0 ? lines[identifierStart].match(/^\s*/)?.[0].length ?? 0 : 0;
    let packageName: string | undefined;
    let bundleId: string | undefined;
    if (identifierStart >= 0) {
      for (const line of lines.slice(identifierStart + 1)) {
        if (!line.trim()) continue;
        const indent = line.match(/^\s*/)?.[0].length ?? 0;
        if (indent <= baseIndent) break;
        const entry = line.match(/^\s+(Android|iPhone|iOS):\s*([^\s#]+)\s*$/);
        if (entry?.[1] === "Android") packageName = entry[2];
        if (entry && entry[1] !== "Android") bundleId = entry[2];
      }
    }
    const name = unityText.match(/^\s*productName:\s*(.+?)\s*$/m)?.[1];
    if (packageName || bundleId) {
      hints.push({
        name,
        packageName,
        bundleId,
        source: [path.relative(cwd, unitySettings)],
      });
    }
  }

  // 6. package.json — 이름 보충
  const pkgJson = await readIfExists(path.join(cwd, "package.json"));
  if (pkgJson) {
    try {
      const json = JSON.parse(pkgJson);
      if (typeof json.name === "string") {
        for (const h of hints) if (!h.name) h.name = json.name;
      }
    } catch {
      // 무시
    }
  }

  // Android/iOS 각각 있는데 이름/패키지 모양이 비슷하면 합치기
  const merged: AppHint[] = [];
  const androidOnly = hints.filter((h) => h.packageName && !h.bundleId);
  const iosOnly = hints.filter((h) => h.bundleId && !h.packageName);
  const both = hints.filter((h) => h.packageName && h.bundleId);

  merged.push(...both);
  for (const a of androidOnly) {
    const match = iosOnly.find((i) => i.bundleId === a.packageName);
    if (match) {
      merged.push({
        name: a.name ?? match.name,
        packageName: a.packageName,
        bundleId: match.bundleId,
        source: [...a.source, ...match.source],
      });
    } else {
      merged.push(a);
    }
  }
  for (const i of iosOnly) {
    if (!androidOnly.some((a) => a.packageName === i.bundleId)) {
      merged.push(i);
    }
  }

  // 존재는 하지만 빈 껍데기인 경우는 제외
  return merged.filter((h) => h.packageName || h.bundleId);
}

export async function hasAnyProjectSignal(cwd: string): Promise<boolean> {
  return (
    (await pathExists(path.join(cwd, "package.json"))) ||
    (await pathExists(path.join(cwd, "app.json"))) ||
    (await pathExists(path.join(cwd, "android"))) ||
    (await pathExists(path.join(cwd, "ios"))) ||
    (await pathExists(path.join(cwd, "ProjectSettings", "ProjectSettings.asset")))
  );
}
