#!/bin/bash
# The 51-channel new-channel rate with the repetition columns, again (2026-11-09): the first run was stopped at 33 channels when the
# caption-classifier cache grew past 24 GB; the cache now drops a pair once both channels are scored. Starts when the sound evening's
# rescoring is done and no bench runs, outside the sampler's and the doctor's hours; nothing else heavy beside it; detached.
cd /c/Projects/prism
export PROMOS=show PYTHONUTF8=1
D="$(cygpath -m "$LOCALAPPDATA")/Prism/diagnostics"; G="$D/golden"; L=scripts/doctor/out/lowchannels-20261107; R=scripts/doctor/out/redesign-20261107/phaseE1
LOG=scripts/doctor/out/redesign-20261107/heldout-rerun.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
say "waiting for the sound rescoring"
until grep -q "sound rescore done" scripts/doctor/out/redesign-20261107/sound-rescore.log 2>/dev/null; do sleep 300; done
while tasklist //FI "IMAGENAME eq bwtest.exe" 2>/dev/null | grep -qi bwtest; do sleep 60; done
# the sampler runs 01:00 to 06:00 and the doctor at 06:15: before 06:50 the chain waits for 06:50 (2026-11-09: a gate that only
# covered 00:55 to 06:50 let the scorer start just after midnight and run into the sampler's hour; stopped and restarted with this one)
while h=$(date +%H%M); [ "$h" -lt 0650 ]; do sleep 60; done
# first, three bench rows (2026-11-09): the repetition trees with a library of EVERY earlier frame (replib-all-before-<day>.bin, what the
# offline readings were computed against), against the recurring-only library's rows of the night before; one bench run at a time, then the scorer
export BWEXE="$(cygpath -w "$PWD/scripts/breakwatch/bwtest/bin/Release-r6/bwtest.exe")"
CLEAN="$(cygpath -w "$PWD/scripts/doctor/out/cnn-20261107c/picture-net.json")"; REPM="$R/low-6d-rep.json"; M=scripts/doctor/out/redesign-20261107/liball; mkdir -p "$M"
row() { local tag=$1 ex=$2 lib=$3; export REPLIB="$(cygpath -w "$PWD/$R/replib-all-before-$lib.bin")"; say "$tag"
  python scripts/breakwatch/run_exams.py --gentle --exams "$ex" --model "$REPM" --results "$M/$tag.json" BANDLOGO=1 BANDSTRICT=0 PICNET="$CLEAN" AGREE=1 PICW=0.5 2>&1 \
    | grep -v "looks a minute" | head -1 | sed 's/.*ads covered/ads covered/' | sed 's/| missed.*| pop-ups/| pop-ups/' | tee -a "$LOG"; unset REPLIB; }
while tasklist //FI "IMAGENAME eq bwtest.exe" 2>/dev/null | grep -qi bwtest; do sleep 60; done
row rep-liball-seven scripts/breakwatch/exams.json 2026-10-08
row rep-liball-night scripts/breakwatch/exams-night.json 2026-11-05
row rep-liball-sound scripts/breakwatch/exams-sound.json 2026-11-09
DAYS6=(--day "$R/feat2/feat_2026-10-07.csv" "$G/2026-10-07" --day "$R/feat2/feat_2026-10-08.csv" "$G/2026-10-08" --day "$R/feat2/feat_2026-11-04.csv" "$G/2026-11-04"
       --day "$R/feat2/feat_2026-11-05.csv" "$G/2026-11-05" --day "$R/feat2/feat_2026-11-06.csv" "$G/2026-11-06" --day "$R/feat2/feat_2026-11-07.csv" "$G/2026-11-07")
say "held out by channel with the repetition columns, the cache bounded"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\Projects\prism\scripts\doctor\out\redesign-20261107\memory-guard.ps1' -WindowStyle Hidden"
env CLOCK=1 python scripts/breakwatch/train2.py "${DAYS6[@]}" --only "$L/trained+low.json" --inset-ads "NFL Network" > "$R/train-heldout-rep2.txt" 2>&1
grep -E "^ALL|^RANK" "$R/train-heldout-rep2.txt" | tee -a "$LOG"
say "held-out rerun done"
