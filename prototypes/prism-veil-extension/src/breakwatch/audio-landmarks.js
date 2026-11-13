/* PRISM break watch, browser port: audio landmarks (2026-11-08, the redesign's E3). fingerprint.py's scheme and AudioLandmarks.cs's, line
 * for line: 16 kHz mono; frames of 1024 every 512 with a Hann window; |FFT|^2 in dB; a peak is the maximum over +-7 frames and +-9 bins,
 * 10 dB above its frame's median and above -70 dB, the loudest 6 a frame, in bins 4 to 300; a landmark pairs a peak with the next 8 peaks
 * 1 to 48 frames on within +-48 bins: hash = f1 << 20 | f2 << 10 | dt with the anchor's frame. Classic script, no DOM, no network, pure
 * ASCII. Nothing about the sound leaves the device. */
(function (root) {
  'use strict';
  var ns = root.PrismBreak || (root.PrismBreak = {});
  if (typeof module === 'object' && module && module.exports) module.exports = ns;
  var N = 1024, HOP = 512, DB_FLOOR = -70, MIN_ABOVE = 10, MAX_PER_FRAME = 6, BIN_LO = 4, BIN_HI = 300, T_RAD = 7, F_RAD = 9, FAN = 8, DT_MIN = 1, DT_MAX = 48, DF_MAX = 48;
  var hann = new Float64Array(N); for (var i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));

  function fft(re, im) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1; for (; (j & bit) !== 0; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { var tr = re[i]; re[i] = re[j]; re[j] = tr; var ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (var s = 0; s < n; s += len) {
        var cr = 1, ci = 0;
        for (var k = 0; k < len / 2; k++) {
          var ur = re[s + k], ui = im[s + k], a = s + k + len / 2;
          var vr = re[a] * cr - im[a] * ci, vi = re[a] * ci + im[a] * cr;
          re[s + k] = ur + vr; im[s + k] = ui + vi; re[a] = ur - vr; im[a] = ui - vi;
          var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  /** The spectrogram in dB: an array of Float32Array(513), one a frame. x: Float32Array at 16 kHz mono. */
  function spectrogram(x) {
    if (x.length < N) return [];
    var frames = Math.floor((x.length - N) / HOP) + 1, S = new Array(frames), re = new Float64Array(N), im = new Float64Array(N);
    for (var f = 0; f < frames; f++) {
      for (var i = 0; i < N; i++) { re[i] = x[f * HOP + i] * hann[i]; im[i] = 0; }
      fft(re, im);
      var row = new Float32Array(N / 2 + 1);
      for (var k = 0; k <= N / 2; k++) { var p = re[k] * re[k] + im[k] * im[k]; row[k] = 10 * Math.log10(Math.max(p, 1e-10)); }
      S[f] = row;
    }
    return S;
  }

  /** [[frame, bin], ...] in frame order then bin order. */
  function peaks(S) {
    var out = [], T = S.length; if (!T) return out;
    var W = BIN_HI - BIN_LO, mt = new Array(T);
    for (var t = 0; t < T; t++) {
      var row = new Float32Array(W);
      for (var b = 0; b < W; b++) { var m = -Infinity; for (var d = -T_RAD; d <= T_RAD; d++) { var tt = t + d; if (tt >= 0 && tt < T && S[tt][b + BIN_LO] > m) m = S[tt][b + BIN_LO]; } row[b] = m; }
      mt[t] = row;
    }
    var med = new Float32Array(W);
    for (var t2 = 0; t2 < T; t2++) {
      for (var b2 = 0; b2 < W; b2++) med[b2] = S[t2][b2 + BIN_LO];
      var sorted = Float32Array.from(med).sort();
      var median = W % 2 === 1 ? sorted[(W - 1) / 2] : (sorted[W / 2 - 1] + sorted[W / 2]) / 2;
      var cands = [];
      for (var b3 = 0; b3 < W; b3++) {
        var v = S[t2][b3 + BIN_LO]; if (!(v > median + MIN_ABOVE) || !(v > DB_FLOOR)) continue;
        var mx = -Infinity; for (var d2 = -F_RAD; d2 <= F_RAD; d2++) { var bb = b3 + d2; if (bb >= 0 && bb < W && mt[t2][bb] > mx) mx = mt[t2][bb]; }
        if (v >= mx) cands.push([b3, v]);
      }
      if (cands.length > MAX_PER_FRAME) { cands.sort(function (a, b) { return b[1] - a[1]; }); cands = cands.slice(0, MAX_PER_FRAME); }
      cands.sort(function (a, b) { return a[0] - b[0]; });
      for (var c = 0; c < cands.length; c++) out.push([t2, cands[c][0] + BIN_LO]);
    }
    return out;
  }

  /** [[hash, anchor frame], ...] from the peaks. The hash is a non-negative 30-bit integer. */
  function landmarks(pk) {
    var out = [];
    for (var i = 0; i < pk.length; i++) {
      var t1 = pk[i][0], f1 = pk[i][1], n = 0;
      for (var j = i + 1; j < pk.length; j++) {
        var t2 = pk[j][0], f2 = pk[j][1], dt = t2 - t1;
        if (dt < DT_MIN) continue;
        if (dt > DT_MAX) break;
        if (Math.abs(f2 - f1) > DF_MAX) continue;
        out.push([((f1 << 20) | (f2 << 10) | dt) >>> 0, t1]); if (++n >= FAN) break;
      }
    }
    return out;
  }

  function of(pcm16k) { return landmarks(peaks(spectrogram(pcm16k))); }

  /** An in-memory index: tracks' landmarks; a query's hashes vote for (track, offset), pooled over +-1 frame. */
  function Index() { this.table = new Map(); this.tracks = []; }
  Index.prototype.add = function (name, lm) {
    var id = this.tracks.length; this.tracks.push(name);
    for (var i = 0; i < lm.length; i++) { var l = this.table.get(lm[i][0]); if (!l) this.table.set(lm[i][0], l = []); l.push([id, lm[i][1]]); }
  };
  Index.prototype.query = function (lm, minVotes) {
    if (minVotes === undefined) minVotes = 12;
    var votes = new Map();
    for (var i = 0; i < lm.length; i++) {
      var l = this.table.get(lm[i][0]); if (!l) continue;
      for (var j = 0; j < l.length; j++) { var k = l[j][0] + ':' + (l[j][1] - lm[i][1]); votes.set(k, (votes.get(k) || 0) + 1); }
    }
    var pooled = new Map();
    votes.forEach(function (v, k) { var p = k.split(':'), tr = +p[0], off = +p[1]; for (var d = -1; d <= 1; d++) { var kk = tr + ':' + (off + d); pooled.set(kk, (pooled.get(kk) || 0) + v); } });
    var best = [], self = this;
    pooled.forEach(function (v, k) { if (v >= minVotes) { var p = k.split(':'); best.push([self.tracks[+p[0]], +p[1], v]); } });
    best.sort(function (a, b) { return b[2] - a[2]; });
    return best;
  };

  ns.AudioLandmarks = { spectrogram: spectrogram, peaks: peaks, landmarks: landmarks, of: of, Index: Index, SAMPLE_RATE: 16000, N: N, HOP: HOP };
})(typeof globalThis !== 'undefined' ? globalThis : this);
