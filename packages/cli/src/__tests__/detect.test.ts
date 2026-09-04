import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectHints, hasAnyProjectSignal } from "../detect.js";

const roots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mimi-detect-"));
  roots.push(root);
  await Promise.all(Object.entries(files).map(async ([relative, text]) => {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("app detection", () => {
  it("동적 Expo 설정이 import한 JSON 식별자를 감지한다", async () => {
    const root = await fixture({
      "app.config.ts": [
        'import product from "./product.config.json";',
        "export default {",
        "  ios: { bundleIdentifier: product.iosBundleIdentifier },",
        "  android: { package: product.androidPackage },",
        "};",
      ].join("\n"),
      "product.config.json": JSON.stringify({
        androidPackage: "com.example.dynamic",
        iosBundleIdentifier: "com.example.dynamic.ios",
      }),
    });

    expect(await detectHints(root)).toContainEqual(expect.objectContaining({
      packageName: "com.example.dynamic",
      bundleId: "com.example.dynamic.ios",
    }));
  });

  it("Unity ProjectSettings를 앱 신호와 식별자 SSOT로 사용한다", async () => {
    const root = await fixture({
      "ProjectSettings/ProjectSettings.asset": [
        "PlayerSettings:",
        "  productName: Example Unity",
        "  applicationIdentifier:",
        "    Android: com.example.unity",
        "    iPhone: com.example.unity.ios",
        "  someOtherMap:",
        "    Android: 1",
        "    iOS: 0",
      ].join("\n"),
    });

    expect(await hasAnyProjectSignal(root)).toBe(true);
    expect(await detectHints(root)).toContainEqual(expect.objectContaining({
      name: "Example Unity",
      packageName: "com.example.unity",
      bundleId: "com.example.unity.ios",
      source: [expect.stringMatching(/^ProjectSettings[\\/]ProjectSettings\.asset$/)],
    }));
  });
});
