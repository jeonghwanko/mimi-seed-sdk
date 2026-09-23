import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findProjectLink, linkProject, resolveLinkedAppId, validateProjectIdentity } from "../project-link.js";

let cwd: string;
beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mimi-link-"));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(cwd, { recursive: true, force: true });
});

describe("local project link", () => {
  it("stores only app identity, ignores the file in git, and reuses it", async () => {
    const fetchMock = vi.fn(async () => Response.json({ app: {
      id: "app-1", name: "Example", packageName: "com.example.app", bundleId: null,
    } }));
    vi.stubGlobal("fetch", fetchMock);
    const hint = { packageName: "com.example.app", source: [] };
    const link = await linkProject(cwd, "https://console.example.test", "test-token", hint);
    expect(link).toMatchObject({ schema: 1, appId: "app-1", packageName: "com.example.app" });
    const saved = await fs.readFile(path.join(cwd, ".mimi-seed-link.json"), "utf8");
    expect(saved).not.toContain("test-token");
    expect(await fs.readFile(path.join(cwd, ".gitignore"), "utf8")).toContain(".mimi-seed-link.json");
    expect(await findProjectLink(path.join(cwd, "subdir"))).toEqual(link);
    await linkProject(cwd, "https://console.example.test", "test-token", hint);
    expect((await fs.readFile(path.join(cwd, ".gitignore"), "utf8")).match(/\.mimi-seed-link\.json/g)).toHaveLength(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://console.example.test/api/deploy/link");
    expect(JSON.parse(String(options.body))).toEqual({ packageName: "com.example.app" });
  });

  it("rejects a different web base or explicit app before deployment", () => {
    const link = { schema: 1 as const, webBase: "https://console.example.test", appId: "app-1" };
    expect(resolveLinkedAppId(link, "https://console.example.test", undefined)).toBe("app-1");
    expect(() => resolveLinkedAppId(link, "https://other.example.test", undefined)).toThrow();
    expect(() => resolveLinkedAppId(link, "https://console.example.test", "app-2")).toThrow();
  });

  it("rejects a copied link when the detected package or bundle differs", () => {
    const link = { schema: 1 as const, webBase: "https://console.example.test", appId: "app-1",
      packageName: "com.example.app", bundleId: "com.example.ios" };
    expect(() => validateProjectIdentity(link, [{ packageName: "com.example.app", bundleId: "com.example.ios", source: [] }])).not.toThrow();
    expect(() => validateProjectIdentity(link, [{ packageName: "com.other.app", source: [] }])).toThrow();
    expect(() => validateProjectIdentity(link, [{ bundleId: "com.other.ios", source: [] }])).toThrow();
  });

  it("rejects server identity mismatches without saving a link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ app: { id: "app-1", packageName: "com.other.app" } })));
    await expect(linkProject(cwd, "https://console.example.test", "test-token", {
      packageName: "com.example.app", source: [],
    })).rejects.toThrow();
    await expect(findProjectLink(cwd)).resolves.toBeNull();
  });
});
