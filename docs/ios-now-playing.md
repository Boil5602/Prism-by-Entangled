# iOS: the Now Playing control and two home-screen web apps

Status 2026-10-28: open on Apple's side, closed on ours (B-446). This page holds the mechanism, what was
tried, the phone test plan with a results column, text ready to paste into the bug report and a Feedback
Assistant report, and what a real fix looks like.

## The symptom

An iPhone on iOS 27 with two home-screen web apps installed, Prism's companion app and another web app.
While Prism plays sound, tapping the Now Playing control (the pill at the top of the home screen, or the
title on the lock screen) opens whichever web app was in front last, not Prism. The control's own buttons
act on Prism correctly; only the tap on the title is misrouted. Music and video streams behave the same,
in both of Prism's sound modes.

Note on versions: since iOS 26 WebKit reports a frozen `CPU iPhone OS 18_7` in every page's user agent, so
Prism's log and any analytics show 18.7 for a phone on iOS 27.

## The mechanism, in plain words

When a page starts playing, WebKit tells the media system which process is presenting the page, before it
registers the page as Now Playing (`MediaSessionHelperIOS::providePresentingApplicationPID`; WebKit bugs
194504 and 243481). For a home-screen web app that process belongs to the system's web app host, bundle id
`com.apple.webapp`, and every web app on the phone shares that bundle id. A tap on the Now Playing title
resolves to the bundle id, and SpringBoard activates that host's most recently used scene. Nothing from the
page reaches that step: not the manifest, its `id` or `scope`, not the Media Session metadata, not the
legacy `apple-mobile-web-app` tags. The buttons work because commands go to the registered process; the
title tap misroutes because it goes through the bundle id.

The fix for WebKit bug 243481 (2022) covers in-app Safari views by passing the host app's identity. It did
not reach home-screen web apps, which all have the same host.

## Tried, each followed by removing the icon and adding it again

iOS reads the manifest only at install. None of these changed anything.

1. An explicit `id` in Prism's manifest (`prism-companion`).
2. An explicit `id` in the other app's manifest too, verified in the live served JSON, with the build,
   the manifest link and the service worker checked so no stale copy could be served.
3. Prism registered by the manifest alone, the legacy `apple-mobile-web-app-capable` and `-title` tags
   removed, the other app keeping its tags. It still installed full screen. The tags are back.
4. Both apps removed and added again, Prism last, so the most recent install and the most recent open
   were Prism.
5. Both sound modes, a music stream and a video stream.

Ruled out: the Media Session side (metadata, art, position, buttons all reach iOS and act on Prism);
pairing, networking and the page's state; cached manifests.

The workaround on WebKit bug 267810 (comment of 2026-10-15: an explicit manifest `id` fixed it for two
apps on sibling subdomains of one site) is a same-site case. It does not apply to unrelated origins, which
matches the result here. The iOS 27 NowPlaying framework is a Swift layer for native apps over the same
daemon WebKit already talks to through MediaRemote; it changes nothing for a page.

## What Prism does about it

- **The escape hatch** (phone page, installed on an iPhone): a one-time note on the Music tab says the
  Now Playing title can open a different web app and offers *Open in Safari*. Safari owns its own sound,
  so from a Safari tab the control opens Safari. The note shows the paired address with a Copy button (the
  selection's copy through execCommand, since the clipboard API needs https and the home network has
  not) to paste into Safari. There is no Open in Safari button: Safari's scheme exists only for https
  (`x-safari-https`); `x-safari-http` is refused as an invalid address (tried 2026-10-28, from script and
  from a link), and the page is http. A one-tap route would be a tiny https page on the public site that
  forwards to the address carried in its fragment, which never leaves the phone. Decision 2026-10-28: not
  built, since the tap would need the internet while the page and the address are on the home network
  alone, and copy and paste works with the home offline. *Not now*
  remembers the dismissal on the phone. Installed-mode
  detection is `navigator.standalone` or the standalone display mode; the iPhone check is by platform
  and touch points, never by the user agent version.
- **Picture in Picture test** (phone page, under the options, off by default): with the switch on, the
  sound leaves through a `<video>` element instead of `<audio>`, and a button on the Private Listening
  tab asks the phone for its Picture in Picture window, whose return button is bound to the page's own
  scene rather than the host's bundle id. The stream has no video track, so the phone may offer no
  window; the note under the button says so. The follow-up, a canvas stream with the audio track
  attached, is not built.
- **The repro** in `tools/ios-nowplaying-repro/`: two static pages, Repro A (plays a quiet tone with
  Media Session metadata) and Repro B (a heading), served on two ports by `serve.sh`, so the bug can be
  shown with nothing of Prism's involved.

## Phone test plan

Fill in the last column. Prism's phone page is the paired address on port 8471; the repro pages come from
`serve.sh`.

| Step | Setup | Do | Expected | Result |
|---|---|---|---|---|
| a | Repro A and Repro B installed; Prism and the other app closed | Play A, open B, tap the pill | B opens: the bug with two static pages | |
| b | As a | Play A, open B, swipe B away in the app switcher, tap the pill | Tells whether SpringBoard remembers a last web app without a running process | |
| c | Prism open in a Safari tab, not installed; the other app installed | Play in Prism, open the other app, tap the pill | Safari opens (validates the escape hatch) | |
| d | Prism installed; the other app added again with "Open as Web App" off (iOS 26 and later) | Play in Prism, open the other app, tap the pill | Prism opens, the only web app | |
| e | Prism installed, the Picture in Picture test on | Listen, press Picture in Picture, put the page away, press the window's return button | Prism opens, if the phone offered a window at all | |

## Ready to paste

### A comment for WebKit bug 267810

> Reproduced on iOS 27 with two home-screen web apps on unrelated origins: one over plain http on a home
> network (a LAN address with a port), one over https on its own domain. Tapping the Now Playing title
> while the first plays opens whichever web app was in front last. The explicit manifest "id" from the
> comment of 2026-10-15 did not help here, with an id on both apps and both reinstalled; neither did
> registering the playing app by the manifest alone (no apple-mobile-web-app-capable tag), nor the order
> of installation. The buttons on the control act on the right app; only the title tap misroutes. That
> fits the title tap resolving to the shared host bundle id (com.apple.webapp) and SpringBoard restoring
> the host's last scene, while commands go to the registered process. Note the user agent on this phone
> reports "CPU iPhone OS 18_7" (frozen since iOS 26), so logs will show 18.7. Minimal repro, two static
> pages served on two ports: <links>.

### A Feedback Assistant report

> Title: Now Playing title tap opens the wrong home-screen web app when more than one is installed
>
> On iOS 27, with two home-screen web apps installed, tapping the Now Playing title (home-screen pill or
> lock screen) while one of them plays audio opens the web app most recently in front, not the one
> playing. The control's buttons reach the right page. Reproduces with two static pages (attached) on
> unrelated origins; a manifest "id" on both makes no difference. References rdar://121728060 and WebKit
> bug 267810. Please look at how mediaremoted and SpringBoard resolve a Now Playing launch for
> com.apple.webapp: the launch appears to go to the host bundle id and restore its last scene rather than
> the scene whose process registered as Now Playing. A sysdiagnose taken right after a misroute is
> attached.

## What a real fix looks like

A thin native shell for Prism's companion, a bare WKWebView app or a Capacitor project, gives WebKit a
host of its own with a unique bundle id, so the Now Playing title opens the shell. The page needs nothing
new: the shell loads the paired address, forwards the Media Session as it does today, and keeps the
sound alive in the background through the app's audio session. The work is about a day for a first
build once a Mac with Xcode is at hand: the project, the audio session category, the pairing address
handed in once, an icon, and a TestFlight upload, which needs an Apple developer account; sideloading
with a free account means re-signing every seven days. Not built: new app-side features wait until the
box exists.
