#!/bin/bash
# Addendum B3 (2026-11-08): the per-channel refractory, offline; then E2, the audit with 'cross' meaning another channel. No bench, no training.
cd /c/Projects/prism
export PROMOS=show
P0=scripts/doctor/out/redesign-20261107/phase0; R=scripts/doctor/out/redesign-20261107/phaseB3; mkdir -p "$R"
LOG=scripts/doctor/out/redesign-20261107/phaseB3.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python.exe"
APP=scripts/doctor/out/lowchannels-20261107/low-6d-agree.json; EXT=scripts/doctor/out/clock-20261106/hold4.json
sweep() { local tag=$1 par=$2 ex=$3 model=$4; shift 4; say "sweep $tag"; WORKERS=4 "$PY" -I scripts/breakwatch/boundary.py "$par" "$ex" "$model" "$R/$tag" --grid b3 "$@" > "$R/$tag.out" 2>&1; grep '^| ' "$R/$tag.out" | cut -c1-120 | tee -a "$LOG"; }
sweep app-seven "$P0/par-app-clean-seven" scripts/breakwatch/exams.json "$APP" --picw 0.5
sweep app-night "$P0/par-app-clean-night" scripts/breakwatch/exams-night.json "$APP" --picw 0.5
sweep ext-seven "$P0/par-ext-clean-seven" scripts/breakwatch/exams.json "$EXT" --picw 0.75 --notext --agree
sweep ext-night "$P0/par-ext-clean-night" scripts/breakwatch/exams-night.json "$EXT" --picw 0.75 --notext --agree
say "phase B3 done"
say "E2: the audit with cross = another channel"
mkdir -p scripts/doctor/out/redesign-20261107/phase5a/cross-channel
CROSS=channel NEAR=6 "$PY" -I scripts/breakwatch/repeat.py scripts/doctor/out/redesign-20261107/phase5a/cross-channel > scripts/doctor/out/redesign-20261107/phase5a/cross-channel/repeat.out 2>&1
grep -E "channels joined|^\{|unit repeats" scripts/doctor/out/redesign-20261107/phase5a/cross-channel/repeat.out | cut -c1-400 | tee -a "$LOG"
say "E2 done"
