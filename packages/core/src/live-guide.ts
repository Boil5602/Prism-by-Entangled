/**
 * The Live tab's guide (docs/features/live.md, 2026-09-28): every live channel the household's services carry, as a schedule. Pure: the
 * channels come in as each service last listed them; out go the rows the tab draws, the type chips and the live search's matches.
 */
import type { VideoChannel } from "./types.js";
import { sportOf } from "./scores.js";

/** A half hour, the grid's column. */
export const LIVE_SLOT_MS = 30 * 60_000;
/** How far the grid reaches from now at the least; it reaches on to the last program any channel lists, up to LIVE_WINDOW_MAX_MS. */
export const LIVE_WINDOW_MS = 3 * 3_600_000;
export const LIVE_WINDOW_MAX_MS = 12 * 3_600_000;
/** A program on now with less than this left is not drawn (a sliver nobody can read): the next one takes its place at the left edge. */
export const LIVE_SLIVER_MS = 5 * 60_000;
/** A channel's word about what is on now, given without an end, is believed this long after it was read. */
/** A channel read longer ago than this is not judged inactive: its schedule is stale, not empty (2026-10-13). */
export const LIVE_STALE_MS = 3 * 3_600_000;
export const LIVE_NOW_BELIEVED_MS = 2 * 3_600_000;

/** A channel's type and where it came from: the service's own category, or Prism's rule on the name (labelled, §5). */
export interface LiveType { type: string; source: "service" | "prism" | "tmdb"; title?: string }

/** The service's own words, folded onto the tab's types; a word not here is shown as the service wrote it. */
const CATEGORY: Record<string, string> = {
  news: "News", sports: "Sports", sport: "Sports", "kids & family": "Kids", kids: "Kids", family: "Kids", children: "Kids",
  drama: "Drama", comedy: "Comedy", reality: "Reality", movies: "Movies", movie: "Movies", film: "Movies", showtime: "Movies",
  music: "Music", local: "Local", entertainment: "Entertainment", documentary: "Documentary", documentaries: "Documentary",
};
/** Prism's rule, in order: the first that matches the channel's name (or what is on it) names its type. */
const RULES: Array<[string, RegExp]> = [
  ["Local", /[/]local[/]/i],
  ["News", /\bnews\b|\bcnn\b|msnbc|\bcnbc\b|bloomberg|\bweather\b|newsmax|\bc-span\b/i],
  ["Sports", /sport|\bnfl\b|\bnba\b|\bmlb\b|\bnhl\b|\bgolf\b|\bespn\b|premier league|soccer|football|racing|nascar|\bufc\b|\bwwe\b|olympic|scoreboard|\bf1\b/i],
  ["Kids", /\bkids?\b|nick(elodeon|\s?jr)?\b|cartoon|disney (jr|junior)|\bjunior\b|pbs kids|\bbaby\b/i],
  ["Music", /\bmusic\b|\bmtv\b|\bvevo\b|\bradio\b|concert/i],
  ["Movies", /\bmovies?\b|cinema|\bfilms?\b|\bstarz\b|\bmgm\b/i],
  // the channels a name says plainly (2026-10-01, Peacock's "Black-Led Comedy" and "Classic TV Comedy" had fallen to Entertainment)
  ["Comedy", /\bcomedy\b|\bcomedies\b|\bsitcoms?\b|\blaughs?\b|stand-?up/i],
  ["Reality", /\breality\b|housewives|below deck|\bbravo\b|\bdating\b|\bchrisley\b/i],
  ["Drama", /\bdramas?\b|\bcrime\b|law & order|\bsvu\b|\bcsi\b|\bthriller\b/i],
];

/** The type the Live tab files a channel under. */
export function liveTypeOf(ch: Pick<VideoChannel, "name" | "now" | "url" | "category" | "tmdbType" | "tmdbTitle">): LiveType {
  const cat = (ch.category ?? "").trim();
  if (cat) return { type: CATEGORY[cat.toLowerCase()] ?? cat, source: "service" };
  // a channel named after one show, the show's genre on TMDB (2026-10-02): a named source's word before Prism's own rule on the name
  if (ch.tmdbType) return { type: ch.tmdbType, source: "tmdb", ...(ch.tmdbTitle ? { title: ch.tmdbTitle } : {}) };
  for (const [type, re] of RULES) if (re.test(ch.url ?? "") && type === "Local") return { type, source: "prism" };
  // Local is only a station that is the household's own: the one a service assigns by its address (Paramount+'s /local/ pages). Other
  // cities' stations are not local to anyone here (2026-10-02, "local for me would be Centre County PA ... remove the local category
  // unless you can make it actually local"); they file as News by their names
  const text = `${ch.name} ${ch.now ?? ""}`;
  for (const [type, re] of RULES) if (type !== "Local" && re.test(text)) return { type, source: "prism" };
  return { type: "Entertainment", source: "prism" };
}

export interface LiveProgram { title: string; start: number; end: number; now: boolean; desc?: string | null; match?: boolean; /** when it really starts, where it is drawn from the left edge in place of a sliver */ startsAt?: number; /** when it really began, for a program cut at the window's edge (the poster's elapsed share, 2026-10-02) */ began?: number; /** the sport, from the program's and channel's names (scores.ts sportOf) - the Live tab's Sports mode draws its symbol; Prism's reading of the words */ sport?: string }
export interface LiveRow {
  app: string; service: string; facet: string; id: string; name: string; url: string; logo: string | null;
  type: string; typeSource: "service" | "prism" | "tmdb"; programs: LiveProgram[]; match?: "channel" | "program" | null;
  /** the show TMDB matched when the type is TMDB's */
  typeTitle?: string;
  /** a content creator's stream (2026-10-12): a card on the Live page, not a row of the timetable */
  creator?: boolean;
  /** nothing on and nothing scheduled in the next 24 hours (2026-10-12): listed under Inactive, found by a search, out of every other view */
  inactive?: boolean;
  /** listed under this mode for what is on now, not the channel's own type (2026-10-02): the mode and the title TMDB matched */
  alsoBy?: { type: string; title: string };
  /** every mode the channel also counts in for what is on now */
  alsoTypes?: string[];
  /** Nothing of the channel's falls in the window: when its next listed program starts (an event row says "Starts Fri 12:10 AM"). */
  next?: number;
  /** A live event listed as a row (2026-09-30, Apple TV's Formula 1 and MLS): pressed, it plays as an event, not a channel. */
  event?: boolean;
  /** TMDB's pictures of the programme on now (2026-10-13), when its exact title is known there: the card shows one, the channel's logo in a corner */
  picture?: { poster: string | null; backdrop: string | null } | null;
  /** the event's series (Formula 1, MLS), the page's own word, for the row's label */
  series?: string;
}
/** `types`: each mode with its count, and the count by kind (2026-10-12: the On now view's strips - channels, content creators, events); `kinds`: the totals by kind. */
export interface LiveGuide { window: { start: number; end: number }; types: Array<{ type: string; count: number; channels: number; creators: number; events: number }>; kinds: { channels: number; creators: number; events: number; inactive: number }; rows: LiveRow[] }
/** `creator`: a service of content creators (Twitch, YouTube), whose streams have no timetable: the Live page draws them as cards, not rows (2026-10-12). */
export interface LiveService { app: string; name: string; facet: string; channels: VideoChannel[]; creator?: boolean }

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The program on a channel now, as the guide reads its schedule (a program never runs past the next one's start), else the channel's own word. */
/** A channel's line that names what is coming, not what is on ("Upcoming: Arsenal vs. Birmingham City", Paramount+'s event channels before the match):
 *  nothing is on such a channel now (2026-10-06, "we're showing a lot of channels that have Upcoming shows but nothing on right now"). */
export function isUpcomingLine(text: string | null | undefined): boolean { return /^\s*(upcoming|coming up|starts at|starting soon)\b/i.test(text ?? ""); }
export function programOnNow(ch: Pick<VideoChannel, "schedule" | "now" | "nowEnds" | "readAt">, now: number): { title: string; start: number | null; end: number | null } | null {
  const sched = (ch.schedule ?? []).slice().sort((a, b) => a.start - b.start);
  for (let i = 0; i < sched.length; i++) {
    const p = sched[i]!;
    const next = sched[i + 1]?.start;
    const stop = Math.min(p.end ?? next ?? p.start + LIVE_SLOT_MS, next !== undefined && next > p.start ? next : Infinity);
    if (p.start <= now && now < stop) return { title: p.title, start: p.start, end: isFinite(stop) ? stop : null };
  }
  const believed = ch.nowEnds ? ch.nowEnds > now : ch.readAt === undefined || now - ch.readAt < LIVE_NOW_BELIEVED_MS;
  if (ch.now && believed && !isUpcomingLine(ch.now)) return { title: ch.now, start: null, end: ch.nowEnds && ch.nowEnds > now ? ch.nowEnds : null };
  return null;
}
/** What a channel has on across the window: its schedule, or what is on now up to when it ends (the window's end when nobody says). */
export function programsOf(ch: VideoChannel, now: number, start: number, end: number): LiveProgram[] {
  const sched = (ch.schedule ?? []).slice().sort((a, b) => a.start - b.start);
  const out: LiveProgram[] = [];
  for (let i = 0; i < sched.length; i++) {
    const p = sched[i]!;
    // a program never runs past the start of the next (2026-09-29: Peacock's labels give a program's full running time, 11:00 to 1:18, on a
    // channel that starts the next one at 12:00)
    const next = sched[i + 1]?.start;
    const stop = Math.min(p.end ?? next ?? p.start + LIVE_SLOT_MS, next !== undefined && next > p.start ? next : Infinity);
    if (stop <= start || p.start >= end || stop <= p.start) continue;
    out.push({ title: p.title, start: Math.max(p.start, start), end: stop, now: p.start <= now && now < stop, ...(p.start < start ? { began: p.start } : {}), ...(p.desc ? { desc: p.desc } : {}) });
  }
  // what the channel last said was on: believed until it ends, or - when nobody said when - for LIVE_NOW_BELIEVED_MS after it was read
  // (2026-09-29 review: a program that ended an hour ago was drawn as on now for the whole window)
  const believed = ch.nowEnds ? ch.nowEnds > now : ch.readAt === undefined || now - ch.readAt < LIVE_NOW_BELIEVED_MS;
  if (!out.some((p) => p.now) && ch.now && believed && !isUpcomingLine(ch.now)) {
    // what is on now, from the channel's own line: it began before the window (unknown) and runs to its end if the service says
    const stop = ch.nowEnds && ch.nowEnds > now ? ch.nowEnds : out.find((p) => p.start > now)?.start ?? end;
    out.unshift({ title: ch.now, start: start, end: stop, now: true, ...(ch.nowDesc ? { desc: ch.nowDesc } : {}) });
  }
  // a program with minutes left is a sliver at the left edge: the next one is drawn from the edge, saying when it starts
  if (out.length > 1 && out[0]!.now && out[0]!.end - now < LIVE_SLIVER_MS && out[1]!.start >= out[0]!.end) {
    const next = out[1]!;
    out.splice(0, 2, { ...next, startsAt: next.start, start });
  }
  return out;
}

/**
 * The guide: every channel of every service, its programs across the grid's window, filtered by type and by the live search. The search
 * looks through the guide itself - channel names, what is on now, what is scheduled in the window - never the catalog.
 */
export function liveGuide(services: LiveService[], now: number, opts: { type?: string | null; q?: string | null } = {}): LiveGuide {
  // the grid begins at the current minute, so every channel's program on now starts at the same left edge (2026-09-28, "I don't like the uneven
  // left side of the schedule. Just cut it all off evenly"); what began earlier is cut there
  const start = Math.floor(now / 60_000) * 60_000;
  // the grid reaches as far as the services list (2026-09-29): three hours at the least, to the last program any channel names, twelve at the most
  let last = start + LIVE_WINDOW_MS;
  for (const s of services) for (const ch of s.channels) for (const p of ch.schedule ?? []) { const e = p.end ?? p.start + LIVE_SLOT_MS; if (e > last) last = e; }
  const end = Math.min(start + LIVE_WINDOW_MAX_MS, Math.ceil(last / LIVE_SLOT_MS) * LIVE_SLOT_MS);
  const words = fold(opts.q ?? "").split(" ").filter(Boolean);
  const all: LiveRow[] = [];
  for (const s of services) for (const ch of s.channels) {
    const t = liveTypeOf(ch);
    const programs = programsOf(ch, now, start, end);
    // the sport of each program on a sports channel, or of an event row, from its words (Sports mode's symbols, 2026-09-30)
    const sporty = t.type === "Sports" || !!ch.event || !!sportOf(ch.category, ch.name);
    if (sporty) for (const p of programs) { const sp = sportOf(p.title, ch.category, ch.name); if (sp) p.sport = sp; }
    let match: LiveRow["match"] = null;
    if (words.length) {
      const has = (text: string) => { const f = fold(text); return words.every((w) => f.includes(w)); };
      if (has(`${ch.name} ${s.name}`)) match = "channel";
      else {
        for (const p of programs) if (has(p.title)) { p.match = true; match = "program"; }
        // the whole schedule, past the window (2026-10-12, "we should still be able to search the full schedule")
        if (!match) for (const p of ch.schedule ?? []) if (has(p.title)) { match = "program"; break; }
        if (!match) continue;
      }
    }
    const next = programs.length ? undefined : (ch.schedule ?? []).map((p) => p.start).filter((st) => st > now).sort((a, b) => a - b)[0];
    // nothing on and nothing in the next 24 hours: inactive (2026-10-12, "only show channels with content in the next 24 hours, otherwise move
    // them to an inactive category") - listed last, counted apart, out of the modes; a search still finds it
    // a channel whose last read is hours old is unknown, not inactive (2026-10-13, "why does youtubetv only show 9 channels on live with On Now
    // selected": a read that came back with ten rows left the other 116 on last night's schedules, and all of them went under Inactive)
    const fresh = ch.readAt === undefined || now - ch.readAt < LIVE_STALE_MS;
    const inactive = fresh && !programs.length && (next === undefined || next - now > 24 * 3_600_000);   // an event days away too ("why do all those Apple channels with content more than 24 hours out still take the first x slots")
    // a channel with nothing on and nothing in the window, whose only word is what is coming (an event channel before its match), is left out;
    // a search that names the channel still finds it (2026-10-06)
    if (!programs.length && next === undefined && isUpcomingLine(ch.now) && match !== "channel") continue;
    // a channel also counts in a mode for what is on now (2026-10-02, "Movies please": Top Gun on a channel filed under Drama is a movie now,
    // by TMDB's word), the mode and the title named on the row when that is why it is listed
    const onNow = programs.find((p) => p.now)?.title ?? null;
    const also = (ch.nowTypes ?? []).filter((n) => n.type !== t.type && onNow !== null && (n.of === undefined || n.of === onNow));
    const alsoBy = opts.type && also.find((n) => n.type === opts.type);
    all.push({ app: s.app, service: s.name, facet: s.facet, id: ch.id, name: ch.name, url: ch.url, logo: ch.logo ?? null, type: t.type, typeSource: t.source, ...(s.creator ? { creator: true } : {}), ...(t.title ? { typeTitle: t.title } : {}), ...(alsoBy ? { alsoBy } : {}), programs, match, ...(next ? { next } : {}), ...(inactive ? { inactive: true } : {}), ...(ch.event ? { event: true } : {}), ...(ch.series ? { series: ch.series } : {}), ...(also.length ? { alsoTypes: also.map((n) => n.type) } : {}) });
  }
  const counts = new Map<string, { count: number; channels: number; creators: number; events: number }>();
  const kindOf = (r: LiveRow): "channels" | "creators" | "events" => (r.creator ? "creators" : r.event ? "events" : "channels");
  const kinds = { channels: 0, creators: 0, events: 0, inactive: 0 };
  const bump = (type: string, k: "channels" | "creators" | "events") => { const c = counts.get(type) ?? { count: 0, channels: 0, creators: 0, events: 0 }; c.count++; c[k]++; counts.set(type, c); };
  for (const r of all) { if (r.inactive) { kinds.inactive++; continue; } const k = kindOf(r); kinds[k]++; bump(r.type, k); for (const t2 of r.alsoTypes ?? []) bump(t2, k); }
  const types = [...counts.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).map(([type, c]) => ({ type, ...c }));
  // the order: a channel the search named first, then by type; within a type event rows (2026-09-30) before channels, events by time
  // (on now first, then by start), channels by name. Each row gets ONE key and the rows are ordered by it - a total order by
  // construction (a comparator that weighed an event against a channel by time on one side and by name on the other made a cycle,
  // and the sort came out scrambled on the wall, 2026-09-30)
  const when = (r: LiveRow): number => r.programs.some((p) => p.now) ? 0 : (r.programs[0]?.startsAt ?? r.programs[0]?.start ?? r.next ?? Number.MAX_SAFE_INTEGER);
  const key = (r: LiveRow): [number, string, number, number, string] => [r.match === "channel" ? 0 : 1, r.type, r.event ? 0 : 1, r.event ? when(r) : 0, r.name];
  const byKey = (a: ReturnType<typeof key>, b: ReturnType<typeof key>): number => a[0] - b[0] || a[1].localeCompare(b[1]) || a[2] - b[2] || a[3] - b[3] || a[4].localeCompare(b[4]);
  // Sports mode takes every event row too (2026-10-01, "Why isn't Apple listed?"): an event's type is its series (Formula 1, MLS), a sport by nature
  const sorted = all.filter((r) => !opts.type || r.type === opts.type || (opts.type === "Sports" && r.event) || (r.alsoTypes ?? []).includes(opts.type)).map((r) => ({ r, k: key(r) })).sort((a, b) => byKey(a.k, b.k)).map((x) => x.r);
  const rows = [...sorted.filter((r) => !r.inactive), ...sorted.filter((r) => r.inactive)];   // the inactive last, in their own order
  return { window: { start, end }, types, kinds, rows };
}
