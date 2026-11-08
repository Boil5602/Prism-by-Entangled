# WebView2 tile-switching POC — DRM playback report

POC app: `prototypes/webview2-poc` (WPF, .NET 8, Evergreen WebView2 runtime).
Run: `dotnet run -c Release` in that folder (or the built exe under
`bin/Release/net8.0-windows/`).

Two WebView2 tiles — Netflix left, Hulu right — each with its own persistent
user-data folder (`%LOCALAPPDATA%\PrismWebView2Poc\{netflix,hulu}`), so
sign-ins survive restarts. "Netflix hero" / "Hulu hero" grow one tile to
~75 % width; "Swap" toggles. The status strip shows each tile's URL plus the
EME probe: `navigator.requestMediaKeySystemAccess` for
`com.microsoft.playready.recommendation` (robustness `3000` → HW_SECURE_ALL,
`2000` → SW_SECURE_DECODE) and `com.widevine.alpha`.

## Manual protocol (fill in as you go)

### 1. Sign-in persistence
- [ ] Signed into Netflix, signed into Hulu
- [ ] Restarted the app
- Both still signed in: **YES / NO** — notes: ____

### 2. Playback + stats
- Netflix title played: ____
- Stats overlay (Ctrl+Alt+Shift+D) — playing resolution: ____ — bitrate: ____
- Hulu title played: ____

### 3. Hero swaps while BOTH playing (×10)
- Playback continues in the shrunken tile: **YES / NO**
- Black frames: ____  Stalls: ____  DRM errors: ____  Re-buffering on resize: ____

### 4. Window resize while playing
- Same observations: ____

### 5. Simultaneous audio
- Both audible at once, no crash: **YES / NO** — notes: ____

### Errors (only if a service refuses to play)
- On-screen error code (Netflix M7xxx is diagnostic): ____
- Console output: ____

## Result

Netflix in WebView2: PLAYS / FAILS — resolution: ____ — robustness: ____
Hulu in WebView2:    PLAYS / FAILS — resolution: ____ — robustness: ____
Hero switching while playing: CLEAN / GLITCHY / BREAKS — notes: ____
