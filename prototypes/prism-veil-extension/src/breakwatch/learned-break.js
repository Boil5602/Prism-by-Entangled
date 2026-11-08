/* Prism break watch, browser port: LearnedBreak (2026-11-06).
 * A line-for-line port of the Windows host's learned break detector (targets/win-host/PrismHost/Services/LearnedBreak.cs):
 * gradient-boosted trees over a BreakModel's readings - each "seconds since" as recency kernels, the picture's and the logo's
 * rolling means (by seconds or by looks, as the model file says), the caption classifier's view of the last 20 s - and the cover
 * policy (up after "hold" looks above "on", down below "off", the offHold / offDeep wait). The model is the host's learned.json,
 * parsed (LearnedBreak.fromJson(obj)). Readings are rounded to three decimals away from zero as .NET does.
 * Requires cs.js and break-model.js first. Classic script, no DOM, no network. Pure ASCII source. */
(function (root) {
  'use strict';
  var ns = root.PrismBreak || (root.PrismBreak = {});
  if (typeof module === 'object' && module && module.exports) module.exports = ns;
  if (!ns.cs && typeof require === 'function') require('./cs.js');
  if (!ns.BreakModel && typeof require === 'function') require('./break-model.js');
  var cs = ns.cs;

  var urlMark = cs.lazyRegex('[a-z0-9]\\.(com|net|org)', 'i');
  var phoneMark = cs.lazyRegex('\\d{3}[-. ]\\d{3}[-. ]\\d{4}|1-8\\d\\d', '');
  var tagMark = /\[[^\]]+\]/;

  function LearnedBreak(r) {
    this._inputs = r.inputs.slice();
    this._skip = new Set(r.skip);
    this._kernels = r.kernels.map(Number);
    this._rollSignals = r.rolls.signals.slice();
    this._rollWindows = r.rolls.windows.map(function (x) { return x | 0; });
    this._rollSeconds = r.rolls.seconds === true;
    this._base = +r.baseline;
    this._trees = r.trees.map(function (t) {
      return { f: Int32Array.from(t.f), thr: Float64Array.from(t.thr), l: Int32Array.from(t.l), r: Int32Array.from(t.r),
        leaf: Uint8Array.from(t.leaf.map(function (x) { return (x | 0) !== 0 ? 1 : 0; })), v: Float64Array.from(t.v) };
    });
    this._capB = +r.caption.intercept;
    this._capW = new Map();
    var w = r.caption.weights;
    for (var k in w) if (Object.prototype.hasOwnProperty.call(w, k)) this._capW.set(k, +w[k]);
    this._on = +r.policy.on; this._off = +r.policy.off; this._hold = r.policy.hold | 0;
    this._offHold = typeof r.policy.offHold === 'number' ? r.policy.offHold : 0;
    this._offDeep = typeof r.policy.offDeep === 'number' ? r.policy.offDeep : 0;
    this.Trained = typeof r.trained === 'number' ? r.trained | 0 : 0;
    this._vocabExtra = new Set();
    var maxW = -Infinity; for (var i = 0; i < this._rollWindows.length; i++) if (this._rollWindows[i] > maxW) maxW = this._rollWindows[i];
    this._maxW = maxW;
  }
  /** A detector from the parsed learned.json, or null when it does not read. */
  LearnedBreak.fromJson = function (obj) { try { return new LearnedBreak(typeof obj === 'string' ? JSON.parse(obj) : obj); } catch (e) { return null; } };

  /** One window's running state (JSON-able). */
  LearnedBreak.prototype.NewState = function () { return { hist: {}, histT: {}, caps: [], run: 0, belowSince: -1, up: false, lastP: 0 }; };

  /** The caption classifier's tokens of a line, in the order the host's HashSet holds them. */
  LearnedBreak.CapTokens = function (x) {
    var words = [], re = /[a-z0-9']+/g, m, lo = cs.lower(x);
    while ((m = re.exec(lo)) !== null) if (m[0].length >= 2) words.push(m[0]);
    var toks = new Set(words);
    for (var i = 0; i + 1 < words.length; i++) toks.add(words[i] + ' ' + words[i + 1]);
    var u = urlMark(); u.lastIndex = 0; if (u.test(x)) toks.add('_url');
    var p = phoneMark(); p.lastIndex = 0; if (p.test(x)) toks.add('_phone');
    if (x.indexOf('>>') >= 0) toks.add('_speaker');
    if (x.indexOf('?') >= 0) toks.add('_question');
    if (tagMark.test(x)) toks.add('_tag');
    return toks;
  };
  /** How much a caption line reads like an ad (0 to 1). */
  LearnedBreak.prototype.CaptionScore = function (line) {
    var sum = 0, n = 0, self = this;
    LearnedBreak.CapTokens(line).forEach(function (t) {
      var w = self._capW.get(t);
      if (w !== undefined) { sum += w; n++; }
      else if (self._vocabExtra.has(t)) n++;
    });
    var z = this._capB + (n > 0 ? sum / Math.sqrt(n) : 0);
    return 1 / (1 + cs.exp(-z));
  };
  LearnedBreak.prototype.Caption = function (s, line, t) {
    s.caps.push([t, this.CaptionScore(line)]);
    while (s.caps.length > 0 && t - s.caps[0][0] > 60) s.caps.shift();
  };

  /** The trees' chance of an ad at t, from the break model's readings (BreakModel.FeatureNames order) and print_seen. */
  // coverUp (2026-11-06): 1 when this look was taken through Veil's own cover (the tab's stream holds it), as the bench's cover_up
  // clockSec (2026-11-06): the local time of day in seconds, for a model trained with the minute of the hour (bench CLOCK=1)
  LearnedBreak.prototype.Score = function (s, readings, printSeen, t, coverUp, clockSec) {
    var names = ns.BreakModel.FeatureNames, byName = new Map(), i, k;
    for (i = 0; i < names.length && i < readings.length; i++) byName.set(names[i], cs.roundAway(readings[i], 3));
    byName.set('print_seen', printSeen);
    byName.set('cover_up', coverUp || 0);
    if (typeof clockSec === 'number' && isFinite(clockSec)) byName.set('minute_of_hour', cs.roundAway((((clockSec % 3600) + 3600) % 3600) / 60, 3));
    var x = [];
    for (i = 0; i < this._inputs.length; i++) {
      var n = this._inputs[i];
      if (this._skip.has(n)) continue;
      var v = byName.has(n) ? byName.get(n) : 0;
      if (n.indexOf('since_') === 0) for (k = 0; k < this._kernels.length; k++) x.push(cs.exp(-v / this._kernels[k]));
      else x.push(v);
    }
    var maxW = this._maxW, w, sum;
    for (i = 0; i < this._rollSignals.length; i++) {
      var sig = this._rollSignals[i];
      var sv = byName.has(sig) ? byName.get(sig) : 0;
      if (this._rollSeconds) {
        var ht = s.histT[sig] || (s.histT[sig] = []);
        ht.push([t, sv]);
        while (ht.length > 0 && ht[0][0] <= t - maxW) ht.shift();
        for (k = 0; k < this._rollWindows.length; k++) {
          w = this._rollWindows[k]; sum = 0; var cnt = 0;
          for (var j = ht.length - 1; j >= 0 && ht[j][0] > t - w; j--) { sum += ht[j][1]; cnt++; }
          x.push(sum / Math.max(1, cnt));
        }
        continue;
      }
      var h = s.hist[sig] || (s.hist[sig] = []);
      h.push(sv);
      if (h.length > maxW) h.shift();
      for (k = 0; k < this._rollWindows.length; k++) {
        w = this._rollWindows[k]; sum = 0;
        for (var j2 = Math.max(0, h.length - w); j2 < h.length; j2++) sum += h[j2];
        x.push(sum / w);
      }
    }
    function M(win) {
      var tot = 0, c = 0;
      for (var q = 0; q < s.caps.length; q++) { var ct = s.caps[q][0]; if (ct >= t - win && ct <= t) { tot += s.caps[q][1]; c++; } }
      return c > 0 ? tot / c : 0.5;
    }
    x.push(M(8)); x.push(M(20));
    var lines = 0, last = NaN;
    for (i = 0; i < s.caps.length; i++) {
      var ct2 = s.caps[i][0];
      if (ct2 >= t - 20 && ct2 <= t) lines++;
      if (ct2 <= t && (last !== last || ct2 > last)) last = ct2;
    }
    x.push(lines);
    x.push(last !== last ? 60 : Math.min(60, t - last));
    var z = this._base;
    for (i = 0; i < this._trees.length; i++) {
      var tr = this._trees[i], node = 0;
      while (!tr.leaf[node]) node = x[tr.f[node]] <= tr.thr[node] ? tr.l[node] : tr.r[node];
      z += tr.v[node];
    }
    var p = 1 / (1 + cs.exp(-z));
    s.lastP = p;
    return p;
  };

  /** The cover policy. strict: the logo sits in a band that stays put (B-476): a tenth higher and twice the looks. */
  LearnedBreak.prototype.Decide = function (s, p, t, strict) {
    if (t === undefined) t = NaN;
    var bs = !!strict && ns.BreakModel.BandStrict;
    var on = bs ? Math.min(0.95, this._on + 0.1) : this._on, hold = bs ? this._hold * 2 : this._hold;
    s.run = p > on ? s.run + 1 : 0;
    if (!s.up) { s.belowSince = -1; if (s.run >= hold) s.up = true; }
    else if (p >= this._off) s.belowSince = -1;
    else if (this._offHold <= 0 || t !== t || p < this._offDeep) { s.up = false; s.belowSince = -1; }
    else {
      if (s.belowSince < 0) s.belowSince = t;
      if (t - s.belowSince >= this._offHold) { s.up = false; s.belowSince = -1; }
    }
    return s.up;
  };

  ns.LearnedBreak = LearnedBreak;
})(typeof globalThis !== 'undefined' ? globalThis : this);
