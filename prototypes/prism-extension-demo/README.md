# Demo pages for pictures of the PRISM extension

Made-up pages the PRISM extension runs on, and the script that takes the website's pictures of it at work (2026-11-11).
Nothing real shows on them: every site, headline, person, product and address is invented, the drawings are the pages' own,
and the streaming page's moving picture is drawn by the page. The covers in the pictures are the extension's own work.

| Page | What it is | The rule of the extension it meets |
| --- | --- | --- |
| `news.html` | a local paper's article with a top banner, a side box, an ad inside the article, a strip and a tall side ad | the slot rule: each ad place carries `class="ad-slot"` and `data-ad-slot` |
| `news.html`, "More from our partners" | a picture ad with no ad markup | none: the ad the extension misses, picked in the report picture |
| `search.html` | search results, the first two paid | the label rule: the word "Sponsored" as the result's label; the list item is covered |
| `watch.html` | a streaming player that goes into a break of two ads | the video rule for Video.js players: `vjs-ad-playing` on the player, the count and time left in `.vjs-ad-countdown` |
| `music.html` | a music station in a sponsor break: a video where the record sleeve was, its sound through the station's own `<audio>`, and a tall ad beside the player | the video rule for Video.js players, under which the picture is covered and the tab's sound turned off; the slot rule for the ad at the side |
| `popups.html` | a recipe page that opens two windows by itself | the pop-up rule: a window opened with no press, to another site |

The ad pictures in `ads/` are invented products. The addresses the pages are served under end in `.example`, a name
nobody can register; the browser is told to send them to this PC, and nothing leaves it.

## Taking the pictures

    node prototypes/prism-extension-demo/shoot.mjs --out=<folder> [--takes=4] [--only=any-site,popups]

A hidden Edge is started with the unpacked extension of this repository, then a second time without it, at 1600 x 862 and 2x.
Each covered picture is taken `--takes` times, because the extension picks its photos by chance; `run.json` lists, for every
take, the covers the extension made and the rule that made each. The pictures on the website are in the website's
`public/prism/web/`, with `shots.json` beside them; choosing a take and copying it there is done by hand.

Known limits: the extension has no rule for an ad that is sound alone, with no picture and no mark on the page, so `music.html`
shows the break a music service plays with a video; the tab's sound being off cannot be seen in a picture of the page area; without the extension the two windows of
`popups.html` open outside the page area, so its before picture is the plain page.
