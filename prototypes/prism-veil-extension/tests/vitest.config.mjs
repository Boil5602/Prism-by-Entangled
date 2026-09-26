import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Run from the repo root:  npx vitest run --config prototypes/prism-veil-extension/tests/vitest.config.mjs
export default defineConfig({
  test: {
    root: here,
    environment: "happy-dom",
    include: ["**/*.test.mjs"],
  },
});
