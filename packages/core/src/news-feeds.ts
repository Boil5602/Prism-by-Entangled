/**
 * What a live news show reported (docs/features/live.md, 2026-10-01: "is it possible to show headlines for the news being covered by a
 * specific live news show, so you can click the headline to watch the show" / "I would like it tied to that network and what they're
 * reporting on. Preferably avoid pundit articles. Stick to our ideals").
 *
 * The networks publish the segments their shows aired as plain feeds: CBS News a feed per show (the Daily Report's clips, the Evening News,
 * CBS Mornings' clips, Face the Nation, 60 Minutes, 48 Hours), NBC News one feed whose NBC News Now segments sit under its "/now/video/"
 * path. An adapter pairs a feed with the channel that carries the show (`newsFeeds`: the channel by name, the show by the program's name
 * when the channel carries several, the feed's address, and the path the stream's own items share where the feed mixes them with
 * articles). Core reads the paired feeds whose channel is in the guide, every ten minutes, through the host's static fetch (one fixed
 * address each, nothing of the household in it, dashboard-schema section 22), and the Live tab's News mode shows a card a segment under
 * the show's name; a press tunes the channel. The network chose the stories by airing them; Prism orders nothing, newest first as the
 * feed lists them.
 *
 * What is left out, each a named rule the tab's tooltip states (section 5: every filter traceable): the networks' opinion sections are
 * never paired; a full-episode entry ("9/30: The Takeout with Major Garrett") is the show, not a story; a shopping segment ("CBS Mornings
 * Deals", "Exclusive discounts") is not news. Nothing else is filtered.
 *
 * Pure: the feed parse, the pairing with the guide's rows, the rules. Fixtures: tests/fixtures/news (the real feeds, 2026-10-01).
 */

/** An adapter's pairing of a feed with a channel (and a show on it). */
export interface NewsFeedSpec {
  /** The channel as the guide names it (a case-blind match on the row's name, or a leading part of it). */
  channel: string;
  /** The show, when the channel carries several (CBS News 24/7): the program on now must begin with it. Absent: the channel's feed stands always. */
  show?: string;
  /** The feed's address (https only; read as it is, never with a parameter). */
  feed: string;
  /** Where the feed mixes a stream's segments with written articles: the path the segments share ("/now/video/"). */
  only?: string;
  /** The name on the strip (the show's, else the channel's). */
  name?: string;
  /** A station's feed (2026-10-02, Local mode): shown in Local mode, not in News mode. */
  local?: boolean;
}

export interface NewsItem {
  title: string;
  link: string;
  /** The item's own time (epoch ms), null when the feed gives none. */
  at: number | null;
  desc: string;
}

/** A feed's items, from RSS 2.0 (title, link, pubDate, description), the feed's order kept. */
export function parseFeed(xml: string): NewsItem[] {
  const out: NewsItem[] = [];
  const items = xml.match(/<item\b[\s\S]*?<\/item>/g) ?? [];
  const text = (block: string, tag: string): string => {
    const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
    if (!m) return "";
    return unescapeXml(m[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  };
  for (const block of items) {
    const title = text(block, "title");
    const link = text(block, "link");
    if (!title || !/^https:\/\//.test(link)) continue;
    const when = text(block, "pubDate");
    const at = when ? Date.parse(when) : NaN;
    out.push({ title: title.slice(0, 200), link: link.slice(0, 400), at: isFinite(at) ? at : null, desc: text(block, "description").slice(0, 400) });
  }
  return out;
}

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&"; if (k === "lt") return "<"; if (k === "gt") return ">"; if (k === "quot") return "\""; if (k === "apos") return "'"; if (k === "nbsp") return " ";
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  });
}

/** The rules that leave an item out, each by name; null when the item stands. */
export function leftOutWhy(item: NewsItem, spec: Pick<NewsFeedSpec, "only">): string | null {
  if (spec.only && !item.link.includes(spec.only)) return "not the stream's own segment";
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?:\s/.test(item.title)) return "a full episode, not a story";
  // the segment by its name, not the word (review 2026-10-02: "Senate reaches budget deal" is a story)
  if (/^(cbs mornings |today )?deals?\b|exclusive discounts?|\bdeals? of the (day|week)\b/i.test(item.title)) return "a shopping segment";
  if (/\/opinion\/|\/think\//.test(item.link)) return "an opinion piece";
  return null;
}

/** The stories of a feed: the rules applied, newest first by the item's own time (the feed's order where times tie or are missing). */
export function storiesOf(items: NewsItem[], spec: Pick<NewsFeedSpec, "only">, limit = 12): NewsItem[] {
  const kept = items.filter((i) => leftOutWhy(i, spec) === null);
  const order = kept.map((i, n) => ({ i, n }));
  order.sort((a, b) => (b.i.at ?? -Infinity) - (a.i.at ?? -Infinity) || a.n - b.n);
  return order.slice(0, limit).map((x) => x.i);
}

/** A guide row as the pairing needs it. */
export interface NewsGuideRow { id: string; name: string; service: string; app: string; facet: string; url?: string | null; now?: string | null }

export interface NewsPairing {
  spec: NewsFeedSpec;
  row: NewsGuideRow;
  /** The strip's name for the group: the show's, else the channel's. */
  name: string;
}

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The pairings that stand now: each spec whose channel is in the guide and, where it names a show, whose channel has that show on. */
export function pairFeeds(specs: ReadonlyArray<NewsFeedSpec>, rows: ReadonlyArray<NewsGuideRow>): NewsPairing[] {
  const out: NewsPairing[] = [];
  for (const spec of specs) {
    if (!/^https:\/\//.test(spec.feed)) continue;
    const want = fold(spec.channel);
    const row = rows.find((r) => { const n = fold(r.name); return n === want || n.startsWith(want + " "); });
    if (!row) continue;
    if (spec.show) {
      const on = fold(row.now ?? "");
      const show = fold(spec.show);
      if (!on || !(on === show || on.startsWith(show + " "))) continue;
    }
    out.push({ spec, row, name: spec.name ?? spec.show ?? row.name });
  }
  return out;
}
