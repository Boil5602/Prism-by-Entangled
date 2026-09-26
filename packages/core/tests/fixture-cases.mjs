/**
 * Shared fixture-case enumeration, used by both the golden generator
 * (scripts/generate-golden.mjs) and the solver tests. Deterministic — no
 * randomness, so the fixture file is stable across runs.
 *
 * Canvas convention matches the editor prototype: W is fixed at 1000 for
 * landscape devices and H derived from the device aspect (and vice versa for
 * portrait, where W = 1000 and H = 1000·h/w still applies — the prototype
 * always fixes W at 1000).
 */

// Tile palette lifted from the prototype's TILE_TYPES (hint, weight).
export const PALETTE = [
  { id: "youtube",  hint: 16 / 9, weight: 1.0 },
  { id: "calendar", hint: 3 / 4,  weight: 0.6 },
  { id: "radio",    hint: 4 / 3,  weight: 0.2 },
  { id: "photos",   hint: 3 / 2,  weight: 0.8 },
  { id: "weather",  hint: 1,      weight: 0.5 },
  { id: "notes",    hint: 3 / 4,  weight: 0.5 },
  { id: "ticker",   hint: 8,      weight: 0.9 },
];

export const DEVICES = [
  { id: "tablet",   w: 16, h: 10 },
  { id: "tv",       w: 16, h: 9 },
  { id: "portrait", w: 9,  h: 16 },
  { id: "monitor",  w: 4,  h: 3 },
];

export const HERO_SIZES = [0.3, 0.5, 0.62, 0.85];

export function buildCases() {
  const cases = [];
  const add = (name, tiles, heroId, heroSize, device) => {
    const W = 1000;
    const H = (1000 * device.h) / device.w;
    cases.push({ name, tiles, heroId, heroSize, W, H, device: device.id });
  };

  // Sweep: every device × tile-count 1..7 (palette prefix) × hero sizes,
  // hero = first tile.
  for (const device of DEVICES) {
    for (let n = 1; n <= PALETTE.length; n++) {
      const tiles = PALETTE.slice(0, n);
      for (const hs of HERO_SIZES) {
        add(`sweep/${device.id}/n${n}/hs${hs}`, tiles, tiles[0].id, hs, device);
      }
    }
  }

  // Hero rotation: every tile as hero on the 5-tile set.
  {
    const device = DEVICES[0];
    const tiles = PALETTE.slice(0, 5);
    for (const t of tiles) {
      add(`hero-rotation/${t.id}`, tiles, t.id, 0.62, device);
    }
  }

  // Unknown hero id falls back to tiles[0].
  add("edge/unknown-hero", PALETTE.slice(0, 3), "nope", 0.62, DEVICES[0]);

  // Tie case: identical satellites — order must break the tie deterministically.
  add(
    "edge/tie-identical-sats",
    [
      { id: "hero", hint: 16 / 9, weight: 1.0 },
      { id: "sat-a", hint: 1, weight: 0.5 },
      { id: "sat-b", hint: 1, weight: 0.5 },
    ],
    "hero",
    0.62,
    DEVICES[0],
  );

  // Sliver rule: 1:1 hero at 0.62 on 16:10 leaves <15% below — hero snaps to
  // full height.
  add(
    "edge/sliver-snap",
    [
      { id: "square", hint: 1, weight: 0.5 },
      { id: "cal", hint: 3 / 4, weight: 0.6 },
      { id: "tick", hint: 8, weight: 0.9 },
    ],
    "square",
    0.62,
    DEVICES[0],
  );

  // Zero-weight satellites: cost-free everywhere, mask encoding breaks ties.
  add(
    "edge/zero-weight-sats",
    [
      { id: "hero", hint: 16 / 9, weight: 1.0 },
      { id: "free-a", hint: 4 / 3, weight: 0 },
      { id: "free-b", hint: 3 / 4, weight: 0 },
      { id: "free-c", hint: 1, weight: 0 },
    ],
    "hero",
    0.5,
    DEVICES[1],
  );

  return cases;
}
