/* PRISM break watch, browser port: BreakModel (2026-11-06).
 * A line-for-line port of the Windows host's per-window break model (targets/win-host/PrismHost/Services/BreakModel.cs): a live
 * channel's commercial break read off a 320x180 grey picture, the channel's learned corner logo, cuts, blacks, credits, the bottom
 * band, the inset picture, the captions' words (Text with spoken: true), the page's meter, silences, the stream's ad cue, and the
 * model inputs the learned detector reads (features). Same numbers in the same order: C# float arithmetic is kept with
 * Float32Array and Math.fround, so a recorded day replayed here gives the bench's readings exactly (scripts/breakwatch/parity-js.mjs).
 * Qr() is the host's own finder of three finder squares (ported 2026-11-06); left out: the host's OCR (Text still reads any text given).
 * Learned logo state: load()/save() read and write the host's binary .logo (version 3), loadState()/saveState() a JSON object.
 * Requires cs.js first. Classic script, no DOM, no network. Pure ASCII source. */
(function (root) {
  'use strict';
  var ns = root.PrismBreak || (root.PrismBreak = {});
  if (typeof module === 'object' && module && module.exports) module.exports = ns;
  if (!ns.cs && typeof require === 'function') require('./cs.js');
  var cs = ns.cs;
  var fr = Math.fround;

  var W = 320, H = 180, CH = 45, CW = 80;
  var CORNERS = [[0, 0], [0, 240], [135, 0], [135, 240]];
  var STEADY_AT = fr(0.5);
  var LEARN_FRAMES = 480;
  var BY0 = H - 36, BH = 36;

  var FEATURE_NAMES = ['logo', 'logo_seen', 'logo_ratio', 'since_logo_up', 'absent_for', 'change', 'mean', 'std', 'since_black', 'since_cut',
    'since_ad_text', 'since_show_text', 'since_show_card', 'since_promo', 'since_snipe', 'since_badge', 'since_cc_ad', 'since_cc_line', 'since_game', 'since_qr',
    'since_sound', 'since_credits', 'known_ad', 'chance', 'active', 'near_edge', 'has_logo', 'set_aside', 'game_words', 'cue_on', 'since_cue_stop', 'since_cue_predict',
    'since_silence', 'db', 'peak', 'db_seen', 'db_d30', 'db_m5', 'cuts_30', 'cuts_60', 'spot_gap', 'beats_black', 'beats_any', 'since_known_pic', 'since_ad_seen'];

  // ---- the screen's and the captions' words (the .NET patterns, made over code units by cs.netRegex) ----
  var R = {
    badge: cs.lazyRegex('^\\s*(tv[ -]?)?(14|pg|ma|y7|g)\\s*$|tv[ -]?(14|pg|ma|y7)\\b', 'i'),
    snipe: cs.lazyRegex('all[- ]new|\\b(sun|mon|tues|wednes|thurs|fri|satur)days\\b|season premiere|series premiere|season finale|series finale|marathon|new episodes?|premieres?\\b|(january|february|march|april|may|june|july|august|september|october|november|december) \\d{1,2}\\b|\\btonight\\b|\\b\\d{1,2}/\\d{1,2}c\\b', 'i'),
    url: cs.lazyRegex('\\b(www\\.[a-z0-9-]+|[a-z0-9-]{2,}\\.(com|org|net|tv|app|io|ly|co|now|news|shop|store|ai|us|me|plus|health|live|link))\\b(/[a-z0-9/-]*)?', 'gi'),
    phone: cs.lazyRegex('\\b1?[-. (]{0,2}[2-9]\\d{2}[-. )]{1,2}\\d{3}[-. ]\\d{4}\\b|\\b1-8\\d\\d-[A-Z0-9-]{7,}\\b', 'g'),
    nonDigit: cs.lazyRegex('\\D', 'g'),
    adWords: cs.lazyRegex('[a-z0-9]+ dot com\\b|call 1[- ]?8\\d\\d|1-800|toll[- ]free|download the app|app store|google play|get it on|terms apply|restrictions apply|see store|visit [a-z0-9-]+\\.|call now|scan (the )?code|order now|order online|shop now|learn more|we.ll be right back|ask your doctor|side effects|tickets on sale|in theat(er|re)s|only in theat|stream(ing)? now|now streaming|free trial|limited time|while supplies last|see dealer|msrp|\\bapr\\b|% off|\\$\\d+(\\.\\d\\d(/mo| a month| per month)?|/mo| a month| per month)|offer ends|sign up today|apply now|get started at|join now|become a member', 'gi'),
    promoWords: cs.lazyRegex('set your dvr|season finale|series finale|season premiere|series premiere|\\b\\d{1,2}(:\\d\\d)?/\\d{1,2}(:\\d\\d)?c\\b', 'i'),
    sponsorTag: cs.lazyRegex('\\bcontinues\\b|presented by|brought to you by|\\b(alds|nlds|alcs|nlcs)\\b', 'i'),
    showCard: cs.lazyRegex('the following program|viewer discretion|\\btv[- ]?(y7|y|g|pg|14|ma)[ -]+[dlsv]{1,4}\\b', 'i'),
    showWords: cs.lazyRegex('directed by|produced by|executive producer|co-producer|written by|teleplay|created by|starring|the following program|viewer discretion|music by|pictures present|pictures and .{3,40} present|a film by|in association with|based on the (novel|book)|guest star|\\btv[- ]?(y7|y|g|pg|14|ma)[ -]+[dlsv]{1,4}\\b', 'i'),
    paidCard: cs.lazyRegex('\\b(the following|this) (is|was) a paid (program|programme|presentation)\\b', 'i'),
    paidOpen: cs.lazyRegex('\\bthe\\s*following\\s*(?:(?:is|was)\\s*a\\s*paid\\s*(?:program|programme|presentation|advertisement)|program(?:me)?\\s*is\\s*(?:sponsored|paid\\s*for)\\s*by)', 'i'),
    paidClose: cs.lazyRegex('\\bthe\\s*preceding\\s*(?:program(?:me)?\\s*)?(?:was|has\\s*been)\\s*(?:a\\s*paid\\s*(?:program|programme|presentation|advertisement)|sponsored\\s*by|paid\\s*for\\s*by)', 'i')
  };
  function test(re, s) { var r = re(); r.lastIndex = 0; return r.test(s); }
  function match(re, s) { var r = re(); r.lastIndex = 0; return r.exec(s); }
  function matches(re, s) { var r = re(); r.lastIndex = 0; var out = [], m; while ((m = r.exec(s)) !== null) { out.push(m[0]); if (m[0].length === 0) r.lastIndex++; } return out; }
  function asciiMatches(re, s) { re.lastIndex = 0; var out = [], m; while ((m = re.exec(s)) !== null) out.push(m[0]); return out; }

  var GAME_WORDS = new Set([
    'inning', 'innings', 'pitch', 'pitches', 'pitched', 'pitcher', 'pitchers', 'pitching', 'strikeout', 'strikeouts', 'bullpen', 'homer', 'homers',
    'homered', 'batter', 'hitter', 'hitters', 'catcher', 'dugout', 'rbi', 'rbis', 'bunt', 'slider', 'fastball', 'curveball', 'changeup', 'sinker',
    'cutter', 'grounder', 'flyout', 'infield', 'outfield', 'shortstop', 'umpire', 'baserunner', 'doubleplay', 'southpaw', 'lefty', 'righty',
    'quarterback', 'touchdown', 'interception', 'linebacker', 'sideline', 'endzone', 'scrimmage', 'punt', 'rebound', 'rebounds', 'layup',
    'dunk', 'pointer', 'puck', 'goalie', 'faceoff', 'powerplay', 'penalty', 'crossbar', 'offside',
    'replay', 'review', 'overturned', 'overturn', 'foul', 'umpires', 'challenge'
  ]);

  function lettersOnly(s) { var o = ''; for (var i = 0; i < s.length; i++) if (cs.isLetter(s[i])) o += s[i]; return o; }
  // two readings of the same words (the scenery rule): five letters in a row in common, ignoring everything but letters
  function sameStem(a, b) {
    if (a === b) return true;
    var x = lettersOnly(a), y = lettersOnly(b);
    for (var i = 0; i + 5 <= x.length; i++) if (y.indexOf(x.substr(i, 5)) >= 0) return true;
    return false;
  }
  // an address with under four letters before its dot (tg.com, l.cnm): a piece of something the reader half saw
  function fragment(tk) {
    if (tk.indexOf('www.') === 0) tk = tk.substring(4);
    var dot = tk.indexOf('.');
    var anyDigit = false, anyLetter = false;
    for (var i = 0; i < tk.length; i++) { if (cs.isDigit(tk[i])) anyDigit = true; if (cs.isLetter(tk[i])) anyLetter = true; }
    if (dot < 0 || tk.indexOf('/') >= 0 || (anyDigit && !anyLetter)) return false;
    var n = 0; for (var k = 0; k < dot; k++) if (cs.isLetter(tk[k])) n++;
    return n < 4;
  }
  // a whole word, ignoring case (string.IndexOf OrdinalIgnoreCase; a letter or digit on neither side)
  function hasWord(s, w) {
    var su = s.toUpperCase().length === s.length ? s.toUpperCase() : null, wu = w.toUpperCase().length === w.length ? w.toUpperCase() : null;
    var hay = su !== null && wu !== null ? su : s, needle = su !== null && wu !== null ? wu : w;
    for (var i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
      var before = i === 0 || !cs.isLetterOrDigit(s[i - 1]);
      var after = i + w.length >= s.length || !cs.isLetterOrDigit(s[i + w.length]);
      if (before && after) return true;
    }
    return false;
  }
  function grams(text) {
    var w = asciiMatches(/[a-z']+/g, cs.lower(text));
    var g = new Set();
    for (var i = 0; i + 2 < w.length; i++) g.add(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]);
    return g;
  }

  // ---- the picture ----
  function meanAbsDiff(a, b) {
    var d = 0; for (var i = 0; i < a.length; i += 3) d += Math.abs(a[i] - b[i]);
    return d / ((a.length / 3) | 0);
  }
  function edges(g) {
    var e = new Float32Array(W * H);
    for (var y = 1; y < H - 1; y++)
      for (var x = 1; x < W - 1; x++) {
        var i = y * W + x;
        var gx = g[i + 1] - g[i - 1], gy = g[i + W] - g[i - W];
        e[i] = Math.sqrt(gx * gx + gy * gy);   // exact in float (integers under 2^24); the store rounds the root as MathF.Sqrt does
      }
    return e;
  }
  // the picture less its 9x9 local mean
  function highPass(g) {
    var ii = new Float64Array((W + 1) * (H + 1));
    for (var y = 0; y < H; y++) {
      var row = 0;
      for (var x = 0; x < W; x++) { row += g[y * W + x]; ii[(y + 1) * (W + 1) + x + 1] = ii[y * (W + 1) + x + 1] + row; }
    }
    var hp = new Float32Array(W * H);
    for (var y2 = 0; y2 < H; y2++) {
      var y0 = Math.max(0, y2 - 4), y1 = Math.min(H, y2 + 5);
      for (var x2 = 0; x2 < W; x2++) {
        var x0 = Math.max(0, x2 - 4), x1 = Math.min(W, x2 + 5);
        var sum = ii[y1 * (W + 1) + x1] - ii[y0 * (W + 1) + x1] - ii[y1 * (W + 1) + x0] + ii[y0 * (W + 1) + x0];
        hp[y2 * W + x2] = g[y2 * W + x2] - fr(sum / ((y1 - y0) * (x1 - x0)));
      }
    }
    return hp;
  }
  function creditsLook(g) {
    function dark(y0, y1, x0, x1) {
      var n = 0, d = 0;
      for (var y = y0; y < y1; y += 2) for (var x = x0; x < x1; x += 2) { n++; if (g[y * W + x] < 25) d++; }
      return n === 0 ? 0 : d / n;
    }
    var all = dark(0, H, 0, W);
    if (all > 0.9) return true;
    if (dark((H * 2 / 3) | 0, H, 0, W) > 0.85 && dark(0, (H / 2) | 0, 0, W) < 0.6) return true;   // squeezed up
    if (dark(0, H, (W * 2 / 3) | 0, W) > 0.85 && dark(0, H, 0, (W / 2) | 0) < 0.6) return true;   // squeezed left
    return false;
  }
  function countSteady(s) { var c = 0; for (var i = 0; i < s.length; i++) if (s[i] > STEADY_AT) c++; return c; }

  function BreakModel() {
    this._steady = []; this._pattern = [];
    for (var k = 0; k < 4; k++) { this._steady.push(new Float32Array(CH * CW)); this._pattern.push(new Float32Array(CH * CW)); }
    this._n = 0; this._corner = -1; this._prev = null; this._pb = 0.05;
    this._lastBlack = -99; this._since = 0;
    this._adTextAt = -99; this._showTextAt = -99;
    this._adTextPrevAt = -999; this._logoUpAt = -99;
    this._bareAdAt = -99; this._bareAdPrevAt = -999;
    this._tokenSpan = new Map(); this._scenery = new Map();
    this._gameWords = []; this._gameSaidAt = -99;
    this._showCardAt = -99;
    this._promoAt = -99; this._promoLogoAt = -1;
    this._snipeAt = -99; this._quickCover = false;
    this._ccLineAt = -999;
    this._badgeAt = -99; this._promoCover = false;
    this._showTokens = new Map();
    this.Active = false;
    this.LogoScore = null;
    this.Relearned = false;
    this._absentSince = -1; this._startT = -1; this._sureSince = -1; this._showTextUsed = -99; this._qrAt = -99;
    this._endedAt = -999; this._cutAt = -999;
    this._logoBack = 0;
    this._adSeenAt = -999; this._wordSeenAt = -999;
    this._staleUntilLogo = false;
    this._creditsAt = -999; this._changedAt = -999;
    this._sureOnCut = false;
    this._suspended = false; this._suspendedAt = 0; this._seenAgain = 0; this._resumeSuspended = false;
    this.NearEdge = false; this.EdgeKnown = false; this.AdFreeChannel = false;
    this._dismissedUntil = -1;
    this._scores = []; this._level = 0.6;
    this.Why = ''; this.Hold = '';
    this._lastChange = 0; this._lastMean = 0; this._lastStd = 0;
    this._printHits = []; this._knownPicAt = -999; this._soundAt = -999;
    this._cueUntil = -1; this._cueReadUntil = -1; this._cueAt = -999; this._cueStopAt = -999; this._cuePredictAt = -999;
    this._cueComingAt = -999;
    this.TickerChannel = false;
    this._logoInBandShare = 0;
    this._bandSteady = new Float32Array(BH * W); this._bandN = 0; this.BandAtBottom = false;
    this._bandLit = false;
    this._insetSince = -1; this._insetAt = -999; this._insetFrameAt = -999; this._fullRun = 0;
    this._insetProgramme = false; this._fullSince = -1; this._insetSum = 0; this._insetPrev = -999; this._insetSeen = [];
    this._insetOnAt = -999; this._tailAt = -999; this._awaySince = -1; this._tailUps = 0; this._tailOn = false;
    this._blacks = [];
    this._phones = new Map(); this._infomercialAt = -999;
    this.PaidOpenAt = -9999; this.PaidCloseAt = -9999; this.PaidCardAt = -9999; this.PaidCardFollowing = false;
    this._stands = new Map(); this._phoneStandAt = -999; this._addressStandAt = -999;
    this.ShowTitle = ''; this.ChannelName = '';
    this._showLines = []; this._logoPlainAt = -99;
    this._ccWordsAt = -99; this._ccQuietSince = -1; this._stillSince = -1; this._ccAdAt = -99;
    this._silenceAt = -999;
    this._cuts = []; this._bounds = [];
    this._db = -120; this._peakDb = -120; this._dbAt = -999; this._dbHist = [];
    this._logoContrast = 1;
  }
  BreakModel.W = W; BreakModel.H = H;
  BreakModel.FeatureNames = FEATURE_NAMES;
  // the tunables (static in C#)
  BreakModel.SureSeconds = 30;
  BreakModel.RecoverSeconds = 45;
  BreakModel.StaleSeconds = 60;
  BreakModel.ShowCardQuiet = 90;
  BreakModel.CutDiff = 60; BreakModel.CutWindow = 3; BreakModel.CutSureSeconds = 30;
  BreakModel.InsetAnywhere = false;
  BreakModel.BandLogo = true;
  BreakModel.BandStrict = true;
  BreakModel.MinLogoContrast = 0.45;

  var P = BreakModel.prototype;
  Object.defineProperty(P, 'LastAdTextAt', { get: function () { return this._adTextAt; } });
  Object.defineProperty(P, 'Chance', { get: function () { return this._pb; } });
  Object.defineProperty(P, 'HasLogo', { get: function () { return this._corner >= 0 && this._n >= LEARN_FRAMES; } });
  Object.defineProperty(P, 'Suspended', { get: function () { return this._suspended; } });
  Object.defineProperty(P, 'LogoInBand', { get: function () { return BreakModel.BandLogo && !this.TickerChannel && this.HasLogo && this._corner >= 2 && this.BandAtBottom && this._logoInBandShare >= 0.6; } });
  Object.defineProperty(P, 'InsetArmed', { get: function () { return this.TickerChannel || BreakModel.InsetAnywhere; } });
  Object.defineProperty(P, 'InsetProgramme', { get: function () { return this.InsetArmed && this._insetProgramme; } });
  Object.defineProperty(P, 'ActiveSince', { get: function () { return this.Active ? this._since : NaN; } });
  Object.defineProperty(P, 'LogoUpNow', { get: function () { return this.HasLogo && !this._suspended && this.LogoScore !== null && this.LogoScore / this._level >= 0.6; } });
  Object.defineProperty(P, 'LogoAwayNow', { get: function () { return this.HasLogo && !this._suspended && this.LogoScore !== null && this.LogoScore / this._level < 0.3; } });

  P.Undismiss = function (t) { if (t >= this._dismissedUntil) return false; this._dismissedUntil = -1; return true; };
  P.DismissedAt = function (t) { return t < this._dismissedUntil; };
  P.Dismiss = function (t) {
    this._dismissedUntil = t + 300; this._pb = 0.02; this._sureSince = -1; this._endedAt = -999; this._changedAt = t;
    var was = this.Active; this.Active = false; return was;
  };
  P.SetAside = function () { this._suspended = true; this._resumeSuspended = true; this._seenAgain = 0; };

  P.Features = function (t) {
    function S(at) { return Math.min(120, Math.max(0, t - at)); }
    var l = this.LogoScore, gw = 0;
    for (var i = 0; i < this._gameWords.length; i++) if (t - this._gameWords[i][0] <= 300) gw += this._gameWords[i][1];
    return [l === null ? 0 : l, l === null ? 0 : 1, l !== null ? l / this._level : 0, S(this._logoUpAt), this._absentSince < 0 ? 0 : Math.min(600, t - this._absentSince),
      this._lastChange, this._lastMean, this._lastStd, S(this._lastBlack), S(this._cutAt), S(this._adTextAt), S(this._showTextAt), S(this._showCardAt), S(this._promoAt), S(this._snipeAt), S(this._badgeAt), S(this._ccAdAt),
      S(this._ccLineAt), S(this._gameSaidAt), S(this._qrAt), S(this._soundAt), S(this._creditsAt), this._knownAd(t) ? 1 : 0, this._pb, this.Active ? 1 : 0, this.NearEdge ? 1 : 0, this.HasLogo ? 1 : 0, this._suspended ? 1 : 0,
      gw, t < this._cueReadUntil ? 1 : 0, S(this._cueStopAt), S(this._cuePredictAt),
      S(this._silenceAt), this._soundNow(t), this._peakDb, t - this._dbAt <= 3 ? 1 : 0, this._soundStep(t), this._soundMean(t, 5),
      this._cutsIn(t, 30), this._cutsIn(t, 60), this._spotGap(t), this._beats(t, false), this._beats(t, true), S(this._knownPicAt), S(this._adSeenAt)];
  };

  /** One frame (W x H grey bytes) at time t (seconds), dt seconds after the last. Returns true when Active changed. */
  P.Step = function (gIn, t, dt) {
    if (gIn.length !== W * H) return false;
    var g = gIn instanceof Uint8Array ? new Uint8Array(gIn) : Uint8Array.from(gIn);   // kept as the next frame's "before": a copy, the caller may reuse its buffer
    var change = this._prev === null ? 0 : meanAbsDiff(g, this._prev);
    this._lastChange = change;
    if (this._prev !== null && change < 0.4) { if (this._stillSince < 0) this._stillSince = t; return false; }
    this._stillSince = -1;
    if (change >= BreakModel.CutDiff) { this._cutAt = t; this._cuts.push(t); while (this._cuts.length > 0 && t - this._cuts[0] > 60) this._cuts.shift(); }
    this._prev = g;
    this._readInset(g, t);
    if (this._startT < 0) { this._startT = t; if (this._resumeSuspended) { this._suspendedAt = t; this._resumeSuspended = false; } }
    if (t - this._startT < 12) return false;
    var mean = 0, sq = 0;
    for (var q = 0; q < g.length; q++) { var v = g[q]; mean += v; sq += v * v; }
    mean /= g.length; var std = Math.sqrt(Math.max(0, sq / g.length - mean * mean));
    var black = mean < 20 && std < 8;
    this._lastMean = mean; this._lastStd = std;
    if (!black && creditsLook(g)) this._creditsAt = t;
    var e = edges(g), hp = highPass(g);
    if (!black) this._readBand(e);
    var learn = (!this.HasLogo || this._pb < 0.3) && !black;
    if (learn) {
      var a = this._n < LEARN_FRAMES ? fr(1 / (this._n + 1)) : fr(1 / LEARN_FRAMES);
      for (var k = 0; k < 4; k++) {
        if (this._corner >= 0 && k !== this._corner) continue;
        var y0 = CORNERS[k][0], x0 = CORNERS[k][1], s = this._steady[k], p = this._pattern[k];
        for (var y = 0; y < CH; y++)
          for (var x = 0; x < CW; x++) {
            var i = (y0 + y) * W + x0 + x, j = y * CW + x;
            var rim = x0 + x < 3 || x0 + x > W - 4 || y0 + y < 3 || y0 + y > H - 4;
            s[j] = s[j] + fr(a * fr((!rim && e[i] > 25 ? 1 : 0) - s[j]));
            p[j] = p[j] + fr(a * fr(hp[i] - p[j]));
          }
      }
    }
    this._n++;
    if (this._corner < 0 && this._n >= LEARN_FRAMES) {
      var best = -1, bestN = 0;
      for (var k2 = 0; k2 < 4; k2++) { var c = countSteady(this._steady[k2]); if (c > bestN) { bestN = c; best = k2; } }
      if (bestN >= 15) this._corner = best;
    }

    var llr = 0, why = [];
    this.LogoScore = null;
    var faint = false;
    if (this.HasLogo && !black) { var m0 = this._logoMatch(hp); faint = this._logoContrast < BreakModel.MinLogoContrast && m0 / this._level < 0.6; }
    if (faint) why.push("logo can't be seen");
    var inBand = this.LogoInBand;
    if (inBand && !faint) why.push('logo in a band that stays put');
    if (this.HasLogo && !black && !faint && !inBand) {
      var sc = this._logoMatch(hp);
      this.LogoScore = sc;
      if (!this.Active) { this._scores.push(sc); if (this._scores.length > 800) this._scores.shift(); }
      if (this._scores.length >= 400 && this._scores.length % 20 === 0) {
        var sorted = Float64Array.from(this._scores).sort();
        this._level = Math.max(cs.clamp(sorted[(sorted.length * 0.75) | 0], 0.35, 1.0), this._level * 0.8);
      }
      var z = sc / this._level;
      if (this._suspended) {
        this._seenAgain = z >= 0.6 ? this._seenAgain + 1 : 0;
        if (this._seenAgain >= 2) { this._suspended = false; this._absentSince = -1; why.push('logo back'); }
        else if (t - this._suspendedAt > 1200) { this._reset(); var w0 = this.Active; this.Active = false; this.Why = 'logo given up'; return w0; }
        else why.push('logo set aside');
      }
      this._logoBack = !this._suspended && z >= 0.8 ? this._logoBack + 1 : 0;
      var promoHold = this.Active && t - this._promoAt <= 5 && (this._promoLogoAt < 0 || t - this._promoLogoAt <= 35);
      if (promoHold && this._logoBack >= 2 && this._promoLogoAt < 0) this._promoLogoAt = t;
      if (!this.Active || t - this._promoAt > 5) this._promoLogoAt = -1;
      if (promoHold) { this._logoBack = 0; why.push('promo'); }
      if (this.Active && this._logoBack >= 2) this._pb = Math.min(this._pb, 0.3);
      if (!this._suspended) {
        llr += promoHold ? 1.0 : z < 0.12 ? 2.5 : z < 0.22 ? 1.0 : z < 0.4 ? -0.3 : z < 0.6 ? -1.2 : -2.5;
        why.push('logo ' + cs.format(sc, 2, false) + '/' + cs.format(this._level, 2, false));
      }
      if (!this._suspended) {
        if (z >= 0.6) { this._absentSince = -1; this._logoUpAt = t; }
        else if (this._absentSince < 0) this._absentSince = t;
        var lastAd = Math.max(this._adTextAt, this._qrAt);
        if (this._absentSince >= 0 && (t - this._absentSince > 360 || (t - this._absentSince > 240 && t - lastAd > 60))) {
          this._suspended = true; this._suspendedAt = t; this._seenAgain = 0; this._pb = Math.min(this._pb, 0.1);
          why.push('logo gone longer than a break');
        }
      }
    }
    if (black) { if (t - this._lastBlack > 2) this._boundary(t, true); this._lastBlack = t; why.push('black'); this._blacks.push(t); }
    this._readInsetTail(t);
    while (this._blacks.length > 0 && t - this._blacks[0] > 8) this._blacks.shift();
    var logoUp = this.LogoScore !== null && this.LogoScore / this._level >= 0.6;
    var showSaid = t - this._showTextAt <= 10;
    var gameSaid = t - this._gameSaidAt <= 10;
    var gameShow = gameSaid && (!this.HasLogo || this._suspended || !this.Active || t - this._since > 10);
    if (gameShow) { showSaid = true; llr -= 3.0; why.push('game commentary'); }
    var logoAway = this.HasLogo && !this._suspended && this.LogoScore !== null && this.LogoScore / this._level < 0.3;
    var faintOk = faint && this.HasLogo && !this._suspended && t - this._logoUpAt >= 15 && this._adTextAt - this._adTextPrevAt <= 8 && t - this._showTextAt > 60;
    var bare = (!this.HasLogo || this._suspended) && t - this._bareAdAt <= 5 && this._bareAdAt - this._bareAdPrevAt <= 8 && t - this._showTextAt > 60 && t - this._gameSaidAt > 20;
    if (bare) why.push('ad text, no logo');
    var adText = (t - this._adTextAt <= 5 && (logoAway || faintOk) && !showSaid) || bare;
    if (adText && faintOk && !logoAway) why.push('corner flat');
    if (adText) { llr += 3.0; why.push('ad text'); }
    if (t - this._ccAdAt <= 5 && this.HasLogo && !logoUp && !showSaid) { llr += 1.0; why.push('ad words heard'); }
    else if (t - this._showTextAt <= 5) { llr -= 3.0; why.push('show text'); if (t - this._showCardAt <= 5 && this._showCardAt > this._showTextUsed) { this._showTextUsed = this._showCardAt; this._pb = Math.min(this._pb, 0.2); this._endedAt = -999; } }
    if (t - this._qrAt <= 5 && t - this._adTextAt > 5 && !logoUp) { llr += 2.0; why.push('qr code'); }
    var known = (this._knownAd(t) || t - this._soundAt <= 3) && this.HasLogo && !this._suspended;
    if (known && !logoUp) { llr += 3.0; why.push('known ad'); }

    if (!this.HasLogo || this._suspended) {
      if (t - this._adTextAt > 5 && t - this._showTextAt > 5) llr -= 0.8;
    }
    var cut = t - this._lastBlack <= 4;
    var pin = cut ? 0.08 : dt / 480, pout = cut ? 0.08 : dt / 210;
    if (this.Active && t - this._since > 300) pout = Math.max(pout, dt / 30);
    var pb = this._pb * (1 - pout) + (1 - this._pb) * pin;
    var o = pb / (1 - pb) * cs.exp(llr * dt / 2);
    this._pb = cs.clamp(o / (1 + o), 0.002, 0.995);
    this.Why = why.join(', ');
    var was = this.Active;
    if (this._pb >= 0.9) { if (this._sureSince < 0) { this._sureSince = t; this._sureOnCut = t - this._cutAt <= BreakModel.CutWindow; } } else this._sureSince = -1;
    var wait = this._sureOnCut ? BreakModel.CutSureSeconds : BreakModel.SureSeconds;
    if (t - this._showCardAt < BreakModel.ShowCardQuiet) wait = Infinity;
    if (t - this._snipeAt <= 6 && t - this._ccLineAt <= 8) wait = Infinity;
    var justBroke = t - this._endedAt < BreakModel.RecoverSeconds;
    var knownOk = (this._knownAd(t) || t - this._soundAt <= 3) && this.HasLogo && !this._suspended && t - this._changedAt > 30;
    var said = adText || ((t - this._qrAt <= 5 || knownOk) && !logoUp && !showSaid);
    var worded = adText || (t - this._qrAt <= 5 && !logoUp && !showSaid) || (t - this._ccAdAt <= 5 && !showSaid);
    if (worded) this._wordSeenAt = t;
    if (worded || (knownOk && !logoUp && !showSaid)) this._adSeenAt = t;
    if (this.Active && (this.NearEdge || !this.EdgeKnown) && t - Math.max(this._adSeenAt, this._since) > BreakModel.StaleSeconds) { this._pb = Math.min(this._pb, 0.3); this._staleUntilLogo = true; }
    if (this._staleUntilLogo && this._logoBack >= 2) this._staleUntilLogo = false;
    if (this._staleUntilLogo && !said) wait = Infinity;
    var credits = t - this._creditsAt <= 10 && (this.NearEdge || !this.EdgeKnown);
    if (credits && !said) wait = Infinity;
    if (this.Active && credits && t - this._adSeenAt > 10) this._pb = Math.min(this._pb, 0.3);
    if (this.NearEdge) {
      said = adText || (t - this._qrAt <= 5 && !logoUp && !showSaid);
      wait = Infinity;
      if (this.Active && t - this._wordSeenAt > 20) this._pb = Math.min(this._pb, 0.3);
    }
    var cueOn = t < this._cueUntil;
    if (cueOn) { said = true; this._adSeenAt = t; this._pb = Math.max(this._pb, 0.95); why.push("the stream's ad cue"); }
    if (this.AdFreeChannel || t < this._dismissedUntil) { said = false; wait = Infinity; this._pb = Math.min(this._pb, 0.05); }
    var gwN = 0; for (var gi = 0; gi < this._gameWords.length; gi++) if (t - this._gameWords[gi][0] <= 300) gwN += this._gameWords[gi][1];
    var inGame = gwN >= 6;
    var quick = justBroke && !credits && !this._staleUntilLogo && !this.NearEdge && !this.AdFreeChannel && !inGame;
    var settled = t - this._changedAt >= 8;
    this.Hold = this.Active || this._sureSince < 0 ? '' : 'wait ' + cs.format(wait, 0, false) + 's sure ' + cs.format(t - this._sureSince, 0, false) + 's said ' + (said ? 'True' : 'False') +
      ' settled ' + (settled ? 'True' : 'False') + ' stale ' + (this._staleUntilLogo ? 'True' : 'False') + ' credits ' + (credits ? 'True' : 'False') +
      ' card ' + (t - this._showCardAt < BreakModel.ShowCardQuiet ? 'True' : 'False') + ' near ' + (this.NearEdge ? 'True' : 'False');
    if (!this.Active && this._sureSince >= 0 && (said || ((quick || t - this._sureSince >= wait) && settled))) { this.Active = true; this._since = t; this._changedAt = t; this._quickCover = !said && t - this._sureSince < wait; this._promoCover = false; }
    else if (this.Active && this._quickCover && t - this._since <= 12 && t - this._snipeAt <= 4 && t - this._ccLineAt <= 8 && !said) { this.Active = false; this._changedAt = t; this._endedAt = -999; this._pb = Math.min(this._pb, 0.3); this._quickCover = false; }
    else if (this.Active && t - this._badgeAt <= 2 && t - this._since > 20 && t - this._adTextAt > 5 && t - this._qrAt > 5) { this.Active = false; this._changedAt = t; this._endedAt = -999; this._promoCover = false; this._quickCover = false; }
    else if (this.Active && this._promoCover && t - this._badgeAt <= 2) { this.Active = false; this._changedAt = t; this._endedAt = -999; this._promoCover = false; }
    else if (this.Active && this._pb < 0.35 && (settled || this._logoBack >= 2 || showSaid || t - this._adSeenAt > 20) && !(this._promoCover && t - this._since <= 30 && t - this._ccLineAt > 8)) { this.Active = false; this._changedAt = t; this._endedAt = t - this._showCardAt < BreakModel.ShowCardQuiet || this._staleUntilLogo || credits ? -999 : t; }
    if (!this.Active && this._endedAt > 0 && t - this._endedAt <= 30 && t - this._snipeAt <= 3 && t - this._ccLineAt > 8 && t - this._ccLineAt < 300 && this._badgeAt < this._endedAt && !this.NearEdge && !this.AdFreeChannel && t >= this._dismissedUntil) {
      this.Active = true; this._since = t; this._changedAt = t; this._quickCover = false; this._promoCover = true; this._pb = Math.max(this._pb, 0.9); this.Why += (this.Why.length > 0 ? ', ' : '') + 'promo, no captions';
    }
    if (cueOn && !this.Active && !this.AdFreeChannel && t >= this._dismissedUntil) { this.Active = true; this._since = t; this._changedAt = t; this._quickCover = false; this._promoCover = false; }
    return this.Active !== was;
  };

  // ---- readings from beside the picture ----
  P.PrintSeen = function (t) { this._printHits.push(t); while (this._printHits.length > 0 && t - this._printHits[0] > 8) this._printHits.shift(); if (this._printHits.length >= 2) this._knownPicAt = t; };
  P.QrSeen = function (t) { this._qrAt = t; };
  /** A QR code on the text reader's picture (w x h grey): three finder squares of one size in an L. Marks the time when found. The host's
   *  BreakModel.Qr line for line (2026-11-06; C# integer division kept as floor). */
  P.Qr = function (g, w, h, t) {
    if (g.length !== w * h) return false;
    var centers = [], segs = [], x, y, k;
    for (y = 2; y < h - 2; y += 2) {
      // a row's own threshold: halfway between its dark and its light
      var lo = 255, hi = 0;
      for (x = 0; x < w; x++) { var v = g[y * w + x]; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo < 60) continue;
      var th = Math.floor((lo + hi) / 2);
      segs.length = 0;
      var cur = g[y * w] < th, x0 = 0;
      for (x = 1; x <= w; x++) {
        var dark = x < w && g[y * w + x] < th;
        if (x < w && dark === cur) continue;
        segs.push({ dark: cur, len: x - x0, x0: x0 }); cur = dark; x0 = x;
      }
      for (k = 0; k + 4 < segs.length; k++) {
        if (!segs[k].dark) continue;
        var r0 = segs[k].len, r1 = segs[k + 1].len, r2 = segs[k + 2].len, r3 = segs[k + 3].len, r4 = segs[k + 4].len;
        var tot = r0 + r1 + r2 + r3 + r4, mod = tot / 7.0;
        if (tot < 7 || tot > 140) continue;
        if (!(qrNear(r0, mod) && qrNear(r1, mod) && qrNear(r2, 3 * mod) && qrNear(r3, mod) && qrNear(r4, mod))) continue;
        var cx = segs[k + 2].x0 + Math.floor(r2 / 2);
        if (qrVertical(g, w, h, cx, y, th, mod)) centers.push({ x: cx, y: y, m: tot });
      }
    }
    // merge hits on the same square, then look for three of a size in an L
    var squares = [];
    centers.forEach(function (c) {
      var i = -1;
      for (var z = 0; z < squares.length; z++) { var q0 = squares[z]; if (Math.abs(q0.x - c.x) < q0.m / 2 && Math.abs(q0.y - c.y) < q0.m / 2) { i = z; break; } }
      if (i < 0) squares.push({ x: c.x, y: c.y, m: c.m, n: 1 });
      else { var q = squares[i]; squares[i] = { x: (q.x * q.n + c.x) / (q.n + 1), y: (q.y * q.n + c.y) / (q.n + 1), m: (q.m * q.n + c.m) / (q.n + 1), n: q.n + 1 }; }
    });
    squares = squares.filter(function (q) { return q.n >= 2; });
    for (var a = 0; a < squares.length; a++)
      for (var b = 0; b < squares.length; b++)
        for (var c = 0; c < squares.length; c++) {
          if (a === b || b === c || a === c) continue;
          var A = squares[a], B = squares[b], C = squares[c];
          if (Math.abs(A.m - B.m) > A.m * 0.3 || Math.abs(A.m - C.m) > A.m * 0.3) continue;
          // A the corner: AB and AC the same length, square to each other, and a code's width apart (3 to 12 squares)
          var abx = B.x - A.x, aby = B.y - A.y, acx = C.x - A.x, acy = C.y - A.y;
          var ab = Math.sqrt(abx * abx + aby * aby), ac = Math.sqrt(acx * acx + acy * acy);
          if (ab < A.m * 2 || ab > A.m * 12 || Math.abs(ab - ac) > ab * 0.15) continue;
          if (Math.abs(abx * acx + aby * acy) > ab * ac * 0.15) continue;
          this._qrAt = t; return true;
        }
    return false;
  };
  function qrNear(run, want) { return Math.abs(run - want) <= Math.max(1.0, want * 0.6); }
  function qrVertical(g, w, h, cx, cy, th, mod) {
    if (cx < 0 || cx >= w) return false;
    function D(y) { return y >= 0 && y < h && g[y * w + cx] < th; }
    // up and down from the centre: dark (the core), light, dark, then light past the edge - the same 1:1:3:1:1 across
    var up = 0; while (D(cy - up)) up++;
    var core = up, down = 1; while (D(cy + down)) down++;
    core += down - 1;
    if (!(Math.abs(core - 3 * mod) <= Math.max(1.5, 3 * mod * 0.6))) return false;
    var y1 = cy - up, l1 = 0; while (y1 >= 0 && !D(y1)) { l1++; y1--; }
    var d1 = 0; while (y1 >= 0 && D(y1)) { d1++; y1--; }
    var y2 = cy + down, l2 = 0; while (y2 < h && !D(y2)) { l2++; y2++; }
    var d2 = 0; while (y2 < h && D(y2)) { d2++; y2++; }
    return qrNear(l1, mod) && qrNear(d1, mod) && qrNear(l2, mod) && qrNear(d2, mod);
  }
  P.SoundSeen = function (t) { this._soundAt = t; };
  P.PlainShow = function (t) { return this.LogoUpNow && this._pb < 0.05 && t - this._adTextAt > 10 && t - this._qrAt > 10 && !this._knownAd(t) && t >= this._cueUntil; };
  P._readBand = function (e) {
    var a = this._bandN < 60 ? fr(1 / (++this._bandN)) : fr(1 / 60);
    var bs = this._bandSteady;
    for (var y = 0; y < BH; y++) for (var x = 0; x < W; x++) { var j = y * W + x; bs[j] = bs[j] + fr(a * fr((e[(BY0 + y) * W + x] > 25 ? 1 : 0) - bs[j])); }
    if (this._bandN < 30) { this.BandAtBottom = false; return; }
    var cols = 0, mid = 0;
    for (var x2 = 0; x2 < W; x2++) {
      var rows = 0; for (var y2 = 0; y2 < BH; y2++) if (bs[y2 * W + x2] > STEADY_AT) rows++;
      if (rows >= 3) { cols++; if (x2 >= ((W / 3) | 0) && x2 < ((2 * W / 3) | 0)) mid++; }
    }
    this.BandAtBottom = cols >= ((W * 6 / 10) | 0) && mid >= ((((W / 3) | 0) * 6 / 10) | 0);
    if (this.BandAtBottom && this._corner >= 2 && this.HasLogo) {
      var y0 = CORNERS[this._corner][0], x0 = CORNERS[this._corner][1], s = this._steady[this._corner], inBand = 0, all = 0;
      for (var y3 = 0; y3 < CH; y3++) for (var x3 = 0; x3 < CW; x3++) {
        if (s[y3 * CW + x3] <= STEADY_AT) continue; all++;
        var fy = y0 + y3 - BY0; if (fy >= 0 && fy < BH && bs[fy * W + x0 + x3] > STEADY_AT) inBand++;
      }
      this._logoInBandShare = all === 0 ? 0 : inBand / all;
    } else this._logoInBandShare = 0;
  };
  P.InsetBreakAt = function (t) { return this.InsetArmed && !this._insetProgramme && this._insetSince >= 0 && this._insetAt - this._insetSince >= 3 && t - this._insetAt <= 12; };
  P.InsetTailAt = function (t) { return this.InsetArmed && this._tailOn && t - this._tailAt <= 3; };
  P._readInsetTail = function (t) {
    if (!this.InsetArmed) return;
    if (this.InsetBreakAt(t)) { this._insetOnAt = t; this._tailUps = 0; this._awaySince = -1; this._tailOn = false; return; }
    if (t - this._insetOnAt > 120) { this._tailOn = false; return; }
    if (this.LogoUpNow) { this._awaySince = -1; if (++this._tailUps >= 2) this._tailOn = false; }
    else if (this.LogoAwayNow) { this._tailUps = 0; if (this._awaySince < 0) this._awaySince = t; if (t - this._awaySince >= 4) this._tailOn = true; }
    if (this._tailOn) this._tailAt = t;
  };
  P._readInset = function (g, t) {
    if (!this.InsetArmed) { this._insetSince = -1; this._fullRun = 0; this._insetProgramme = false; this._insetSeen.length = 0; this._insetSum = 0; this._fullSince = -1; return; }
    if (t - this._insetFrameAt > 6) { this._insetSince = -1; this._fullRun = 0; }
    this._insetFrameAt = t;
    var r0 = (H / 10) | 0, r1 = (H * 158 / 180) | 0, rows = r1 - r0;
    function dark(x) { var s = 0; for (var y = r0; y < r1; y++) s += g[y * W + x]; return s < 14 * rows; }
    var left = 0, right = 0;
    while (left < W && dark(left)) left++;
    if (left < W) { while (right < W && dark(W - 1 - right)) right++; } else right = W;
    { var bsum = 0; for (var y = H - 20; y < H; y++) for (var x = 0; x < W; x += 2) bsum += g[y * W + x]; this._bandLit = bsum > 40 * 20 * ((W / 2) | 0); }
    var insetNamed = this.TickerChannel && left >= 10 && left <= 24 && right >= 10 && right <= 24;
    var insetAuto = BreakModel.InsetAnywhere && left >= 10 && left <= 36 && right >= 10 && right <= 36 && this._bandLit;
    var inset = insetNamed || insetAuto;
    var full = left < 4 || right < 4;
    this._fullRun = full ? this._fullRun + 1 : 0;
    if (inset) { if (this._insetSince < 0) this._insetSince = t; this._insetAt = t; }
    var dt = cs.clamp(t - this._insetPrev, 0.5, 3); this._insetPrev = t;
    if (inset) { this._insetSeen.push([t, dt]); this._insetSum += dt; }
    while (this._insetSeen.length > 0 && t - this._insetSeen[0][0] > 600) this._insetSum -= this._insetSeen.shift()[1];
    if (full) { if (this._fullSince < 0) this._fullSince = t; } else if (inset) this._fullSince = -1;
    if (!this._insetProgramme && this._insetSum >= 330) this._insetProgramme = true;
    else if (this._insetProgramme && this._fullSince >= 0 && t - this._fullSince >= 60) { this._insetProgramme = false; this._insetSeen.length = 0; this._insetSum = 0; }
    if (this._insetSince >= 0 && (this._fullRun >= 2 || t - this._insetAt > 12)) this._insetSince = -1;
  };
  P.DarkScene = function (t) { return this._blacks.length >= 4 && t - this._blacks[0] <= 8 && t - this._adTextAt > 10 && t - this._qrAt > 10 && !this._knownAd(t) && t >= this._cueUntil; };
  P.InfomercialAt = function (t) { return t - this._infomercialAt <= 90; };
  /** The end of the half hour a paid programme's card was read in, as seconds of the day (the host's PaidSlotEnd on a time of day). */
  BreakModel.PaidSlotEndSeconds = function (secondOfDay, following) {
    var s = Math.floor(secondOfDay);
    var minute = Math.floor(s / 60) % 60, second = s % 60;
    var left = 1800 - (minute % 30 * 60 + second);
    if (following && left < 300) left += 1800;
    return s + left;
  };
  /** The same on a Date (milliseconds dropped, as the host's). */
  BreakModel.PaidSlotEnd = function (at, following) {
    var left = 1800 - (at.getUTCMinutes() % 30 * 60 + at.getUTCSeconds());
    if (following && left < 300) left += 1800;
    return new Date(at.getTime() + left * 1000 - at.getUTCMilliseconds());
  };
  P._stand = function (k, t, phone) {
    var v = this._stands.get(k);
    var e = v !== undefined && t - v[1] <= 20 ? [v[0], t, v[2] + 1] : [t, t, 1];
    this._stands.set(k, e);
    if (e[2] >= 3 && e[1] - e[0] >= 6) { if (phone) this._phoneStandAt = t; else this._addressStandAt = t; }
    if (this._stands.size > 60) { var self = this, old = []; this._stands.forEach(function (val, key) { if (t - val[1] > 120) old.push(key); }); old.forEach(function (key) { self._stands.delete(key); }); }
  };
  P._ownAddress = function (address) {
    var a = cs.lower(address); if (a.indexOf('www.') === 0) a = a.substring(4);
    var cn = cs.lower(this.ChannelName || ''), name = '', first = '', i;
    for (i = 0; i < cn.length; i++) if (cs.isLetterOrDigit(cn[i])) name += cn[i];
    for (i = 0; i < cn.length && cs.isLetterOrDigit(cn[i]); i++) first += cn[i];
    return (name.length >= 2 && a.indexOf(name) === 0) || (first.length >= 2 && a.indexOf(first) === 0);
  };
  P.AdLineAt = function (t) { return this.LogoAwayNow && (t - this._phoneStandAt <= 12 || (t - this._addressStandAt <= 12 && t - this._phoneStandAt <= 45)); };
  P.CueOnAt = function (t) { return t < this._cueUntil; };
  P.CueRead = function (ev, dur, pos, t) {
    if (ev === 'EVENT_PREDICT_START' || ev === 'EVENT_START') this._cueComingAt = t;
    if (ev === 'EVENT_PREDICT_START') { this._cuePredictAt = t; return; }
    if (ev === 'EVENT_START' || ev === 'EVENT_CONTINUE') { this._cueAt = t; this._cueReadUntil = t + Math.max(4, dur - pos) + 2; return; }
    if (ev === 'EVENT_STOP') { this._cueStopAt = t; this._cueReadUntil = t; }
  };
  P.CueComingAt = function (t) { return t - this._cueComingAt <= 75 && t >= this._cueUntil; };
  P.CueSeen = function (ev, dur, pos, t) {
    if (ev === 'EVENT_START' || ev === 'EVENT_CONTINUE') { this._cueUntil = t + Math.max(4, dur - pos) + 2; this._cueComingAt = -999; return; }
    if (ev === 'EVENT_STOP') this._cueUntil = t + cs.clamp(dur - pos, 0, 8);
  };
  P._knownAd = function (t) { while (this._printHits.length > 0 && t - this._printHits[0] > 8) this._printHits.shift(); return this._printHits.length >= 2; };
  P.LearnableAt = function (t) { return this.Active && t - this._since >= 15 && t - this._wordSeenAt <= 20 && !this._suspended && this.LogoScore !== null && this.LogoScore / this._level < 0.3; };
  P.ResumeBreak = function (t) { this.Active = true; this._since = t; this._changedAt = t; this._pb = 0.95; this._adSeenAt = t; this._wordSeenAt = t; this._sureSince = t; };

  /** What the screen (or, spoken, the captions) said at t. Returns the reason it counted, or null. */
  P.Text = function (text, t, spoken) {
    spoken = !!spoken;
    if (cs.isNullOrWhiteSpace(text)) return null;
    if (spoken) this._ccLineAt = t;
    var flat = text.split('\n').join(' ');
    var pc;
    if (!spoken && (pc = match(R.paidCard, flat)) !== null) { this.PaidCardAt = t; this.PaidCardFollowing = cs.lower(pc[0]).indexOf('the following') === 0; }
    if (test(R.paidOpen, flat)) this.PaidOpenAt = t;
    if (test(R.paidClose, flat)) this.PaidCloseAt = t;
    if (!spoken && this.ShowTitle.length >= 4 && hasWord(flat, this.ShowTitle)) { this._showTextAt = t; return 'show: its own name (' + this.ShowTitle + ')'; }
    var sw = match(R.showWords, flat);
    if (sw !== null) { this._showTextAt = t; if (test(R.showCard, flat)) this._showCardAt = t; return 'show: ' + sw[0]; }
    if (spoken) { var rep = this._repeatsBeforeBreak(flat, t); if (rep !== null) { this._showTextAt = t; this._showCardAt = t; return rep; } }
    if (spoken) { var game = this._gameSaid(flat, t); if (game !== null) return game; }
    var promo = null, pw;
    if (!spoken && (pw = match(R.promoWords, flat)) !== null) { this._promoAt = t; promo = 'promo: ' + cs.lower(pw[0]); }
    if (!spoken && test(R.snipe, flat)) this._snipeAt = t;
    if (!spoken && test(R.badge, cs.trim(flat))) this._badgeAt = t;
    var tokens = [], i, mv;
    var urls = matches(R.url, flat);
    for (i = 0; i < urls.length; i++) { tokens.push(cs.lower(urls[i])); if (!spoken && !this._ownAddress(urls[i])) this._stand(cs.lower(urls[i]), t, false); }
    var phones = matches(R.phone, flat);
    for (i = 0; i < phones.length; i++) {
      var nd = R.nonDigit(); nd.lastIndex = 0;
      var ph = phones[i].replace(nd, '');
      tokens.push(ph);
      if (!spoken && ph.length >= 10) {
        var k = ph.substring(ph.length - 10);
        var v = this._phones.get(k);
        var e = v !== undefined && t - v[1] <= 120 ? [v[0], t, v[2] + 1] : [t, t, 1];
        this._phones.set(k, e);
        if (e[2] >= 5 && e[1] - e[0] >= 120) this._infomercialAt = t;
        this._stand(k, t, true);
        if (this._phones.size > 50) { var self = this, old = []; this._phones.forEach(function (val, key) { if (t - val[1] > 600) old.push(key); }); old.forEach(function (key) { self._phones.delete(key); }); }
      }
    }
    var ads = matches(R.adWords, flat);
    for (i = 0; i < ads.length; i++) tokens.push(cs.lower(ads[i]));
    if (tokens.length === 0) return promo;
    var st = match(R.sponsorTag, flat);
    if (st !== null && !(this._absentSince >= 0 && t - this._absentSince >= 8)) return 'sponsor tag: ' + cs.lower(st[0]);
    if (this.LogoScore !== null && this.LogoScore > 0.5 && !this.Active) {
      for (i = 0; i < tokens.length; i++) { var c0 = this._showTokens.get(tokens[i]); this._showTokens.set(tokens[i], c0 !== undefined ? c0 + 1 : 1); }
      return null;
    }
    tokens = tokens.filter(function (tk) { return !fragment(tk); });
    var own = cs.lower(this.ChannelName).replace(/[^a-z]/g, '');
    if (own.length >= 3) tokens = tokens.filter(function (tk) { return cs.lower(tk).replace(/[^a-z]/g, '').indexOf(own) < 0; });
    if (tokens.length === 0) return promo;
    for (i = 0; i < tokens.length; i++) {
      var tk = tokens[i], furniture = false;
      this._showTokens.forEach(function (val, key) { if (!furniture && val >= 3 && sameStem(key, tk)) furniture = true; });
      if (furniture) continue;
      if (spoken) { this._ccAdAt = t; return 'ad: ' + tk; }
      var sp = this._tokenSpan.get(tk);
      var span = sp !== undefined && t - sp[1] <= 900 ? [sp[0], t] : [t, t];
      this._tokenSpan.set(tk, span);
      if (t - span[0] >= 40) this._scenery.set(tk, t);
      if (this._tokenSpan.size > 200) { var self2 = this, old2 = []; this._tokenSpan.forEach(function (val, key) { if (t - val[1] > 900) old2.push(key); }); old2.forEach(function (key) { self2._tokenSpan.delete(key); }); }
      this._adTextPrevAt = this._adTextAt; this._adTextAt = t;
      var scen = false;
      this._scenery.forEach(function (val, key) { if (!scen && t - val < 900 && sameStem(key, tk)) scen = true; });
      if (scen) this._scenery.set(tk, t);
      else { this._bareAdPrevAt = this._bareAdAt; this._bareAdAt = t; }
      return 'ad: ' + tk;
    }
    return null;
  };
  P._gameSaid = function (text, t) {
    var n = 0;
    var teams = new Set(asciiMatches(/[a-z]{4,}/g, cs.lower(this.ShowTitle)).filter(function (x) {
      return x !== 'game' && x !== 'series' && x !== 'live' && x !== 'postseason' && x !== 'playoff' && x !== 'playoffs';
    }));
    var words = asciiMatches(/[a-z]+/g, cs.lower(text));
    for (var i = 0; i < words.length; i++) if (GAME_WORDS.has(words[i]) || teams.has(words[i])) n++;
    if (n > 0) this._gameWords.push([t, n]);
    while (this._gameWords.length > 0 && t - this._gameWords[0][0] > 300) this._gameWords.shift();
    if (n === 0) return null;
    var lately = 0, all = 0;
    for (var k = 0; k < this._gameWords.length; k++) { if (t - this._gameWords[k][0] <= 8) lately += this._gameWords[k][1]; all += this._gameWords[k][1]; }
    if (lately < 1 || all < 6) return null;
    this._gameSaidAt = t;
    return "show: the game's commentary";
  };
  P._repeatsBeforeBreak = function (text, t) {
    this._showLines = this._showLines.filter(function (x) { return !(t - x[0] > 180); });
    var g = grams(text);
    if (g.size === 0) return null;
    if (this._suspended || !this.HasLogo) return null;
    if (this.LogoScore !== null && this.LogoScore / this._level >= 0.6) this._logoPlainAt = t;
    if (!this.Active) {
      if (t - this._logoPlainAt <= 10) this._showLines.push([t, g]);
      return null;
    }
    if (this.LogoScore !== null && this.LogoScore / this._level < 0.3) return null;
    for (var i = 0; i < this._showLines.length; i++) {
      var at = this._showLines[i][0], kept = this._showLines[i][1];
      if (at > this._since) continue;
      var n = 0; g.forEach(function (x) { if (kept.has(x)) n++; });
      if (n >= 3) return 'show: the line before the break again';
    }
    return null;
  };

  P.StillFor = function (t) { return this._stillSince < 0 ? 0 : t - this._stillSince; };
  P.Silence = function (at) { this._silenceAt = at; this._boundary(at, false); };
  P._cutsIn = function (t, s) { var n = 0; for (var i = 0; i < this._cuts.length; i++) { var c = this._cuts[i]; if (t - c <= s && c <= t) n++; } return n; };
  P._boundary = function (at, black) {
    var b = this._bounds;
    for (var i = b.length - 1; i >= 0 && i >= b.length - 4; i--)
      if (Math.abs(b[i][0] - at) <= 2) { if (black && !b[i][1]) b[i] = [b[i][0], true]; return; }
    var k = b.length; while (k > 0 && b[k - 1][0] > at) k--;
    b.splice(k, 0, [at, black]);
    while (b.length > 0 && at - b[0][0] > 180) b.shift();
  };
  P._spotGap = function (t) {
    var last = -1, prev = -1;
    for (var i = 0; i < this._bounds.length; i++) { var bt = this._bounds[i][0]; if (bt > t || t - bt > 120) continue; prev = last; last = bt; }
    return prev < 0 ? 0 : Math.min(120, last - prev);
  };
  P._beats = function (t, any) {
    var prev = -1, n = 0;
    for (var i = 0; i < this._bounds.length; i++) {
      var bt = this._bounds[i][0], bb = this._bounds[i][1];
      if (bt > t || t - bt > 150 || (!any && !bb)) continue;
      if (prev >= 0) { var g = bt - prev; if (g >= 13 && (Math.abs(g - 15) <= 1.5 || Math.abs(g - 30) <= 1.5 || Math.abs(g - 45) <= 1.5 || Math.abs(g - 60) <= 1.5)) n++; }
      prev = bt;
    }
    return n;
  };
  /** The page's meter at t: the level and the peak of the last second, in dB. */
  P.Level = function (db, peak, t) {
    this._db = cs.clamp(db, -120, 0); this._peakDb = cs.clamp(peak, -120, 0); this._dbAt = t;
    this._dbHist.push([t, this._db]);
    while (this._dbHist.length > 0 && this._dbHist[0][0] < t - 30) this._dbHist.shift();
  };
  P._soundNow = function (t) { return t - this._dbAt <= 3 ? this._db : -120; };
  P._soundMean = function (t, w) {
    var sum = 0, n = 0;
    for (var i = 0; i < this._dbHist.length; i++) { var T = this._dbHist[i][0]; if (T > t - w && T <= t) { sum += this._dbHist[i][1]; n++; } }
    return n === 0 ? -120 : sum / n;
  };
  P._soundStep = function (t) { return t - this._dbAt <= 3 && this._dbHist.length >= 5 ? this._soundMean(t, 5) - this._soundMean(t, 30) : 0; };
  P.Captions = function (words, quietMs, t) {
    if (words.length > 0) this._ccWordsAt = t;
    this._ccQuietSince = quietMs >= 0 ? t - quietMs / 1000.0 : -1;
  };
  P.CaptionsQuietFor = function (t) { return this._ccQuietSince < 0 ? -1 : t - this._ccQuietSince; };

  P._logoMatch = function (hp) {
    var y0 = CORNERS[this._corner][0], x0 = CORNERS[this._corner][1], s = this._steady[this._corner], p = this._pattern[this._corner];
    var sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (var y = 0; y < CH; y++)
      for (var x = 0; x < CW; x++) {
        var j = y * CW + x; if (s[j] <= STEADY_AT) continue;
        var a = hp[(y0 + y) * W + x0 + x], b = p[j];
        sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n++;
      }
    if (n < 15) return 0;
    var va = saa - sa * sa / n, vb = sbb - sb * sb / n;
    this._logoContrast = vb < 1e-3 ? 0 : Math.sqrt(va / vb);
    if (va < 1e-3 || vb < 1e-3) return 0;
    return (sab - sa * sb / n) / Math.sqrt(va * vb);
  };
  P._reset = function () {
    for (var k = 0; k < 4; k++) { this._steady[k].fill(0); this._pattern[k].fill(0); }
    this._n = 0; this._corner = -1; this._pb = 0.05; this._absentSince = -1; this.LogoScore = null; this.Relearned = true; this._scores.length = 0; this._level = 0.6; this._suspended = false;
  };

  // ---- kept per channel, so a window tuned into a break already knows the logo ----
  function nowSeconds() { return Math.floor(Date.now() / 1000); }
  /** The host's .logo file (version 3) for this model's logo, or null with none learned. */
  P.save = function (nowSec) {
    if (!this.HasLogo) return null;
    var buf = new ArrayBuffer(4 + 4 + 8 + 8 + CH * CW * 8), dv = new DataView(buf), o = 0;
    dv.setInt32(o, 3, true); o += 4; dv.setInt32(o, this._corner, true); o += 4; dv.setFloat64(o, this._level, true); o += 8;
    var sa = this._suspended ? (nowSec === undefined ? nowSeconds() : nowSec) : 0, hi = Math.floor(sa / 4294967296);
    dv.setUint32(o, sa - hi * 4294967296, true); dv.setInt32(o + 4, hi, true); o += 8;
    var s = this._steady[this._corner], p = this._pattern[this._corner], j;
    for (j = 0; j < CH * CW; j++) { dv.setFloat32(o, s[j], true); o += 4; }
    for (j = 0; j < CH * CW; j++) { dv.setFloat32(o, p[j], true); o += 4; }
    return new Uint8Array(buf);
  };
  /** A model from the host's .logo bytes (versions 1 to 3); a fresh one for none or a bad file. nowSec: the clock the set-aside
   * stamp is read against (default now). */
  BreakModel.load = function (bytes, nowSec) {
    var m = new BreakModel();
    if (!bytes) return m;
    try {
      var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), o = 0;
      var ver = dv.getInt32(o, true); o += 4; if (ver < 1 || ver > 3) return m;
      var k = dv.getInt32(o, true); o += 4; if (k < 0 || k > 3) return m;
      if (ver >= 2) { m._level = cs.clamp(dv.getFloat64(o, true), 0.2, 1.0); o += 8; }
      var setAside = 0;
      if (ver >= 3) { setAside = dv.getUint32(o, true) + dv.getInt32(o + 4, true) * 4294967296; o += 8; }
      var j;
      for (j = 0; j < CH * CW; j++) { m._steady[k][j] = dv.getFloat32(o, true); o += 4; }
      for (j = 0; j < CH * CW; j++) { m._pattern[k][j] = dv.getFloat32(o, true); o += 4; }
      m._corner = k; m._n = LEARN_FRAMES;
      var now = nowSec === undefined ? nowSeconds() : nowSec;
      if (setAside > 0 && now - setAside < 1200) { m._suspended = true; m._suspendedAt = -Infinity; m._resumeSuspended = true; }
    } catch (err) { return new BreakModel(); }
    return m;
  };
  /** The learned logo as a JSON-able object (the same content as the .logo file), or null with none learned. */
  P.saveState = function (nowSec) {
    if (!this.HasLogo) return null;
    return { v: 3, corner: this._corner, level: this._level, setAside: this._suspended ? (nowSec === undefined ? nowSeconds() : nowSec) : 0,
      steady: Array.prototype.slice.call(this._steady[this._corner]), pattern: Array.prototype.slice.call(this._pattern[this._corner]) };
  };
  BreakModel.loadState = function (st, nowSec) {
    var m = new BreakModel();
    try {
      if (!st || st.v !== 3 || !(st.corner >= 0 && st.corner <= 3) || !st.steady || !st.pattern || st.steady.length !== CH * CW || st.pattern.length !== CH * CW) return m;
      var k = st.corner | 0;
      m._level = cs.clamp(+st.level, 0.2, 1.0);
      m._steady[k].set(st.steady); m._pattern[k].set(st.pattern);
      m._corner = k; m._n = LEARN_FRAMES;
      var now = nowSec === undefined ? nowSeconds() : nowSec;
      if (st.setAside > 0 && now - st.setAside < 1200) { m._suspended = true; m._suspendedAt = -Infinity; m._resumeSuspended = true; }
    } catch (err) { return new BreakModel(); }
    return m;
  };

  ns.BreakModel = BreakModel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
