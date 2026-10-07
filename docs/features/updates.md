# Updates: the Windows download and how Prism keeps itself current

2026-10-05: "How do we publish the download for the windows version of Prism on our website and keep it updated through there?" and
"I'd like to have an auto-update mechanism with a server address so the user can choose to update from there. But also this is open
source so if someone forked and set up their own environment, they would set the server address for updates, that's why it needs to be
configurable."

Spec: dashboard-schema §28 (no accounts, no tracking, no fear; the check is a static, unparameterized fetch; §10 storage persists across
every update). Core owns the policy (`packages/core/src/updates.ts`: what is newer, the daily check, the night window); the Windows host
owns the bytes (`targets/win-host/PrismHost/Services/Updates.cs`, `MainWindow.Updates.cs`).

## The one file

`https://prism.entangled.world/windows/manifest.json`, beside it `manifest.sig`:

```json
{
  "alpha":  { "version": "0.23.0", "url": "https://prism.entangled.world/windows/Prism-0.23.0-1a2b3c4d.zip",
              "sha256": "…64 hex…", "size": 132931512, "date": "2026-10-05", "notes": "What changed, in a sentence or two." },
  "beta":   { … },
  "stable": { … }
}
```

### The changelog feed (2026-10-07)

*Decision:* "When performing the incremental updates, can we have the option to see a change log feed on the side of that modal window?
Maybe just a checkbox to turn it on with the changelog for the latest version?" Each track's entry also carries `history`: the track's
recent releases, newest first, this one at the top, each `{version, date, notes}`, at most 25 from the publish script (core reads 40).
The publish script builds it from CHANGELOG.md, so the manifest, the changelog and the website say the same thing, and it is signed with
the rest. An incremental update can skip several versions, so the feed shows each one's notes, not only the newest.

On the PC, the Updates dialog's **Show what's changed** (off by default, the choice kept) opens a panel beside the settings: each release,
the ones newer than this Prism in amber with *New*, this Prism's own marked *Running now*. Core keeps the track's entry from the last good
check (`latest`) even when nothing is newer, so the panel always has the newest release to show. Nothing extra is fetched: the history
comes in the manifest the daily check already reads. A manifest from before the feed shows its one release's notes.

### Tracks (2026-10-05)

*Decision:* "I would call this current track Alpha. And we'll work toward beta and full." Three tracks, one entry each:
**alpha** is what ships while Prism is built, **beta** the release candidate, **stable** the full release (shown as *Full*). A Prism
follows the track it was built on (`Services.Updates.BuildTrack`, alpha today) unless the person picks another under Updates;
the host hands core the track at every start, so a persisted choice from an older build does not pin it. A publisher may point
two tracks at one release (`--also`): the first alpha publish after the rename carries `--also stable`, because every 0.22.0
Prism was built looking at `stable`. When beta exists the website's Download moves to it (`HEADLINE` in the publish script),
and alpha keeps going for whoever chose it.

*Decision (2026-10-06):* "I think all of our releases so far should be alpha." 0.22.0 and 0.23.0 are alpha releases: the
changelog, the website's release history and its changelog page (an Alpha tag, as Beta has), and GitHub (both pre-releases, so
GitHub names no latest release). The manifest's `stable` entry stays at 0.23.0 only as the forwarding pointer for 0.22.0
installs, which read `stable` and would otherwise never update again; once on 0.23.0 they follow `alpha`. It is not a full
release, and no later publish passes `--also stable` until there is one.

- The signature is ECDSA P-256 / SHA-256 over the manifest's exact bytes, raw r||s in base64 - the same scheme as Veil's art index.
  The private key lives at `~/.prism/prism-updates-signing.pem` on the publishing machine and nowhere else; the public JWK is the
  default `update.key` in the host.
- The zips sit in the same bucket (Tigris, served at prism.entangled.world, the one Veil's art uses), never in a git tree. The website's
  Download page reads the version, date, size and hash from its own `releases.json`, which the publish script writes, so the page and
  the manifest cannot disagree; `/prism/download/windows` on the site 302s to the current zip.

## Publishing a release

*Decision (2026-10-07):* the public source goes out with every release. `publish-windows.py` first runs `scripts/release/public-snapshot.py
check` (the tree against the household's details listed in `~/.prism/public-scrub.txt` on the publishing machine, never in the tree; a match
or a missing list stops the release before anything is built), then pushes a snapshot - one commit of the archive's file tree on top of the
public repo's history, never the archive's own history - and makes the GitHub Release's tag point at it. Until then the public code had stood
still at the first release for eleven days; 0.26.27's source went out as f1e6f74c.

```
python scripts/release/publish-windows.py --notes "What changed." [--channel alpha|beta|stable] [--also <track>] [--site C:\path\to\website]
```

Reads the version from PrismHost.csproj and the commit, publishes (Release, x64, self-contained), zips, hashes, merges this channel into
the current manifest (the other channel's entry kept), signs, uploads the zip first and the manifest after, and with `--site` writes the
website's `src/data/releases.json` and `public/_redirects` (then `npm run deploy` there). `--dry-run` does everything but upload.
`node scripts/release/sign-manifest.mjs --keygen` makes a key once; a fork runs it and pastes its JWK into its Prism.

## On the PC

- Once a day core fetches the manifest at the configured address: no query string, no identifying header (the UA is "Prism/<version>").
  The host reads `manifest.sig` beside it and verifies against the configured key; a manifest that does not verify is refused and the
  status says "the server's answer did not verify". An empty key skips the check (a fork testing locally), said in the log.
- A newer version for the channel is `available`. The Prism menu's **Updates** line says so ("0.23.0 is ready to install"), as does the
  status line once after boot. The Updates dialog shows the notes, **Check now**, **Install now**, and for a staged version **Restart into
  the new version**. The §24 night window installs by itself when the wall is dark.
- **The fixed install folder** (2026-10-06, "build the fixed install folder and incremental updates"; `PrismHost.Core/UpdateInstaller.cs`,
  `Services/Updates.cs` AtStart): Prism runs from `%LOCALAPPDATA%\Programs\Prism` and nowhere else, apart from the data folder (a reset
  to defaults never moves the program). Windows keys its firewall rule on the exe's path; while each update ran from its own
  `app\<version>` folder, Windows asked about the firewall once an update. Now the path never changes. What a start does, before
  anything opens:
  - run from the install folder: it runs; a newer whole release staged beside it starts instead with `--prism-promote <pid>`, waits for
    this process to go, installs itself, and starts Prism from the install folder;
  - run from anywhere else (the unzipped download, an older update folder, an old shortcut): an installed Prism as new or newer gets the
    hand-off; otherwise this copy installs itself into the install folder and starts from there. The installed copy then asks once where
    Prism should be started from (2026-10-06, "we should prompt the user to see whether they want to add a shortcut to their desktop,
    taskbar, start menu"): Start menu (checked), Desktop, Taskbar. Prism writes the Start menu and desktop shortcuts in the person's own
    folders (no administrator rights), and the first run applies the choice however the dialog closes, so Prism always has a way to start.
    Windows gives a desktop app no way to pin itself to the taskbar, so Taskbar shows the presses that pin it (Start, right-click Prism,
    Pin to taskbar). The Device page's Shortcuts section changes the choice later. An existing shortcut that starts an older copy is
    repointed at the install folder at every start, and none is made without asking. The unzipped folder can then be deleted, and the
    installed copy says so once (the first-run note): the status line, "installed. You can delete the folder you downloaded it to." with
    Show that folder beside it, for a minute. Someone moved over from an older Prism's update folder is not asked (their shortcut is
    repointed) and is told only that Prism is installed (that folder is removed by Prism). The folder travels as `--prism-installed-from`, never passed on.
  - older Prisms read `app\current.json` at their start; it names the install folder's exe, so their shortcuts land there too. The old
    `app\<version>` folders are removed once Prism runs from the install folder.
  A debug build never installs or hands off; `PRISM_NO_HANDOFF=1` turns it all off; `PRISM_INSTALL_DIR` points it at a test folder and
  `PRISM_UPDATE_SELFTEST=1` logs each step instead of starting anything (how it was walked without a window).
- **Install** (core's night window or Install now) stages the release whole in `Programs\Prism.next`:
  - **incremental** when the manifest's entry names a file list (`files`, its SHA-256 in `filesSha256`, both signed with the manifest):
    the list is fetched and its hash checked; every file the running copy already has (same path and hash, or the same hash anywhere) is
    copied from it; only the rest are fetched from `windows/files/<sha256>.gz`, unpacked and checked against the list before they are
    placed. Between 0.23.0 and 0.24.0 that was 10 of 660 files, 1.8 MB against a 127 MB zip. Any failure falls back to the zip.
  - **the zip** otherwise (a fork's server, a release before 0.26.0): downloaded, its SHA-256 compared with the manifest's, unpacked and
    indexed.
  The running program is never touched while it runs.
- **Promotion** writes only the files that differ into the install folder; each one it replaces (or one no longer in the release) is moved
  to `Programs\Prism.previous` first, and all of them go back if any step fails. The previous set stays until the next update.
- Sign-ins, settings and everything else live in the data folder, untouched (§10).

## Settings (Prism menu, Updates, "Update server")

`update.url` (default the manifest above), `update.key` (public JWK; empty = unsigned), `update.channel` (alpha | beta | stable),
`update.enabled` (on | never), `update.at` and `update.weekday` (the schedule), in host prefs.

**When the check runs** (2026-10-06, "Let the user check for updates at a scheduled time"): the dialog's *Check for updates* is Every day,
Once a week (with the day) or Never, *At* a time on the PC's own clock (04:00 unless chosen), and the line under it says when the next
check is. Core's checker takes the schedule (`UpdateConfig.schedule`, `setSchedule`): a time missed while the PC was off is made up at
the next start, otherwise the check waits for its time and runs at it. A change applies at once, no restart; Never stops the checks
that run on their own, and Check now still asks. The checker always starts, so Never can be turned back on without a restart. A fork sets the address and the key and ships its own default in Services/Updates.cs.

The address and the key are *shown*, not edited (2026-10-05, "Why is the public key editable"): whoever holds the private key for
the key in that field decides what this Prism installs, so an open field would be the easiest social-engineering target in the app
("paste this key and address"). **Change the update server** reveals the fields behind an amber warning that names the risk, with
**Back to Entangled's** beside them; the expander's header says *not Entangled's* whenever either differs from the defaults. The
track and the check cadence stay ordinary settings above the expander.

The dialog's **Check now**, **Install now** and the track change answer a promise in core; the host awaits them through
`ModelCallAwaitAsync` (a ticket parked on the brain's window, polled), because WebView2's plain eval hands a promise back as `{}`,
which read as "Last check never" right after a check (2026-10-05).

## The download count and the record (2026-10-05)

- **The count is of downloads, not installs.** Prism never reports an install: that would be telemetry, which it promises not to do.
  The website's Download button goes to `https://reports.entangled.world/v1/download/windows` (the reports service that already runs
  for Veil, prototypes/prism-veil-reports/server.mjs): it adds one to a number and sends the browser on to the current zip, read from
  the signed manifest. Nothing about the person is kept - no address, no browser string, no time - only the number, in the service's
  private bucket. `GET /v1/downloads` answers `{"windows": N}` with CORS for entangled.world, and the site shows it. A HEAD does not
  count; a bot that fetches the link does, so the number is an honest upper bound on people.
- **The record.** Each publish prepends an entry to `CHANGELOG.md` at the repo root (commit it after), creates a GitHub Release
  `v<version>` on the public repo with the notes, the hash and the zip, and with `--site` writes the website's `releases.json`: the
  current release under `windows` (with the counting download address and the count's address) and every release under `history`,
  newest first, each with its GitHub release address. The site renders the Download page, the download count, the changelog and the
  release history from that one file, and links each entry to GitHub.

## Code signing (2026-10-05, SmartScreen's "Unknown publisher" on the first run)

An unsigned download with no reputation gets Windows' "Windows protected your PC" screen; More info, Run anyway gets past it, and the
README and the website say so with the SHA-256 beside the button. The fix is a code-signing certificate for Entangled Labs LLC: the
publish script signs PrismHost.exe and Prism's DLLs with signtool (SHA-256, timestamped at DigiCert's authority) when
`PRISM_SIGN_THUMBPRINT` names a certificate in the user's store. Timestamped signatures stay valid after the certificate expires or the
subscription lapses; cancelling is not revocation. Choices: Azure Trusted Signing (about $10 a month; a company with three years of record;
its own signtool dlib, to be added when the account exists), an EV certificate (immediate reputation), an OV certificate (reputation
builds over weeks). Until then every new file name earns its reputation from zero.

## Not yet

- A signed installer (MSIX) in place of the zip. The zip and the hand-off are the release form for now.
- The phone's companion page shows nothing about updates.
- A rollback verb: the files the last update replaced are in `Programs\Prism.previous`; putting them back is by hand for now.

## Setup: Windows asks once (2026-10-06)

"We should add the remote desktop support option at the same setup time right? So they dont get a late UAC prompt." On a TV with a
remote nobody can answer a Windows prompt (an IR remote that types as a keyboard sometimes can, but not reliably). Everything that
needs administrator rights is asked for together, once, while someone sets the PC up: the Set up services page's **This PC** block
(`Services/DeviceSetup.cs`), also on the Device page:
- **Let phones on your home network reach Prism**: a Windows Firewall rule, inbound TCP 8471, for the installed exe only, from the local
  subnet only, named "Prism phone remote" (ticked by default);
- **Remote Desktop Support** (docs/features/media-hub.md; not ticked by default).
One elevated `cmd` runs `netsh` and `schtasks` for what is ticked; declining changes nothing. The task's definition is a temp file held
open with no write sharing from its writing until Windows has read it.
