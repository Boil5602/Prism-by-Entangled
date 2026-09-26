import { describe, expect, it } from "vitest";
import { isPlayOrder, orderTracks, playOrderLabel } from "../src/play-order.js";

/** Play orders (2026-09-17, spec 32 layer 5): true shuffle is a uniform permutation, reverse is the list backwards. */
describe("orderTracks", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  it("keeps the service's order for normal and shuffle, and reverses for reverse", () => {
    expect(orderTracks(ids, "normal")).toEqual(ids);
    expect(orderTracks(ids, "shuffle")).toEqual(ids);
    expect(orderTracks(ids, "reverse")).toEqual(["h", "g", "f", "e", "d", "c", "b", "a"]);
    expect(orderTracks([], "reverse")).toEqual([]);
  });
  it("true shuffle plays every track exactly once, never touches the input, and is a different order across draws", () => {
    const copy = ids.slice();
    const one = orderTracks(ids, "true-shuffle");
    expect(ids).toEqual(copy);
    expect(one.slice().sort()).toEqual(ids.slice().sort());
    let differs = false;
    for (let i = 0; i < 20 && !differs; i++) if (orderTracks(ids, "true-shuffle").join() !== one.join()) differs = true;
    expect(differs).toBe(true);
  });
  it("is uniform: with a stand-in source every permutation of three comes up about equally", () => {
    let seed = 12345;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const seen = new Map<string, number>();
    for (let i = 0; i < 6000; i++) { const k = orderTracks(["x", "y", "z"], "true-shuffle", rand).join(""); seen.set(k, (seen.get(k) ?? 0) + 1); }
    expect(seen.size).toBe(6);
    for (const n of seen.values()) { expect(n).toBeGreaterThan(800); expect(n).toBeLessThan(1200); }
  });
  it("names the orders for a wall and recognizes them", () => {
    expect(playOrderLabel("true-shuffle")).toBe("true shuffle");
    expect(playOrderLabel("reverse")).toBe("in reverse");
    expect(isPlayOrder("reverse")).toBe(true);
    expect(isPlayOrder("random")).toBe(false);
  });
});
