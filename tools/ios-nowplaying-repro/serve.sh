#!/usr/bin/env bash
# Two static servers on two ports, so the two repro apps are two origins (docs/ios-now-playing.md).
# Runs from Git Bash on Windows or any shell with python; Ctrl-C stops both.
set -e
cd "$(dirname "$0")"
PY=python3; command -v python3 >/dev/null 2>&1 || PY=python
IP=$($PY -c "import socket; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('10.255.255.255', 1)); print(s.getsockname()[0])" 2>/dev/null || echo "<this PC's LAN address>")
( cd app-a && $PY -m http.server 8472 --bind 0.0.0.0 >/dev/null 2>&1 ) &
A=$!
( cd app-b && $PY -m http.server 8473 --bind 0.0.0.0 >/dev/null 2>&1 ) &
B=$!
trap 'kill $A $B 2>/dev/null' EXIT INT TERM
echo "Add each to the phone's home screen from Safari, on the home Wi-Fi:"
echo "  Repro A (plays a tone):  http://$IP:8472/"
echo "  Repro B (a heading):     http://$IP:8473/"
echo "If the phone cannot reach them, allow python through the Windows firewall for the private network. Ctrl-C stops both."
wait
