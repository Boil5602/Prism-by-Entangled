import type { VideoItem } from "./types.js";
import type { MenuLogEntry } from "./menu-order.js";
import { sortTitle } from "./menu-order.js";

/**
 * Categories of the person's own (2026-10-11, "Can we let people create categories using hashtags and choose from a series of
 * transparent algorithms like recent" - "Algorithm for selection has to be clear" - "Yes clear rules only"): a category is a name,
 * some hashtags and one rule. It fills from what the household's services already list in Prism (Continue watching, the lists, the
 * services' own rows: YouTube's subscriptions and their latest videos, Twitch's followed channels and their videos), across services,
 * with every title whose words carry one of the hashtags, in the rule's order. Nothing is fetched for it, nobody's feed is read, and
 * the row says what is counted, who is counted, who decides and the source, as every row does. Pure: the definitions and the rules.
 */
export type CategoryRule = "newest" | "watched" | "az" | "service";

/** `tags`: a `#tag` is matched only against what creators tagged (a stream's tags, a video's keywords, a literal #hashtag in a name); a plain word
 *  against the words of names (2026-10-12, "there is no # in Paramount, and you're including it in the Star Trek row"). `v: 2` marks a category
 *  saved under that rule; one saved before it (every entry a hashtag, matched against names too) is read with every entry as a `#tag`. */
export interface Category { id: string; name: string; tags: string[]; rule: CategoryRule; /** also from the open pool: every service's own page for the hashtag (2026-10-11) */ pool: boolean; v: 2 }

/** A pool row's lines as an adapter gives them (videoPoolWords), {tags} to fill. */
export interface PoolWords { name: string; counted: string; who: string; decides: string; source: string }

export function poolWords(w: PoolWords, tags: readonly string[]): PoolWords {
  const t = tags.map((x) => (x.startsWith("#") ? x : "#" + x)).join(" ");
  const fill = (s: string) => s.split("{tags}").join(t);
  return { name: fill(w.name), counted: fill(w.counted), who: fill(w.who), decides: fill(w.decides), source: fill(w.source) };
}

export interface RuleWords { id: CategoryRule; name: string; counted: string; who: string; decides: string; source: string; formula: string }

export const CATEGORY_RULES: readonly RuleWords[] = [
  { id: "newest", name: "Newest first",
    counted: "When each title was published, as its service says beside it (3 days ago, 2 weeks ago). A title with no date goes last.",
    who: "Nobody is counted: it is a date.", decides: "The channel or network that published it.",
    source: "The services' own pages, as Prism read them for its rows.", formula: "the titles with one of the hashtags, by the date beside each, newest first" },
  { id: "watched", name: "Watched most recently by this household",
    counted: "When this PC last saw each title play. A title never played here goes last.",
    who: "This household, on this PC. Nobody else.", decides: "Whoever pressed play.",
    source: "Prism's own log on this PC. It leaves the PC for nothing.", formula: "the titles with one of the hashtags, by when this PC last played each, latest first" },
  { id: "az", name: "A to Z",
    counted: "The title's own name, articles aside (The, A, An).", who: "Nobody is counted.", decides: "Whoever named the title.",
    source: "The services' own pages.", formula: "the titles with one of the hashtags, by name" },
  { id: "service", name: "The service's own order",
    counted: "Nothing: each service's items stand as that service listed them, service after service.",
    who: "Nobody is counted.", decides: "Each service, by whatever its page does. Prism does not know its reason.",
    source: "The services' own pages, in their order.", formula: "the titles with one of the hashtags, as their services list them" },
];

export function ruleOf(v: unknown): CategoryRule { return v === "watched" || v === "az" || v === "service" ? v : "newest"; }

/** A hashtag as kept: lowercase, no #, letters, digits, a few joiners. "" for nothing usable. */
export function cleanTag(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  const core = s.replace(/^#+/, "").toLowerCase().replace(/[^\p{L}\p{N}_'.-]+/gu, "").replace(/^[._'-]+|[._'-]+$/g, "").slice(0, 40);
  return core ? (s.startsWith("#") ? "#" + core : core) : "";
}

export function cleanCategory(raw: unknown): Category | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const legacy = r.v !== 2;   // saved when every entry was a hashtag matched against names too: read as #tags now (the person wrote them with a #)
  const tags = Array.isArray(r.tags) ? [...new Set(r.tags.map(cleanTag).filter((t) => t.length > 0).map((t) => (legacy && !t.startsWith("#") ? "#" + t : t)))].slice(0, 20) : [];
  const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const id = typeof r.id === "string" && /^[a-z0-9-]{1,40}$/.test(r.id) ? r.id : "";
  if (!id || !tags.length) return null;
  return { id, name: name || tags.join(" "), tags, rule: ruleOf(r.rule), pool: r.pool === true, v: 2 };
}

/** The words of a title as the matching sees them: its name, its line under (the channel, the category), its series, its badge. A literal
 *  #hashtag in any of them is a word too, without its #. Lowercase, letters and digits, apostrophes and dots inside a word kept. */
export function wordsOf(item: Pick<VideoItem, "title" | "subtitle" | "badge" | "tags"> & { series?: string | null }): Set<string> {
  const out = nameWordsOf(item);
  for (const t of taggedOf(item)) out.add(t);   // a tag the creator wrote is a word of the title, as one hashtag
  return out;
}
/** What creators tagged a title with: a stream's tags, a video's keywords, and a literal #hashtag written in its name or line under; without the #. */
export function taggedOf(item: Pick<VideoItem, "title" | "subtitle" | "badge" | "tags"> & { series?: string | null }): Set<string> {
  const out = new Set<string>();
  for (const t of item.tags ?? []) { const k = cleanTag(t).replace(/^#/, ""); if (k) out.add(k); }
  const text = [item.title, item.subtitle, item.series, item.badge].filter((x): x is string => typeof x === "string" && x.length > 0).join(" ").toLowerCase();
  for (const m of text.matchAll(/#[\p{L}\p{N}][\p{L}\p{N}'._-]*/gu)) { const k = m[0].slice(1).replace(/^[._'-]+|[._'-]+$/g, ""); if (k) out.add(k); }
  return out;
}
/** The words of a title's name, its line under, its series and its badge, and two or three of them run together (a hashtag has no spaces). */
export function nameWordsOf(item: Pick<VideoItem, "title" | "subtitle" | "badge"> & { series?: string | null }): Set<string> {
  const text = [item.title, item.subtitle, item.series, item.badge].filter((x): x is string => typeof x === "string" && x.length > 0).join(" ").toLowerCase();
  const ws: string[] = [];
  for (const m of text.matchAll(/#?[\p{L}\p{N}][\p{L}\p{N}'._-]*/gu)) ws.push(m[0].replace(/^#/, "").replace(/^[._'-]+|[._'-]+$/g, ""));
  const out = new Set<string>(ws);
  // a hashtag has no spaces, so two or three words in a row are a word too ("Taylor Swift" carries #taylorswift)
  for (let i = 0; i < ws.length; i++) { const a = ws[i]!, b = ws[i + 1], c = ws[i + 2]; if (b !== undefined) out.add(a + b); if (b !== undefined && c !== undefined) out.add(a + b + c); }
  out.delete("");
  return out;
}

/** A title belongs to the category when a creator tagged it with one of the category's #tags, or one of the category's plain words is a word of
 *  its name or of what a creator tagged it with (a plain word is a word wherever it stands; only the #tag is strict). */
export function matches(c: Pick<Category, "tags">, item: Pick<VideoItem, "title" | "subtitle" | "badge" | "tags"> & { series?: string | null }): boolean {
  if (!c.tags.length) return false;
  const names = nameWordsOf(item), tagged = taggedOf(item);
  return c.tags.some((t) => (t.startsWith("#") ? tagged.has(t.slice(1)) : names.has(t) || tagged.has(t)));
}

/** "3 days ago", "2 weeks ago", "1mo ago", "6y ago", "Streamed 4 hours ago": the service's own word for when, as a time, or null. */
export function publishedAt(text: string | null | undefined, now: number): number | null {
  if (!text) return null;
  const m = /(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mos?|mo|years?|yrs?|y)\s*ago/i.exec(text);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  const u = m[2]!.toLowerCase();
  const ms = /^s/.test(u) ? 1000 : /^mi/.test(u) ? 60_000 : /^h/.test(u) ? 3_600_000 : /^d/.test(u) ? 86_400_000 : /^w/.test(u) ? 7 * 86_400_000 : /^mo/.test(u) ? 30 * 86_400_000 : /^y/.test(u) ? 365 * 86_400_000 : null;
  return ms === null ? null : now - n * ms;
}

export interface CategoryCard { app: string; service: string; facet: string; item: VideoItem; /** the card's own word under the title: the rule's value */ lens?: { label: string } | null;
  /** when the service's page listed it, for a card from an open-pool read (2026-10-13): a stream is believed live for POOL_LIVE_MS after */ readAt?: number }
/** A pool stream read this long ago is no longer said to be live (2026-10-13, "if they're not actually live, they shouldn't show up in that
 *  list": Twitch previews of streams that had ended were drawn as live all morning). */
export const POOL_LIVE_MS = 2 * 3_600_000;
/** The service said live, and the read is fresh enough to believe it. */
export const liveNow = (c: CategoryCard, now: number): boolean => (c.item.kind === "live" || c.item.badge === "LIVE") && (c.readAt === undefined || now - c.readAt < POOL_LIVE_MS);

function lastPlayed(c: CategoryCard, log: readonly MenuLogEntry[]): number | null {
  let best: number | null = null;
  for (const e of log) {
    if (e.app !== c.app) continue;
    const same = (c.item.id && e.id === c.item.id) || (!!c.item.url && !!e.url && e.url === c.item.url) || sortTitle(e.title) === sortTitle(c.item.title);
    if (same && (best === null || e.at > best)) best = e.at;
  }
  return best;
}

/** The category's cards in its rule's order, each with the rule's own word under it. Pure. */
export function orderCategory(rule: CategoryRule, cards: readonly CategoryCard[], log: readonly MenuLogEntry[], now: number): CategoryCard[] {
  const unit = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s") + " ago";
  const ago = (at: number) => { const d = Math.max(0, now - at); return d < 3_600_000 ? "just now" : d < 86_400_000 ? unit(Math.round(d / 3_600_000), "hour") : d < 30 * 86_400_000 ? unit(Math.round(d / 86_400_000), "day") : d < 365 * 86_400_000 ? unit(Math.round(d / (30 * 86_400_000)), "month") : unit(Math.round(d / (365 * 86_400_000)), "year"); };
  // a creator's title says what it is beside its date (2026-10-12, "We should do something to indicate these streaming channel services vs the
  // entertainment services"): a live stream, a stream, a video; a series or a film says nothing more than its own line already does
  const live = (c: CategoryCard) => c.item.kind === "live" || c.item.badge === "LIVE";
  // ... said as "Content creator" ("Maybe we should use a term like content creators"): a creator's stream or video, live now or by its date
  const creator = (c: CategoryCard): boolean => live(c) || c.item.kind === "video";
  const said = (c: CategoryCard, when: string | null): { label: string } | null => { const parts = [creator(c) ? "Content creator" : null, live(c) ? (liveNow(c, now) ? "Live now" : "was live") : when].filter((x): x is string => !!x); return parts.length ? { label: parts.join(" \u00b7 ") } : null; };
  if (rule === "newest") {
    // live now is the newest there is; then each title by the date its service writes beside it, across services
    const dated = cards.map((c, i) => ({ c, i, at: liveNow(c, now) ? now : live(c) ? (c.readAt ?? now) : publishedAt(c.item.subtitle, now) ?? publishedAt(c.item.badge, now) }));   // a stream read long ago: as of its read
    dated.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.i - b.i);
    return dated.map(({ c, at }) => ({ ...c, lens: said(c, at === null ? null : ago(at)) }));
  }
  if (rule === "watched") {
    const played = cards.map((c, i) => ({ c, i, at: lastPlayed(c, log) }));
    played.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.i - b.i);
    return played.map(({ c, at }) => ({ ...c, lens: at === null ? null : { label: "played " + ago(at) } }));
  }
  if (rule === "az") return [...cards].map((c, i) => ({ c, i })).sort((a, b) => sortTitle(a.c.item.title).localeCompare(sortTitle(b.c.item.title)) || a.i - b.i).map(({ c }) => ({ ...c, lens: said(c, null) }));
  return cards.map((c) => ({ ...c, lens: said(c, null) }));
}

// the words that say nothing about a subject: joiners, the services' own row words, and what a title says about itself
const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "your", "you", "are", "was", "were", "have", "has", "had", "not", "but", "all", "new", "live", "video", "videos", "full", "episode", "episodes", "season", "official", "trailer", "show", "part", "vs", "how", "what", "why", "when", "who", "ago", "days", "hours", "weeks", "months", "years", "min", "watch", "watching", "stream", "streamed", "views", "subscribers",
  "just", "shorts", "short", "like", "get", "got", "can", "will", "more", "most", "very", "really", "into", "out", "about", "over", "after", "before", "best", "top", "ever", "than", "then", "there", "their", "they", "them", "its", "it's", "our", "one", "two", "first", "last", "day", "week", "month", "year", "now", "here", "only", "every", "some", "any", "much", "many", "does", "did", "don't", "didn't", "i'm", "you're", "we're", "it's", "let's", "ft", "feat", "clip", "clips", "highlights", "recap", "review", "reaction", "update", "good", "bad", "big", "little", "old", "real", "true", "way", "thing", "things", "time", "times", "make", "makes", "made", "take", "takes", "see", "look", "say", "says", "said", "know", "think", "need", "want", "going", "come", "comes", "back", "off", "still", "even", "also"]);

/** The tags creators wrote across the household's rows, counted one a title (the better chips: someone chose the word): the tags read
 *  for the title, and the #hashtags written in its own name (a YouTube title's "#funny #dad"). Pure. */
export function creatorTags(items: ReadonlyArray<Pick<VideoItem, "title" | "tags">>, max = 30): Array<{ tag: string; n: number }> {
  const n = new Map<string, number>();
  for (const it of items) {
    const mine = new Set<string>();
    for (const t of it.tags ?? []) { const k = cleanTag(t).replace(/^#/, ""); if (k.length >= 2 && !STOP.has(k) && !RATING.test(k) && !/^\d+$/.test(k)) mine.add(k); }
    for (const m of (it.title ?? "").matchAll(/#([\p{L}\p{N}_]+)/gu)) { const k = cleanTag(m[1]).replace(/^#/, ""); if (k.length >= 2 && !STOP.has(k) && !/^\d+$/.test(k)) mine.add(k); }
    for (const k of mine) n.set(k, (n.get(k) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([tag, c]) => ({ tag, n: c }));
}

/** YouTube's words for a video whose creator set no tags ("video, sharing, camera phone, video phone, free, upload"): nobody chose those. */
export const BOILER_TAGS: ReadonlySet<string> = new Set(["video", "sharing", "cameraphone", "videophone", "free", "upload"]);

/** The creator's keywords from a title's public page: the keywords meta, split on commas, cleaned, unique, at most 30. Pure. */
export function keywordsOf(html: string): string[] {
  const m = /<meta\s+name="keywords"\s+content="([^"]*)"/i.exec(html);
  if (!m) return [];
  const raw = m[1]!.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const out: string[] = [];
  // YouTube writes "video, sharing, camera phone, video phone, free, upload" on a video whose creator set no tags: nobody chose those
  for (const part of raw.split(",")) { const k = cleanTag(part).replace(/^#/, ""); if (k.length >= 2 && !BOILER_TAGS.has(k) && !out.includes(k)) out.push(k); if (out.length >= 30) break; }
  return out;
}

/** What a video's public page says of itself (2026-10-11): the creator's tags, the channel and its address, the description, the length in
 *  seconds, the date. YouTube's watch page carries each in its head and its player record. Pure. */
export interface PageInfo { tags: string[]; channel: string | null; channelUrl: string | null; description: string | null; length: number | null; published: string | null }
export function pageInfoOf(html: string): PageInfo {
  const un = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  const name = /<link\s+itemprop="name"\s+content="([^"]*)"/i.exec(html);
  const owner = /"ownerProfileUrl":"([^"]*)"/.exec(html);
  const desc = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html);
  const len = /"lengthSeconds":"(\d+)"/.exec(html);
  const date = /"publishDate":"(\d{4}-\d{2}-\d{2})/.exec(html);
  const url = owner ? un(owner[1]!).replace(/^http:\/\//, "https://") : null;
  return { tags: keywordsOf(html), channel: name ? un(name[1]!).trim() || null : null, channelUrl: url && /^https:\/\/www\.youtube\.com\//.test(url) ? url : null,
    description: desc ? un(desc[1]!).trim().slice(0, 1200) || null : null, length: len ? parseInt(len[1]!, 10) : null, published: date ? date[1]! : null };
}

/** Whether a title carries a date from its service within the last so many days (the chips' last-30-days window counts only these). */
export function withinDays(item: Pick<VideoItem, "subtitle" | "badge">, days: number, now: number): boolean {
  const at = publishedAt(item.subtitle, now) ?? publishedAt(item.badge, now);
  return at !== null && now - at <= days * 86_400_000;
}

const RATING = /^(tv-(y|y7|y7-fv|g|pg|14|ma)|pg-13|nc-17|18\+|16\+|13\+|7\+|unrated)$/;

/** The hashtags worth offering when a category is made (2026-10-11, "Can we list popular recent hashtags somehow. Need a source"): the
 *  words that recur across what this household's services list in Prism, a literal #hashtag counting double. The source is the
 *  household's own rows, nobody's trend feed. Pure. */
export function popularTags(items: ReadonlyArray<Pick<VideoItem, "title" | "subtitle" | "badge"> & { series?: string | null }>, max = 30): Array<{ tag: string; n: number }> {
  const n = new Map<string, number>();
  for (const it of items) {
    // the badge is left out: a rating (TV-14), LIVE, NEW say nothing of a subject
    const text = [it.title, it.subtitle, it.series].filter((x): x is string => typeof x === "string").join(" ");
    // one count a title, two when the title writes it as a #hashtag anywhere
    const mine = new Map<string, number>();
    for (const m of text.matchAll(/(#?)([\p{L}\p{N}][\p{L}\p{N}'._-]*)/gu)) {
      const w = m[2]!.toLowerCase().replace(/^[._'-]+|[._'-]+$/g, "");
      if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w) || RATING.test(w)) continue;   // a rating in the line under (TV-14, PG-13) is not a subject
      mine.set(w, Math.max(mine.get(w) ?? 0, m[1] ? 2 : 1));
    }
    for (const [w, c] of mine) n.set(w, (n.get(w) ?? 0) + c);
  }
  return [...n.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([tag, c]) => ({ tag, n: c }));
}
