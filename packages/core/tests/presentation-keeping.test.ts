/**
 * Presentation keeping (dashboard-schema §26) - the verifier's fixture set in
 * tests/fixtures/presentation-keeping/*.json (SM-5), run against SM-1's
 * machine (src/presentation-keeper.ts: pure `step(state, event, config)`).
 * Skips while that module is absent so the suite stays green before SM-1
 * lands; scripts/verify.mjs reports the same fixtures as NOT-YET until then.
 *
 * Event mapping (SHAPE.json `contract.fixtureMapping`): {kind,t} -> {type,at};
 * input -> user-input; intermission -> ad-break; playing -> tick; the
 * fixture's `cause` is documentation - the machine infers it. Actions get
 * `t` = the `at` of the event that produced them.
 *
 * The invariants (I1-I4 in SHAPE.json) are enforced by
 * scripts/verify-presentation-fixtures.mjs; this test checks the expected
 * action lists so a regression shows up in the ordinary vitest run.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "fixtures", "presentation-keeping");
const modulePath = join(here, "..", "src", "presentation-keeper.ts");

interface FixtureEvent { t: number; kind: string; state?: string; active?: boolean; key?: string; cause?: string }
interface Fixture {
  name: string;
  spec: string;
  facet: { id: string; keepPresentation: boolean; onEnd: "none" | "restart" | "restart-fullscreen" };
  options?: { inputWindowMs?: number };
  events: FixtureEvent[];
  expect: { actions: Array<{ t: number; action: string; facet: string }>; toleranceMs?: number };
  contestable?: boolean;
}
interface Emitted { t: number; action: string; facet: string; reason?: string }

const fixtures: Fixture[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "SHAPE.json")
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture);

function toKeeperEvent(ev: FixtureEvent): Record<string, unknown> {
  const at = ev.t;
  switch (ev.kind) {
    case "input": return { type: "user-input", at };
    case "presentation": return { type: "presentation", at, state: ev.state };
    case "ad-break":
    case "intermission": return { type: "ad-break", at, active: ev.active };
    case "ended": return { type: "ended", at };
    default: return { type: "tick", at };
  }
}

describe("presentation keeping fixtures (§26)", () => {
  it("fixture set is present and well-formed", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
    for (const fx of fixtures) {
      expect(typeof fx.facet.keepPresentation).toBe("boolean");
      expect(["none", "restart", "restart-fullscreen"]).toContain(fx.facet.onEnd);
      expect(Array.isArray(fx.expect.actions)).toBe(true);
    }
  });

  describe.skipIf(!existsSync(modulePath))("against src/presentation-keeper.ts", () => {
    for (const fx of fixtures) {
      it(`${fx.name}${fx.contestable ? " (contestable)" : ""} - ${fx.spec.slice(0, 80)}`, async () => {
        const mod = (await import(/* @vite-ignore */ pathToFileURL(modulePath).href)) as {
          step: (s: unknown, e: unknown, c: unknown) => { state: unknown; actions: Array<{ kind: string; reason: string }> };
          initialKeeperState: () => unknown;
          keeperConfig?: (s: Fixture["facet"]) => unknown;
        };
        expect(typeof mod.step, "presentation-keeper exports step").toBe("function");
        const config = mod.keeperConfig ? mod.keeperConfig(fx.facet) : { keepPresentation: fx.facet.keepPresentation, onEnd: fx.facet.onEnd };
        let state = mod.initialKeeperState();
        const got: Emitted[] = [];
        for (const ev of fx.events) {
          const r = mod.step(state, toKeeperEvent(ev), config);
          state = r.state;
          for (const a of r.actions) got.push({ t: ev.t, action: a.kind, facet: fx.facet.id, reason: a.reason });
        }
        const tol = fx.expect.toleranceMs ?? 0;
        expect(got.length, `actions: ${JSON.stringify(got)}`).toBe(fx.expect.actions.length);
        fx.expect.actions.forEach((e, i) => {
          expect(got[i]!.action).toBe(e.action);
          expect(got[i]!.facet).toBe(e.facet);
          expect(Math.abs(got[i]!.t - e.t)).toBeLessThanOrEqual(tol);
        });
      });
    }
  });
});
