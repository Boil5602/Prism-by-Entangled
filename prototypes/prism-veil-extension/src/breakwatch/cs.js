/* Prism break watch, browser port: the C# semantics the port leans on (2026-11-06).
 * The break detector is ported from the Windows host (targets/win-host/PrismHost/Services/BreakModel.cs, LearnedBreak.cs,
 * AdPrints.cs, AdSounds.cs) number for number. These helpers reproduce what .NET does where JavaScript differs by default:
 * - Math.Round(x, d, MidpointRounding.AwayFromZero) as .NET 8 computes it (scale, ModF, step away on a half);
 * - the custom numeric formats "0.###", "0.00", "0" (15 significant digits first, then half-up on the digits; a negative that
 *   rounds to nothing prints "-0");
 * - the .NET regex classes \w-boundary, \d and \s, built over UTF-16 code units (the C# side works on chars, not code points),
 *   so the ported regexes run without the u flag and match what the host's do;
 * - char.IsLetter / IsDigit / IsLetterOrDigit / IsWhiteSpace, string.Trim, IsNullOrWhiteSpace and ToLowerInvariant (ICU's
 *   simple lower case mapping, U+0130 kept as itself, as .NET's invariant casing does).
 * Classic script, no DOM, no network: attaches to globalThis.PrismBreak, and to module.exports under Node.
 * Pure ASCII source. */
(function (root) {
  'use strict';
  var ns = root.PrismBreak || (root.PrismBreak = {});
  if (typeof module === 'object' && module && module.exports) module.exports = ns;
  if (ns.cs) return;

  // ---- Unicode classes over code units (built once, on first use) ----
  var cache = {};
  function hex4(c) { return '\\u' + ('000' + c.toString(16)).slice(-4); }
  function buildClass(test) {
    var out = '', start = -1;
    for (var c = 0; c <= 0x10000; c++) {
      var ok = c < 0x10000 && test(c);
      if (ok && start < 0) start = c;
      else if (!ok && start >= 0) { out += hex4(start) + (c - 1 > start ? '-' + hex4(c - 1) : ''); start = -1; }
    }
    return out;
  }
  function propTest(src) {
    var re = new RegExp('^' + src + '$', 'u');
    return function (c) { return c >= 0xD800 && c <= 0xDFFF ? false : re.test(String.fromCharCode(c)); };
  }
  function cls(name) {
    if (cache[name]) return cache[name];
    var v;
    if (name === 'word') v = buildClass(propTest('[\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}]'));                 // .NET \w
    else if (name === 'bword') v = cls('word') + '\\u200c\\u200d';                                  // .NET's \b word chars
    else if (name === 'digit') v = buildClass(propTest('\\p{Nd}'));                                  // .NET \d
    else if (name === 'space') v = '\\f\\n\\r\\t\\v\\u0085' + buildClass(propTest('\\p{Z}'));     // .NET \s
    else if (name === 'letter') v = buildClass(propTest('\\p{L}'));
    cache[name] = v;
    return v;
  }
  // a .NET pattern written with the tokens below, made into a JavaScript RegExp over code units:
  //   \b -> .NET's word boundary, \d / \D -> Unicode decimal digits, \s -> .NET white space, . -> any but \n, $ -> end or before a final \n
  // (the patterns ported here use \b, \d, \D, \s, and . only outside character classes, and $ only at the end of an alternative)
  function netRegex(src, flags) {
    var b = '[' + cls('bword') + ']';
    var out = '', inClass = false;
    for (var i = 0; i < src.length; i++) {
      var ch = src[i];
      if (ch === '\\') {
        var nx = src[i + 1]; i++;
        if (nx === 'd') out += inClass ? cls('digit') : '[' + cls('digit') + ']';
        else if (nx === 'D' && !inClass) out += '[^' + cls('digit') + ']';
        else if (nx === 's') out += inClass ? cls('space') : '[' + cls('space') + ']';
        else if (nx === 'b' && !inClass) out += '(?:(?<=' + b + ')(?!' + b + ')|(?<!' + b + ')(?=' + b + '))';
        else out += '\\' + nx;
        continue;
      }
      if (inClass) { if (ch === ']') inClass = false; out += ch; continue; }
      if (ch === '[') { inClass = true; out += ch; if (src[i + 1] === '^') { out += '^'; i++; } if (src[i + 1] === ']') { out += '\\]'; i++; } continue; }
      if (ch === '.') { out += '[^\\n]'; continue; }
      if (ch === '$') { out += '(?:$|(?=\\n$))'; continue; }
      out += ch;
    }
    return new RegExp(out, flags || '');
  }
  // a pattern built lazily (the Unicode classes cost a few milliseconds to build)
  function lazyRegex(src, flags) {
    var re = null;
    return function () { return re || (re = netRegex(src, flags)); };
  }

  // ---- char tests (one UTF-16 code unit, as C#'s char) ----
  var letterRe = null, digitRe = null, spaceRe = null;
  function isLetter(ch) { return (letterRe || (letterRe = new RegExp('^[' + cls('letter') + ']$'))).test(ch); }
  function isDigit(ch) { return (digitRe || (digitRe = new RegExp('^[' + cls('digit') + ']$'))).test(ch); }
  function isLetterOrDigit(ch) { return isLetter(ch) || isDigit(ch); }
  // char.IsWhiteSpace: Zs, Zl, Zp, \t \n \v \f \r, U+0085, U+00A0 (Zs)
  function isWhiteSpace(ch) { return (spaceRe || (spaceRe = new RegExp('^[\\t\\n\\v\\f\\r\\u0085' + buildClass(propTest('\\p{Z}')) + ']$'))).test(ch); }
  function isNullOrWhiteSpace(s) {
    if (s == null) return true;
    for (var i = 0; i < s.length; i++) if (!isWhiteSpace(s[i])) return false;
    return true;
  }
  function trim(s) {
    var a = 0, z = s.length;
    while (a < z && isWhiteSpace(s[a])) a++;
    while (z > a && isWhiteSpace(s[z - 1])) z--;
    return s.substring(a, z);
  }
  // ToLowerInvariant: the simple lower case mapping per code point; U+0130 stays itself (.NET's invariant casing)
  function lower(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 128) { out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i]; continue; }
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) {
          var pair = s.substr(i, 2), lp = pair.toLowerCase();
          out += lp.length === 2 ? lp : pair; i++; continue;
        }
      }
      if (c === 0x130) { out += s[i]; continue; }
      var l = s[i].toLowerCase();
      out += l.length === 1 ? l : s[i];
    }
    return out;
  }

  // ---- numbers ----
  // Math.Round(value, digits, MidpointRounding.AwayFromZero), .NET 8
  var P10 = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000, 10000000000, 100000000000, 1000000000000, 10000000000000, 100000000000000, 1000000000000000];
  function roundAway(value, digits) {
    if (Math.abs(value) < 1e16) {
      var p = P10[digits];
      value *= p;
      var ip = value < 0 ? Math.ceil(value) : Math.floor(value);
      var frac = value - ip;
      if (Math.abs(frac) >= 0.5) ip += frac > 0 ? 1 : -1;
      value = ip / p;
    }
    return value;
  }
  // Math.Round(double): to even
  function roundEven(x) {
    var r = Math.round(x);
    if (Math.abs(x % 1) === 0.5) r = 2 * Math.round(x / 2);
    return r;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }   // Math.Clamp (NaN passes through)

  // Math.Exp as .NET gives it on Windows: the C runtime's exp, correctly rounded in 99.5% of 250,000 probes (2026-11-06), where V8's
  // Math.exp was in 90.6%. So exp here is correctly rounded: computed in double-double (about 100 bits) and rounded once. The
  // remaining half percent, where the C runtime itself is a unit in the last place off, cannot be reproduced without its code.
  var SPLIT = 134217729;   // 2^27 + 1
  function twoSum(a, b) { var s = a + b, bb = s - a; return [s, (a - (s - bb)) + (b - bb)]; }
  function quickTwoSum(a, b) { var s = a + b; return [s, b - (s - a)]; }
  function twoProd(a, b) {
    var p = a * b;
    var c = SPLIT * a, ah = c - (c - a), al = a - ah;
    var d = SPLIT * b, bh = d - (d - b), bl = b - bh;
    return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
  }
  function ddAdd(a, b) {
    var s = twoSum(a[0], b[0]), t = twoSum(a[1], b[1]);
    var e = s[1] + t[0]; var u = quickTwoSum(s[0], e); e = u[1] + t[1]; return quickTwoSum(u[0], e);
  }
  function ddMul(a, b) { var p = twoProd(a[0], b[0]); return quickTwoSum(p[0], p[1] + (a[0] * b[1] + a[1] * b[0])); }
  function ddMulD(a, d) { var p = twoProd(a[0], d); return quickTwoSum(p[0], p[1] + a[1] * d); }
  function ddDivD(a, d) {
    var q1 = a[0] / d, p = twoProd(q1, d);
    var s = twoSum(a[0], -p[0]);
    var r = (s[0] + (s[1] - p[1] + a[1])) / d;
    return quickTwoSum(q1, r);
  }
  var LN2 = [0.6931471805599453, 2.3190468138462996e-17];
  function exp(x) {
    if (!(x > -700 && x < 700)) return Math.exp(x);   // NaN, the infinities and the far ends: as the engine has it
    if (x === 0) return 1;
    var k = Math.round(x / LN2[0]);
    var r = ddAdd([x, 0], ddMulD(LN2, -k));   // |r| <= ln2 / 2, to about 2^-100
    var sum = [1, 0], term = [1, 0];
    for (var n = 1; n < 40; n++) {
      term = ddDivD(ddMul(term, r), n);
      sum = ddAdd(sum, term);
      if (Math.abs(term[0]) < 1e-34) break;
    }
    var scale = Math.pow(2, k);   // exact: 2^k for |k| <= 1010
    return sum[0] * scale + sum[1] * scale;
  }
  // x.ToString(custom) for the formats "0", "0.0..0", "0.#..#" (en-US): 15 significant digits, then half-up to the decimals asked
  function format(x, decimals, optional) {
    if (x !== x) return 'NaN';
    if (x === Infinity) return '\u221E';
    if (x === -Infinity) return '-\u221E';
    var neg = x < 0 || (x === 0 && 1 / x < 0);
    var ax = Math.abs(x);
    var digits, exp;
    if (ax === 0) { digits = '0'; exp = 0; }
    else {
      var e = ax.toExponential(14);   // d.dddddddddddddde+X: 15 significant digits, correctly rounded
      var mi = e.indexOf('e');
      digits = e.substring(0, mi).replace('.', '');
      exp = parseInt(e.substring(mi + 1), 10);
    }
    // the digit string as integer part and fraction
    var intPart, frac;
    if (exp >= 0) {
      if (digits.length <= exp + 1) { intPart = digits + new Array(exp + 2 - digits.length).join('0'); frac = ''; }
      else { intPart = digits.substring(0, exp + 1); frac = digits.substring(exp + 1); }
    } else { intPart = '0'; frac = new Array(-exp).join('0') + digits; }
    // half-up at the decimals asked
    var keep = frac.substring(0, decimals), next = frac.charCodeAt(decimals);
    var num = intPart + keep + new Array(decimals - keep.length + 1).join('0');
    if (next >= 53) {   // '5'
      var arr = num.split(''), k = arr.length - 1;
      while (k >= 0) { if (arr[k] === '9') { arr[k] = '0'; k--; } else { arr[k] = String.fromCharCode(arr[k].charCodeAt(0) + 1); break; } }
      num = (k < 0 ? '1' : '') + arr.join('');
    }
    var ip2 = num.substring(0, num.length - decimals).replace(/^0+(?=\d)/, '');
    if (ip2 === '') ip2 = '0';
    var fp2 = num.substring(num.length - decimals);
    if (optional) fp2 = fp2.replace(/0+$/, '');
    return (neg ? '-' : '') + ip2 + (fp2.length ? '.' + fp2 : '');
  }

  ns.cs = {
    netRegex: netRegex, lazyRegex: lazyRegex,
    isLetter: isLetter, isDigit: isDigit, isLetterOrDigit: isLetterOrDigit, isWhiteSpace: isWhiteSpace,
    isNullOrWhiteSpace: isNullOrWhiteSpace, trim: trim, lower: lower,
    roundAway: roundAway, roundEven: roundEven, clamp: clamp, format: format, exp: exp
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
