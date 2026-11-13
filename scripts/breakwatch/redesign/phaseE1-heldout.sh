#!/bin/bash
# The new-channel rate with the repetition columns (addendum E1), overnight at idle after Phase F's bench runs: twelve hours yesterday.
cd /c/Projects/prism
export PROMOS=show
D="$(cygpath -m "$LOCALAPPDATA")/Prism/diagnostics"; G="$D/golden"; L=scripts/doctor/out/lowchannels-20261107; R=scripts/doctor/out/redesign-20261107/phaseE1
LOG=scripts/doctor/out/redesign-20261107/phaseE1-heldout.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
say "waiting for phase F"
until grep -q "phase F done" scripts/doctor/out/redesign-20261107/phaseF.log 2>/dev/null; do sleep 300; done
DAYS6=(--day "$R/feat2/feat_2026-10-07.csv" "$G/2026-10-07" --day "$R/feat2/feat_2026-10-08.csv" "$G/2026-10-08" --day "$R/feat2/feat_2026-11-04.csv" "$G/2026-11-04"
       --day "$R/feat2/feat_2026-11-05.csv" "$G/2026-11-05" --day "$R/feat2/feat_2026-11-06.csv" "$G/2026-11-06" --day "$R/feat2/feat_2026-11-07.csv" "$G/2026-11-07")
say "held out by channel with the repetition columns (idle)"
env CLOCK=1 python scripts/breakwatch/train2.py "${DAYS6[@]}" --only "$L/trained+low.json" --inset-ads "NFL Network" > "$R/train-heldout-rep.txt" 2>&1
grep -E "^ALL|^RANK" "$R/train-heldout-rep.txt" | tee -a "$LOG"
say "held-out done"
