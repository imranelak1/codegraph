import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Fixtures contain intentionally-broken imports; never let vitest scan them.
    exclude: ["node_modules/**", "dist/**", "fixtures/**", "apps/web/**"],
  },
});
