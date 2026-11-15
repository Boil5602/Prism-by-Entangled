/*
  PRISM - rule updates (0.9.0): the format of a downloaded rule file, its limits, and how it joins the packaged rules.

  A rule file is DATA: CSS selectors, exact words, hostnames, ids and a few booleans. Nothing in it is ever run. A selector goes
  only to querySelectorAll / matches / closest (src/rules.js); a word is only compared with a page's text; a hostname only with
  location.hostname. No value from a file reaches eval, Function, a script element, innerHTML, a URL or a style. There are no
  regular expressions in a file: a pattern can freeze a page, so words and hosts are compared as plain strings.

  This file has no DOM and no chrome.* in it: the background (which fetches and verifies), the content scripts (which check the
  stored copy again before they use it), the publishing script and the tests all run the same code.

    validate(obj, ownVersion)      the strict schema; an unknown field, a wrong type or a value over a limit refuses the whole file
    accept({bytes, sig, keys, ownVersion, heldSerial, subtle})
                                   size, signature (any one of the accepted keys), schema, version: what the background stores
    fromStore(held, ownVersion, switchOn)
                                   what a page may use of the stored copy: nothing with the switch off
    validateMine(obj)              the person's own rules (pv:rules:mine): the same display schema, never written by an update
    effective(base, update, mine)  packaged rules, then the update, then the person's own, which always win

  First version: display rules only. A file may carry a "video" object; this version checks that it is an object and reads
  nothing in it, so a later version can use it without a new format number.
*/
(function (root) {
  "use strict";
  var FORMAT = 1;
  // The serial of the rules inside this package. A stored or downloaded file is used only when it is newer than this, so a
  // release that takes the published rules into the package (and moves this on) retires the copy a browser still holds.
  var BASE_SERIAL = "2026-11-14.0";
  var LIMITS = {
    bytes: 65536,      // the file
    selectors: 300,    // every selector in the file, counted together
    list: 150,         // entries in any one list
    sites: 100,        // site entries
    perSite: 20,       // selectors, hosts or words in one site entry
    words: 100,        // label words
    kill: 60,
    selLen: 200, wordLen: 60, hostLen: 100, idLen: 40, noteLen: 200
  };

  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function unknownKey(o, allowed) { for (var k in o) { if (has(o, k) && allowed.indexOf(k) < 0) return k; } return ""; }
  function printable(s) { for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 32 || c === 127) return false; } return true; }
  function ascii(s) { for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 32 || c > 126) return false; } return true; }

  // One selector a string, never a list (lists are arrays, so each entry is counted and can be dropped alone). It must name an
  // id, a class or an attribute, so it cannot be "div" or "*"; no :has() (it can be slow on a large page); none of the characters
  // a stylesheet or markup would need.
  function selOk(s) {
    if (typeof s !== "string" || !s.length || s.length > LIMITS.selLen || !ascii(s) || s !== s.trim()) return false;
    if (/[{};<>\\,]/.test(s)) return false;
    if (/:has\(/i.test(s)) return false;
    if (/(^|[\s>+~(])\*/.test(s)) return false;
    if (!/[#.\[]/.test(s)) return false;
    return true;
  }
  function hostOk(s) {
    return typeof s === "string" && s.length <= LIMITS.hostLen && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s);
  }
  function wordOk(s) { return typeof s === "string" && s.length > 0 && s.length <= LIMITS.wordLen && printable(s) && s === s.trim(); }
  function idOk(s) { return typeof s === "string" && s.length <= LIMITS.idLen && /^[a-z0-9][a-z0-9-]*$/.test(s); }
  function serialOk(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}\.\d{1,3}$/.test(s); }
  function verOk(s) { return typeof s === "string" && /^\d{1,4}(\.\d{1,5}){0,3}$/.test(s); }

  function newer(x, y) {   // "YYYY-MM-DD.N": a later day, then a higher count
    function split(s) { s = String(s || ""); var i = s.lastIndexOf("."); return i < 0 ? [s, 0] : [s.slice(0, i), +s.slice(i + 1) || 0]; }
    var a = split(x), b = split(y);
    return a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1];
  }
  function atLeast(have, need) {
    var h = String(have || "").split("-")[0].split(".").map(Number), n = String(need || "").split("-")[0].split(".").map(Number);
    for (var i = 0; i < Math.max(h.length, n.length); i++) { var x = h[i] || 0, y = n[i] || 0; if (x !== y) return x > y; }
    return true;
  }

  // A list of strings that each pass `ok`, at most `max`. Returns the copy, or a string that says what is wrong.
  function list(v, ok, max, what) {
    if (v === undefined) return [];
    if (!Array.isArray(v)) return what + " is not a list";
    if (v.length > max) return what + " has " + v.length + " entries (" + max + " at most)";
    var out = [];
    for (var i = 0; i < v.length; i++) { if (!ok(v[i])) return what + "[" + i + "] is not allowed"; out.push(v[i]); }
    return out;
  }

  // The display rules of a file (or of the person's own rules). `count` is { n } - the selectors counted so far.
  function display(d, count) {
    if (d === undefined) d = {};
    if (!isObj(d)) return "display is not an object";
    var bad = unknownKey(d, ["slots", "stacks", "labels", "hosts", "sites", "kill"]);
    if (bad) return "display." + bad + " is not a field this version knows";
    var out = { slots: { add: [], off: [] }, stacks: { add: [], off: [] }, labels: { badge: [], section: [] }, hosts: { noAds: [], labelWalkerOff: [] }, sites: [], kill: [] };
    var x, i;
    if (d.slots !== undefined) {
      if (!isObj(d.slots) || unknownKey(d.slots, ["add", "off"])) return "display.slots is not { add, off }";
      x = list(d.slots.add, selOk, LIMITS.list, "slots.add"); if (typeof x === "string") return x; out.slots.add = x;
      x = list(d.slots.off, selOk, LIMITS.list, "slots.off"); if (typeof x === "string") return x; out.slots.off = x;
      count.n += out.slots.add.length + out.slots.off.length;
    }
    if (d.stacks !== undefined) {
      if (!isObj(d.stacks) || unknownKey(d.stacks, ["add", "off"])) return "display.stacks is not { add, off }";
      var sa = d.stacks.add === undefined ? [] : d.stacks.add;
      if (!Array.isArray(sa) || sa.length > LIMITS.list) return "stacks.add is not a list of " + LIMITS.list + " at most";
      for (i = 0; i < sa.length; i++) {
        if (!isObj(sa[i]) || unknownKey(sa[i], ["stack", "sel"]) || !wordOk(sa[i].stack) || !selOk(sa[i].sel)) return "stacks.add[" + i + "] is not { stack, sel }";
        out.stacks.add.push({ stack: sa[i].stack, sel: sa[i].sel });
      }
      x = list(d.stacks.off, wordOk, LIMITS.list, "stacks.off"); if (typeof x === "string") return x; out.stacks.off = x;
      count.n += out.stacks.add.length;
    }
    if (d.labels !== undefined) {
      if (!isObj(d.labels) || unknownKey(d.labels, ["badge", "section"])) return "display.labels is not { badge, section }";
      x = list(d.labels.badge, wordOk, LIMITS.words, "labels.badge"); if (typeof x === "string") return x; out.labels.badge = x;
      x = list(d.labels.section, wordOk, LIMITS.words, "labels.section"); if (typeof x === "string") return x; out.labels.section = x;
    }
    if (d.hosts !== undefined) {
      if (!isObj(d.hosts) || unknownKey(d.hosts, ["noAds", "labelWalkerOff"])) return "display.hosts is not { noAds, labelWalkerOff }";
      x = list(d.hosts.noAds, hostOk, LIMITS.list, "hosts.noAds"); if (typeof x === "string") return x; out.hosts.noAds = x;
      x = list(d.hosts.labelWalkerOff, hostOk, LIMITS.list, "hosts.labelWalkerOff"); if (typeof x === "string") return x; out.hosts.labelWalkerOff = x;
    }
    if (d.sites !== undefined) {
      if (!Array.isArray(d.sites) || d.sites.length > LIMITS.sites) return "sites is not a list of " + LIMITS.sites + " at most";
      var seen = {};
      for (i = 0; i < d.sites.length; i++) {
        var s = d.sites[i], w = "sites[" + i + "]";
        if (!isObj(s)) return w + " is not an object";
        bad = unknownKey(s, ["id", "hosts", "cover", "closest", "text", "never", "whole"]);
        if (bad) return w + "." + bad + " is not a field this version knows";
        if (!idOk(s.id) || has(seen, s.id)) return w + ".id is missing, not allowed or used twice";
        seen[s.id] = true;
        var o = { id: s.id, hosts: [], cover: [], closest: "", text: null, never: [], whole: false };
        x = list(s.hosts, hostOk, LIMITS.perSite, w + ".hosts"); if (typeof x === "string") return x; if (!x.length) return w + ".hosts is empty"; o.hosts = x;
        x = list(s.cover, selOk, LIMITS.perSite, w + ".cover"); if (typeof x === "string") return x; o.cover = x;
        x = list(s.never, selOk, LIMITS.perSite, w + ".never"); if (typeof x === "string") return x; o.never = x;
        if (!o.cover.length && !o.never.length) return w + " has nothing to cover and nothing to leave alone";
        count.n += o.cover.length + o.never.length;
        if (s.closest !== undefined) { if (!selOk(s.closest)) return w + ".closest is not allowed"; o.closest = s.closest; count.n++; }
        if (s.text !== undefined) {
          if (!isObj(s.text) || unknownKey(s.text, ["sel", "equals"]) || !selOk(s.text.sel)) return w + ".text is not { sel, equals }";
          x = list(s.text.equals, wordOk, LIMITS.perSite, w + ".text.equals"); if (typeof x === "string") return x; if (!x.length) return w + ".text.equals is empty";
          o.text = { sel: s.text.sel, equals: x }; count.n++;
        }
        if (s.whole !== undefined) { if (typeof s.whole !== "boolean") return w + ".whole is not true or false"; o.whole = s.whole; }
        out.sites.push(o);
      }
    }
    x = list(d.kill, idOk, LIMITS.kill, "kill"); if (typeof x === "string") return x; out.kill = x;
    if (count.n > LIMITS.selectors) return "the file has " + count.n + " selectors (" + LIMITS.selectors + " at most)";
    return out;
  }

  function validate(obj, ownVersion) {
    if (!isObj(obj)) return { ok: false, error: "not an object" };
    var bad = unknownKey(obj, ["format", "serial", "date", "minVeil", "maxVeil", "notes", "display", "video"]);
    if (bad) return { ok: false, error: bad + " is not a field this version knows" };
    if (obj.format !== FORMAT) return { ok: false, error: "a format this version does not read" };
    if (!serialOk(obj.serial)) return { ok: false, error: "the serial is not YYYY-MM-DD.N" };
    if (obj.date !== undefined && !(typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date))) return { ok: false, error: "the date is not YYYY-MM-DD" };
    if (!verOk(obj.minVeil)) return { ok: false, error: "minVeil is missing or not a version" };
    if (obj.maxVeil !== undefined && !verOk(obj.maxVeil)) return { ok: false, error: "maxVeil is not a version" };
    if (obj.notes !== undefined && !(typeof obj.notes === "string" && obj.notes.length <= LIMITS.noteLen && printable(obj.notes))) return { ok: false, error: "the notes are too long or not plain text" };
    if (obj.video !== undefined && !isObj(obj.video)) return { ok: false, error: "video is not an object" };
    var d = display(obj.display, { n: 0 });
    if (typeof d === "string") return { ok: false, error: d };
    if (ownVersion !== undefined && ownVersion !== null) {
      if (!atLeast(ownVersion, obj.minVeil)) return { ok: false, error: "needs the extension " + obj.minVeil + " or newer" };
      if (obj.maxVeil !== undefined && !atLeast(obj.maxVeil, ownVersion)) return { ok: false, error: "made for the extension " + obj.maxVeil + " or older" };
    }
    return { ok: true, rules: { serial: obj.serial, date: obj.date || "", notes: obj.notes || "", minVeil: obj.minVeil, maxVeil: obj.maxVeil || "", display: d } };
  }

  // The person's own rules: { display: {...} } with the same schema and limits. Nothing else is read.
  function validateMine(obj) {
    if (!isObj(obj) || unknownKey(obj, ["display"])) return { ok: false, error: "not { display }" };
    var d = display(obj.display, { n: 0 });
    return typeof d === "string" ? { ok: false, error: d } : { ok: true, display: d };
  }

  function b64ToBuf(b64) {
    var bin = atob(String(b64 || "").trim()), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function verifyAny(subtle, keys, sig, bytes) {
    var i = 0;
    function next() {
      if (i >= keys.length) return Promise.resolve(false);
      var jwk = keys[i++];
      return subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
        .then(function (k) { return subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, sig, bytes); })
        .then(function (ok) { return ok ? true : next(); }, function () { return next(); });
    }
    return next();
  }

  // What the background does with a downloaded file. Resolves { ok: true, rules } for a file to keep, { ok: true, same: true,
  // serial } for a good file that is not newer than what is held or packaged, { ok: false, error } for anything else. A file
  // that is refused changes nothing: the rules in use stay as they are.
  function accept(o) {
    var bytes = o.bytes, size = bytes ? (bytes.byteLength !== undefined ? bytes.byteLength : bytes.length) : 0;
    if (!size) return Promise.resolve({ ok: false, error: "an empty file" });
    if (size > LIMITS.bytes) return Promise.resolve({ ok: false, error: "the file is " + size + " bytes (" + LIMITS.bytes + " at most)" });
    var sig;
    try { sig = b64ToBuf(o.sig); } catch (e) { return Promise.resolve({ ok: false, error: "the signature is not base64" }); }
    return verifyAny(o.subtle, o.keys || [], sig, bytes).then(function (good) {
      if (!good) return { ok: false, error: "the signature does not match a rules key" };
      var obj;
      try { obj = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { return { ok: false, error: "not JSON" }; }
      var v = validate(obj, o.ownVersion);
      if (!v.ok) return v;
      if (!newer(v.rules.serial, BASE_SERIAL) || (o.heldSerial && !newer(v.rules.serial, o.heldSerial))) return { ok: true, same: true, serial: v.rules.serial };
      return { ok: true, rules: v.rules, file: obj };
    }, function (e) { return { ok: false, error: "could not check the signature: " + String(e && e.message || e).slice(0, 80) }; });
  }

  // What a page may use of the stored copy (pv:rules = { serial, at, file }): nothing while the switch is off, nothing that
  // fails the schema or the version check today, nothing older than the package's own rules.
  function fromStore(held, ownVersion, switchOn) {
    if (!switchOn || !isObj(held) || !isObj(held.file)) return null;
    var v = validate(held.file, ownVersion);
    if (!v.ok || !newer(v.rules.serial, BASE_SERIAL)) return null;
    return v.rules;
  }

  function hostIn(hostname, hosts) {
    var h = String(hostname || "").toLowerCase();
    for (var i = 0; i < hosts.length; i++) { var x = hosts[i]; if (h === x || h.slice(-(x.length + 1)) === "." + x) return true; }
    return false;
  }

  // Packaged rules, then the update's display rules, then the person's own. The person's own always win: a selector they added
  // stays when an update switches it off, one they switched off stays off when an update adds it, and their site entry replaces
  // an update's entry with the same id. `base` is { slots: [selector], stacks: [{ stack, sel }] }; `update` and `mine` are
  // validated display objects or null.
  function effective(base, update, mine) {
    var slots = (base.slots || []).slice(), stacks = (base.stacks || []).map(function (s) { return { stack: s.stack, sel: s.sel }; });
    var badge = Object.create(null), section = Object.create(null), kill = Object.create(null);
    var noAds = [], labelOff = [], sites = [], added = Object.create(null);
    function layer(d, own) {
      if (!d) return;
      slots = slots.filter(function (s) { return d.slots.off.indexOf(s) < 0; });
      d.slots.add.forEach(function (s) { if (slots.indexOf(s) < 0) { slots.push(s); added[s] = true; } });
      stacks = stacks.filter(function (s) { return d.stacks.off.indexOf(s.stack) < 0; });
      d.stacks.add.forEach(function (s) { if (!stacks.some(function (t) { return t.stack === s.stack && t.sel === s.sel; })) stacks.push({ stack: s.stack, sel: s.sel }); });
      d.labels.badge.forEach(function (w) { badge[w.toLowerCase()] = true; });
      d.labels.section.forEach(function (w) { section[w.toLowerCase()] = true; });
      d.hosts.noAds.forEach(function (h) { if (noAds.indexOf(h) < 0) noAds.push(h); });
      d.hosts.labelWalkerOff.forEach(function (h) { if (labelOff.indexOf(h) < 0) labelOff.push(h); });
      d.kill.forEach(function (id) { kill[id] = true; });
      d.sites.forEach(function (s) {
        sites = sites.filter(function (t) { return t.id !== s.id; });
        sites.push({ id: s.id, hosts: s.hosts.slice(), cover: s.cover.slice(), closest: s.closest, text: s.text ? { sel: s.text.sel, equals: s.text.equals.map(function (w) { return w.toLowerCase(); }) } : null, never: s.never.slice(), whole: s.whole, own: !!own });
      });
    }
    layer(update, false);
    layer(mine, true);
    return { slots: slots, stacks: stacks, badge: badge, section: section, noAds: noAds, labelOff: labelOff, sites: sites, kill: kill, added: added };
  }

  var api = {
    FORMAT: FORMAT, BASE_SERIAL: BASE_SERIAL, LIMITS: LIMITS,
    validate: validate, validateMine: validateMine, accept: accept, fromStore: fromStore, effective: effective,
    newer: newer, atLeast: atLeast, hostIn: hostIn, selOk: selOk
  };
  root.PrismRulesPack = api;
  // in a page: on the content scripts' shared namespace, where src/rules.js looks for it
  try { if (typeof window !== "undefined" && window) (window.__prismVeilNS || (window.__prismVeilNS = {})).rulesPack = api; } catch (e) {}
})(typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this));
