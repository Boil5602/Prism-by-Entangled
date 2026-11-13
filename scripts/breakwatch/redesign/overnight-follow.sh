#!/bin/bash
# The night's own recording labelled as it is kept (2026-11-10, asked for labelling with no idle hours before morning). It waits for
# overnight-labels.sh to let go of its lock, then every quarter of an hour labels each hour of the named days that is whole (an hour
# of today counts once it ended 100 minutes ago, so the keeper has filed all of it), has half an hour of frames or more and has no
# label folder yet, the windows of an hour side by side, through scripts/doctor/answer-sheets.sh (no key). At --until the days' marks
# are merged (labels.json backed up first) and the promos of each window with marks are sorted once (labels.promos.json backed up first).
#
#     bash scripts/breakwatch/redesign/overnight-follow.sh [--until=07:00] <day> [<day> ...]
cd /c/Projects/prism
export PYTHONUTF8=1
UNTIL=07:00; DAYS=()
for a in "$@"; do case "$a" in --until=*) UNTIL=${a#*=};; 20??-??-??) DAYS+=("$a");; esac; done
[ ${#DAYS[@]} -eq 0 ] && { echo "usage: overnight-follow.sh [--until=07:00] <day> [<day> ...]"; exit 2; }
G="$(cygpath -m "$LOCALAPPDATA")/Prism/diagnostics/golden"; O=scripts/doctor/out; LOG="$O/overnight-labels.log"
WINS=(screen youtube-tv-home-16x9-XL youtube-tv-home-16x9-XL-w2)
say() { echo "$(date '+%F %H:%M:%S') follow: $*" | tee -a "$LOG"; }
END=$(date -d "$UNTIL" +%s); [ "$END" -le "$(date +%s)" ] && END=$(date -d "tomorrow $UNTIL" +%s)
late() { [ "$(date +%s)" -ge "$END" ]; }
while [ -d "$O/overnight-labels.lock" ] && ! late; do sleep 60; done
if ! mkdir "$O/overnight-labels.lock" 2>/dev/null; then say "the first chain still holds the lock at $UNTIL; nothing done"; exit 0; fi
trap 'rmdir "$O/overnight-labels.lock" 2>/dev/null' EXIT
say "start: ${DAYS[*]} until $UNTIL"

span() { if [ "$1" = 23 ]; then echo "--from=23:00:00 --to=23:59:59"; else echo "--from=$1:00:00 --to=$(printf %02d $((10#$1 + 1))):00:00"; fi; }
hour() {   # day window hour
  local day=$1 w=$2 h=$3 OUT="$O/label-$1-$2-${3}0000"
  [ -s "$OUT/sheets.json" ] || node scripts/doctor/label.mjs "$day" "$w" $(span "$h") --out="$OUT" --dry > "$OUT.log" 2>&1
  if bash scripts/doctor/answer-sheets.sh label "$OUT" >> "$OUT.log" 2>&1; then
    node scripts/doctor/label.mjs "$day" "$w" $(span "$h") --out="$OUT" --answers="$OUT" >> "$OUT.log" 2>&1
  fi
  if [ -s "$OUT/labels.model.json" ]; then say "  $day $w $h labelled"; else say "  $day $w $h: NOT labelled yet (see $OUT.log)"; fi
}
while ! late; do
  did=0
  for day in "${DAYS[@]}"; do
    for h in 00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23; do
      late && break
      [ $(( $(date +%s) - $(date -d "$day $h:00:00" +%s) )) -lt 9600 ] && continue
      TODO=()
      for w in "${WINS[@]}"; do
        [ -s "$O/label-$day-$w-${h}0000/labels.model.json" ] && continue
        n=$(ls "$G/$day/$w" 2>/dev/null | awk -v p="$h" '/\.gray$/ && substr($0, 1, 2) == p' | wc -l)
        [ "$n" -ge 1800 ] && TODO+=("$w")
      done
      [ ${#TODO[@]} -eq 0 ] && continue
      say "$day $h:00 in ${#TODO[@]} windows"; did=1
      for w in "${TODO[@]}"; do hour "$day" "$w" "$h" & done
      wait
    done
  done
  [ "$did" = 0 ] && sleep 900
done
STAMP=$(date +%m%d%H%M)
for day in "${DAYS[@]}"; do
  ls -d "$O/label-$day-"*/ > /dev/null 2>&1 || continue
  [ -s "$G/$day/labels.json" ] && cp "$G/$day/labels.json" "$G/$day/labels.before-follow-$STAMP.json"
  say "$day: merging $(python -I scripts/doctor/merge-labels.py "$day" 2>&1 | tail -1 | cut -c1-200)"
  [ -s "$G/$day/labels.promos.json" ] && cp "$G/$day/labels.promos.json" "$G/$day/labels.promos.before-follow-$STAMP.json"
  for w in "${WINS[@]}"; do
    ls -d "$O/label-$day-$w-"??0000/ > /dev/null 2>&1 || continue
    PS="$O/promosheets-$day-$w-follow$STAMP"
    node scripts/doctor/promos.mjs "$day" --windows=$w --sheets --out="$PS" > "$PS.log" 2>&1
    if bash scripts/doctor/answer-sheets.sh promos "$PS" >> "$PS.log" 2>&1; then
      node scripts/doctor/promos.mjs "$day" --windows=$w --out="$PS" --answers="$PS" >> "$PS.log" 2>&1
      say "$day $w promos: $(grep '^\[promos\]' "$PS.log" | tail -1 | cut -c1-160)"
    else say "$day $w promos: sheets left with no good answer; the window keeps the promos it had (see $PS.log)"; fi
  done
done
say "done"
