# Prism for Windows — walkthrough test scripts

Hand-run scripts, one per concept scene, written against the host as built on
2026-09-05 (commit after `9586ac0`). Each step is **Do → Expect**. If what you
see differs from *Expect*, stop and report the script and step id
(e.g. `ML-7`): that is a bug or a wrong script, and both are mine to fix.

Every step carries a verification mark:

| mark | meaning |
|---|---|
| `EXEC` | I ran exactly this on this machine and read the result (log, store, wall state) |
| `CODE` | I read the code path and the exact UI string; not clicked by me — **you are the first** |
| `USER` | you did this with me on 2026-09-04 and it worked; not re-run since |
| `KNOWN` | a documented limitation — the step tells you what you will see instead |
| `LIVE` | driven with the mouse on your unlocked session on 2026-09-05 and read back from the host's own XAML capture |

The live pass covered: the menu, the Scenes rail, card menus, activating scenes, the empty-slot sheet,
the whole *Change apps…* flow on Kitchen Command (YouTube → Weather (NWS) → AP from the shelf →
Save), the stage sheet on the lounge, and the scene builder. It found and fixed three bugs
(B-107, B-108, B-109) before you saw them.

---

## 0 · Before you start

| id | Do | Expect | mark |
|---|---|---|---|
| S-1 | In a terminal at the repo root: `node scripts/verify.mjs --no-known-gaps --require-all` | ends with `GATE: PASS` (16 steps). This also builds the host. | EXEC |
| S-2 | The Parkers seed is already in your live store (re-seeded 13:15 today, backup at `%LOCALAPPDATA%\Prism-backup-20260905-1315\`). To redo it: `node scripts/seed-demo-household.mjs --live --no-activate` | prints five scenes; Kitchen Command and Family Hub each list **3** App-poster placeholders (was 4 — the Agenda slot is now real) | EXEC |
| S-3 | Launch `targets\win-host\PrismHost\bin\x64\Debug\net8.0-windows10.0.19041.0\win-x64\PrismHost.exe` | the wall shows whatever scene was last applied (Family Hub, from my validation loop). It boots the **last applied document**, not the rail's "active" pointer — see note N-1 | EXEC |
| S-4 | Diagnostics: `%LOCALAPPDATA%\Prism\diagnostics\host.log` | every step below leaves lines here; tokens are redacted at write time | EXEC |
| S-5 | **From scratch:** close the host, then `pwsh scripts/run-fresh.ps1` | a second, empty data folder (`%LOCALAPPDATA%\Prism-fresh-<stamp>`): empty store, fresh per-App profiles (every sign-in is a real one), its own log. The window title reads *Prism — fresh run (…)*. Your real store and sessions in `%LOCALAPPDATA%\Prism` are untouched. `-Reuse` continues the last fresh run; the plain launch goes back to your real wall | CODE |
| S-6 | First run (that empty store) | a moment after launch the wall opens the **New scene** wizard by itself, headed *Welcome to Prism* with one line of welcome; Esc lands on the empty wall | CODE |

**Keys and gestures (the whole map):**

| key | does |
|---|---|
| **F10** or the grip at the **top-centre** of the wall | the App menu: *Scenes… · Layouts… · Facets… · Apps… · Device…* (each opens the rail on that section) |
| **Esc** | back one level (§6a: it always lands on the scene; from the scene it does nothing) |
| **right-click** a slot (long-press on touch) | that slot's context sheet |
| **click** an *Empty slot* placeholder | its context sheet (*Assign a facet · Edit scene*) |
| **tap** a Music Lounge stage | reveals the hidden player; tap again or Esc tucks it back |
| F11 | wall fullscreen |
| Ctrl+1 … Ctrl+9 | fullscreen the n-th tile / back |
| Ctrl+N | the picker · Ctrl+A arrange · Ctrl+Shift+S wall shot · F8 slot region · Ctrl+F9 probe |

---

## 1 · Rail tour and scene switching (`RT`)

| id | Do | Expect | mark |
|---|---|---|---|
| RT-1 | Press **F10**, or click the small **Prism ▾** grip at the top-centre of the wall | a dark menu: *Scenes… · Layouts… · Facets… · Apps… · Device… · Now playing › · Page tools (sign in, region)… F8 · Add an app from the catalog… Ctrl+N · Add a website… · Arrange the wall… Ctrl+A · This wall now › · Floating facets › · N slots › · Veils › · Full-Screen Wall F11 · Wall shot Ctrl+Shift+S · Open wall shots folder · Diagnostics › · About Prism · Quit Prism* | LIVE |
| RT-2 | *Scenes…* | the rail opens on **Scenes** ("Playing now: …" under the title). Cards, the playing one first and marked **● playing**, then by name: `Family Hub`, `Kitchen Command`, `M1 demo — Netflix + Hulu`, `Movie Night`, `Music Lounge` ×2 (the seeded one and yours), `Sports Multiview`. Each thumbnail names what each slot holds. Top-right: **＋ New Scene** · **＋ Blank scene** | LIVE |
| RT-3 | **Right-click** a card → **Set as the active scene** on `Kitchen Command` (menu: *Set as the active scene · Edit… · Change apps… · Rename… · Duplicate · Remove scene*) | the rail closes; the wall crossfades to Kitchen Command: video hero placeholder (top-left, ¾ wide), news-ticker placeholder along the bottom, and on the right column top→bottom: **Weather** placeholder, **Agenda** (the Parkers' week, live), **Chores & notes** (live) | LIVE (the seeded Kitchen Command is now the one I filled in the CA script below) |
| RT-4 | **Esc** | nothing happens — you are already on the scene | CODE |
| RT-5 | F10 → *Scenes…* → set `Family Hub` active | portrait layout squeezed into your landscape window (it is a 9:16 scene; note N-2). Photos placeholder on top, then **Agenda** (live) / **Chores** (live), **Timer** (live) / Weather placeholder, ticker placeholder at the bottom | EXEC (applied; 3 tiles load ok, 3 placeholders) |
| RT-6 | F10 → *Scenes…* → card menu → **Rename…** on your `Music Lounge` → type `Lounge (mine)` → OK | the card shows the new name; nothing on the wall changes | CODE |
| RT-7 | Card menu → **Duplicate** on it | a second card `Lounge (mine) copy`-style appears; **Remove scene** on the copy takes it away again (your original stays) | CODE |

---

## 2 · Kitchen Command from the wizard (`KC`)

Goal: build the scene the way a household would — three questions, two filled in for you.

| id | Do | Expect | mark |
|---|---|---|---|
| KC-1 | F10 → *Scenes…* → **＋ New Scene** | the **New scene** page: template cards in this order — Kitchen Command, Sports Multiview, Movie Night, Family Hub, Music Lounge, Music Lounge + Clock, Kitchen Classic — plus *Blank scene instead…* and *Back to the scene (Esc)* | EXEC (order from core) / CODE (page) |
| KC-2 | Click **Kitchen Command** | the wizard: a thumbnail of the five slots on the left, the role list, and the first role panel **Video hero · 16:9·XL** | CODE |
| KC-3 | Look at the role list before touching anything | **Chores & notes** and **Calendar** already read *RESOLVED* with the line *"Filled in for you: … is part of Prism - there is nothing to sign in to."* (Calendar is new today — it used to offer a dead `merge` chip and Google Calendar) | CODE — the pre-resolve path adds the App from the catalog if missing and cuts a 4:3·M facet |
| KC-4 | Video hero panel → SUGGESTIONS → click **YouTube** | Prism adds the YouTube App if you have none, the wizard steps aside, youtube.com fills the wall, and a small **App setup · Youtube** card sits top-right (*signed in · verified now (unsaved)*, *Go to the sign-in page*, *Go to https://www.youtube.com/*, *New Facet of this App…*, **✓ Done**, *Cancel (Esc)*). Below the chips the panel also lists **YOUR APPS** (every App you already have, with its status) | LIVE (card) / CODE (wizard stepping aside — B-108, fixed after the pass) |
| KC-5 | Click **✓ Done** | back in the wizard; APP `Youtube` now badged *signed in*, **Setup mode (sign in)…**, **Different app**, and **FACET FOR 16:9·XL** with the preset card *Youtube · Subscriptions · 16:9·XL — region: subs (adapter selector by name)* | LIVE |
| KC-6 | Click **Use this facet** | the role is ticked in the ROLES list and the wizard **moves on by itself** to the next open role (Weather). There is no Next button to press | LIVE |
| KC-7 | Click the **Weather (NWS) · no DRM** chip → **✓ Done** on the setup card → **Use this facet** | Weather RESOLVED with *Weather (NWS) · Current conditions · 4:3·M — region: current-conditions*; the wizard moves on to News ticker | LIVE |
| KC-8 | **Choose from the news shelf…** → a full-page grid (**Any URL** first, then A–Z, each *Generally reliable · why?*) → click **Associated Press (AP)** → the facet card (*Associated Press (AP) · Home · 8:1-ticker·M · whole page*; no sign-in step) → **Use this facet** | News ticker RESOLVED. Note: shelf sources are cut as a **whole page**, not a headline river (B-110) | LIVE |
| KC-9 | **Create scene** | the prompt **Name the scene** pre-filled `Kitchen Command 2` — because a `Kitchen Command` already exists (new today; it used to silently create a same-named twin) | CODE |
| KC-10 | **Create** | the wizard closes; the wall becomes your new scene: YouTube hero playing, weather region top-right, the Parkers' Agenda and Chores below it, headlines along the bottom | CODE — apply path is the one RT-3 exercised |
| KC-11 | Press **Create scene** with a role still open (try this on a fresh wizard) | the pill *"Prism · every role must be resolved first"*; nothing is created | CODE |

---

## 3 · Sports Multiview (`SM`)

| id | Do | Expect | mark |
|---|---|---|---|
| SM-1 | ＋ New Scene → **Sports Multiview** | roles: **Main game · 4:3·XL**, **Game 2 · 3:2·M**, **Game 3 · 3:2·M**, **Scores ticker · 8:1-ticker·M**. Three games, not four — hero-plus-two (charter §2.2) | EXEC (core) |
| SM-2 | Main game → **YouTube** chip → ✓ Done → **Use this facet** | RESOLVED. The YouTube App is shared — no second sign-in | CODE |
| SM-3 | Game 2 → **YouTube** → the FACET section now lists **Use YouTube · <label>** rows for facets you already have, with a fit note (*exact class* or how it fits) — pick the preset card's **Use this facet** to cut a fresh 3:2·M one | CODE |
| SM-4 | Game 3 → same | RESOLVED | CODE |
| SM-5 | Scores ticker → **Choose from the news shelf…** → any sports source, or **Any URL** → `https://www.espn.com/` | RESOLVED | CODE |
| SM-6 | **Create scene** → Create | the wall: big game left (⅔ wide), two stacked on the right, ticker across the bottom. Only one game has audio — the hero (exclusive owner); the others are muted (§3) | EXEC (seeded rects apply) / CODE (audio) |
| SM-7 | Right-click Game 2 → **Unmute** | Game 2 takes audio and the hero mutes (audio exclusivity) | CODE |

---

## 4 · Movie Night (`MN`)

| id | Do | Expect | mark |
|---|---|---|---|
| MN-1 | ＋ New Scene → **Movie Night** | one role: **The movie · 16:9·XL**; suggestions Netflix, Hulu, Prime Video, Peacock, Paramount+ | EXEC (core) |
| MN-2 | Click **Netflix** → sign in on the setup page → **✓ Done** | status *signed in - verified now* in the pill (it watches the URL leave the login page and return to Netflix's own pages) | CODE |
| MN-3 | **Use this facet** → **Create scene** → Create | the wall is Netflix full-bleed. `keepPresentation: true`, `tapAction: promote` — a tap promotes, it does not pause | CODE |
| MN-4 | Play something; wait for the §26 veil to have nothing to do | no white frame at any point (§16); the substrate is dark | KNOWN — premium DRM playback in a WebView2 tile may be output-restricted on this machine (memory: WebView DRM wall); if Netflix refuses, that is the known limit, not the scene |

---

## 5 · Family Hub (`FH`)

| id | Do | Expect | mark |
|---|---|---|---|
| FH-1 | ＋ New Scene → **Family Hub** | six roles; **Calendar, Chores & notes, Timer** already RESOLVED (filled in for you). Open: **Photos · 4:3·XL** (kind *any*), **Weather · 16:9·M**, **News ticker** | CODE |
| FH-2 | Photos → **Any app…** → **From the catalog** or **Any URL** → e.g. `https://photos.google.com/` → **Add this website** → setup → ✓ Done → **Use this facet** | RESOLVED | CODE |
| FH-3 | Weather → **Weather** chip → ✓ Done → **Use this facet** | RESOLVED (`current-conditions`, cut 16:9·M this time) | CODE |
| FH-4 | News ticker → shelf → any | RESOLVED | CODE |
| FH-5 | **Create scene** → Create | portrait scene; in a landscape window it is letterboxed (N-2). Agenda shows the Parkers' week; Chores shows six chores, three done; Timer is a countdown | EXEC (seeded scene applies; agenda/chores/timer load ok) |

---

## 6 · Music Lounge with your Apple Music (`ML`)

This is the one that hurt. Two things changed the flow today: the seeded
`Music Lounge` (demo) has **no service** — its stage is sourced to a
placeholder and can never play; use **your** scene or build a new one with this
script. And the wizard is the *only* place a service gets chosen; nothing on
the wall asks.

| id | Do | Expect | mark |
|---|---|---|---|
| ML-1 | ＋ New Scene → **Music Lounge** | two roles: **The stage · 16:9·XL** (visualization) and, hidden, **Music service**. The stage panel says *"Waiting on Music service. Choose the service and this is created with it, sourced to it - no second decision."* with the primary button **Choose the service: Music service →** | CODE |
| ML-2 | Click it → chips **Spotify · Apple Music · Pandora** → **Apple Music** | **App setup · Apple Music** opens on music.apple.com. If you are signed out it lands on the sign-in page and says so | CODE |
| ML-3 | Sign in there (this is the **only** time you need the revealed page for anything). **✓ Done** | back in the wizard: APP Apple Music, section **HIDDEN MUSIC FACET**, the preset card (`library/recently-added`), and the primary **Use this facet & make the visualization** | CODE (preset from `apple-music.json`) |
| ML-4 | Click it | both roles RESOLVED: the stage reads *Prism Beams · backdrop · from Apple Music · …* | EXEC (core: `instantiateTemplate` yields `prism-beams/backdrop`) |
| ML-5 | **Create scene** → name it → Create | the wall: ambient Prism Beams drift, prism at x=0.32, spectrum bars along the floor; transport row visible at rest (0.85 opacity) with mute · ⏮ · ⏪ · ▶ · ⏩ · ⏭ and `0:00 / –:––`; no title yet | EXEC (chrome built on launch: `viz chrome built for stage`) |
| ML-6 | The wall is **silent** after Create | expected today. `onActivate: play` is plumbed but I have never observed it fire on the wall, and the charter decision is PENDING (concept-scenes §2.5.2) | KNOWN |
| ML-7 | **Tap the stage** | the Apple Music player reveals hero-sized over the beams; the beams keep running underneath; a corner note *"Player revealed · Back tucks it away"* | USER + CODE (B-99 fix) |
| ML-8 | Press **Play** on something in Apple Music (its own button; clicks reach the page while it is up) | audio starts; within ~2 s the chrome behind it has the title and artist | USER |
| ML-9 | **Esc** (or tap the stage again) | the player tucks back; beams react to the music — beams swing 24–39°, bars breathe, motes ride the beams; **title (34 px) and artist** read on the wall; time counts `m:ss / m:ss` with the progress bar | USER + EXEC (band feed live: `viz bands … max≈0.9`) |
| ML-10 | The time only steps every **2 s** | expected: the transport poll is the clock (the 250 ms ticker was removed because it froze the host) | KNOWN |
| ML-11 | Use the transport row: **⏸ / ▶**, **⏭**, **⏮**, **⏪ / ⏩**, **mute** | each acts through the page's own Media Session handlers (§32); mute is the tile's mute, not the OS | USER (play/next/mute) / CODE (seek) |
| ML-12 | Change tracks in Apple Music's own UI, then pause **from Apple Music** | the chrome follows within 2 s. Pausing from the page shows ⏸→▶ correctly (human attribution §3 rule 5, 60 s window) | CODE |
| ML-13 | Stop playback, wait a minute | the wall does **not** go black — idle drift (B-101) | EXEC |
| ML-14 | The visuals move at full rate without you doing anything | full motion is now **on by default** and remembered (F10 → *Device…* → **Full motion** to turn it off; `PRISM_FULL_MOTION=0/1` overrides). Windows' *ClientAreaAnimation* being off is what used to drop Prism to 16 bands at 10 fps | EXEC (default) |
| ML-15 | Reveal the player, browse to another page inside Apple Music, tuck it back | still the same hidden facet; audio never interrupted | CODE |
| ML-17 | On any music scene, tap the **⇄ Next visual** button at the left of the transport row | the wall crossfades to the next of **twenty** packs (Prism Beams → Spectrum → Ribbon → Bloom → the eight environment tableaus → the eight community tableaus → …), the pill names it, and the choice is written into the scene, so it is still that pack after a restart. Tap again any time | CODE (new 2026-09-06) |
| ML-20 | Tap the **⟲ Quick play** button (last of the three stacked at the top left: Intermission, Next visual, Quick play) | the last five things played (newest first), then **Playlists ▸** and **Stations ▸** - your Apple Music library and your stations, as the page itself lists them. Pick anything: the pill says *loading …* at once, line 2 of the block says **loading Vibes…** with a small ring until the page reports it playing (a big playlist takes Apple Music ten seconds and more), then the track takes over; if the page cannot start it, line 2 says **couldn't start Vibes** instead of going quiet - or **sign in to Apple Music to play** when the service has dropped the session (B-123), in which case the rail's Apple Music badge reads *needs attention* by itself and the sheet's *Open the player (sign in)…* is the one tap back. It plays through the service's own queue without the page being shown, and never a page prompt (B-125: the wall answers *leave site?* itself). Before Apple Music has loaded its lists (a few seconds after sign-in): *Nothing yet…* | LIVE 2026-09-06 (21 playlists, 25 stations listed at boot; a station picked by id played within 2 s and quick play recorded it under the page's own name) |
| ML-29 | With Pandora playing, press the transport's thumbs up -> Pandora's own tuner shows the thumb, the button lights amber; the next songs lean that way. Thumbs down -> Pandora skips as it does in its own app. Switch to Apple, thumbs up a song -> it shows as loved in Apple Music. On a Spotify stage the up saves the song, the down stays disabled | CODE (new 2026-09-08) |
| ML-28 | Mute Pandora from the stage -> a MUTED pill appears top centre. Pick an Apple station from Quick play -> the stage switches to Apple, still silent, the pill stays. Tap the pill -> Apple sounds, the pill goes | CODE (new 2026-09-08) |
| ML-27 | Pick Whales for ads, mute Pandora from the stage, let an ad break come -> the block reads Intermission / muted for the ad · whales instead, but nothing is heard. Unmute mid-break -> the whales come in. Mute again before the break ends -> after the break Pandora stays muted. Unmute -> the music is back | CODE (new 2026-09-08) |
| ML-26 | Left-click the stage's background -> nothing opens (the transport wakes). Right-click -> the sheet starts with **Pandora options**: *Sign in to Pandora…* and *Open the full app*. Tap Open the full app -> Pandora's page appears as a window in the middle of the wall, a bar along its top (PANDORA · Sign in · Quick play · Start over · Mute / unmute · Done); nothing new on the taskbar; the music plays on. Done (or Esc) -> the wall is back, no pause, no reload | CODE (new 2026-09-08) |
| ML-25 | With Pandora on the stage, hover the leftmost transport glyph (Audio) -> a disc pops up and six picks fan out around it, the centre naming the current one (None). Tap *Crickets* -> the pill says *crickets during ads*, the wheel closes. Let an ad break come -> the block reads **Intermission** / *muted for the ad · crickets instead*, crickets are heard, the wall's mute silences them too. When the break ends the first song plays on - nothing pauses it | CODE (new 2026-09-08) |
| ML-24 | Play an Apple playlist a few tracks in, pick a Pandora station, wait a minute, pick the same Apple playlist again from Quick play -> it carries on from the same track and position, no restart. Press the stage's **Start over** (the refresh glyph before Previous) -> the playlist starts from its first track; on a Pandora station it tunes afresh. Hover the button -> the tip names which | CODE (new 2026-09-08) |
| ML-23 | Right-click the stage → **Intermission…** → pick *Crickets* → Done. Then let Pandora reach an ad break | the pill says *crickets during ads*; the music keeps playing (no re-apply). At the break: Pandora goes quiet and crickets fade in within ~3 s; at the end the crickets fade and the station returns. The transport's mute silences the crickets too; unmute mid-break brings them back. *Silence* returns to the muted break | CODE (new 2026-09-07; the break itself is Pandora's to schedule) |
| ML-22 | Right-click the stage → **Add a music service…** → pick Spotify (or Pandora) → sign in when asked → Done | the pill says *Spotify joined this wall's music*; the stage keeps drawing Apple Music. Open **⟲ Quick play**: two submenus, *Apple Music · on the stage* and *Spotify*, each with its last five, Playlists, Stations; a signed-out service reads *· sign in*. Pick a Spotify playlist: *loading …*, it plays, and the visual moves to Spotify (the Service eyebrow changes) | LIVE 2026-09-07 for Pandora (My Collection's 13 stations listed by itself while a station played; the station named on the block and in the last five). Spotify's list is unverified until a signed-in page is seen |
| ML-21 | Look at the block bottom-left | a small spaced line **APPLE MUSIC** (the service) above the title, and - when a station or playlist is playing - its name as the last line (*◎ Alex's Station*). That name comes from the page itself (Apple Music's MusicKit); if the probe misses, the line stays empty and quick play falls back to the page's address | CODE (new 2026-09-06; the probe is unverified against the live player) |
| ML-19 | With a track loaded | the **cover** sits clear in the top-right corner (the backdrop still blurs it behind the scene), and the block bottom-left reads **title / artist · state / album** and stays up when you pause (state reads *paused*) | CODE (new 2026-09-06) |
| ML-18 | Play something once from the revealed player, then close Prism and relaunch it. On the silent lounge, tap **▶** in the transport row | the hidden player goes back to the album / playlist / station page it was playing from and presses that page's own Play; within a few seconds the beams move and the title fills in. In `host.log`: `surface.navigate <facet>` to that page, then `surface.inject`. If the page's Play control is not where the adapter expects, nothing plays and the button stays honest (the selector is unverified - report it) | CODE (new 2026-09-06) |
| ML-16 | F10 → *Scenes…* → right-click your lounge → **Edit…** → section *5 · VISUALIZATIONS* → **Style…** → toggle **Spill past the tile** → **Save & set active** | on a full-wall stage nothing visible changes (the window edge clips either way); on *Music Lounge + Clock* or any scene where the stage shares the wall, the beams now cross into the neighbouring tiles. Off again = contained (default) | CODE (new 2026-09-05) |

---

## 7 · From the wall: filling an empty slot (`ES`)

| id | Do | Expect | mark |
|---|---|---|---|
| ES-1 | On a scene with an empty slot (Family Hub's Photos, say), click the placeholder (`＋ · Empty slot · Photos · Click to choose an app`) | a context sheet headed *Empty slot · Photos* with **Choose an app…** · **Assign a facet** · **Edit scene** | LIVE |
| ES-2 | **Choose an app…** | the wizard opens **on this scene** (*Change apps · Family Hub*), at that role, with everything the scene already has ticked. Answer the role, **Save to this scene** | LIVE (Kitchen Command) |
| ES-2b | **Assign a facet** instead | the scene builder opens with that slot's picker up: your existing facets of the right class, or **＋ New facet for this slot** | CODE (`item.swap` → builder, `pickNow`) |
| ES-3 | Pick one → **Save & set active** | the wall shows it in the hero slot; the other four slots unchanged | CODE |
| ES-4 | Right-click any live tile | the sheet: **Open full page (setup mode) · Edit facet · App settings / sign in · Swap facet in this slot · Mute/Unmute** | CODE |
| ES-5 | Right-click the **stage** of a Music Lounge | the sheet headed *Visualization · Apple Music*: **Change the music service…** (or *Choose…* on a lounge without one) · **Next visual** · **Visual style…** (a dialog on the spot: the twenty packs and the artwork mode, applied live) · **Open the player (sign in)…** · **App settings / sign in** · **Mute**. No *Edit facet*, no *Swap facet* - a stage is about music (decision 2026-09-06) | CODE (changed after the live pass) |

---

## 8 · Change the apps of a scene you already have (`CA`)

New today. Any scene made from a template can re-run its wizard on itself — no twin scene, no builder.

| id | Do | Expect | mark |
|---|---|---|---|
| CA-1 | F10 → *Scenes…* → right-click `Kitchen Command` → **Change apps…** | the wizard headed **Change apps · Kitchen Command**; roles the scene already answers are ticked (Calendar, Chores & notes); the button reads **Save to this scene** and is disabled while roles are open (*3 roles to go: Video hero, Weather, News ticker*) | LIVE |
| CA-2 | Answer the open roles exactly as KC-4 … KC-8 | each answer ticks its role and the wizard moves to the next; after the last, *Every role answered. Save writes them into this scene and the wall becomes it.* | LIVE |
| CA-3 | **Save to this scene** | the wizard closes; the wall is Kitchen Command with YouTube (Subscriptions) in the hero, weather.gov current conditions top-right, Agenda and Chores below it, AP along the bottom. The scene card's thumbnail now names them | LIVE (after B-107's fix; before it the wall kept its placeholders) |
| CA-4 | On your Music Lounge: right-click the stage → **Change the music service…** | a small **Music service** dialog right there: *Spotify · Apple Music (signed in ✓ · playing now) · Pandora · Any app…*. Pick one → if that App is not verified signed in, the sign-in wizard opens and closes itself once your account is seen → the facet is cut from the service's preset, the scene saved, the wall re-applied. No wizard screen | CODE (rebuilt 2026-09-06 after "the flow of these menus is undesirable") |

---

## 11 · Reset to defaults and restore (`RS`)

New today. Nothing is deleted, ever (§10): reset *parks* the wall, restore brings a parked one back.

| id | Do | Expect | mark |
|---|---|---|---|
| RS-1 | F10 → *Device…* → section **RESET** → **Reset to defaults…** | a dialog: *Everything on this wall … is moved to a dated backup folder beside the store, and Prism restarts empty with the New scene wizard. Nothing is deleted.* Buttons **Reset and restart** / *Cancel* | LIVE (fresh run) |
| RS-2 | **Reset and restart** | Prism closes and reopens by itself; the pill reads *reset to defaults; the previous data is parked at Prism-backup-<stamp> (nothing deleted)*; a moment later the **Welcome to Prism** wizard opens on the empty wall. `%LOCALAPPDATA%\Prism-backup-<stamp>` holds the whole previous folder, sessions included | LIVE (fresh run: new PID, `Prism-fresh-...-backup-20260905-1538` parked, empty store, welcome wizard; the real store's folder untouched) |
| RS-3 | F10 → *Device…* → **Restore a backup…** | a list of the backups beside the store, newest first, each with its store's date and size | CODE |
| RS-4 | Pick one | Prism restarts on it; the wall you just left is parked as a new backup first, so the restore can itself be undone | CODE |
| RS-5 | In a fresh run (`run-fresh.ps1`) the same two buttons act on the fresh folder only | your real wall is never involved | CODE |

---

## 10 · A custom scene on your own layout (`CU`)

New today. The blank-scene path is a wizard now, not a form.

| id | Do | Expect | mark |
|---|---|---|---|
| CU-1 | F10 → *Scenes…* → **＋ New Scene** → **Custom scene from a layout…** | the wizard's first step, headed **Custom scene**: a grid of **YOUR LAYOUTS** (thumbnail, name, class, slot classes) and a **＋ Draw a new layout…** card; on the left *Templates instead…*, *Build it by hand in the scene builder…*, *Back to the scene (Esc)* | LIVE |
| CU-2 | Click a layout (e.g. *Kitchen Command*) | the wizard on that layout: every slot is a role named after it (*Video hero*, *Weather*, …), the XL wide slot is a **video hero** (service chips, exclusive audio), a ticker strip is **news** (the shelf), everything else a **utility** (*Any app…* and YOUR APPS). No hidden roles, no visualization | LIVE (Kitchen Command layout: Video hero / News ticker / Weather / Calendar / Chores & notes) |
| CU-3 | Answer some slots as in `KC`, leave others open | **Create scene** stays enabled: skipped slots become *Empty slot · <name>* on the wall, tappable | LIVE (button enabled with all five open) / CODE (the wall) |
| CU-4 | **Create scene** → *Name the scene* (default = the layout's name, or `Name 2`) → Create | the wall becomes the scene; the card appears under Scenes; *Change apps…* works on it like a template scene? **No** — a custom scene has no template behind it, so its empty slots offer *Assign a facet* / *Edit scene*, not *Choose an app…* (B-112) | CODE |
| CU-5 | **＋ Draw a new layout…** | the layout editor opens; **Save** returns you to the wizard on the new layout; Cancel returns to the picker | CODE |

---

## 9 · Sign in to a service (`SI`)

New today. One path for every App that needs an account: the needs-attention badge, the Apps rail's **Sign in now →**, the wizard's **Setup mode (sign in)…** and every service chip all open it.

| id | Do | Expect | mark |
|---|---|---|---|
| SI-1 | F10 → *Apps…* → on Netflix (or any App with *needs attention* / *not verified*) click **Sign in now →** | the wall becomes Netflix's **sign-in page** directly (the adapter's login URL), nothing over it; a small card top-right headed **Sign in · Netflix**: *Sign in here. Prism watches for Netflix to take you back, then looks for your account on the page before it says signed in.* Buttons: **↻ Back to the sign-in page**, **Cancel (Esc)**. No Done | LIVE (YouTube, via a wizard chip: the route `…/setup?return=scene&signin=1` fired and accounts.google.com redirected straight back) |
| SI-2 | Sign in on the page | the moment Netflix returns you to its own pages the probe runs (`signin probe netflix try N` in host.log). Account seen → pill *Netflix: signed in - your account was seen on the page*, the card closes, you are back where you came from; the App now badges **signed in ✓** | LIVE (YouTube: `signin probe youtube try 3: signed-in`, the card closed itself, the wizard resumed with *signed in ✓* and the store holds `evidence: probe`). Netflix / Hulu / Apple Music probes are best-effort and unverified; the fallback is SI-3 |
| SI-3 | If the probe sees nothing within ~8 s | the card says *Not there yet…* and shows **✓ I'm signed in - mark it**. Click it → badge **marked signed in** (stored as *asserted*, never as verified) | CODE |
| SI-4 | If the page still shows its Sign in control | the card says *Still signed out…* and the mark button stays hidden — you cannot mark a page that says otherwise | CODE |
| SI-5 | An App with no probe (weather.gov, AP) | on its pages the card says Prism cannot check the session and offers **mark it** at once; without marking, the App reads **reachable · not verified**, never *signed in* | CODE |
| SI-6 | A first-party App (Agenda, Chores) | the wizard is not offered; the badge reads *built in · nothing to sign in to* | LIVE (badge) |

**What the badge words mean now:** *signed in ✓* = the probe saw your account · *marked signed in* = you said so · *reachable · not verified* = only the address was seen (a signed-out visitor gets that too) · *needs attention* = a sign-in redirect was seen.

---

## 12 · Music player ↔ Video player (`PL`)

New 2026-09-19. Two items in the Prism menu, beside *Now playing*; the wall swaps between your Music Lounge and your Movie Night and back.

| id | Do | Expect | mark |
|---|---|---|---|
| PL-1 | With music playing on the lounge: F10 → **Video player · Movie Night** | the wall is the movie screen (or its empty-slot poster); the pill reads *the wall is now "Movie Night"*; the music keeps playing - no reload, no gap | CODE + core live (dev eval, 2026-09-19) |
| PL-2 | F10 → **Music player · Music Lounge** | the stage is back and the music never stopped; the *Music player* item is the one checked | CODE + core live |
| PL-3 | On the Video player, play something on the screen (or pause the music from the block) → F10 → **Music player** | the music plays on from where the video paused it | CODE + core live (paused through the block) |
| PL-4 | Remove every Movie Night scene → F10 → **Video player** | the pill says there is no Video player yet and the Movie Night wizard opens | CODE |
| PL-5 | On the Video player with Netflix up: F10 → **Watch** | the first line names Netflix and what plays (or *nothing playing*); Play/Pause, Back 10 s, Forward 10 s, Next episode, Skip intro / recap, Captions follow; then one submenu per service - **Netflix · on the screen** with its recents, *Continue watching (3)*, *My list*, and the page's rows as shelves (*Because you watched…*, *Gems for You*…), the other services with *Sign in* or *Watch on*; *Add a video service…* at the foot | CODE + core live 2026-09-19 (6 shelves, 3 Continue Watching reported) |
| PL-6 | Netflix shows "Who's watching?" → F10 → **Watch** → *Watch as Alex* → **This time** | the gate is passed, the browse page comes up; *Always, on Netflix* instead makes the wall answer the gate itself from then on, and *Stop always watching as Alex* undoes it | core live (the pick through the runtime) |
| PL-7 | *Continue watching* → a Netflix title | the title plays on the screen; the first line names it (the page names nothing while its chrome hides, so the wall keeps the name of what you asked for) | core live |
| PL-8 | *Watch on* → **Hulu · sign in** | Hulu's setup page opens; signed in, *Watch on Hulu* makes the screen Hulu and its Continue watching lists once its adapter carries video scripts | CODE |
| PL-9 | F10 → **Watch** → **Browse everything (full screen)…** | a page over the screen: *Watch* with a chip per service (Netflix · on the screen, the rest *sign in*), the screen line with its verbs, *Continue watching · every service* as artwork cards with a service badge, then *Netflix · <row>* shelves; a card plays it (switching the screen to its service first when needed); Esc or the × closes | shot 2026-09-19 (dev gate) |
| PH-1 | Prism menu, **Pair a phone…**; scan the QR with a phone on the same network | a card with the QR and "Waiting for the phone"; the phone opens the Prism page with Keyboard and Listen tabs; the card closes itself | EXEC 2026-10-04 (the card and the page; the scan is the person's) |
| PH-2 | Open a service's sign-in on the wall, press into its email field, type on the phone's Keyboard tab, press Send, then Backspace | the text appears in the field on the wall; Backspace removes a character | EXEC 2026-10-04 (desktop client into Netflix's login page on a fresh folder: "abc" then Backspace left 2) |
| PH-3 | With something playing on the wall, press **Listen on this phone** with earbuds in | the phone plays the wall's sound; the wall keeps playing for the room; Stop ends it | heard on the user's iPhone 2026-10-04 |
| PH-4 | While the phone listens, mute the wall, then move the wall's volume | the room's sound mutes and moves (at the TV or soundbar); the phone's sound does not change; when the phone stops, the wall's mute and volume are back where they were | NOT YET (device-level mapping built 2026-10-04; the first try muted both) |
| PH-5 | On an iPhone, Listen, then put the phone away (home screen, then lock it) | the sound keeps playing (the live MP3; a few seconds behind the wall); the lock screen shows Prism with pause | NOT YET (built 2026-10-04; the route verified from the desktop: 80 KB in 6 s, valid frames) |
| PH-6 | Phone, ⋯ options: **Sound: keeps playing in the background** → press it | it reads *Sound: low delay*, and the Listen tab's note changes; listening starts over in the new mode; the choice is kept on the phone | NOT YET |
| PH-7 | Phone, ⋯ options: **Page volume** (not on an iPhone, which says its buttons hold the volume) | 100% unless moved; moving it changes the phone's sound in either mode | NOT YET |
| PH-8 | Phone, Music tab while the music lounge is up | what is playing with its art; previous / play-pause / next / thumbs / mute wall act on the wall; each service opens as an accordion with its playlists and stations, and pressing one plays it on the wall | routes verified 2026-10-04 (Apple Music 21 playlists, 4 stations); NOT YET on a phone |
| PH-9 | Redeploy the host while the phone page is open | within a minute a banner: "Prism on the PC was updated. This page refreshes in 5:00", counting down; Refresh now reloads at once | seen by the user through the night of 2026-10-04 |
| PH-10 | Music tab: tap a playlist while another plays, choose **Play now** | the sound cuts at once; the list folds; the card reads the new service and collection with "Loading…" and a blank poster; the work line pulses, then "Playing … on …: <track>" and the real card | user 2026-10-04 |
| PH-11 | Music tab: tap a playlist while another plays, choose **Play after this track** | the list folds; "Next: … on …, after <track>. Drop" under the card; when the track gives way the new collection starts | user 2026-10-04 (the fold fixed the same night) |
| PH-12 | Music tab: pick a playlist, press **Reverse** at once | the chip is sent for that pick (not the one before); the work line reads "Reading the track list … 1,100 of 1,908…", "Queueing in reverse…", then "Playing Vibes reverse on Apple Music: …"; Reverse stays lit while it plays | user 2026-10-04/05 |
| PH-13 | Stop the music (or restart the PC), open the Music tab | an amber card: "Restore the previous session? Vibes on Apple Music, reverse. So Tired by Spazm at 2:21" with Restore / Not now; Restore brings the collection back in its order at the saved track and spot | user 2026-10-05: "Restore worked, picked up at 2:21 in reverse" |
| PH-14 | Video tab (the PC on the Video player): press play/pause, back 10 s, next episode; tap a Continue watching card; tune a Live channel | the PC's big window obeys; the card shows the title, art, episode and seek bar; the row's title opens on the PC | routes verified 2026-10-04; NOT YET on a phone |
| PL-10 | Hub → the **Hulu · sign in** chip (or Watch → Hulu → *Sign in to Hulu…*) | App setup with the page popped out and, along its top, the service strip **HULU · Sign in · Watch · Home · Mute / unmute · Done**; sign in on Hulu's own page; the status pill turns *signed in* once the probe sees the account (or *I'm signed in - mark it*); Done returns to the scene and the chip reads Hulu without *sign in* | CODE |
| PL-11 | Hub → the **Hulu** chip (signed in) → a Continue Watching title on Hulu's own page | the screen becomes Hulu and the title plays embedded at 720p; on a stitched ad the veil comes up with a painting and drops when the show returns | core live 2026-09-19 (veil at 19:20:35) |
| PL-12 | Hub -> a service that is signed OUT (Prime Video, HBO Max) -> its chip | the screen becomes that service's sign-in landing; within about twenty seconds the App reads *needs attention* (the session watch, evidence probe) and its badge is the way to setup; a signed-in service put on the screen reads *signed in* the same way | core live 2026-09-19 (Prime Video, HBO Max -> needs attention; Peacock, Paramount+ -> signed in) |
| PL-13 | F10 → Watch → **Browse everything (full screen)…** (Phase 2) | the five rows in order: *Continue watching* merged across services, newest-watched first with *3 days ago · Netflix* under a card only when the wall saw it play; *My list*; *Live now · <service>* where a service lists channels; *Services* as posters, every service, *sign in* where needed; *Search* with the words and a chip per service; Continue watching holds Netflix, Hulu, Tubi and Paramount+ cards with their badges once each service's page has been up (the screen or App setup), Live now lists Peacock's channels. *Service suggestions: off* in the head; on, each service's rows appear labeled *<service> suggests · <row>*. Arrow keys walk the cards; Enter plays; Esc closes | CODE (shot pending) |
| PL-14 | In the Watch menu's Search row type a title and press Enter (or **Search everywhere**) | the row under the box reads *Searching for “…”* with *still searching Hulu, Tubi…* on the status line, then fills with cards as each service answers - each badged with its service (amber when the title is the very words typed), *Service · year · Movie/Series* beneath; a service that cannot answer says why (*Prime Video: sign in first*, *Netflix: choose a profile on the screen first*); nothing on the wall changes while it searches (the surfaces are hidden). Enter on a card: the screen becomes that service and the title plays (Tubi, Paramount+ episodes) or its page opens (Hulu, a series page); a Peacock card runs Peacock's own search and presses the tile. Search on <service> chips still open one service's own search | VERIFIED 2026-09-20 (the build: dark across Hulu, Tubi, Peacock, Paramount+, Fandango, Disney+, Movies Anywhere, Netflix under its profile; the row and the status line in the shot) |
| PL-15 | In the Watch menu's Services row, right-click the Netflix poster (or press its *Who's watching?* chip) | a menu of the account's profiles with their pictures; pick one: the chip under the poster reads *as <name>* in amber, the pill says *Netflix watches as <name> from now on*; put Netflix on the screen: its Who's watching? page is answered by the wall without a press; *Search everywhere* now returns Netflix titles too; *Ask each time* in the same menu clears it and the gate is yours again. The choice survives a restart | PART 2026-09-20: the chip and the list shown; the pick made from core (Netflix as Alex) and Netflix's gate answered on hidden surfaces; the pick from the menu itself is the person's to press |
| PL-16 | Open the Watch menu a minute after boot (or after adding a title to a service's list and reopening it half an hour later) | the *My list* row holds every service's list merged, each card badged: Hulu's My Stuff (TV and Movies), Paramount+'s My List, Peacock's My Stuff, Netflix's once a profile is chosen; nothing from a list page's *Recommended* rows; Enter on a card plays it on its service (a Peacock card walks to My Stuff and presses the tile) | VERIFIED 2026-09-20 09:33-17:30 (the build: Hulu 27, Paramount+ 6, Peacock 7, Netflix 13; Tubi empty as its page says; Fandango and Movies Anywhere kept, not merged) |
| PL-17 | Open the Watch menu; the *Lens* strip under the head reads *Your own order* with no lens chosen; press *Most read on Wikipedia* | the rows re-order by seven-day article reads, each card saying its number (*120k reads · Wikipedia · 7 days*); the lens card shows what is counted / who is counted / who decides, the source, the formula and the data date; press *Your own order* to go back. With a TMDB key entered under *TMDB key…* (or dropped into `%LOCALAPPDATA%\Prism	mdb.key`, which the host reads once and deletes), cards show *★ 7.8 · TMDB · 14k votes* (never a bare number); right-click a card for the rating's disclosure and *See on IMDb* / *See on Letterboxd*; the two TMDB lenses appear; clearing the key removes every TMDB number. No lens is on after a restart | VERIFIED 2026-09-20 11:52 (the build: Most read on Wikipedia and Award winners on Wikidata laid over the rows with real numbers; no lens after a restart). TMDB waits for a personal key |
| PL-18 | With the Video player on the wall, press the **Watch** tab beside the Prism pill at the top (or Esc / the remote's Back on the bare wall) | the Watch page opens; its head carries *Prism menu* (the dropdown) and the close corner; Esc closes the page back to the wall. On the Music player the Watch tab is absent | VERIFIED 2026-09-20 14:33 by the person ("that got me there") |
| PL-19 | From the Watch page press a Continue watching card on a verified service (Hulu) | the screen becomes the service, the title plays, and within a moment the player's own full screen takes the slot - no site chrome; tap the screen (or hover the Watch tab): the stage bar appears at the bottom with the title, back 10 s / play-pause / forward 10 s, Next episode, Captions, Full screen and Watch, and hides after six seconds; an ad break drops the site's fullscreen and the keeper restores it at the break's end; Esc opens the Watch page | VERIFIED 2026-09-20 16:31-17:45 (the build: Paramount+, Hulu, Peacock, Disney+, Tubi entered the player's fullscreen on the wall's ask; the stage bar on the page's tap report); the person's own tap on the wall PENDING |
| PL-20 | Play The Rookie from Continue watching (Hulu); once it fills the screen press Space, then Right twice, then Up | Space pauses and the bar shows *Hulu · The Rookie · E7 · The Ride Along* with a progress line and *0:55 / 42:10*; Space again plays; each Right jumps ten seconds (the times on the bar follow); Up shows the bar; Hulu's own control bar never appears (faded); Esc opens the Watch page | CODE (live pending) |
| PL-21 | With a title playing on the stage press Esc (or the Watch tab), then arrow through the rows, then press the small picture | The Watch page opens with the playing title small in its top-right corner, still moving, its sound on; the page's rows and the head's verbs are clear of the corner; a focused card scrolls to the middle, never under it; a press on the player's own control in the corner acts (pause pauses); a press on the shade beside it closes the page and the title fills the screen again exactly where it was | LIVE 2026-09-21 (viewport 440x248 in the corner, restored on close; the corner's own controls reachable from 14:20) |
| PL-22 | With a title playing on the stage, tap the picture, hover the speaker on the stage bar, drag the slider to 0, then up to 60; press the speaker | The slider rises over the speaker and the bar stays while it is up; at 0 the speaker turns amber (muted) and the room is silent; dragging up unmutes and the room hears the title at the level; the press mutes again (amber) and a second press unmutes; the same speaker on the Watch head behaves the same | CODE (live pending) |
| PL-23 | With a title playing on the stage, tap the picture and read the line under the title on the stage bar; do it once on each service | The line reads the picture's size and tier and the dropped frames, e.g. *1920 x 1080 (1080p) - 0 dropped of 12k frames*, and follows the player as it changes bitrate; Hulu, Tubi, Disney+ and Movies Anywhere read 1280 x 720 or less on this machine's software DRM tier, Peacock 1920 x 1080 | CODE (live pending) |

## 13 · Watch search, Details, Library and multiview (`WS`)

New 2026-09-24 (the work of 2026-09-23, ledger VS-80 to VS-83, B-308 to B-311). None of it plays a title of yours to test: every step
that starts playback is yours to press. The marks: `EXEC` = core read back on this machine overnight (dev eval / tests), `CODE` = built and
read in code, not clicked by me.

| id | Do | Expect | mark |
|---|---|---|---|
| WS-1 | Open Watch; hover the magnifier in the header | the search box opens below the header (clear of its buttons); type *star trek* - the results open in a window over Watch: *In your lists* first, then a Top result, then *More on your services*, then People | CODE |
| WS-2 | In the results, press a service's logo in the Services row (the tick goes); press **Uncheck all**, then tick one service | each press redraws the results without that service; *Uncheck all* becomes *Check all*; with one ticked only its titles remain. Right-click a logo: *Search on <service>'s own page* | CODE |
| WS-3 | The Top result: read its service logos; press **My List** | square service logos, Details always visible at the right; My List opens a menu of the services that carry it with a list Prism can add to (or says none can) - don't press an add unless you mean it | CODE |
| WS-4 | Press **Details** on any result, scroll to the cast, press a face | Details fills one window; the person's page replaces it (pictures, newest first; *Name* sorts A-Z); press a credit -> its Details; **Back** walks back one page at a time, the Back / Close bar floating at the top; Close ends it all | CODE |
| WS-5 | Type a person's full name (*nathan fillion*) | People comes first, and the person's list holds their whole filmography (Firefly, The Rookie, Serenity, Castle, ...), not only three series | EXEC (core) |
| WS-6 | In Details, under **Watch on**, press one of your services | only your signed-in services that carry the title are listed; the press closes Details and the search and plays it in the big window - **this starts playback: pick a title you mean to watch** | CODE |
| WS-7 | Watch -> **Library** -> Group by **None**, then **Genre**; change the sort | None: one grid *All titles* in the chosen sort, bonus material under *Extras* at the end; Genre: a row per genre. Cards are landscape pictures. The count reads about 2,100 titles (Fandango ~1,960 incl. My TV, Movies Anywhere-only ~140, ~1,190 on both) | EXEC (core, 00:55) |
| WS-8 | Leave the wall alone after a boot; add a title to a service's list on your phone; come back after 20-30 min | the title is on Watch's My List without opening anything (the background re-read; mine to check: `backgroundState()` - `listsAt` / `ownedAt` set at boot); lists re-read every 20 min while quiet, the owned libraries every 6 h; the Fandango library read now takes ~93 s and is complete | EXEC |
| WS-9 | Multiview on; pick titles on five services one after another | five windows at most: the oldest small window closes for the sixth; nothing is drawn behind window 2; the strip's Swap / Turn off buttons stay in place as names change | EXEC (tests) + CODE |
| WS-10 | Play something until it moves, close Prism, start it again | the title comes back at its address. A title that never started (a page left on an episode address without playing) does not come back, and one that comes back and never starts is given up after ~90 s and not tried at the next boot - Watch never closes onto Apple TV's home | EXEC (tests) |
| WS-11 | Paramount+ and Apple TV cards on My List / Continue Watching | Paramount+'s cards are landscape TMDB pictures, not zoomed posters; Apple TV cards all have pictures | CODE |
| WS-12 | Look at the three rows under the Library link | headed *Most read about this week*, *New episodes this week*, *New movies this month* - nothing else on the line; hover a head: its count, source, formula and data date. Each card: the title and TMDB's rating only; hover a card for the reads (or date), the year, kind and service | EXEC (dev shot 08:55) |
| WS-13 | Close Prism and start it again | Watch opens once, already full - no empty page replaced by a full one; the three rows are there at once and refresh quietly | EXEC (log: one open, 2.3 s after start) |
| WS-14 | Open Watch soon after a start and rest the pointer on *Most read about this week* while it reads | nothing moves under the pointer; move away - new titles fade in at their place, others slide, none of the row flashes | CODE |
| WS-15 | Any card on Browse, search results, the Top result | TMDB's rating on each title TMDB has votes for (a film out this week may have none) | EXEC (core) |
| WS-16 | Type words in search | a *Clear* button beside *Search everywhere*; it clears the words and results, the box stays ready | CODE |
| WS-17 | Watch -> *Profiles* (or Prism menu -> *Profiles...*) | every service that has profiles, each with its picker on the current profile; services without profiles are not listed |  EXEC (dev shot 09:23) |
| WS-18 | Pick your profile on each service, type *Alex*, *Save as preset*; pick Sam's on each, save *Sam* | two chips, the one on now in amber; the Prism menu starts with *Alex* and *Sam*, the one on now checked | CODE |
| WS-19 | Prism menu -> *Sam* | the pill says how many services are switching; Watch's My List and Continue Watching change to Sam's last rows at once (or empty for a service never read as Sam), then fill with her own rows within a minute or two; *Alex* brings Alex's back at once | CODE - your first run |
| WS-20 | Watch -> the gear | Watch settings: the TMDB key (set / replace / clear), Background updates with Refresh now, and the quiet-hours checkbox off by default; Save & exit / Cancel | EXEC (dev shot 12:37) |
| WS-21 | Leave Watch open while a service is read (the dot on its poster) or switch a profile | Continue watching and My list change in place - cards fade in, leave or slide; the page never flashes; nothing moves while the pointer is on the row | CODE |
| WS-22 | Watch: read the heads of Continue watching and My list | each has its order pills and a round reverse switch; Continue watching opens on **A to Z**, My list on **New first** (hover it: the rule in words) | EXEC (dev shot 22:19) |
| WS-23 | Continue watching -> **By service** | the titles group by service, the services A to Z and each one's titles A to Z; a chip per service appears beside the head (none for one service); press one - the row glides to that service's first card | EXEC (dev shot 22:33, jump 22:02) |
| WS-24 | Press the reverse switch on each row | it lights amber; A to Z becomes Z to A; By service goes Z to A twice; New first keeps the bannered titles in front, each group Z to A; the row starts again at its first card | EXEC (dev shot 22:28) + CODE |
| WS-25 | Close Prism and start it again | each row keeps the order and reverse you left it on | EXEC (tests) |
| WS-26 | Drag a card from any row (Most read, New episodes, The Binge...) onto the big window - **this starts playback: pick a title you mean to watch** | the card lifts and drops like a Continue watching card; the window shows *Starting on <service>...* in its place until the title plays, and the service's search and pages never show in the corner | CODE |
| WS-27 | Start a title from a card and, on the start screen, press **Details** | the start carries on; Watch opens with the title's Details over it (the series, not the episode), left of the video windows, the big screen whole and undimmed | EXEC (dev shots 21:07, 21:29) |
| WS-28 | Remove a card from Continue watching or My list (its menu) | the card turns to dust and the gap closes; a removal the service refuses brings the card back whole | EXEC (dev hook) |
| WS-29 | Clear a screen that was playing a title new to that service's Continue Watching | the title appears on Watch's Continue watching within about a minute (reads at 10 s, 45 s, 2 min, 5 min, stopping once it is there) | EXEC (tests) |
| WS-30 | With the *Alex* set on, hide a title in The Binge; switch to *Sam* | Sam's Binge still shows it; back on Alex it is hidden. A title Prism found missing on its service stays hidden for both | EXEC (tests) |
| WS-31 | Open Watch with a title in the big window | the service's mark in the window's top-left corner with no background (the title in its tooltip); the bar at the foot carries the playback verbs, then the playlist control: *None* or the selected playlist with a chevron, Play when one is selected, a pencil; no title line and no verbs between the tabs and the service suggestions | EXEC 2026-10-01 (shot on the wall; the dev press opened the menu, its items not pressable from here) |
| WS-32 | Pick a playlist from the bar's drop-down and press Play; then play another title from Watch | the playlist starts where it left off and the control reads *Star Trek · 3 of 12* with Play now Stop; the other title ends the run and the control drops to *None*; Stop instead keeps the selection and Play carries on | NOT YET (needs a hand at the wall: never start the household's playlist from here) |

## 14 · Live (`LV`)

New 2026-09-29 (docs/features/live.md, ledger VS-91). A channel is live television: tuning one plays whatever is on it. The marks: `EXEC` = read back
on this machine (dev eval, dev shot, host.log), `CODE` = built and read in code, not clicked by me.

| id | Do | Expect | mark |
|---|---|---|---|
| LV-1 | Open Watch and press the **Live** tab | type chips with counts (All first), a search box, a line saying when each service's guide was read, and the schedule: channel names fixed on the left, programs to the right starting at *Now* | EXEC (dev shot 09-29 12:09) |
| LV-2 | Drag the schedule sideways | it scrolls as far as the services list (3 to 12 hours); the channel names stay put | CODE |
| LV-3 | Press a type chip (News) | only that type's channels; the count on the chip matches the rows | EXEC (dev eval: every type's rows match its count) |
| LV-4 | Type `frasier` in the search box | the channels showing it now or later, the matching program ringed amber; `zzzz` says nothing matches | EXEC (dev eval) |
| LV-5 | Press a Paramount+ channel row, then **Watch in the big window** | Watch closes, the start screen names the channel, the channel plays within about ten seconds; the bar names the channel and the program | EXEC (CBS News 24/7, 90s Sitcoms) |
| LV-6 | Press a Peacock channel row, then **Watch in the big window**; then the same channel again | it plays both times (the second press changes nothing) | EXEC (America's Funniest Home Videos twice) |
| LV-7 | Press a channel row, then **Add to window 3** | multiview comes on; the channel plays in that window, muted; the big window keeps its sound | EXEC (Peacock + Paramount+ beside a Peacock big window) |
| LV-8 | Leave a channel on through the end of its program | the next program plays; nothing is paused or muted, Watch does not come back | CODE (tests) |
| LV-9 | Close Prism and start it again with channels on | each window comes back on its channel | EXEC (three windows, 09-29 12:06) |
| LV-10 | Tune a channel a service will not play | within about ten seconds the wall says the channel did not start, in words | EXEC (before the Peacock fix) |
| LV-12 | Press a channel row anywhere along its schedule | the channel's menu opens at the point pressed and stays until you choose or click away | EXEC (dev hook at 600,420: drawn at 600,420) |
| LV-13 | With a Paramount+ big window and two Paramount+ windows, add a third Paramount+ channel | refused: *Paramount+ plays 3 at once on one account. Close one of its windows first* | CODE (test) |
| LV-14 | Tune a channel whose player never starts | reopened in place after ~35 s, in a fresh window after another minute, then the wall says it did not start | EXEC (two Paramount+ windows: try 1, try 2, gave up) |
| LV-15 | Add two Peacock channels to windows within two minutes of a restart | both tune (the boot self-heal leaves windows added after the boot alone) | CODE (test); the household read both playing later that night |
| LV-16 | Open the Live tab while Apple TV is signed in | the APPLE TV group first in the grid: the MLS match on now with LIVE in amber on its row and its program block on now, the week's matches and the F1 weekend's sessions as rows saying when they start, the Sky Sports feeds marked (the separate events strip was dropped 2026-10-01) | EXEC 2026-10-01 (the rows on the wall: F1 Weekend Warm-Up in 3 h 27 min (4:30 AM), Seattle vs. Kansas City Today 9:30 PM; no match live at the time) |
| LV-17 | Press the match on now | the event's page opens in the target window and plays | FAILED 2026-09-30 (the window opened at the page, the script pressed Watch, Apple's player never appeared, the pick timed out and the window closed) |
| LV-18 | Look at the grid with two services' guides read | the channels grouped by service, the services by name, a header a service; *Jump to* chips (the service's mark and name) above the grid scroll to each header | EXEC 2026-09-30 (Paramount+, then Peacock; the chips as above Continue watching) |
| LV-19 | Press the Sports chip; close the hub; open the Live tab again | Sports mode: the title, only sports rows, each program on now marked with its sport; the mode is on again when the tab opens | EXEC 2026-09-30 (the title and marks on the wall; the mode came back after a restart) |
| LV-20 | Open the Live tab in Sports mode | under SPORTS MODE, the last 24 hours' games as even cards in one grid, two rows at most with *Show all N* as the last cell: league with the sport's mark, team marks and colour stripes, names (a long one shrunk to fit) and scores, the winner in amber, LIVE / final / to-come glyphs, *yesterday* on a game not today's; a live game a signed-in service carries has a *Watch on* chip; no caption under the title (the count, source and read time are the title's tooltip) | EXEC 2026-10-01 (ten cards and *Show all 13*; Jaume Munar whole; no Watch chip, no service carried a live game) |
| LV-21 | Look at the guide's rows | the time line and the half hours in ink, a faint rule under the time line and under every row across names and schedule, no vertical rules; a group begins with a gap and no service header; *Jump to* chips name the services; an event row says *Starts in 3 h 27 min (4:30 AM)* within twelve hours and *Starts Tomorrow 12:10 AM* beyond, and LIVE in amber on its second line while on | EXEC 2026-10-01 (shots on the wall; no event live at the time) |
| LV-24 | Press the Drama chip (or any mode but Sports and News) with a TMDB key on the device | under the mode title a *Now on* checkbox (on) and a row of posters: a show on across the mode's channels with TMDB's year and rating and the channel's name under each, *N more* at the end; a show part-way through has its poster grey up to an amber line and in colour after; the tooltip says "42 min in, 18 min left"; a press tunes the channel; a loop channel named after a show (Peacock's) shows that show | EXEC 2026-10-02 (Drama: nine posters and *5 more*, Lioness and CSI: Miami part grey; the press not tried from here) |
| LV-25 | Look at Entertainment mode after the TMDB lookups | the show-named channels have moved to Comedy, Reality, Drama or Kids with "by TMDB's genre for <show>" in their tooltip; Entertainment keeps the variety channels (Bounce TV, Court TV) | EXEC 2026-10-02 (45 to 28 on the wall) |
| LV-26 | Press the Movies chip while a Paramount+ channel is showing a film | the chip's count includes that channel; Movies mode lists it beside Peacock's movie channels with its own type (Drama) on its second line and "Listed under Movies while <film> is on, a film by TMDB's word" in its tooltip; the Now-on strip shows the film's poster, part grey for the time elapsed | EXEC 2026-10-02 (Collateral on the Movies channel, Movies 3 to 4) |
| LV-27 | Press the Kids chip | the Now-on posters carry TMDB's US rating in bold on their line (TV-Y, TV-Y7, TV-G); a title rated above that shows its rating in amber; the tooltip names the rating as TMDB's | EXEC 2026-10-02 (The Thundermans TV-G, Peppa Pig TV-Y, SpongeBob TV-Y7, Wheel of Fortune TV-G; none amber at the time) |
| LV-28 | Look at the mode chips with Peacock's NBC stations in the guide | no Local chip; the stations are under News (Local is only a station a service assigns as the household's own, none on the wall yet) | EXEC 2026-10-02 (taken out at the user's word: "local for me would be Centre County PA") |
| TA-1 | Watch settings, General, with a TMDB key set: press **Link my TMDB account** | a card over the settings: "Approve Prism on TMDB", a QR of the approval page, *Open here*, *I approved it*, *Not now*; Esc or a press beside the card closes it | EXEC 2026-10-03 (the card and QR on the wall; TMDB issued the token) |
| TA-2 | Press **I approved it** before approving | the pill says TMDB has not seen the approval yet; the card stays | EXEC 2026-10-03 (TMDB answered 401; the pill said so) |
| TA-3 | Scan the QR on a phone, sign in to TMDB, Approve, then press **I approved it** | the card closes, the pill says "TMDB account linked as <name>", the settings line reads *Linked as <name>* with *Unlink* | NOT YET (needs the household's TMDB login: a hand at the phone) |
| TA-4 | Open a title's details while linked | under TMDB's rating, "Your rating" with ten stars, the account's own rating lit if it has one; a press on a star rates it on TMDB (the pill confirms), the lit star pressed again takes it back; unlinked the line reads "Link your TMDB account to rate" | unlinked half EXEC 2026-10-03 (Top Gun's page); linked half NOT YET |
| TA-5 | Open Watch with a TMDB account linked | the second row is *My Watchlist* (the account's watchlist, Browse-style cards with the services that carry each), with *Add N titles from your services' My Lists* while some aren't on it; the services' own My List row is gone | EXEC 2026-10-03 (empty watchlist, the offer read 36) |
| TA-6 | Press the offer | progress "Adding ... N of M", then "Added X, already there Y, Z TMDB couldn't match" (the unmatched in its tooltip); the row fills | NOT YET (a write to the household's TMDB account: their press) |
| TA-7 | Right-click a card; open a title's page | *Add to My Watchlist* / *Remove from My Watchlist* in the menu; *My Watchlist* toggle on the page in place of the services' My List; the services' Add to My List items absent | NOT YET (writes; their press) |
| TA-8 | Unlink in Watch settings, reopen Watch | My list is the services' own lists again, read as before | NOT YET |
| TA-9 | Open the Playlists tab with no TMDB account linked (or a v3 key, or an account linked before lists) | the gate: "Playlists live on your TMDB account", the missing step in amber, *Open Watch settings*; no playlists drawn | NOT YET |
| TA-10 | Open the Playlists tab with the account linked with lists | the account's TMDB lists as playlists (one made on TMDB's site is every episode of its shows, nothing watched); *On your TMDB account* with a read-now; *Copy my N earlier playlists to TMDB* once while the device's own earlier playlists exist | EXEC 2026-10-03 ("Test 1" from the account; the copy offer for the Star Trek playlist) |
| TA-11 | **New playlist**, tick *Public on TMDB*, name it; send a film to it from a card's menu | the playlist appears with a globe mark; within seconds the line says *Saving ... to TMDB*; on TMDB's site the list exists, public, the film on it with a comment "Prism: 2026-10-03 ..." | EXEC 2026-10-03 (private "Prism test", a film, the comment read back; deleted after) |
| TA-12 | Play from the playlist for a few minutes, then stop | the entry's comment on TMDB gains "now S1E1 m:ss"; at ten minutes "watched S1E1" | NOT YET |
| TA-13 | Press the lock on an open playlist's head | the mark turns to a globe and the list is public on TMDB (and back) | NOT YET |
| TA-14 | Delete a playlist, wait a minute | gone here at once (Undo for a moment), off TMDB after the undo window | EXEC 2026-10-03 |
| TA-15 | Press *Copy my N earlier playlists to TMDB* | the device's earlier playlists appear as private lists here and on TMDB (the Star Trek one: a handful of show entries, episodes as ranges); the offer is gone after; the originals stay in the store | NOT YET (the person's press) |
| TA-16 | On a second device signed in to the same account, open Playlists | the same playlists, episodes rebuilt from TMDB's seasons, the watched marks and the spot as written; a mark made there shows here within ten minutes (or Refresh) | NOT YET (no second device) |
| WS-33 | Watch settings, the **Performance** tab | two switches (stats at the foot of the Watch page, readers dark) and the panel: five charts over the last hour with the latest value in amber, the split by service, the busiest pages, the host's traffic line | EXEC 2026-10-03 |
| WS-34 | Tick *Performance stats at the foot of the Watch page*, Save & exit, scroll the Watch page to its foot | the same panel, compact (no busiest pages, no traffic line), refilled each minute | NOT YET (dev shot can't scroll) |
| SN-9 | First boot after the one-browser build, with legacy profile folders | host.log "profile move: N legacy profiles onto shared ones" then "done"; diagnostics/profile-move.md lists each folder's cookies, storage keys and databases; the old folders are still there with a `.prism-moved-to-shared` marker; every service that was signed in reads signed in; perf.log shows one profile "shared" | EXEC 2026-10-03 (all signed in but Amazon Music and Pandora: Amazon's session was spent by the rehearsals) |
| SN-10 | Add a second sign-in for Apple TV | its profile is `shared-2`; the window opens in a second browser; a Netflix sign-in added for the same person lands in `shared-2` too | NOT YET |
| WS-35 | Leave the wall with nothing playing for ten minutes, then the hub request "perf" | host.log says "music parked: <each music facet>"; the per-process lines show each music page under 20 MB; a Play on a music service wakes it first (no stale frame, sound within a few seconds) | EXEC 2026-10-03 (parked: Apple Music 430 -> 13 MB, Spotify 216 -> 18, Amazon 160 -> 9, Pandora 147 -> 11; the Play wake not yet pressed) |
| LV-23 | Press the News chip while CBS News 24/7 has a show with a feed on (the Daily Report, the Evening News, CBS Mornings) and Peacock is signed in | under NEWS MODE a front page a network: the masthead (CBS NEWS in a serif, the show in italics, a chip *CBS News 24/7 on Paramount+* that tunes it), the headlines in a bold serif down three columns with a hairline between and the time after each (*yesterday* when not today's), nine at a time with *N more*; NBC NEWS the same from its section feeds; the masthead's tooltip names the feeds, the read time and the rules that left items out; a headline's press tunes the channel in the big window | EXEC 2026-10-02 (the Mornings segments and NBC's on the wall; the press not tried from here) |
| LV-22 | Hover **Refresh** | the tooltip lists each service's channel or event count and read time; the row beside it says only *Reading the guides...* while one is read | EXEC 2026-10-01 |
| LV-11 | Press **Refresh** | the guide line says *reading its guide* for each service, then the new time | EXEC |

## 15 · A new device (`FR`)

New 2026-09-29 (docs/features/first-run.md, ledger VS-92). Run on an empty data folder: `pwsh scripts/run-fresh.ps1 -Capture`. The household's own
store is never touched. `EXEC` = read back on this machine (dev shot, host.log, dev eval); `CODE` = built and read in code, not pressed by me.

| id | Do | Expect | mark |
|---|---|---|---|
| FR-1 | Start Prism on a device that has never run it | the welcome page: *Welcome to Prism*, the services under MUSIC and VIDEO, **Select all**, **Clear**; nothing plays under it | EXEC (the page); CODE (the empty wall under it) |
| FR-2 | Press a few services, then **Continue** | the wall becomes the Video player; the page lists the chosen services, each *Not signed in yet* with **Sign in** | EXEC |
| FR-3 | Press **Sign in** on a service with a sign-in page (Tubi) | the service's sign-in page, in a window with the bar *Sign in, Watch, Home, Done*; the card claims nothing until the page shows an account | EXEC 2026-09-30 (the window, the bar Sign in / Watch / Home / Done, the card "Not signed in yet" on Tubi's login page; the page itself is not in a dev shot) |
| FR-4 | Press **Sign in** on Apple Music or Apple TV | the service's own page, its Sign In sheet opened for you | CODE (tests on sample pages; the pages' controls read in a headless browser) |
| FR-5 | In that window press **Home**, then **Sign in** on the bar | the service's home; then its sign-in again | EXEC 2026-09-30 (Home went to tubitv.com, Sign in back to /login) |
| FR-6 | Press **Watch** on the bar | the window closes and Watch opens | EXEC 2026-09-30 (the window destroyed, Watch open with the two services) |
| FR-7 | Sign in, or press **Cancel** | back on the list; the row says *Signed in* once the page showed your account | CODE (nobody has signed in through the page yet) |
| FR-8 | Press **Done**, close Prism, start it again | Watch, with your services; both players in the Prism menu | EXEC (the players stood after a restart) |
| FR-9 | Prism menu, **Music player**; then the stage's **Visual style** | the stage draws; the style list opens with every style | EXEC |
| FR-10 | Prism menu, **Set up services**, **Add more services**, choose two more, **Continue** | they join the players that stand; nothing is made twice; your style is kept | EXEC |
| FR-12 | On the sign-in list press **Remove** on a video service and on a music service | each leaves the list, the players and Watch; the pill says its sign-in is kept; the stage draws another music service | EXEC |
| FR-13 | Close Prism, start it again, open **Set up services**, choose the music service again, **Continue** | the removed services were still off after the restart; the one chosen is back among the sources | EXEC |
| FR-14 | The whole first run on an empty data folder with the one-browser build (0.16.0): welcome, three services, Continue, Sign in on one, Cancel, Done, then the Playlists tab | the welcome page, the sign-in list (0 of 3), Spotify's sign-in window with its side card, back on the list, Watch with the services row (Netflix on the screen, Paramount+ "Sign in first") and the big window; Playlists is the gate naming the read access token | EXEC 2026-10-03 (dev walk; nobody signed in) |
| FR-15 | The one-page welcome (2026-10-03): on an empty data folder press a service's card, then Cancel in its window | every service a brand card, A to Z under Music and Video, paged (‹ 1 of 2 ›) when a player has more than two rows; the press makes the players and opens the service's sign-in page at once; back on the page the card's caption reads *Not signed in* (or *Signed out* once its page was seen), the title is *Your services*, the foot has **Done**; a right-click on a set-up card offers to take it off | EXEC 2026-10-03 (Spotify: players made, the sign-in opened, cancelled, the card captioned Signed out) |
| PL-9 | Look at the top-right of the window on the Video player, then press **Music** there; on the Music player press **Video** | a Music / Video toggle hangs from the top edge on both players, the wall's lit in amber; each press switches the wall as the Prism menu does, and the other side lights | EXEC 2026-10-03 (dev presses both ways) |
| FR-14 | Put an adapter and its catalog entry in the data folder's `adapters` and `catalog`, start Prism | the service is on the first page and, once chosen, in the Video player; its row says *added on this device*; a broken file is named in host.log and nothing else is affected | EXEC (a made-up Crunchyroll entry and a broken file) |
| FR-15 | On a new device choose Apple Music, Apple TV, Amazon Music and Prime Video, **Continue** | the list says *same sign-in as Apple TV* on Apple Music, and so on; two profile folders serve the four | EXEC |
| FR-16 | Sign in to Apple Music, then press **Sign in** on Apple TV | Apple TV is signed in already, or asks only to continue | NOT RUN (needs a person's sign-in) |
| FR-11 | On the welcome page press **Not now** | *Nothing is set up yet*, with a **Set up services** button | EXEC 2026-09-30 (the note and its button, on screen) |

## 16 · Sign-ins and profile sets for both players (`SN`)

New 2026-09-29 (docs/features/sign-ins.md, ledger VS-93). `EXEC` = read back on a test data folder (dev shot, host.log, dev eval);
`CODE` = built and tested in core, not pressed by me.

| id | Do | Expect | mark |
|---|---|---|---|
| SN-1 | Prism menu, **Profiles** | the Profiles window; under **Sign-ins** every service, music under MUSIC PLAYER and video under VIDEO PLAYER, each *Signed in as* Household | EXEC |
| SN-2 | On Apple TV choose **Sign in as someone else**, type a name, **Continue** | Apple TV's own sign-in opens, in a browser profile of its own; the first sign-in is untouched | EXEC (the window opened in the new profile; nobody signed in) |
| SN-3 | Close the sign-in; in the window choose that name for Apple Music too | it is in Apple Music's list already, with no new login | EXEC |
| SN-4 | Type the name at the foot, **Save & exit** | both services move to that sign-in; the set is saved; a set called Household was kept to switch back to | EXEC |
| SN-5 | Prism menu, **Profiles**, choose Household | every service goes back to the first sign-in, signed in as it was left | EXEC 2026-09-30 (the set applied by dev eval: Tubi back to Household, the others untouched) |
| SN-6 | With a person's set on, switch Music player to Video player and back | nothing is asked, nothing moves, the music page stays loaded | EXEC 2026-09-30 (three switches with Maya's set on: nothing asked, no sign-in moved, the music page never made again) |
| SN-7 | Close Prism and start it again | each service is on the sign-in it was left on; the sets are there | EXEC 2026-09-30 (after a restart: Tubi on Maya, both sets there, Maya's active) |
| SN-9 | Sign in to Netflix, Paramount+ or Fandango at Home, wait a minute, open **Profiles** | its sign-in is named with the part of the account's email before the @; nothing was typed | EXEC (the three named on the household's wall, 19:38) |
| SN-10 | Right-click a sign-in, **Rename**; right-click a preset, **Rename** | the new name everywhere that sign-in is used; a later read of the account page does not change it | CODE (tests); the rename itself EXEC by dev hook |
| SN-8 | Sign in as the second person, then open Watch | her rows, not the first person's; the first person's come back with their set | NOT RUN (needs a person's sign-in) |
| SN-11 | Right-click a sign-in that is not in use, **Take X off the list**; then right-click again, **Bring back X** | it leaves the list and comes back; the one in use and the last one cannot be taken off (the item is disabled, the reason in its tooltip) | EXEC 2026-09-30 by dev hook (Maya off Tubi's list after a switch, refused while in use and for the last one, back again); the menu itself CODE |

## Notes and known gaps found in this audit

- **N-1 · boot follows the last *applied* document, not the rail's active pointer.** Editing `scene-model:active-scene` in the store by hand does nothing to what boots; the rail can therefore mark one scene active while the wall shows another (only after outside edits — the app itself keeps them together). Filed as a ledger note, not fixed.
- **N-2 · Family Hub is 9:16.** In a 16:9 window it applies, but as a portrait canvas in a landscape frame. Rotate the frame or accept the letterbox; not a bug.
- **N-3 · the seeded Music Lounge has no service** by design (the seed invents no account). It is a poster, not a player. Yours (`music-lounge-1`) is the working one.
- **N-4 · `onActivate: play`** — never observed firing on the wall; the tap-to-reveal-and-press-play path (ML-7/8) is the supported start today.
- **N-5 · the §32 observer picks the first non-paused media element** — a decorative promo clip can outrank the real player until the real one plays (B-102's note).
- **N-6 · resolved:** the card left of the lounge wall in captures is the hidden facet's face, parked off-canvas by design until revealed.
- **Fixed today:** Calendar role pre-resolves to the Agenda tile (was a dead `merge` chip); the seed assigns it; the wizard suggests an unused scene name instead of creating twins; *Change apps…* / *Choose an app…* / *Choose the music service…* (B-105 family); reshaped survivors rebuild on Save (B-107); the wizard steps aside for App setup (B-108); empty slots name their role (B-109); full motion on by default.
