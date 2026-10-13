# Categories of your own

Built 2026-10-11 ("Can we let people create categories using hashtags and choose from a series of transparent algorithms like
recent" · "And can that one category work with twitch too?" · "Can we list popular recent hashtags somehow. Need a source" ·
"Algorithm for selection has to be clear" · "Yes clear rules only. Proceed").

## What a category is

A row on Watch that the person made: a name, some hashtags, and one rule. It holds every title the household's services already
list in Prism (Continue watching, the lists, the services' own rows such as YouTube's Subscriptions and Latest from your
subscriptions, Twitch's followed channels) whose words carry one of the hashtags, across services, in the rule's order. Nothing is
fetched for a category, no feed of anyone's is read, and it leaves the PC for nothing.

Two kinds of entry (2026-10-12, "there is no # in Paramount, and you're including it in the Star Trek row"): a `#tag` matches only
what creators tagged a title with (a stream's tags on Twitch, a video's keywords on YouTube, a literal `#hashtag` written in a name),
so `#startrek` takes a tagged stream and not a Paramount+ show named Star Trek; a plain word matches the words of a name, its line
under (the channel, the network) or its series, as a whole word, and two or three words run together count as one (`startrek`
matches "Star Trek: Lower Decks"; `space` matches "Space station tour", not "Spacewalk highlights"). A category saved before this
rule is read with every entry as a `#tag` (the person wrote them with a `#`); `v: 2` marks one saved under it.

## The rules (core `categories.ts`, `CATEGORY_RULES`)

Each rule is said in full where it is chosen and on the row's disclosure, in the same four lines every row on Watch has: what is
counted, who is counted, who decides, the source.

| Rule | Order | Source |
| --- | --- | --- |
| Newest first | the date the service writes beside each title ("3 days ago"); undated last | the services' own pages |
| Watched most recently by this household | when this PC last saw the title play; never played last | Prism's own log on this PC |
| A to Z | the title's name, articles aside | the services' own pages |
| The service's own order | as each service listed it, service after service | the services' own pages; Prism does not know their reason |

No rule weighs, recommends, or learns. Adding one means adding a `RuleWords` entry with all four lines and a test.

## The hashtags offered

"Popular recent hashtags" has one honest source: the household's own rows. `popularTags()` counts the words that recur across the
titles Prism lists for this household (one count a title, two when the title writes it as a `#hashtag`), with joiners and the
services' row words left out, and the badge (a rating, LIVE) never counted. The tab says so beside the chips ("The count is
Prism's, from your own rows"). There is no trend feed from YouTube, Twitch or anyone, and none is planned without a nameable source.

## Where it lives

- Core: `categories.ts` (pure: cleaning, matching, the rules, the suggestions), `runtime.ts` `videoCategories` /
  `videoCategorySet` / `videoCategoryDelete`, rows appended to `videoMenu().lensRows` as `cat:<id>` with `category` on each;
  kept in the store under `video:categories`, at most 24.
- Host: Watch settings > Categories (`MainWindow.CategoriesTab.cs`); the rows draw as every lens row does, with the rule's own word
  under each card (its date, when it played).
- Adapters: YouTube's `/feed/subscriptions` is read in the owned walk as the own row "Latest from your subscriptions" (channel,
  length, "N ago"), so the newest-first rule has dates to go by.

## The open pool (2026-10-11, "Preferably pulling together more than just what shows in my lists. I don't want to promote the online echo chambers")

A category can also draw from every service's own page for each hashtag, beyond the household's rows. Each such row says
whose rule it follows, and the rule is one the service itself names on its page, never a recommendation:

| Service | Page (adapter `videoPoolUrl`) | What is listed | Whose rule |
| --- | --- | --- | --- |
| YouTube | `results?search_query=#tag`, then the page's own **Recently uploaded** chip pressed | up to 40 videos from every channel on YouTube carrying the hashtag | which videos: YouTube's search, a rule it does not publish; the filter: YouTube's own, named; the order: Prism's rule by the date shown |
| Twitch | `directory/all/tags/<tag>?sort=RECENT` | up to 40 live streams tagged with it, from every streamer | the streamer, by tagging; the order: Twitch's stated **Recently started** sort |

Since 2026-10-12 ("Can the comedy row sort by release date even though multiple services are involved?") the pool's titles stand in
the category's one row with the household's own, under the same rule: newest first across services, a live stream as now, and the
row's disclosure names every source ("with new on YouTube and live on Twitch"). A creator's title says what it is beside its date
("Content creator · Live now", "Content creator · 5 hours ago"); a series or a film says no more than its own line does. Each pool page is read on the service's hidden
page (`videoPool` script, op `pool`), at most five hashtags a category, cached half an hour, refreshed when Watch is opened or the
category saved. YouTube's `sp=` sort parameter is ignored on a signed-in page, so the chip is pressed instead; if it could not be,
the row's "what is counted" says the list is unfiltered. The search runs signed in, so YouTube may still shade it: said in
"who decides".

## Topics the world is reading

The anti-echo-chamber chips: Wikipedia's most-read articles of the last full day, from Wikimedia's public pageviews count
(the same endpoint as the Most read on Wikipedia row, cached for good per day). `topArticles()` in `most-read.ts` gives
the names in the count's own order with the pages that are never a subject left out (the main page, namespaces, lists,
deaths, years) and a short list of adult sites by name. Nothing about this household is in it. A pressed topic becomes a
hashtag without spaces (`#dianekeaton`), which the rows match by joining two or three words in a row.

## Tags creators wrote (2026-10-11, "Follow recommendations")

The better chips: a word someone chose for their own title. Read a pass at a time (every ten minutes at most, when Watch or the tab asks
for the rows), kept a month per title under `video:tags`, at most 3000 titles:

- **Twitch**: one hidden-page read of `/directory/following/live` gives every followed live stream's tag buttons and its category,
  keyed by the channel's login (`videoTagsUrl` + `videoTags`, op `tags`).
- **YouTube**: an anonymous read of `www.youtube.com/watch/<id>` (no query string, no cookie, Prism's agent string) for a dozen
  titles a pass, keeping the page's keywords meta, the creator's own tags (`videoTagsFetch`; `keywordsOf()` parses it). Nothing is
  played and nothing lands in the household's history, which a hidden-page watch would have done.

A creator's tags are words of the title for matching (`#justchatting`), and the tab lists them as "Tags the creators wrote" ahead of
"Words that recur", each with its count. The tab also says the rows' read time and offers a last-30-days window that counts only
titles their service dates.

## Open

- Twitch's tags are read for followed streams that are live when the pass runs; a stream seen only in the sidebar has none until then.
- YouTube's tags reach the rows a dozen titles a pass, so a fresh row fills over the first hour.
- The pool rows fill on the next open of Watch after a read; a row is never rebuilt under a person.
