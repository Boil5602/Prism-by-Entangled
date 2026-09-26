import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  // Relative base so the built app also works from file:// and any subpath.
  base: "./",
  resolve: {
    alias: {
      "prism-core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
});
