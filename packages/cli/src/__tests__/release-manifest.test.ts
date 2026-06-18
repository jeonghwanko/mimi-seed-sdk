import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureReleaseManifest } from "../release-manifest.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mimi-seed-release-manifest-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("ensureReleaseManifest", () => {
  it("creates docs/releases.json when missing", async () => {
    const result = await ensureReleaseManifest(tmpDir);

    expect(result.created).toBe(true);
    expect(path.relative(tmpDir, result.path)).toBe(path.join("docs", "releases.json"));

    const json = JSON.parse(await fs.readFile(result.path, "utf8"));
    expect(json).toMatchObject({
      $schema: expect.any(Object),
      versions: {},
    });
  });

  it("does not overwrite an existing manifest", async () => {
    const filePath = path.join(tmpDir, "docs", "releases.json");
    const existing = '{ "versions": { "1.0.0": { "android": "kept" } } }\n';
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, existing);

    const result = await ensureReleaseManifest(tmpDir);

    expect(result.created).toBe(false);
    expect(await fs.readFile(filePath, "utf8")).toBe(existing);
  });
});
