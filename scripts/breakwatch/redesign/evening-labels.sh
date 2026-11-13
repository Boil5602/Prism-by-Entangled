#!/bin/bash
# Labelled evenings for the palette columns (2026-11-09: the owner approved about five more labelled evenings; the palette's readings
# exist only from 2026-11-08 on, so the trees need evenings recorded since then). Run each night at 23:05 by the scheduled task
# "Prism break-watch evening labels" (2026-11-10 to 2026-11-16), and safe to run by hand:
#
#     bash scripts/breakwatch/redesign/evening-labels.sh [--dry] [YYYY-MM-DD]
#
# One run: the bench's recording is kept (keep.py), the screen window's hours 19:00 to 23:00 with half an hour of frames or more are
# labelled by the doctor's labeller (label.mjs), merged into the day's labels.json, the breaks' promos sorted (promos.mjs, so the day reads
# under PROMOS=show like every other), an exam set written for the day, the sidecar evaluation and the day's sound harvest.
#
# The spend is fenced four ways: MAX_EVENINGS labelled evenings in all (the ledger, evenings/labelled.txt), at most four hours an evening,
# no day after LAST_DAY, and an hour whose label folder already holds labels.model.json is never sent again. An evening with no hour of
# frames costs nothing and does not count. --dry prints what a run would do and sends nothing.
#
# The reader (2026-11-10): while evenings/subscription exists the sheets are answered by Claude Code sessions on this PC's own sign-in
# (scripts/doctor/answer-sheets.sh: the labeller's dry run writes the sheets, the sessions write the answers, the labeller's answers mode
# builds the marks; the promos the same way) and the labeller's key is not used, so the pause below does not hold such a run. Remove the
# file to go back to the key.
#
# No bench run here: a replay never runs beside a recording, and the sampler records until 00:45. The exam set waits for a quiet hour.
cd /c/Projects/prism
export PROMOS=show PYTHONUTF8=1
MAX_EVENINGS=5; LAST_DAY=2026-11-16; MAX_SHEETS=120
DRY=0; DAY=
for a in "$@"; do case "$a" in --dry) DRY=1;; 20??-??-??) DAY=$a;; esac; done
# a run after midnight belongs to the evening before
if [ -z "$DAY" ]; then if [ "$(date +%H)" -lt 12 ]; then DAY=$(date -d yesterday +%F); else DAY=$(date +%F); fi; fi
D="$(cygpath -m "$LOCALAPPDATA")/Prism/diagnostics"; G="$D/golden"; W=screen
R=scripts/doctor/out/redesign-20261107; E="$R/evenings"
mkdir -p "$E" "$R/phaseD" "$R/phaseE3"
LEDGER="$E/labelled.txt"; touch "$LEDGER"
LOG="$E/evening-labels.log"
say() { echo "$(date '+%F %H:%M:%S') $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python.exe"
[ "$DRY" = 1 ] && say "dry run for $DAY: nothing is sent, nothing is written to the day"

if [[ "$DAY" > "$LAST_DAY" ]]; then say "$DAY is after $LAST_DAY: the approved evenings are over; nothing done"; exit 0; fi
DONE=$(grep -c . "$LEDGER")
if [ "$DONE" -ge "$MAX_EVENINGS" ]; then say "$DONE evenings are labelled, the approved $MAX_EVENINGS: nothing done"; exit 0; fi
if grep -q "^$DAY " "$LEDGER"; then say "$DAY is in the ledger already; nothing done"; exit 0; fi
if ! mkdir "$E/lock" 2>/dev/null; then say "another run holds $E/lock; nothing done"; exit 0; fi
trap 'rmdir "$E/lock" 2>/dev/null' EXIT

# the recording filed by day first: the sampler keeps after each slot only, so the last half hour can still be in the bench alone
keeping() { powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | ? { \$_.CommandLine -like '*keep.py*' }).Count" | tr -d '\r'; }
if [ "$DRY" = 0 ]; then
  for i in 1 2 3 4 5 6; do [ "$(keeping)" = "0" ] && break; sleep 20; done
  if [ "$(keeping)" = "0" ]; then say "keep: $(python scripts/breakwatch/keep.py 2>&1 | tail -1 | cut -c1-200)"; else say "a keeper is still running; the kept frames as they are"; fi
fi

# the pause (2026-11-10): while evenings/pause exists a run keeps the recording and sends nothing. A paused evening is labelled later by
# hand with its date, since the kept frames stay.
SUB=0; [ -e "$E/subscription" ] && SUB=1
if [ -e "$E/pause" ] && [ "$SUB" = 0 ]; then say "paused ($E/pause): the recording of $DAY is kept, nothing is sent"; exit 0; fi

HOURS=()
for h in 19 20 21 22; do
  n=$(ls "$G/$DAY/$W" 2>/dev/null | awk -v a="${h}0000000" -v b="$((h + 1))0000000" '/\.gray$/ && $0 >= a && $0 < b' | wc -l)
  say "$W $h:00 has $n frames"
  [ "$n" -ge 1800 ] && HOURS+=("$h")
done
if [ ${#HOURS[@]} -eq 0 ]; then say "no evening hour with half an hour of frames; nothing labelled, the evening does not count"; exit 0; fi
if [ "$DRY" = 1 ]; then say "would label $W ${HOURS[*]} of $DAY (evening $((DONE + 1)) of $MAX_EVENINGS), then merge, promos, the exam set, the sidecars, the harvest"; exit 0; fi

LABELLED=()
for h in "${HOURS[@]}"; do
  OUT="scripts/doctor/out/label-$DAY-$W-${h}0000"
  if [ -s "$OUT/labels.model.json" ]; then say "$W $h:00 is labelled already"; LABELLED+=("$h"); continue; fi
  say "labelling $W $h:00"
  if [ "$SUB" = 1 ]; then
    node scripts/doctor/label.mjs "$DAY" "$W" --from=$h:00:00 --to=$((h + 1)):00:00 --out="$OUT" --dry > "$OUT.log" 2>&1
    if bash scripts/doctor/answer-sheets.sh label "$OUT" >> "$OUT.log" 2>&1; then
      node scripts/doctor/label.mjs "$DAY" "$W" --from=$h:00:00 --to=$((h + 1)):00:00 --out="$OUT" --answers="$OUT" >> "$OUT.log" 2>&1
    else say "  $h:00: sheets are left with no good answer; no marks built"; fi
  else
    node scripts/doctor/label.mjs "$DAY" "$W" --from=$h:00:00 --to=$((h + 1)):00:00 > "$OUT.log" 2>&1
  fi
  tail -1 "$OUT.log" | cut -c1-200 | tee -a "$LOG"
  if [ -s "$OUT/labels.model.json" ]; then LABELLED+=("$h"); else say "  $h:00 gave no labels.model.json (see $OUT.log)"; fi
done
if [ ${#LABELLED[@]} -eq 0 ]; then say "no hour was labelled; the evening does not count"; exit 1; fi
echo "$DAY ${LABELLED[*]}" >> "$LEDGER"
say "merging the labels into $DAY"
python -I scripts/doctor/merge-labels.py "$DAY" 2>&1 | tail -2 | tee -a "$LOG"

# the promos inside the marked breaks; never over a promo file the day already has
if [ -s "$G/$DAY/labels.promos.json" ]; then say "the day has its labels.promos.json already"
else
  say "the promos"
  if [ "$SUB" = 1 ]; then
    PS="scripts/doctor/out/promosheets-$DAY-$W"
    node scripts/doctor/promos.mjs "$DAY" --windows=$W --max-sheets=$MAX_SHEETS --sheets --out="$PS" > "$E/promos-$DAY.log" 2>&1
    if bash scripts/doctor/answer-sheets.sh promos "$PS" >> "$E/promos-$DAY.log" 2>&1; then
      node scripts/doctor/promos.mjs "$DAY" --windows=$W --max-sheets=$MAX_SHEETS --out="$PS" --answers="$PS" >> "$E/promos-$DAY.log" 2>&1
    else say "  promo sheets are left with no good answer; the day has no promos yet"; fi
  else
    node scripts/doctor/promos.mjs "$DAY" --windows=$W --max-sheets=$MAX_SHEETS --concurrency=4 > "$E/promos-$DAY.log" 2>&1
  fi
  grep "^\[promos\]" "$E/promos-$DAY.log" | tail -2 | cut -c1-200 | tee -a "$LOG"
fi

FROM="${LABELLED[0]}"; TO="$((${LABELLED[-1]} + 1))"
say "the exam set $FROM:00 to $TO:00"
python -I - "$G/$DAY/$W" "$G/$DAY/library" "$FROM" "$TO" "$DAY" "$W" "$E/exams-$DAY.json" <<'EOF' 2>&1 | tee -a "$LOG"
import io, json, os, sys
a, b = sys.argv[3] + "0000000", sys.argv[4] + "0000000"
frames = sorted(f[:-5] for f in os.listdir(sys.argv[1]) if f.endswith(".gray"))
inr = [f for f in frames if a <= f < b]
libs = sorted(l for l in os.listdir(sys.argv[2]) if l < sys.argv[3] + "0000") if os.path.isdir(sys.argv[2]) else []
ex = [dict(name="Labelled evening " + sys.argv[5] + " (" + sys.argv[6] + ")", day=sys.argv[5], window=sys.argv[6],
           **{"from": sys.argv[3] + ":00:00", "to": sys.argv[4] + ":00:00"}, frames=[inr[0], inr[-1]], library=libs[-1] if libs else None, lead=18)]
with io.open(sys.argv[7], "w", encoding="utf-8") as f: f.write(json.dumps(ex, indent=1))
print(os.path.basename(sys.argv[7]) + ":", ex[0]["frames"], "library", ex[0]["library"], len(inr), "frames")
EOF
say "the sidecars against the labels"
python -I scripts/breakwatch/sidecar-eval.py "$DAY" "$W" "$FROM:00:00" "$TO:00:00" "$R/phaseD/sidecar-eval-$DAY.json" 2>&1 | tail -1 | cut -c1-400 | tee -a "$LOG"
say "the harvest over the day's sound"
HARVEST_DAY=$DAY "$PY" -I scripts/breakwatch/fingerprint.py harvest "$R/phaseE3/harvest-$DAY.json" "$G/$DAY/audio" "$D/bench/_audio" 2>&1 | tail -1 | cut -c1-400 | tee -a "$LOG"
say "evening $DAY done: $(grep -c . "$LEDGER") of $MAX_EVENINGS labelled"
