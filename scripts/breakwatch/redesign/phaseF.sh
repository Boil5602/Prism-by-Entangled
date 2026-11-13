#!/bin/bash
# Addendum Phase F (2026-11-08): two networks, one rule - the corners-masked network (4a) for a window whose channel has no logo reference
# in the library in use, the clean network for one that has; with and without the soft refractory; the 11-04 set with A3's five-day
# model (honest). Also 4c on the evening and 4a + soft 90 on every honest set. Waits for E1's bench runs (one bench at a time).
cd /c/Projects/prism
export PROMOS=show
export BWEXE="$(cygpath -w "$PWD/scripts/breakwatch/bwtest/bin/Release-r4/bwtest.exe")"
R=scripts/doctor/out/redesign-20261107/phaseF; mkdir -p "$R"
LOG=scripts/doctor/out/redesign-20261107/phaseF.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
APP=scripts/doctor/out/lowchannels-20261107/low-6d-agree.json; APP5=scripts/doctor/out/redesign-20261107/phaseA3/low-5d-no1104.json; EXT=scripts/doctor/out/clock-20261106/hold4.json
CLEAN="$(cygpath -w "$PWD/scripts/doctor/out/cnn-20261107c/picture-net.json")"; A4="$(cygpath -w "$PWD/scripts/doctor/out/redesign-20261107/phase4/4a-maskcorners/picture-net.json")"; C4="$(cygpath -w "$PWD/scripts/doctor/out/redesign-20261107/phase4/4c-cornerswap-ticker/picture-net.json")"
say "waiting for phase E1"
until grep -q "phase E1 done" scripts/doctor/out/redesign-20261107/phaseE1.log 2>/dev/null; do sleep 120; done
while tasklist //FI "IMAGENAME eq bwtest.exe" 2>/dev/null | grep -qi bwtest; do sleep 30; done
run() { local tag=$1 ex=$2 model=$3 soft=$4 net=$5 net2=$6; shift 6; say "$tag"
  python scripts/breakwatch/run_exams.py --gentle --exams "$ex" --model "$model" ${soft:+--soft $soft} --results "$R/$tag.json" BANDLOGO=1 BANDSTRICT=0 PICNET="$net" ${net2:+PICNET2=$net2} AGREE=1 "$@" 2>&1 \
    | grep -v "looks a minute" | head -1 | sed 's/.*ads covered/ads covered/' | sed 's/| missed.*| pop-ups/| pop-ups/' | tee -a "$LOG"; }
for soft in "" 90; do
  s=${soft:-0}
  run "app-two-soft$s-seven" scripts/breakwatch/exams.json "$APP" "$soft" "$CLEAN" "$A4" PICW=0.5
  run "app-two-soft$s-night" scripts/breakwatch/exams-night.json "$APP" "$soft" "$CLEAN" "$A4" PICW=0.5
  run "app5d-two-soft$s-1104" scripts/breakwatch/exams-1104.json "$APP5" "$soft" "$CLEAN" "$A4" PICW=0.5
  run "ext-two-soft$s-seven" scripts/breakwatch/exams.json "$EXT" "$soft" "$CLEAN" "$A4" PICW=0.75 NOTEXT=1
  run "ext-two-soft$s-night" scripts/breakwatch/exams-night.json "$EXT" "$soft" "$CLEAN" "$A4" PICW=0.75 NOTEXT=1
done
run app-4a-soft90-seven scripts/breakwatch/exams.json "$APP" 90 "$A4" "" PICW=0.5
run app-4a-soft90-night scripts/breakwatch/exams-night.json "$APP" 90 "$A4" "" PICW=0.5
run app5d-4a-soft90-1104 scripts/breakwatch/exams-1104.json "$APP5" 90 "$A4" "" PICW=0.5
run app5d-clean-1104 scripts/breakwatch/exams-1104.json "$APP5" "" "$CLEAN" "" PICW=0.5
run app-4c-night scripts/breakwatch/exams-night.json "$APP" "" "$C4" "" PICW=0.5
say "phase F done"
