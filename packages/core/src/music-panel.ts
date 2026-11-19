/**
 * The music panel (2026-11-16, asked for one drill-in panel in place of Quick play's menus within menus): what the panel shows,
 * as plain rules a shell only draws. One panel, six screens; a row replaces the panel's content and Back returns one level.
 *
 * - MusicPanelNav: where the panel is. Home is the foot of the stack and is never left by Back; Back at Home closes the panel.
 * - jumpBackIn: the collections played lately on every service in one list, newest first, each under its real name.
 * - libraryMatches: the playlists and stations already read whose name holds the words typed.
 * - serviceStatus, pickUpLine, libraryRows: the lines of the service rows and of a service's library.
 *
 * Nothing here asks a page or the network for anything: every input is what core already holds.
 */
import type { LibraryItem } from "./types.js";

export type PanelScreen = "home" | "service" | "play" | "upnext" | "add" | "station" | "scenes" | "history";
export const PANEL_SCREENS: readonly PanelScreen[] = ["home", "service", "play", "upnext", "add", "station", "scenes", "history"];
export interface PanelView { screen: PanelScreen; arg?: string }
export interface PanelState { open: boolean; screen: PanelScreen; arg: string | null; canBack: boolean; depth: number }

/** The deepest the panel goes: Home, a screen, and one more from it (a service's library to the match step). */
export const PANEL_MAX_DEPTH = 3;

export class MusicPanelNav {
  private stack: PanelView[] = [];

  /** The panel opened: always at Home. */
  open(): PanelState { this.stack = [{ screen: "home" }]; return this.state(); }
  /** The panel closed, by a press outside it or by Back at Home. */
  close(): PanelState { this.stack = []; return this.state(); }

  /**
   * A row pressed: its screen replaces the panel's content. Home empties the stack back to its foot. The screen already on top is
   * shown again with the new argument (another service's library), never stacked on itself. A closed panel, an unknown screen
   * or a service's library without its service changes nothing.
   */
  go(screen: string, arg?: string | null): PanelState {
    if (!this.stack.length || !PANEL_SCREENS.includes(screen as PanelScreen)) return this.state();
    const s = screen as PanelScreen;
    if (s === "home") { this.stack = [{ screen: "home" }]; return this.state(); }
    if (s === "service" && !arg) return this.state();
    const view: PanelView = arg ? { screen: s, arg } : { screen: s };
    const top = this.stack[this.stack.length - 1]!;
    if (top.screen === s) this.stack[this.stack.length - 1] = view;
    else if (this.stack.length >= PANEL_MAX_DEPTH) this.stack[this.stack.length - 1] = view;
    else this.stack.push(view);
    return this.state();
  }

  /** Back or Escape: one level up; at Home the panel closes. */
  back(): PanelState {
    if (this.stack.length <= 1) return this.close();
    this.stack.pop();
    return this.state();
  }

  state(): PanelState {
    const top = this.stack[this.stack.length - 1];
    if (!top) return { open: false, screen: "home", arg: null, canBack: false, depth: 0 };
    return { open: true, screen: top.screen, arg: top.arg ?? null, canBack: this.stack.length > 1, depth: this.stack.length };
  }
}

// ---------------------------------------------------------------- the lists

export interface PanelRecent { url: string; label: string; kind: string; id?: string; artist?: string; album?: string; title?: string; artwork?: string; at: number }
export interface PanelSource {
  tile: string;
  name: string;
  /** "signed-out" when the service's page says so. */
  session?: string | null;
  playing?: boolean;
  /** A visual on the screen draws from this service. */
  active?: boolean;
  /** The track the service's page holds now: its album and cover. */
  now?: { album?: string | null | undefined; artwork?: string | null | undefined } | null;
  recents: PanelRecent[];
  playlists: LibraryItem[];
  stations: LibraryItem[];
}
export interface PanelRow {
  tile: string;
  service: string;
  kind: string;
  name: string;
  /** "Playlist · Apple Music" */
  meta: string;
  url?: string;
  id?: string;
  at?: number;
  signedOut?: boolean;
  /** The row's picture, an https address, when one is known. */
  artwork?: string;
}

/** A picture's address is used only when it is https. */
export function pictureOf(u: unknown): string | null { return typeof u === "string" && /^https:\/\//i.test(u) ? u : null; }
/**
 * A recent's picture: the one the service's library gives the same collection (by id, else by kind and name), else the one kept with the
 * entry (the cover of the track playing then: an album's own), else for an album the cover of the track the page holds now when that
 * track is from the album. Null when none is known; the shell draws a tinted tile.
 */
export function recentPicture(e: PanelRecent, name: string, library: LibraryItem[], now?: { album?: string | null | undefined; artwork?: string | null | undefined } | null): string | null {
  const hit = (e.id ? library.find((l) => l.id === e.id) : undefined) ?? library.find((l) => l.kind === e.kind && l.name.trim().toLowerCase() === name.trim().toLowerCase());
  const held = e.kind === "album" && now?.album && now.album.trim().toLowerCase() === name.trim().toLowerCase() ? pictureOf(now.artwork) : null;
  return pictureOf(hit?.artwork) ?? pictureOf(e.artwork) ?? held;
}

const MID = " · ";
const KIND_WORDS = new Set(["playlist", "playlists", "album", "albums", "station", "stations", "artist", "song", "songs", "video", "radio", "mix"]);
const KIND_NAMES: Record<string, string> = { playlist: "Playlist", album: "Album", station: "Station", artist: "Artist", video: "Video", song: "Song" };

export function kindName(kind: string): string { return KIND_NAMES[kind] ?? ""; }
/** A label that is only the word for its kind names nothing. */
export function isBareKind(label: string): boolean { return KIND_WORDS.has(label.trim().toLowerCase()); }

/**
 * The item's real name: its label, unless the label is empty or a bare kind word. Then the name the service's library gives the
 * same id, then the album a recent album carries. Null when nothing names it; such a row is left out, never shown as "Playlist".
 */
export function realName(e: PanelRecent, library: LibraryItem[]): string | null {
  const label = (e.label ?? "").trim();
  if (label && !isBareKind(label)) return label;
  if (e.id) { const hit = library.find((l) => l.id === e.id); if (hit?.name && !isBareKind(hit.name)) return hit.name; }
  if (e.kind === "album" && e.album && !isBareKind(e.album)) return e.album.trim();
  return null;
}

/** Jump back in: every service's recent collections in one list, newest first, each under its real name; one row an address, and one row a name of a kind on a service (a station tuned three times is one row, its newest). */
export function jumpBackIn(sources: PanelSource[], limit = 8): PanelRow[] {
  const rows: PanelRow[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const library = [...s.playlists, ...s.stations];
    for (const e of s.recents) {
      if (!e || typeof e.url !== "string") continue;
      const key = s.tile + "|" + e.url;
      if (seen.has(key)) continue;
      const name = realName(e, library);
      if (!name) continue;
      const named = s.tile + "|" + e.kind + "|" + name.toLowerCase();
      const older = rows.find((r) => r.tile === s.tile && r.kind === e.kind && r.name.toLowerCase() === name.toLowerCase());
      const picture = recentPicture(e, name, library, s.now);
      if (older) { if ((e.at ?? 0) > (older.at ?? 0)) { older.at = e.at; older.url = e.url; if (e.id) older.id = e.id; } if (!older.artwork && picture) older.artwork = picture; seen.add(key); continue; }
      seen.add(key); seen.add(named);
      const signedOut = s.session === "signed-out";
      const kind = kindName(e.kind);
      rows.push({ tile: s.tile, service: s.name, kind: e.kind, name, meta: [kind, s.name, signedOut ? "sign in first" : ""].filter((x) => x).join(MID), url: e.url, ...(e.id ? { id: e.id } : {}), at: e.at ?? 0, ...(signedOut ? { signedOut: true } : {}), ...(picture ? { artwork: picture } : {}) });
    }
  }
  return rows.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, Math.max(0, limit));
}

/**
 * In your library: the playlists and stations already read whose name holds the words typed. One rule for the order: names that
 * begin with the words first, then names that hold them, each group A to Z.
 */
export function libraryMatches(q: string, sources: PanelSource[], limit = 8): PanelRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const rows: Array<PanelRow & { lead: boolean }> = [];
  for (const s of sources) {
    if (s.session === "signed-out") continue;
    for (const it of [...s.playlists, ...s.stations]) {
      const n = (it.name ?? "").toLowerCase();
      const at = n.indexOf(needle);
      if (at < 0) continue;
      rows.push({ tile: s.tile, service: s.name, kind: it.kind, name: it.name, meta: [kindName(it.kind), s.name].filter((x) => x).join(MID), id: it.id, ...(pictureOf(it.artwork) ? { artwork: pictureOf(it.artwork)! } : {}), lead: at === 0 });
    }
  }
  rows.sort((a, b) => (a.lead === b.lead ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.service.localeCompare(b.service) : a.lead ? -1 : 1));
  return rows.slice(0, Math.max(0, limit)).map(({ lead: _lead, ...r }) => r);
}

function count(n: number, one: string): string { return n + " " + one + (n === 1 ? "" : "s"); }

/** A service row's short line: signed out, else what its library holds, else the last thing it played. */
export function serviceStatus(s: PanelSource): string {
  if (s.session === "signed-out") return "Not signed in";
  const parts: string[] = [];
  if (s.playlists.length) parts.push(count(s.playlists.length, "playlist"));
  if (s.stations.length) parts.push(count(s.stations.length, "station"));
  if (parts.length) return parts.join(MID);
  const last = s.recents.map((e) => realName(e, [])).find((n) => !!n);
  return last ? "Last played: " + last : "Nothing played yet";
}
/** Your services, in one rule: the service playing now first, then the one the screen draws from, the rest in the order they were added. */
export function orderServices<T extends { playing?: boolean; active?: boolean; session?: string | null }>(sources: T[]): T[] {
  const rank = (s: T) => (s.session === "signed-out" ? 2 : s.playing ? 0 : s.active ? 1 : 2);
  return sources.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
}
export function serviceBadge(s: PanelSource): "Playing" | "Sign in" | null {
  return s.session === "signed-out" ? "Sign in" : s.playing ? "Playing" : null;
}

export interface PanelOrder { kind: string; id: string; count?: number; spot?: number }
/** "Pick up at 40 of 200" for the collection PRISM holds a saved place in; null for any other. */
export function pickUpLine(item: { id: string }, order: PanelOrder | null | undefined): string | null {
  if (!order || order.id !== item.id) return null;
  if (typeof order.spot !== "number" || typeof order.count !== "number" || order.count <= 0 || order.spot < 1) return null;
  return "Pick up at " + order.spot + " of " + order.count;
}

export interface PanelLibraryRow { id: string; name: string; kind: string; sub: string | null; edit: boolean; artwork: string | null }
/** One tab of a service's library, in the order the service lists it, narrowed by the filter's words. */
export function libraryRows(items: LibraryItem[], order: PanelOrder | null | undefined, filter = ""): PanelLibraryRow[] {
  const needle = filter.trim().toLowerCase();
  return items
    .filter((it) => it && typeof it.id === "string" && typeof it.name === "string" && (!needle || it.name.toLowerCase().includes(needle)))
    .map((it) => ({ id: it.id, name: it.name, kind: it.kind, sub: it.kind === "station" ? null : pickUpLine(it, order), edit: it.edit !== false, artwork: pictureOf(it.artwork) }));
}

/**
 * The page's own ask for a collection's cover (2026-11-16): the script a service's page runs to fetch, from its own site, the cover of
 * the collection at this address. route "og": the collection's page, its og:image. route "oembed:<path with {url}>": the site's public
 * embed address, its thumbnail_url. The answer lands in window.__prismCover[url]: "wait", then the address or "". Ten seconds at most.
 */
export function coverAskJs(route: string, url: string): string {
  const oembed = route.startsWith("oembed:") ? route.slice(7) : null;
  const ask = oembed ? "location.origin+" + JSON.stringify(oembed).replace("{url}", '"+encodeURIComponent(u)+"') : "u";
  const read = oembed
    ? "var j=null;try{j=JSON.parse(t)}catch(e){}return j&&typeof j.thumbnail_url==='string'?j.thumbnail_url:'';"
    : "var m=/<meta[^>]+property=[\"']og:image[\"'][^>]*>/i.exec(t);var c=m&&/content=[\"']([^\"']+)[\"']/i.exec(m[0]);return c?c[1].replace(/&amp;/g,'&'):'';";
  return "(function(){var u=" + JSON.stringify(url) + ";var k=window.__prismCover=window.__prismCover||{};if(k[u]!==undefined)return 'have';k[u]='wait';"
    + "var c=new AbortController();setTimeout(function(){c.abort()},10000);"
    + "fetch(" + ask + ",{credentials:'include',signal:c.signal}).then(function(r){return r.ok?r.text():''}).then(function(t){k[u]=(function(){" + read + "})();}).catch(function(){k[u]='';});return 'started';})()";
}

/**
 * A cover route may end ">last-segment=<name>" (2026-11-16): the site names an image's size in the address's last part, and this part
 * gives the square cover (Apple Music's page names a wide crop). squareCover puts it on an address whose last part is a size name.
 */
export function coverRoute(route: string): { route: string; segment: string | null } {
  const i = route.indexOf(">last-segment=");
  return i < 0 ? { route, segment: null } : { route: route.slice(0, i), segment: route.slice(i + 14) || null };
}
export function squareCover(url: string, segment: string | null): string {
  if (!segment) return url;
  const i = url.lastIndexOf("/");
  return i > 8 && /^[0-9]+x[0-9]+[a-z]*(-[0-9]+)?[.](jpg|jpeg|png|webp)$/i.test(url.slice(i + 1)) ? url.slice(0, i + 1) + segment : url;
}

/**
 * A playlist's play choices (2026-11-16, asked for in place of a plain press): Resume, shown only where PRISM holds a place in this
 * playlist, with the place and the order it is in as words to read; then Start over in each order, In order, Reverse, True shuffle.
 * One is picked: Resume where there is one, else In order. An order the service cannot take is listed with the reason and cannot be picked.
 */
export interface PlayChoice { order: "normal" | "reverse" | "true-shuffle"; label: string; can: boolean; why: string | null }
/** resume.how: "order" = the place PRISM holds in its own order (true shuffle, reverse); "player" = the place the service's player holds (a play in order). */
export interface PlayChoices { resume: { line: string; how: "order" | "player" } | null; orders: PlayChoice[]; picked: "resume" | "normal" }
export function orderName(order: string | null | undefined): string {
  return order === "true-shuffle" ? "True shuffle" : order === "reverse" ? "Reverse" : order === "shuffle" ? "Shuffle" : "In order";
}
export function playChoices(item: { id: string }, order: (PanelOrder & { order?: string; song?: string; kept?: true }) | null | undefined, own: true | string, player?: { id: string; title?: string | undefined } | null): PlayChoices {
  // a play in order holds no place of PRISM's: the place is the player's own, the song it stands on (2026-11-16: a playlist just
  // played in order showed no Resume while the music bar offered to resume it)
  const onPlayer = !!player && player.id === item.id;
  const held = !!order && order.id === item.id && typeof order.spot === "number" && typeof order.count === "number" && order.count > 0 && order.spot >= 1;
  // the place kept for a play in order that gave way to another playlist (2026-11-16): the song it stood on
  const keptSong = !held && !onPlayer && !!order && order.id === item.id && order.kept === true;
  const why = own === true ? null : own;
  return {
    resume: held ? { line: "Song " + order!.spot + " of " + order!.count + " · " + orderName(order!.order), how: "order" }
      : onPlayer ? { line: (player!.title?.trim() ? player!.title.trim() + " · " : "") + "In order", how: "player" }
      : keptSong ? { line: (order!.song?.trim() ? order!.song.trim() + " · " : "") + "In order", how: "order" } : null,
    orders: [
      { order: "normal", label: "In order", can: true, why: null },
      { order: "reverse", label: "Reverse", can: own === true, why },
      { order: "true-shuffle", label: "True shuffle", can: own === true, why },
    ],
    picked: held || onPlayer || keptSong ? "resume" : "normal",
  };
}
