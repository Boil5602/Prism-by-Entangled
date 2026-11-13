#!/bin/bash
# The morning after the first evening with sound (addendum D/E1/E3, written 2026-11-08): once the night chain has labelled the evening,
# the overnight new-channel scorer is done, the sampler's 01:00 run and the doctor's 06:15 run are over and no bench runs, the bench
# rows the final report waits on: the app's and the extension's models on the evening with sound, with and without the soft refractory,
# and the repetition trees with the REAL library as the product reads it (REPLIB: frames recurring with an earlier day, from days strictly
# before the exam's), on the sound evening, the ordinary evening and the seven. One bench run at a time; nothing visible; detached.
cd /c/Projects/prism
export PROMOS=show PYTHONUTF8=1
export BWEXE="$(cygpath -w "$PWD/scripts/breakwatch/bwtest/bin/Release-r5/bwtest.exe")"
R=scripts/doctor/out/redesign-20261107; M="$R/morning-20261109"; mkdir -p "$M"
LOG="$R/morning-20261109.log"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
APP=scripts/doctor/out/lowchannels-20261107/low-6d-agree.json
EXT=scripts/doctor/out/clock-20261106/hold4.json
REP="$R/phaseE1/low-6d-rep.json"
CLEAN="$(cygpath -w "$PWD/scripts/doctor/out/cnn-20261107c/picture-net.json")"
LIB() { cygpath -w "$PWD/$R/phaseE1/replib-before-$1.bin"; }
say "waiting for the night chain, the scorer and 06:50"
until grep -q "night 2026-11-08 done" "$R/night-2026-11-08.log" 2>/dev/null; do sleep 300; done
until grep -q "held-out done" "$R/phaseE1-heldout.log" 2>/dev/null; do sleep 300; done
while [ "$(date +%H%M)" -lt 0650 ]; do sleep 60; done
while tasklist //FI "IMAGENAME eq bwtest.exe" 2>/dev/null | grep -qi bwtest; do sleep 30; done
[ -f scripts/breakwatch/exams-sound.json ] || { say "no exams-sound.json: the night chain did not make the exam set"; exit 1; }
run() { # $1 tag $2 exams $3 model $4 soft (empty = none), then switches
  local tag=$1 ex=$2 model=$3 soft=$4; shift 4
  say "$tag"
  python scripts/breakwatch/run_exams.py --gentle --keep-calls --exams "$ex" --model "$model" ${soft:+--soft $soft} --results "$M/$tag.json" \
    BANDLOGO=1 BANDSTRICT=0 PICNET="$CLEAN" AGREE=1 "$@" 2>&1 \
    | grep -v "looks a minute" | head -1 | sed 's/.*ads covered/ads covered/' | sed 's/| missed.*| pop-ups/| pop-ups/' | tee -a "$LOG"
  [ -s "$M/$tag.json" ] || say "  $tag: no results file (the run failed; see exam-work)"
}
S=scripts/breakwatch/exams-sound.json
run app-base-sound "$S" "$APP" "" PICW=0.5
run app-soft90-sound "$S" "$APP" 90 PICW=0.5
run ext-base-sound "$S" "$EXT" "" PICW=0.75 NOTEXT=1
run ext-soft90-sound "$S" "$EXT" 90 PICW=0.75 NOTEXT=1
export REPLIB="$(LIB 2026-11-09)"
run rep-lib-sound "$S" "$REP" "" PICW=0.5
run rep-lib-soft90-sound "$S" "$REP" 90 PICW=0.5
export REPLIB="$(LIB 2026-11-05)"
run rep-lib-night scripts/breakwatch/exams-night.json "$REP" "" PICW=0.5
run rep-lib-soft90-night scripts/breakwatch/exams-night.json "$REP" 90 PICW=0.5
export REPLIB="$(LIB 2026-10-08)"
run rep-lib-seven scripts/breakwatch/exams.json "$REP" "" PICW=0.5
unset REPLIB
say "morning 2026-11-09 done"
