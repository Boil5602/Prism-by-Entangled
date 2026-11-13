namespace PrismHost.Services;

/// <summary>
/// The lounge scene the pages draw themselves (2026-10-31): the art as a backdrop or a focal picture, and Sunrise Meadow move for move
/// with the PC's Tableaus.cs, from the PC's bands. One copy, spliced into the phone page (RemotePage.cs) and the listen page
/// (ListenPage.cs) where each says __VIZ_SCENE__. It reads one object, viz: bands (48 floats), pal (the stage's palette or null),
/// reduced (the person's reduced-motion setting), t (the clock), sun (its own state, null at first), art, artBlur and artUrl (the picture).
/// Plain script, no module: the pages are one file each. Pure ASCII, as the pages are.
/// </summary>
public static class VizScene
{
    public const string Js = """
function vizArtLoad(url) {
  const im = new Image(); im.crossOrigin = 'anonymous';
  im.onload = () => {
    if (viz.artUrl !== url) return;
    viz.art = im;
    // the PC's backdrop "blur": the picture decoded 24 pixels wide and smoothed back up; the same here through a tiny canvas
    try { const c = document.createElement('canvas'); const w = 24, h = Math.max(1, Math.round(24 * im.naturalHeight / im.naturalWidth)); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h); viz.artBlur = c; } catch (x) { viz.artBlur = null; }
  };
  im.onerror = () => { const plain = new Image(); plain.onload = () => { if (viz.artUrl === url) { viz.art = plain; viz.artBlur = null; } }; plain.src = url; };   // a host that refuses the cross-origin ask: the picture plain, drawn but never sampled
  im.src = url;
}
function vizArtBackdrop(g, W, H) {
  const src = viz.artBlur || viz.art; if (!src) return false;
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight, r = Math.max(W / sw, H / sh), w = sw * r, h = sh * r;
  const dx = viz.reduced ? 0 : Math.sin(viz.t * 0.05) * W * 0.02, dy = viz.reduced ? 0 : Math.cos(viz.t * 0.04) * H * 0.02;
  g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.globalAlpha = 1;
  g.drawImage(src, (W - w) / 2 + dx, (H - h) / 2 + dy, w * 1.04, h * 1.04);   // a little larger than the view, so the drift never shows an edge
  g.fillStyle = 'rgba(11,13,18,0.55)'; g.fillRect(0, 0, W, H); g.restore();
  return true;
}
// the focal art's centre: a little above the middle, as the PC's poster; in portrait, over the sun's travel in Sunrise Meadow, which
// the scene matches (2026-10-28)
function vizFocalCy(W, H) { return viz.focalCy ? viz.focalCy(W, H) : H > W ? H * 0.566 : H / 2 - 20; }   // a page with its own words on the scene says where the picture's middle goes
function vizArtFocal(g, W, H) {
  if (!viz.art) return;
  const side = Math.max(200, Math.round(Math.min(W, H) * 0.6)), sw = viz.art.naturalWidth, sh = viz.art.naturalHeight, r = Math.min(side / sw, side / sh), w = sw * r, h = sh * r;
  g.save(); g.globalAlpha = 1; g.fillStyle = 'rgba(11,13,18,0.1)'; g.fillRect(0, 0, W, H);
  g.drawImage(viz.art, (W - w) / 2, vizFocalCy(W, H) - h / 2, w, h); g.restore();   // the PC's square, set a little above centre as its poster is
}
// ---- Sunrise Meadow, the lounge's own scene redrawn here (2026-10-27): the PC's Tableaus.cs SunriseMeadow and its pack (visualization-styles/sunrise-meadow.json), move for move -
// the sun climbing with the loudness, rays turning, grass swaying with the mids, clouds drifting, a flock now and then with a wake of
// light on the beat - from the same 24 levels (attack.6, release.12, each summary riding its own recent range) off the PC's bands.
const SUN_P = [[0xF0, 0xA8, 0x3C], [0xF0, 0x5C, 0x7A], [0xF0, 0xD0, 0x8F], [0xA8, 0xD8, 0x6C]], SUN_INK = [0x0B, 0x0D, 0x12], SUN_INK2 = [0x14, 0x18, 0x21], SUN_WHITE = [0xEC, 0xEC, 0xF0], SUN_LIFT = [0x2A, 0x38, 0x62];   // scene palette: the PC's sunrise-meadow pack, a picture, not UI
function sP(i) { const pal = viz.pal || SUN_P; return pal[Math.abs(i) % pal.length]; }
function sMix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function sCss(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a === undefined ? 1 : Math.min(1, Math.max(0, a))) + ')'; }
function sOsc(t, rate, ph) { return 0.5 + 0.5 * Math.sin(t * rate + (ph || 0)); }
function sRng(seed) { let x = seed >>> 0; return () => { x = (x + 0x6D2B79F5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function sGlow(g, x, y, w, h, c, innerA, alpha) {   // a soft light: a radial falloff over an ellipse, as the PC's Glow
  if (w < 0.5 || h < 0.5 || alpha <= 0) return;
  g.save(); g.globalAlpha = Math.min(1, alpha); g.translate(x, y); g.scale(w / 2, h / 2);
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1); rg.addColorStop(0, sCss(c, innerA)); rg.addColorStop(0.45, sCss(c, innerA * 0.6)); rg.addColorStop(1, sCss(c, 0));
  g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
}
function sunBuild(W, H) {
  const S = (f) => f * H, X = (f) => f * W, Y = (f) => f * H, b = { W, H, stars: [], clouds: [], ridges: [], grass: [], flowers: [], flock: [] };
  let r = sRng(5);
  for (let i = 0; i < 60; i++) { const big = r() < 0.12, d = S(big ? 0.006 + r() * 0.004 : 0.002 + r() * 0.003); b.stars.push({ x: X(r()), y: Y(r() * 0.5), d: big ? d * 2.5 : d, big }); }
  r = sRng(77);
  for (let i = 0; i < 5; i++) { const cx = r(), cy = 0.1 + r() * 0.32, d = 0.14 + r() * 0.16; for (let k = 0; k < 4; k++) b.clouds.push({ x: cx + (k - 1.5) * d * 0.3 * (H / W), y: cy + (k % 2 === 0 ? -0.015 : 0.012), d: d * (0.7 + 0.3 * r()), ph: r() * 6 }); }
  const ridge = (top, bottom, baseY, minH, maxH, steps, seed, jag) => { const q = sRng(seed), pts = [[0, H]]; let prev = minH + q() * (maxH - minH); for (let i = 0; i <= steps; i++) { const target = minH + q() * (maxH - minH), h = prev + (target - prev) * jag; prev = h; pts.push([X(i / steps), Y(baseY) - S(h)]); } pts.push([W, H]); return { top, bottom, pts, y0: Y(baseY) - S(maxH) }; };
  b.ridges.push(ridge(sMix(SUN_INK2, sP(1), 0.15), SUN_INK2, 0.74, 0.01, 0.07, 10, 71, 0.6));
  b.ridges.push(ridge([0x12, 0x22, 0x16], [0x0A, 0x14, 0x0E], 0.8, 0, 0.04, 8, 73, 0.6));
  r = sRng(75);
  for (let i = 0; i < 140; i++) b.grass.push({ c: sMix([0x1E, 0x38, 0x22], [0x3A, 0x5C, 0x30], r()), w: S(0.002 + r() * 0.003), x: r(), h: 0.06 + r() * 0.16, ph: r() * 6 });
  for (let i = 0; i < 24; i++) b.flowers.push({ c: sP(i % 2 === 0 ? 3 : 0), x: r(), y: 0.84 + r() * 0.14 });
  r = sRng(79);
  for (let i = 0; i < 7; i++) b.flock.push({ dx: -Math.floor((i + 1) / 2) * 0.032, dy: (i % 2 === 0 ? 1 : -1) * Math.floor((i + 1) / 2) * 0.02, ph: r() * 6, size: 0.011 + r() * 0.006 });
  return b;
}
function sunDraw(g, W, H, dt, overArt, underArt) {
  if (!viz.sun) viz.sun = { b: null, lv: new Float32Array(24), hi: [0, 0, 0, 0], lo: [0, 0, 0, 0], beatE: 0, rise: 0, drift: 0, flockAt: -1, nextFlock: NaN, flockDir: 1, flockY: 0.3, hue: 0, sp: [], spNext: 0, t: 0, rng: sRng(11), flv: new Float32Array(24), fph: new Float32Array(24) };
  const st = viz.sun; if (!st.b || st.b.W !== W || st.b.H !== H) st.b = sunBuild(W, H);
  const b = st.b, S = (f) => f * H, X = (f) => f * W, Y = (f) => f * H, reduced = viz.reduced, R = st.rng;
  // the PC's renderer takes its steps 30 times a second; a phone draws 60 or 120 frames, so every per-step amount is scaled to the
  // frame's length (2026-10-27, - no: the same amounts per
  // frame ran the scene two to four times faster than the wall)
  const k = (c) => 1 - Math.pow(1 - c, dt * 30);
  const lv = st.lv, kA = k(0.6), kR = k(0.12), kB = k(0.15), kRange = k(0.012), kRise = k(0.025), kFa = k(0.35), kFr = k(0.08);
  for (let i = 0; i < 24; i++) { const l = Math.min(1, Math.max(0, (viz.bands[i * 2] + viz.bands[i * 2 + 1]) / 2)); lv[i] = l > lv[i] ? lv[i] + (l - lv[i]) * kA : lv[i] + (l - lv[i]) * kR; }
  let lowB = 0; for (let i = 0; i < 4; i++) lowB += lv[i]; lowB /= 4;
  const beatRaw = Math.max(0, lowB - st.beatE) * (reduced ? 0.2 : 1); st.beatE += (lowB - st.beatE) * kB;
  let low = 0, mid = 0, high = 0, loud = 0;
  for (let i = 0; i < 24; i++) { loud += lv[i]; if (i < 6) low += lv[i]; else if (i < 14) mid += lv[i]; else high += lv[i]; }
  const range = (j, raw) => { st.hi[j] = Math.max(raw, st.hi[j] - (st.hi[j] - raw) * kRange); st.lo[j] = Math.min(raw, st.lo[j] + (raw - st.lo[j]) * kRange); return Math.min(1, Math.max(0, (raw - st.lo[j]) / Math.max(0.04, st.hi[j] - st.lo[j]))); };
  const f = { low: range(0, low / 6), mid: range(1, mid / 8), high: range(2, high / 10), loud: range(3, loud / 24), beat: Math.min(1, beatRaw), t: (st.t += dt), dt, speed: reduced ? 0.15 : 1 };
  const Lv = (frac) => lv[Math.min(23, Math.max(0, Math.round(frac * 23)))];
  st.rise += ((0.3 + 0.7 * f.loud) - st.rise) * kRise;   // never a sun below the hills: a resting dawn, a full one on a loud mix
  // in portrait under the focal art the sun keeps the landscape's proportions to the picture: its size and travel off the width, centred
  // on the art, so the rays come evenly from behind the picture and the disc stays behind it (2026-10-28); landscape, and portrait without the art, are as they were
  const tall = !!underArt && H > W, Hs = tall ? W : H, SS = (f) => f * Hs;
  const rise = st.rise, cx = X(0.5), cy = tall ? vizFocalCy(W, H) - (rise - 0.65) * 0.36 * Hs : Y(0.8 - 0.36 * rise);
  g.globalAlpha = 1;
  // the sky, its night colours lifted toward a deep blue as on the PC
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, sCss(sMix([0x08, 0x0A, 0x1E], SUN_LIFT, 0.35))); sky.addColorStop(0.6, sCss(sMix([0x1A, 0x14, 0x30], SUN_LIFT, 0.35))); sky.addColorStop(1, sCss(sMix([0x2A, 0x1C, 0x2C], SUN_LIFT, 0.35)));
  g.globalAlpha = overArt ? 0.55 : 1; g.fillStyle = sky; g.fillRect(0, 0, W, H); g.globalAlpha = 1;   // over the art the sky is a wash, so the picture shows through
  for (let i = 0; i < b.stars.length; i++) { const s0 = b.stars[i], a = (1 - rise) * (0.3 + 0.3 * sOsc(f.t, 1.1, i)); if (s0.big) sGlow(g, s0.x, s0.y, s0.d, s0.d, SUN_WHITE, 1, a); else { g.globalAlpha = a * 0.5; g.fillStyle = sCss(SUN_WHITE); g.beginPath(); g.arc(s0.x, s0.y, s0.d / 2, 0, Math.PI * 2); g.fill(); } }
  const dawn = g.createLinearGradient(0, 0, 0, Y(0.78)); dawn.addColorStop(0, sCss(sP(2), 0.15)); dawn.addColorStop(0.5, sCss(sP(1), 0.6)); dawn.addColorStop(1, sCss(sP(0), 0.95));
  g.globalAlpha = 0.45 + 0.55 * rise; g.fillStyle = dawn; g.fillRect(0, 0, W, Y(0.78));
  // clouds: a slow drift the mids hurry, swelling a little with the lows, lit by the dawn
  st.drift += f.dt * f.speed * (0.006 + 0.014 * f.mid);
  for (let i = 0; i < b.clouds.length; i++) { const c = b.clouds[i], fx = (c.x + st.drift * (0.6 + 0.2 * (Math.floor(i / 4) % 3)) + 0.3) % 1.3 - 0.15; sGlow(g, X(fx), Y(c.y) + Math.sin(f.t * 0.3 + c.ph) * S(0.004), S(c.d) * (1 + 0.1 * f.low), S(c.d) * 0.5, sMix(sP(1), SUN_WHITE, 0.55), 0.8, (0.1 + 0.45 * rise) * (0.8 + 0.2 * sOsc(f.t, 0.5, c.ph))); }
  for (let i = 0; i < 18; i++) {   // rays turning slowly, each as long as its band
    const a = f.t * 0.06 * f.speed + i * Math.PI * 2 / 18, l = Lv(i / 18), len = SS(0.5 + 0.5 * l), half = 0.045;
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, len); rg.addColorStop(0, sCss(sP(2), 0.35)); rg.addColorStop(1, sCss(sP(2), 0));
    g.globalAlpha = Math.min(1, 0.15 + 0.4 * l * rise); g.fillStyle = rg; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a - half) * len, cy + Math.sin(a - half) * len); g.lineTo(cx + Math.cos(a + half) * len, cy + Math.sin(a + half) * len); g.closePath(); g.fill();
  }
  sGlow(g, cx, cy, SS(1.2 + 0.6 * f.loud), SS(1.2 + 0.6 * f.loud), sP(0), 0.25, 0.3 + 0.6 * rise);
  sGlow(g, cx, cy, SS(0.5 + 0.3 * f.loud + 0.15 * f.beat), SS(0.5 + 0.3 * f.loud + 0.15 * f.beat), sP(2), 0.5, 0.5 + 0.5 * f.loud);
  g.globalAlpha = 1; g.fillStyle = sCss(sMix(sP(2), SUN_WHITE, 0.5)); g.beginPath(); g.arc(cx, cy, SS(0.2 + 0.06 * f.low) / 2, 0, Math.PI * 2); g.fill();
  // birds: a flock every so often, sooner on a loud mix, wings beating with the mids and the beat, lifting on the highs; none under reduced motion
  if (isNaN(st.nextFlock)) st.nextFlock = f.t + 8;
  if (st.flockAt < 0) { if (!reduced && f.t >= st.nextFlock) { st.flockAt = 0; st.flockDir = R() < 0.5 ? 1 : -1; st.flockY = 0.16 + R() * 0.3; st.hue = Math.floor(R() * SUN_P.length); } }
  else { st.flockAt += f.dt * f.speed * (0.05 + 0.04 * f.mid); if (st.flockAt >= 1) { st.flockAt = -1; st.nextFlock = f.t + 18 + R() * 30 * (1 - 0.5 * f.loud); } }
  if (st.flockAt >= 0) {
    g.lineWidth = Math.max(0.5, S(0.0025)); g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < b.flock.length; i++) {
      const bd = b.flock[i], fx = st.flockDir > 0 ? -0.12 + 1.24 * st.flockAt : 1.12 - 1.24 * st.flockAt;
      const bx = X(fx + st.flockDir * bd.dx), by = Y(st.flockY + bd.dy + Math.sin(f.t * 0.7 + bd.ph) * 0.01 - 0.03 * f.high);
      const span = S(bd.size), wing = span * 0.6 * Math.sin(f.t * (5 + 7 * f.mid) + bd.ph) * (0.7 + 0.6 * f.beat);
      const glow = Math.min(1, Math.max(0, 0.15 + 0.85 * f.high * (0.7 + 0.3 * sOsc(f.t * 2, 1, bd.ph)) + 0.35 * f.beat));
      g.globalAlpha = Math.min(1, 0.4 + 0.5 * rise); g.strokeStyle = sCss(sMix(SUN_INK, sP(st.hue + i % 2), glow));
      g.beginPath(); g.moveTo(bx - span, by - wing); g.lineTo(bx, by + span * 0.15); g.lineTo(bx + span, by - wing); g.stroke();
      if (R() < 0.4 * f.beat + 0.04 * f.high) {   // a mote leaves a wingtip: most on the beat, a few on the highs
        const k = st.spNext++ % 48, tip = R() < 0.5 ? -1 : 1;
        st.sp[k] = { x: (bx + tip * span) / W, y: (by - wing) / H, vx: -st.flockDir * (0.04 + 0.05 * R()) + (R() - 0.5) * 0.01, vy: -(0.004 + 0.016 * R()), life: 1, c: sMix(sP(st.hue + i % 2), SUN_WHITE, 0.3) };
      }
    }
  }
  for (let k = 0; k < st.sp.length; k++) {   // the wake streams back behind the flock, lifts a little, twinkles and is gone in about a second
    const p = st.sp[k]; if (!p || p.life <= 0) continue;
    p.life -= f.dt * 0.9; p.x += p.vx * f.dt; p.y += p.vy * f.dt;
    const life = Math.min(1, Math.max(0, p.life)); g.globalAlpha = life * (0.45 + 0.55 * sOsc(f.t * 7, 1, k)); g.fillStyle = sCss(p.c);
    g.beginPath(); g.arc(X(p.x), Y(p.y), S(0.0015 + 0.004 * life) / 2, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  for (const rd of b.ridges) { const rg = g.createLinearGradient(0, rd.y0, 0, H); rg.addColorStop(0, sCss(rd.top)); rg.addColorStop(1, sCss(rd.bottom)); g.fillStyle = rg; g.beginPath(); g.moveTo(rd.pts[0][0], rd.pts[0][1]); for (let i = 1; i < rd.pts.length; i++) g.lineTo(rd.pts[i][0], rd.pts[i][1]); g.closePath(); g.fill(); }
  const ground = g.createLinearGradient(0, Y(0.8), 0, H); ground.addColorStop(0, sCss([0x10, 0x1E, 0x12])); ground.addColorStop(1, sCss([0x08, 0x10, 0x0A])); g.fillStyle = ground; g.fillRect(0, Y(0.8), W, S(0.2));
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < b.grass.length; i++) {   // the grass sways with the mids
    const gr = b.grass[i], baseX = X(gr.x), top = Y(1 - gr.h), lean = Math.sin(f.t * 1.1 * f.speed + gr.ph) * S(0.01 + 0.035 * f.mid) + S(0.01);
    g.lineWidth = Math.max(0.5, gr.w); g.strokeStyle = sCss(gr.c); g.beginPath(); g.moveTo(baseX, H); g.quadraticCurveTo(baseX + lean * 0.35, (H + top) / 2, baseX + lean, top); g.stroke();
  }
  // the flowers answer the music (2026-10-29), as the PC's: a band each, the pack's palette
  // walked over the song at each one's pace, white on the band's peaks, a swell with the band and a hop on the beat, a quicker sway with the mids
  for (let i = 0; i < b.flowers.length; i++) {
    const fl = b.flowers[i], raw = lv[(i * 7) % 24]; st.flv[i] += (raw - st.flv[i]) * (raw > st.flv[i] ? kFa : kFr);   // eased: a breath, not a shake
    const l = st.flv[i], pal = viz.pal || SUN_P, walk = (f.t * (0.12 + 0.06 * (i % 3)) + i * 0.37) % pal.length, ia = Math.floor(walk), ib = (ia + 1) % pal.length;
    const c = sMix(sMix(pal[ia], pal[ib], walk - ia), SUN_WHITE, 0.55 * l), hop = reduced ? 0 : f.beat * S(0.005) * (0.5 + 0.5 * Math.sin(i * 1.7));
    const d = S(0.012 + 0.02 * rise) * (1 + 0.5 * l);
    st.fph[i] += dt * f.speed * (1.1 + 0.6 * f.mid);   // the sway's own phase, never a rate multiplied into the clock (a moving rate jumps the phase: the shake)
    sGlow(g, X(fl.x) + Math.sin(st.fph[i] + i) * S(0.006 + 0.002 * f.mid), Y(fl.y) - hop, d, d, c, 1, 0.2 + 0.8 * rise * (0.7 + 0.3 * l));
  }
  g.save(); g.translate(W / 2, H / 2); g.scale(W * 0.78, H * 0.85);   // the cinematic edge
  const vg = g.createRadialGradient(0, 0, 0, 0, 0, 1); vg.addColorStop(0.45, sCss(SUN_INK, 0)); vg.addColorStop(1, sCss(SUN_INK, 0.28)); g.fillStyle = vg; g.fillRect(-2, -2, 4, 4); g.restore();
}
""";
}
