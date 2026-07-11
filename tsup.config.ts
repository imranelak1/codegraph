import { defineConfig } from "tsup";

/**
 * Distribution build. Bundles the four surfaces to single ESM files under dist/.
 * The analyzer keeps `typescript` external (it is a real runtime dependency);
 * everything else is bundled so `node dist/cli/main.js` runs with no path games.
 */
export default defineConfig({
  entry: {
    "core/index": "src/core/index.ts",
    "analyzer/index": "src/analyzer/index.ts",
    "cli/main": "src/cli/main.ts",
    "action/run": "src/action/run.ts",
  },
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  dts: false,
  sourcemap: true,
  splitting: false,
  external: ["typescript"],
  banner: { js: "" },
});
