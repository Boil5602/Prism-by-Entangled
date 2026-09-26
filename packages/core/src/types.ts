/**
 * frame.dashboard/v0.1 schema types (spec §1–§2, §8).
 * One JSON document describes everything a device renders; the Android shell
 * and the PrismOS daemon consume it unchanged.
 */

export const SCHEMA_VERSION = "frame.dashboard/v0.1";

export interface GridSpec {
  cols: number;
  rows: number;
  gap: number;
}

export type ThemeMode = "light" | "dark" | "auto";

export interface ThemeSpec {
  background?: string;
  radius?: number;
  mode?: ThemeMode;
  /** 10-foot font scaling for TV profiles (§12). */
  scale?: number;
  /** Overscan-safe margins for TV profiles (§12). */
  safeArea?: number;
}

export type AudioPolicy = "exclusive" | "mix" | "mute";

export interface AudioSpec {
  policy: AudioPolicy;
  defaultSink?: string;
}

export type TileState = "normal" | "theater" | "fullscreen";
export type TouchMode = "full" | "scroll" | "none";
export type ViewportMode = "auto" | "desktop" | "mobile" | "wide";

/**
 * A rectangle of the page in document CSS px (untransformed, page origin) —
 * §31 step 3's drag-select / the host viewfinder. Stored at the slot's own
 * layout width, so it maps 1:1 back onto the page the slot shows.
 */
export interface FocusRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Region focus (§17): frame a piece of a page rather than the whole page.
 * Either an element (`selector`, adapter/preset territory) or a plain
 * rectangle (`region`); `region` wins when both are present.
 */
export interface FocusSpec {
  selector?: string;
  region?: FocusRegion;
  /**
   * The CSS layout viewport `region` was measured in (the host viewfinder
   * shows the page full screen, so this is the window ÷ the chosen page
   * zoom). The shell lays the page out at this size and scales it to fit the
   * slot before framing, so the slot shows exactly what was picked.
   */
  viewport?: { w: number; h: number };
  pad?: number;
  /** Default: "width" for a selector, "contain" for a region. */
  fit?: "width" | "height" | "contain";
}

/**
 * A named place on an app (§31 "focus presets", user-made): a page plus the
 * view of it - a region in its layout viewport, or the whole page. Owned by
 * the APP (adapter id, else the site's host), so every slot showing that app
 * offers it; stored by core under `shortcuts:<app>`.
 */
export interface Shortcut {
  id: string;
  label: string;
  url: string;
  focus?: FocusSpec;
  /** The slot shape this view wants ("W:H", §8 aspect hint) - the solver sizes the slot for it when the layout is assigned. */
  aspectHint?: string;
}

/**
 * §25 living previews. A non-playing video tile sits warm showing a still
 * that *advances*: on the peek cadence the shell briefly revives it (muted,
 * hidden), captures a fresh frame, and demotes it again.
 */
export interface PreviewSpec {
  mode: "peek" | "off";
  /** Peek cadence in seconds; floored by the device budget (30s, 60s on 2GB boxes). */
  interval?: number;
  /**
   * VOD only: "advance" keeps a virtual playhead (last position + wall-clock
   * elapsed) so the still shows where the video *would be*; "hold" keeps
   * the last position. Default "advance".
   */
  playhead?: "advance" | "hold";
}

/**
 * What a single tap on a placed item means (docs/concept-scenes.md §5,
 * normative). §6a's one meaning — promote to the full-page experience — is
 * the default and is unchanged; a multiview wants the *sound* instead.
 *
 *   promote — the full-page native experience; Back returns to the scene.
 *   audio   — the tapped item becomes the exclusive audio owner (§3 does the
 *             switching: the previous owner is muted, the tapped item
 *             unmutes). The layout does not change; nothing is promoted.
 *   both    — the tap moves the audio *and* promotes.
 */
export type TapAction = "promote" | "audio" | "both";

/**
 * §32 a floating facet's place: fractions of the wall (0–1), so the place
 * survives a resize. `face`: Prism's own player control (default) or the
 * service's page (sign in, browse) — the page is alive beneath either.
 */
export interface FloatSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  face?: "control" | "page";
  /** Hidden from the wall, still alive and audible (visibility only); the menu brings it back. */
  hidden?: boolean;
}

/**
 * §33 a master layout: a wall without apps. Slots with a shape and a
 * purpose (floating slots included), saved by name; applied later, existing
 * apps fill the slots and the rest stay empty until an app is chosen.
 */
export interface MasterSlot {
  id: string;
  /** What the slot is for (SLOT_PURPOSES id, or "custom"); the aspect hint follows it. */
  purpose: string;
  aspectHint?: string;
  kind?: "floating";
  float?: FloatSpec;
  /** The hero of a hero-mode layout (first wall slot when none is marked). */
  hero?: boolean;
}

export interface MasterLayout {
  id: string;
  label: string;
  mode: "hero" | "grid";
  cols?: number;
  rows?: number;
  heroSize?: number;
  gap?: number;
  slots: MasterSlot[];
}

/**
 * §34 an app as Prism knows it: the base tile a scene builds from (page,
 * adapter, audio, veil…, and the §10 profile every tile of this app shares),
 * remembered from the first time the app was added - on the wall or not.
 */
export interface AppRecord {
  /** The app key: adapter id, else the site's host slug (the same key views are stored under). */
  id: string;
  name: string;
  tile: TileSpec;
}

/** §34 a slot of a scene: an app, optionally one of its views (a Shortcut id). null = empty slot. */
export interface SceneSlot {
  app: string;
  view?: string;
}

/** §34 a scene: a layout with a view of an app in each slot. Applied, it IS the wall. */
export interface Scene {
  id: string;
  label: string;
  layoutId: string;
  slots: Record<string, SceneSlot | null>;
}

/** §34 a slot shape the saved layouts define - what facets are made for. */
export interface SlotShape {
  aspect: string;
  ratio: number;
  floating: boolean;
  /** How many saved layouts have a slot of this shape. */
  layouts: number;
  /** The largest such slot at the current wall, in pixels (a viewfinder box size). */
  sample: { w: number; h: number };
}

/** §33 "what is this slot for?" - the purposes the editor offers and the shape each wants. */
export const SLOT_PURPOSES: ReadonlyArray<{ id: string; label: string; aspect: string | null; blurb: string; floating?: boolean }> = [
  { id: "video", label: "Video 16:9", aspect: "16:9", blurb: "Movies, streams and YouTube in the widescreen slot. The solver keeps it letterbox-free" },
  { id: "cinema", label: "Cinema 21:9", aspect: "21:9", blurb: "Ultrawide films without black bars" },
  { id: "classic", label: "Classic 4:3", aspect: "4:3", blurb: "Older shows, video calls, camera feeds" },
  { id: "vertical", label: "Vertical video 9:16", aspect: "9:16", blurb: "Shorts, reels, portrait streams" },
  { id: "web", label: "Web page 16:10", aspect: "16:10", blurb: "Dashboards, news and mail on a laptop-shaped page" },
  { id: "square", label: "Square 1:1", aspect: "1:1", blurb: "Album art, clocks, weather, a camera" },
  { id: "control", label: "Music control (floating)", aspect: "16:5", blurb: "A floating player over the wall. It's Prism's own control, with the service beneath", floating: true },
  { id: "custom", label: "Custom W:H", aspect: null, blurb: "Any shape you name" },
];

/** §32 what a tile's page says is playing (its Media Session + the audible element). */
/** One pickable collection in a service's library. */
export interface LibraryItem {
  id: string;
  name: string;
  kind: "playlist" | "station" | "album";
  url?: string | null;
  /** A playlist the account may add to (Apple Music: canEdit - the person's own, not a curated one saved to the library). Unknown when the page did not say. */
  edit?: boolean;
}

export interface NowPlaying {
  playing: boolean;
  title?: string;
  artist?: string;
  album?: string;
  /** Artwork URL as the page offered it (the largest declared). */
  artwork?: string | null;
  position?: number | null;
  /** null = live / unknown. */
  duration?: number | null;
  /**
   * The COLLECTION playing - an album, playlist or station - as the page itself reports it through
   * the adapter's `window.__prismMusicContext` (Apple Music: MusicKit's nowPlayingItem.container).
   * The Media Session never says which playlist or station a track came from; only the page can.
   */
  context?: { url?: string; label?: string; kind?: string; id?: string; /** the track's own id in the player's queue (Apple: the catalog song id) - the saved spot in a Prism-ordered play (2026-09-17) */ trackId?: string | null; /** the track, when the page names it and the Media Session does not (Pandora) */ title?: string; artist?: string; /** the page's own transport says playing (B-132) */ playing?: boolean; /** the page's own clock, seconds (B-148: Pandora's playing element can be the pre-buffered next track) */ position?: number | null; duration?: number | null; /** B-155: the service's own rating of the current track: 1 thumbs up, -1 down, 0 none */ rating?: number; /** the track's artwork when the page shows it and the Media Session does not (Pandora's tuner image, 2026-09-13) */ artwork?: string | null; /** the service's own offer on screen (Pandora's "Get more skips" at the skip limit, 2026-09-14): its label; pressing it is tileCommand("offer") */ offer?: { label: string } | null; /** the adapter's declared controls the page has hidden or disabled right now (Pandora hides Skip during an ad, 2026-09-14): control names - next, prev, play, pause */ unavailable?: string[] } | null;
  /** The service's library as the page reports it (the adapter's musicLibrary script): playlists and stations to pick from without setting foot on the page. */
  library?: { playlists?: LibraryItem[]; stations?: LibraryItem[] } | null;
  /** What the adapter's musicPlay script last did (queued | ok | error:...), so a pick that failed says so on the wall. */
  playState?: { kind?: string; id?: string; status?: string } | null;
  /** Media Session actions the page registered (nexttrack, previoustrack, seekto…) — what the control may offer. */
  actions?: string[];
  /** VP-2 (2026-09-19): what a VIDEO page plays, as the adapter's `window.__prismVideoContext` reports it (the series, the episode; Media Session rarely says). */
  video?: VideoContext | null;
  /** The video service's library as the adapter's videoLibrary script gathered it: Continue Watching and My List. */
  videoLibrary?: VideoLibrary | null;
  /** What the adapter's videoPlay script last did, so a pick that failed says so on the wall. */
  videoPlayState?: { kind?: string; id?: string; status?: string } | null;
  /** VP-3 (2026-09-19): the service's profile gate ("Who's watching?") as the adapter's videoProfiles script reads it. */
  videoProfiles?: VideoProfiles | null;
  /** Phase 2 (video-menu-spec §2 row 3): the service's live channels as its videoLive script gathered them. */
  videoLive?: VideoChannel[] | null;
}

/** A live channel a live-capable service lists (video-menu-spec §2 / §3 liveNow). */
export interface VideoChannel {
  id: string;
  name: string;
  /** The address that tunes the channel in the service's own player. */
  url: string;
  /** What is on now, as the service says it. */
  now?: string | null;
  logo?: string | null;
  favorite?: boolean;
}

/** VP-3: a video service's profiles - the gate up or not, who is offered, who is chosen when the page says. */
export interface VideoProfiles {
  gate: boolean;
  profiles: Array<{ id: string; name: string; avatar?: string | null }>;
  current?: string | null;
  /** A switcher that lists everyone BUT the profile watching now and never names that one (Hulu's Account Menu, Peacock's
   *  nav, 2026-09-21): a listed profile is one the page is not on, and the list is never the whole household. */
  othersOnly?: boolean;
}

/** VP-2: the title a video page plays, as the page itself says it (video.ts). */
export interface VideoContext {
  /** movie | episode | live | clip - the adapter's word. */
  kind?: string;
  /** The movie's, or the episode's, title as shown. */
  title?: string;
  /** The show, for an episode. */
  series?: string;
  season?: number | null;
  episode?: number | null;
  /** The service's id of what plays (Netflix: the watch id). */
  id?: string;
  url?: string;
  playing?: boolean;
  position?: number | null;
  duration?: number | null;
  /** An ad plays in the player's own stream (the page's word; the veil has its own signal). */
  ad?: boolean;
  /** The page's own playback error, in its words and code ("Error playing video · RUNUNK13") - the player shows it instead of the title (2026-09-21). */
  error?: string;
  /** The service's own ad-break marks on the title's timeline, in seconds of `position`'s clock; done once watched (2026-09-23, "Can we show ad breaks in the scan bar?"). */
  adBreaks?: Array<{ at: number; done: boolean }>;
}

/** VP-2: one title in a video service's library (Continue Watching, My List). */
export interface VideoItem {
  id: string;
  title: string;
  /** movie | series | episode | live - the adapter's word. */
  kind: string;
  url?: string | null;
  artwork?: string | null;
  /** A second line: the episode, the year, the network. */
  subtitle?: string | null;
  /** 0..1 watched, when the page shows it. */
  progress?: number | null;
  /** The card's own badge in the service's words ("New Season", "New Episodes", "Recently Added", "Coming Soon") - read, never made up. */
  badge?: string | null;
  /** Whose banner it is when not the service's own: "tmdb" - TMDB's new episode this week (2026-09-23), drawn as the card's red corner ribbon. */
  badgeFrom?: "tmdb";
  /** The badge is already drawn in the card's own picture (Netflix bakes "New Season" / "Recently Added" into its box art, 2026-09-24):
   *  it still orders My List, and the host does not draw it a second time. */
  badgeInArt?: boolean;
}

export interface VideoLibrary {
  continue?: VideoItem[];
  list?: VideoItem[];
  /** The page's own rows ("Today's Top Picks for You", "New Releases"...), each a shelf of titles - the menu structure for starting things (VP-3b). */
  shelves?: Array<{ title: string; items: VideoItem[] }>;
  /** The titles the person OWNS on the service (Fandango at Home's My Movies / My TV Shows, 2026-09-22): a library, not a list - its own row, and 'Owned' on a search card. */
  owned?: VideoItem[];
  /** The reader walked the whole owned library this pass (it reached the end): the pass is the library, and a title absent from two such passes is gone. */
  ownedComplete?: boolean;
  /** Per owned id: how many complete passes in a row have not listed it (kept by core, never reported by a page). */
  ownedMissed?: Record<string, number>;
}

export interface TileSpec {
  id: string;
  /**
   * §32: "floating" hovers above the wall at `float`, not solver input; "slot"
   * (the default) is a wall slot the solver places. `"frame"` is the pre-rename
   * spelling (SM-6) still found in stored documents - readers accept it as
   * "slot" forever (`aliasTileKind`); §10: no stored document is rewritten for it.
   */
  kind?: "slot" | "floating";
  float?: FloatSpec;
  /** §33 an empty slot from a master layout: a shape and a place, no page, no session - until an app is chosen for it. */
  placeholder?: boolean;
  /** What an empty slot is FOR (the template role's label, e.g. "Video hero"); the shell shows it on the placeholder. Falls back to the aspect hint. */
  label?: string;
  /**
   * §32 a visualization placement: a shell-rendered audio-reactive surface whose
   * `source` is a hidden music facet (tile id) of the same document. No page, no
   * session; the shell without a visualization surface renders it dark.
   */
  visualization?: { style: string; source: string; artwork: "off" | "backdrop" | "focal"; spill?: boolean };
  /** CSS grid-area string (grid mode) — "rowStart / colStart / rowEnd / colEnd". */
  area?: string;
  url?: string;
  /** Launch tiles (§12) render as a poster and open a native app fullscreen. */
  launch?: { package: string; deepLink?: string };
  /**
   * When a tile has BOTH `url` and `launch`, which one it is right now.
   * Default "web" — the native app is an opt-in (§12/§13), flipped per
   * tile from the remote and persisted (§10).
   */
  mode?: "web" | "native";
  zoom?: number;
  viewport?: ViewportMode;
  /** Auto-reload interval in seconds; null = never. */
  refresh?: number | null;
  state?: TileState;
  audio?: AudioPolicy;
  touch?: TouchMode;
  adapter?: string | null;
  persist?: boolean;
  /** Storage profile (§10); omitted ⇒ implicit profile named after the tile id. */
  profile?: string;
  focus?: FocusSpec;
  blocking?: boolean;
  /** Intermission during ad breaks (§26): the wall shows what you choose. */
  intermission?: {
    enabled: boolean;
    /** Imagery source: "pack:cosmos", "pack:nature", or a photos tile ref. */
    source?: string;
    /** Ad audio during the overlay; default "mute". */
    audio?: "mute" | "keep";
    /** §26 ambient audio (opt-in, 2026-09-07; recordings since 2026-09-08): a soundscape id (see the host's docs/soundscape-credits.md; the synthesized ids still map) - in place of the muted break. */
    ambient?: string;
  };
  /** Living previews (§25): stills that advance while the tile is not playing. */
  preview?: PreviewSpec;
  /** What a single tap here means (concept-scenes §5); absent = "promote" (§6a unchanged). */
  tapAction?: TapAction;
  /** Scene-model placement setting: run the page's own play handler once, after this tile loads on a scene apply. Absent = nothing. */
  onActivate?: "play";
  /**
   * Gallery veil (§27): display-ad slots show imagery instead. `block+art`
   * composes with blocking; `veil-only` loads ads (trackers run — the
   * toggle says so) and only replaces them visually.
   */
  veil?: { mode: "block+art" | "veil-only" | "off"; source?: string };
  /** Desktop identity for `viewport: "desktop"` tiles: "windows" (default) or "mac" — some services 403 one and not the other. */
  uaPlatform?: "windows" | "mac";
  /** Ideal w:h as a "W:H" string (§8). */
  aspectHint?: string;
  /** How hard the solver fights for the hint: 0 = flexible, 1 = rigid (§8). */
  aspectWeight?: number;
  /**
   * §26 standing human instructions carried from the scene assignment
   * (scene-model AssignmentSettings): keep the player's fullscreen / theater
   * across site-initiated drops; replay at ended. Absent = none; the
   * presentation keeper never acts without it.
   */
  presentation?: { keepPresentation: boolean; onEnd: "none" | "restart" | "restart-fullscreen" };
}

export interface HeroLayout {
  mode: "hero";
  /** Tile id of the anchor. */
  hero: string;
  /** Fraction of the long axis the hero occupies (0.3–0.85). */
  heroSize: number;
  /** "auto" = solver places satellites; array = stable ordering. */
  satellites: "auto" | string[];
  gap: number;
}

export interface GridLayout {
  mode: "grid";
}

/**
 * One app at a time: the chosen tile takes the whole screen; the others keep
 * their sessions beneath. ◀ ▶ on the remote (or a tap on the phone's strip)
 * picks another; OK enters the page; Back leaves the page, never the app.
 */
export interface SoloLayout {
  mode: "solo";
  /** Tile shown first (default: the first tile). The last choice persists per frame. */
  start?: string;
}

/**
 * Scene-model layouts (docs/scene-model-spec.md §3): every slot's rect in
 * canvas fractions (0–1), scaled exactly to the viewport - no solver. Keys are
 * tile ids (= slot ids). Produced by `sceneDocument`; never edited by hand.
 */
export interface FixedLayout {
  mode: "fixed";
  rects: Record<string, { x: number; y: number; w: number; h: number }>;
}

export type LayoutSpec = HeroLayout | GridLayout | SoloLayout | FixedLayout;

export interface ScheduleEntry {
  at?: string;
  on?: string;
  action: string;
  value?: unknown;
}

export type InputBinding =
  | { tile: string; cmd: string }
  | { action: string; value?: unknown };

/**
 * Key → binding (§7). Keys prefixed `device:<name>` hold a nested map of
 * per-device overrides for a named remote (§11); never required.
 */
export type InputMap = Record<string, InputBinding | Record<string, InputBinding>>;

export interface DashboardDocument {
  schema: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  grid?: GridSpec;
  layout?: LayoutSpec;
  theme?: ThemeSpec;
  audio?: AudioSpec;
  schedule?: ScheduleEntry[];
  inputs?: InputMap;
  tiles: TileSpec[];
}

/**
 * Parse a "W:H" aspect-hint string into a width/height ratio.
 * Returns null for malformed or non-positive hints.
 */
export function parseAspectHint(hint: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(hint);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return w / h;
}

/**
 * The kind of a stored tile, with the SM-6 read-alias applied: `"floating"`
 * stays; anything else - `"slot"`, the implicit default, or the pre-rename
 * spelling `"frame"` - is a wall slot. Read-only: callers never write the
 * alias back into the document (§10 - a rename never rewrites stored data).
 */
export function tileKind(tile: Pick<TileSpec, "kind">): "slot" | "floating" {
  return tile.kind === "floating" ? "floating" : "slot";
}

/**
 * Apply the SM-6 read-alias to one tile as it is read from a stored document:
 * `kind: "frame"` (the pre-rename spelling) becomes `kind: "slot"`. Every
 * other tile is returned as is. Used on load, never on save.
 */
export function aliasTileKind<T extends { kind?: unknown }>(tile: T): T {
  return (tile.kind as unknown) === "frame" ? { ...tile, kind: "slot" } : tile;
}
