// The report panel's categories (2026-11-12): every value the panel can send is one the reports server keeps.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, "..", "src", "report.js"), "utf8");
const server = readFileSync(join(here, "..", "..", "prism-veil-reports", "server.mjs"), "utf8");

describe("the report panel's categories", () => {
  it("are all on the server's list, with no value twice", () => {
    const block = panel.slice(panel.indexOf("var AD_KINDS = ["), panel.indexOf("PV.reportKinds"));
    const sent = [...block.matchAll(/\["([a-z-]+)", "[^"]+"\]/g)].map((m) => m[1]);
    const kept = JSON.parse(server.match(/kind: (\[[^\]]+\])\.includes\(r\.kind\)/)[1]);
    expect(sent.length).toBeGreaterThan(8);
    expect(new Set(sent).size).toBe(sent.length);
    for (const k of sent) expect(kept).toContain(k);
    expect(sent).toContain("small-view");
  });
});
