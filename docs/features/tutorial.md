# How Prism works: the tutorial

"Let's build a tutorial with screenshots into Prism." (2026-10-10) "Lets make tutorial a menu of subjects they can select from, so if
they want they can continue on when a topic is ended or stop right there."

## What a person does

- **How Prism works** in the Prism menu opens a list of subjects: Getting started, Watching, TMDB extras (optional), Live TV and
  several windows, Ad breaks, Music, Your phone, Profiles, Updates and help. It also opens once by itself, the first time the Set up
  services page is closed.
- A subject is one to three pages: a picture, a few plain lines, and on some pages a button that opens the real thing (Set up
  services, the TMDB guide, Watch settings, Pair a phone, Profiles, Updates). That button closes the tour, and the menu item brings
  the person back to the page they left.
- A subject's last page offers the next subject, All subjects, or Done. A subject gone through to its end is ticked in the list.

## One source, for Prism and the website (2026-10-11)

"I think it would make sense for us to make the tutorial available on the website for prism ... Is there any way to keep them in
sync?"

- **The source** is `targets/win-host/PrismHost/Assets/tutorial/`: `tutorial.json` (the subjects, their words, and what a page can
  open) and one picture a page. Prism reads it where it lies (`MainWindow.TutorialText.cs`); the C# holds only the actions a page
  can name. A page's `open` carries the button's label, the action, and `where`: the words the website shows in a button's place.
- **The website** (`entangled.world/prism/tour`, its own repository) reads a copy: `src/data/tutorial.json` and
  `public/prism/tour/*.png`. Nothing of the tour is written on the website's side. Its page's own heading says PRISM as the site
  does, and the tour's words stay as the app says them, since they quote its labels.
- **Kept in step by `scripts/release/sync-tutorial.py`**: `publish-windows.py --site` runs it at every release, so the website
  shows the tour of the version people can download. `--check` (a step of `scripts/verify.mjs`, on a machine that holds both
  repositories) fails when the website's copy differs. `--validate` fails on a page with no picture, a picture no page uses, an
  action Prism does not have, or a semicolon (the website's prose check refuses one).
- To change a word or a picture: change it in the source, run the script with `--site`, deploy the website.
- The Add your services page's last point, "Built in today: ...", is written by `scripts/release/sync-adapters.py` from the adapter
  catalog (2026-10-11, "Should we mention all built in adapters so far?"), and the same script writes the website's Adapters page
  data, shown there once its legal review is done and `adaptersLive` is switched on. Both are checked by verify.

## The notice and the introduction (2026-10-11)

"Lets put up a new alert in the status area at the top center that we've added the new tutorial section, and give them the option
to enter into it from that status button in a little pill on the same line. Lets leave that up until they press the button ...
show an animation of opening the Prism menu (can you highlight that part of the screen and dim the rest) and then show a second
animated mouse cursor clicking on the tutorial button and then show the tutorial screen." "A sort of First Run event? And then add
an option to re-enable the tutorial notification in case someone wants to trigger it again."

- **The notice** (`MainWindow.TutorialIntro.cs`): one line in the status area, the words in a pill and Show me in a pill beside
  them. It stays until Show me is pressed, through restarts, steps down a line while the status line has something to say, and
  waits for the Set up services page to be closed. Once for a data folder (`tutorial.noticeDone` in host-prefs.json), so a new
  Windows account or a new data folder sees it again. The tour no longer opens by itself after Set up services: the notice does
  that job.
- **The introduction**: the screen dims but for the Prism tab, a drawn pointer travels to the tab and presses it, the real menu
  opens and stays bright, the pointer travels to How Prism works and presses it, and the tour opens on its list. About six seconds.
  The pointer is a drawing: the person's own pointer is never moved. A press anywhere, or Escape, goes straight to the tour. With
  motion turned down in Windows and Full motion not chosen in Prism, the pointer does not travel and each step is shown still.
- **Again**: Show the notice again, on the tour's list of subjects, puts the notice back.
- Dev: `tour notice`, `tour intro`. Seen in dev shots on 2026-10-11 (the notice, the ring and words round the Prism tab, the drawn
  pointer, the tour at the end). The pointer's travel over the open menu has not been watched by a person yet.

## Leaving goes back where you came from (2026-10-11)

"When the tutorial closes, it goes to the video screens but i entered from watch so should immediately return to watch." A page of
the tour that opens Set up services puts the Watch page away. The tour remembers that it was entered from the Watch page and
opens it again when the person leaves by Close, Done or Escape. The Set up services page carries Back to How Prism works beside
its Done when the tour opened it, and its Done and Escape go back to the tour too.

## No dead ends (2026-10-10)

"Is it possible to send the Pair a phone a parameter so if its initiated by the tutorial there is a return to tutorial button? I
dont like the dead ends back to the home screen. Promote exploration through transparency."

- While something a page opened is up, **Back to How Prism works** sits at the top of the screen, over it
  (`MainWindow.TutorialReturn.cs`). Pressing it puts away what the tour opened and shows the tour at the page it was left on. The
  small X beside it is for staying where the tour led.
- The pairing card carries the same button beside its Close when the tour opened it, and closing the card or the Updates dialog
  by their own Close goes back to the tour too. A phone that pairs closes the card, so it lands on the tour as well.
- Walked through dev commands on 2026-10-10 for Pair a phone (the log and a shot). The other five not yet.

## How it works

- `MainWindow.Tutorial.cs` is the frame, `MainWindow.TutorialText.cs` the subjects and their words. Every label a page names was read
  from the code on 2026-10-10. A label that changes there changes in the tutorial in the same commit.
- Two preferences in host-prefs.json: `tutorial.seen` (it has opened once) and `tutorial.done` (the ids of the finished subjects).
- A page's picture is `Assets/tutorial/<page name>.png`, optional. A page with no picture shows its words alone.

## Decisions

- **Stand-in posters, never a studio's artwork** (the user, 2026-10-10: "yes, use placeholders"). TMDB hosts poster art and cannot
  license it to us, and pictures inside Prism go into a public GPL repository and the download. Made-up titles on plain cards. A
  service's own name and logo may show, to say which service it is (docs/third-party-services-policy.md).
- **Prism works in full without TMDB**, and the TMDB subject says so first.

## The pictures

- Every one of the twenty pages has one (2026-10-10, "I'm looking forward to screenshots for every tutorial page like the details
  and cast drill through"). They are in `Assets/tutorial/`, about 2 MB together.
- They are dev shots (PRISM_DEV_SHOT, `shot.request`) taken with **stand-ins on** (`MainWindow.StandIn.cs`, dev command
  `standin on`): every picture drawn from an address comes from a folder of plain coloured cards
  (`%LOCALAPPDATA%/Prism/diagnostics/standin/*.png`), the answers of the calls that feed the pages have their titles, people and
  account names replaced by the name of the field, and `standin word REAL=SHOWN` replaces a word in whatever is on screen. The switch
  is off at every start and changes only what is drawn.
- Each picture is cut to its own card or region, so nothing of the page behind it shows.
- The pairing card carries the website's address as its code (`pair demo`), never a pairing. The cast member's page is
  `person <TMDB id>|<name>` over an open Details. The windows with the + ("show ... the + sign icon where you can drop a show or
  channel") were taken with the fifth window cleared, and it was tuned back afterwards.
- The Intermission picture is a real cover on a live channel: public-domain art from the bundled pack, with its credit.
- The Music player's picture has a made-up song and artist in place of what was last played.
- The phone's page is the served page on its Keyboard tab, drawn by a headless browser from a local copy (a page that is not paired
  says so, and those words were taken off for the picture). Live and schedule pictures show the public schedule's own names.

## Open

- Not walked on screen by a person yet. No tests: the frame is host UI and the words are data.
- The pictures are of this build. A page whose look changes needs its picture taken again.
