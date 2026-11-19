#!/bin/bash
# Two studies in a row (2026-11-15), one heavy job at a time, an idle sampler stopped while they run and started again at the end.
# 1. striptest.py for the three channels the strip survey found (The Weather Channel row 163, FS2 row 166, CBS Sports Network
#    row 166), two labelled half hours each, with the twelve-day control model.
# 2. The quicker caption inputs again on a second split of the channels (5 groups held out in place of 8): the control and
#    CAPQUICK=1, so the gain of capquick-20261115.sh is read on channels held out in other company. Nothing ships.
cd /c/Projects/prism || exit 1
G="$LOCALAPPDATA/Prism/diagnostics/golden"
R=scripts/doctor/out/retrain-20261115
LOG="$R/pipeline.log"
W="$LOCALAPPDATA/Prism/diagnostics/picstudy/striptest-work"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
( while true; do powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*sampler.mjs*--idle*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" > /dev/null 2>&1; sleep 120; done ) &
GUARD=$!
strip() {   # name day window from to row
  say "strip test $1 ($2 $3 $4-$5, row $6)"
  PROMOS=show python scripts/breakwatch/striptest.py "$2" "$3" "$4" "$5" "$6" "$R/control.json" "$W" > "$R/striptest-$1.txt" 2>&1
  tail -6 "$R/striptest-$1.txt" | cut -c1-220 | tee -a "$LOG"
}
strip weather-1109 2026-11-09 youtube-tv-home-16x9-XL 01:32:24 02:03:22 163
strip weather-1112 2026-11-12 screen 22:31:17 23:03:00 163
strip fs2-1108 2026-11-08 youtube-tv-home-16x9-XL 14:19:52 14:50:50 166
strip fs2-1113 2026-11-13 screen 05:15:10 05:46:53 166
strip cbssn-1108 2026-11-08 screen 15:54:37 16:25:42 166
strip cbssn-1113 2026-11-13 youtube-tv-home-16x9-XL 06:30:34 07:01:46 166
say "strip tests done"
PALCOLS=pal_f,pal_j,pal_pod,pal_since,pal_blind,pal_mean
DAYS9=(); for day in 2026-10-07 2026-10-08 2026-11-04 2026-11-05 2026-11-06 2026-11-07 2026-11-08 2026-11-09 2026-11-10 2026-11-11 2026-11-12 2026-11-13; do DAYS9+=(--day "$R/feat/feat_$day.csv" "$G/$day"); done
for run in control5 capquick5; do
  say "training $run (twelve days, CLOCK=1, 5 groups held out, the exams)"
  Q=0; [ "$run" = capquick5 ] && Q=1
  env CLOCK=1 CAPQUICK=$Q GROUPS=5 AHEAD=3,5,8 EXTRA_SKIP="$PALCOLS" python scripts/breakwatch/train2.py "${DAYS9[@]}" --only "$R/trained.json" --inset-ads "NFL Network" \
    --exams "$R/exams-all.json" --export "$R/$run.json" "$R/$run-parity.csv" > "$R/train-$run.txt" 2>&1
  grep -E "^ALL|^RANK|^   ALL|look-ahead +[0358] s|exported model" "$R/train-$run.txt" | cut -c1-220 | tee -a "$LOG"
done
kill $GUARD 2> /dev/null
say "strips and split5 done"
schtasks //run //tn "Prism break-watch idle sampler" > /dev/null 2>&1; say "idle sampler started again"
