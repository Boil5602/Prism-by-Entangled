# The Seasons visual

> **Under construction (2026-11-12).** Seasons is not ready. It is held back from releases: it is in no list of visuals and
> cannot be picked. Only a development start of the PRISM app shows it. What follows is the plan and what is built so far.

A visual for the music player that follows the calendar (2026-11-12, asked for a seasonal scene a person can set up, with one
scene in which people of different beliefs live side by side). One entry in the list of visuals, id `seasons`.

## What it shows

- **The town.** A small town at dusk in the season of the year: thirteen homes of many builds round a square, one great tree,
  a long table set for everyone, neighbours out walking. The windows are the meter. It is the scene when no holiday is on, and
  it is the scene in which the holidays meet.
- **The holidays.** Each holiday that is on today dresses one home with what a household puts out for the day: lamps on a step,
  lanterns at a door, lights along a roof. More than one shows at a time, next door to each other.
- **The seasons.** Spring, summer, autumn and winter change the sky, the hills, the ground, the tree and what is in the air.

- **The neighbours.** Families and friends cross the square together (parents and a child hand in hand, a pram, an elder with
  a grandchild, a dog on a lead, a child on a parent's shoulders). Around the tree: a board game, two pairs who dance, a band,
  a ring with a ball, a skipping rope, a kite. They move with the low notes.
- **The surprises.** Now and then, and never the same one twice in a row: a shooting star, two linked rings of stars, a balloon,
  birds, fireworks over the hills, paper lanterns let go from the square, a cat. One at a time, 30 to 70 seconds apart.

- **The small stories.** Each is a short play that comes round on its own clock (`Tableaus.Town.Stories.cs`): someone comes
  home with a bag and is met; a child learns to ride and the parent lets go; a child sits a while with an elder on a bench; an
  elder reads to children and the story's pictures rise over them; two neighbours hang a lantern from a ladder; a warm dish is
  carried to another door, which opens. Around them: chimney smoke, clouds, a windmill that turns with the music.

## Decisions

- *Decision (2026-11-12):* every holiday and season is on until a person turns it off.
- *Decision (2026-11-12):* the well-known lettering that spells a word of living together out of religious symbols is someone's
  artwork and is not used, and no name is taken from it. The scene is the town.
- *Decision (2026-11-12):* what is drawn is the places and things of a celebration: lights, flowers, food, cloth. No one who is
  worshipped is drawn, no one at prayer, and no writing. A scene for the Muslim holidays has pattern, lanterns and sky, and no
  figures of its own.
- *Decision (2026-11-12):* PRISM does not ask where the PC is. A person picks the half of the world, or a place from a list of
  cities kept on the PC; nothing is looked up. A place decides the half of the world and nothing else.
- *Decision (2026-11-12):* no date is looked up on a network. Every date is computed on the PC (`SeasonsCalendar.cs` names the
  source of each), and a person can set a range of their own for any row.
- *Decision (2026-11-12):* communities are listed largest first, then the days kept across beliefs, then the seasons.

- *Decision (2026-11-12):* the town is named Convergence. A billboard on the hill behind the homes reads "Welcome to Convergence" (a board in the
  square was tried the same day and taken out). The visual keeps the name Seasons. The
  name is also the name of the shared listening that is planned for it (docs/roadmap.md).
- *Decision (2026-11-12):* the town answers the music in more than its windows: the string of lights is a second meter, a
  column of light for each band stands along the horizon, everyone moves with the low notes, and a beat lifts the square.

- *Decision (2026-11-12):* the sun and the moon follow one clock, the same on every PC: the time of day in New York.
  Convergence is one town. The sky is dawn, day, dusk or night; the moon shows its phase. Nothing is looked up. The place in
  the settings decides the seasons and not the sky.
- *Decision (2026-11-12):* the land beyond the town is where kinds of country meet: snow mountains far off at the left, a
  lake at their feet, a forest on a green hill, dunes with palms at the right. The forest takes the season's colours; the hills are not brown.

- *Decision (2026-11-12):* with no music every visual almost stands still: the scene moves at an eighth of its pace, so what
  moves only sways. This is the renderer's rule and holds for every visual, not for this one alone.

- *Decision (2026-11-12):* Convergence has weather of its own, made up on the PC by lot: clear (the longest spells), fair,
  overcast, a shower with the sun through it and a rainbow, rain, a storm with lightning, mist. In winter rain is snow. While
  it is wet no balloon, fireworks or lanterns go up; the kite comes down in rain and storm. In
  rain everyone who stays out has an umbrella, and those at play (four square, the rope, the kite) go indoors. Nothing is
  looked up.
- *Decision (2026-11-12):* with no music the town waits: the people stop where they are, and games and stories hold.

- *Decision (2026-11-12):* a food market stands at the back of the square: three stalls with fruit, greens and bread, their
  sellers and people who shop. The great tree stands to one side of the square to give it room. Now and then someone calls
  at a home: they walk to a door, it opens, they go in, and later they leave.

- *Decision (2026-11-12):* four square is played for points: after a few hits one is missed, the one who hit it scores (the
  count is in chalk in their square, back to nothing after nine), the ball comes back, and they serve with one bounce. People
  who cross the square walk round the court.

- *Decision (2026-11-12):* someone shops at the market: out of their home, to a stall, a bag from the seller, home with it and
  in; later they come out and stand by the tree a while.
- *Decision (2026-11-12):* the song's label on every visual is in the light ink on a shade of the ground. Its grey lines could
  not be read on a bright visual.

- *Decision (2026-11-12):* Seasons is held back from releases until it is ready. It is in no list of visuals and cannot be
  picked. A development start of the PRISM app (`PRISM_DEV_SHOT=1`) still shows it. The hold is one line in `StylePacks.cs`.

## The rows

| Group | Rows | Where the dates come from |
| --- | --- | --- |
| Christian | Christmas, Easter | the civil calendar; the Gregorian computus (Western churches) |
| Muslim | Ramadan, Eid al-Fitr, Eid al-Adha | the Umm al-Qura calendar; a day to spare for a country's own sighting |
| Hindu | Diwali, Holi | the new and the full moon of the month, computed, at India's clock; a day or two to spare |
| Buddhist | Vesak | the first full moon of May |
| East Asian | Lunar New Year, Mid-Autumn Festival | the Chinese lunisolar calendar |
| Sikh | Vaisakhi | the civil calendar |
| Jewish | Hanukkah, Passover, Rosh Hashanah | the Hebrew calendar; a range starts on the evening before |
| Kept across beliefs | New Year, Nowruz, Kwanzaa, Day of the Dead, Harvest and Thanksgiving | the civil calendar |
| The seasons | Spring, Summer, Autumn, Winter | the astronomical seasons to the nearest day |

Known limits of the dates: the Orthodox churches' Christmas and Easter have no row yet; the harvest row is on the United States'
day; a regional calendar can put Diwali, Holi or Vesak a day from the computed one, which the spare days cover.

## The settings

Opened from the calendar button at the left of the music player, which is there only while the Seasons visual is on. Kept on
the PC as one value (`viz.seasons`). Nothing is kept until Save.

- **Show:** by the date; always one row; or a rotation of the rows that are on, five minutes each.
- **Seasons of:** the northern or the southern half of the world, or a city from the list.
- **A row for each holiday and season:** a switch, and its dates. A press on the dates opens two day pickers; a range of the
  person's own holds each year, and one press goes back to the calendar's dates.
- A season that is off gives way to the one before it.

## Built, and not yet

Built 2026-11-12: the calendar and settings with tests (`PrismHost.Core/SeasonsCalendar.cs`), the town with the four seasons and
a dressing for each of the nineteen holidays (`Visualizations/Tableaus.Town.cs`), the settings window
(`Visualizations/MainWindow.Seasons.cs`).

Not yet:

1. The second pass of the town (2026-11-12, asked for more colour, people in families and groups at play, and surprises) has
   not been seen on a screen yet.
2. A scene of its own for each holiday (a home at its best for the day, seen from inside), next on the calendar first. When
   two are on at once they take turns by the song; until then the town shows all of them.
3. Each dressing checked against a named source for its tradition.
