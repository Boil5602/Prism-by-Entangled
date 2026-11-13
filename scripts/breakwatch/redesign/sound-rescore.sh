#!/bin/bash
# The sound evening's rows again, with its promos sorted (2026-11-08, late evening): the six rows ran before promos.mjs had seen the evening, so
# every promo second counted as an ad there and nowhere else. Now under PROMOS=show (the standing reading) and PROMOS=neutral (the
# promo seconds out of the score), the bench built with the neutral cut (Release-r6). After the morning chain; paused from 00:55 to 06:50
# for the sampler's run and the doctor's; one bench run at a time; detached.
cd /c/Projects/prism
export PYTHONUTF8=1
export BWEXE="$(cygpath -w "$PWD/scripts/breakwatch/bwtest/bin/Release-r6/bwtest.exe")"
R=scripts/doctor/out/redesign-20261107; M="$R/sound-rescore"; mkdir -p "$M"
LOG="$R/sound-rescore.log"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
APP=scripts/doctor/out/lowchannels-20261107/low-6d-agree.json
EXT=scripts/doctor/out/clock-20261106/hold4.json
REP="$R/phaseE1/low-6d-rep.json"
CLEAN="$(cygpath -w "$PWD/scripts/doctor/out/cnn-20261107c/picture-net.json")"
LIB="$(cygpath -w "$PWD/$R/phaseE1/replib-before-2026-11-09.bin")"
S=scripts/breakwatch/exams-sound.json
quiet() { local h; h=$(date +%H%M); if [ "$h" -ge 0055 ] && [ "$h" -lt 0650 ]; then say "pausing for the sampler and the doctor"; while h=$(date +%H%M); [ "$h" -ge 0055 ] && [ "$h" -lt 0650 ]; do sleep 60; done; fi; }
say "waiting for the morning chain"
until grep -q "morning 2026-11-09 done" "$R/morning-20261109.log" 2>/dev/null; do sleep 60; done
while tasklist //FI "IMAGENAME eq bwtest.exe" 2>/dev/null | grep -qi bwtest; do sleep 30; done
run() { # $1 tag $2 model $3 soft $4 mode, then switches
  local tag=$1 model=$2 soft=$3 mode=$4; shift 4
  quiet; say "$tag $mode"
  PROMOS=$mode python scripts/breakwatch/run_exams.py --gentle --keep-calls --exams "$S" --model "$model" ${soft:+--soft $soft} --results "$M/$tag-$mode.json" \
    BANDLOGO=1 BANDSTRICT=0 PICNET="$CLEAN" AGREE=1 "$@" 2>&1 \
    | grep -v "looks a minute" | head -1 | sed 's/.*ads covered/ads covered/' | sed 's/| missed.*| pop-ups/| pop-ups/' | tee -a "$LOG"
  [ -s "$M/$tag-$mode.json" ] || say "  $tag $mode: no results file"
}
for mode in show neutral; do
  run app-base "$APP" "" $mode PICW=0.5
  run app-soft90 "$APP" 90 $mode PICW=0.5
  run ext-base "$EXT" "" $mode PICW=0.75 NOTEXT=1
  run ext-soft90 "$EXT" 90 $mode PICW=0.75 NOTEXT=1
  export REPLIB="$LIB"
  run rep-lib "$REP" "" $mode PICW=0.5
  run rep-lib-soft90 "$REP" 90 $mode PICW=0.5
  unset REPLIB
done
say "sound rescore done"
