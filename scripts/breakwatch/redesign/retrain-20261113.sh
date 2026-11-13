#!/bin/bash
# The retrain of 2026-11-12 again (2026-11-13): the same eleven days, with the whole of 2026-11-12 (that run had it to mid
# morning) and the half hours labelled in the night. The same two runs of train2.py on the same recipe, the same exams, the
# channels held out in 8 groups. The measure is each run against its row of 2026-11-12 (retrain-20261112).
# It waits for the night's sampler and stops an idle sampler while it runs (a training never runs beside a recording); the idle
# sampler is started again at the end. Nothing ships.
cd /c/Projects/prism
export PROMOS=show PYTHONUTF8=1
D="$(cygpath -m "$LOCALAPPDATA")/Prism/diagnostics"; G="$D/golden"
F=scripts/doctor/out/train-recent-ad-20261105; N=scripts/doctor/out/promo-retrain; L=scripts/doctor/out/lowchannels-20261107
R=scripts/doctor/out/retrain-20261113; mkdir -p "$R/pal" "$R/feat"
LOG="$R/pipeline.log"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
PY="$HOME/.prism/cnn-venv/Scripts/python"
NEW=(2026-11-08 2026-11-09 2026-11-10 2026-11-11 2026-11-12)
WINS=(screen youtube-tv-home-16x9-XL youtube-tv-home-16x9-XL-w2)
PALCOLS=pal_f,pal_j,pal_pod,pal_since,pal_blind,pal_mean
samplers() { powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*sampler.mjs*' -and \$_.CommandLine -notlike '*--idle*' }).Count" | tr -d '\r'; }
say "waiting for the night's sampler"
while [ "$(samplers)" != "0" ]; do sleep 60; done
( while true; do powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*sampler.mjs*--idle*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" > /dev/null 2>&1; sleep 120; done ) &
GUARD=$!; trap 'kill $GUARD 2>/dev/null' EXIT

for day in "${NEW[@]}"; do
  if { [ $day != 2026-11-12 ] || [ "$ONLY" = palette ]; } && [ -s "$N/feat_$day.csv" ]; then say "features $day: kept"; continue; fi   # 2026-11-12 is read again, whole
  say "replay $day"; bash scripts/doctor/out/replay-day.sh $day; say "$(tail -1 "$N/pipeline.log")"
done
H0=$(head -1 "$N/feat_2026-11-07.csv" | tr -d '\r')
for day in "${NEW[@]}"; do
  [ "$(head -1 "$N/feat_$day.csv" | tr -d '\r')" = "$H0" ] || { say "STOP: the readings of $day differ from the older days' (the bench has new columns); the older days need a replay"; exit 1; }
done

say "palette columns"
for day in "${NEW[@]}"; do for w in "${WINS[@]}"; do
  [ -s "$G/$day/$w/events.log" ] && "$PY" -I scripts/breakwatch/palfeat.py build $day $w "$R/pal/$day-$w.csv" 2>&1 | tail -1 | tee -a "$LOG"
done; done
python - "$R" "$F" "$N" <<'EOF' 2>&1 | tee -a "$LOG"
import csv, io, os, sys
import numpy as np
R, F, N = sys.argv[1:4]
COLS = ["pal_f", "pal_j", "pal_pod", "pal_since", "pal_blind", "pal_mean"]
src = {"2026-10-07": F, "2026-10-08": F, "2026-11-04": F, "2026-11-05": N, "2026-11-06": N, "2026-11-07": N, "2026-11-08": N, "2026-11-09": N, "2026-11-10": N, "2026-11-11": N, "2026-11-12": N}
for day, folder in src.items():
    pal = {}
    for fn in os.listdir(os.path.join(R, "pal")):
        if fn.startswith(day + "-") and fn.endswith(".csv"):
            a = np.loadtxt(os.path.join(R, "pal", fn), delimiter=",", skiprows=1, ndmin=2)
            if len(a): pal[fn[len(day) + 1:-4]] = a
    n = hit = 0
    with io.open(os.path.join(folder, f"feat_{day}.csv"), newline="", encoding="utf-8") as fi, io.open(os.path.join(R, "feat", f"feat_{day}.csv"), "w", newline="", encoding="utf-8") as fo:
        rd = csv.reader(fi); wr = csv.writer(fo); wr.writerow(next(rd) + COLS)
        for row in rd:
            add = ["-1"] * len(COLS); a = pal.get(row[0])
            if a is not None:
                t = float(row[1]); k = int(np.searchsorted(a[:, 0], int(t)))
                for q in (k, k - 1):
                    if 0 <= q < len(a) and abs(a[q, 0] - t) <= 1.5: add = ["%g" % v for v in a[q, 1:]]; hit += 1; break
            wr.writerow(row + add); n += 1
        fo.close()
    print(f"feat_{day}: {n} rows, {hit} with a palette")
EOF

# the trained spans: the six days' as before, and every reviewed span of the five later days (the exams' seconds train nothing: --exams)
# the palette half trains on the spans the control half wrote (labels made between the two halves train neither)
[ "$ONLY" = palette ] && [ -s "$R/trained.json" ] || python -I - "$R" <<'EOF' 2>&1 | tee -a "$LOG"
import json, io, os, sys
R = sys.argv[1]; G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
t = json.load(io.open("scripts/doctor/out/lowchannels-20261107/trained+low.json", encoding="utf-8"))
for day in ("2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"):
    lab = json.load(io.open(os.path.join(G, day, "labels.json"), encoding="utf-8"))
    t[day] = {w: v["reviewed"] for w, v in lab["windows"].items() if v.get("reviewed")}
f = io.open(os.path.join(R, "trained.json"), "w", encoding="utf-8"); f.write(json.dumps(t)); f.close()
ex = []
for n in ("exams-sound", "exams-sound2", "exams-sound-sampled-all", "exams-sound2-sampled"):
    for k, e in enumerate(json.load(io.open(f"scripts/breakwatch/{n}.json", encoding="utf-8"))):
        e = dict(e); e["name"] = f"{e['day'][-5:]} {e['window'][-6:]} {e['from'][:2]}"; ex.append(e)
f = io.open(os.path.join(R, "exams-all.json"), "w", encoding="utf-8"); f.write(json.dumps(ex)); f.close()
print("trained spans:", {d: {w[-6:]: len(s) for w, s in v.items()} for d, v in t.items() if d >= "2026-11-08"}, "| exams:", len(ex))
EOF

DAYS9=(); for day in 2026-10-07 2026-10-08 2026-11-04 2026-11-05 2026-11-06 2026-11-07 "${NEW[@]}"; do DAYS9+=(--day "$R/feat/feat_$day.csv" "$G/$day"); done
run() {  # tag, extra skip
  say "training $1 (eleven days, CLOCK=1, 8 groups held out, the exams, look-ahead 3/5/8 s)"
  env CLOCK=1 GROUPS=8 AHEAD=3,5,8 EXTRA_SKIP="$2" python scripts/breakwatch/train2.py "${DAYS9[@]}" --only "$R/trained.json" --inset-ads "NFL Network" \
    --exams "$R/exams-all.json" --export "$R/$1.json" "$R/$1-parity.csv" > "$R/train-$1.txt" 2>&1
  grep -E "^ALL|^RANK|^   ALL|look-ahead +[0358] s|exported model" "$R/train-$1.txt" | cut -c1-220 | tee -a "$LOG"
}
# ONLY=control or ONLY=palette runs one half (the control in the evening, the palette after the night's sampler); with neither, both
[ "$ONLY" = palette ] || run control "$PALCOLS"
[ "$ONLY" = control ] || run palette ""
say "pipeline done"
schtasks //run //tn "Prism break-watch idle sampler" > /dev/null 2>&1; say "idle sampler started again"
