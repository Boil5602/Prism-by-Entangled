/* PRISM break watch, browser port: PictureNet (2026-11-06).
 * The small picture network trained on the bench (scripts/breakwatch/cnn.py; exported as picture-net.json with each batch norm folded
 * into its convolution). Its input is the frame the break watch already reads (320 x 180 grey) in 3 x 3 blocks (60 x 106, the last two
 * columns left out), beside its change from the frame before (zero with no frame in the last three seconds), both over 255 and rounded
 * to half precision as training stored them. Four 3 x 3 convolutions at stride 2 (each with its ReLU), a layer of 64 with its ReLU,
 * one output; the chance is its sigmoid. About 4.7 million multiply-adds a look. Held to the bench's own numbers by
 * scripts/breakwatch/picture-net-parity.mjs.
 * Requires cs.js first (only for the namespace). Classic script, no DOM. Pure ASCII source. */
(function (root) {
  'use strict';
  var ns = root.PrismBreak || (root.PrismBreak = {});
  if (typeof module === 'object' && module && module.exports) module.exports = ns;

  var W = 106, H = 60;

  function f32(b64) {
    var bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Float32Array(u8.buffer);   // little-endian, as every browser and x86/ARM PC
  }
  // half precision, as numpy's float16 rounds (to nearest, ties to even)
  function half(x) {
    if (x === 0 || !isFinite(x)) return x;
    var a = Math.abs(x), e = Math.max(Math.floor(Math.log2(a)), -14);
    if (Math.pow(2, e) > a) e--;                       // log2 rounding at the edges of a power of two
    if (e < -14) e = -14;
    var step = Math.pow(2, e - 10), q = a / step, r = Math.round(q);
    if (Math.abs(q - Math.floor(q) - 0.5) < 1e-12) r = Math.floor(q) % 2 === 0 ? Math.floor(q) : Math.floor(q) + 1;
    return (x < 0 ? -1 : 1) * r * step;
  }
  function blocks(g) {
    var out = new Float32Array(H * W);
    for (var y = 0; y < H; y++)
      for (var x = 0; x < W; x++) {
        var s = 0;
        for (var dy = 0; dy < 3; dy++) { var row = (y * 3 + dy) * 320 + x * 3; s += g[row] + g[row + 1] + g[row + 2]; }
        out[y * W + x] = s / 9;
      }
    return out;
  }

  /** spec: the parsed picture-net.json. */
  function PictureNet(spec) {
    if (!spec || spec.kind !== 'picture-net' || spec.version !== 1) throw new Error('not a picture network');
    this.layers = spec.layers.map(function (l) {
      return { type: l.type, inC: l['in'], outC: l.out, w: f32(l.w), b: f32(l.b), relu: l.type === 'conv' ? true : !!l.relu };
    });
  }
  function conv(L, x, c, h, w) {
    var oh = Math.ceil(h / 2), ow = Math.ceil(w / 2), out = new Float32Array(L.outC * oh * ow);
    for (var o = 0; o < L.outC; o++) {
      var bo = L.b[o];
      for (var y = 0; y < oh; y++)
        for (var xx = 0; xx < ow; xx++) {
          var s = bo;
          for (var i = 0; i < c; i++) {
            var wb = (o * c + i) * 9, xb = i * h * w;
            for (var ky = 0; ky < 3; ky++) {
              var iy = y * 2 - 1 + ky;
              if (iy < 0 || iy >= h) continue;
              for (var kx = 0; kx < 3; kx++) {
                var ix = xx * 2 - 1 + kx;
                if (ix < 0 || ix >= w) continue;
                s += L.w[wb + ky * 3 + kx] * x[xb + iy * w + ix];
              }
            }
          }
          out[(o * oh + y) * ow + xx] = s > 0 ? s : 0;
        }
    }
    return { x: out, c: L.outC, h: oh, w: ow };
  }
  function linear(L, x) {
    var out = new Float32Array(L.outC);
    for (var o = 0; o < L.outC; o++) {
      var s = L.b[o], wb = o * L.inC;
      for (var i = 0; i < L.inC; i++) s += L.w[wb + i] * x[i];
      out[o] = L.relu && s < 0 ? 0 : s;
    }
    return out;
  }
  /** The chance of an ad for one frame: grey and prev are 320 x 180 grey frames (prev null when none in the last three seconds). */
  PictureNet.prototype.Chance = function (grey, prev) {
    if (this.inChannels() !== 2) throw new Error('this picture network wants ' + this.inChannels() + ' channels: call ChanceTemporal');
    var c = blocks(grey), p = prev ? blocks(prev) : null, x = new Float32Array(2 * H * W);
    for (var k = 0; k < H * W; k++) { x[k] = half(c[k] / 255); x[H * W + k] = p ? half((c[k] - p[k]) / 255) : 0; }
    return this.run(x, 2);
  };
  /** The channels the network was trained on: 2 (the frame and its change) or 4 (with the ten seconds behind it). */
  PictureNet.prototype.inChannels = function () { return this.layers[0].inC; };
  /** The temporal network's chance (2026-11-07, cnn.py TEMPORAL=1): beside the frame and its change from the frame before, the mean
   *  absolute change between successive frames two seconds apart over the last ten seconds, and the change from the frame six seconds
   *  before. back[k] is the frame nearest 2(k+1) s back (within 0.7 s), null where there is none; a missing frame leaves its stride out,
   *  with none the channels are zero - as the training built them. */
  PictureNet.prototype.ChanceTemporal = function (grey, prev, back) {
    if (this.inChannels() !== 4) throw new Error('this picture network wants ' + this.inChannels() + ' channels');
    var n = H * W, c = blocks(grey), p = prev ? blocks(prev) : null;
    var greys = [c]; for (var k = 0; k < 5; k++) greys.push(back[k] ? blocks(back[k]) : null);
    var energy = new Float32Array(n), pairs = 0;
    for (var k2 = 0; k2 < 5; k2++) if (greys[k2] && greys[k2 + 1]) { pairs++; for (var i = 0; i < n; i++) energy[i] += Math.abs(greys[k2][i] - greys[k2 + 1][i]); }
    var six = greys[3], x = new Float32Array(4 * n);
    for (var j = 0; j < n; j++) {
      x[j] = half(c[j] / 255);
      x[n + j] = p ? half((c[j] - p[j]) / 255) : 0;
      x[2 * n + j] = pairs ? half(energy[j] / pairs / 255) : 0;
      x[3 * n + j] = six ? half((c[j] - six[j]) / 255) : 0;
    }
    return this.run(x, 4);
  };
  PictureNet.prototype.run = function (x, ch) {
    var cur = { x: x, c: ch, h: H, w: W };
    for (var li = 0; li < this.layers.length; li++) {
      var L = this.layers[li];
      if (L.type === 'conv') cur = conv(L, cur.x, cur.c, cur.h, cur.w);
      else cur = { x: linear(L, cur.x) };
    }
    return 1 / (1 + Math.exp(-cur.x[0]));
  };

  ns.PictureNet = PictureNet;
})(typeof globalThis !== 'undefined' ? globalThis : this);
