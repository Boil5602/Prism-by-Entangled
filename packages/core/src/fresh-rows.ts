/**
 * Two catalog lens rows on Watch, both TMDB's dates on the household's own services (2026-09-23, "we're only using transparent algorithms for
 * the lenses ... One is, Series with new episodes in the last 7 days. Sort on least recent first, so as shows age out, they move to the left
 * (newest at the end). That way people are seeing things before they fall off. Also movies released in the last 30 days would be good, oldest
 * first"; "these need to be covered by one of the installed services"). Pure: the definitions, the day windows, the order.
 */
/** The rows' windows (2026-09-24, "change New Episodes this Week to Last 10 days. And New Movies this month should be last 30 days"). */
export const FRESH_EPISODE_DAYS = 10;
export const FRESH_MOVIE_DAYS = 30;
export const FRESH_EPISODES = {
  id: "fresh-episodes", name: "New episodes, last 10 days",
  counted: "The air date of each series' latest episode, as TMDB records it.",
  who: "Nobody is counted: it is a date.",
  decides: "The network or studio that aired the episode; TMDB's contributors record the date. Which series your services carry is JustWatch's listing, through TMDB.",
  source: "TMDB discover (air dates) and each series' last_episode_to_air · JustWatch", sourceUrl: "https://www.themoviedb.org/",
  formula: "Series your services carry ({offer}) with an episode aired in the ten days through {date}, the one whose latest episode aired longest ago first, so a show about to leave the row is on the left.",
} as const;

export const FRESH_MOVIES = {
  id: "fresh-movies", name: "New movies, last 30 days",
  counted: "Each film's first release date, as TMDB records it. A re-release or a TV airing doesn't count.",
  who: "Nobody is counted: it is a date.",
  decides: "The studio that released it; TMDB's contributors record the date. Which films your services carry is JustWatch's listing, through TMDB.",
  source: "TMDB discover (primary release date) · JustWatch", sourceUrl: "https://www.themoviedb.org/",
  formula: "Films your services carry ({offer}) first released in the thirty days through {date}, the oldest release first.",
} as const;

/** yyyy-mm-dd of the local day `days` before `now` (0 = today). */
export function dayBefore(now: number, days: number): string {
  const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - days);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** The row's order: by the date, oldest first; the title breaks a tie. Pure. */
export function orderFresh<T extends { date: string; title: string }>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
}

/** The card's number: the date with its source, never bare ("Sep 21 · TMDB"). */
export function freshValue(prefix: string, date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return "";
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return prefix + " " + MON[Number(m[2]) - 1] + " " + Number(m[3]) + " · TMDB";
}
