#!/usr/bin/env bash
# One spike run: compositor -> browser (remote debugging) -> overlay -> harness.
#   run.sh shaka|bitmovin|netflix|clear1080 [--wsl] [--seconds N] [--no-overlay]
#   run.sh signin        # opens a browser for a one-time Netflix sign-in into the spike profile
# Artifacts: out/<timestamp>/
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
scenario="${1:-shaka}"; shift || true
WSL=0; SECONDS_RUN=60; OVERLAY=1
while [ $# -gt 0 ]; do case "$1" in --wsl) WSL=1;; --seconds) SECONDS_RUN="$2"; shift;; --no-overlay) OVERLAY=0;; esac; shift; done

ts=$(date +%Y%m%d-%H%M%S); out="$here/out/$ts"; mkdir -p "$out"
profile="$here/out/profile"; mkdir -p "$profile"
port=9222
if command -v google-chrome >/dev/null 2>&1; then browser=google-chrome; elif command -v chromium >/dev/null 2>&1; then browser=chromium; else browser=chromium-browser; fi
art="$here/../../../prototypes/prism-veil-extension/art/commons_forest_1.jpg"

# Browser flags: Wayland (ozone), remote debugging on a port (Debian/Pi Chromium
# still honors it; if /json never answers, fall back to --remote-debugging-pipe
# and the daemon's cdp-pipe.ts), no first-run, GPU on.
flags=(--ozone-platform=wayland --remote-debugging-port=$port --user-data-dir="$profile" --no-first-run --no-default-browser-check
       --autoplay-policy=no-user-gesture-required --enable-features=VaapiVideoDecodeLinuxGL,UseOzonePlatform --window-size=1920,1080 --start-maximized)
if [ "$scenario" = "signin" ]; then
  exec "$browser" "${flags[@]}" "https://www.netflix.com/login"
fi

# 1. compositor: on the Pi we are already inside labwc; under WSLg run cage nested.
if [ "$WSL" = 1 ]; then
  export WLR_BACKENDS=wayland
  cage -- "$browser" "${flags[@]}" about:blank > "$out/chromium.log" 2>&1 &
  comp=$!; sleep 6
  # the nested compositor exposes its own socket for the overlay client
  export WAYLAND_DISPLAY=$(ls -t "$XDG_RUNTIME_DIR" | grep -m1 -E '^wayland-[0-9]+$')
else
  "$browser" "${flags[@]}" about:blank > "$out/chromium.log" 2>&1 &
  comp=$!; sleep 5
fi
echo "compositor/browser pid $comp, WAYLAND_DISPLAY=$WAYLAND_DISPLAY" | tee "$out/run.log"

# 2. wait for DevTools
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$port/json/version" > "$out/devtools.json" 2>/dev/null && break; sleep 1; done
cat "$out/devtools.json" 2>/dev/null | head -c 300 | tee -a "$out/run.log"; echo

# 3. overlay over the lower-right quarter of a 1080p screen
if [ "$OVERLAY" = 1 ]; then
  python3 "$here/overlay.py" 960 540 960 540 "$art" 0.5 > "$out/overlay.log" 2>&1 &
  ov=$!; sleep 2; cat "$out/overlay.log" | tee -a "$out/run.log"
fi

# 4. load sampling + harness
bash "$here/measure.sh" "$out/load.csv" & meas=$!
python3 "$here/cdp.py" --port $port --scenario "$scenario" --out "$out" --seconds "$SECONDS_RUN" --capture-every 10 2>&1 | tee -a "$out/run.log"

# 5. compositor-level screenshots: what a human sees (overlay included)
if command -v grim >/dev/null 2>&1; then grim "$out/screen-final.png" 2>>"$out/run.log" || true; fi

kill $meas 2>/dev/null; [ "${ov:-}" ] && kill $ov 2>/dev/null
echo "artifacts: $out" | tee -a "$out/run.log"
python3 - "$out/playback.jsonl" <<'EOF'
import json, sys
rows=[json.loads(l) for l in open(sys.argv[1])]
q=[r for r in rows if r.get("kind")=="quality" and r.get("video")]
caps=[r for r in rows if r.get("kind")=="capture"]
if q:
    d=[(r.get("dropped") or 0) for r in q]; t=[(r.get("total") or 0) for r in q]
    print(f"frames: total={t[-1]} dropped={d[-1]} ({(100*d[-1]/t[-1]) if t[-1] else 0:.2f}%) size={q[-1].get('w')}x{q[-1].get('h')} mediaKeys={q[-1].get('mediaKeys')} error={q[-1].get('error')}")
    adv=[round(b.get('t',0)-a.get('t',0),2) for a,b in zip(q,q[1:])]
    print(f"currentTime advance per sample (s): min={min(adv) if adv else None} max={max(adv) if adv else None}")
for c in caps:
    print(f"capture {c['file']}: {c['ms']} ms, {c['bytes']} bytes, t {c['t_before']}->{c['t_after']}, dropped {c['dropped_before']}->{c['dropped_after']}, error={c['error']}")
eme=[r for r in rows if r.get("kind")=="eme"]
if eme: print("eme:", json.dumps({k:v for k,v in eme[-1].items() if k not in ('ts','kind')}))
EOF
