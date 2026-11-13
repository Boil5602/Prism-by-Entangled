#!/bin/bash
# Boundary-first redesign, Phase 1 + Phase 2 prototype (2026-11-08): the offline policy sweeps over Phase 0's wide parity streams, the
# app model on the three sets, then the extension model as its streams land. exam.py only: no bench binary, no training.
cd /c/Projects/prism
export PROMOS=show
P0=scripts/doctor/out/redesign-20261107/phase0; R=scripts/doctor/out/redesign-20261107/phase1; mkdir -p "$R"
LOG=scripts/doctor/out/redesign-20261107/phase1.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python.exe"
APP=scripts/doctor/out/lowchannels-20261107/low-6d-agree.json
EXT=scripts/doctor/out/clock-20261106/hold4.json
sweep() { # $1 tag $2 parity dir $3 exams $4 model, then options
  local tag=$1 par=$2 ex=$3 model=$4; shift 4
  say "sweep $tag"
  WORKERS=4 "$PY" -I scripts/breakwatch/boundary.py "$par" "$ex" "$model" "$R/$tag" "$@" > "$R/$tag.out" 2>&1
  say "$tag: $(grep -c '^| ' "$R/$tag.out") rows; base $(grep '^| base ' "$R/$tag.out" | cut -c1-120)"
}
sweep app-seven "$P0/par-app-clean-seven" scripts/breakwatch/exams.json "$APP" --picw 0.5
sweep app-night "$P0/par-app-clean-night" scripts/breakwatch/exams-night.json "$APP" --picw 0.5
sweep app-1104 "$P0/par-app-clean-1104" scripts/breakwatch/exams-1104.json "$APP" --picw 0.5
until grep -q "phase 0 done" scripts/doctor/out/redesign-20261107/phase0.log 2>/dev/null; do sleep 60; done
sweep ext-seven "$P0/par-ext-clean-seven" scripts/breakwatch/exams.json "$EXT" --picw 0.75 --notext
sweep ext-night "$P0/par-ext-clean-night" scripts/breakwatch/exams-night.json "$EXT" --picw 0.75 --notext
sweep ext-1104 "$P0/par-ext-clean-1104" scripts/breakwatch/exams-1104.json "$EXT" --picw 0.75 --notext
say "phase 1 done"
