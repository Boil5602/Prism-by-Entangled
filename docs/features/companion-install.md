# Companion install prompt (iOS and Android)

Goal: a user who opens the companion in a phone browser gets a short,
dismissible nudge to put it on their Home Screen. No store, no profile,
no account.

## Installability
- Web app manifest: name "Prism", short_name "Prism", display
  "standalone", start_url "/" (or the companion's root), scope the
  companion's path, theme_color and background_color from the app's
  dark surface tokens, icons at 192 and 512 px plus a maskable 512.
- iOS head tags: apple-touch-icon (180 px), apple-mobile-web-app-capable,
  apple-mobile-web-app-status-bar-style "black-translucent",
  apple-mobile-web-app-title "Prism".
- Icons come from the existing static logo assets. Do not create new
  artwork; export sizes from what exists.
- Served over HTTPS where the companion already is; where it is LAN
  http, document that install still works on iOS but Web Push won't.

## Prompt behavior
- Show only when: running in a browser tab (not already installed:
  `display-mode: standalone` false and `navigator.standalone` false)
  AND on a phone-class device.
- iOS: an overlay anchored at the bottom with two steps: "Tap Share"
  (icon) → "Add to Home Screen". Detect Safari vs. other iOS browsers;
  for non-Safari iOS browsers show the same steps (they share the Share
  sheet) with the Share icon only.
- Android/Chromium: capture `beforeinstallprompt`, show one "Add Prism
  to Home Screen" button that calls `prompt()`. If the event never
  fires, show nothing.
- Timing: appears after the user has been on the page for 10 seconds or
  after a successful pairing, whichever is first. Never on first paint.
- Dismiss: "Not now" hides it for 14 days (localStorage). Installing
  hides it for good. "Don't show again" hides it for good.
- Copy, plain and short: "Add Prism to your Home Screen. It opens
  full-screen and stays signed in." Steps as above.
- Reduced motion: no slide-in animation.
- Nothing is sent anywhere. The prompt state lives in localStorage
  only (§22).

## Installed mode
- When running standalone, hide any browser-only chrome (the install
  prompt, "open in browser" hints) and use the safe-area insets for
  top and bottom padding.

## Non-goals
Web Push, the configuration-profile Web Clip route, desktop install.
