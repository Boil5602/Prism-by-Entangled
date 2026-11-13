#!/bin/bash
# The promo-neutral rescoring (2026-11-08 evening): the refractory phase's chance streams (phase1c, LPWIDE parity) replayed by the offline
# emulator under PROMOS=show (the standing figures) and PROMOS=neutral (promo seconds out of the score), base and soft:90, the app's and
# the extension's models on the three honest sets. The emulator is the same for both columns, so the difference is the scoring alone.
cd /c/Projects/prism
export PYTHONUTF8=1
P=scripts/doctor/out/redesign-20261107/phase1c; R=scripts/doctor/out/redesign-20261107/promo-neutral; mkdir -p "$R"
LOG="$R/promo-neutral.log"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
APP=scripts/doctor/out/lowchannels-20261107/low-6d-agree.json
EXT=scripts/doctor/out/clock-20261106/hold4.json
for mode in show neutral; do
  for set in seven night 1104; do
    case $set in seven) ex=scripts/breakwatch/exams.json;; night) ex=scripts/breakwatch/exams-night.json;; 1104) ex=scripts/breakwatch/exams-1104.json;; esac
    say "app $set $mode"
    PROMOS=$mode python scripts/breakwatch/boundary.py "$P/par-app-soft90-$set" "$ex" "$APP" "$R/app-$set-$mode" --grid soft --picw 0.5 > "$R/app-$set-$mode.txt" 2>&1
    grep -E "^(base|soft:90)" "$R/app-$set-$mode.txt" | cut -c1-200 | tee -a "$LOG"
    say "ext $set $mode"
    PROMOS=$mode python scripts/breakwatch/boundary.py "$P/par-ext-soft90-$set" "$ex" "$EXT" "$R/ext-$set-$mode" --grid soft --picw 0.75 --notext > "$R/ext-$set-$mode.txt" 2>&1
    grep -E "^(base|soft:90)" "$R/ext-$set-$mode.txt" | cut -c1-200 | tee -a "$LOG"
  done
done
say "promo-neutral done"
