# Testing the PRISM extension in Safari from a Mac session (2026-11-21)

A Claude Code session on the macOS virtual machine tests the PRISM extension in Safari. The plan and the open questions are in
`docs/roadmap.md` (the Safari section). This page is how that session works. Read CLAUDE.md first; its rules hold on the Mac too.

## The machine

- An Intel Mac in VMware on the owner's Windows PC. Homebrew refuses Intel Macs: tools come from their own installers.
- Video with DRM (Netflix, Disney+, Max, likely Paramount+) does not play in the virtual machine. Test those only on a real Mac.
- No video playback on this machine (2026-11-21): it has no graphics acceleration, and YouTube in Safari locked the whole machine,
  again at each login as macOS reopened the tab. Leave video tests (item 3 below) for a real Mac. Close every video tab when done.
- The Windows PC has a session too. Work on the branch `safari-mac`, push it, and say what is on it. The Windows session merges.

## Two sessions, one extension (2026-11-22)

Both sessions change the extension. On 2026-11-21 they collided: both used version 0.9.50, both wrote B-498 to B-500 for
different bugs, and both changed how a cover's panel answers a tap in `src/covers.js`, one fix undoing the other. Rules for both:

1. At the start of work, and again before a version bump or a new ledger entry: `git fetch origin`. The Mac session merges
   `origin/main` into `safari-mac`; the Windows session merges `origin/safari-mac` into `main`.
2. A new version or a new B- number is the next one after the highest on either `origin/main` or `origin/safari-mac`. Commit and
   push at once: a pushed number is taken.
3. Before a change to the shared extension (`src/`, `bg.js`, `popup.*`, `manifest.json`, `build-firefox.mjs`), look at what the
   other line did to the same files (`git log HEAD..origin/main -- <path>` on the Mac, `HEAD..origin/safari-mac` on Windows). Where
   both lines change the same behaviour, say so in the commit message; the Windows session settles it at the merge.
4. Mac: Xcode writes the Mac account's full name into each new file's header (`Created by ...`). Take the name out before a
   commit (`Created on <date>.`). The household check runs only on the Windows PC, which holds its list, so it catches this only
   at the merge.

## Who does what, and when a build is made (2026-11-22)

Decision 2026-11-22: fixes are gathered, and a build is made on the owner's word alone.

1. **Where a change is made.** The test is the file, not the device that found the bug. A change to the shared extension
   (`src/`, `bg.js`, `popup.*`, `manifest.json`, `build-firefox.mjs`, the tests, the spec, the ledger) is the Windows session's,
   and so is the remedy for a report, so that Chrome, Edge, Firefox and Safari all get it. The Mac session does what is Safari's
   alone: the Xcode app, the iOS and macOS wrappers, signing, TestFlight, and a fix that has no meaning outside Safari. A bug seen
   on the iPhone is most often in shared code; it goes to the Windows session.
2. **No version bump for a fix.** A fix is committed and pushed with its tests and its ledger entry, and `manifest.json` keeps its
   version. The ledger row says `fixed on main, next build` in place of a version number.
3. **A build on the owner's word.** When the owner says to update the extensions, the Windows session merges `origin/safari-mac`,
   bumps the version once (rule 2 of the section above for the number), builds every browser, and puts the version number into the
   ledger rows that waited. The Mac session then merges `origin/main` and publishes that one build to TestFlight. Neither session
   bumps, builds for release or uploads at a merge or after a fix without that word.
4. **A report between builds** carries the version on the device, which may be behind main. Before working on it, check whether
   main already has the fix (the ledger rows that wait for the next build).
5. **A fault only Safari shows goes to the Mac session to be looked at, and comes back for the fix** (decision 2026-11-22: the
   Windows session read a Facebook fault three ways from reports alone, having no Safari). The Mac session reproduces it in
   Safari, reads the page as Safari builds it and measures what happens (the element, its styles, the order of events, the
   extension's own trace on `<html data-prism-errors>`), and writes what it found, with the page and the steps, into the
   fault's ledger row or a note under `docs/reports/`. It changes no shared code (rule 1); the Windows session makes the fix
   from those findings, for every browser. What the Mac cannot look at, it says so at once and does not guess:
   - a fault that needs a video to play (no graphics acceleration: video in Safari locks the VM);
   - a fault that needs iOS itself (no simulator on this machine; desktop Safari can ask a site for its phone layout by its
     user agent, which is the layout and not iOS);
   - a page behind a sign-in the owner has not made on the VM. Never an account or settings page, never a change on the
     household's accounts.
   Those stay with the owner's iPhone and its reports (a report carries the covers' recent history, `coverLog`).

## Build and load

1. `cd prototypes/prism-veil-extension && node build-firefox.mjs safari` makes `dist/safari` and the zip.
2. The owner adds it: Safari > Settings > Developer > Add Temporary Extension…, pick `dist/safari`, then turn it on under
   Extensions and allow it on all websites. A temporary extension goes when Safari quits. After a rebuild, remove it and add it again.

3. Adding it can be scripted once Terminal has Accessibility (System Settings > Privacy & Security): System Events clicks
   `button "Add Temporary Extension…" of group 1 of group 1 of window "Developer"` in Safari's Settings. Safari then asks for the
   Mac's password to allow unsigned extensions; only the owner types it. Never send keystrokes while that prompt may be up.
4. If the Mac froze and Safari was killed, Safari reopens the last tabs at the next launch. Hold Shift while opening it, or quit it
   cleanly with no windows open.

## Look at a page

- Safari > Develop > Allow JavaScript from Apple Events must be on.
- Run script in the front tab:
  `osascript -e 'tell application "Safari" to do JavaScript "document.querySelectorAll(\"[data-prism-ui],[data-prism-veil]\").length" in current tab of front window'`
- Open a page: `osascript -e 'tell application "Safari" to set URL of current tab of front window to "https://www.youtube.com"'`
- A screenshot: `screencapture -x /tmp/shot.png`, then read the picture.
- A click inside the page (the PRISM pill, the report card): System Events' `click at` fails here (-25208); post a real click with a
  few lines of Swift (`CGEvent` mouse down and up, built with `swiftc`). Screen point = page pixel + the window's `screenX` and
  `screenY + outerHeight - innerHeight`.
- Avoid video in the virtual machine: the screen is drawn in software, and a YouTube page froze it on 2026-11-21.
- The background page's errors are in Develop > Web Extension Background Content > PRISM. Only a person (or computer use) can open it.

## What to find out (roadmap, Safari: unknown until a Safari runs it)

1. The content scripts in the page's own world (`world: MAIN`): do `ima-hook.js` and `popup-hook.js` run?
2. Display ad covers on msn.com, Facebook, X: are they drawn, in the right place?
3. A YouTube video ad: cover, then the tab mute under it. Not on this machine (above): a real Mac only.
4. The settings: since 0.9.45 the toolbar icon opens them in a window of their own (the frame over the page crashed msn.com's
   process). Does the window open, and do its switches reach the page?
5. Report an ad: does the report reach reports.entangled.world (the server admits `safari-web-extension://`)?

Write each finding in `docs/roadmap.md` under the Safari section, dated, with what was seen. A fault goes in `docs/bugs/LEDGER.md`.

## TestFlight through Xcode (2026-11-21)

App Store Connect's packager failed twice with "Service Error" before reading the zip (roadmap), so the app is built here. Xcode
26.6 is installed (27 does not run on this Intel Mac on macOS 26), signed in to the developer account (Team ID `6X4S754A69`). The
app record exists: **PRISM by Entangled**, bundle ID `world.entangled.prism.extension`, iOS and macOS.

1. `node build-firefox.mjs safari` (0.9.48 or later; `persistent: false` must stay, iOS refuses a persistent background).
2. Make the project with `xcrun safari-web-extension-converter` from `dist/safari`: app name `PRISM by Entangled`, bundle
   identifier `world.entangled.prism.extension`, iOS only for now, `--no-open`, the project in `targets/safari-app/` (not in
   `dist/`). Commit the generated project on the branch `safari-mac` so it can be built again.
3. The app icon: the 1024 px opaque icon is `assets/store/prism-appstore-icon-1024.png` (from `scripts/brand-icons.py`); put it
   in the app's asset catalog. Set `ITSAppUsesNonExemptEncryption` to NO (HTTPS only). Marketing version = the extension's version,
   build number 1 and up.
4. Automatic signing with the team; archive and upload with `xcodebuild ... -allowProvisioningUpdates` (export method
   App Store Connect, destination upload). No simulator: this machine has no graphics acceleration.
   Xcode's Apple Account sign-in fails on this VM ("An unknown error occurred", most likely the VM's made-up serial number), so
   signing and upload use an App Store Connect API key instead: add `-authenticationKeyPath <the .p8> -authenticationKeyID <id>
   -authenticationKeyIssuerID <issuer>` to both the archive and the export. The owner downloads the key on this Mac to
   `~/.appstoreconnect/private_keys/`; it never enters the repo (`.gitignore` refuses `*.p8`) or a commit, a log or a reply.
5. Say when the build shows in TestFlight. The owner adds testers and installs on the iPhone.
6. The Mac session publishes the Safari app on its own, start to end (2026-11-22): merge, version, build, archive, upload,
   and the TestFlight steps it can reach. The Windows session does not upload Safari builds.

How the first upload went (0.9.48 (1), 2026-11-21):

- Xcode is at `~/Downloads/Xcode.app`: set `DEVELOPER_DIR=~/Downloads/Xcode.app/Contents/Developer` (no `xcode-select`, which needs
  an administrator). Node is not installed; the session ran the `node` binary from the node pkg in `~/Downloads`, unpacked with
  `pkgutil --expand-full` into its scratchpad.
- Xcode shipped without the iOS platform: `xcodebuild -downloadPlatform iOS` (about ten minutes) before the first archive.
- A signed archive fails: automatic signing asks for a development profile, and the team has no devices. Archive unsigned
  (`CODE_SIGNING_ALLOWED=NO`, no key needed), then `-exportArchive` with the key and an options plist (`method`
  app-store-connect, `destination` upload, `signingStyle` automatic, `teamID`): the export signs for distribution and uploads.
- App Store Connect refuses a Safari extension whose `description` is over 112 characters: the Safari build has its own shorter
  one (`STORE.safariDescription` in `build-firefox.mjs`).
- The project in `targets/safari-app/` references `dist/safari`, so a rebuild of the extension goes into the next archive; raise
  the build number (`CURRENT_PROJECT_VERSION`) for each upload of the same version.
- App Store Connect warns that from April 2027 an iOS app must be built with the iOS 27 SDK (Xcode 27), which this Mac cannot run.

## Rules that matter here

- Never start sound unasked. Ask before playing a video with sound.
- Never open account or settings pages of the household's sign-ins. Never run a remove or a list change on them.
- No household names and no owner's words in a file or a commit (the CLAUDE.md section on the person's words).
- Commit as `mark@entangled.world`. The brand is written PRISM.
- Short answers, conclusion first. When the owner has to act, end with only their steps, numbered.
