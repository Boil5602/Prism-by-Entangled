# The Binge (menu lens add-on)

A carousel on the universal menu of highly rated, short, long-running,
episodic series the household can play right now on this device.

## Eligibility (all must hold; thresholds editable in settings)
| Criterion | Default | Source |
|---|---|---|
| Episode length | ≤ 30 min | TMDB/TVmaze runtime |
| Total episodes | ≥ 80 | TMDB/TVmaze |
| Episodic format | Scripted or animated, not a miniseries, no community "serialized" keyword | TMDB type + keywords |
| Quality floor | TMDB ≥ 7.0 with ≥ 500 votes | TMDB |
| Available here | Streaming on ≥ 1 service signed in on this device | TMDB watch providers (JustWatch data; attribution required) matched to signed-in Apps |

Episodic note (shown to users): no open data marks shows episodic vs.
serialized; the criterion is a labeled heuristic, and users can hide
any title.

## Selection and order
Service-agnostic filter first → keep only titles available on this
device's signed-in services → keep top 50 by TMDB rating → display in
a shuffled order seeded by the date (stable all day, reproducible).
Carousel label: "The Binge · top 50 by TMDB rating among ≤30-min,
80+ episode series on your services · shuffled daily."

## Tooltip
Hover/focus on the lens title shows the eligibility table with current
thresholds. Kids mode is NOT listed in the tooltip.

## Full view
Selecting the carousel title opens The Binge full-screen, one row per
TMDB genre: same eligibility and availability binding, top 50 per
genre by rating, daily-seeded shuffle per row, empty genres hidden.
Genre links on cards jump to that genre's row. Back returns to the menu.

Header: Kids mode checkbox; when checked, an age dropdown whose options
show the ratings they allow:
| Age choice | Ratings shown |
|---|---|
| Under 7 | TV-Y, TV-G |
| Under 10 | + TV-Y7 |
| Under 14 | + TV-PG |
| Under 17 | + TV-14 |
| Kids mode off | all, incl. TV-MA |
Caveat (shown): ratings are the network's own label; TV-PG has no
official age, so this mapping is Prism's editable default. Unrated
titles are hidden while Kids mode is on. Kids mode state is shared by
carousel and full view and persisted per device.

## Availability binding (normative)
Nothing appears that can't be played here via a signed-in App. Tap →
deep link into that service; on a miss, fall back to that service's
prefilled search and note the mismatch locally so the card can be
hidden until provider data refreshes.

## Boundaries
On-device fetch under the user's own TMDB key; local cache; nothing
routed through Entangled. Off when no TMDB key is set. Attribution for
TMDB and JustWatch data shown. Ordering is a pure function of (data,
signed-in services, thresholds, genre, kids mode + age, day seed).

## Include animation (added 2026-09-24)
Header: an "Include animation" checkbox beside Kids mode, on by default.
Off: series TMDB lists under the Animation genre are left out of the
carousel and the full view (its Animation row disappears). Kept per
device, shared by carousel and full view like Kids mode. When off, the
carousel's tooltip says so. The order is then a pure function of (data,
signed-in services, thresholds, genre, kids mode + age, include
animation, day seed).

*Decision (2026-09-24):* with the eligibility above, top 50 by TMDB
rating was 38 of 50 animated - short, long-running series are mostly
cartoons and anime, and TMDB's voters rate anime high; a higher vote
floor barely changed the mix (33 of 50 at 1,000 votes). The household
chose a labeled choice over a Prism-decided balance.

*Decision (2026-09-24):* no limit. The carousel and each genre row show every eligible series, shuffled daily; the top-50 cut is gone ("can we remove the limit and bring in all 126"). Parks and Recreation (8.05) and Modern Family (7.9) had qualified but ranked 58th and 75th under a cut at 8.15.
