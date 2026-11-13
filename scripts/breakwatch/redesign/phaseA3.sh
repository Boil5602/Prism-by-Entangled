#!/bin/bash
# Addendum Phase A3 (2026-11-08): the app's trees retrained with the 11-04 night left out (the six-day recipe on the other five days,
# CLOCK=1, the same policy), at idle after Phase 1c frees the bench; then the baseline and the soft refractory on the 11-04 set with it
# (honest from here on), and its own seven-exam and evening rows for the record.
cd /c/Projects/prism
export PROMOS=show
export BWEXE="$(cygpath -w "$PWD/scripts/breakwatch/bwtest/bin/Release-r2/bwtest.exe")"
D="$(cygpath -m "$LOCALAPPDATA")/Prism/diagnostics"; G="$D/golden"
F=scripts/doctor/out/train-recent-ad-20261105; N=scripts/doctor/out/promo-retrain; L=scripts/doctor/out/lowchannels-20261107
R=scripts/doctor/out/redesign-20261107/phaseA3; mkdir -p "$R"
LOG=scripts/doctor/out/redesign-20261107/phaseA3.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
CLEAN="$(cygpath -w "$PWD/scripts/doctor/out/cnn-20261107c/picture-net.json")"
say "waiting for phase 1c"
until grep -q "phase 1c done" scripts/doctor/out/redesign-20261107/phase1c.log 2>/dev/null; do sleep 60; done
while tasklist //FI "IMAGENAME eq bwtest.exe" 2>/dev/null | grep -qi bwtest; do sleep 30; done
DAYS5=(--day "$F/feat_2026-10-07.csv" "$G/2026-10-07" --day "$F/feat_2026-10-08.csv" "$G/2026-10-08"
       --day "$N/feat_2026-11-05.csv" "$G/2026-11-05" --day "$N/feat_2026-11-06.csv" "$G/2026-11-06" --day "$N/feat_2026-11-07.csv" "$G/2026-11-07")
say "training low-5d-no1104 (CLOCK=1, five days, the 11-04 night out)"
env CLOCK=1 python scripts/breakwatch/train2.py "${DAYS5[@]}" --only "$L/trained+low.json" --inset-ads "NFL Network" --no-eval \
  --export "$R/low-5d-no1104.json" "$R/low-5d-no1104-parity.csv" > "$R/train.txt" 2>&1
say "trained: $(tail -1 "$R/train.txt" | cut -c1-160)"
python -I -c "import json,io;p='$R/low-5d-no1104.json';m=json.load(io.open(p,encoding='utf-8'));m['policy']={'on':0.8,'off':0.65,'hold':3,'picture':0.5,'agree':True,'treeMin':0.5,'netMin':0.5};io.open(p,'w',encoding='utf-8').write(json.dumps(m,separators=(',',':')))"
M="$R/low-5d-no1104.json"
run() { local tag=$1 ex=$2 soft=$3; shift 3; mkdir -p "$R/par-$tag"; say "$tag"
  python scripts/breakwatch/run_exams.py --gentle --keep-calls --exams "$ex" --model "$M" ${soft:+--soft $soft} --results "$R/$tag.json" BANDLOGO=1 BANDSTRICT=0 PICNET="$CLEAN" PICW=0.5 AGREE=1 LPWIDE=1 LPARITYDIR="$(cygpath -w "$PWD/$R/par-$tag")" "$@" 2>&1 \
    | grep -v "looks a minute" | head -1 | sed 's/.*ads covered/ads covered/' | sed 's/| missed.*| pop-ups/| pop-ups/' | tee -a "$LOG"; }
run app5d-base-1104 scripts/breakwatch/exams-1104.json ""
run app5d-soft90-1104 scripts/breakwatch/exams-1104.json 90
run app5d-base-seven scripts/breakwatch/exams.json ""
run app5d-base-night scripts/breakwatch/exams-night.json ""
say "phase A3 done"
