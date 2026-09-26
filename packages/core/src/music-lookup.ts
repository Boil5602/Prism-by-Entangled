/**
 * Cross-service track lookup (Quick play, 2026-09-16): "I hear something on Spotify and am managing a
 * playlist on Apple - add the song, if Apple has it, to my Apple playlist."
 *
 * Core asks the OTHER service's page (its adapter's musicLookup script, the service's own player API in
 * the person's own session) for candidates matching the song that is playing now, then decides here
 * whether one of them IS that song. The decision is pure and tested: a wrong "found" adds the wrong
 * track to somebody's playlist, so the rule is strict - title AND artist must match after
 * normalization; a title-only match is offered as a choice, never taken.
 */

export interface TrackQuery {
  title: string;
  artist?: string | undefined;
  album?: string | undefined;
  /** the playing track's length, when its face says (Media Session / the page's own clock) - a confidence signal */
  durationMs?: number | undefined;
}

export interface TrackCandidate {
  /** The service's own id for the song - what its add-to-playlist / station API takes. */
  id: string;
  title: string;
  artist: string;
  album?: string | undefined;
  url?: string | undefined;
  isrc?: string | undefined;
  durationMs?: number | undefined;
  /** the service's own artwork for the song (a small square), for the menu */
  artwork?: string | undefined;
  /** 2026-09-18: how sure core is that THIS candidate is the song - each row of a choice says its own percent */
  confidence?: MatchConfidence | undefined;
}

/** How sure core is that a candidate IS the song, in words a menu can say (2026-09-17). */
export interface MatchConfidence {
  /** 0-100, from the rule table in matchConfidence */
  percent: number;
  /** each signal, in words: "title matches", "artist differs", "length differs" ... */
  because: string[];
}

export type LookupVerdict =
  /** confidence: 90+ when title and artist agree; lower when the lone candidate matched on title or artist only */
  | { status: "found"; match: TrackCandidate; candidates: TrackCandidate[]; confidence: MatchConfidence }
  /** the title is there under several other artists, or the artist under several other titles: a person picks, core does not guess */
  | { status: "ambiguous"; candidates: TrackCandidate[] }
  | { status: "not-found"; candidates: TrackCandidate[] };

/** How many alternatives a verdict carries for a menu (the top of the service's own ranking). */
export const LOOKUP_CHOICES = 3;

/**
 * One comparable form of a title or artist: lower case, diacritics folded, "(feat. X)" / "[Remastered]" /
 * "- Single" / "- Live" tails dropped, punctuation and articles' spacing collapsed.
 */
export function normalizeTrackText(s: string | undefined | null): string {
  if (!s) return "";
  let t = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  t = t.replace(/\s*[\(\[][^\)\]]*(feat|ft|with|remaster|live|version|edit|mix|deluxe|explicit|bonus)[^\)\]]*[\)\]]/g, " ");
  t = t.replace(/\s+-\s+(single|ep|remaster(ed)?( \d{4})?|live|explicit|deluxe( edition)?|radio edit|album version)\s*$/g, " ");
  t = t.replace(/\s+(feat|ft)\.?\s+.*$/g, " ");
  t = t.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return t;
}

/** The artists named in a credit line, each normalized: "KAROL G, Judeline & rusowsky" -> three names. */
export function splitArtists(s: string | undefined | null): string[] {
  if (!s) return [];
  return s
    .split(/\s*(?:,|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bwith\b|\/)\s*/i)
    .map((a) => normalizeTrackText(a))
    .filter((a) => a.length > 0);
}

/** Two credit lines name the same act when their primary artist agrees or every artist of the shorter list is in the longer. */
export function artistsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const A = splitArtists(a), B = splitArtists(b);
  if (!A.length || !B.length) return false;
  if (A[0] === B[0]) return true;
  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  return short.every((x) => long.includes(x));
}

/** Two lengths agree within this much (services trim silence differently). */
const DURATION_SAME_MS = 3000;
/** Two lengths this far apart are different recordings (a cover, an edit, a different song of the same name). */
const DURATION_OTHER_MS = 15000;

/**
 * The rule table behind a verdict's confidence (the named source of every percent the menu says):
 *   title + artist + album agree        98
 *   title + artist agree                90
 *   title agrees, artist differs        55
 *   artist agrees, title differs        25
 *   then the length, when both are known: within 3 s +10 (99 at most); 15 s or more apart -20 (10 at least).
 * Every signal is also named in words, so the menu can say why.
 */
export function matchConfidence(q: TrackQuery, c: TrackCandidate): MatchConfidence {
  const title = normalizeTrackText(q.title) !== "" && normalizeTrackText(c.title) === normalizeTrackText(q.title);
  const artist = artistsMatch(q.artist, c.artist);
  const album = normalizeTrackText(q.album) !== "" && normalizeTrackText(c.album) === normalizeTrackText(q.album);
  const because: string[] = [];
  let percent: number;
  if (title && artist) { percent = album ? 98 : 90; because.push("title matches", "artist matches"); if (album) because.push("album matches"); }
  else if (title) { percent = 55; because.push("title matches", "artist differs"); }
  else if (artist) { percent = 25; because.push("title differs", "artist matches"); }
  else { percent = 0; because.push("title differs", "artist differs"); }
  if (typeof q.durationMs === "number" && q.durationMs > 0 && typeof c.durationMs === "number" && c.durationMs > 0) {
    const gap = Math.abs(q.durationMs - c.durationMs);
    if (gap <= DURATION_SAME_MS) { percent = Math.min(99, percent + 10); because.push("length matches"); }
    else if (gap >= DURATION_OTHER_MS) { percent = Math.max(10, percent - 20); because.push("length differs"); }
  }
  return { percent, because };
}

/**
 * Decide whether the service has this song. Candidates arrive in the service's own ranking; the first
 * whose title and artist both match wins, preferring one whose album also matches (the album cut over
 * the single when both exist). Nothing matched fully: candidates with the same title, or the same
 * artist, are the partial hits - ONE partial hit is the answer, shown with its confidence (2026-09-17:
 * "no confirmation required in this case, just let the user know the confidence"); several make it
 * ambiguous (a choice is offered); none is not found.
 */
export function matchTrack(q: TrackQuery, candidates: TrackCandidate[]): LookupVerdict {
  const title = normalizeTrackText(q.title);
  const top = candidates.slice(0, LOOKUP_CHOICES);
  if (!title) return { status: "not-found", candidates: top };
  const rated = (list: TrackCandidate[]) => list.map((c) => ({ ...c, confidence: matchConfidence(q, c) }));   // every row of a choice says its own percent (2026-09-18)
  const full = candidates.filter((c) => normalizeTrackText(c.title) === title && artistsMatch(q.artist, c.artist));
  if (full.length) {
    const album = normalizeTrackText(q.album);
    const match = (album && full.find((c) => normalizeTrackText(c.album) === album)) || full[0]!;
    return { status: "found", match, candidates: rated(top), confidence: matchConfidence(q, match) };
  }
  const partial = candidates.filter((c) => normalizeTrackText(c.title) === title || (q.artist ? artistsMatch(q.artist, c.artist) : false));
  if (partial.length === 1) return { status: "found", match: partial[0]!, candidates: rated(partial), confidence: matchConfidence(q, partial[0]!) };
  if (partial.length) return { status: "ambiguous", candidates: rated(partial.slice(0, LOOKUP_CHOICES)) };
  return { status: "not-found", candidates: rated(top) };
}

/** The search term a service is asked with: title and primary artist, no decoration. */
export function lookupTerm(q: TrackQuery): string {
  const primary = splitArtists(q.artist)[0];
  return [normalizeTrackText(q.title), primary].filter((x) => x && x.length).join(" ");
}
