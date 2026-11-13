#!/bin/bash
# Boundary-first redesign, Phase 1c (2026-11-08): the soft refractory confirmed on the C# bench (LearnedBreak policy.softRefractory via
# run_exams --soft), the app and extension models on the three sets, after Phase 4's judge runs free the bench. The bench binary is the
# third build aside (Release-r2), which carries the policy field and the cue_on column.
cd /c/Projects/prism
export PROMOS=show
export BWEXE="$(cygpath -w "$PWD/scripts/breakwatch/bwtest/bin/Release-r2/bwtest.exe")"
R=scripts/doctor/out/redesign-20261107/phase1c; mkdir -p "$R"
LOG=scripts/doctor/out/redesign-20261107/phase1c.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python.exe"
APP=scripts/doctor/out/lowchannels-20261107/low-6d-agree.json
EXT=scripts/doctor/out/clock-20261106/hold4.json
CLEAN="$(cygpath -w "$PWD/scripts/doctor/out/cnn-20261107c/picture-net.json")"
doctor_pause() { local h; h=$(date +%H%M); if [ "$h" -ge 0605 ] && [ "$h" -le 0645 ]; then say "pausing for the doctor's run"; while [ "$(date +%H%M)" -le 0645 ]; do sleep 60; done; fi; }
run() { # $1 tag $2 exams $3 model $4 soft, then switches
  local tag=$1 ex=$2 model=$3 soft=$4; shift 4
  doctor_pause; mkdir -p "$R/par-$tag"
  say "$tag"
  python scripts/breakwatch/run_exams.py --gentle --keep-calls --exams "$ex" --model "$model" --soft "$soft" --results "$R/$tag.json" \
    BANDLOGO=1 BANDSTRICT=0 PICNET="$CLEAN" AGREE=1 LPWIDE=1 LPARITYDIR="$(cygpath -w "$PWD/$R/par-$tag")" "$@" 2>&1 \
    | grep -v "looks a minute" | head -1 | sed 's/.*ads covered/ads covered/' | sed 's/| missed.*| pop-ups/| pop-ups/' | tee -a "$LOG"
}
say "waiting for phase 4"
until grep -q "phase 4 done" scripts/doctor/out/redesign-20261107/phase4.log 2>/dev/null; do sleep 60; done
while tasklist //FI "IMAGENAME eq bwtest.exe" 2>/dev/null | grep -qi bwtest; do sleep 30; done
run app-soft90-seven scripts/breakwatch/exams.json "$APP" 90 PICW=0.5
run app-soft90-night scripts/breakwatch/exams-night.json "$APP" 90 PICW=0.5
run app-soft90-1104 scripts/breakwatch/exams-1104.json "$APP" 90 PICW=0.5
run ext-soft90-seven scripts/breakwatch/exams.json "$EXT" 90 PICW=0.75 NOTEXT=1
run ext-soft90-night scripts/breakwatch/exams-night.json "$EXT" 90 PICW=0.75 NOTEXT=1
run ext-soft90-1104 scripts/breakwatch/exams-1104.json "$EXT" 90 PICW=0.75 NOTEXT=1
run app-soft180-night scripts/breakwatch/exams-night.json "$APP" 180 PICW=0.5
run ext-soft180-night scripts/breakwatch/exams-night.json "$EXT" 180 PICW=0.75 NOTEXT=1
say "histograms"
P0=scripts/doctor/out/redesign-20261107/phase0b
for set in seven night 1104; do
  "$PY" scripts/breakwatch/lagplot.py "$R/lags-$set.png" "Boundary lags, $set: baseline against the soft refractory (90 s)" "app base=$P0/app-clean-$set.json" "app soft 90=$R/app-soft90-$set.json" "ext base=$P0/ext-clean-$set.json" "ext soft 90=$R/ext-soft90-$set.json" 2>&1 | tail -1 | tee -a "$LOG"
done
say "phase 1c done"
