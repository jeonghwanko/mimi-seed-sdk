import fs from "node:fs/promises";
import path from "node:path";

export const RELEASE_MANIFEST_RELATIVE_PATH = path.join("docs", "releases.json");

const RELEASE_MANIFEST_TEMPLATE = {
  $schema: {
    _comment: "Mimi Seed release notes SSOT. Store notes, App Store What's New, in-app announcements, and app-version rollout metadata can share this file.",
    fields: {
      date: "ISO 8601 release/build date.",
      android: "Google Play release notes, 500 characters or fewer per locale.",
      ios: "App Store What's New, 4000 characters or fewer.",
      appVersion: {
        minVersion: "Optional minimum supported app version.",
        latestVersion: "Optional latest recommended app version.",
        android: "Optional Android override: { minVersion?, latestVersion? }.",
        ios: "Optional iOS override: { minVersion?, latestVersion? }.",
      },
      announcement: {
        title: "Optional in-app announcement title.",
        content: "Optional in-app announcement body.",
        type: "info | update | event | maintenance",
        pinned: "Optional boolean.",
      },
      highlights: "Optional internal changelog bullets.",
    },
  },
  versions: {},
};

export interface EnsureReleaseManifestResult {
  path: string;
  created: boolean;
}

export async function ensureReleaseManifest(cwd: string): Promise<EnsureReleaseManifestResult> {
  const filePath = path.join(cwd, RELEASE_MANIFEST_RELATIVE_PATH);

  try {
    await fs.access(filePath);
    return { path: filePath, created: false };
  } catch {
    // Create below.
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(RELEASE_MANIFEST_TEMPLATE, null, 2)}\n`, {
    mode: 0o644,
  });
  return { path: filePath, created: true };
}
