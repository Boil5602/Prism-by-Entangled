/**
 * Scores (2026-09-30, "Can we throw today's key sports game scores at the top of the live screen? Maybe in a collapsed area that is easy to
 * spot and expand as desired?"): the day's games of the big leagues, from ESPN's public scoreboard pages - one bare address a league, no
 * key, no account, no parameter (section 19/22: the shell fetches exactly the address, nothing of the device in it). Shown on the Live tab
 * in Sports mode as a collapsed bar, every number traceable to its source (section 5): the bar says ESPN.
 *
 * Pure: the pages' text in, the games out. The orchestrator fetches and keeps them.
 */

export interface ScoreTeam { name: string; abbr: string; score: string | null; winner?: boolean; /** the team's mark and colour, as the source gives them (a picture address; a hex colour without #) */ logo?: string | null; color?: string | null }
export interface ScoreGame {
  /** the league as ESPN abbreviates it: "MLB", "NHL", "WNBA", "ATP" */
  league: string;
  leagueName: string;
  id: string;
  /** epoch ms */
  start: number;
  /** before, in play, over */
  state: "pre" | "in" | "post";
  /** the source's own words for where it stands: "Final", "Final/10", "3:32 - 4th", "FT", "9/30 - 11:05 PM EDT" */
  detail: string;
  home: ScoreTeam;
  away: ScoreTeam;
  /** who is showing it, as the source names them ("Apple TV", "Peacock", "Prime Video") - television and streaming, not radio */
  tv: string[];
  /** the source's short line ("PIT @ CLE") */
  short: string;
  /** the sport's mark, as the source gives it (a picture address) */
  sportLogo?: string | null;
}

export const SCORE_SOURCE = "ESPN";
/**
 * ESPN's scoreboard header: the strip of the day's games across the leagues in season that tops ESPN's own pages - its pick of the key
 * games, one bare address. (The per-league scoreboard addresses answer 403 to anything but a handful of known clients; this one answers
 * Prism as itself.)
 */
export const SCORE_URL = "https://site.web.api.espn.com/apis/v2/scoreboard/header";

/** ESPN's header page read into games. Anything not well formed is left out. */
export function parseScoreboard(text: string): ScoreGame[] {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return []; }
  const sports = (j as { sports?: unknown })?.sports;
  if (!Array.isArray(sports)) return [];
  const out: ScoreGame[] = [];
  for (const sp of sports as Array<Record<string, unknown>>) {
    const leagues = Array.isArray(sp?.leagues) ? (sp.leagues as Array<Record<string, unknown>>) : [];
    const pic = (x: unknown): string | null => typeof x === "string" && /^https:\/\//.test(x) ? x.slice(0, 300) : null;
    const sportLogo = Array.isArray(sp?.logos) ? (sp.logos as Array<{ href?: unknown }>).map((l) => pic(l?.href)).find((h) => !!h && /dark/.test(h)) ?? (sp.logos as Array<{ href?: unknown }>).map((l) => pic(l?.href)).find((h) => !!h) ?? null : null;
    for (const l of leagues) {
      const league = typeof l?.abbreviation === "string" && l.abbreviation ? l.abbreviation : typeof l?.shortName === "string" ? l.shortName : "";
      const leagueName = typeof l?.name === "string" && l.name ? l.name : league;
      const events = Array.isArray(l?.events) ? (l.events as Array<Record<string, unknown>>) : [];
      for (const e of events) {
        if (!e || typeof e !== "object") continue;
        const id = typeof e.id === "string" ? e.id : null;
        const start = typeof e.date === "string" ? Date.parse(e.date) : NaN;
        const state = e.status === "pre" || e.status === "in" || e.status === "post" ? e.status : null;
        if (!id || !isFinite(start) || !state || !league) continue;
        const teams = Array.isArray(e.competitors) ? (e.competitors as Array<Record<string, unknown>>) : [];
        const team = (side: "home" | "away"): ScoreTeam | null => {
          const t = teams.find((x) => x && x.homeAway === side);
          if (!t) return null;
          const name = typeof t.name === "string" && t.name ? t.name : typeof t.displayName === "string" ? t.displayName : "";
          const abbr = typeof t.abbreviation === "string" && t.abbreviation ? t.abbreviation : name.slice(0, 3).toUpperCase();
          const score = state === "pre" ? null : typeof t.score === "string" && t.score ? t.score : typeof t.score === "number" ? String(t.score) : null;
          if (!name) return null;
          const logo = pic(t.logoDark) ?? pic(t.logo);
          const color = typeof t.color === "string" && /^[0-9a-f]{6}$/i.test(t.color) ? t.color.toLowerCase() : null;
          return { name: name.slice(0, 40), abbr: abbr.slice(0, 8), score: score ? score.slice(0, 12) : null, ...(t.winner === true ? { winner: true } : {}), logo, color };
        };
        const home = team("home"), away = team("away");
        if (!home || !away) continue;
        const tv = Array.isArray(e.broadcasts) ? (e.broadcasts as Array<{ name?: unknown; type?: unknown }>).filter((b) => typeof b?.name === "string" && !/radio/i.test(String(b?.type ?? ""))).map((b) => b.name as string) : [];
        const detail = typeof e.summary === "string" ? e.summary : "";
        out.push({ league: league.slice(0, 20), leagueName: leagueName.slice(0, 60), id, start, state, detail: detail.slice(0, 40), home, away, tv: [...new Set(tv)].slice(0, 4), short: typeof e.shortName === "string" ? e.shortName.slice(0, 40) : away.abbr + " @ " + home.abbr, sportLogo });
      }
    }
  }
  return out;
}

/**
 * The day's games: in play first, then over, then still to come, by start; a game of the day is one that starts on the day (the device's
 * day, `dayStart`..`dayEnd`) or is in play now. Anything the feed lists for another day is left out here.
 */
export function gamesOfTheDay(all: readonly ScoreGame[], dayStart: number, dayEnd: number): ScoreGame[] {
  const rank = (g: ScoreGame) => g.state === "in" ? 0 : g.state === "post" ? 1 : 2;
  return all.filter((g) => g.state === "in" || (g.start >= dayStart && g.start < dayEnd))
    .sort((a, b) => rank(a) - rank(b) || a.start - b.start || a.league.localeCompare(b.league));
}

/**
 * ESPN's per-league scoreboard pages: a whole day of one league, by date ("?dates=YYYYMMDD"). They refuse any client that is not a browser, so
 * Prism reads them in a hidden page of its own browser, which is what it is (2026-10-01, "There isn't a way to look up all these scores
 * online?"). Today's and yesterday's pages, hourly, make the last day whole - every final included - whatever the header strip lists now.
 */
export const SCORE_DAY_LEAGUES: ReadonlyArray<{ league: string; leagueName: string; path: string }> = [
  { league: "NFL", leagueName: "National Football League", path: "football/nfl" },
  { league: "MLB", leagueName: "Major League Baseball", path: "baseball/mlb" },
  { league: "NBA", leagueName: "National Basketball Association", path: "basketball/nba" },
  { league: "WNBA", leagueName: "Women's National Basketball Association", path: "basketball/wnba" },
  { league: "NHL", leagueName: "National Hockey League", path: "hockey/nhl" },
  { league: "MLS", leagueName: "Major League Soccer", path: "soccer/usa.1" },
  { league: "NCAAF", leagueName: "College football", path: "football/college-football" },
];
export function scoreDayUrl(path: string, day: Date): string {
  const d = day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate();
  return `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${d}`;
}
/** A per-league page read into games: the same fields as the header's, from the page's own shape. */
export function parseLeagueScoreboard(league: string, leagueName: string, text: string): ScoreGame[] {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return []; }
  const events = (j as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  const pic = (x: unknown): string | null => typeof x === "string" && /^https:\/\//.test(x) ? x.slice(0, 300) : null;
  const out: ScoreGame[] = [];
  for (const e of events as Array<Record<string, unknown>>) {
    if (!e || typeof e !== "object") continue;
    const id = typeof e.id === "string" ? e.id : null;
    const start = typeof e.date === "string" ? Date.parse(e.date) : NaN;
    const comp = Array.isArray(e.competitions) ? (e.competitions[0] as Record<string, unknown> | undefined) : undefined;
    const status = (e.status as { type?: { state?: unknown; shortDetail?: unknown; detail?: unknown } } | undefined)?.type;
    const state = status?.state === "pre" || status?.state === "in" || status?.state === "post" ? status.state : null;
    if (!id || !isFinite(start) || !comp || !state) continue;
    const teams = Array.isArray(comp.competitors) ? (comp.competitors as Array<Record<string, unknown>>) : [];
    const team = (side: "home" | "away"): ScoreTeam | null => {
      const t = teams.find((x) => x && x.homeAway === side);
      const tm = t?.team as { displayName?: unknown; shortDisplayName?: unknown; abbreviation?: unknown; logo?: unknown; color?: unknown } | undefined;
      if (!t || !tm) return null;
      const name = typeof tm.shortDisplayName === "string" && tm.shortDisplayName ? tm.shortDisplayName : typeof tm.displayName === "string" ? tm.displayName : "";
      const abbr = typeof tm.abbreviation === "string" && tm.abbreviation ? tm.abbreviation : name.slice(0, 3).toUpperCase();
      const score = state === "pre" ? null : typeof t.score === "string" && t.score ? t.score : typeof t.score === "number" ? String(t.score) : null;
      if (!name) return null;
      const color = typeof tm.color === "string" && /^[0-9a-f]{6}$/i.test(tm.color) ? tm.color.toLowerCase() : null;
      return { name: name.slice(0, 40), abbr: abbr.slice(0, 8), score: score ? score.slice(0, 12) : null, ...(t.winner === true ? { winner: true } : {}), logo: pic(tm.logo), color };
    };
    const home = team("home"), away = team("away");
    if (!home || !away) continue;
    const tv = Array.isArray(comp.broadcasts) ? (comp.broadcasts as Array<{ names?: unknown }>).flatMap((b) => Array.isArray(b?.names) ? b.names.filter((n): n is string => typeof n === "string") : []) : [];
    const detail = typeof status?.shortDetail === "string" ? status.shortDetail : typeof status?.detail === "string" ? status.detail : "";
    out.push({ league, leagueName, id, start, state, detail: detail.slice(0, 40), home, away, tv: [...new Set(tv)].slice(0, 4), short: typeof e.shortName === "string" ? e.shortName.slice(0, 40) : away.abbr + " @ " + home.abbr, sportLogo: null });
  }
  return out;
}

/**
 * The last day's games (2026-10-01, "Do you have a way to pull together all scores from the last 24 hours?"): everything kept that began
 * within the day before now or is on now - in play first, then over with the newest first, then still to come by start. ESPN's header
 * lists only the current slate, so the kept games (every read's, merged by id, each kept a day after its start) are what make the day.
 */
export function gamesOfLastDay(all: readonly ScoreGame[], now: number): ScoreGame[] {
  const rank = (g: ScoreGame) => g.state === "in" ? 0 : g.state === "post" ? 1 : 2;
  return all.filter((g) => g.state === "in" || (g.start >= now - 24 * 3_600_000 && g.start <= now + 24 * 3_600_000))
    .sort((a, b) => rank(a) - rank(b) || (a.state === "post" ? b.start - a.start : a.start - b.start) || a.league.localeCompare(b.league));
}
/** Every read merged into what is kept: a game seen again takes its newer state; one not seen for a day after its start goes. */
export function mergeKept(kept: readonly ScoreGame[], read: readonly ScoreGame[], now: number): ScoreGame[] {
  const byId = new Map<string, ScoreGame>();
  for (const g of kept) byId.set(g.league + ":" + g.id, g);
  for (const g of read) byId.set(g.league + ":" + g.id, g);
  return [...byId.values()].filter((g) => g.start > now - 24 * 3_600_000 && g.start < now + 7 * 24 * 3_600_000).slice(0, 400);
}

/**
 * Who carries a game, as ESPN names them, to the service on the wall (2026-10-01, "If the game is live, and we have access to it through
 * one of the services, make sure we can click through"). Only services Prism has an adapter for; ESPN's own networks are not among them.
 */
/**
 * Which services carry a game: each adapter names the networks it carries live as ESPN writes them (`broadcasters`, 2026-10-02 - service
 * knowledge in the adapter, not core: "we'll make sure the adapter includes the news feature. Can this be within the scope of some
 * adapters"). A broadcaster matches when ESPN's name is it, or begins with it as a word ("NBC" takes "NBC Sports Network", not "NBCSN").
 */
export function appsCarrying(tv: readonly string[], carriers: ReadonlyArray<{ app: string; broadcasters?: readonly string[] | undefined }>): string[] {
  const out: string[] = [];
  const norm = (s: string) => s.trim().toLowerCase();
  for (const name0 of tv) {
    const name = norm(name0);
    for (const c of carriers) {
      if (out.includes(c.app)) continue;
      if ((c.broadcasters ?? []).some((b) => { const w = norm(b); return w.length > 0 && (name === w || name.startsWith(w + " ")); })) out.push(c.app);
    }
  }
  return out;
}
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Words a team's name shares with half the league: no mark of the team on their own. */
const GENERIC_WORDS = new Set(["city", "united", "state", "football", "club", "team", "real", "inter", "athletic", "sporting", "saint", "new", "york", "los", "las", "san", "the", "fc", "sc", "cf", "afc"]);
/**
 * Whether a service's own words for a stream (an event's title, a channel's program) name this game: a distinctive word of each team's
 * name (ESPN's "Red Bull NY" against Apple's "New York Red Bulls": "bull" begins "bulls"), or the team's abbreviation as a word of its own.
 */
export function namesGame(text: string, g: ScoreGame): boolean {
  const t = " " + fold(text) + " ";
  const has = (team: ScoreTeam) => {
    const words = fold(team.name).split(" ").filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
    if (words.some((w) => t.includes(" " + w))) return true;
    const abbr = fold(team.abbr);
    return abbr.length >= 3 && t.includes(" " + abbr + " ");
  };
  return has(g.home) && has(g.away);
}

/** One line for a game, as a person says it: "Yankees 3, Red Sox 2, Final" / "Chiefs 14, Ravens 10, 3rd - 5:32" / "Steelers at Browns, 8:15 PM". */
export function scoreLine(g: ScoreGame, clock: (ms: number) => string): string {
  if (g.state === "pre") return `${g.away.name} at ${g.home.name}, ${clock(g.start)}`;
  const num = (t: ScoreTeam) => /^\d+$/.test(t.score ?? "") ? Number(t.score) : NaN;
  const first = isFinite(num(g.home)) && isFinite(num(g.away)) ? (num(g.home) >= num(g.away) ? g.home : g.away) : g.away;   // a set score ("5-6") stays as written, away first
  const second = first === g.home ? g.away : g.home;
  return `${first.name} ${first.score ?? "0"}, ${second.name} ${second.score ?? "0"}, ${g.detail || (g.state === "post" ? "Final" : "in play")}`;
}

/**
 * The sport a program is, from its name and its channel's (the Live tab's Sports mode marks each program on now with its sport): a word of
 * the sport or its league. Soccer's words first, so a bare "football" is the American one. Null when nothing says.
 */
const SPORT_WORDS: ReadonlyArray<[string, RegExp]> = [
  ["soccer", /\b(mls|soccer|premier league|english football league|football league|efl|carabao|fa cup|la liga|serie a|bundesliga|champions league|europa league|uefa|fifa|ligue 1|copa|liga mx|fc|united|city sc|world cup|golazo)\b/i],
  ["baseball", /\b(mlb|baseball|world series|home run)\b/i],
  ["basketball", /\b(nba|wnba|basketball|march madness|final four)\b/i],
  ["hockey", /\b(nhl|hockey|stanley cup)\b/i],
  ["golf", /\b(pga|lpga|golf|masters|ryder cup|open championship)\b/i],
  ["tennis", /\b(tennis|wimbledon|roland garros|atp|wta|australian open|us open tennis)\b/i],
  ["racing", /\b(formula 1|f1|grand prix|nascar|indycar|motogp|racing|le mans|rally)\b/i],
  ["fighting", /\b(ufc|mma|boxing|wwe|wrestling|bellator|fight night)\b/i],
  ["football", /\b(nfl|cfb|college football|football|super bowl|gridiron)\b/i],
];
export function sportOf(...texts: Array<string | null | undefined>): string | null {
  const t = texts.filter((x): x is string => typeof x === "string" && x.length > 0).join(" ");
  if (!t) return null;
  for (const [sport, re] of SPORT_WORDS) if (re.test(t)) return sport;
  return null;
}
