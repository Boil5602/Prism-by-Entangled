#!/bin/bash
# The first evening with sound (addendum D/E3, 2026-11-08): at 23:05 the screen window's 19:00 to 23:00 is labelled by the doctor's
# labeller (the first of the two labelled evenings the addendum allows without asking), merged into the day's labels.json, listed as an
# exam set (exams-sound.json), read by the sidecar evaluation (silences and palette jumps against the labelled edges) and by the
# harvester over the whole day's hours of sound. Detached (Start-Process), done before the sampler's 01:00 run.
cd /c/Projects/prism
export PROMOS=show PYTHONUTF8=1
D="$(cygpath -m "$LOCALAPPDATA")/Prism/diagnostics"; G="$D/golden"; DAY=2026-11-08; W=screen
R=scripts/doctor/out/redesign-20261107; mkdir -p "$R/phaseD" "$R/phaseE3"
LOG="$R/night-$DAY.log"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python.exe"
say "waiting for 23:05"
while [ "$(date +%H%M)" -lt 2305 ]; do sleep 60; done
for h in 19 20 21 22; do
  say "labelling $W $h:00"
  node scripts/doctor/label.mjs "$DAY" "$W" --from=$h:00:00 --to=$((h + 1)):00:00 > "scripts/doctor/out/label-$DAY-$W-${h}0000.log" 2>&1
  tail -1 "scripts/doctor/out/label-$DAY-$W-${h}0000.log" | cut -c1-200 | tee -a "$LOG"
done
say "merging the labels into $DAY"
python -I scripts/doctor/merge-labels.py "$DAY" 2>&1 | tail -2 | tee -a "$LOG"
say "the exam set"
python -I - "$G/$DAY/$W" "$G/$DAY/library" <<'EOF' 2>&1 | tee -a "$LOG"
import io, json, os, sys
frames = sorted(f[:-5] for f in os.listdir(sys.argv[1]) if f.endswith(".gray"))
inr = [f for f in frames if "190000000" <= f <= "230000000"]
libs = sorted(l for l in os.listdir(sys.argv[2]) if l < "190000")
ex = [dict(name="Evening with sound (screen)", day="2026-11-08", window="screen", **{"from": "19:00:00", "to": "23:00:00"}, frames=[inr[0], inr[-1]], library=libs[-1], lead=18)]
io.open("scripts/breakwatch/exams-sound.json", "w", encoding="utf-8").write(json.dumps(ex, indent=1))
print("exams-sound.json:", ex[0]["frames"], "library", ex[0]["library"], len(inr), "frames")
EOF
say "the sidecars against the labels"
python -I scripts/breakwatch/sidecar-eval.py "$DAY" "$W" 19:00:00 23:00:00 "$R/phaseD/sidecar-eval-$DAY.json" 2>&1 | tail -1 | cut -c1-400 | tee -a "$LOG"
say "the harvest over the day's sound"
HARVEST_DAY=$DAY "$PY" -I scripts/breakwatch/fingerprint.py harvest "$R/phaseE3/harvest-$DAY.json" "$G/$DAY/audio" "$D/bench/_audio" 2>&1 | tail -1 | cut -c1-400 | tee -a "$LOG"
say "night $DAY done"
