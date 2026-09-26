#!/usr/bin/env bash
# Sample system load once a second into a CSV while a run is in progress.
# Columns: ts, cpu_total_pct, chromium_cpu_pct, mem_used_mb, gpu (Pi: vcgencmd
# clock/throttle; else "n/a"), temp_c
out="${1:-load.csv}"
echo "ts,cpu_total_pct,browser_cpu_pct,mem_used_mb,gpu_mhz,throttled,temp_c" > "$out"
prev_idle=0; prev_total=0
while true; do
  read -r _ user nice system idle iowait irq softirq steal _ < /proc/stat
  total=$((user+nice+system+idle+iowait+irq+softirq+steal))
  didle=$((idle-prev_idle)); dtotal=$((total-prev_total)); prev_idle=$idle; prev_total=$total
  cpu=0; [ "$dtotal" -gt 0 ] && cpu=$(( (100*(dtotal-didle))/dtotal ))
  bcpu=$(ps -C chromium,chromium-browser,chrome,google-chrome -o %cpu= 2>/dev/null | awk '{s+=$1} END {printf "%.0f", s}')
  mem=$(free -m | awk '/Mem:/ {print $3}')
  if command -v vcgencmd >/dev/null 2>&1; then
    gpu=$(( $(vcgencmd measure_clock v3d 2>/dev/null | cut -d= -f2) / 1000000 ))
    thr=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)
    temp=$(vcgencmd measure_temp 2>/dev/null | tr -dc '0-9.')
  else
    gpu="n/a"; thr="n/a"; temp=$(awk '{printf "%.1f", $1/1000}' /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "n/a")
  fi
  echo "$(date +%s),$cpu,${bcpu:-0},$mem,$gpu,$thr,$temp" >> "$out"
  sleep 1
done
