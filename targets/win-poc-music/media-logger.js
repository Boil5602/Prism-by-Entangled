// Page-side observer for the Widevine-audio POC (docs/reports/music-webview2-poc.md).
// Injected on every document (AddScriptToExecuteOnDocumentCreatedAsync).
// OBSERVE ONLY (dashboard-schema §26 doctrine): wraps EME entry points to log
// what the site asks for and what the CDM answers, listens to media element
// events, and samples navigator.mediaSession. Never calls play/pause, never
// touches player state, never alters arguments or results.
(function () {
  if (window.__prismMediaLogger) return;
  window.__prismMediaLogger = true;
  const isTop = window === window.top;
  const frameTag = isTop ? 'top' : ('frame:' + (location.host || 'about'));

  function post(kind, data) {
    const msg = { type: 'poc', kind, frame: frameTag, at: Date.now(), data };
    try {
      if (window.chrome && window.chrome.webview) { window.chrome.webview.postMessage(JSON.stringify(msg)); return; }
    } catch (e) {}
    try { console.info('[prism-poc] ' + JSON.stringify(msg)); } catch (e) {}
  }
  function errInfo(e) { return e ? { name: e.name || String(e), message: e.message || '' } : { name: 'unknown', message: '' }; }
  function summarizeConfig(cfgs) {
    return (cfgs || []).map(c => ({
      initDataTypes: c.initDataTypes,
      audio: (c.audioCapabilities || []).map(a => ({ contentType: a.contentType, robustness: a.robustness, encryptionScheme: a.encryptionScheme })),
      video: (c.videoCapabilities || []).map(v => ({ contentType: v.contentType, robustness: v.robustness, encryptionScheme: v.encryptionScheme })),
      persistentState: c.persistentState, distinctiveIdentifier: c.distinctiveIdentifier, sessionTypes: c.sessionTypes,
    }));
  }

  // --- EME entry points --------------------------------------------------
  const origRMKSA = navigator.requestMediaKeySystemAccess && navigator.requestMediaKeySystemAccess.bind(navigator);
  if (origRMKSA) {
    navigator.requestMediaKeySystemAccess = function (ks, cfgs) {
      const t0 = performance.now();
      const p = origRMKSA(ks, cfgs);
      p.then(a => {
        let granted = null; try { granted = summarizeConfig([a.getConfiguration()])[0]; } catch (e) {}
        post('rmksa', { keySystem: ks, asked: summarizeConfig(cfgs), ok: true, granted, ms: Math.round(performance.now() - t0) });
      }, e => post('rmksa', { keySystem: ks, asked: summarizeConfig(cfgs), ok: false, error: errInfo(e), ms: Math.round(performance.now() - t0) }));
      return p;
    };
  }
  if (window.MediaKeySystemAccess && MediaKeySystemAccess.prototype.createMediaKeys) {
    const orig = MediaKeySystemAccess.prototype.createMediaKeys;
    MediaKeySystemAccess.prototype.createMediaKeys = function () {
      const ks = this.keySystem;
      const p = orig.apply(this, arguments);
      p.then(() => post('createMediaKeys', { keySystem: ks, ok: true }), e => post('createMediaKeys', { keySystem: ks, ok: false, error: errInfo(e) }));
      return p;
    };
  }
  if (window.MediaKeys && MediaKeys.prototype.createSession) {
    const orig = MediaKeys.prototype.createSession;
    MediaKeys.prototype.createSession = function (type) {
      const s = orig.apply(this, arguments);
      post('createSession', { sessionType: type || 'temporary' });
      try {
        s.addEventListener('message', ev => post('session.message', { messageType: ev.messageType, bytes: ev.message ? ev.message.byteLength : 0 }));
        s.addEventListener('keystatuseschange', () => {
          const st = []; try { s.keyStatuses.forEach((v) => st.push(v)); } catch (e) {}
          post('session.keystatuseschange', { statuses: st });
        });
        s.closed.then(r => post('session.closed', { reason: r }), () => {});
      } catch (e) {}
      return s;
    };
  }
  if (window.MediaKeySession && MediaKeySession.prototype.generateRequest) {
    const orig = MediaKeySession.prototype.generateRequest;
    MediaKeySession.prototype.generateRequest = function (initDataType, initData) {
      const p = orig.apply(this, arguments);
      p.then(() => post('generateRequest', { initDataType, ok: true, bytes: initData ? initData.byteLength : 0 }),
             e => post('generateRequest', { initDataType, ok: false, error: errInfo(e) }));
      return p;
    };
    const origUpdate = MediaKeySession.prototype.update;
    MediaKeySession.prototype.update = function (resp) {
      const p = origUpdate.apply(this, arguments);
      p.then(() => post('session.update', { ok: true, bytes: resp ? resp.byteLength : 0 }), e => post('session.update', { ok: false, error: errInfo(e) }));
      return p;
    };
  }
  if (window.HTMLMediaElement && HTMLMediaElement.prototype.setMediaKeys) {
    const orig = HTMLMediaElement.prototype.setMediaKeys;
    HTMLMediaElement.prototype.setMediaKeys = function (keys) {
      const p = orig.apply(this, arguments);
      p.then(() => post('setMediaKeys', { ok: true, tag: this.tagName, hasKeys: !!keys }), e => post('setMediaKeys', { ok: false, error: errInfo(e) }));
      return p;
    };
  }

  // --- media elements ----------------------------------------------------
  const seen = new WeakSet();
  let elId = 0;
  function watch(el) {
    if (seen.has(el)) return; seen.add(el);
    const id = ++elId;
    const info = () => ({ id, tag: el.tagName, src: (el.currentSrc || el.src || '').slice(0, 120), duration: el.duration, currentTime: el.currentTime,
                          paused: el.paused, muted: el.muted, volume: el.volume, readyState: el.readyState, networkState: el.networkState,
                          mse: !!(el.currentSrc || '').startsWith('blob:'), hasMediaKeys: !!el.mediaKeys });
    post('media.found', info());
    for (const ev of ['loadedmetadata', 'play', 'playing', 'pause', 'ended', 'stalled', 'waiting', 'waitingforkey', 'encrypted', 'error', 'abort', 'emptied', 'volumechange']) {
      el.addEventListener(ev, (e) => {
        const d = info();
        if (ev === 'encrypted') { d.initDataType = e.initDataType; d.initDataBytes = e.initData ? e.initData.byteLength : 0; }
        if (ev === 'error' && el.error) { d.error = { code: el.error.code, message: el.error.message }; }
        post('media.' + ev, d);
      }, true);
    }
    // a timeupdate heartbeat every ~5 s while playing proves audio is actually advancing
    let last = 0;
    el.addEventListener('timeupdate', () => { const n = Date.now(); if (n - last > 5000) { last = n; post('media.timeupdate', info()); } }, true);
  }
  function scan(root) {
    try { root.querySelectorAll && root.querySelectorAll('audio,video').forEach(watch); } catch (e) {}
  }
  const origCreate = document.createElement.bind(document);
  document.createElement = function (name, opts) {
    const el = origCreate(name, opts);
    if (typeof name === 'string' && /^(audio|video)$/i.test(name)) queueMicrotask(() => watch(el));
    return el;
  };
  new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (/^(AUDIO|VIDEO)$/.test(n.tagName)) watch(n); else scan(n); } })
    .observe(document.documentElement || document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => scan(document));
  if (window.Audio) {
    const OrigAudio = window.Audio;
    window.Audio = function (src) { const a = src === undefined ? new OrigAudio() : new OrigAudio(src); watch(a); return a; };
    window.Audio.prototype = OrigAudio.prototype;
  }

  // --- Media Session (§32 Layer 2) ---------------------------------------
  if (isTop && navigator.mediaSession) {
    const ms = navigator.mediaSession;
    if (ms.setActionHandler) {
      const orig = ms.setActionHandler.bind(ms);
      ms.setActionHandler = function (action, handler) { post('mediaSession.setActionHandler', { action, registered: !!handler }); return orig(action, handler); };
    }
    let lastSig = '';
    setInterval(() => {
      try {
        const m = ms.metadata;
        const snap = { playbackState: ms.playbackState,
                       metadata: m ? { title: m.title, artist: m.artist, album: m.album, artwork: (m.artwork || []).map(a => ({ src: (a.src || '').slice(0, 100), sizes: a.sizes, type: a.type })) } : null };
        const sig = JSON.stringify(snap);
        if (sig !== lastSig) { lastSig = sig; post('mediaSession.state', snap); }
      } catch (e) {}
    }, 1000);
  }

  post('logger.ready', { url: location.href.slice(0, 200) });
})();
