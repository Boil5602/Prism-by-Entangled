#!/bin/bash
# Phase 1 sweeps, second pass (2026-11-08): sure_ad off, grid thresholds above off, the soft refractory, the filter with grid-peaked
# end hazards and the hard off; the extension's model with the agreement rule forced on as the bench ran it.
cd /c/Projects/prism
export PROMOS=show
P0=scripts/doctor/out/redesign-20261107/phase0; R=scripts/doctor/out/redesign-20261107/phase1b; mkdir -p "$R"
LOG=scripts/doctor/out/redesign-20261107/phase1b.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python.exe"
APP=scripts/doctor/out/lowchannels-20261107/low-6d-agree.json
EXT=scripts/doctor/out/clock-20261106/hold4.json
sweep() { local tag=$1 par=$2 ex=$3 model=$4; shift 4; say "sweep $tag"; WORKERS=4 "$PY" -I scripts/breakwatch/boundary.py "$par" "$ex" "$model" "$R/$tag" "$@" > "$R/$tag.out" 2>&1; say "$tag: $(grep -c '^| ' "$R/$tag.out") rows; base $(grep '^| base ' "$R/$tag.out" | cut -c1-100)"; }
sweep app-seven "$P0/par-app-clean-seven" scripts/breakwatch/exams.json "$APP" --picw 0.5
sweep app-night "$P0/par-app-clean-night" scripts/breakwatch/exams-night.json "$APP" --picw 0.5
sweep app-1104 "$P0/par-app-clean-1104" scripts/breakwatch/exams-1104.json "$APP" --picw 0.5
sweep ext-seven "$P0/par-ext-clean-seven" scripts/breakwatch/exams.json "$EXT" --picw 0.75 --notext --agree
sweep ext-night "$P0/par-ext-clean-night" scripts/breakwatch/exams-night.json "$EXT" --picw 0.75 --notext --agree
sweep ext-1104 "$P0/par-ext-clean-1104" scripts/breakwatch/exams-1104.json "$EXT" --picw 0.75 --notext --agree
say "phase 1b done"
