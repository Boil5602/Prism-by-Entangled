#!/bin/bash
# Addendum Phase C (2026-11-08): the end verifier. Three models at idle, one after another, after Phase A3's training and bench runs:
# each leaves out the day of the set it is judged on (the seven exams' 10-08, the ordinary evening's 11-05, the election night's 11-04),
# scores that set's windows a second at a time, and the offline sweeps apply it as an end rule beside the soft refractory. The first
# model is exported to ONNX for the cost measurements.
cd /c/Projects/prism
export PROMOS=show
R=scripts/doctor/out/redesign-20261107/phaseC; mkdir -p "$R"
LOG=scripts/doctor/out/redesign-20261107/phaseC.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python.exe"
P0=scripts/doctor/out/redesign-20261107/phase0
APP=scripts/doctor/out/lowchannels-20261107/low-6d-agree.json; EXT=scripts/doctor/out/clock-20261106/hold4.json
say "waiting for phase A3"
until grep -q "phase A3 done" scripts/doctor/out/redesign-20261107/phaseA3.log 2>/dev/null; do sleep 60; done
for pair in "seven 2026-10-08 scripts/breakwatch/exams.json" "night 2026-11-05 scripts/breakwatch/exams-night.json" "1104 2026-11-04 scripts/breakwatch/exams-1104.json"; do
  set -- $pair; tag=$1; day=$2; ex=$3; O="$R/leave-$tag"; mkdir -p "$O"
  say "training the verifier without $day"
  EPOCHS=8 "$PY" -I scripts/breakwatch/endverifier.py train "$O" --leave "$day" > "$O/train.log" 2>&1
  say "trained: $(grep -E 'samples|epoch 8' "$O/train.log" | tail -2 | tr '\n' ' ' | cut -c1-200)"
  say "scoring $tag"
  "$PY" -I scripts/breakwatch/endverifier.py score "$O" "$ex" > "$O/score.log" 2>&1; say "scored: $(tail -1 "$O/score.log" | cut -c1-100)"
  if [ "$tag" = "seven" ]; then "$PY" -I scripts/breakwatch/endverifier.py export "$O" > "$O/export.log" 2>&1; say "export: $(tail -1 "$O/export.log" | cut -c1-120)"; fi
done
say "phase C trained"
sweep() { local tag=$1 par=$2 ex=$3 model=$4 vdir=$5; shift 5; say "sweep $tag"; WORKERS=4 "$PY" -I scripts/breakwatch/boundary.py "$par" "$ex" "$model" "$R/$tag" --grid verif --verif "$vdir" "$@" > "$R/$tag.out" 2>&1; say "$tag: $(grep -c '^| ' "$R/$tag.out") rows"; }
sweep app-seven "$P0/par-app-clean-seven" scripts/breakwatch/exams.json "$APP" "$R/leave-seven" --picw 0.5
sweep app-night "$P0/par-app-clean-night" scripts/breakwatch/exams-night.json "$APP" "$R/leave-night" --picw 0.5
sweep app-1104 "$P0/par-app-clean-1104" scripts/breakwatch/exams-1104.json "$APP" "$R/leave-1104" --picw 0.5
sweep ext-seven "$P0/par-ext-clean-seven" scripts/breakwatch/exams.json "$EXT" "$R/leave-seven" --picw 0.75 --notext --agree
sweep ext-night "$P0/par-ext-clean-night" scripts/breakwatch/exams-night.json "$EXT" "$R/leave-night" --picw 0.75 --notext --agree
sweep ext-1104 "$P0/par-ext-clean-1104" scripts/breakwatch/exams-1104.json "$EXT" "$R/leave-1104" --picw 0.75 --notext --agree
say "phase C done"
