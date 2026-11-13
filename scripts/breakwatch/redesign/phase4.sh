#!/bin/bash
# Boundary-first redesign, Phase 4 (2026-11-08): three retrains of the clean two-channel recipe at idle, one after another, each
# exported and parity-checked, then each judged on the bench (seven exams + ordinary evening, app and extension models) after all three
# trained, so training and the bench never run together. Waits for Phase 0's last bench run; pauses around the doctor's 06:15 run.
cd /c/Projects/prism
export PROMOS=show
export BWEXE="$(cygpath -w "$PWD/scripts/breakwatch/bwtest/bin/Release-redesign/bwtest.exe")"
R=scripts/doctor/out/redesign-20261107/phase4; mkdir -p "$R"
LOG=scripts/doctor/out/redesign-20261107/phase4.log
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python.exe"
APP=scripts/doctor/out/lowchannels-20261107/low-6d-agree.json
EXT=scripts/doctor/out/clock-20261106/hold4.json
doctor_pause() { local h; h=$(date +%H%M); if [ "$h" -ge 0605 ] && [ "$h" -le 0645 ]; then say "pausing for the doctor's run"; while [ "$(date +%H%M)" -le 0645 ]; do sleep 60; done; fi; }
say "waiting for phase 0"
until grep -q "phase 0b done" scripts/doctor/out/redesign-20261107/phase0b.log 2>/dev/null; do sleep 60; done
while tasklist //FI "IMAGENAME eq bwtest.exe" 2>/dev/null | grep -qi bwtest; do sleep 30; done
train() { # $1 tag, then env switches
  local tag=$1; shift; local O="$R/$tag"; mkdir -p "$O"
  doctor_pause
  say "training $tag ($*)"
  env "$@" PROMOS=show EPOCHS=10 CAP=200000 "$PY" scripts/breakwatch/cnn.py train "$O" > "$O/train.log" 2>&1
  say "$tag trained: $(grep -i 'auc' "$O/train.log" | tail -1 | cut -c1-160)"
  env "$@" "$PY" scripts/breakwatch/cnn.py export "$O" > "$O/export.log" 2>&1
  say "$tag parity: $(scripts/breakwatch/bwtest/bin/Release-redesign/bwtest.exe picparity "$(cygpath -w "$PWD/$O/picture-net.json")" "$(cygpath -w "$PWD/$O/picture-net-parity.json")" 2>&1 | tail -1)"
}
train 4a-maskcorners MASKCORNERS=1
train 4b-cornerswap CORNERSWAP=1
train 4c-cornerswap-ticker CORNERSWAP=1 TICKER=1
judge() { # $1 tag $2 exams-file $3 set-name $4 model $5 net, then switches
  local tag=$1 ex=$2 set=$3 model=$4 net=$5; shift 5
  doctor_pause
  say "judge $tag $set"
  python scripts/breakwatch/run_exams.py --gentle --exams "$ex" --model "$model" --results "$R/$tag-$set.json" BANDLOGO=1 BANDSTRICT=0 PICNET="$(cygpath -w "$PWD/$net")" AGREE=1 "$@" 2>&1 \
    | grep -v "looks a minute" | head -1 | sed 's/.*ads covered/ads covered/' | sed 's/| missed.*| pop-ups/| pop-ups/' | tee -a "$LOG"
}
for v in 4a-maskcorners 4b-cornerswap 4c-cornerswap-ticker; do
  N="$R/$v/picture-net.json"; [ -f "$N" ] || { say "$v: no network"; continue; }
  judge "app-$v" scripts/breakwatch/exams.json seven "$APP" "$N" PICW=0.5
  judge "app-$v" scripts/breakwatch/exams-night.json night "$APP" "$N" PICW=0.5
  judge "ext-$v" scripts/breakwatch/exams.json seven "$EXT" "$N" PICW=0.75 NOTEXT=1
  judge "ext-$v" scripts/breakwatch/exams-night.json night "$EXT" "$N" PICW=0.75 NOTEXT=1
done
say "phase 4 done"
