/**
 * VERBATIM copy of the solver from prototypes/frame-editor.jsx (the original
 * reference implementation). This file is the oracle: the TypeScript port in
 * src/solver.ts and the golden fixtures are both checked against it.
 * Never edit this file except to re-copy from the prototype.
 */

export function aspectCost(w, h, hint, weight) {
  if (w <= 0 || h <= 0) return Infinity;
  return weight * Math.abs(Math.log(w / h / hint));
}

export function solveHero(tiles, heroId, heroSize, W, H) {
  const rects = {};
  if (!tiles.length) return rects;
  const hero = tiles.find((t) => t.id === heroId) || tiles[0];
  const sats = tiles.filter((t) => t.id !== hero.id);
  const landscape = W >= H;

  let hw, hh;
  if (landscape) {
    hw = heroSize * W;
    hh = Math.min(H, hw / hero.hint);
    if (H - hh < 0.15 * H || sats.length === 0) hh = H; // avoid sliver strips
  } else {
    hh = heroSize * H;
    hw = Math.min(W, hh * hero.hint);
    if (W - hw < 0.15 * W || sats.length === 0) hw = W;
  }
  rects[hero.id] = { x: 0, y: 0, w: hw, h: hh };

  if (!sats.length) {
    rects[hero.id] = { x: 0, y: 0, w: W, h: H };
    return rects;
  }

  // strip A: beside hero along the long axis; strip B: after hero on the cross axis
  const A = landscape
    ? { x: hw, y: 0, w: W - hw, h: H }
    : { x: 0, y: hh, w: W, h: H - hh };
  const B = landscape
    ? { x: 0, y: hh, w: hw, h: H - hh }
    : { x: hw, y: 0, w: W - hw, h: hh };
  const aOK = A.w > 1 && A.h > 1;
  const bOK = B.w > 1 && B.h > 1;

  // v2 (2026-08-31): each strip subdivides into a COLUMN GRID, columns
  // chosen by the same cost the strip assignment minimizes - four 16:9
  // satellites in a tall strip go 2x2 instead of four letterboxed bars.
  // The last row stretches to fill its width; ties prefer fewer columns.
  const gridCost = (S, arr, cols) => {
    const rows = Math.ceil(arr.length / cols);
    let cost = 0;
    for (let i = 0; i < arr.length; i++) {
      const r = Math.floor(i / cols);
      const rowCount = Math.min(cols, arr.length - r * cols);
      cost += aspectCost(S.w / rowCount, S.h / rows, arr[i].hint, arr[i].weight);
    }
    return cost;
  };
  const placeGrid = (S, arr, cols) => {
    const rows = Math.ceil(arr.length / cols);
    arr.forEach((t, i) => {
      const r = Math.floor(i / cols);
      const rowCount = Math.min(cols, arr.length - r * cols);
      const c = i - r * cols;
      const w = S.w / rowCount, h = S.h / rows;
      rects[t.id] = { x: S.x + c * w, y: S.y + r * h, w, h };
    });
  };

  let best = null;
  const k = sats.length;
  for (let mask = 0; mask < 1 << k; mask++) {
    const inA = [], inB = [];
    for (let i = 0; i < k; i++) (mask & (1 << i) ? inA : inB).push(sats[i]);
    if (inA.length && !aOK) continue;
    if (inB.length && !bOK) continue;
    if (!inA.length && !inB.length) continue;
    for (let ca = 1; ca <= Math.max(1, inA.length); ca++) {
      for (let cb = 1; cb <= Math.max(1, inB.length); cb++) {
        let cost = 0;
        if (inA.length) cost += gridCost(A, inA, ca);
        if (inB.length) cost += gridCost(B, inB, cb);
        if (!best || cost < best.cost - 1e-9) best = { cost, mask, ca, cb };
        if (!inB.length) break;
      }
      if (!inA.length) break;
    }
  }

  if (!best) { // degenerate: everything overlaps hero region; stack in A anyway
    const s = { w: W, h: H / k };
    sats.forEach((t, i) => (rects[t.id] = { x: 0, y: i * s.h, w: s.w, h: s.h }));
    return rects;
  }

  const inA = [], inB = [];
  for (let i = 0; i < k; i++) (best.mask & (1 << i) ? inA : inB).push(sats[i]);
  if (inA.length) placeGrid(A, inA, best.ca);
  if (inB.length) placeGrid(B, inB, best.cb);
  return rects;
}
