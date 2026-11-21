import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // Keep the SDK out of the bundle so `check` / `--version` do not load it.
  // Listed even if the package is only an optionalDependency.
  external: ["@anthropic-ai/sdk"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
