import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { COMMAND_SCHEMA, HOST_CALLS, SURFACE_EVENT_TYPES } from "../src/win-channel.js";

// The channel schema is the single source of truth for the Windows host
// (win-host-spec §2). These tests pin it to the code that actually speaks
// the channel: every op runtime.ts emits must be in the schema (and vice
// versa), request-lane flags must match, and the event names must match the
// drivers.ts SurfaceEvent union — so drift fails CI instead of the host.
const here = dirname(fileURLToPath(import.meta.url));
const runtimeSrc = readFileSync(join(here, "../src/runtime.ts"), "utf8");
const driversSrc = readFileSync(join(here, "../src/drivers.ts"), "utf8");

const sent = new Set([...runtimeSrc.matchAll(/\bsend\("([a-z.-]+)"/gi)].map((m) => m[1]));
const requested = new Set([...runtimeSrc.matchAll(/\brequest<[^>]*>\("([a-z.-]+)"/gi)].map((m) => m[1]));

describe("win-channel schema (single source of truth)", () => {
  it("covers every op the bridge runtime emits", () => {
    const schema = new Set(COMMAND_SCHEMA.map((c) => c.op));
    const missing = [...sent, ...requested].filter((op) => !schema.has(op));
    expect(missing).toEqual([]);
  });

  it("carries no op the runtime does not emit", () => {
    // `request` ops carry requestId through send(), so both sets count.
    const emitted = new Set([...sent, ...requested]);
    const extra = COMMAND_SCHEMA.map((c) => c.op).filter((op) => !emitted.has(op));
    expect(extra).toEqual([]);
  });

  it("request-lane flags match the runtime's request() usage", () => {
    for (const c of COMMAND_SCHEMA) {
      const isRequest = requested.has(c.op);
      expect({ op: c.op, request: !!c.request }).toEqual({ op: c.op, request: isRequest });
    }
  });

  it("surface event names match the drivers.ts SurfaceEvent union", () => {
    const union = [...driversSrc.matchAll(/type:\s*"([a-z-]+)"/g)].map((m) => m[1]);
    const inDrivers = [...new Set(union)].sort();
    expect([...SURFACE_EVENT_TYPES].sort()).toEqual(inDrivers);
  });

  it("host calls match the PrismRuntime API surface", () => {
    // every declared host call must exist as a method on PrismRuntimeApi
    for (const fn of HOST_CALLS) {
      expect(runtimeSrc, `PrismRuntimeApi is missing ${fn}()`).toMatch(new RegExp(`\\b${fn}\\(`));
    }
  });

  it("M1 ops are a subset of the schema and include the seam M1 needs", () => {
    const m1 = COMMAND_SCHEMA.filter((c) => c.m1).map((c) => c.op);
    for (const needed of [
      "surface.create", "surface.navigate", "surface.inject", "surface.freeze",
      "surface.reveal", "surface.setMuted", "surface.setRect", "store.set",
    ]) expect(m1).toContain(needed);
  });
});
