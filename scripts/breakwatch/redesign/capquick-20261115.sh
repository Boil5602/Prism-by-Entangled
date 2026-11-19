#!/bin/bash
# A study of the late start (2026-11-15): the control run of retrain-20261115 again with four quicker caption inputs
# (CAPQUICK=1, bwfeatures.cap_quick: the last line, the mean of 4 s, the highest of 8 s, the lines in 8 s). The same twelve days,
# the same features files, the same trained spans and exams, the channels held out in 8 groups. The measure is its lines against
# the control's in train-control.txt: where the cover begins, the ads covered and the show wrongly covered. It stops an idle sampler
# while it runs (a training never runs beside a recording) and starts it again at the end. Nothing ships.
cd /c/Projects/prism || exit 1
G="$LOCALAPPDATA/Prism/diagnostics/golden"
R=scripts/doctor/out/retrain-20261115
LOG="$R/pipeline.log"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PALCOLS=pal_f,pal_j,pal_pod,pal_since,pal_blind,pal_mean
( while true; do powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*sampler.mjs*--idle*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" > /dev/null 2>&1; sleep 120; done ) &
GUARD=$!
DAYS9=(); for day in 2026-10-07 2026-10-08 2026-11-04 2026-11-05 2026-11-06 2026-11-07 2026-11-08 2026-11-09 2026-11-10 2026-11-11 2026-11-12 2026-11-13; do DAYS9+=(--day "$R/feat/feat_$day.csv" "$G/$day"); done
say "training capquick (twelve days, CLOCK=1, CAPQUICK=1, 8 groups held out, the exams, look-ahead 3/5/8 s)"
env CLOCK=1 CAPQUICK=1 GROUPS=8 AHEAD=3,5,8 EXTRA_SKIP="$PALCOLS" python scripts/breakwatch/train2.py "${DAYS9[@]}" --only "$R/trained.json" --inset-ads "NFL Network" \
  --exams "$R/exams-all.json" --export "$R/capquick.json" "$R/capquick-parity.csv" > "$R/train-capquick.txt" 2>&1
grep -E "^ALL|^RANK|^   ALL|look-ahead +[0358] s|exported model" "$R/train-capquick.txt" | cut -c1-220 | tee -a "$LOG"
kill $GUARD 2> /dev/null
say "capquick done"
schtasks //run //tn "Prism break-watch idle sampler" > /dev/null 2>&1; say "idle sampler started again"
