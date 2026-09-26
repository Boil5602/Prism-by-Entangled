// EME capability matrix for AUDIO-ONLY DRM (docs/reports/music-webview2-poc.md).
// Shared by the WebView2 harness (ExecuteScriptAsync) and probe.html (Edge).
// Pure observation: requestMediaKeySystemAccess + createMediaKeys only; no
// license requests, no media elements touched.
(function () {
  const KEY_SYSTEMS = [
    'com.widevine.alpha',
    'com.microsoft.playready',
    'com.microsoft.playready.recommendation',
  ];
  const WV_ROBUSTNESS = ['', 'SW_SECURE_CRYPTO', 'SW_SECURE_DECODE', 'HW_SECURE_CRYPTO', 'HW_SECURE_DECODE', 'HW_SECURE_ALL'];
  const PR_ROBUSTNESS = ['', '150', '2000', '3000'];
  const AUDIO_TYPES = [
    'audio/mp4; codecs="mp4a.40.2"',
    'audio/webm; codecs="opus"',
    'audio/mp4; codecs="ec-3"',
    'audio/mp4; codecs="flac"',
  ];

  function errInfo(e) {
    if (!e) return { name: 'unknown', message: '' };
    return { name: e.name || String(e), message: e.message || '' };
  }

  async function tryConfig(ks, cfg, label) {
    const row = { keySystem: ks, label, ok: false };
    try {
      const access = await navigator.requestMediaKeySystemAccess(ks, [cfg]);
      const got = access.getConfiguration();
      row.ok = true;
      row.granted = {
        audio: (got.audioCapabilities || []).map(c => ({ contentType: c.contentType, robustness: c.robustness, encryptionScheme: c.encryptionScheme ?? null })),
        video: (got.videoCapabilities || []).map(c => ({ contentType: c.contentType, robustness: c.robustness })),
        persistentState: got.persistentState,
        distinctiveIdentifier: got.distinctiveIdentifier,
        sessionTypes: got.sessionTypes,
        initDataTypes: got.initDataTypes,
      };
      try {
        const keys = await access.createMediaKeys();
        row.createMediaKeys = 'ok';
        try {
          // HDCP is irrelevant for audio, but the CDM's answer is cheap evidence.
          row.hdcpStatus = await keys.getStatusForPolicy({ minHdcpVersion: '' });
        } catch (e) { row.hdcpStatus = 'getStatusForPolicy: ' + errInfo(e).name + ': ' + errInfo(e).message; }
      } catch (e) {
        row.createMediaKeys = errInfo(e);
      }
    } catch (e) {
      row.error = errInfo(e);
    }
    return row;
  }

  async function decodingInfo(ks, contentType, robustness) {
    if (!navigator.mediaCapabilities || !navigator.mediaCapabilities.decodingInfo) return { unsupported: 'no mediaCapabilities' };
    try {
      const info = await navigator.mediaCapabilities.decodingInfo({
        type: 'media-source',
        audio: { contentType, channels: '2', bitrate: 128000, samplerate: 44100 },
        keySystemConfiguration: {
          keySystem: ks,
          initDataType: 'cenc',
          audio: { robustness, encryptionScheme: 'cenc' },
        },
      });
      return { supported: info.supported, smooth: info.smooth, powerEfficient: info.powerEfficient,
               robustness: info.keySystemAccess ? (info.keySystemAccess.getConfiguration().audioCapabilities || []).map(c => c.robustness) : null };
    } catch (e) { return { error: errInfo(e) }; }
  }

  async function runEmeProbe() {
    const out = {
      userAgent: navigator.userAgent,
      origin: location.origin,
      at: new Date().toISOString(),
      rows: [],
      decoding: [],
    };
    for (const ks of KEY_SYSTEMS) {
      const robustnessList = ks.startsWith('com.widevine') ? WV_ROBUSTNESS : PR_ROBUSTNESS;
      for (const ct of AUDIO_TYPES) {
        for (const r of robustnessList) {
          out.rows.push(await tryConfig(ks, {
            initDataTypes: ['cenc'],
            audioCapabilities: [{ contentType: ct, robustness: r }],
          }, `audio-only ${ct} robustness=${JSON.stringify(r)}`));
        }
      }
      // persistentState / distinctiveIdentifier variants (audio/mp4 aac, robustness "")
      const aac = 'audio/mp4; codecs="mp4a.40.2"';
      for (const ps of ['optional', 'required', 'not-allowed']) {
        for (const di of ['optional', 'required', 'not-allowed']) {
          if (ps === 'optional' && di === 'optional') continue; // the default, covered above
          out.rows.push(await tryConfig(ks, {
            initDataTypes: ['cenc'],
            audioCapabilities: [{ contentType: aac, robustness: '' }],
            persistentState: ps, distinctiveIdentifier: di,
          }, `audio-only aac persistentState=${ps} distinctiveIdentifier=${di}`));
        }
      }
      // persistent-license session type (offline)
      out.rows.push(await tryConfig(ks, {
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType: aac, robustness: '' }],
        persistentState: 'required', sessionTypes: ['persistent-license'],
      }, 'audio-only aac sessionTypes=[persistent-license]'));
      // reference: audio+video (the host's existing probe shape)
      const vr = ks.startsWith('com.widevine') ? ['SW_SECURE_DECODE', 'HW_SECURE_ALL'] : ['2000', '3000'];
      for (const r of vr) {
        out.rows.push(await tryConfig(ks, {
          initDataTypes: ['cenc'],
          videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640028"', robustness: r }],
          audioCapabilities: [{ contentType: aac, robustness: '' }],
        }, `reference audio+video video-robustness=${JSON.stringify(r)}`));
      }
      // mediaCapabilities.decodingInfo, audio-only
      for (const r of (ks.startsWith('com.widevine') ? ['', 'SW_SECURE_CRYPTO', 'SW_SECURE_DECODE'] : ['', '2000', '3000'])) {
        out.decoding.push({ keySystem: ks, contentType: aac, robustness: r, result: await decodingInfo(ks, aac, r) });
      }
    }
    return out;
  }

  window.__prismRunEmeProbe = runEmeProbe;
})();
