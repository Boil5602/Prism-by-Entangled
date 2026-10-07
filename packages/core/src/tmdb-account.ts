/**
 * The person's own TMDB account, linked once, so a rating they give on the wall goes to TMDB under their name (2026-10-03, "Let's build
 * ratings writes to TMDB for individual accounts, if linked"). TMDB's v3 flow: Prism asks for a request token, the person approves it on
 * TMDB's own site (signed in to the account that issued their key - the same account, no second token), and Prism trades the token for a
 * session it keeps on the device beside the key. A rating is a press on a star, never inferred from watching; it is sent only with that
 * session, only to TMDB (dashboard-schema section 4a: the person's own keyed call), and TMDB answers the account's rating of a title so
 * the wall can show it back. Nothing is ever signed up for on anyone's behalf: TMDB has no API for that, and Prism signs in, never up.
 *
 * Pure: the addresses, the bodies and the readings of TMDB's answers. The orchestrator makes the calls, the runtime exposes them, the
 * host draws the stars and the approval page.
 */

export const TMDB_APPROVE_URL = "https://www.themoviedb.org/authenticate/";

/** What the device keeps once linked: the v3 session (ratings, the watchlist) and, linked through TMDB's v4 sign-in, the user's access
 *  token and account id for lists (public or private, 2026-10-03). */
export interface TmdbSession { sessionId: string; accountId: number; username: string; linkedAt: number; v4Token?: string; accountObjectId?: string }

/** TMDB's v4 approval page (the newer sign-in that lists need). */
export const TMDB_APPROVE_V4_URL = "https://www.themoviedb.org/auth/access?request_token=";
export function approveUrlV4(requestToken: string): string { return TMDB_APPROVE_V4_URL + encodeURIComponent(requestToken); }
/** The v4 user access token and account id from /4/auth/access_token; null when not approved yet. */
export function accessTokenFrom(answer: unknown): { token: string; accountObjectId: string } | null {
  const a = answer as { success?: unknown; access_token?: unknown; account_id?: unknown } | null;
  return a && a.success !== false && typeof a.access_token === "string" && a.access_token && typeof a.account_id === "string" ? { token: a.access_token, accountObjectId: a.account_id } : null;
}
/** Whether a key is a v4 read access token (a JWT): the v4 sign-in needs one. */
export function isReadToken(key: string | null): boolean { return !!key && key.split(".").length === 3; }

/** The approval page for a request token: TMDB's own site, where the person signs in and presses Approve. */
export function approveUrl(requestToken: string): string {
  return TMDB_APPROVE_URL + encodeURIComponent(requestToken);
}

/** The request token from /authentication/token/new; null when the answer is not one. */
export function requestTokenFrom(answer: unknown): string | null {
  const a = answer as { success?: unknown; request_token?: unknown } | null;
  return a && a.success === true && typeof a.request_token === "string" && a.request_token.length > 0 ? a.request_token : null;
}

/** The session id from /authentication/session/new; null when TMDB refused (the token not approved yet, or expired). */
export function sessionIdFrom(answer: unknown): string | null {
  const a = answer as { success?: unknown; session_id?: unknown } | null;
  return a && a.success === true && typeof a.session_id === "string" && a.session_id.length > 0 ? a.session_id : null;
}

/** The account behind a session, from /account. */
export function accountFrom(answer: unknown): { id: number; username: string } | null {
  const a = answer as { id?: unknown; username?: unknown; name?: unknown } | null;
  if (!a || typeof a.id !== "number") return null;
  const username = typeof a.username === "string" && a.username ? a.username : typeof a.name === "string" && a.name ? a.name : "TMDB account";
  return { id: a.id, username: username.slice(0, 60) };
}

/** A rating as TMDB takes it: half steps from 0.5 to 10; null when the number is not one. */
export function ratingValue(v: unknown): number | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  const r = Math.round(v * 2) / 2;
  return r >= 0.5 && r <= 10 ? r : null;
}

/** The body of a rating write. */
export function ratingBody(value: number): string { return JSON.stringify({ value }); }

/** The account's own rating of a title from /{kind}/{id}/account_states: the value, null when the account has not rated it. */
export function ratedFrom(answer: unknown): number | null {
  const a = answer as { rated?: unknown } | null;
  const r = a?.rated;
  if (r && typeof r === "object" && typeof (r as { value?: unknown }).value === "number") return (r as { value: number }).value;
  return null;
}

/** TMDB's word on a write (/rating): status_code 1 created, 12 updated, 13 deleted. */
export function writeOk(answer: unknown): boolean {
  const a = answer as { success?: unknown; status_code?: unknown } | null;
  return !!a && (a.success === true || a.status_code === 1 || a.status_code === 12 || a.status_code === 13);
}

/**
 * The person's TMDB watchlist (2026-10-03, "can we let users select and add titles to their TMDB 'My Watchlist' ... and ONLY show the
 * TMDB My Watchlist"): read page by page, newest added first, both kinds; a title added or taken off with one call each.
 */
export function watchlistPagePath(accountId: number, kind: "movie" | "tv"): string { return `/account/${accountId}/watchlist/${kind === "tv" ? "tv" : "movies"}`; }
export function watchlistWritePath(accountId: number): string { return `/account/${accountId}/watchlist`; }
export function watchlistBody(kind: "movie" | "tv", id: number, on: boolean): string { return JSON.stringify({ media_type: kind, media_id: id, watchlist: on }); }
/** A page's total count of pages; 1 when TMDB says nothing. */
export function totalPages(answer: unknown): number {
  const t = (answer as { total_pages?: unknown } | null)?.total_pages;
  return typeof t === "number" && t >= 1 ? Math.min(t, 50) : 1;
}

/** The path of a title's rating or state call. */
export function ratingPath(kind: "movie" | "tv", id: number): string { return `/${kind}/${id}/rating`; }
export function statesPath(kind: "movie" | "tv", id: number): string { return `/${kind}/${id}/account_states`; }
