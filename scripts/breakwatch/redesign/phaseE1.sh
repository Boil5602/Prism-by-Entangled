#!/bin/bash
# Addendum Phase E1 (2026-11-08): repetition as a tree feature. The per-second features (repfeat.py build, strictly earlier days) joined
# to each training day's feature CSV, the trees retrained on the six days with the two columns (the same recipe as the app's model),
# the held-out-by-channel scorer with them (the new-channel rate), then the bench on the honest sets reading the feature from the
# sidecars (EXTRAFEATROOT). Training waits for Phase C's three verifiers (one training at a time); the bench waits for a free bench.
cd /c/Projects/prism
export PROMOS=show
export BWEXE="$(cygpath -w "$PWD/scripts/breakwatch/bwtest/bin/Release-r3/bwtest.exe")"
D="$(cygpath -m "$LOCALAPPDATA")/Prism/diagnostics"; G="$D/golden"
F=scripts/doctor/out/train-recent-ad-20261105; N=scripts/doctor/out/promo-retrain; L=scripts/doctor/out/lowchannels-20261107
R=scripts/doctor/out/redesign-20261107/phaseE1; RF="$R/repfeat"; mkdir -p "$R/feat2"
LOG=scripts/doctor/out/redesign-20261107/phaseE1.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python.exe"
CLEAN="$(cygpath -w "$PWD/scripts/doctor/out/cnn-20261107c/picture-net.json")"
say "joining the repetition columns to the six days' features"
for pair in "2026-10-07 $F" "2026-10-08 $F" "2026-11-04 $F" "2026-11-05 $N" "2026-11-06 $N" "2026-11-07 $N"; do
  set -- $pair; "$PY" -I scripts/breakwatch/repfeat.py join "$RF" "$2/feat_$1.csv" "$G/$1" "$R/feat2/feat_$1.csv" 2>&1 | tail -1 | tee -a "$LOG"
done
say "waiting for phase C's trainings"
until grep -q "phase C trained" scripts/doctor/out/redesign-20261107/phaseC.log 2>/dev/null; do sleep 120; done
DAYS6=(--day "$R/feat2/feat_2026-10-07.csv" "$G/2026-10-07" --day "$R/feat2/feat_2026-10-08.csv" "$G/2026-10-08" --day "$R/feat2/feat_2026-11-04.csv" "$G/2026-11-04"
       --day "$R/feat2/feat_2026-11-05.csv" "$G/2026-11-05" --day "$R/feat2/feat_2026-11-06.csv" "$G/2026-11-06" --day "$R/feat2/feat_2026-11-07.csv" "$G/2026-11-07")
say "training low-6d-rep (CLOCK=1, six days, the repetition columns)"
env CLOCK=1 python scripts/breakwatch/train2.py "${DAYS6[@]}" --only "$L/trained+low.json" --inset-ads "NFL Network" --no-eval \
  --export "$R/low-6d-rep.json" "$R/low-6d-rep-parity.csv" > "$R/train.txt" 2>&1
say "trained: $(tail -1 "$R/train.txt" | cut -c1-160)"
python -I -c "import json,io;p='$R/low-6d-rep.json';m=json.load(io.open(p,encoding='utf-8'));m['policy']={'on':0.8,'off':0.65,'hold':3,'picture':0.5,'agree':True,'treeMin':0.5,'netMin':0.5};io.open(p,'w',encoding='utf-8').write(json.dumps(m,separators=(',',':')));print('inputs', len(m['inputs']), 'rep in inputs', [x for x in m['inputs'] if x.startswith('rep_')])" | tee -a "$LOG"
say "importance: $(grep -i "rep_near\|rep_count15" "$R/train.txt" | head -4 | tr '\n' ' ' | cut -c1-300)"
say "held out by channel with the repetition columns (idle)"
env CLOCK=1 python scripts/breakwatch/train2.py "${DAYS6[@]}" --only "$L/trained+low.json" --inset-ads "NFL Network" > "$R/train-heldout-rep.txt" 2>&1
grep -E "^ALL|^RANK" "$R/train-heldout-rep.txt" | tee -a "$LOG"
while tasklist //FI "IMAGENAME eq bwtest.exe" 2>/dev/null | grep -qi bwtest; do sleep 30; done
M="$R/low-6d-rep.json"
run() { local tag=$1 ex=$2 soft=$3; shift 3; say "$tag"
  EXTRAFEATROOT="$(cygpath -w "$PWD/$RF")" python scripts/breakwatch/run_exams.py --gentle --exams "$ex" --model "$M" ${soft:+--soft $soft} --results "$R/$tag.json" BANDLOGO=1 BANDSTRICT=0 PICNET="$CLEAN" PICW=0.5 AGREE=1 "$@" 2>&1 \
    | grep -v "looks a minute" | head -1 | sed 's/.*ads covered/ads covered/' | sed 's/| missed.*| pop-ups/| pop-ups/' | tee -a "$LOG"; }
run rep-base-seven scripts/breakwatch/exams.json ""
run rep-base-night scripts/breakwatch/exams-night.json ""
run rep-soft90-seven scripts/breakwatch/exams.json 90
run rep-soft90-night scripts/breakwatch/exams-night.json 90
say "phase E1 done"
