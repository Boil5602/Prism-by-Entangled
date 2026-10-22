# This PC's name

2026-10-21: "Let's let the user name their machine, which we'll show top and center when the chrome or watch is up."

A household with a Prism in the kitchen and one in the den can tell them apart from across the room. The name is the
household's own words ("Living room", "Kitchen"), at most forty characters, one line.

## Where it shows

- **The music player's chrome:** top and centre of the visualization, under the Prism grip, in ink (Segoe UI 26, semibold). The MUTED
  banner, which also lives top and centre, stacks under the name instead of on it.
- **Watch:** the same block in the same place, drawn on the Watch overlay, and the header starts lower to leave it room; the
  chrome's copy steps aside while Watch is up. It was first placed beside the tabs, but on a 1273-wide screen the tabs and the
  chips fill the header and left it no room (2026-10-22).

The name sleeps with the rest of the chrome (docs/concept-scenes.md, the 2026-10-22 decision): ten seconds after the pointer last
moved it fades out, and the first move brings it back.

Nothing is shown when there is no name. There is no default: the Windows computer name is noise on a screen.

## Where it is set

- **The Prism menu** (both players, the short menu too): "Name this PC…" opens a dialog with one box. Empty clears the name.
- **Watch settings → This Prism** (the tab that was "Updates"): the name in a box at the top, saved with Save and exit.
- **Device…** (the full menu's rail page): the name and the same dialog under THIS PC.

A change shows at once wherever the chrome or Watch is up.

## Where it lives

`host-prefs.json`, key `machine.name` (`MainWindow.MachineName.cs`): a thing about this PC, never part of the household's
scenes, so it is not in store.json and not in any export or backup of the model. It never leaves the PC: the phone page,
the update check and the reports carry nothing of it (docs/network.md needs no entry).

Later (docs/roadmap.md, Devices): this name is how Prisms on the same home network will recognize each other, so it is the
first piece of that and is kept simple here.

Dev: the shot channel's `name:<text>` sets it (`name:` clears), for a shot of the chrome or Watch with a name on.
