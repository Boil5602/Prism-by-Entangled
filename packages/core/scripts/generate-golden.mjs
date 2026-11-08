/**
 * Regenerates tests/golden/solver-fixtures.json from the VERBATIM prototype
 * solver (tests/reference-solver.mjs). The fixtures are the portable
 * conformance artifact: any port on any platform must reproduce these rects
 * exactly for these inputs. Run: npm run golden:generate
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { solveHero } from "../tests/reference-solver.mjs";
import { buildCases } from "../tests/fixture-cases.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "tests", "golden", "solver-fixtures.json");

const cases = buildCases().map((c) => ({
  ...c,
  rects: solveHero(c.tiles, c.heroId, c.heroSize, c.W, c.H),
}));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify({ generator: "reference-solver.mjs (verbatim prototype)", cases }, null, 2) + "\n",
);
console.log(`wrote ${cases.length} fixtures to ${outPath}`);
