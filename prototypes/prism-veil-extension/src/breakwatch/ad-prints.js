/* PRISM break watch, browser port: AdPrints, PrintRuns and AdSounds (2026-11-06).
 * Line-for-line ports of the Windows host's picture fingerprints (targets/win-host/PrismHost/Services/AdPrints.cs: a 16 x 17 grid
 * of the 320 x 180 grey frame, 496 bits, a match within 60 bits; the shipped catalog read alongside, never written) and its sound
 * fingerprints (AdSounds.cs: 64 Haitsma-Kalker words found again with a quarter of their bits differing at most). A fingerprint is
 * held as sixteen 32-bit words (the host's eight 64-bit words, low half first, as the files store them). The files (prints.bin,
 * catalog.bin, sounds.bin) are read from and written to bytes; nothing here touches storage or the network.
 * Requires cs.js first (only for the namespace). Classic script, no DOM. Pure ASCII source. */
(function (root) {
  'use strict';
  var ns = root.PrismBreak || (root.PrismBreak = {});
  if (typeof module === 'object' && module && module.exports) module.exports = ns;

  var WORDS32 = 16, MATCH_BITS = 60, MAX = 30000, CATALOG_CLIPS = 1000000;
  function pop32(v) { v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; }
  function nowSeconds() { return Math.floor(Date.now() / 1000); }
  function setInt64(dv, o, v) { var hi = Math.floor(v / 4294967296); dv.setUint32(o, v - hi * 4294967296, true); dv.setInt32(o + 4, hi, true); }

  /** The pictures seen in breaks. bytes: a prints.bin (or catalog.bin) or nothing; catalog: another AdPrints read alongside. */
  function AdPrints(bytes, catalog) {
    this._bits = new Uint32Array(1024 * WORDS32);
    this._seenAt = []; this._count = []; this._clip = []; this._offset = new Float32Array(1024);
    this._n = 0; this._lastClip = 0; this._dirty = false;
    this._catalog = catalog || null;
    if (bytes) this._load(bytes);
  }
  AdPrints.MatchBits = MATCH_BITS;
  Object.defineProperty(AdPrints.prototype, 'Count', { get: function () { return this._n; } });
  Object.defineProperty(AdPrints.prototype, 'CatalogCount', { get: function () { return this._catalog ? this._catalog.Count : 0; } });
  AdPrints.prototype._grow = function () {
    var nb = new Uint32Array(this._bits.length * 2); nb.set(this._bits); this._bits = nb;
    var no = new Float32Array(this._offset.length * 2); no.set(this._offset); this._offset = no;
  };
  AdPrints.prototype._push = function (fp, seen, count, clip, off) {
    if ((this._n + 1) * WORDS32 > this._bits.length) this._grow();
    this._bits.set(fp, this._n * WORDS32);
    this._seenAt[this._n] = seen; this._count[this._n] = count; this._clip[this._n] = clip; this._offset[this._n] = off;
    this._n++;
  };
  AdPrints.prototype._load = function (bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), o = 0;
    try {
      var ver = dv.getInt32(o, true); o += 4;
      if (ver !== 1 && ver !== 2) return;
      var n = dv.getInt32(o, true); o += 4;
      if (ver === 2) { this._lastClip = dv.getInt32(o, true); o += 4; }
      for (var i = 0; i < n; i++) {
        var b = new Uint32Array(WORDS32);
        for (var k = 0; k < WORDS32; k++) { b[k] = dv.getUint32(o, true); o += 4; }
        var seen = dv.getUint32(o, true) + dv.getInt32(o + 4, true) * 4294967296; o += 8;
        var count = dv.getInt32(o, true); o += 4;
        var clip = 0, off = 0;
        if (ver === 2) { clip = dv.getInt32(o, true); o += 4; off = dv.getFloat32(o, true); o += 4; }
        this._push(b, seen, count, clip, off);
      }
    } catch (e) { this._n = 0; this._seenAt.length = 0; this._count.length = 0; this._clip.length = 0; }
  };

  /** The frame's fingerprint (Uint32Array of 16), or null for a flat frame. */
  AdPrints.Of = function (g, w, h) {
    var sum = 0, sq = 0, i, j;
    for (i = 0; i < g.length; i++) { var v = g[i]; sum += v; sq += v * v; }
    var mean = sum / g.length, sd = Math.sqrt(Math.max(0, sq / g.length - mean * mean));
    if (sd < 20) return null;
    var gh = 16, gw = 17, cell = new Float64Array(gh * gw);
    for (i = 0; i < gh; i++) {
      var y0 = (i * h / gh) | 0, y1 = ((i + 1) * h / gh) | 0;
      for (j = 0; j < gw; j++) {
        var x0 = (j * w / gw) | 0, x1 = ((j + 1) * w / gw) | 0, s = 0;
        for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) s += g[y * w + x];
        cell[i * gw + j] = s / ((y1 - y0) * (x1 - x0));
      }
    }
    var bits = new Uint32Array(WORDS32), k = 0;
    function put(b) { if (b) bits[k >> 5] = (bits[k >> 5] | (1 << (k & 31))) >>> 0; k++; }
    for (i = 0; i < gh; i++) for (j = 0; j < gw - 1; j++) put(cell[i * gw + j + 1] > cell[i * gw + j]);
    for (i = 0; i < gh - 1; i++) for (j = 0; j < gw - 1; j++) put(cell[(i + 1) * gw + j] > cell[i * gw + j]);
    return bits;
  };
  AdPrints.Distance = function (a, b) { var d = 0; for (var i = 0; i < WORDS32; i++) d += pop32((a[i] ^ b[i]) >>> 0); return d; };
  AdPrints.prototype._dist = function (idx, fp) {
    var d = 0, o = idx * WORDS32, bits = this._bits;
    for (var i = 0; i < WORDS32; i++) d += pop32((bits[o + i] ^ fp[i]) >>> 0);
    return d;
  };
  /** Whether this picture was seen in a break before. */
  AdPrints.prototype.Seen = function (fp) {
    for (var i = 0; i < this._n; i++) if (this._dist(i, fp) <= MATCH_BITS) return true;
    return this._catalog !== null && this._catalog.Seen(fp) === true;
  };
  /** The pictures within `within` bits that know their place in a break: the nearest per break, as [clip, offset, dist]. */
  AdPrints.prototype.Places = function (fp, within) {
    var best = new Map();
    for (var i = 0; i < this._n; i++) {
      var clip = this._clip[i];
      if (clip === 0) continue;
      var d = this._dist(i, fp);
      if (d > within) continue;
      var b = best.get(clip);
      if (b === undefined || d < b[1]) best.set(clip, [this._offset[i], d]);
    }
    var list = [];
    best.forEach(function (v, c) { list.push([c, v[0], v[1]]); });
    if (this._catalog !== null) this._catalog.Places(fp, within).forEach(function (p) { list.push([p[0] + CATALOG_CLIPS, p[1], p[2]]); });
    return list;
  };
  AdPrints.prototype.NextClip = function () { this._lastClip++; this._dirty = true; return this._lastClip; };
  /** A picture of a break the watch is sure of: kept (or its twin counted again). */
  AdPrints.prototype.Learn = function (fp, clip, offset, nowSec) {
    clip = clip | 0; offset = Math.fround(offset || 0);
    var now = nowSec === undefined ? nowSeconds() : nowSec;
    for (var i = 0; i < this._n; i++)
      if (this._dist(i, fp) <= MATCH_BITS / 2) {
        if (this._clip[i] === 0 && clip !== 0) { this._clip[i] = clip; this._offset[i] = offset; }
        this._seenAt[i] = now; this._count[i]++;
        this._dirty = true; return;
      }
    this._push(fp, now, 1, clip, offset);
    if (this._n > MAX) {
      // the oldest let go (the host sorts with an unstable sort: among equal times which goes may differ)
      var order = []; for (var q = 0; q < this._n; q++) order.push(q);
      var self = this; order.sort(function (a, b) { return self._seenAt[a] - self._seenAt[b]; });
      var keep = order.slice(this._n - MAX), nb = new Uint32Array(this._bits.length), no = new Float32Array(this._offset.length), ns2 = [], nc = [], ncl = [];
      for (var r = 0; r < keep.length; r++) {
        var src = keep[r]; nb.set(this._bits.subarray(src * WORDS32, src * WORDS32 + WORDS32), r * WORDS32);
        no[r] = this._offset[src]; ns2.push(this._seenAt[src]); nc.push(this._count[src]); ncl.push(this._clip[src]);
      }
      this._bits = nb; this._offset = no; this._seenAt = ns2; this._count = nc; this._clip = ncl; this._n = keep.length;
    }
    this._dirty = true;
  };
  Object.defineProperty(AdPrints.prototype, 'Dirty', { get: function () { return this._dirty; } });
  /** The library as prints.bin bytes (version 2). */
  AdPrints.prototype.save = function () {
    var buf = new ArrayBuffer(12 + this._n * 84), dv = new DataView(buf), o = 0;
    dv.setInt32(o, 2, true); o += 4; dv.setInt32(o, this._n, true); o += 4; dv.setInt32(o, this._lastClip, true); o += 4;
    for (var i = 0; i < this._n; i++) {
      for (var k = 0; k < WORDS32; k++) { dv.setUint32(o, this._bits[i * WORDS32 + k], true); o += 4; }
      setInt64(dv, o, this._seenAt[i]); o += 8;
      dv.setInt32(o, this._count[i], true); o += 4; dv.setInt32(o, this._clip[i], true); o += 4; dv.setFloat32(o, this._offset[i], true); o += 4;
    }
    this._dirty = false;
    return new Uint8Array(buf);
  };

  /** Runs of an ad's pictures in order: three in order within ten seconds. */
  function PrintRuns() { this._hits = []; }
  PrintRuns.Loose = 80; PrintRuns.Need = 3;
  /** This look's places (AdPrints.Places at Loose, [clip, offset, dist]) at t: true when they complete a run. */
  PrintRuns.prototype.Look = function (t, places) {
    this._hits = this._hits.filter(function (h) { return !(t - h[0] > 10); });
    var run = false;
    for (var i = 0; i < places.length; i++) {
      var clip = places[i][0], off = Math.fround(places[i][1]);
      var inOrder = 1, times = new Set([t]);
      for (var k = 0; k < this._hits.length; k++) {
        var h = this._hits[k];
        if (h[1] === clip && Math.abs(Math.fround(off - h[2]) - (t - h[0])) <= 2.5 && !times.has(h[0])) { times.add(h[0]); inOrder++; }
      }
      if (inOrder >= PrintRuns.Need) run = true;
      this._hits.push([t, clip, off]);
    }
    return run;
  };

  // ---- the ads heard ----
  var BLOCK = 64, MAX_BER = 0.25, MAX_CLIPS = 600, MAX_CLIP_WORDS = 1600;
  /** The sounds heard in breaks. bytes: a sounds.bin or nothing. */
  function AdSounds(bytes) {
    this._clips = []; this._index = new Map(); this._dirty = false;
    if (bytes) this._load(bytes);
  }
  Object.defineProperty(AdSounds.prototype, 'Count', { get: function () { return this._clips.length; } });
  /** Whether the last 64 words of this window's sound (an array of uint32) were heard in a break before. */
  AdSounds.prototype.Heard = function (recent) {
    if (recent.length < BLOCK) return false;
    var start = recent.length - BLOCK, limit = BLOCK * 32 * MAX_BER;
    for (var i = start; i < recent.length; i += 4) {
      var hits = this._index.get(recent[i] >>> 0);
      if (hits === undefined) continue;
      for (var h = 0; h < hits.length; h += 2) {
        var c = this._clips[hits[h]], c0 = hits[h + 1] - (i - start);
        if (c0 < 0 || c0 + BLOCK > c.length) continue;
        var bits = 0;
        for (var k = 0; k < BLOCK && bits <= limit; k++) bits += pop32((c[c0 + k] ^ recent[start + k]) >>> 0);
        if (bits <= limit) return true;
      }
    }
    return false;
  };
  /** A stretch of a break the watch is sure of: kept as one clip. */
  AdSounds.prototype.Learn = function (words) {
    if (words.length < BLOCK || this.Heard(words)) return;
    var len = Math.min(words.length, MAX_CLIP_WORDS), clip = new Uint32Array(len);
    for (var i = 0; i < len; i++) clip[i] = words[words.length - len + i];
    if (this._clips.length >= MAX_CLIPS) { this._clips.shift(); this._reindex(); }
    this._clips.push(clip); this._indexClip(this._clips.length - 1);
    this._dirty = true;
  };
  AdSounds.prototype._indexClip = function (c) {
    var clip = this._clips[c];
    for (var i = 0; i < clip.length; i++) {
      var w = clip[i];
      if (w === 0 || w === 0xFFFFFFFF) continue;
      var l = this._index.get(w);
      if (l === undefined) { l = []; this._index.set(w, l); }
      if (l.length < 128) l.push(c, i);   // 64 hits, two numbers each
    }
  };
  AdSounds.prototype._reindex = function () { this._index.clear(); for (var c = 0; c < this._clips.length; c++) this._indexClip(c); };
  AdSounds.prototype._load = function (bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), o = 0;
    try {
      if (dv.getInt32(o, true) !== 1) return; o += 4;
      var n = dv.getInt32(o, true); o += 4;
      for (var i = 0; i < n; i++) {
        var len = dv.getInt32(o, true); o += 4;
        var c = new Uint32Array(len);
        for (var k = 0; k < len; k++) { c[k] = dv.getUint32(o, true); o += 4; }
        this._clips.push(c);
      }
      this._reindex();
    } catch (e) { this._clips.length = 0; this._index.clear(); }
  };
  AdSounds.prototype.save = function () {
    var size = 8; for (var i = 0; i < this._clips.length; i++) size += 4 + this._clips[i].length * 4;
    var buf = new ArrayBuffer(size), dv = new DataView(buf), o = 0;
    dv.setInt32(o, 1, true); o += 4; dv.setInt32(o, this._clips.length, true); o += 4;
    for (var c = 0; c < this._clips.length; c++) {
      var cl = this._clips[c]; dv.setInt32(o, cl.length, true); o += 4;
      for (var k = 0; k < cl.length; k++) { dv.setUint32(o, cl[k], true); o += 4; }
    }
    this._dirty = false;
    return new Uint8Array(buf);
  };

  ns.AdPrints = AdPrints;
  ns.PrintRuns = PrintRuns;
  ns.AdSounds = AdSounds;
})(typeof globalThis !== 'undefined' ? globalThis : this);
