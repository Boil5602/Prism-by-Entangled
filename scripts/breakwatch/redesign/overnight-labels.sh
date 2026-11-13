#!/bin/bash
# Labels through the night on this PC's own Claude Code sign-in (2026-11-10, asked for labelling that goes on by itself until morning
# with no idle hours). Every kept hour of the named days that has half an hour of frames or more and no label folder yet is labelled:
# the labeller's dry run writes the sheets, scripts/doctor/answer-sheets.sh has Claude Code sessions answer them, the labeller's answers
# mode builds the marks. The windows of one hour run side by side. When a day's hours are done its marks are merged into the day's
# labels.json (the file is backed up first) and the promos of each window that got new marks are sorted the same way (labels.promos.json
# backed up first). No key is used and nothing is sent to the labeller's paid route.
#
#     bash scripts/breakwatch/redesign/overnight-labels.sh [--until=07:30] [--dry] <day> [<day> ...]
#
# Days are worked in the order given. No new hour starts after --until. An hour whose sheets are left with no good answer (a sign-in at
# its limit, a lost connection) is tried three times a quarter of an hour apart, then left for a later run: its answer files stay, so a
# later run asks only for the sheets still missing. A second run while one holds the lock does nothing. --dry prints the hours it would do.
cd /c/Projects/prism
export PYTHONUTF8=1
UNTIL=07:30; DRY=0; DAYS=()
for a in "$@"; do case "$a" in --until=*) UNTIL=${a#*=};; --dry) DRY=1;; 20??-??-??) DAYS+=("$a");; esac; done
[ ${#DAYS[@]} -eq 0 ] && { echo "usage: overnight-labels.sh [--until=07:30] [--dry] <day> [<day> ...]"; exit 2; }
G="$(cygpath -m "$LOCALAPPDATA")/Prism/diagnostics/golden"; O=scripts/doctor/out; LOG="$O/overnight-labels.log"
WINS=(screen youtube-tv-home-16x9-XL youtube-tv-home-16x9-XL-w2)
say() { echo "$(date '+%F %H:%M:%S') $*" | tee -a "$LOG"; }
END=$(date -d "$UNTIL" +%s); [ "$END" -le "$(date +%s)" ] && END=$(date -d "tomorrow $UNTIL" +%s)
late() { [ "$(date +%s)" -ge "$END" ]; }
if [ "$DRY" = 0 ]; then
  if ! mkdir "$O/overnight-labels.lock" 2>/dev/null; then say "another run holds the lock; nothing done"; exit 0; fi
  trap 'rmdir "$O/overnight-labels.lock" 2>/dev/null' EXIT
  say "start: ${DAYS[*]} until $UNTIL"
fi

span() { if [ "$1" = 23 ]; then echo "--from=23:00:00 --to=23:59:59"; else echo "--from=$1:00:00 --to=$(printf %02d $((10#$1 + 1))):00:00"; fi; }
hour() {   # day window hour
  local day=$1 w=$2 h=$3 OUT="$O/label-$1-$2-${3}0000" try
  [ -s "$OUT/sheets.json" ] || node scripts/doctor/label.mjs "$day" "$w" $(span "$h") --out="$OUT" --dry > "$OUT.log" 2>&1
  for try in 1 2 3; do
    if bash scripts/doctor/answer-sheets.sh label "$OUT" >> "$OUT.log" 2>&1; then
      node scripts/doctor/label.mjs "$day" "$w" $(span "$h") --out="$OUT" --answers="$OUT" >> "$OUT.log" 2>&1; break
    fi
    say "  $day $w $h: sheets left with no good answer (try $try)"
    late && break; [ "$try" -lt 3 ] && sleep 900
  done
  if [ -s "$OUT/labels.model.json" ]; then say "  $day $w $h: $(tail -1 "$OUT.log" | cut -c1-150)"; else say "  $day $w $h: NOT labelled (see $OUT.log)"; fi
}

for day in "${DAYS[@]}"; do
  NEW=()
  for h in 00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23; do
    late && break
    TODO=()
    for w in "${WINS[@]}"; do
      [ -s "$O/label-$day-$w-${h}0000/labels.model.json" ] && continue
      n=$(ls "$G/$day/$w" 2>/dev/null | awk -v p="$h" '/\.gray$/ && substr($0, 1, 2) == p' | wc -l)
      [ "$n" -ge 1800 ] && TODO+=("$w")
    done
    [ ${#TODO[@]} -eq 0 ] && continue
    if [ "$DRY" = 1 ]; then echo "$day $h: ${TODO[*]}"; continue; fi
    say "$day $h:00 in ${#TODO[@]} windows"
    for w in "${TODO[@]}"; do hour "$day" "$w" "$h" & done
    wait
    for w in "${TODO[@]}"; do [ -s "$O/label-$day-$w-${h}0000/labels.model.json" ] && NEW+=("$w"); done
  done
  [ "$DRY" = 1 ] && continue
  if [ ${#NEW[@]} -eq 0 ]; then say "$day: no new hour"; continue; fi
  STAMP=$(date +%m%d%H%M)
  [ -s "$G/$day/labels.json" ] && cp "$G/$day/labels.json" "$G/$day/labels.before-night-$STAMP.json"
  say "$day: merging $(python -I scripts/doctor/merge-labels.py "$day" 2>&1 | tail -1 | cut -c1-200)"
  [ -s "$G/$day/labels.promos.json" ] && cp "$G/$day/labels.promos.json" "$G/$day/labels.promos.before-night-$STAMP.json"
  for w in $(printf '%s\n' "${NEW[@]}" | sort -u); do
    PS="$O/promosheets-$day-$w-night$STAMP"
    node scripts/doctor/promos.mjs "$day" --windows=$w --sheets --out="$PS" > "$PS.log" 2>&1
    if bash scripts/doctor/answer-sheets.sh promos "$PS" >> "$PS.log" 2>&1; then
      node scripts/doctor/promos.mjs "$day" --windows=$w --out="$PS" --answers="$PS" >> "$PS.log" 2>&1
      say "$day $w promos: $(grep '^\[promos\]' "$PS.log" | tail -1 | cut -c1-160)"
    else say "$day $w promos: sheets left with no good answer; the window keeps the promos it had (see $PS.log)"; fi
  done
  late && { say "$UNTIL reached after $day"; break; }
done
[ "$DRY" = 0 ] && say "done"
