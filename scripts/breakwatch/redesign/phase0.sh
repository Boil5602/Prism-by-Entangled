#!/bin/bash
# Boundary-first redesign, Phase 0 (2026-11-07/08): the shipped app and extension models on the three exam sets, with results.json,
# the wide per-look parity stream for Phase 1's offline sweeps, and the boundary-lag histograms. Waits for the night judge chain (one
# bench run at a time). The bench binary is the instrumented build aside (BWEXE), so the chain's own binary is never replaced under it.
cd /c/Projects/prism
export PROMOS=show
export BWEXE="$(cygpath -w "$PWD/scripts/breakwatch/bwtest/bin/Release-redesign/bwtest.exe")"
R=scripts/doctor/out/redesign-20261107/phase0; mkdir -p "$R"
LOG=scripts/doctor/out/redesign-20261107/phase0.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python.exe"
APP=scripts/doctor/out/lowchannels-20261107/low-6d-agree.json
EXT=scripts/doctor/out/clock-20261106/hold4.json
SHIPPED="$(cygpath -w "$PWD/targets/win-host/PrismHost/Assets/breakwatch/picture-net.json")"
CLEAN="$(cygpath -w "$PWD/scripts/doctor/out/cnn-20261107c/picture-net.json")"
SEVEN=scripts/breakwatch/exams.json; NIGHT=scripts/breakwatch/exams-night.json; E1104=scripts/breakwatch/exams-1104.json
run() { # $1 tag, $2 exams file, $3 model, $4 network, then the switches
  local tag=$1 ex=$2 model=$3 net=$4; shift 4
  mkdir -p "$R/par-$tag"
  say "$tag"
  python scripts/breakwatch/run_exams.py --gentle --keep-calls --exams "$ex" --model "$model" --results "$R/$tag.json" \
    BANDLOGO=1 BANDSTRICT=0 PICNET="$net" AGREE=1 LPWIDE=1 LPARITYDIR="$(cygpath -w "$PWD/$R/par-$tag")" "$@" 2>&1 \
    | grep -v "looks a minute" | head -1 | sed 's/.*ads covered/ads covered/' | sed 's/| missed.*| pop-ups/| pop-ups/' | tee -a "$LOG"
}
say "waiting for the night judge chain"
until grep -q "night judge done" scripts/doctor/out/judge-night-20261107.log 2>/dev/null; do sleep 120; done
while tasklist //FI "IMAGENAME eq bwtest.exe" 2>/dev/null | grep -qi bwtest; do sleep 30; done
# reproduction of the brief's figures: the shipped network on the seven exams
run app-shipped-seven "$SEVEN" "$APP" "$SHIPPED" PICW=0.5
run ext-shipped-seven "$SEVEN" "$EXT" "$SHIPPED" PICW=0.75 NOTEXT=1
# the honest baseline: the clean network on all three sets (the 11-04 set is open-book for both models: both trained on that night)
run app-clean-seven "$SEVEN" "$APP" "$CLEAN" PICW=0.5
run app-clean-night "$NIGHT" "$APP" "$CLEAN" PICW=0.5
run app-clean-1104 "$E1104" "$APP" "$CLEAN" PICW=0.5
run ext-clean-seven "$SEVEN" "$EXT" "$CLEAN" PICW=0.75 NOTEXT=1
run ext-clean-night "$NIGHT" "$EXT" "$CLEAN" PICW=0.75 NOTEXT=1
run ext-clean-1104 "$E1104" "$EXT" "$CLEAN" PICW=0.75 NOTEXT=1
say "histograms"
for set in seven night 1104; do
  "$PY" scripts/breakwatch/lagplot.py "$R/lags-$set.png" "Baseline boundary lags, $set (clean network)" "app=$R/app-clean-$set.json" "ext=$R/ext-clean-$set.json" 2>&1 | tail -1 | tee -a "$LOG"
done
say "phase 0 done"
