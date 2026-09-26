#!/usr/bin/env bash
# Ubuntu 24.04 under WSLg (x86_64) - the same stack, for the compositor-mechanism
# half of the spike (questions 2 and 3). Google Chrome is used because it bundles
# a Widevine CDM on x86_64 Linux; Ubuntu's chromium is a snap (unusable here).
set -euo pipefail
sudo apt-get update
sudo apt-get install -y \
  cage labwc wlr-randr grim \
  python3 python3-gi gir1.2-gtk-3.0 gir1.2-gtklayershell-0.1 \
  python3-websocket python3-requests \
  mesa-utils libgl1-mesa-dri fonts-dejavu-core
if ! command -v google-chrome >/dev/null 2>&1; then
  tmp=$(mktemp -d)
  echo "Downloading Google Chrome stable (.deb, ~110 MB) from dl.google.com"
  curl -fsSL -o "$tmp/chrome.deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt-get install -y "$tmp/chrome.deb"
fi
echo "--- Chrome:"; google-chrome --version
echo "--- Widevine CDM:"; ls /opt/google/chrome/WidevineCdm/_platform_specific/linux_x64/ 2>/dev/null || echo "(component may download on first run: chrome://components)"
echo "--- Wayland: WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-none} XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-none}"
