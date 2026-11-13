# The listen page: a view-and-listen page for the house

Asked 2026-10-31:

## What a person does

1. On the PC, the PRISM menu's **Listen page** opens a card with one switch; on the phone, the companion app's menu (the three dots)
   has the same entry with the switch, the address to open or copy, and New address (`GET`/`POST /listen-page`, a paired phone;
   2026-10-31). The PC's card opens a card with one switch. Off is the default. On, the card shows an address
   (`http://<the PC>:8471/listen?key=...`) and a QR code for it. The switch and the address stay as they are across restarts; off
   again, the address answers a page that says the listen page is off.
2. Anyone on the home network opens that address in a browser: a kitchen tablet, a laptop, an Echo Show's Silk browser ("Alexa,
   open Silk", then the address, then a bookmark). The page is Sunrise Meadow drawn from the PC's own bands, the song at the bottom
   left as the PC's lounge shows it (the service and collection, the title, the artist, the album, the clock), and one button:
   **Listen**. A browser plays nothing until someone taps, so the button is unavoidable; a browser that allows it starts the sound by
   itself on a later visit.
3. The sound is the PC's, three seconds behind it, the same three seconds the room in step and a phone's Private Listening keep, so
   every listener in the house hears the same moment (2026-11-03). It suits another room; beside a PC that is not in step it is an echo.
   **Earlier** and **Later** beside Stop move this device's sound 25 ms a press and are kept on the device: the way from a browser to its
   speaker is something the browser does not always report (an Echo Show sounded a shade after an iPhone with both holding 3.0 s on the
   PC's clock, 2026-11-03), and a person in the room can hear it where no page can. The PC keeps playing for the room the whole time. If the sound stops, the page starts it again on
   its own, so a tablet on a shelf needs nobody. The page's own Stop button stops the page's sound and nothing on the PC.
4. Nothing on the page acts on PRISM: no transport, no mute, no picks, no order. It shows and it plays.

## How it works

- **One house code, minted once.** Core holds the switch and the code (`remote.ts houseListen`, stored under `remote:house`).
  Turning the switch on the first time mints an eight-character code from an alphabet without 0, 1, i, l and o (forty bits; 2026-10-31), shown as `abcd-efgh` and compared without case, dashes or spaces; ten
  wrong codes lock the page's routes for a minute. Turning it off and on again keeps the same code. The address a person types is the
  short one, `<the PC>:8471/listen`: the host serves the page to anyone on the network while the switch is on, the page asks for the
  code once in its own big field and keeps it on that device, and core alone checks it, on the page's routes, counting wrong tries per
  device (the shell passes the client's address, never stored): ten lock that device for a minute, other devices untouched. The bands
  socket takes a stream ticket for the page, never the code. The house's listener id names the code's generation, not the code, so
  no log carries it. The QR carries the code in the address, so a phone skips the typing; the page takes it out of the address bar
  once it has kept it. The key opens exactly three things: the page, `GET /listen/now` and `POST /listen/ticket` in core, and the bands socket
  on the host. It is refused on every route a phone's pairing opens, and a phone's token is refused on the listen routes.
- **The page is the host's** (`Services/ListenPage.cs`, served at `/listen?key=`): the host checks the key against core's stored
  record (`RemoteServer.HouseOk`) before serving it, and serves `ListenPage.OffHtml` otherwise. `GET /listen/now` (every two seconds)
  gives the playing card and the stage's visualization feed (style, art mode, artwork, palette); `POST /listen/ticket` mints a stream
  ticket for the listener id `house`, which the page spends on `/audio/stream` (the stamped PCM frames, `ListenPlayer.cs`). The house listener chooses no window, so it hears
  the room's sound: the big window's tap, else the shared browser's loopback (`ListenStream`).
- **The scene is one copy.** The lounge scene the phone drew inline (Sunrise Meadow and the art backdrop and focal picture) moved to
  `Services/VizScene.cs` and is spliced into both the phone page and the listen page where they say `__VIZ_SCENE__`. The listen page
  draws it at the PC's thirty frames a second at most and not at all while its tab is hidden; a shelf tablet has no more to give.
- **The sound restarts itself.** Three seconds without a frame and the player opens a new socket on a fresh ticket, the old one kept
  until the new is open (so the PC never counts no listener in between), twice; then, or on a closed socket, the page starts the player
  again four seconds later, for as long as the person left it listening. A 404 or 401 on the page's
  own routes (the switch went off, or the key changed) stops the sound and shows the off message.
- **Plain browsers.** No modules, no frameworks, no build; sizes in viewport units; the screen wake lock where the browser offers it.
  The Echo Show's Silk is Chromium-based and renders and plays (2026-10-31). The Show leaves a page after some ten idle minutes; on
  Silk alone (its user agent), after the first tap, the page plays two seconds of silence from `/listen/silence.wav` every minute, which
  reads to Silk as activity (the method of DaGammla's keep-silk-open, MIT), so the page stays until someone closes it. Silk's own
  policy, not a feature of it, so a firmware update may end it.

## Privacy and the network

- The page is for the home network. With the switch on, anyone on the Wi-Fi who has the address can see what plays and hear it. That
  is a wider door than the paired phones, which is why it is a switch, off by default, and why the card says so.
- The page fetches the song's artwork itself from the service's own address, as the phone's page does (docs/network.md). The PC makes
  no new outbound connection for it. The routes are listed in docs/network.md under the one listener.

## Decisions

- No controls on the page, by the ask. The one button is the page's own sound, which no browser will start without a tap.
- The key is stable across off and on, so the house's bookmarks keep working. **New address** on the card replaces it (a lost tablet,
  a guest who should not keep it): the old key opens nothing from then on. Off, and a new address, both void the house's stream
  tickets, and the host asks every two seconds whether the house may still be fed (the switch as the store has it) and ends its
  streams and bands sockets on a no, so the switch never fails open, whoever flipped it (2026-10-31 review).
- The house code's lag report (`POST /listen/lag`) counts only while its stream runs and only up to ten seconds, so the code moves the
  room's delay by no more than its own real lag (review 2026-10-31).
- The page buffers the sound itself (2026-10-31 evening): PCM in 20 ms
  frames over `/audio/stream` (a ticket from `POST /listen/ticket`), scheduled with Web Audio exactly three seconds behind arrival on every
  browser, the companion app's low delay path with a longer lead, by the context's own output (no media element: an Echo Show's media
  path added most of a second over a phone's) and with each browser's own figure for the way to the speaker taken off its lead. A browser's own media player was not to be trusted with the live MP3: an
  iPhone held seconds of it before playing, an Echo Show a different amount, and the two stood three seconds apart. So the Echo Show and a
  phone on this page play the same moment together, and the room sits the same three seconds back (docs/features/phone.md, "One clock for
  every listener"). Two pages on the code count apart (each report carries an id the page chose for itself, kept in memory only).
  Since 2026-11-03 the hold is against the PC's own clock, not arrival (each frame stamped, the one player in both pages, the cut past
  three tenths): two pages had sat 0.3 s apart after one restarted. See **One player, one clock** in docs/features/phone.md and LEDGER B-474.
- The hold never changes the pitch (2026-10-31 night): the first hold rule ran
  the sound up to two percent fast or slow on each frame's own error, a third of a semitone, and an Echo Show's audio clock moves in steps
  of a tenth of a second, so its pitch swung from frame to frame and sat flat or sharp beside a phone on the same song. Now the error is
  smoothed over about a second and the speed stays within half a percent (nine cents at most and usually far under; a fifth of a percent
  until 2026-11-03); an error past three tenths of a second is taken in one short cut, a skip or a gap under a twelve-millisecond fade,
  never by pitch. The companion app's low delay path
  holds the same rule. Buffering was not the fault: the page already held three seconds and lost nothing.
- The house listener counts as a listener like a phone: it hears PRISM at full while the room hears PRISM's own mute and volume (the
  captures undo the sessions' level, B-472; the playback device is never touched), and the pill says a phone is listening. With the
  room in step the delayed playback is held to the same mute and volume, since the capture it plays is at full scale.
  The key reaches no mute, volume or window route; those stay the paired phones'.
- Sunrise Meadow always, by the ask; the stage's art mode and palette are followed as the phone follows them, and with no stage feed
  the song's own picture sits over the scene as a stereo would show the sleeve.
