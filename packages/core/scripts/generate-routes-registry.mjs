/**
 * Writes packages/core/routes.registry.json from src/routes.ts (via the dist
 * build) — the `prism://` route registry scripts/walk-test-6a.mjs checks the
 * scene-model-spec §6a reach counts against. Run after `npm run build`:
 *   npm run routes:generate
 * tests/routes.test.ts fails when the committed file differs from the source.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist", "routes.js");
const outPath = join(here, "..", "routes.registry.json");

const { routeRegistry } = await import(pathToFileURL(dist).href);
const reg = routeRegistry();
writeFileSync(outPath, JSON.stringify(reg, null, 2) + "\n");
console.log(`wrote ${reg.routes.length} routes, ${reg.reach.length} reach entries to ${outPath}`);
