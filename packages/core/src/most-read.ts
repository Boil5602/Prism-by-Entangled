/**
 * Most read on Wikipedia, across the household's services (2026-09-22, "It's meant to help me discover more titles ... the lens
 * should be looking at all movies & TV I have access to through my various services").
 *
 * The lens had laid its number over the household's own two rows only, so it could never name a title the person had not
 * already met. It now reads what Wikipedia itself says is most read: English Wikipedia's 1,000 most-read articles of each of the
 * last seven days (Wikimedia's pageviews "top" list). The films and series among them - an article whose name says so ("(2025
 * film)", "(TV series)"), or one near the top whose page summary describes one ("Stranger_Things") - are matched to TMDB through
 * their Wikidata item (TMDB's
 * find by Wikidata id: a person or a book finds no film and drops out), kept only where the household's services carry them
 * (JustWatch's listing through TMDB, the Browse offer filter), and ordered by one number: the reads of each title's article over
 * the last seven full days. The household's own titles are in the pool too - what the person can watch, not only what is new.
 *
 * Pure: the days, the candidates each list offers, the row's order and the value a card shows. The orchestrator reads; the host
 * draws. Fixture: most-read.test.ts.
 */
import { compact } from "./lenses.js";

const DAY = 24 * 3_600_000;

/** The last seven full days (UTC), newest first, as the pageviews API writes a day: yyyy/mm/dd. */
export function mostReadDays(now: number): string[] {
  const end = new Date(now - DAY); end.setUTCHours(0, 0, 0, 0);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(new Date(end.getTime() - i * DAY).toISOString().slice(0, 10).replace(/-/g, "/"));
  return out;
}

/** An article name that says it is a film or a series: its disambiguation ends in one ("Sinners_(2025_film)", "The_Bear_(TV_series)"). */
const SCREEN_NAME = /_\(([^()]*_)?(film|TV_series|television_series|miniseries|TV_miniseries|web_series|TV_program|TV_programme|sitcom)\)$/i;
export function isScreenArticle(article: string): boolean { return SCREEN_NAME.test(article); }

/** A page summary's description that reads as a film or a series ("2025 film directed by ...", "American television series"). */
const SCREEN_DESC = /\b(film|television series|TV series|miniseries|sitcom|anime|docuseries|web series|streaming series|television program(me)?)\b/i;
export function isScreenDescription(desc: string | null | undefined): boolean { return !!desc && SCREEN_DESC.test(desc); }

/** Pages of the top list that are never a title: the main page, other namespaces, lists, deaths, years. */
const NOT_A_WORK = /^(Main_Page|[A-Za-z]+(_talk)?:.*|List_of_.*|Lists_of_.*|Deaths_in_.*|\d{4}(_in_.*)?)$/;
/** The untagged articles weighed by their description: those this high in a day's list at most (each costs one paced read the first time). */
export const MOST_READ_UNTAGGED_RANK = 200;

/** A day's top list, reduced: the articles whose names say film or series ("tagged"), and the untagged ones near the top that might be (a
 *  series whose article needs no disambiguation - "Stranger_Things"), to be weighed by their description. */
export function topListCandidates(json: unknown): { tagged: string[]; untagged: string[] } {
  const items = (json as { items?: Array<{ articles?: Array<{ article?: unknown; rank?: unknown }> }> } | null)?.items;
  const arts = Array.isArray(items) && Array.isArray(items[0]?.articles) ? items[0]!.articles! : [];
  const tagged: string[] = []; const untagged: string[] = [];
  for (const a of arts) {
    if (typeof a?.article !== "string" || NOT_A_WORK.test(a.article)) continue;
    if (isScreenArticle(a.article)) tagged.push(a.article);
    else if (typeof a.rank === "number" && a.rank <= MOST_READ_UNTAGGED_RANK) untagged.push(a.article);
  }
  return { tagged, untagged };
}

/** The number a card shows: the article's reads, with its source and window, never bare. */
export function readsValue(views: number): string { return `${compact(views)} reads · Wikipedia · 7 days`; }

/** The row's order: most reads first; an equal count keeps the order the titles were found in. Pure. */
export function orderMostRead<T extends { reads: number }>(cards: readonly T[]): T[] {
  return cards.map((c, i) => ({ c, i })).sort((a, b) => b.c.reads - a.c.reads || a.i - b.i).map((x) => x.c);
}

/** The row's head (the three layers, source and formula) when it reads the catalog; {offer} and {date} are filled in by the caller. */
export const MOST_READ_CATALOG = {
  counted: "Views of each title's English Wikipedia article over the last seven full days.",
  who: "Everyone who opened the article, in any country, on any device; Wikimedia's own filter leaves automated traffic out.",
  decides: "Readers, by reading. Which titles are in the pool is Wikipedia's own daily lists of its most-read articles. Which of them your services carry is JustWatch's listing, through TMDB.",
  source: "Wikimedia REST API (pageviews top and per article, page summaries) · TMDB · JustWatch",
  formula: "The films and series among English Wikipedia's most-read articles on any of the last seven days that your services carry ({offer}), ordered by their article's reads over those seven days, through {date}.",
} as const;

/** How many articles from the top lists are looked up in all (each costs one paced Wikipedia read the first time, then a month in the store). */
export const MOST_READ_NAMED_MAX = 500;

/** The row as it stands: its cards in order, the data date, how many candidates have been weighed, whether the read is done. */
export interface MostReadEntry { at: number; done: boolean; cards: Array<import("./browse.js").BrowseCard & { reads: number }>; through: string | null; read: number }
