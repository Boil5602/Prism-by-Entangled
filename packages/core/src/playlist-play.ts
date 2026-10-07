/**
 * Playlists' continuous play (docs/features/playlists.md "Continuous play", 2026-09-27): the rules, pure. The runtime feeds each report from
 * the screen (what plays, where, whether a pick is still starting) and the player's own `ended`; this answers what to do.
 *
 * Played to its end (2026-09-27, "The average length of ending credits for modern feature films runs between 3 and 10 minutes, with a median
 * duration of about 5 minutes and 43 seconds. The average length of ending credits for traditional television shows is 30 seconds to 2 minutes,
 * while high-budget streaming and prestige TV shows often feature longer credits lasting 3 to 7 minutes. Adjust accordingly."): the player's
 * `ended`, or a stop inside the credits window - a movie's last 8% (3 to 10 minutes), an episode's last 12% (30 seconds to 7 minutes). A
 * stop before that is leaving early: the item is not marked.
 */
import type { PlItem } from "./playlist-store.js";
import { titleKey } from "./lenses.js";

export function creditsWindow(kind: "episode" | "movie", duration: number | null | undefined): number {
  if (!duration || duration <= 0) return 0;
  return kind === "movie" ? Math.min(600, Math.max(180, duration * 0.08)) : Math.min(420, Math.max(30, duration * 0.12));
}
export function inCredits(kind: "episode" | "movie", position: number | null | undefined, duration: number | null | undefined): boolean {
  // a clip a minute long is no title's credits (2026-09-28 review: an ad's own clock - 20 of 30 s - read as the episode's credits)
  if (typeof position !== "number" || !duration || duration <= 60) return false;
  return duration - position <= creditsWindow(kind, duration);
}

export interface RunVideo { kind?: string; title?: string; series?: string; season?: number | null; episode?: number | null; position?: number | null; duration?: number | null; ad?: boolean }
export interface RunReport { pending: boolean; playing: boolean; video: RunVideo | null }
export interface RunState {
  listId: string; key: string; tile: string | null;
  /** the item has been seen playing on the screen */
  seen: boolean;
  /** its last position was inside the credits window */
  near: boolean;
  /** the player said `ended` */
  ended: boolean;
  stopAfter: boolean;
  /** Play opened the show without the episode (no deep link): the person picks it in the service's player */
  waiting: boolean;
  /** when the title left the screen inside the credits (the service's autoplay gets a moment to show the next one) */
  goneAt: number | null;
  startedAt: number;
}
export type RunStep =
  | { do: "none" }
  | { do: "wait"; ms: number }
  | { do: "advance"; keep: boolean }   // the current item completed; keep = the service's own autoplay is on the next item already
  | { do: "end"; completed: boolean; why: string };

/** Does what plays match the item? An episode by its show and numbers (by its title when the page gives no numbers); a movie by its title. */
export function matchesItem(v: RunVideo | null, item: PlItem | null): boolean {
  if (!v || !item) return false;
  // a movie is never an episode that shares its name (2026-09-28 review: the film "Home" marked finished by a series' episode called "Home")
  if (item.kind === "movie") return !!v.title && !v.series && v.kind !== "episode" && titleKey(v.title) === titleKey(item.title);
  const show = v.series || "";
  if (!show || !(showsMatch(show, item.show ?? item.title) || (!!item.playAs && showsMatch(show, item.playAs)))) return false;
  // by the episode's title first, then its numbers (2026-09-27: Paramount+'s player calls The Naked Time S1 E5 where the playlist, by air date, has
  // it S1 E4 - numbers alone flagged The Enemy Within as watched); titles that plainly differ are another episode whatever the numbers say
  const t = (x: string) => titleKey(x).replace(/\b(part|pt|chapter)\b/g, " ").replace(/\s+/g, " ").trim();
  const vt = v.title ? t(v.title) : "", it = item.title ? t(item.title) : "";
  if (vt && it) {
    if (vt === it || (vt.length > 4 && it.length > 4 && (vt.includes(it) || it.includes(vt)))) return true;
    if (vt !== t(show) && it !== t(item.show ?? "")) return false;   // a real title on both sides, not the same: another episode
  }
  if (typeof v.season === "number" && typeof v.episode === "number") return v.season === item.season && v.episode === item.episode;
  return false;
}

/** The service's name for a show against the playlist's (2026-09-27: Paramount+ plays "Star Trek: The Original Series (Remastered)" for the
 *  playlist's "Star Trek"): bracketed words set aside, then the same name, or one beginning with the other. */
export function showsMatch(a: string, b: string): boolean {
  const k = (x: string) => titleKey(x.replace(/\([^)]*\)/g, " "));
  const ka = k(a), kb = k(b);
  return !!ka && !!kb && (ka === kb || ka.startsWith(kb + " ") || kb.startsWith(ka + " "));
}
export const AUTOPLAY_GRACE_MS = 8_000;

export function stepRun(run: RunState, report: RunReport, current: PlItem, next: PlItem | null, now: number): { run: RunState; step: RunStep } {
  if (report.pending) return { run, step: { do: "none" } };   // a pick still starting
  const v = report.video;
  const titled = !!v && !!(v.title || v.series) && v.kind !== "title";
  const done = run.near || run.ended;
  if (titled && matchesItem(v, current)) {
    // ended, and the page keeps the title up (an end card): the service's autoplay gets its moment, then the playlist moves on
    if (run.ended && run.seen) {
      if (run.stopAfter) return { run, step: { do: "end", completed: true, why: "stopped after this one" } };
      if (run.goneAt === null) return { run: { ...run, goneAt: now }, step: { do: "wait", ms: AUTOPLAY_GRACE_MS } };
      if (now - run.goneAt < AUTOPLAY_GRACE_MS) return { run, step: { do: "wait", ms: AUTOPLAY_GRACE_MS - (now - run.goneAt) } };
      return { run, step: { do: "advance", keep: false } };
    }
    const near = !v!.ad && inCredits(current.kind, v!.position, v!.duration);   // an ad's clock is not the title's
    return { run: { ...run, seen: true, waiting: false, near: near || (run.near && typeof v!.position !== "number"), goneAt: null }, step: { do: "none" } };
  }
  if (titled && report.playing) {
    if (run.seen && done) {
      if (next && matchesItem(v, next)) return { run, step: { do: "advance", keep: true } };   // the service's autoplay is on our next item
      if (run.stopAfter) return { run, step: { do: "end", completed: true, why: "stopped after this one" } };
      return { run, step: { do: "advance", keep: false } };   // it rolled into something else: the playlist's next item instead
    }
    if (run.seen) return { run, step: { do: "end", completed: false, why: "another title is playing" } };
    return { run, step: { do: "none" } };   // not seen yet: the page still getting there, or the person picking the episode
  }
  if (titled) return { run, step: { do: "none" } };   // paused on something: nothing to decide
  // nothing titled on the screen
  if (run.seen && done) {
    if (run.stopAfter) return { run, step: { do: "end", completed: true, why: "stopped after this one" } };
    if (run.goneAt === null) return { run: { ...run, goneAt: now }, step: { do: "wait", ms: AUTOPLAY_GRACE_MS } };
    if (now - run.goneAt < AUTOPLAY_GRACE_MS) return { run, step: { do: "wait", ms: AUTOPLAY_GRACE_MS - (now - run.goneAt) } };
    return { run, step: { do: "advance", keep: false } };
  }
  if (run.seen) return { run, step: { do: "end", completed: false, why: "left the player" } };
  return { run, step: { do: "none" } };
}
