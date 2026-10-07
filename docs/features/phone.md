# The phone: a keyboard for the wall, and private listening

2026-10-03: "can we create a simple web app delivered via QR codes directly from the Prism software enabling keyboard entry from
phones. The app should also enable the private listening feature through the phone sound."

## What a person does

1. Prism menu, **Pair a phone…** A QR code over the wall (MainWindow.PairPhone.cs). Scan it with the phone's camera; the page the
   host serves opens (Services/RemotePage.cs), with the pairing token in its address. The card closes when the phone connects.
2. **Keyboard.** Press into a field on the wall (a sign-in page's email box, a search box), type on the phone, press Send or Send +
   Enter. The text lands in the focused field; the arrows, Enter, Backspace and Tab are keys below the box. Above the box the phone
   names what it is typing into, in the page's own words ("Email or mobile number", "Netflix · text · 3 characters there"); when
   nothing on the wall is focused it says so and Send is off. The field's contents are never shown, only how many characters it holds
   (2026-10-04, "look alike labeling for the fields on the screen"). The strip also says the field's role as the wall's browser
   reads it - *username* or *password*, from the autocomplete hint, the type, or a password field beside it in the same form - and
   a password on the wall is typed into a masked box on the phone (Show to peek), so the phone's own keyboard neither learns nor
   suggests it. Whether the wall's password manager offers to save is the page's doing (its own markup); the phone's text arrives
   through the browser's input pipeline like a keyboard's, so the offer should come as it would for one - to be seen on a real
   sign-in.
3. **Listen.** Earbuds in, press *Listen on this phone*. The wall's sound plays on the phone. The wall keeps playing for the room:
   while a phone listens, the wall's mute and volume act on the playback device (the TV or soundbar) and the phone has its own
   (2026-10-04, "We should have volume separation between the two"). Two ways to carry the sound, swapped under the page's options
   (the ⋯ menu): *keeps playing in the background*, a live MP3 the phone's own player fetches, which goes on with the page put away
   or the screen locked, a few seconds behind the wall (the default on an iPhone); or *low delay*, a tenth of a second behind, which
   a phone stops when the page is hidden (the default elsewhere). The page's own volume is under the options too, 100% unless moved;
   an iPhone ignores a page's volume and keeps its own on the buttons, and the page says so there. The tab is *Remote Listening*. In
   the background mode the status line says how many seconds the phone holds (that is how far behind the PC it hears) and, while
   filling, a share of what it needed last time before it played; a pause from the Music tab pauses the phone's player at the same
   moment, and Play fetches the stream fresh, since the PC's pause alone would play on here until the buffer ran dry.
4. **Music.** While the Music lounge is on: the card (the service and the collection it holds, the track with its art from the service's
   own artwork address, "0:20 of 1:40" with what is left and a thin bar advanced each second between polls), the transport (previous,
   play/pause, next, thumbs, Mute Prism on PC - the buttons read the PC's real mute), the order chips (In order / True shuffle / Reverse
   and a standing Repeat, the PC's own choices and limits: a station has no order, a service without track lists has no true shuffle)
   and the services' Quick play as an accordion (`GET /music/quick`, `POST /music/play`, `POST /music/repeat`; 2026-10-04).
   - A tap on a collection while something plays offers *Play now* or *Play after this track*. Play now cuts the sound at once (every
     other playing source is paused), folds the list, and the card becomes the new service and collection with "Loading…" and a blank
     poster until the PC's pending pick clears and the page names the track; the work line pulses with the PC's own words and counts
     ("Reading the track list of Vibes on Apple Music 1,100 of 1,908…", "Queueing in reverse…") and ends with "Playing Vibes reverse on
     Apple Music: …". *Play after this track* queues one pick in core (`POST /music/play {"when":"next"}`, `DELETE /music/next`), shown
     under the card as "Next: … Drop"; it starts when the playing page names another title or stops at its end, never on a pause.
   - The chips act on the pick in flight before the card's source (a reverse pressed while a pick still loads goes to that pick); the lit
     chip is the PC's standing order only when it is for the collection playing now. While a Prism-made queue plays (true shuffle,
     reverse) the page names no playlist, so the card's collection falls back to the standing order.
   - "Up next on Apple Music: … by …" under the card while no pick is queued: Apple Music's player holds its queue, so the next track is
     readable; Spotify, Pandora and Amazon Music show none on the page without their queue panels.
   - **Restore the previous session** (2026-10-04): what the audible source held is written to the store as it plays (collection, order,
     repeat, track, spot; `music:last-session`); while nothing plays the Music tab offers it ("Restore the previous session? Vibes on Apple
     Music, reverse. So Tired by Spazm at 2:21"). Restore plays the collection in its order (a standing Prism order carries on at its
     saved spot), then asks the service's own player to jump to the track and seek to the spot (Apple Music adapter verbs `jumpto:` and
     `seekto:`); a station starts where the station starts; Spotify and Pandora have no player verbs Prism can reach, so they come back
     to the collection and order only. Verified live 2026-10-05: "picked up at 2:21 in reverse". `POST /music/restore`, `DELETE
     /music/restore`.
   - A signed-out service's row opens its sign-in on the PC (`prism://app/:id/setup`) and brings up the Keyboard tab; a press on a
     signed-out source says so instead of sending into the service's gate (Pandora's "Keep the music playing for free").
   - The card is the stage's source, else a source that plays, else "Nothing playing" with the stage's service named; a paused leftover
     on another service never takes the card.
4b. **Video.** While the Video player is on: the Watch screen without the picture, for a phone (2026-10-04, "a full watch (with no
   video) page for video ... Optimizes for mobile"). The big window's title with its art (TMDB's poster as the PC's bar shows it),
   season and episode, the service, a seek bar (the spot goes when the finger lifts; off for a service whose adapter cannot seek),
   and the bar's own verbs: start over (the previous episode in the first 5 s, the PC's rule), back 10 s, play/pause, forward 10 s,
   next episode, skip intro (shown only while the service offers a skip, 2026-10-05), captions (a sheet of the service's own
   subtitle and audio tracks as the PC's menu lists them, the one in use marked, a tap picks it on the PC, Close lets a service's own
   panel close - `POST /video/tracks`, `/video/track`, `/video/tracks-done`; a service without a tracks script gets its own captions
   button pressed on the PC instead, 2026-10-05), mute Prism on PC. The page's own error under the card in amber with a Retry
   button (2026-10-05, Netflix's "Too many people are using your account right now" and its screens: Retry is the `retry` tile
   command, which presses the page's own Retry through the adapter's videoCmd, or opens the title again where the page has none;
   the Upgrade button is never pressed). Below: Continue watching and My list as
   poster rows (the same cards and order as the PC's rows, 40 each), and Live as an accordion by service with what is on - a
   service's live events (Apple TV's Formula 1 and MLS) among its rows as on the PC's tab, the series before the event's name
   (2026-10-05, "Isn't Live supposed to show the Formula 1 stuff from Apple?": the list had come from the channel guides alone). A press
   plays on the PC through the same calls the PC's own cards make (`GET /video`, `POST /video/play`, `/video/tune`, `/video/seek`,
   `/video/start-over`, and `/tiles/{id}/command` for the verbs). Never a picture: the services' video is DRM and Prism does not
   touch it (docs/third-party-services-policy.md); the sound comes by Remote Listening.
5. **Options (⋯).** *Prism on PC: Music lounge | Video* switches the PC's player (`POST /ui/route {"route":"prism://player/music"}`,
   dispatched through the PC's own player switch; `GET /players` says which exist and which is on). The Music tab is only shown while
   the Music lounge is on. Add to home screen (the phone's own instructions; the icon opens the wall already paired through the manifest's
   start address), the sound mode, the page's volume, Forget this wall. When the wall's software changes the page (its version at
   `/remote/version`, a hash of the page and the host's version), a banner says so and the page refreshes itself in five minutes, or
   at once on *Refresh now*.

## How it works

- The page is one static HTML page in the host, no build, no framework, served at `/remote` on the §6 listener (port 8471, the
  home network). Every call carries the pairing token core minted (`remote.ts`); a phone forgets the pairing with DELETE /pairing.
- Keyboard: `POST /keyboard/type {text, submit?}` and `POST /keyboard/key {key}` (core remote.ts). Core picks the target
  (`orchestrator.keyboardTarget`): a service's setup window when one is up, else the tile a person entered, else the screen. The host
  types through the DevTools protocol's own input (`Input.insertText`, `Input.dispatchKeyEvent`): trusted input into whatever the
  page has focused, as a keyboard's (SurfaceManager.PhoneKeys.cs). Nothing typed is kept or logged; the request body never reaches
  a log.
- Listen: `POST /audio/stream-ticket` (core, §14) gives a short-lived ticket; the phone opens a WebSocket at `/audio/stream?ticket=`
  which the host redeems with core and serves (Services/ListenStream.cs): the shared browser's own sound through the process loopback
  the visualizer uses, 16-bit PCM at 48 kHz stereo in 20 ms frames, about 1.5 Mbit/s. One capture serves every phone. The page plays
  it through the Web Audio API with a short lead; a phone that falls behind has frames dropped, not queued. The same ticket opens
  `GET /audio/live.mp3?ticket=`, a live MP3 at 128 kbit/s (NAudio.Lame, one encoder for every MP3 phone, started with the first and
  stopped with the last), served Icecast-style: `audio/mpeg`, no length, `Connection: close`. The phone's `<audio>` element plays it,
  which is the one kind of sound a phone keeps playing in the background; a phone that cannot take a chunk within a second is
  dropped. The process loopback taps AFTER a page's own mute and a session's volume and BEFORE the device volume, so while any phone
  listens (SurfaceManager.PrivateListening.cs) the audible pages' mutes are lifted, the sessions sit at full level, and the wall's
  mute and volume are mapped onto the playback device (NAudio endpoint volume); when the last phone leaves, the pages' mutes and the
  device's state go back where they were.
- Measured 2026-10-04 (desktop client): 200 frames in 4 seconds, real time; the capture starts with the first phone and stops with
  the last. Heard on the user's iPhone the same day after the audio context moved inside the tap (iOS unlocks only sound made in a
  gesture). The MP3 route: 80 KB in six seconds, valid frames from the first byte. Still to hear on the phone: the MP3 mode with the
  page minimized and the screen locked, and the mute separation.

## Decisions

- A login modal that fills the services' fields was asked for and declined (docs/roadmap.md): the phone keyboard is the way to type
  on a wall without one, and the browser's own password manager remembers the sign-in after the first.
- Plain HTTP on the home network (§6's trusted LAN); the token is in the QR alone, never on the status line or in the log.

## Which window the phone hears (2026-10-05)

"Remote listening for video should allow the user to select which window they're listening to. In the main app, we normally only
let the big window play sound. But with remote listening, we should allow any 1 (big or mini) window to be selected." With multiview
on, the Remote Listening tab shows a chip a window, big first, each with what it plays; the chosen one takes the audio the stream
carries (`GET /audio/windows`, `POST /audio/listen-window {tile|null}`; core's `setListenWindow`). The PC's speakers are muted while
a phone listens unless the phone's switch says otherwise, so the room keeps hearing nothing or, with the switch off, hears the chosen
window too - the person's choice. A swap keeps the choice; the last phone leaving gives the sound back to the big window (the host
clears it). A window that plays by itself while another is heard stays quiet, as a small window always did.

