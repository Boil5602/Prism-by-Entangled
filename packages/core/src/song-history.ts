/**
 * Song history (2026-11-16, the music panel's last screen): the songs PRISM itself played, kept on this device and never sent anywhere.
 *
 * Pure: no page, no network, no store. The orchestrator feeds it each service's now-playing as it arrives and keeps the list in the
 * store. The rules:
 * - a song is recorded once it has played for 30 seconds (time while paused does not count; another song starts the count again);
 * - one play of a song is one entry: the same song going on, paused and resumed, is not recorded twice;
 * - the list is newest first and holds 500 entries; the oldest drop off;
 * - Clear empties it.
 */
export const HISTORY_AFTER_MS = 30_000;
export const HISTORY_MAX = 500;

export interface HistorySong {
  /** the service's tile the song played on: a replay goes back to it */
  tile: string;
  /** the service's name as it was shown then */
  service: string;
  title: string;
  artist?: string;
  album?: string;
  /** an https address of the cover, when the page gave one */
  artwork?: string;
  /** the service's own id of the track, when its player names it: the replay's surest route */
  id?: string;
  /** when the entry was recorded (ms) */
  at: number;
}

export interface HistoryInput { playing: boolean; title?: string | undefined; artist?: string | undefined; album?: string | undefined; artwork?: string | null | undefined; id?: string | undefined }

function keyOf(i: HistoryInput): string { return (i.id ? "#" + i.id : "") + "|" + (i.title ?? "").trim().toLowerCase() + "|" + (i.artist ?? "").trim().toLowerCase(); }

/** Reads a stored list: only well-formed entries, newest first, at most the cap. */
export function readHistory(raw: string | null | undefined): HistorySong[] {
  if (!raw) return [];
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is HistorySong => !!e && typeof e === "object" && typeof (e as HistorySong).tile === "string" && typeof (e as HistorySong).title === "string"
    && !!(e as HistorySong).title && typeof (e as HistorySong).at === "number").slice(0, HISTORY_MAX);
}

export class SongHistory {
  private list: HistorySong[];
  /** per service: the song it is on, how long it has played, when it was last seen playing, and whether this play is recorded */
  private readonly runs = new Map<string, { key: string; played: number; since: number | null; done: boolean }>();

  constructor(initial: HistorySong[] = []) { this.list = initial.slice(0, HISTORY_MAX); }

  /** Newest first. */
  songs(): HistorySong[] { return this.list.slice(); }

  /**
   * A service's now-playing, as often as it arrives. Returns the entry when this call recorded one (the caller saves the list), else null.
   */
  note(tile: string, service: string, info: HistoryInput | null | undefined, now: number): HistorySong | null {
    const title = (info?.title ?? "").trim();
    if (!info || !title) { this.runs.delete(tile); return null; }
    const key = keyOf(info);
    let run = this.runs.get(tile);
    if (!run || run.key !== key) { run = { key, played: 0, since: null, done: false }; this.runs.set(tile, run); }
    if (run.since !== null) run.played += Math.max(0, now - run.since);
    run.since = info.playing ? now : null;
    if (run.done || run.played < HISTORY_AFTER_MS) return null;
    run.done = true;
    const artwork = typeof info.artwork === "string" && /^https:\/\//i.test(info.artwork) ? info.artwork : undefined;
    const entry: HistorySong = {
      tile, service, title,
      ...(info.artist?.trim() ? { artist: info.artist.trim() } : {}),
      ...(info.album?.trim() ? { album: info.album.trim() } : {}),
      ...(artwork ? { artwork } : {}),
      ...(info.id ? { id: info.id } : {}),
      at: now,
    };
    this.list = [entry, ...this.list].slice(0, HISTORY_MAX);
    return entry;
  }

  /** Empties the list. A song playing now is not recorded again for this play. */
  clear(): void { this.list = []; }
}
