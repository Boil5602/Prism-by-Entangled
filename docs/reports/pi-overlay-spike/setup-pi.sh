#!/usr/bin/env bash
# Raspberry Pi OS Bookworm (arm64) - install the spike stack.
# labwc is Pi OS Bookworm's default Wayland session; cage is the kiosk option.
# Widevine: Pi OS ships the CDM as the `libwidevinecdm0` package (the
# ChromeOS arm64 CDM repackaged) and Chromium loads it from
# /opt/WidevineCdm - no manual extraction needed.
set -euo pipefail
sudo apt-get update
sudo apt-get install -y \
  labwc cage wlr-randr grim \
  chromium chromium-browser libwidevinecdm0 \
  python3 python3-gi gir1.2-gtk-3.0 gir1.2-gtklayershell-0.1 \
  python3-websocket python3-requests \
  mesa-utils libgl1-mesa-dri

echo "--- Widevine CDM present?"
ls -la /opt/WidevineCdm/_platform_specific/linux_arm64/ 2>/dev/null || ls -la /usr/lib/chromium/WidevineCdm 2>/dev/null || echo "NOT FOUND - check: apt-cache policy libwidevinecdm0"
echo "--- Chromium"
chromium --version 2>/dev/null || chromium-browser --version
echo "--- session"
echo "Current Wayland session: ${XDG_SESSION_TYPE:-unknown} / ${WAYLAND_DISPLAY:-none}"
echo "If this is not a Wayland session, pick 'labwc' in raspi-config (Advanced > Wayland) and reboot."
