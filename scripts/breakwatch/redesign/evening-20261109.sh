#!/bin/bash
# The evening of 2026-11-09, at the owner's go. Detached (Start-Process); one heavy job at a time.
#   17:00  the idle sampler again (its 06:30 run was stopped at about 08:51, with the scorer); it waits for 60 idle minutes itself.
#   17:00  the held-out scorer resumes past the channels train-heldout-rep2.txt scored (window 1), stopped at 19:00 so the
#          evening's recording runs with no study job beside it.
#   23:05  the screen window's 19:00 to 23:00 is labelled (the second labelled evening with sound), hour by hour, only the hours
#          with half an hour of frames or more; merged; listed as exams-sound2.json; the sidecar evaluation; the day's harvest.
#   after  the scorer resumes again (window 2), stopped at 00:50 before the sampler's 01:00 run.
cd /c/Projects/prism
export PROMOS=show PYTHONUTF8=1
D="$(cygpath -m "$LOCALAPPDATA")/Prism/diagnostics"; G="$D/golden"; DAY=2026-11-09; W=screen
L=scripts/doctor/out/lowchannels-20261107; R=scripts/doctor/out/redesign-20261107; E="$R/phaseE1"
mkdir -p "$R/phaseD" "$R/phaseE3"
LOG="$R/evening-$DAY.log"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python.exe"
hm() { date +%H%M; }
until_at() { while [ "$(hm)" -lt "$1" ]; do sleep 60; done; }
# past HHMM: an evening stop (12:00 or later) is past from that minute on; an after-midnight stop only from that minute to noon
past() { local h; h=$(hm); if [ "$1" -ge 1200 ]; then [ "$h" -ge "$1" ]; else [ "$h" -ge "$1" ] && [ "$h" -lt 1200 ]; fi; }
DAYS6=(--day "$E/feat2/feat_2026-10-07.csv" "$G/2026-10-07" --day "$E/feat2/feat_2026-10-08.csv" "$G/2026-10-08" --day "$E/feat2/feat_2026-11-04.csv" "$G/2026-11-04"
       --day "$E/feat2/feat_2026-11-05.csv" "$G/2026-11-05" --day "$E/feat2/feat_2026-11-06.csv" "$G/2026-11-06" --day "$E/feat2/feat_2026-11-07.csv" "$G/2026-11-07")
scorer_running() { powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | ? { \$_.CommandLine -like '*train2.py*' }).Count" | tr -d '\r'; }
scorer_stop() { powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | ? { \$_.CommandLine -like '*train2.py*' } | % { Stop-Process -Id \$_.ProcessId -Force -Confirm:\$false }"; }
# one scorer window: resume past every earlier run's file, write $1, stop at $2 (HHMM) or when it ends
window() { local out=$1 stop=$2; shift 2
  while tasklist //FI "IMAGENAME eq bwtest.exe" 2>/dev/null | grep -qi bwtest; do sleep 60; done
  if [ "$(scorer_running)" != "0" ]; then say "a scorer is already running; window skipped"; return; fi
  say "scorer window to $stop -> $out"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\Projects\prism\scripts\doctor\out\redesign-20261107\memory-guard.ps1' -WindowStyle Hidden"
  env CLOCK=1 python scripts/breakwatch/train2.py "${DAYS6[@]}" --only "$L/trained+low.json" --inset-ads "NFL Network" --skip-done "$@" > "$out" 2>&1 &
  sleep 120
  while [ "$(scorer_running)" != "0" ]; do
    if past "$stop"; then scorer_stop; say "stopped at $stop"; break; fi
    sleep 60
  done
  wait 2>/dev/null
  say "$(grep -c 'rules ads' "$out") channels in $out; $(grep -m1 skipping "$out")"
}

say "waiting for 17:00"
until_at 1700
say "idle sampler: $(schtasks //run //tn 'Prism break-watch idle sampler' 2>&1 | tr -d '\r' | head -1)"
window "$E/train-heldout-rep3.txt" 1900 "$E/train-heldout-rep2.txt"

say "waiting for 23:05"
until_at 2305
HOURS=()
for h in 19 20 21 22; do
  n=$(ls "$G/$DAY/$W" 2>/dev/null | awk -v a="${h}0000000" -v b="$((h + 1))0000000" '/\.gray$/ && $0 >= a && $0 < b' | wc -l)
  say "$W $h:00 has $n frames"
  [ "$n" -ge 1800 ] && HOURS+=("$h")
done
if [ ${#HOURS[@]} -eq 0 ]; then
  say "no evening hour with half an hour of frames; nothing labelled"
else
  for h in "${HOURS[@]}"; do
    say "labelling $W $h:00"
    node scripts/doctor/label.mjs "$DAY" "$W" --from=$h:00:00 --to=$((h + 1)):00:00 > "scripts/doctor/out/label-$DAY-$W-${h}0000.log" 2>&1
    tail -1 "scripts/doctor/out/label-$DAY-$W-${h}0000.log" | cut -c1-200 | tee -a "$LOG"
  done
  say "merging the labels into $DAY"
  python -I scripts/doctor/merge-labels.py "$DAY" 2>&1 | tail -2 | tee -a "$LOG"
  FROM="${HOURS[0]}"; TO="$((${HOURS[-1]} + 1))"
  say "the exam set $FROM:00 to $TO:00"
  python -I - "$G/$DAY/$W" "$G/$DAY/library" "$FROM" "$TO" <<'EOF' 2>&1 | tee -a "$LOG"
import io, json, os, sys
a, b = sys.argv[3] + "0000000", sys.argv[4] + "0000000"
frames = sorted(f[:-5] for f in os.listdir(sys.argv[1]) if f.endswith(".gray"))
inr = [f for f in frames if a <= f < b]
libs = sorted(l for l in os.listdir(sys.argv[2]) if l < sys.argv[3] + "0000")
ex = [dict(name="Second evening with sound (screen)", day="2026-11-09", window="screen", **{"from": sys.argv[3] + ":00:00", "to": sys.argv[4] + ":00:00"},
           frames=[inr[0], inr[-1]], library=libs[-1], lead=18)]
with io.open("scripts/breakwatch/exams-sound2.json", "w", encoding="utf-8") as f: f.write(json.dumps(ex, indent=1))
print("exams-sound2.json:", ex[0]["frames"], "library", ex[0]["library"], len(inr), "frames")
EOF
  say "the sidecars against the labels"
  python -I scripts/breakwatch/sidecar-eval.py "$DAY" "$W" "$FROM:00:00" "$TO:00:00" "$R/phaseD/sidecar-eval-$DAY.json" 2>&1 | tail -1 | cut -c1-400 | tee -a "$LOG"
fi
say "the harvest over the day's sound"
HARVEST_DAY=$DAY "$PY" -I scripts/breakwatch/fingerprint.py harvest "$R/phaseE3/harvest-$DAY.json" "$G/$DAY/audio" "$D/bench/_audio" 2>&1 | tail -1 | cut -c1-400 | tee -a "$LOG"

if [ "$(hm)" -lt 0040 ] || [ "$(hm)" -ge 2300 ]; then
  window "$E/train-heldout-rep4.txt" 0050 "$E/train-heldout-rep2.txt" "$E/train-heldout-rep3.txt"
else
  say "too late for a second scorer window"
fi
say "evening $DAY done"
