/* Prism start page (New Tab override). No network of its own; settings in
   chrome.storage.local (spec section 10: persisted, never wiped by us). */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var DEFAULTS = {
    engine: "https://www.bing.com/search",
    clockfmt: "12",
    drift: true,
    onlineArt: true,   // stream the full photo pool from ART_HOSTS; off = bundled subset only
    srcMarks: false,   // colour quick links by Wikipedia RSP reliability status (spec section 5: off by default)
    wx: null,          // { name, lat, lon } - set by the user; null = weather off
    wxUnits: "f",
    frames: [],        // [{ name, url, token }] - the user's paired Prism frames
    calUrl: "",        // the user's private .ics feed URL (stored locally only)
    musicUrl: "",      // an Apple Music share URL; embedded via embed.music.apple.com
    links: [
      { name: "Mail", url: "https://outlook.live.com/" },
      { name: "Calendar", url: "https://calendar.google.com/" },
      { name: "YouTube", url: "https://www.youtube.com/" },
      { name: "Reddit", url: "https://www.reddit.com/" },
      { name: "Weather", url: "https://weather.com/" },
    ],
  };
  var state = Object.assign({}, DEFAULTS);

  function load(cb) {
    try {
      chrome.storage.local.get("ntp", function (r) {
        if (r && r.ntp) state = Object.assign({}, DEFAULTS, r.ntp);
        cb();
      });
    } catch (e) { cb(); }
  }
  function save() { try { chrome.storage.local.set({ ntp: state }); } catch (e) {} }

  // ---- art: crossfade a new photo every few minutes. The full pool is hosted
  // (ART_HOSTS[i]/list.json, plain GET, no identifiers - spec section 19/22); the
  // bundled subset (art/list.json) is the offline fallback and the only pool
  // when "online photos" is off. Extension pages send no Referer.
  // Hosts tried in order (a public Tigris bucket; see prism-veil-art/README).
  var ART_HOSTS = ["https://prism.entangled.world/veil/art/"];
  // Public half of the pool signing key (prism-veil-art/sign-list.mjs). The
  // host is untrusted: list.json must verify against list.sig, and every image
  // must match its listed sha256, or it is never shown.
  var ART_PUBKEY = {"kty":"EC","x":"RRm7HBVLCL9Yl3rz-6pYtOdEHzFRG03Yu5nssSOvqkA","y":"hWgDhLZnqKak1Vn6uzOk5ZSyXlMQkfSsRIcyC3-qTNA","crv":"P-256"};
  var ART = [], current = -1;   // entries: { url, sha256 } (hosted) or { url } (bundled)
  var artHost = "";             // which pool is active: "" = bundled, else the host base
  function b64ToBuf(b64) { var bin = atob(b64.trim()), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }
  function paint(url) {
    var host = $("art"), old = host.querySelector(".layer.on");
    var l = document.createElement("div");
    l.className = "layer";
    l.style.backgroundImage = "url('" + url + "')";
    host.appendChild(l);
    requestAnimationFrame(function () { l.classList.add("on"); });
    if (old) { old.classList.remove("on"); setTimeout(function () { old.remove(); if (old.dataset.blob) URL.revokeObjectURL(old.dataset.blob); }, 1800); }
    return l;
  }
  function showArt() {
    if (!ART.length) return;
    var i; do { i = Math.floor(Math.random() * ART.length); } while (ART.length > 1 && i === current);
    current = i;
    var e = ART[i];
    if (!e.sha256) { paint(e.url); return; }
    // hosted: fetch, verify hash, display as a blob (never the raw URL)
    var mine = artHost;
    fetch(e.url, { referrerPolicy: "no-referrer" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(function (buf) { return crypto.subtle.digest("SHA-256", buf).then(function (d) { if (hex(d) !== e.sha256) throw new Error("hash mismatch"); return buf; }); })
      .then(function (buf) {
        if (artHost !== mine) return;
        var url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
        paint(url).dataset.blob = url;
      })
      .catch(function () { ART.splice(i, 1); current = -1; if (!ART.length) useBundled(); });
  }
  function useBundled() {
    artHost = "";
    return fetch(chrome.runtime.getURL("art/list.json")).then(function (r) { return r.json(); }).then(function (list) {
      ART = list.filter(function (p) { return /\.jpe?g$/i.test(p); }).map(function (p) { return { url: chrome.runtime.getURL(p) }; });
      current = -1; showArt();
    }).catch(function () {});
  }
  // Fetch <base>list.json + list.sig and return the parsed index only if the
  // signature verifies against ART_PUBKEY. Used for the art pool and the
  // source-reliability list alike.
  function fetchSigned(base) {
    var opts = { referrerPolicy: "no-referrer", cache: "no-cache" };
    return Promise.all([
      fetch(base + "list.json", opts).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
      fetch(base + "list.sig", opts).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }),
      crypto.subtle.importKey("jwk", ART_PUBKEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    ]).then(function (x) {
      return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, x[2], b64ToBuf(x[1]), x[0]).then(function (ok) {
        if (!ok) throw new Error("bad signature");
        return JSON.parse(new TextDecoder().decode(x[0]));
      });
    });
  }
  function loadHosted(base) {
    return fetchSigned(base).then(function (idx) {
      var files = (idx && idx.v === 1 && idx.files) || [];
      return files.filter(function (e) { return e && /^[\w.-]+\.jpe?g$/i.test(e.f) && /^[0-9a-f]{64}$/.test(e.sha256); })
        .map(function (e) { return { url: base + e.f, sha256: e.sha256 }; });
    });
  }
  var artTimer = null;
  function initArt() {
    useBundled();   // instant paint; replaced by the hosted pool once it verifies
    if (state.onlineArt) {
      (function tryHost(i) {
        if (i >= ART_HOSTS.length) return;
        loadHosted(ART_HOSTS[i]).then(function (list) {
          if (!list.length) throw new Error("empty");
          ART = list; artHost = ART_HOSTS[i]; current = -1; showArt();
        }).catch(function () { tryHost(i + 1); });
      })(0);
    }
    if (artTimer) clearInterval(artTimer);
    artTimer = setInterval(showArt, 4 * 60 * 1000);
  }

  // ---- clock
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function tick() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    var mm = (m < 10 ? "0" : "") + m, t;
    if (state.clockfmt === "24") t = (h < 10 ? "0" : "") + h + ":" + mm;
    else { var hh = h % 12 || 12; t = hh + ":" + mm; }
    if ($("time").textContent !== t) $("time").textContent = t;
    var ds = DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
    if ($("date").textContent !== ds) $("date").textContent = ds;
  }

  // ---- source reliability marks (spec section 5, "Credibility labeling"):
  // Wikipedia's Perennial Sources list, CC BY-SA, community-adjudicated, every
  // status linked to the discussion that decided it. Signed + verified like the
  // art index. Off by default; never hides anything; "unrated" is not "bad".
  var CRED_HOST = "https://prism.entangled.world/veil/credibility/";
  var CRED = null;   // { legend, source, byHost: { host: [{ e, host, path }] } }
  function loadCred() {
    if (CRED || !state.srcMarks) return Promise.resolve(CRED);
    return fetchSigned(CRED_HOST).then(function (idx) {
      if (!idx || idx.v !== 1 || !idx.entries) throw new Error("bad index");
      var byHost = {};
      idx.entries.forEach(function (e) {
        (e.domains || []).forEach(function (d) {
          var slash = d.indexOf("/"), host = slash < 0 ? d : d.slice(0, slash), path = slash < 0 ? "" : d.slice(slash);
          (byHost[host] = byHost[host] || []).push({ e: e, host: host, path: path });
        });
      });
      CRED = { legend: idx.legend || {}, source: idx.source || {}, byHost: byHost };
      return CRED;
    }).catch(function () { return null; });
  }
  // Longest domain(+path) match wins; several entries on the same key = mixed.
  function credFor(url) {
    if (!CRED) return null;
    var u; try { u = new URL(url); } catch (e) { return null; }
    var host = u.hostname.toLowerCase().replace(/^www\./, ""), labels = host.split("."), best = [], bestLen = -1;
    for (var i = 0; i < labels.length - 1; i++) {
      var h = labels.slice(i).join("."), cands = CRED.byHost[h] || [];
      cands.forEach(function (c) {
        if (c.path && u.pathname.indexOf(c.path) !== 0) return;
        var len = h.length + c.path.length;
        if (len > bestLen) { bestLen = len; best = [c.e]; } else if (len === bestLen) best.push(c.e);
      });
    }
    if (!best.length) return null;
    var statuses = {}; best.forEach(function (e) { statuses[e.status] = 1; });
    return { status: Object.keys(statuses).length > 1 ? "m" : best[0].status, entries: best };
  }
  function markLinks() {
    var links = $("links").querySelectorAll("a[data-url]");
    Array.prototype.forEach.call(links, function (a) {
      var dot = a.querySelector(".dot"), why = a.parentNode.querySelector(".why");
      dot.className = "dot"; a.removeAttribute("title"); if (why) why.remove();
      if (!state.srcMarks || !CRED) return;
      var m = credFor(a.dataset.url); if (!m) return;
      var e = m.entries[0], label = m.status === "m" ? "Mixed - several ratings apply" : (CRED.legend[m.status] || m.status);
      dot.classList.add("s-" + m.status);
      a.title = "Wikipedia RSP: " + label + (e.last ? " (last discussed " + e.last + ")" : "") + " - " + e.name;
      var w = document.createElement("a");
      w.className = "why";
      w.href = (CRED.source.url || "https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources") + "#" + encodeURIComponent(e.id);
      w.target = "_blank"; w.rel = "noreferrer noopener";
      w.title = "Why? Read the discussion behind this rating on Wikipedia"; w.textContent = "?";
      a.parentNode.appendChild(w);
    });
  }

  // ---- links
  function renderLinks() {
    var nav = $("links"); nav.textContent = "";
    state.links.forEach(function (l) {
      if (!l || !l.url) return;
      var wrap = document.createElement("span"); wrap.className = "ql";
      var a = document.createElement("a");
      a.href = l.url; a.rel = "noreferrer"; a.dataset.url = l.url;
      var dot = document.createElement("span"); dot.className = "dot";
      a.appendChild(dot); a.appendChild(document.createTextNode(l.name || l.url));
      wrap.appendChild(a); nav.appendChild(wrap);
    });
    if (state.srcMarks) loadCred().then(markLinks); else markLinks();
  }

  // ---- search: plain GET to the chosen engine, only on submit
  function applyEngine() { $("search").action = state.engine; }

  // ---- Apple Music (official embed). A music.apple.com share URL becomes an
  // embed.music.apple.com player - full playback for a signed-in subscriber,
  // previews otherwise. Only music.apple.com is accepted (nothing else framed).
  function musicEmbedSrc(url) {
    try {
      var u = new URL(url);
      if (!/(^|\.)music\.apple\.com$/i.test(u.hostname)) return null;
      u.hostname = "embed.music.apple.com";
      return u.href;
    } catch (e) { return null; }
  }
  function renderMusic() {
    var box = $("music"); box.textContent = "";
    var src = state.musicUrl ? musicEmbedSrc(state.musicUrl) : null;
    if (!src) { box.hidden = true; return; }
    // a playlist/album is tall; a single song is short
    box.classList.toggle("tall", /\/(playlist|album)\//i.test(src));
    var f = document.createElement("iframe");
    f.setAttribute("allow", "autoplay *; encrypted-media *; clipboard-write");
    f.setAttribute("sandbox", "allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation");
    f.setAttribute("loading", "lazy");
    f.title = "Apple Music";
    f.src = src;
    box.appendChild(f);
    // A station shuffles by design; a playlist/album plays in order (the embed
    // has no shuffle control we can drive). Say which this is.
    var isStation = /station|(^|[^a-z])ra\./i.test(src);
    var cap = document.createElement("div"); cap.className = "music-cap";
    cap.textContent = isStation ? "◈ Shuffled station" : "▶ Plays in order — use a station link to shuffle";
    box.appendChild(cap);
    box.hidden = false;
  }

  // ---- weather (traceable source: Open-Meteo, https://open-meteo.com - free,
  // keyless). Privacy (spec 19/22): the ONLY thing sent is a lat/lon rounded to
  // ~1 km, only when the user has set a location, at most every 15 minutes.
  // Place names are geocoded once through Open-Meteo's geocoder, then stored.
  var WX_CODES = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Snow showers",
    95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, hail",
  };
  var DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var wxTimer = 0;
  function round3(n) { return Math.round(n * 100) / 100; } // ~1 km
  function wxUrl(loc) {
    var u = state.wxUnits === "c" ? "celsius" : "fahrenheit";
    return "https://api.open-meteo.com/v1/forecast?latitude=" + round3(loc.lat) + "&longitude=" + round3(loc.lon) +
      "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=4" +
      "&temperature_unit=" + u + "&wind_speed_unit=mph&timezone=auto";
  }
  function fmtClock(iso) {
    var t = new Date(iso), h = t.getHours(), m = t.getMinutes();
    return (state.clockfmt === "24" ? (h < 10 ? "0" : "") + h : (h % 12 || 12)) + ":" + (m < 10 ? "0" : "") + m;
  }
  function renderWx(d) {
    var w = $("weather"); if (!d || !d.current) { w.hidden = true; return; }
    var c = d.current, deg = "\u00B0";
    $("wx-temp").textContent = Math.round(c.temperature_2m) + deg;
    $("wx-desc").textContent = (WX_CODES[c.weather_code] || "") + (state.wx && state.wx.name ? " \u00B7 " + state.wx.name : "");
    var sr = d.daily && d.daily.sunrise && d.daily.sunrise[0], ss = d.daily && d.daily.sunset && d.daily.sunset[0];
    $("wx-meta").textContent = "Feels " + Math.round(c.apparent_temperature) + deg + "  \u00B7  Wind " + Math.round(c.wind_speed_10m) + " mph  \u00B7  Humidity " + c.relative_humidity_2m + "%" +
      (sr && ss ? "  \u00B7  \u2600 " + fmtClock(sr) + " \u2013 " + fmtClock(ss) : "");
    var days = $("wx-days"); days.textContent = "";
    if (d.daily && d.daily.time) {
      for (var i = 1; i < Math.min(4, d.daily.time.length); i++) {
        var el = document.createElement("div"); el.className = "day";
        var b = document.createElement("b"); b.textContent = DAY_SHORT[new Date(d.daily.time[i] + "T12:00:00").getDay()];
        el.appendChild(b);
        el.appendChild(document.createTextNode((WX_CODES[d.daily.weather_code[i]] || "") + " " + Math.round(d.daily.temperature_2m_max[i]) + deg + " "));
        var lo = document.createElement("span"); lo.className = "lo"; lo.textContent = Math.round(d.daily.temperature_2m_min[i]) + deg;
        el.appendChild(lo); days.appendChild(el);
      }
    }
    w.hidden = false;
  }
  function refreshWx(force) {
    if (wxTimer) { clearTimeout(wxTimer); wxTimer = 0; }
    if (!state.wx) { $("weather").hidden = true; return; }
    var now = Date.now();
    var go = function () {
      fetch(wxUrl(state.wx), { referrerPolicy: "no-referrer", credentials: "omit" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          renderWx(d);
          try { chrome.storage.local.set({ wxcache: { at: now, loc: state.wx, units: state.wxUnits, data: d } }); } catch (e) {}
        }).catch(function () {});
    };
    try {
      chrome.storage.local.get("wxcache", function (r) {
        var c = r && r.wxcache;
        if (!force && c && c.loc && c.loc.lat === state.wx.lat && c.loc.lon === state.wx.lon && c.units === state.wxUnits && now - c.at < 15 * 60 * 1000) renderWx(c.data);
        else go();
      });
    } catch (e) { go(); }
    wxTimer = setTimeout(function () { refreshWx(true); }, 15 * 60 * 1000);
  }
  function geocode(name, cb) {
    fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" + encodeURIComponent(name),
      { referrerPolicy: "no-referrer", credentials: "omit" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var h = d && d.results && d.results[0];
        if (!h) return cb(null);
        cb({ name: h.name + (h.admin1 ? ", " + h.admin1 : ""), lat: round3(h.latitude), lon: round3(h.longitude) });
      }).catch(function () { cb(null); });
  }
  var pendingWx; // location chosen in the dialog, applied on Save
  var WX_ORIGINS = ["https://api.open-meteo.com/*", "https://geocoding-api.open-meteo.com/*"];
  function ensureWxPermission(cb) {
    if (!chrome.permissions) return cb(true);
    try {
      chrome.permissions.contains({ origins: WX_ORIGINS }, function (has) {
        if (has) return cb(true);
        try { chrome.permissions.request({ origins: WX_ORIGINS }, function (g) { cb(!!g); }); } catch (e) { cb(false); }
      });
    } catch (e) { cb(false); }
  }
  function locateMe() {
    var st = $("wx-status"); st.textContent = "Locating\u2026";
    if (!navigator.geolocation) { st.textContent = "Geolocation unavailable"; return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      pendingWx = { name: "My location", lat: round3(pos.coords.latitude), lon: round3(pos.coords.longitude) };
      $("wx-place").value = pendingWx.name; st.textContent = "Set to your current position (rounded to ~1 km)";
    }, function (err) {
      st.textContent = (err && err.code === 1) ? "Location permission denied - type a town instead, or reload the extension (it now declares the geolocation permission)"
                     : (err && err.code === 3) ? "Location timed out - type a town instead" : "Location unavailable - type a town instead";
    }, { enableHighAccuracy: false, maximumAge: 600000, timeout: 10000 });
  }

  // ---- Prism frames (spec section 6 remote API). Each frame is a device on
  // the LAN serving http://<ip>:8471 with a bearer token minted at pairing.
  // Talks ONLY to frames the user listed; the per-origin host permission is
  // requested when a frame is saved, never for the web at large.
  var frameTimer = 0, frameState = {};
  function frameOrigin(f) { try { return new URL(f.url).origin; } catch (e) { return null; } }
  function frameFetch(f, method, path, body) {
    return fetch(f.url.replace(/\/$/, "") + path, {
      method: method, referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store",
      headers: Object.assign({ "Authorization": "Bearer " + f.token }, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }, function () { return { ok: r.ok, status: r.status, body: null }; }); });
  }
  function flash(btn, ok) { btn.classList.add(ok ? "ok" : "err"); setTimeout(function () { btn.classList.remove("ok", "err"); }, 1200); }
  function renderFrames() {
    var host = $("frames"); host.textContent = "";
    if (!state.frames || !state.frames.length) { host.hidden = true; return; }
    host.hidden = false;
    state.frames.forEach(function (f, idx) {
      var st = frameState[idx], card = document.createElement("div");
      card.className = "frame" + (st && st.ok ? " on" : "") + (st && st.asleep ? " asleep" : "");
      var head = document.createElement("div"); head.className = "head";
      var led = document.createElement("span"); led.className = "led";
      var name = document.createElement("span"); name.className = "name"; name.textContent = f.name;
      var dash = document.createElement("span"); dash.className = "dash";
      dash.textContent = st && st.ok ? (st.snap.name || st.snap.dashboard) : (st && st.error ? st.error : "");
      head.appendChild(led); head.appendChild(name); head.appendChild(dash); card.appendChild(head);
      var now = document.createElement("div"); now.className = "now";
      if (st && st.ok) {
        var snap = st.snap, playing = (snap.tiles || []).filter(function (t) { return t.playing; });
        if (playing.length) {
          var p = document.createElement("span"); p.className = "play"; p.textContent = "\u25B6";
          now.appendChild(p); now.appendChild(document.createTextNode(playing.map(function (t) { return t.id + (t.url ? " \u00B7 " + t.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40) : ""); }).join(", ")));
        } else if (snap.fullscreen) now.textContent = snap.fullscreen + " \u00B7 fullscreen";
        else now.textContent = (snap.tiles || []).length + " tiles \u00B7 " + snap.layoutMode;
      } else { now.className = "now off"; now.textContent = st ? "unreachable" : "\u2026"; }
      card.appendChild(now);
      // controls
      var row = document.createElement("div"); row.className = "row";
      var mk = function (label, title, fn) { var b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title; b.addEventListener("click", function () { fn(b); }); return b; };
      if (st && st.ok) {
        var playing2 = (st.snap.tiles || []).filter(function (t) { return t.playing; });
        var target = playing2[0] || (st.snap.tiles || []).find(function (t) { return t.audio && t.audio !== "mute"; });
        if (target) row.appendChild(mk(playing2.length ? "\u23F8" : "\u25B6", (playing2.length ? "Pause " : "Play ") + target.id, function (b) {
          frameFetch(f, "POST", "/tiles/" + encodeURIComponent(target.id) + "/command", { cmd: playing2.length ? "pause" : "play" }).then(function (r) { flash(b, r.ok); pollFrames(); });
        }));
        row.appendChild(mk("\u263D", "Sleep display", function (b) { frameFetch(f, "POST", "/display", { power: "sleep" }).then(function (r) { flash(b, r.ok); }); }));
        row.appendChild(mk("\u2600", "Wake display", function (b) { frameFetch(f, "POST", "/display", { power: "wake" }).then(function (r) { flash(b, r.ok); }); }));
        card.appendChild(row);
        // send a page to a web tile
        var web = (st.snap.tiles || []).filter(function (t) { return !t.launch && t.mode !== "native"; });
        if (web.length) {
          var row2 = document.createElement("div"); row2.className = "row";
          var sel = document.createElement("select"); web.forEach(function (t) { var o = document.createElement("option"); o.value = t.id; o.textContent = t.id; sel.appendChild(o); });
          var inp = document.createElement("input"); inp.type = "url"; inp.placeholder = "https://\u2026 send to tile"; inp.spellcheck = false;
          var go = mk("\u2192", "Open this URL on that tile", function (b) {
            var u = inp.value.trim(); if (!/^https?:\/\//i.test(u)) { flash(b, false); return; }
            frameFetch(f, "POST", "/navigate", { tile: sel.value, url: u }).then(function (r) { flash(b, r.ok); if (r.ok) { inp.value = ""; pollFrames(); } });
          });
          inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go.click(); } });
          row2.appendChild(sel); row2.appendChild(inp); row2.appendChild(go); card.appendChild(row2);
        }
      } else {
        row.appendChild(mk("\u21BB", "Retry", function () { pollFrames(); })); card.appendChild(row);
      }
      host.appendChild(card);
    });
  }
  function pollFrames() {
    if (frameTimer) { clearTimeout(frameTimer); frameTimer = 0; }
    if (!state.frames || !state.frames.length) { renderFrames(); return; }
    var pending = state.frames.length;
    state.frames.forEach(function (f, idx) {
      frameFetch(f, "GET", "/state").then(function (r) {
        frameState[idx] = r.ok ? { ok: true, snap: r.body } : { ok: false, error: r.status === 401 ? "bad token" : "HTTP " + r.status };
      }).catch(function () { frameState[idx] = { ok: false, error: "" }; })
        .then(function () { if (--pending === 0) renderFrames(); });
    });
    if (!document.hidden) frameTimer = setTimeout(pollFrames, 20000);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) pollFrames(); });
  function parseFrames(text) {
    return text.split("\n").map(function (line) {
      var p = line.split("|").map(function (x) { return x.trim(); });
      if (p.length < 3 || !/^https?:\/\//i.test(p[1]) || !p[2]) return null;
      return { name: p[0] || p[1], url: p[1].replace(/\/$/, ""), token: p[2] };
    }).filter(Boolean);
  }
  // Ask for exactly the frames' origins (optional_host_permissions), so the
  // page can reach them without a blanket grant.
  function ensureFramePermissions(frames, cb) {
    var origins = frames.map(frameOrigin).filter(Boolean).map(function (o) { return o + "/*"; });
    if (!origins.length || !chrome.permissions) return cb(true);
    try { chrome.permissions.request({ origins: origins }, function (granted) { cb(!!granted); }); } catch (e) { cb(false); }
  }

  // ---- Today (calendar): the user's own .ics feed. Minimal, exact iCalendar
  // parsing for what feeds like this carry: folded lines, VEVENT with
  // DTSTART/DTEND as UTC ("...Z"), floating local time, or all-day
  // (VALUE=DATE), SUMMARY/LOCATION escapes. No recurrence expansion (feeds
  // that pre-expand, like this one, need none); an RRULE event shows only on
  // its first date. Cached 10 minutes.
  var calTimer = 0;
  function icsUnfold(text) { return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, ""); }
  function icsUnescape(s) { return (s || "").replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\"); }
  function icsDate(val, params) {
    // returns { d: Date, allDay: bool } or null. TZID/floating times are
    // treated as local time (the user's own calendar, on their own machine).
    if (!val) return null;
    var m;
    if (/VALUE=DATE(?![-T])/i.test(params || "") || /^\d{8}$/.test(val)) {
      m = val.match(/^(\d{4})(\d{2})(\d{2})/); if (!m) return null;
      return { d: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };
    }
    m = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/); if (!m) return null;
    var d = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)))
                 : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return { d: d, allDay: false };
  }
  function icsDuration(val) {   // P1D, PT1H30M, P1DT2H -> ms
    var m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(val || ""); if (!m) return null;
    var ms = ((+m[2] || 0) * 7 + (+m[3] || 0)) * 86400000 + (+m[4] || 0) * 3600000 + (+m[5] || 0) * 60000 + (+m[6] || 0) * 1000;
    return m[1] ? -ms : ms;
  }
  function parseIcs(text) {
    var lines = icsUnfold(text).split("\n"), ev = null, out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line === "BEGIN:VEVENT") { ev = { exdates: {} }; continue; }
      if (line === "END:VEVENT") { if (ev && ev.start) out.push(ev); ev = null; continue; }
      if (!ev) continue;
      var c = line.indexOf(":"); if (c < 0) continue;
      var head = line.slice(0, c), val = line.slice(c + 1), semi = head.indexOf(";");
      var name = (semi < 0 ? head : head.slice(0, semi)).toUpperCase(), params = semi < 0 ? "" : head.slice(semi + 1);
      if (name === "DTSTART") ev.start = icsDate(val, params);
      else if (name === "DTEND") ev.end = icsDate(val, params);
      else if (name === "DURATION") ev.duration = icsDuration(val);
      else if (name === "SUMMARY") ev.summary = icsUnescape(val);
      else if (name === "LOCATION") ev.location = icsUnescape(val);
      else if (name === "UID") ev.uid = val;
      else if (name === "RRULE") ev.rrule = val;
      else if (name === "RECURRENCE-ID") { var rid = icsDate(val, params); if (rid) ev.recurrenceId = rid.d.getTime(); }
      else if (name === "EXDATE") val.split(",").forEach(function (x) { var d = icsDate(x.trim(), params); if (d) ev.exdates[d.d.getTime()] = 1; });
      else if (name === "STATUS" && /CANCELLED/i.test(val)) ev.cancelled = true;
    }
    return expandRecurrences(out);
  }
  // RRULE expansion (RFC 5545 subset that covers what Outlook/Google emit:
  // FREQ, INTERVAL, COUNT, UNTIL, BYDAY incl. ordinal for MONTHLY, BYMONTHDAY,
  // BYMONTH; EXDATE; RECURRENCE-ID overrides; STATUS:CANCELLED). Instances
  // are generated for a window around now - the views never look further.
  var CAL_WIN_BACK = 45 * 86400000, CAL_WIN_FWD = 120 * 86400000;
  var DAYIDX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  function expandRecurrences(evs) {
    var now = Date.now(), winStart = now - CAL_WIN_BACK, winEnd = now + CAL_WIN_FWD;
    var overrides = {};   // uid -> { recurrenceTime: event }
    evs.forEach(function (e) { if (e.recurrenceId != null && e.uid) (overrides[e.uid] = overrides[e.uid] || {})[e.recurrenceId] = e; });
    var out = [];
    function instance(master, startDate) {
      var dur = master.duration != null ? master.duration
        : (master.end ? master.end.d.getTime() - master.start.d.getTime() : (master.start.allDay ? 86400000 : 3600000));
      var inst = { uid: master.uid, summary: master.summary, location: master.location, recurring: true,
                   start: { d: startDate, allDay: master.start.allDay }, end: { d: new Date(startDate.getTime() + dur), allDay: master.start.allDay } };
      return inst;
    }
    evs.forEach(function (e) {
      if (e.recurrenceId != null) return;                  // overrides are applied via their master
      if (!e.rrule) { if (!e.cancelled) out.push(e); return; }
      var r = {}; e.rrule.split(";").forEach(function (kv) { var p = kv.split("="); r[p[0].toUpperCase()] = (p[1] || "").toUpperCase(); });
      var freq = r.FREQ, interval = Math.max(1, +r.INTERVAL || 1), count = +r.COUNT || 0;
      var until = r.UNTIL ? (icsDate(r.UNTIL) || {}).d : null;
      if (!/^(DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(freq)) { out.push(e); return; }
      var byday = r.BYDAY ? r.BYDAY.split(",").map(function (x) { var m = /^([+-]?\d)?([A-Z]{2})$/.exec(x); return m ? { ord: +m[1] || 0, day: DAYIDX[m[2]] } : null; }).filter(Boolean) : null;
      var bymonthday = r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : null;
      var bymonth = r.BYMONTH ? r.BYMONTH.split(",").map(Number) : null;
      var s0 = e.start.d, ovr = overrides[e.uid] || {}, produced = 0, emitted = 0;
      var stopAt = until ? Math.min(until.getTime(), winEnd) : winEnd;
      function emit(d) {
        produced++;
        var t = d.getTime();
        if (e.exdates[t]) return;
        var o = ovr[t];
        if (o) { if (!o.cancelled && o.start) { o.recurring = true; out.push(o); } return; }
        if (t >= winStart - 86400000 && t <= winEnd) { out.push(instance(e, d)); emitted++; }
      }
      function inWindow(d) { return d.getTime() <= stopAt && (!count || produced < count); }
      var guard = 0;
      if (freq === "DAILY") {
        for (var d = new Date(s0); inWindow(d) && guard++ < 5000; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + interval, d.getHours(), d.getMinutes(), d.getSeconds())) emit(d);
      } else if (freq === "WEEKLY") {
        var days = byday ? byday.map(function (b) { return b.day; }) : [s0.getDay()];
        // walk week by week from the week of DTSTART
        var weekStart = new Date(s0.getFullYear(), s0.getMonth(), s0.getDate() - s0.getDay(), s0.getHours(), s0.getMinutes(), s0.getSeconds());
        for (var w = weekStart; w.getTime() <= stopAt && guard++ < 2000; w = new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7 * interval, w.getHours(), w.getMinutes(), w.getSeconds())) {
          for (var k = 0; k < 7; k++) {
            if (days.indexOf(k) < 0) continue;
            var dd = new Date(w.getFullYear(), w.getMonth(), w.getDate() + k, w.getHours(), w.getMinutes(), w.getSeconds());
            if (dd < s0 || !inWindow(dd)) continue;
            emit(dd);
          }
        }
      } else if (freq === "MONTHLY") {
        for (var mi = 0; guard++ < 1200; mi += interval) {
          var y = s0.getFullYear(), mo = s0.getMonth() + mi, first = new Date(y, mo, 1);
          if (first.getTime() > stopAt) break;
          var cands = [];
          if (byday) {
            byday.forEach(function (b) {
              var dim = new Date(y, mo + 1, 0).getDate(), list = [];
              for (var dn = 1; dn <= dim; dn++) if (new Date(y, mo, dn).getDay() === b.day) list.push(dn);
              if (!b.ord) cands = cands.concat(list);
              else { var pick = b.ord > 0 ? list[b.ord - 1] : list[list.length + b.ord]; if (pick) cands.push(pick); }
            });
          } else if (bymonthday) {
            bymonthday.forEach(function (n) { var dim = new Date(y, mo + 1, 0).getDate(); var dn = n > 0 ? n : dim + 1 + n; if (dn >= 1 && dn <= dim) cands.push(dn); });
          } else cands.push(s0.getDate());
          cands.sort(function (a, b) { return a - b; }).forEach(function (dn) {
            var dim = new Date(y, mo + 1, 0).getDate(); if (dn > dim) return;
            var dd = new Date(y, mo, dn, s0.getHours(), s0.getMinutes(), s0.getSeconds());
            if (dd < s0 || !inWindow(dd)) return;
            emit(dd);
          });
          if (count && produced >= count) break;
        }
      } else if (freq === "YEARLY") {
        for (var yi = 0; guard++ < 200; yi += interval) {
          var yy = s0.getFullYear() + yi;
          var months = bymonth || [s0.getMonth() + 1];
          months.forEach(function (mm) {
            var dd = new Date(yy, mm - 1, s0.getDate(), s0.getHours(), s0.getMinutes(), s0.getSeconds());
            if (dd < s0 || !inWindow(dd)) return;
            emit(dd);
          });
          if (new Date(yy, 0, 1).getTime() > stopAt || (count && produced >= count)) break;
        }
      }
    });
    return out;
  }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function eventsOn(evs, day) {
    var dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()), dayEnd = new Date(dayStart.getTime() + 86400000);
    return evs.filter(function (e) {
      var s = e.start.d, en = e.end ? e.end.d : (e.start.allDay ? new Date(s.getTime() + 86400000) : new Date(s.getTime() + 3600000));
      return s < dayEnd && en > dayStart;   // overlaps the day (all-day DTEND is exclusive, so this is exact)
    }).sort(function (a, b) { return (b.start.allDay - a.start.allDay) || (a.start.d - b.start.d); });
  }

  // ---- calendar views: Today (default) and Month. State is per page load;
  // every new tab opens on Today, as asked.
  var CAL = { evs: [], view: "today", month: null, selected: null, error: "" };
  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function calStatus(msg) { CAL.error = msg || ""; var el = $("today-sub"); if (CAL.error) { el.textContent = CAL.error; el.classList.add("err"); } else el.classList.remove("err"); }
  function renderDayList(list, items, day, isToday) {
    list.textContent = "";
    if (!items.length) { var li0 = document.createElement("li"); li0.className = "empty"; li0.textContent = "Nothing scheduled"; list.appendChild(li0); return; }
    var now = new Date();
    items.forEach(function (e) {
      var li = document.createElement("li"), when = document.createElement("span"), what = document.createElement("span");
      when.className = "when"; what.className = "what";
      var s = e.start.d, en = e.end ? e.end.d : null;
      if (e.start.allDay) { when.classList.add("allday"); when.textContent = "all day"; }
      else {
        when.textContent = fmtClock(s.toISOString()) + (en ? "\u2013" + fmtClock(en.toISOString()) : "");
        if (isToday) { if (en && en < now) li.classList.add("past"); else if (s <= now && (!en || en > now)) li.classList.add("now"); }
      }
      what.textContent = e.summary || "(untitled)";
      if (e.location) { var w = document.createElement("span"); w.className = "where"; w.textContent = e.location; what.appendChild(w); }
      li.appendChild(when); li.appendChild(what); list.appendChild(li);
    });
  }
  function renderCal(evs) {
    if (evs) CAL.evs = evs;
    var box = $("today"), list = $("today-list"), grid = $("cal-grid");
    if (!state.calUrl) { box.hidden = true; return; }
    box.hidden = false; box.classList.toggle("month", CAL.view === "month");
    $("cal-view-today").classList.toggle("on", CAL.view === "today");
    $("cal-view-month").classList.toggle("on", CAL.view === "month");
    $("cal-nav").hidden = CAL.view !== "month";
    var now = new Date();
    if (CAL.view === "today") {
      grid.hidden = true;
      var items = eventsOn(CAL.evs, now), title = "Today";
      if (!items.length) { var tm = new Date(now.getTime() + 86400000); items = eventsOn(CAL.evs, tm); if (items.length) title = "Tomorrow"; }
      $("today-title").textContent = title;
      if (!CAL.error) $("today-sub").textContent = items.length ? items.length + (items.length === 1 ? " event" : " events") : "";
      renderDayList(list, items, now, title === "Today");
      return;
    }
    // month view
    var m = CAL.month || new Date(now.getFullYear(), now.getMonth(), 1); CAL.month = m;
    $("today-title").textContent = MONTHS_SHORT[m.getMonth()] + " " + m.getFullYear();
    var monthEvs = CAL.evs.filter(function (e) { var s = e.start.d, en = e.end ? e.end.d : s; return s < new Date(m.getFullYear(), m.getMonth() + 1, 1) && en >= m; });
    if (!CAL.error) $("today-sub").textContent = monthEvs.length ? monthEvs.length + (monthEvs.length === 1 ? " event" : " events") : "";
    grid.hidden = false; grid.textContent = "";
    ["S", "M", "T", "W", "T", "F", "S"].forEach(function (d) { var h = document.createElement("div"); h.className = "dow"; h.textContent = d; grid.appendChild(h); });
    var first = new Date(m.getFullYear(), m.getMonth(), 1), start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    var sel = CAL.selected || (sameDay(now, now) && now.getMonth() === m.getMonth() && now.getFullYear() === m.getFullYear() ? now : first);
    CAL.selected = sel;
    for (var i = 0; i < 42; i++) {
      var day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (i >= 35 && day.getMonth() !== m.getMonth()) break;
      var cell = document.createElement("button"); cell.type = "button"; cell.className = "day";
      if (day.getMonth() !== m.getMonth()) cell.classList.add("out");
      if (sameDay(day, now)) cell.classList.add("today");
      if (sameDay(day, sel)) cell.classList.add("sel");
      var n = document.createElement("span"); n.className = "n"; n.textContent = day.getDate(); cell.appendChild(n);
      var items = eventsOn(CAL.evs, day);
      if (items.length) {
        var dots = document.createElement("span"); dots.className = "dots";
        for (var k = 0; k < Math.min(items.length, 3); k++) { var dot = document.createElement("i"); if (items[k].start.allDay) dot.className = "allday"; dots.appendChild(dot); }
        if (items.length > 3) { var more = document.createElement("b"); more.textContent = "+" + (items.length - 3); dots.appendChild(more); }
        cell.appendChild(dots);
        cell.title = items.map(function (e) { return (e.start.allDay ? "all day" : fmtClock(e.start.d.toISOString())) + "  " + (e.summary || "(untitled)"); }).join("\n");
      }
      cell.dataset.t = day.getTime();
      cell.addEventListener("click", function (ev) { CAL.selected = new Date(+ev.currentTarget.dataset.t); renderCal(); });
      grid.appendChild(cell);
    }
    var selItems = eventsOn(CAL.evs, sel);
    var lbl = document.createElement("li"); lbl.className = "daylabel";
    lbl.textContent = (sameDay(sel, now) ? "Today, " : "") + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][sel.getDay()] + " " + sel.getDate() + " " + MONTHS_SHORT[sel.getMonth()];
    renderDayList(list, selItems, sel, sameDay(sel, now));
    list.insertBefore(lbl, list.firstChild);
  }
  function calSetView(v) { CAL.view = v; if (v === "month") { CAL.month = null; CAL.selected = null; } renderCal(); }
  function calShift(n) { var m = CAL.month || new Date(); CAL.month = new Date(m.getFullYear(), m.getMonth() + n, 1); CAL.selected = null; renderCal(); }
  function refreshCal(force) {
    if (calTimer) { clearTimeout(calTimer); calTimer = 0; }
    if (!state.calUrl) { $("today").hidden = true; return; }
    var now = Date.now();
    var go = function () {
      fetch(state.calUrl, { referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .then(function (t) {
          if (!/BEGIN:VCALENDAR/i.test(t)) throw new Error("not an .ics feed");
          var evs = parseIcs(t); calStatus(""); renderCal(evs);
          try { chrome.storage.local.set({ calcache: { at: now, url: state.calUrl, text: t } }); } catch (e) {}
        }).catch(function (err) {
          // Say why. A TypeError from fetch is the browser refusing the
          // request: no host permission granted, CORS, or offline.
          var why = (err && err.message) || "failed";
          if (/failed to fetch|networkerror|load failed/i.test(why)) why = "blocked (permission for the feed's site not granted, or offline)";
          calStatus("Feed: " + why);
          if (!CAL.evs.length) renderCal([]);
        });
    };
    try {
      chrome.storage.local.get("calcache", function (r) {
        var c = r && r.calcache;
        if (c && c.url === state.calUrl && c.text) renderCal(parseIcs(c.text));   // instant paint from cache
        if (force || !c || c.url !== state.calUrl || now - c.at > 10 * 60 * 1000) go();
      });
    } catch (e) { go(); }
    calTimer = setTimeout(function () { refreshCal(true); }, 10 * 60 * 1000);
  }

  // ---- settings
  function openSettings() {
    $("engine").value = state.engine;
    $("clockfmt").value = state.clockfmt;
    $("drift").checked = !!state.drift;
    $("online-art").checked = !!state.onlineArt;
    $("src-marks").checked = !!state.srcMarks;
    $("links-edit").value = state.links.map(function (l) { return l.name + " | " + l.url; }).join("\n");
    $("wx-place").value = state.wx ? state.wx.name : ""; $("wx-units").value = state.wxUnits; $("wx-status").textContent = "";
    $("frames-edit").value = (state.frames || []).map(function (f) { return f.name + " | " + f.url + " | " + f.token; }).join("\n"); $("frames-status").textContent = "";
    $("cal-url").value = state.calUrl || ""; $("cal-status").textContent = "";
    $("music-url").value = state.musicUrl || ""; $("music-status").textContent = "";
    pendingWx = undefined;
    $("settings").hidden = false;
    $("engine").focus();
  }
  function closeSettings() { $("settings").hidden = true; $("q").focus(); }
  var wxPermChecked = false;
  function saveSettings() {
    state.engine = $("engine").value;
    state.clockfmt = $("clockfmt").value;
    state.drift = $("drift").checked;
    var wasOnline = !!state.onlineArt;
    state.onlineArt = $("online-art").checked;
    if (wasOnline !== state.onlineArt) { ART = []; artHost = ""; current = -1; initArt(); }
    state.srcMarks = $("src-marks").checked;
    state.links = $("links-edit").value.split("\n").map(function (line) {
      var p = line.split("|"); if (p.length < 2) return null;
      var url = p.slice(1).join("|").trim(); if (!/^https?:\/\//i.test(url)) return null;
      return { name: p[0].trim() || url, url: url };
    }).filter(Boolean);
    state.wxUnits = $("wx-units").value;
    var newFrames = parseFrames($("frames-edit").value);
    var newCal = $("cal-url").value.trim().replace(/^webcal:\/\//i, "https://");
    if (newCal && !/^https?:\/\//i.test(newCal)) { $("cal-status").textContent = "The feed must be an https:// (or webcal://) link"; return; }
    var newMusic = $("music-url").value.trim();
    if (newMusic && !musicEmbedSrc(newMusic)) { $("music-status").textContent = "Not an Apple Music link (music.apple.com)"; return; }
    state.musicUrl = newMusic;
    var place = $("wx-place").value.trim();
    if (place && !wxPermChecked) {
      // must start from the click itself (user gesture) - re-enter once granted
      wxPermChecked = true;
      return ensureWxPermission(function (ok) {
        if (!ok) { wxPermChecked = false; $("wx-status").textContent = "Permission to reach Open-Meteo was not granted"; return; }
        saveSettings(); wxPermChecked = false;
      });
    }
    wxPermChecked = false;
    var finish0 = function () { save(); applyAll(); closeSettings(); };
    var finish = function () {
      var changed = JSON.stringify(newFrames) !== JSON.stringify(state.frames || []);
      if (!changed) return finish0();
      // permission request must run from the click - it does, this is the Save handler
      ensureFramePermissions(newFrames, function (ok) {
        if (!ok && newFrames.length) { $("frames-status").textContent = "Permission to reach the frame was not granted"; return; }
        state.frames = newFrames; frameState = {}; finish0();
      });
    };
    // calendar feed origin needs the same per-origin grant (before finish)
    if (newCal !== (state.calUrl || "")) {
      var finishPrev = finish;
      finish = function () {
        var origin = null; try { origin = new URL(newCal).origin; } catch (e) {}
        var apply = function () { state.calUrl = newCal; finishPrev(); };
        if (!newCal || !origin || !chrome.permissions) return apply();
        try { chrome.permissions.request({ origins: [origin + "/*"] }, function (g) { if (g) apply(); else $("cal-status").textContent = "Permission to reach the feed was not granted"; }); } catch (e) { apply(); }
      };
    }
    if (!place) { state.wx = null; finish(); }
    else if (pendingWx && pendingWx.name === place) { state.wx = pendingWx; finish(); }
    else if (state.wx && state.wx.name === place) finish();
    else {
      $("wx-status").textContent = "Looking up \u201C" + place + "\u201D\u2026";
      geocode(place, function (loc) {
        if (!loc) { $("wx-status").textContent = "Place not found"; return; }
        state.wx = loc; finish();
      });
    }
  }
  function applyAll() {
    applyEngine(); renderLinks(); tick(); renderMusic();
    $("art").classList.toggle("drift", !!state.drift);
    refreshWx(false);
    pollFrames();
    $("cal-view-today").addEventListener("click", function () { calSetView("today"); });
    $("cal-view-month").addEventListener("click", function () { calSetView("month"); });
    $("cal-prev").addEventListener("click", function () { calShift(-1); });
    $("cal-next").addEventListener("click", function () { calShift(1); });
    refreshCal(false);
  }

  load(function () {
    applyAll();
    initArt();
    setInterval(tick, 1000);
    $("settings-btn").addEventListener("click", openSettings);
    $("settings-close").addEventListener("click", closeSettings);
    $("settings-save").addEventListener("click", saveSettings);
    $("wx-locate").addEventListener("click", locateMe);
    $("settings").addEventListener("click", function (e) { if (e.target === $("settings")) closeSettings(); });
    addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("settings").hidden) closeSettings(); });
    $("q").focus();
  });
})();
