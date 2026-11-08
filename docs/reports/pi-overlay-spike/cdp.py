#!/usr/bin/env python3
"""
DevTools harness for the spike. Connects to the browser's remote-debugging
port, opens the scenario page, starts playback, and every second records
video.getVideoPlaybackQuality() (dropped/total frames), currentTime, paused,
readyState and the EME key-status snapshot the page exposes. Every N seconds
it also calls Page.captureScreenshot and saves the PNG - the question is not
whether the video region is black in the capture (expected for DRM) but
whether the CALL disturbs playback (currentTime keeps advancing, no drop
spike, no error).

Usage: cdp.py --port 9222 --scenario shaka|netflix|clear1080 --out DIR --seconds 60 --capture-every 10
"""
import argparse, base64, json, os, sys, time, urllib.request
import websocket  # python3-websocket

SCENARIOS = {
    # Shaka demo with a Widevine-encrypted asset (Google's public test content).
    "shaka": "https://shaka-player-demo.appspot.com/demo/#audiolang=en-US;textlang=en-US;uilang=en-US;asset=https://storage.googleapis.com/shaka-demo-assets/angel-one-widevine/dash.mpd;panel=ALL_CONTENT;build=uncompiled",
    "bitmovin": "https://bitmovin.com/demos/drm",
    "netflix": "https://www.netflix.com/browse",
    "clear1080": "https://shaka-player-demo.appspot.com/demo/#audiolang=en-US;textlang=en-US;uilang=en-US;asset=https://storage.googleapis.com/shaka-demo-assets/bbb-dark-truths-hls/hls.m3u8;panel=ALL_CONTENT;build=uncompiled",
}

PROBE_JS = r"""
(() => {
  const v = document.querySelector('video');
  if (!v) return { video: false };
  const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {};
  return {
    video: true, t: v.currentTime, paused: v.paused, readyState: v.readyState, ended: v.ended,
    w: v.videoWidth, h: v.videoHeight,
    dropped: q.droppedVideoFrames, total: q.totalVideoFrames, corrupted: q.corruptedVideoFrames,
    mediaKeys: !!v.mediaKeys,
    error: v.error ? { code: v.error.code, message: v.error.message } : null,
    src: (v.currentSrc || '').slice(0, 80),
  };
})()
"""

EME_JS = r"""
(async () => {
  const out = { rmksa: null, robustness: {} };
  const cfg = (r) => [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"', robustness: r }] }];
  for (const r of ['', 'SW_SECURE_CRYPTO', 'SW_SECURE_DECODE', 'HW_SECURE_CRYPTO', 'HW_SECURE_DECODE', 'HW_SECURE_ALL']) {
    try { const a = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', cfg(r)); out.robustness[r || '(unspecified)'] = 'ok:' + a.getConfiguration().videoCapabilities[0].robustness; }
    catch (e) { out.robustness[r || '(unspecified)'] = 'refused: ' + e.name; }
  }
  try {
    const a = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', cfg(''));
    const mk = await a.createMediaKeys();
    out.hdcp = {};
    for (const lvl of ['', '1.0', '1.4', '2.2']) { try { out.hdcp[lvl || '(none)'] = await mk.getStatusForPolicy({ minHdcpVersion: lvl }); } catch (e) { out.hdcp[lvl || '(none)'] = 'err:' + e.name; } }
  } catch (e) { out.hdcp = 'createMediaKeys failed: ' + e.name; }
  return out;
})()
"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--scenario", default="shaka")
    ap.add_argument("--url", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seconds", type=int, default=60)
    ap.add_argument("--capture-every", type=int, default=10)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    url = a.url or SCENARIOS[a.scenario]

    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{a.port}/json"))
    page = next((t for t in targets if t.get("type") == "page"), None)
    if not page:
        page = json.load(urllib.request.urlopen(f"http://127.0.0.1:{a.port}/json/new?about:blank", data=b""))
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], suppress_origin=True)
    seq = 0
    def call(method, params=None):
        nonlocal seq
        seq += 1
        ws.send(json.dumps({"id": seq, "method": method, "params": params or {}}))
        while True:
            m = json.loads(ws.recv())
            if m.get("id") == seq:
                return m.get("result", m)
    def evaluate(js, await_promise=False):
        r = call("Runtime.evaluate", {"expression": js, "returnByValue": True, "awaitPromise": await_promise})
        return (r.get("result") or {}).get("value")

    call("Page.enable"); call("Runtime.enable")
    call("Page.navigate", {"url": url})
    time.sleep(8)
    log = open(os.path.join(a.out, "playback.jsonl"), "a")
    def rec(kind, data):
        line = json.dumps({"ts": round(time.time(), 3), "kind": kind, **(data if isinstance(data, dict) else {"data": data})})
        log.write(line + "\n"); log.flush(); print(line, flush=True)

    rec("eme", evaluate(EME_JS, await_promise=True) or {})
    if a.scenario in ("shaka", "clear1080"):
        # the demo needs a click on its play control; a synthetic click here is
        # part of the harness, not the product (spec section 26 is about ads)
        evaluate("(()=>{const v=document.querySelector('video'); if(v){v.muted=true; return v.play() && 'play() called';} return 'no video yet';})()")
        time.sleep(3)
    t0 = time.time(); n = 0; last_cap = t0
    while time.time() - t0 < a.seconds:
        n += 1
        rec("quality", evaluate(PROBE_JS) or {})
        if time.time() - last_cap >= a.capture_every:
            last_cap = time.time()
            before = evaluate(PROBE_JS) or {}
            t1 = time.time()
            shot = call("Page.captureScreenshot", {"format": "png"})
            dt = time.time() - t1
            after = evaluate(PROBE_JS) or {}
            path = os.path.join(a.out, f"capture-{n:03d}.png")
            if "data" in shot:
                with open(path, "wb") as f: f.write(base64.b64decode(shot["data"]))
            rec("capture", {"file": os.path.basename(path), "ms": round(dt * 1000), "bytes": len(shot.get("data", "")) * 3 // 4,
                            "t_before": before.get("t"), "t_after": after.get("t"), "dropped_before": before.get("dropped"), "dropped_after": after.get("dropped"),
                            "error": shot.get("error")})
        time.sleep(1)
    rec("done", {"seconds": a.seconds})

if __name__ == "__main__":
    main()
