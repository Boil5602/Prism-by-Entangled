/**
 * The video player, layer by layer like the music one (spec §32, mirrored; VP-2, 2026-09-19: "I want the config to be
 * much like what we've done for music"). A VIDEO adapter declares page-side scripts, each one window function:
 *
 *   videoContext  window.__prismVideoContext() -> {kind, title, series, season, episode, id, url, playing, position, duration, ad} | null
 *                 what the page plays now, as the page itself says (Media Session rarely names the series or the episode)
 *   videoLibrary  fills window.__prismVideoLibrary.cache = {continue:[VideoItem], list:[VideoItem]} - Continue Watching and My List
 *   videoPlay     window.__prismVideoPlay(kind, id, url) - play that title (a human's tap on the wall); reports through
 *                 window.__prismVideoPlayState = {kind, id, status}
 *   videoCmd      window.__prismVideoCmd(cmd) -> true when the player took play|pause|seekforward|seekbackward|next|nextepisode|skipintro|captions|fullscreen
 *   videoLookup   (VP-4) window.__prismVideoLookup(token, {title, year, kind}) -> the service's search, answered like a music lookup
 *
 * The observer (the host's now-playing scan) carries `video`, `videoLibrary` and `videoPlayState` on the same report the
 * music path reads, so nothing here touches the music model: a tile is a video tile when its adapter declares any of
 * the scripts above. The library and the resume point persist under video:* keys of the store (§10: read, never wiped).
 */
import type { AdapterSpec } from "./adapters.js";
import type { NowPlaying, VideoChannel, VideoContext, VideoItem, VideoLibrary, VideoProfiles } from "./types.js";
import { noteLog, noteSeen, orderMerged, type FirstSeen, type MenuCard, type MenuLogEntry, type MenuServiceRow, orderAlphabetical, isAwardBadge, foldSameTitle } from "./menu-order.js";

export interface VideoTileState {
  id: string;
  adapter: string | null;
  playing: boolean;
  /** What plays now as the page reports it; null while nothing does. */
  video: VideoContext | null;
  library: VideoLibrary;
  /** What the wall last saw play here - Play on a fresh wall goes back to it. */
  resume: VideoResumePoint | null;
  /** A Quick play pick the page has not started yet (the feed's "loading"), or its failure. */
  pending: { kind: string; id: string; name: string; at: number; failed?: string; restored?: boolean } | null;
  /** Why this service cannot be searched from the wall (the adapter's videoLookupNote), for the lookup entry. */
  lookupNote: string | null;
  /** The service's profile gate as the page last reported it (VP-3), and the household's standing choice for this App. */
  profiles: VideoProfiles | null;
  profileChoice: VideoProfileChoice | null;
  /** the page's own playback error as last seen, or null */
  error: string | null;
  /** the player fills the screen (element fullscreen): the stage is up (2026-09-21) */
  stage: boolean;
  /** the playback doctor reopened the title (2026-09-23): why, which try, when; or gave up after its tries */
  recovering?: { why: string; attempt: number; at: number; gaveUp?: boolean } | null;
  can: { play: boolean; cmd: boolean; lookup: boolean; profiles: boolean; tracks: boolean; seek: boolean; preview: boolean };
}

/** "Always watch as X" for an App - a standing instruction the wall applies whenever the gate shows (VP-3). */
export interface VideoProfileChoice { id: string; name: string; always: boolean; at: number }

export interface VideoResumePoint { kind: string; id?: string; title: string; series?: string; url?: string; at: number }
export const VIDEO_RECENT_MAX = 5;

/** What the controller needs from the orchestrator, no more (the music paths stay untouched). */
export interface VideoHost {
  adapterOf(tileId: string): AdapterSpec | undefined;
  adapterIdOf(tileId: string): string | null;
  tileExists(tileId: string): boolean;
  inject(tileId: string, js: string): Promise<void>;
  navigate(tileId: string, url: string): Promise<void>;
  dashId(): string | null;
  store(): { get(key: string): string | null | Promise<string | null>; set(key: string, value: string): void | Promise<void> } | undefined;
  /** A human asked: the play it starts takes the audio (section 3). */
  arm(tileId: string): void;
  /** The address the tile's page is at now, as the shell last reported it (the pick-as-face rule needs the page to be the pick's). */
  urlOf(tileId: string): string | null;
  /** The page is in element fullscreen (the stage), as the shell reports it. */
  onStage(tileId: string): boolean;
  /**
   * The stage (2026-09-20, "1 stage where we watched all videos ... much like we're feeding all music through to 1 player"):
   * the play a person asked for has begun - the player's own fullscreen control is pressed once, so the service's chrome
   * goes and the picture fills the screen; the presentation keeper holds it from there. A human's ask, never a timer's.
   */
  enterStage(tileId: string): void;
  claimAudio(tileId: string): Promise<void>;
  /** The page's answer to a small read (the playback doctor's error probe); absent in a shell without it. */
  evaluate?(tileId: string, js: string): Promise<string | null>;
  /** A trusted press at a page point - the slider's seek on a service's own scrubber only. */
  scrub?(tileId: string, x: number, y: number): Promise<void>;
  /** A person (or the wall on their behalf) paused or pressed on this tile since that moment - the doctor never heals over a person. */
  personActedSince?(tileId: string, since: number): boolean;
}

export const VIDEO_SCRIPT_FIELDS = ["videoContext", "videoLibrary", "videoPlay", "videoCmd", "videoLookup", "videoProfiles", "videoLive", "videoTune", "videoSearch", "videoTracks", "videoSeek", "videoSeekPoint", "videoPreview", "videoEpisodeNumber"] as const;
export const VIDEO_CMDS = ["play", "pause", "seekforward", "seekbackward", "next", "nextepisode", "skipintro", "captions", "fullscreen"] as const;
export type VideoCmd = (typeof VIDEO_CMDS)[number];
/** Verbs only a video adapter's own script can take (no media-element fallback makes sense for them). */
export const VIDEO_ONLY_CMDS: readonly string[] = ["nextepisode", "skipintro", "captions", "fullscreen"];

export function isVideoAdapter(spec: AdapterSpec | undefined): boolean {
  return !!spec && VIDEO_SCRIPT_FIELDS.some((f) => typeof spec[f] === "string" && spec[f]!.length > 0);
}

const PICK_TIMEOUT_MS = 20_000;
/** A title the boot brought back that has not started this long after the boot is over (past the wall's second try at its address). */
export const RESTORE_GIVE_UP_MS = 150_000;
/** A service's generic page title - "Hulu | Watch", "Netflix", "Home | Paramount+" - not a title's name (see where a page's report is kept). */
export function isPageTitle(t: string): boolean {
  const s = String(t ?? "").trim();
  if (!s) return false;
  const brand = /^(hulu|netflix|disney\+?|max|hbo max|paramount\+?|peacock|apple tv\+?|prime video|amazon prime video|tubi|pluto tv|youtube( tv)?|fandango at home|vudu|movies anywhere|sling tv|philo|crunchyroll)$/i;
  if (brand.test(s)) return true;
  const parts = s.split(/\s+[|\u2013\u2014-]\s+/);
  if (parts.length !== 2) return false;
  const generic = /^(watch|home|browse|stream(ing)?|search|my stuff|my list|live tv|guide|player|movies|tv shows|series)$/i;
  return (brand.test(parts[0]!) && generic.test(parts[1]!)) || (generic.test(parts[0]!) && brand.test(parts[1]!));
}

/*
 * The playback doctor (2026-09-23, "There is an error on the hulu video playback, can you see what can be done to autodetect and autorecover
 * from video playback errors?"). Hulu's page sat on its watch address with no player (position 0, no duration, its error screen unread by the
 * adapter) and nothing moved. A tile whose page is ON the title the wall asked for is watched for four things: the page's own error (the
 * adapter's reading, or the player's standard MediaError), a start that never comes, a clock that stops while the page says it plays, and a
 * player that vanishes after playing with nobody pausing it. Each is healed the same way - the title's own address opened again (every
 * service resumes there) - at most DOCTOR_MAX times in DOCTOR_WINDOW_MS, DOCTOR_GAP_MS apart, and never more than DOCTOR_HOURLY starts
 * of one title in an hour (Disney+ answers six in an hour with Error 83). Then it stops and the failure stands on the wall for the
 * person's Retry. Observe-only: it reads the page and loads an address; it presses nothing.
 */
export const DOCTOR_START_MS = 35_000;
export const DOCTOR_FROZEN_MS = 30_000;
export const DOCTOR_LOST_MS = 15_000;
export const DOCTOR_GAP_MS = 45_000;
export const DOCTOR_MAX = 2;
export const DOCTOR_WINDOW_MS = 15 * 60_000;
export const DOCTOR_HOURLY = 3;
export const DOCTOR_CLEAN_MS = 60_000;
/** A person's own seek, drag or press on the tile: the doctor stands back this long. */
export const DOCTOR_PERSON_MS = 60_000;
/** Page-side, read-only: the largest video's MediaError, else a small visible box whose text is a playback error. Returns the words or "". */
export const PLAYBACK_ERROR_PROBE_JS = `(function(){try{var vs=[].slice.call(document.querySelectorAll('video')),big=null,a=0;vs.forEach(function(v){var r=v.getBoundingClientRect();if(r.width*r.height>a){a=r.width*r.height;big=v;}});if(big&&big.error){var c=big.error.code;return 'the player reported a media error ('+(c===2?'network':c===3?'decode':c===4?'unsupported source':'aborted')+')';}var re=/error playing|playback error|something went wrong|we encountered an error|(cannot|can.t|unable to) play|video (is )?(unavailable|not available)|error code|try again later/i;var els=document.querySelectorAll('[role=dialog],[role=alert],[class*=rror],[class*=modal],[data-testid*=rror]');for(var i=0;i<els.length;i++){var e=els[i];if(!(e.offsetWidth>0&&e.offsetHeight>0)||e.offsetHeight>900)continue;var t=(e.textContent||'').replace(/\\s+/g,' ').trim();if(t.length>400)continue;if(re.test(t))return t.slice(0,200);}return '';}catch(x){return '';}})()`;
/**
 * The picture falling behind the sound (2026-09-25, "The netflix audio and video are a little bit out of sync, are we able to detect and fix that if it
 * occurs? Often on TVs I have to kill the app and reopen them"). The page cannot see the true lip-sync offset (a DRM picture never reaches it, and the
 * speakers' delay is outside it), but it can see its own player fall behind: the pictures decoded per second of the title's clock dropping below
 * what this title decodes at, or pictures being dropped. Sampled every AV_SAMPLE_MS while a title plays (never in an ad, never within a minute of a
 * person's press); two bad samples in a row get the pause-and-play a person would press, once per AV_NUDGE_GAP_MS; still behind after that, the
 * title is opened again at its place (the doctor's heal, within its limits). Read-only probe: the largest video's playback counters.
 */
export const AV_SAMPLE_MS = 15_000;
export const AV_NUDGE_GAP_MS = 10 * 60_000;
export const AV_PROBE_JS = `(function(){try{var vs=[].slice.call(document.querySelectorAll('video')),v=null,a=0;vs.forEach(function(x){var r=x.getBoundingClientRect();if(r.width*r.height>a){a=r.width*r.height;v=x;}});if(!v||!v.getVideoPlaybackQuality)return '';var q=v.getVideoPlaybackQuality();return JSON.stringify({f:q.totalVideoFrames,d:q.droppedVideoFrames,c:v.currentTime,p:v.paused});}catch(e){return '';}})()`;
interface AvWatch { last: { f: number; d: number; c: number; at: number } | null; nominal: number; bad: number; nudgedAt: number; probing: boolean; sampledAt: number }
interface DoctorWatch { url: string; attempts: number[]; lastPos: number | null; lastPosAt: number; playingSince: number; lastPlayAt: number; lostAt: number; healing: boolean; probing: boolean; wasStage: boolean; gaveUp: boolean }
/** a play that begins within this of the ask is the ask's; later, the person is somewhere else */
const STAGE_ASK_MS = 180_000;
/** The stage ask waits out an ad or a start that has not come, but not past this from the ask itself. */
const STAGE_ASK_MAX_MS = 20 * 60_000;

export class VideoController {
  private readonly contexts = new Map<string, VideoContext | null>();
  private readonly playing = new Map<string, boolean>();
  /** Per App (the adapter's name): the screen slot's tile id is the same whichever service is up, so the tile is not the key. */
  private readonly libraries = new Map<string, VideoLibrary>();
  private readonly resumes = new Map<string, VideoResumePoint | null>();
  /** Per App: the last titles the wall saw play here, newest first (Quick play's recents, VP-3b). */
  private readonly recents = new Map<string, VideoResumePoint[]>();
  /**
   * Each series' episode last seen playing on the wall, and how far in (2026-09-25, "any optimizations" for Paramount+'s slow starts): a series
   * pick goes straight to that episode's own address when it was left partway, skipping the show page's load. Kept on the device, written at
   * most once a minute; "app|series" -> address, position, length, when.
   */
  private seriesAt: Record<string, { url: string; pos: number; dur: number; at: number }> | null = null;
  /** A series' name for matching: letters and digits, lower case, "the" dropped at the front. */
  private static seriesNormOf(s: string): string { return String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, ""); }
  private seriesAtSaved = 0;
  static readonly SERIES_AT_KEY = "video:series-at";
  private seriesAtLoad(): Record<string, { url: string; pos: number; dur: number; at: number }> {
    if (this.seriesAt) return this.seriesAt;
    this.seriesAt = {};
    try { const raw = this.host.store()?.get(VideoController.SERIES_AT_KEY); if (typeof raw === "string" && raw) { const j = JSON.parse(raw); if (j && typeof j === "object") this.seriesAt = j; } } catch { /* a fresh map */ }
    return this.seriesAt!;
  }
  private noteSeriesAt(app: string, series: string, url: string, pos: number, dur: number): void {
    const map = this.seriesAtLoad();
    map[app + "|" + VideoController.seriesNormOf(series)] = { url, pos, dur, at: Date.now() };
    if (Date.now() - this.seriesAtSaved < 60_000) return;
    this.seriesAtSaved = Date.now();
    const keys = Object.keys(map).sort((a, b) => map[b]!.at - map[a]!.at);
    for (const k of keys.slice(200)) delete map[k];
    try { void this.host.store()?.set(VideoController.SERIES_AT_KEY, JSON.stringify(map)); } catch { /* best effort */ }
  }
  /** The episode to open for a series pick on this service: the one left partway (more than two minutes from its end) in the last 30 days, or null. */
  seriesEpisodeUrl(app: string, series: string): string | null {
    const e = this.seriesAtLoad()[app + "|" + VideoController.seriesNormOf(series)];
    if (!e || Date.now() - e.at > 30 * 86_400_000) return null;
    if (!(e.dur > 0) || e.dur - e.pos < 120 || e.pos < 5) return null;
    return e.url;
  }
  /** Phase 2 (video-menu-spec §4.1): the household's watch log - every play the wall saw, on this device only, never sent. */
  private log: MenuLogEntry[] = [];
  private logLoaded = false;
  /** §4.2: when each title was first listed by each service, and its rank then. */
  private seen: FirstSeen = {};
  private seenLoaded = false;
  /** Per App: the live channels the page last listed (§2 row 3). */
  private readonly live = new Map<string, VideoChannel[]>();
  private readonly pending = new Map<string, { kind: string; id: string; name: string; at: number; failed?: string; restored?: boolean }>();
  private readonly loaded = new Set<string>();
  private readonly profiles = new Map<string, VideoProfiles | null>();
  /** The profiles a service has ever shown the wall (its gate, on any surface), kept per App under video:profiles:<dash>:<app> - the menu's choice list (2026-09-19). */
  private readonly known = new Map<string, VideoProfiles["profiles"]>();
  /** The name of what the wall asked for, for a page that names nothing (Netflix's chrome, and its title, leave the DOM while hidden). */
  private readonly hints = new Map<string, { id: string; url: string | null; name: string; at: number }>();
  /** a human's play / tune / search-open on this tile, waiting for the play to begin so the stage can be entered once */
  private readonly stageAsk = new Map<string, number>();
  /** When a stage ask was first made, and the value the wait last wrote (a new ask differs from it and starts afresh). */
  private readonly stageAskFirst = new Map<string, { first: number; wrote: number }>();
  /** the page's own playback error, as last seen (2026-09-21); healing it is the doctor's (2026-09-23) */
  private readonly errors = new Map<string, { text: string; at: number; refreshed: boolean }>();
  /** the playback doctor's watch per tile, what it last did, and every automatic start per title address (the hourly cap) */
  private readonly doctor = new Map<string, DoctorWatch>();
  private readonly healNote = new Map<string, { why: string; attempt: number; at: number; gaveUp?: boolean }>();
  private readonly titleStarts = new Map<string, number[]>();
  private readonly choices = new Map<string, VideoProfileChoice | null>();   // per App (the host of the tile's adapter)
  private readonly gatePicked = new Map<string, number>();
  /**
   * Per App: the profile the service's SESSION is on, as far as the wall knows - its own last press on a gate or a switcher
   * (a standing choice or a pick for this once), or a switcher's word. A hidden surface that meets a gate presses this and
   * nothing else, since its press changes whose account the screen watches as (the session is one): never the household's
   * standing choice over a profile someone picked for this once, and nothing at all while the wall cannot know (a gate the
   * person answered by hand on the screen) - the background read then yields nothing, which is the lesser harm (2026-09-21).
   */
  private readonly sessionProfile = new Map<string, string | null>();
  /** Kept under video:session-profile:<dash>:<app>: the session lives in the browser's cookies across a restart, and so must the wall's knowledge of it. */
  private setSessionProfile(appKey: string, id: string | null): void {
    this.sessionProfile.set(appKey, id);
    const dash = this.host.dashId(); const store = this.host.store();
    if (dash && store) { try { void store.set(`video:session-profile:${dash}:${appKey}`, id ?? ""); } catch { /* best effort */ } }
  }
  /** the screen's gate as last seen: when it leaves without the wall's press, someone answered it by hand */
  private readonly gateSeen = new Map<string, number>();

  constructor(private readonly host: VideoHost) {}

  /** A tile is a video tile when its adapter declares any video script. */
  isVideoTile(tileId: string): boolean { return this.host.tileExists(tileId) && isVideoAdapter(this.host.adapterOf(tileId)); }
  /** The page's playback edge (the prelude's poll, at once): the toggle on the wall had read a state up to a report late and
   *  sent pause to a paused player three times (2026-09-21 14:19). */
  notePlayback(tileId: string, playing: boolean): void {
    if (!this.isVideoTile(tileId)) return;
    // a home page's preview starting is not a title playing (see where a page's report is kept: videoPlaysAt)
    const playsAt = this.host.adapterOf(tileId)?.videoPlaysAt;
    if (playing && playsAt?.length && !this.contexts.get(tileId) && !playsAt.some((pat) => (this.host.urlOf(tileId) ?? "").split("?")[0]!.includes(pat))) return;
    this.playing.set(tileId, playing);
  }
  /** The page says an ad is running on this tile (the adapter's own named marker). The wall's seeks wait it out: on a
   *  stitched stream a seek during the break is a skip past the ad, and Prism observes and covers, never interferes (section 26). */
  inAd(tileId: string): boolean { return this.contexts.get(tileId)?.ad === true; }

  /**
   * Phase 2: a report from an App's popped-out surface (App setup, the sign-in wizard: `app:<id>:preview`) carries the same
   * library, live channels and rows - keyed by the adapter's name, no tile behind it. The rows a person browses while
   * signing in are kept the way the screen's are; a pick, a hint or a profile press belong to the screen alone.
   */
  onPreviewObservation(adapterKey: string, info: NowPlaying | null): void {
    void this.loadApp(adapterKey);
    if (!this.rowsFrozen(adapterKey)) this.keepRows(adapterKey, info);   // a hidden page not yet switched still reports the last person's rows
    this.keepProfiles(adapterKey, info);
  }
  /** The profiles a page listed (the gate, on the screen / a setup page / a hidden search surface): remembered for the App, so the menu can offer them any time. */
  private keepProfiles(app: string, info: NowPlaying | null): void {
    const prof = info?.videoProfiles && typeof info.videoProfiles === "object" && Array.isArray(info.videoProfiles.profiles) ? info.videoProfiles : null;
    if (!prof || !prof.profiles.length) return;
    const list = prof.profiles.filter((p) => p && typeof p.id === "string" && typeof p.name === "string").map((p) => ({ id: p.id, name: p.name, avatar: typeof p.avatar === "string" ? p.avatar : null })).slice(0, 12);
    if (!list.length) return;
    const have = this.known.get(app);
    // The gate names the whole household, and so does a switcher that names its current profile. A switcher that lists only
    // the OTHERS (Hulu's Account Menu, Peacock's nav: everyone but whoever is watching) is a partial list: it adds to what is
    // known and never takes away - read live 2026-09-21, leaving Hulu's gate as Alex had dropped Alex from the menu's offer
    const whole = prof.gate === true || (prof.othersOnly !== true && typeof prof.current === "string" && list.some((p) => p.id === prof.current || p.name === prof.current));
    if (!whole && have?.length) {
      const merged = have.map((h) => ({ id: h.id, name: h.name, avatar: h.avatar ?? list.find((p) => p.id === h.id)?.avatar ?? null }));
      for (const p of list) if (!merged.some((h) => h.id === p.id)) merged.push(p);
      list.splice(0, list.length, ...merged.slice(0, 12));
    }
    if (have && have.length === list.length && have.every((p, i) => p.id === list[i]!.id && p.name === list[i]!.name && p.avatar === list[i]!.avatar)) return;
    this.known.set(app, list);
    const dash = this.host.dashId();
    const store = this.host.store();
    if (dash && store) { try { void store.set(`video:profiles:${dash}:${app}`, JSON.stringify(list)); } catch { /* best effort */ } }
  }
  /**
   * The combined My list (2026-09-20): a hidden surface on the service's own list page reports its rows; the list (and a
   * Continue Watching row, when that page carries one - Tubi's My Stuff does) are kept for the App. Nothing else from such
   * a page is kept: its "recommended" rows are not the person's list.
   */
  keepListFrom(app: string, info: NowPlaying | null, settled = false): boolean {
    const lib = info?.videoLibrary && typeof info.videoLibrary === "object" ? cleanLibrary(info.videoLibrary) : null;
    if (!lib) return false;
    void this.loadApp(app);
    const have = this.libraries.get(app);
    // the owned pages (2026-09-22): kept by keepOwned - a report of them alone is done here
    if (lib.owned.length) {
      const kept = { continue: have?.continue ?? [], list: have?.list ?? [], shelves: have?.shelves ?? [], ...this.keepOwned(have, lib) };
      this.libraries.set(app, kept); this.persist(app, "library", kept);
      if (!lib.list.length && !lib.continue.length) return true;
    }
    if (!lib.list.length && !lib.continue.length) return false;
    if (lib.continue.length) { void this.loadMenu(); this.seen = noteSeen(this.seen, app, lib.continue, Date.now()); this.persistMenu("seen", this.seen); }
    // the list page is the list: once it has settled, an empty list means the person's list IS empty (Tubi's My Stuff with
    // only a Continue Watching row had left an older home-page read standing)
    const now = this.libraries.get(app);
    // a Continue Watching-only page IS the row (Fandango's /continuewatching, 2026-09-23); it never speaks for the list
    const contNow = lib.continue.length || lib.continueOnly ? lib.continue : have?.continue ?? [];
    const merged = { continue: contNow, list: lib.list.length || (settled && !lib.continueOnly) ? this.screenList(app, lib.list) : have?.list ?? [], shelves: have?.shelves ?? [], owned: now?.owned ?? have?.owned ?? [], ownedMissed: now?.ownedMissed ?? have?.ownedMissed ?? {} };
    this.libraries.set(app, merged);
    this.persist(app, "library", merged);
    return true;
  }
  /**
   * The owned list (2026-09-22): each read's titles join what is known, by id - a library grows on a partial read; a COMPLETE
   * pass (the reader reached the end) is the library as it stands, and a title absent from two complete passes in a row is gone
   * ("Deletes should be uncommon but still would prefer not to leave orphaned items forever") - two, because a virtualized grid
   * can skip a row that rendered late (Fandango's first pass had 1,564 of some 1,950). A report with no owned list keeps it whole.
   */
  private keepOwned(have: VideoLibrary | undefined, lib: { owned: VideoItem[]; ownedComplete: boolean }): { owned: VideoItem[]; ownedMissed: Record<string, number> } {
    if (!lib.owned.length) return { owned: have?.owned ?? [], ownedMissed: have?.ownedMissed ?? {} };
    const ids = new Set((have?.owned ?? []).map((x) => x.id));
    let owned = [...(have?.owned ?? []), ...lib.owned.filter((x) => !ids.has(x.id))].slice(0, 3000);   // a library of two thousand fits (some 400 KB in the store)
    let missed = { ...(have?.ownedMissed ?? {}) };
    if (lib.ownedComplete && lib.owned.length >= 50) {
      const seen = new Set(lib.owned.map((x) => x.id));
      for (const x of owned) missed[x.id] = seen.has(x.id) ? 0 : (missed[x.id] ?? 0) + 1;
      owned = owned.filter((x) => (missed[x.id] ?? 0) < 2);
      missed = Object.fromEntries(Object.entries(missed).filter(([id, n]) => n > 0 && owned.some((x) => x.id === id)));
    }
    return { owned, ownedMissed: missed };
  }
  /** The App's list IS empty (its own list page said so and settled): the older read goes. */
  clearList(app: string): void {
    const have = this.libraries.get(app);
    if (!have?.list?.length) return;
    const merged = { continue: have.continue ?? [], list: [], shelves: have.shelves ?? [] };
    this.libraries.set(app, merged);
    this.persist(app, "library", merged);
  }
  /** The App's profiles as the wall has seen them (the menu's choice list); empty until the service has shown its gate once. */
  knownProfiles(appKey: string): VideoProfiles["profiles"] {
    void this.loadApp(appKey);
    return this.known.get(appKey) ?? [];
  }
  /**
   * The household's choice for this App, plain: "profile a simple choice under each service ... persist the profile choice
   * until I make a different selection later" (2026-09-19). Stands until changed or cleared (askProfile); applied to the
   * gate wherever it shows - now, on any surface of the App that has it up, and on every later appearance.
   */
  chooseProfile(appKey: string, id: string): "ok" | "unknown-profile" {
    const listed = this.known.get(appKey)?.find((p) => p.id === id);
    let onGate: { id: string; name: string } | undefined;
    for (const [tileId, prof] of this.profiles) if (prof?.gate && this.appKey(tileId) === appKey) onGate = prof.profiles.find((p) => p.id === id) ?? onGate;
    const found = listed ?? onGate;
    if (!found) return "unknown-profile";   // only an id the service itself listed is ever sent back to it
    const choice: VideoProfileChoice = { id, name: found.name, always: true, at: Date.now() };
    this.choices.set(appKey, choice);
    this.persistChoice(appKey, choice);
    for (const [tileId, prof] of this.profiles) {
      const onIt = !!prof && !prof.gate && typeof prof.current === "string" && prof.current === found.name;
      if (!prof || (!prof.gate && (typeof prof.current !== "string" || onIt)) || this.appKey(tileId) !== appKey || !prof.profiles.some((p) => p.id === id)) continue;
      this.gatePicked.set(tileId, Date.now());
      this.setSessionProfile(appKey, id);
      this.host.arm(tileId);
      void this.host.inject(tileId, `window.__prismVideoProfile && window.__prismVideoProfile(${JSON.stringify(id)})`);
    }
    return "ok";
  }
  /** The choice cleared: the service asks again, and the person answers on the gate. */
  askProfile(appKey: string): void { this.choices.set(appKey, null); this.persistChoice(appKey, null); }

  /**
   * A watch the wall should not remember (2026-09-20): the log's entries for this App whose id, address or title is `what`
   * are dropped, and the App's resume point and recents with it. The log is the person's own record; this is their eraser
   * (first used to take back a trailer's false entry, B-251). Returns how many entries went.
   */
  forgetWatch(appKey: string, what: string): number {
    const hit = (x: { id?: string; url?: string | null; title: string; series?: string }) => x.id === what || x.url === what || x.title === what || x.series === what;
    const before = this.log.length;
    this.log = this.log.filter((e) => !(e.app === appKey && hit(e)));
    if (this.log.length !== before) this.persistMenu("log", this.log);
    const r = this.resumes.get(appKey);
    if (r && hit(r)) { this.resumes.set(appKey, null); this.persist(appKey, "resume", null); }
    const rc = this.recents.get(appKey) ?? [];
    const kept = rc.filter((p) => !hit(p));
    if (kept.length !== rc.length) { this.recents.set(appKey, kept); this.persist(appKey, "recent", kept); }
    return before - this.log.length;
  }
  /** The library, the live channels and the first-seen record from a report, kept per App. */
  private keepRows(app: string, info: NowPlaying | null): void {
    const lib = info?.videoLibrary && typeof info.videoLibrary === "object" ? cleanLibrary(info.videoLibrary) : null;
    const liveRaw = info?.videoLive;
    if (Array.isArray(liveRaw)) {
      const chans = liveRaw.filter((c): c is VideoChannel => !!c && typeof c === "object" && typeof (c as VideoChannel).id === "string" && typeof (c as VideoChannel).name === "string" && typeof (c as VideoChannel).url === "string")
        .map((c) => ({ id: c.id, name: c.name, url: c.url, now: typeof c.now === "string" ? c.now : null, logo: typeof c.logo === "string" ? c.logo : null, favorite: c.favorite === true })).slice(0, 200);
      if (chans.length) { this.live.set(app, chans); this.persist(app, "live", chans); }
    }
    if (lib && (lib.continue.length || lib.list.length || lib.shelves.length || lib.owned.length)) {
      // §4.2 the first-seen record follows the Continue Watching row (a fresh listing, a move to the top)
      if (lib.continue.length) { void this.loadMenu(); this.seen = noteSeen(this.seen, app, lib.continue, Date.now()); this.persistMenu("seen", this.seen); }
      const have = this.libraries.get(app);
      // a page reports the rows it has: a report without a shelf the last one had keeps that shelf (My List lives on its own page);
      // the owned list rides through every report (a home page's report had rebuilt the library without it, 2026-09-22)
      const merged = { continue: lib.continue.length ? lib.continue : have?.continue ?? [], list: lib.list.length ? this.screenList(app, lib.list) : have?.list ?? [], shelves: lib.shelves.length ? lib.shelves : have?.shelves ?? [], ...this.keepOwned(have, lib) };
      this.libraries.set(app, merged);
      this.persist(app, "library", merged);
    }
  }
  /** The observer's report for a video tile: the context, the library (kept), the resume point (kept), the pending pick. */
  onObservation(tileId: string, info: NowPlaying | null): void {
    if (!this.isVideoTile(tileId)) return;
    void this.load(tileId);
    let ctx = info?.video && typeof info.video === "object" ? info.video : null;
    this.checkPlayback(tileId, info, ctx);
    // the pick's name stands in for a face the page leaves unnamed: the same id or address, or a play that started within a
    // minute of the ask (Netflix resumes a show at its episode's own id)
    const hint = this.hints.get(tileId);
    if (ctx && !ctx.title && !ctx.series && hint && (ctx.id === hint.id || (!!hint.url && !!ctx.url && ctx.url === hint.url) || Date.now() - hint.at < 60_000 || this.contexts.get(tileId)?.title === hint.name)) ctx = { ...ctx, title: hint.name };
    // a service with no context script (Hulu, Tubi, Paramount+ tonight) says nothing about what plays: when the page plays
    // within ten minutes of the wall's own pick, the pick IS the face - the wall's knowledge, not an invention - so the log,
    // the resume point and the pending pick all settle (found live 2026-09-19: Hulu playing at 720p, core's pick "timeout")
    // ... and only on the pick's own page: a home page's promo plays too (Hulu's hub home after a failed episode, 2026-09-20,
    // had counted as the episode watched a minute ago)
    const here = this.host.urlOf(tileId) ?? "";
    const onPick = !!hint && ((!!hint.url && here === hint.url) || (!!hint.id && hint.id.length > 4 && here.includes(hint.id)));
    if (!ctx && info?.playing && hint && onPick && Date.now() - hint.at < 600_000) ctx = { kind: "title", title: hint.name, ...(hint.id ? { id: hint.id } : {}), ...(hint.url ? { url: hint.url } : {}), playing: true };
    // the page's own playback error ("Error playing video · RUNUNK13", Hulu 2026-09-21): said on the wall, the pick marked
    // failed with the page's words, and ONE refresh - the title's own address opened again a moment later, once per error;
    // a second failure stays on the wall for the person's Retry
    if (ctx?.error) {
      const errText = ctx.error;
      const err = this.errors.get(tileId);
      if (!err || err.text !== errText || Date.now() - err.at > 120_000) this.errors.set(tileId, { text: errText, at: Date.now(), refreshed: false });
      const pend0 = this.pending.get(tileId);
      if (pend0 && !pend0.failed) pend0.failed = errText;
      ctx = null;   // an error page names no title playing
    } else if (info?.playing && ctx && (ctx.title || ctx.series)) this.errors.delete(tileId);
    // a service's own page title is no title (2026-09-25: a Hulu window read "Hulu | Watch" in Watch's corner until it played - Hulu's player had
    // not named the show yet and the adapter fell back on the page's title): the name the wall asked for stands in, else nothing
    if (ctx && !ctx.series && ctx.title && isPageTitle(ctx.title)) ctx = { ...ctx, title: hint?.name && !isPageTitle(hint.name) ? hint.name : "" };
    // a video with no name on a page where the service plays no titles is its preview - Netflix's home banner playing at 71 s (2026-09-25) - not a
    // title up and not playing: the adapter names the pages that play (videoPlaysAt); a nameless video on one of those is a title still loading
    const playsAt = this.host.adapterOf(tileId)?.videoPlaysAt;
    let preview = false;
    if (playsAt?.length && ctx && !ctx.series && !ctx.title) {
      const u = (ctx.url || this.host.urlOf(tileId) || "").split("?")[0]!;
      if (!playsAt.some((pat) => u.includes(pat))) { ctx = null; preview = true; }
    }
    // ... and a page that names no video at all while something on it plays (2026-09-25: Hulu's home page read "Hulu - playing" for its preview)
    else if (playsAt?.length && !ctx && !playsAt.some((pat) => (this.host.urlOf(tileId) ?? "").split("?")[0]!.includes(pat))) preview = true;
    this.contexts.set(tileId, ctx);
    this.playing.set(tileId, !preview && (!!info?.playing || ctx?.playing === true));
    const app = this.appKey(tileId);
    if (!this.rowsHeld.has(tileId) && !this.rowsFrozen(app)) this.keepRows(app, info);   // a window still on the last person's page reports that person's rows
    // the profile gate (VP-3): kept for the wall's menu; a standing "always" choice is applied once per appearance
    const prof = info?.videoProfiles && typeof info.videoProfiles === "object" && Array.isArray(info.videoProfiles.profiles) ? info.videoProfiles : null;
    this.profiles.set(tileId, prof);
    this.keepProfiles(app, info);
    // a gate asks; a SWITCHER (Movies Anywhere's nav) only says who is current - the standing choice is pressed on either
    // when the page is not on it (the guard keeps it to once per appearance)
    const choice0 = this.choices.get(this.appKey(tileId));
    if (prof && !prof.gate && typeof prof.current === "string") {   // a switcher names the session's profile
      const cur = prof.profiles.find((p) => p.id === prof.current || p.name === prof.current);
      if (cur) this.setSessionProfile(app, cur.id);
    }
    if (prof?.gate) this.gateSeen.set(tileId, Date.now());
    else if (this.gateSeen.has(tileId)) {   // the gate left: the wall's press, or a hand's - after a hand's the session's profile is unknown
      if ((this.gatePicked.get(tileId) ?? 0) < this.gateSeen.get(tileId)! - 15_000) this.setSessionProfile(app, null);
      this.gateSeen.delete(tileId);
    }
    // (an others-only switcher never names who is current: there a listed choice IS a profile the page is not on)
    const switcherOff = !!prof && !prof.gate && !!choice0?.always && prof.profiles.some((p) => p.id === choice0.id)
      && (typeof prof.current === "string" ? prof.current !== choice0.name : prof.othersOnly === true);
    if (prof?.gate || switcherOff) {
      const choice = choice0;
      const last = this.gatePicked.get(tileId) ?? 0;
      if (choice?.always && prof!.profiles.some((p) => p.id === choice.id) && Date.now() - last > 15_000) {
        this.gatePicked.set(tileId, Date.now());
        this.setSessionProfile(app, choice.id);
        void this.host.inject(tileId, `window.__prismVideoProfile && window.__prismVideoProfile(${JSON.stringify(choice.id)})`);
      }
    } else this.gatePicked.delete(tileId);
    const pend = this.pending.get(tileId);
    if (pend) {
      const ps = info?.videoPlayState && typeof info.videoPlayState === "object" ? info.videoPlayState : null;
      if (ps?.id === pend.id && typeof ps.status === "string" && ps.status.startsWith("error")) pend.failed = ps.status;
      // a title the wall brings back after a restart has landed once its page names it, playing or not (2026-09-25, "why is animal control
      // stuck in a loading state"): a restart may leave it paused on purpose, and a paused title never met the playing test below
      else if (pend.restored && ctx && !ctx.ad && ((!!ctx.url && (ctx.url === pend.id || pend.id.startsWith(ctx.url.split("?")[0]!))) || ctx.id === pend.id || ctx.series === pend.name || ctx.title === pend.name)) this.pending.delete(tileId);
      else if (this.playing.get(tileId) && (ctx?.id === pend.id || (!!ctx?.url && ctx.url.includes(pend.id)) || (!!ctx?.title && (ctx.title === pend.name || ctx.series === pend.name)) || (!!ctx && !ctx.ad && (!!ctx.title || !!ctx.series) && Date.now() - pend.at < 60_000))) this.pending.delete(tileId);   // a series pick lands on an episode's own name: a real play within a minute of the ask is the ask landing (Paramount+, 2026-09-20)
      else if (Date.now() - pend.at > PICK_TIMEOUT_MS && !pend.failed) pend.failed = "timeout";
    }
    // the stage: the play a person asked for has begun (a real title, not an ad) - the player's fullscreen, once
    // the ask stands for its window of playing: the player's control may appear late (Hulu's a beat after the play, and its
    // pre-roll first), so every playing report re-asks until the page reports fullscreen (the orchestrator stops then)
    let ask = this.stageAsk.get(tileId);
    // the ask waits out an ad and a start that has not come (2026-09-25, "paramount seems to be viewing the page and not just the video": South
    // Park sat in a stalled pre-roll past the ask's three minutes, and when the episode began the ask had run out): its window counts from when
    // the title itself can be shown, up to STAGE_ASK_MAX_MS from the ask
    if (ask !== undefined && (ctx?.ad || !this.playing.get(tileId))) {
      const was = this.stageAskFirst.get(tileId);
      const first = was && was.wrote === ask ? was.first : ask;   // a new ask starts its own wait
      if (Date.now() - first < STAGE_ASK_MAX_MS) { ask = Math.max(ask, Date.now() - STAGE_ASK_MS + 60_000); this.stageAsk.set(tileId, ask); }
      this.stageAskFirst.set(tileId, { first, wrote: ask });
    }
    if (ask === undefined) this.stageAskFirst.delete(tileId);
    if (ask !== undefined && this.playing.get(tileId) && ctx && (ctx.title || ctx.series) && !ctx.ad) {
      if (Date.now() - ask < STAGE_ASK_MS) this.host.enterStage(tileId); else this.stageAsk.delete(tileId);
    } else if (ask !== undefined && Date.now() - ask > STAGE_ASK_MS) this.stageAsk.delete(tileId);
    // where a series was left (a series pick opens that episode itself): what the wall saw playing, never an ad
    if (this.playing.get(tileId) && ctx && ctx.series && ctx.url && !ctx.ad && typeof ctx.position === "number" && typeof ctx.duration === "number" && ctx.duration > 60)
      this.noteSeriesAt(app, ctx.series, ctx.url, ctx.position, ctx.duration);
    // the resume point: only ever what the wall saw PLAYING, and never an ad
    if (this.playing.get(tileId) && ctx && (ctx.title || ctx.series) && !ctx.ad) {
      const point: VideoResumePoint = { kind: ctx.kind ?? "video", ...(ctx.id ? { id: ctx.id } : {}), title: ctx.title ?? ctx.series ?? "", ...(ctx.series ? { series: ctx.series } : {}), ...(ctx.url ? { url: ctx.url } : {}), at: Date.now() };
      const prev = this.resumes.get(app);
      if (!prev || prev.id !== point.id || prev.title !== point.title || prev.url !== point.url) {
        this.resumes.set(app, point); this.persist(app, "resume", point);
        const same = (r: VideoResumePoint) => (r.id && point.id ? r.id === point.id : r.url && point.url ? r.url === point.url : r.title === point.title);
        const list = [point, ...(this.recents.get(app) ?? []).filter((r) => !same(r))].slice(0, VIDEO_RECENT_MAX);
        this.recents.set(app, list); this.persist(app, "recent", list);
        // §4.1 the watch log: exact, local, never sent
        void this.loadMenu();
        this.log = noteLog(this.log, { app, ...(point.id ? { id: point.id } : {}), url: point.url ?? null, title: point.title, ...(point.series ? { series: point.series } : {}), at: point.at });
        this.persistMenu("log", this.log);
      }
    }
  }

  state(tileIds: readonly string[]): VideoTileState[] {
    const out: VideoTileState[] = [];
    for (const id of tileIds) {
      if (!this.isVideoTile(id)) continue;
      void this.load(id);
      const spec = this.host.adapterOf(id);
      const app = this.appKey(id);
      out.push({
        id, adapter: this.host.adapterIdOf(id), playing: this.playing.get(id) ?? false, video: this.contexts.get(id) ?? null,
        library: this.libraries.get(app) ?? { continue: [], list: [] }, resume: this.resumes.get(app) ?? null, pending: this.pending.get(id) ?? null,
        error: this.errors.get(id)?.text ?? null,
        recovering: this.healNote.get(id) ?? null,
        stage: this.host.onStage(id),
        lookupNote: spec?.videoLookupNote ?? null,
        profiles: this.profiles.get(id) ?? null,
        profileChoice: this.choices.get(this.appKey(id)) ?? null,
        can: { play: !!spec?.videoPlay, cmd: !!spec?.videoCmd, lookup: !!spec?.videoLookup, profiles: !!spec?.videoProfiles, tracks: !!spec?.videoTracks, seek: !!spec?.videoSeek || !!spec?.videoSeekPoint, preview: !!spec?.videoPreview },
      });
    }
    return out;
  }

  async library(tileId: string): Promise<VideoLibrary> {
    await this.load(tileId);
    return this.libraries.get(this.appKey(tileId)) ?? { continue: [], list: [] };
  }
  /**
   * VP-3: a service's library and resume point by the App's adapter name, whether or not the service is on the wall now
   * (the store keeps them from the last time it was) - sync, for the wall's menu; the first ask starts the read and
   * answers with what is cached.
   */
  /** A title the service itself removed from its Continue Watching (videoRemoveContinue): off the wall's row now, not at the next read. */
  /** My List changed on the service by the wall's own ask (2026-09-23): the kept list follows at once; the next read of the list page is the truth. */
  // ---- removals that do not hold (2026-09-23, "I've had severl items in my list for peacock come back after removal. Seems like yuou should have
  // record of these and if they failed and come back, should be able to take some sort of action right? Reduce the burden on the end user"):
  // a title taken off a service's list from the wall is remembered for a day. A list read that still carries it is a removal the service did not
  // keep - Peacock's toggle flips at once and its request can still be lost - so the title stays off the row and core asks the service again, twice
  // at most. After that, or after the day, a title that is back is the household's to keep (they may have added it again on the service itself).
  private readonly removed = new Map<string, Map<string, { at: number; tries: number; item: VideoItem; retrying: boolean }>>();
  static readonly REMOVED_HOLD_MS = 24 * 3_600_000;
  static readonly REMOVED_RETRIES = 2;
  /** Asked when a title removed from the wall is back in the service's list: core takes it off again (the retry's outcome comes back through removalRetried). */
  onListReturned: ((appKey: string, item: VideoItem, attempt: number) => void) | null = null;
  noteRemoved(appKey: string, item: VideoItem): void {
    void this.loadApp(appKey);
    const m = this.removed.get(appKey) ?? new Map();
    const had = m.get(item.id);
    m.set(item.id, { at: had?.at ?? Date.now(), tries: had?.tries ?? 0, item, retrying: false });
    this.removed.set(appKey, m); this.persistRemoved(appKey);
  }
  noteAdded(appKey: string, id: string): void { const m = this.removed.get(appKey); if (m?.delete(id)) this.persistRemoved(appKey); }
  removalRetried(appKey: string, id: string): void { const r = this.removed.get(appKey)?.get(id); if (r) r.retrying = false; }
  /** The removals being held for an App, for the menu's word ("taken off again"): id -> attempts so far. */
  removalsHeld(appKey: string): Record<string, number> { return Object.fromEntries([...(this.removed.get(appKey) ?? new Map()).entries()].map(([id, r]) => [id, r.tries])); }
  private persistRemoved(appKey: string): void {
    const m = this.removed.get(appKey);
    this.persist(appKey, "removed", Object.fromEntries([...(m ?? new Map()).entries()].map(([id, r]) => [id, { at: r.at, tries: r.tries, item: r.item }])));
  }
  /** A list as a service reported it, with the removals it did not keep held off (and asked again). */
  private screenList(appKey: string, list: VideoItem[]): VideoItem[] {
    const m = this.removed.get(appKey);
    if (!m?.size) return list;
    const now = Date.now();
    let changed = false;
    const out: VideoItem[] = [];
    for (const it of list) {
      const r = m.get(it.id);
      if (!r) { out.push(it); continue; }
      if (now - r.at > VideoController.REMOVED_HOLD_MS || (r.tries >= VideoController.REMOVED_RETRIES && !r.retrying)) { m.delete(it.id); changed = true; out.push(it); continue; }
      if (!r.retrying && this.onListReturned) { r.tries++; r.retrying = true; changed = true; this.onListReturned(appKey, it, r.tries); }
    }
    // a removal the service now keeps is done with: the read no longer carries it
    for (const [id, r] of m) if (!r.retrying && now - r.at > 60_000 && !list.some((x) => x.id === id)) { m.delete(id); changed = true; }
    if (changed) this.persistRemoved(appKey);
    return out;
  }
  // ---- hidden on the wall (2026-09-23, "I dont have the option to remove coraline from continue watching"): a service whose site cannot remove a
  // title from its Continue Watching (Fandango - only its phone app can) lets the person hide the card from the wall's row instead. Kept per App
  // (persisted); the service still lists it, and the card says so. It comes back by itself when its progress moves (they watched more of it), and
  // the record goes when the service stops listing the title.
  private readonly hiddenCont = new Map<string, Map<string, { at: number; progress: number | null }>>();
  hideContinue(appKey: string, id: string): void {
    void this.loadApp(appKey);
    const item = (this.libraries.get(appKey)?.continue ?? []).find((x) => x.id === id);
    const m = this.hiddenCont.get(appKey) ?? new Map();
    m.set(id, { at: Date.now(), progress: typeof item?.progress === "number" ? item.progress : null });
    this.hiddenCont.set(appKey, m); this.persistHidden(appKey);
  }
  unhideContinue(appKey: string, id: string): void { const m = this.hiddenCont.get(appKey); if (m?.delete(id)) this.persistHidden(appKey); }
  private persistHidden(appKey: string): void { this.persist(appKey, "hidden", Object.fromEntries(this.hiddenCont.get(appKey) ?? new Map())); }
  /** An App's Continue Watching as the wall shows it: its hidden titles out, unless their progress moved since. */
  private shownContinue(appKey: string, items: VideoItem[]): VideoItem[] {
    const m = this.hiddenCont.get(appKey);
    if (!m?.size) return items;
    let changed = false;
    const out = items.filter((it) => {
      const h = m.get(it.id);
      if (!h) return true;
      if (typeof it.progress === "number" && typeof h.progress === "number" && it.progress > h.progress + 0.02) { m.delete(it.id); changed = true; return true; }
      return false;
    });
    for (const id of [...m.keys()]) if (!items.some((x) => x.id === id) && Date.now() - (m.get(id)!.at) > 60_000) { m.delete(id); changed = true; }
    if (changed) this.persistHidden(appKey);
    return out;
  }
  dropFromList(appKey: string, id: string): void {
    const lib = this.libraries.get(appKey);
    if (!lib) return;
    const next = { ...lib, list: (lib.list ?? []).filter((x) => x.id !== id) };
    this.libraries.set(appKey, next); this.persist(appKey, "library", next);
  }
  addToList(appKey: string, item: VideoItem): void {
    const lib = this.libraries.get(appKey) ?? { continue: [], list: [], shelves: [] };
    if ((lib.list ?? []).some((x) => x.id === item.id)) return;
    const next = { ...lib, list: [item, ...(lib.list ?? [])] };
    this.libraries.set(appKey, next); this.persist(appKey, "library", next);
  }
  dropFromContinue(appKey: string, id: string): void {
    const lib = this.libraries.get(appKey);
    if (!lib) return;
    const next = { ...lib, continue: (lib.continue ?? []).filter((x) => x.id !== id) };
    this.libraries.set(appKey, next); this.persist(appKey, "library", next);
  }
  libraryOf(appKey: string): { library: VideoLibrary; resume: VideoResumePoint | null; recent: VideoResumePoint[]; live: VideoChannel[] } {
    void this.loadApp(appKey);
    void this.loadMenu();   // the log and the first-seen record warm with the rows, so the menu's first open orders by them
    return { library: this.libraries.get(appKey) ?? { continue: [], list: [], shelves: [] }, resume: this.resumes.get(appKey) ?? null, recent: this.recents.get(appKey) ?? [], live: this.live.get(appKey) ?? [] };
  }
  /**
   * Phase 2: the merged rows of the universal menu (video-menu-spec §2 rows 1-2), ordered by §4 through the pure function
   * in menu-order.ts over the four inputs and nothing else - the services' rows as given, the local log, the first-seen
   * record, now. The caller names the services (each with its adapter key); a service that reported no rows contributes none.
   */
  menu(services: readonly { app: string; name: string; facet: string; adapter: string; listMerge?: boolean }[], now = Date.now(), listBadge?: (item: VideoItem, adapter: string) => string | null): { continue: MenuCard[]; list: MenuCard[]; log: number } {
    void this.loadMenu();
    // a service may keep its list out of the merged row (adapter videoListMerge false); its Continue Watching merges as any
    const rowsOf = (key: "continue" | "list"): MenuServiceRow[] => services.filter((s) => key === "continue" || s.listMerge !== false).map((s) => { const items = (this.libraries.get(s.adapter)?.[key] ?? []) as VideoItem[]; return { app: s.app, name: s.name, facet: s.facet, items: key === "continue" ? this.shownContinue(s.adapter, items) : items }; }).filter((r) => r.items.length > 0);
    // the log speaks in App ids; the rows are keyed the same way (the App), so a log entry finds its row by App
    const log = this.log.map((e) => ({ ...e, app: this.appIdFor(e.app, services) }));
    const seen: FirstSeen = {};
    for (const s of services) if (this.seen[s.adapter]) seen[s.app] = this.seen[s.adapter]!;
    // a My List card the service gave no banner may carry TMDB's (a new episode this week) - it then sorts with the bannered ones
    const listRows = listBadge ? rowsOf("list").map((r) => { const adapter = services.find((s) => s.app === r.app)?.adapter ?? r.app; return { ...r, items: r.items.map((it) => { if (it.badge) return it; const b = listBadge(it, adapter); return b ? { ...it, badge: b, badgeFrom: "tmdb" as const } : it; }) }; }) : rowsOf("list");
    return { continue: orderMerged(rowsOf("continue"), log, seen, now), list: foldSameTitle(orderAlphabetical(listRows, log, seen, now)), log: this.log.length };
  }
  /** The log and the first-seen record are keyed by the adapter's name (like everything kept per App here); the menu's rows by the App id. */
  private appIdFor(adapterKey: string, services: readonly { app: string; adapter: string }[]): string { return services.find((s) => s.adapter === adapterKey)?.app ?? adapterKey; }
  private persistMenu(kind: "log" | "seen", value: unknown): void {
    const dash = this.host.dashId(); const store = this.host.store();
    if (!dash || !store) return;
    try { void store.set(`video:${kind}:${dash}`, JSON.stringify(value)); } catch { /* best effort */ }
  }
  private async loadMenu(): Promise<void> {
    const dash = this.host.dashId(); const store = this.host.store();
    if (!dash || !store || (this.logLoaded && this.seenLoaded)) return;
    this.logLoaded = true; this.seenLoaded = true;
    this.loading++;
    try {
      const l = await store.get(`video:log:${dash}`);
      if (l) { const arr = JSON.parse(l); if (Array.isArray(arr)) this.log = [...arr.filter((e): e is MenuLogEntry => !!e && typeof e === "object" && typeof (e as MenuLogEntry).at === "number" && typeof (e as MenuLogEntry).title === "string"), ...this.log].slice(0, 200); }
      const s = await store.get(`video:seen:${dash}`);
      if (s) { const rec = JSON.parse(s); if (rec && typeof rec === "object") this.seen = { ...(rec as FirstSeen), ...this.seen }; }
    } catch { /* unreadable: nothing kept */ } finally { this.loading--; }
  }

  /** Quick play: the service's own player plays the title (videoPlay), else the wall goes to the title's page. */
  async play(tileId: string, kind: string, id: string, url: string | null, name?: string): Promise<"ok" | "unavailable" | "unknown-tile"> {
    if (!this.host.tileExists(tileId)) return "unknown-tile";
    const spec = this.host.adapterOf(tileId);
    if (!spec?.videoPlay && !url) return "unavailable";
    this.host.arm(tileId);
    await this.host.claimAudio(tileId);
    // kind "open" (cross-service search, 2026-09-19): the address is a details page, a person presses Play there - no pick
    // waits for a play that is not promised, but the name still stands in as the face once the page plays (the hint)
    if (kind !== "open") this.pending.set(tileId, { kind, id, name: name ?? id, at: Date.now() }); else this.pending.delete(tileId);   // a new ask supersedes the last pick
    // the pick's own clock (2026-09-25, "that Tubi title never seemed to start successfully. It hung for a while and eventually went to Nothing is
    // Playing" - then "it has sent me to the Tubi page for American Gods. It shouldn't have"): a page that sends no reports (Tubi's show page) never
    // had its pick marked failed, so it stayed "loading", the wall counted it as a title, and the empty stage stepped aside for the service's page
    if (kind !== "open") {
      const at = this.pending.get(tileId)!.at;
      setTimeout(() => { const p = this.pending.get(tileId); if (p && p.at === at && !p.failed && !p.restored && !this.playing.get(tileId)) p.failed = "timeout"; }, PICK_TIMEOUT_MS + 2000);
    }
    this.stageAsk.set(tileId, Date.now());
    if (name) this.hints.set(tileId, { id, url, name, at: Date.now() });
    if (spec?.videoPlay) await this.host.inject(tileId, `window.__prismVideoPlay && window.__prismVideoPlay(${JSON.stringify(kind)}, ${JSON.stringify(id)}, ${JSON.stringify(url)})`);
    else if ((this.host.urlOf(tileId) ?? "").split("?")[0] !== url!.split("?")[0]) await this.host.navigate(tileId, url!);   // already there (the pick's address was loaded on the switch): no reload
    return "ok";
  }

  /**
   * A human's pick on the profile gate (VP-3). `always` makes it the household's standing choice for this App, applied by
   * the wall whenever the gate shows again; a plain pick is this once. The choice is kept under video:profile:<dash>:<app>.
   */
  async pickProfile(tileId: string, id: string, always: boolean): Promise<"ok" | "unavailable" | "unknown-tile"> {
    if (!this.host.tileExists(tileId)) return "unknown-tile";
    const spec = this.host.adapterOf(tileId);
    if (!spec?.videoProfiles) return "unavailable";
    const name = this.profiles.get(tileId)?.profiles.find((p) => p.id === id)?.name ?? this.choices.get(this.appKey(tileId))?.name ?? id;
    const key = this.appKey(tileId);
    const choice: VideoProfileChoice = { id, name, always, at: Date.now() };
    this.choices.set(key, choice);
    this.persistChoice(key, choice);
    this.gatePicked.set(tileId, Date.now());
    this.setSessionProfile(key, id);
    this.host.arm(tileId);
    await this.host.inject(tileId, `window.__prismVideoProfile && window.__prismVideoProfile(${JSON.stringify(id)})`);
    return "ok";
  }
  /** A human's pick of a subtitle or audio track from the stage bar (2026-09-21): the service's own player takes it through the adapter's videoTracks script. */
  async pickTrack(tileId: string, kind: "subtitles" | "audio", id: string): Promise<"ok" | "unavailable" | "unknown-tile"> {
    if (!this.host.tileExists(tileId)) return "unknown-tile";
    if (!this.host.adapterOf(tileId)?.videoTracks) return "unavailable";
    await this.host.inject(tileId, `window.__prismVideoTrack && window.__prismVideoTrack(${JSON.stringify(kind)}, ${JSON.stringify(id)})`);
    return "ok";
  }
  /** The person's drag on the slider: the service's own seek to that spot (adapter videoSeek); never during an ad (B-263). */
  seekTo(tileId: string, seconds: number): "ok" | "unavailable" | "ad" | "unknown-tile" {
    if (!this.host.tileExists(tileId)) return "unknown-tile";
    const spec = this.host.adapterOf(tileId);
    if ((!spec?.videoSeek && !spec?.videoSeekPoint) || !isFinite(seconds) || seconds < 0) return "unavailable";
    if (this.inAd(tileId)) return "ad";
    if (spec.videoSeekPoint && this.host.evaluate && this.host.scrub) {
      // the service's own scrubber, pressed where the spot falls (a player that follows nothing else - Peacock)
      const s = Math.round(seconds * 10) / 10, ev = this.host.evaluate.bind(this.host), scrub = this.host.scrub.bind(this.host);
      void (async () => {
        const raw = await ev(tileId, `window.__prismVideoSeekPoint ? window.__prismVideoSeekPoint(${JSON.stringify(s)}) : ""`);
        let pt = ""; try { pt = raw ? String(JSON.parse(raw)) : ""; } catch { pt = raw ?? ""; }
        const m = /^(-?[0-9.]+),(-?[0-9.]+)$/.exec(pt);
        if (m) await scrub(tileId, Number(m[1]), Number(m[2]));
        else if (spec.videoSeek) void this.host.inject(tileId, `window.__prismVideoSeek && window.__prismVideoSeek(${JSON.stringify(s)})`);
        setTimeout(() => void this.host.inject(tileId, "window.__prismVideoSeekDone && window.__prismVideoSeekDone()"), 900);
      })();
      return "ok";
    }
    void this.host.inject(tileId, `window.__prismVideoSeek && window.__prismVideoSeek(${JSON.stringify(Math.round(seconds * 10) / 10)})`);
    return "ok";   // answered at once: the host reads it through a script call that cannot wait on a promise
  }
  /** Forget the standing choice for this App (the gate is the person's again). */
  /** A pick called off before it played ("Cancel and return to Watch", 2026-09-22): its pending face and its stage ask go, so nothing enters the stage for it. */
  cancelPick(tileId: string): void { this.pending.delete(tileId); this.stageAsk.delete(tileId); }
  /** A pick that never became a title is marked failed (2026-09-23): its face says so, and the wall no longer counts it as a title up. */
  failPick(tileId: string, why: string): void { const p = this.pending.get(tileId); if (p && !p.failed) { this.pending.set(tileId, { ...p, failed: why }); this.stageAsk.delete(tileId); } }
  /** A title the wall had up when it closed, loading again at its own address (2026-09-23, "like turning off a tv and on again"): a pick's
   *  face and stage ask without the pick's script - the address itself plays it. Called when the tile is made and again once its page is up. */
  async restoreTitle(tileId: string, url: string, name: string, claim: boolean): Promise<void> {
    if (claim && this.host.tileExists(tileId)) { this.host.arm(tileId); await this.host.claimAudio(tileId); }
    const at = Date.now();
    this.pending.set(tileId, { kind: "title", id: url, name: name || url, at, restored: true });
    this.stageAsk.set(tileId, Date.now());
    if (name) this.hints.set(tileId, { id: url, url, name, at: Date.now() });
    // the last word on a title coming back (2026-09-25, the bar sat on "loading <title>..." after a restart): the wall's own second try waits on the
    // page's load, and a page that never finished loading - or finished before the boot marked it - never got that try, so the pick stayed loading
    // for good; this long after the boot a title that has not started is over, whatever its page did
    setTimeout(() => {
      const p = this.pending.get(tileId);
      if (p && p.at === at && p.restored && !p.failed && !this.playing.get(tileId)) this.failPick(tileId, "did not start again after the restart");
    }, RESTORE_GIVE_UP_MS);
  }
  forgetProfile(tileId: string): void {
    const key = this.appKey(tileId);
    this.choices.set(key, null);
    this.persistChoice(key, null);
  }
  /** The App behind a tile, for the choice: its adapter's name (one service, one gate). */
  private appKey(tileId: string): string { return this.host.adapterIdOf(tileId) ?? tileId; }
  private persistChoice(appKey: string, choice: VideoProfileChoice | null): void {
    const dash = this.host.dashId();
    const store = this.host.store();
    if (!dash || !store) return;
    try { void store.set(`video:profile:${dash}:${appKey}`, choice ? JSON.stringify(choice) : ""); } catch { /* best effort */ }
  }

  /**
   * The screen slot is one tile for every service: when it is re-assigned to another service, the pick, the hint and the
   * face that belonged to the last one go with it (found live 2026-09-19: "could not start NBC NEWS NOW" shown under Tubi
   * after a Peacock tune had failed on the same slot).
   */
  clearTile(tileId: string): void {
    this.pending.delete(tileId); this.hints.delete(tileId); this.contexts.delete(tileId); this.playing.delete(tileId); this.profiles.delete(tileId); this.gatePicked.delete(tileId); this.stageAsk.delete(tileId); this.errors.delete(tileId); this.doctor.delete(tileId); this.healNote.delete(tileId);
  }

  /** The playback doctor's look at one report (see DOCTOR_* above). */
  private checkPlayback(tileId: string, info: NowPlaying | null, v: VideoContext | null): void {
    const hint = this.hints.get(tileId);
    if (!hint?.url) return;
    const bare = (u: string) => u.split("?")[0]!.split("#")[0]!.replace(/[/]+$/, "");
    const here = this.host.urlOf(tileId) ?? "";
    const onTitle = bare(here) === bare(hint.url) || (hint.id.length > 4 && here.includes(hint.id)) || (!!v?.url && bare(v.url) === bare(hint.url));
    let d = this.doctor.get(tileId);
    if (!d || d.url !== hint.url) { d = { url: hint.url, attempts: [], lastPos: null, lastPosAt: Date.now(), playingSince: 0, lastPlayAt: 0, lostAt: 0, healing: false, probing: false, wasStage: false, gaveUp: false }; this.doctor.set(tileId, d); this.healNote.delete(tileId); }
    if (!onTitle || d.healing) { d.lostAt = 0; return; }   // the page left the title (the person browsed on), or a heal is under way
    const now = Date.now();
    const ad = v?.ad === true;
    const playing = !!info?.playing || v?.playing === true;
    const pos = typeof v?.position === "number" && isFinite(v.position) ? v.position : null;
    const dur = typeof v?.duration === "number" && isFinite(v.duration) ? v.duration : null;
    if (this.host.onStage(tileId)) d.wasStage = true;
    if (playing) d.lastPlayAt = now;
    // clean play - the clock moving, not merely "playing" (a frozen picture says it plays too) - for a minute resets the tries
    const moving = pos !== null && d.lastPos !== null && Math.abs(pos - d.lastPos) > 0.25;
    if (playing && !ad && (moving || (pos !== null && now - d.lastPosAt < 5_000))) { d.playingSince ||= now; if (now - d.playingSince > DOCTOR_CLEAN_MS && (d.attempts.length || d.gaveUp)) { d.attempts = []; d.gaveUp = false; this.healNote.delete(tileId); } } else d.playingSince = 0;
    const since = Math.max(hint.at, d.attempts[d.attempts.length - 1] ?? 0);
    const person = !!this.host.personActedSince?.(tileId, since);
    // the page says so (the adapter's reading)
    if (v?.error) { this.heal(tileId, d, v.error); return; }
    // a person's seek, drag or press in the last minute: a stall is theirs to see through, never healed - the doctor reopened Peacock 30 s
    // into a slider seek and the reopen put it back at the service's own resume point ("I scanned to 29:47 ... and eventually ended up
    // around 5:05", 2026-09-23)
    if (this.host.personActedSince?.(tileId, now - DOCTOR_PERSON_MS)) { d.lastPos = pos; d.lastPosAt = now; d.lostAt = 0; return; }
    // the clock stopped while the page says it plays
    if (playing && !ad && pos !== null) {
      if (d.lastPos === null || Math.abs(pos - d.lastPos) > 0.25) { d.lastPos = pos; d.lastPosAt = now; }
      else if (now - d.lastPosAt > DOCTOR_FROZEN_MS) { this.heal(tileId, d, "the picture froze"); return; }
    } else { d.lastPos = pos; d.lastPosAt = now; }
    // the picture keeping time with the sound (see AV_SAMPLE_MS)
    if (playing && !ad && pos !== null && !this.host.personActedSince?.(tileId, now - DOCTOR_PERSON_MS)) this.sampleAv(tileId, now);
    if (playing || ad || person) { d.lostAt = 0; return; }
    // never started since the ask (or the last heal)
    if (d.lastPlayAt < since && now - since > DOCTOR_START_MS) { this.probeThenHeal(tileId, d, "it did not start"); return; }
    // it had played, and the player is gone - no clock at all, not a pause (a paused player keeps its place and length)
    const gone = dur === null && (pos === null || pos === 0);
    if (d.lastPlayAt >= since && gone) {
      d.lostAt ||= now;
      if (now - d.lostAt > DOCTOR_LOST_MS) this.probeThenHeal(tileId, d, "the player stopped");
    } else d.lostAt = 0;
  }
  private readonly av = new Map<string, AvWatch>();
  private sampleAv(tileId: string, now: number): void {
    let w = this.av.get(tileId);
    if (!w) { w = { last: null, nominal: 0, bad: 0, nudgedAt: 0, probing: false, sampledAt: 0 }; this.av.set(tileId, w); }
    if (w.probing || now - w.sampledAt < AV_SAMPLE_MS || !this.host.evaluate) return;
    w.probing = true; w.sampledAt = now;
    void this.host.evaluate(tileId, AV_PROBE_JS).then((raw) => {
      w!.probing = false;
      let q: { f?: number; d?: number; c?: number; p?: boolean } | null = null;
      try { q = raw ? JSON.parse(typeof raw === "string" && raw.startsWith('"') ? JSON.parse(raw) : raw) : null; } catch { q = null; }
      if (!q || typeof q.f !== "number" || typeof q.d !== "number" || typeof q.c !== "number" || q.p) { w!.last = null; return; }
      const at = Date.now(), last = w!.last;
      w!.last = { f: q.f, d: q.d, c: q.c, at };
      if (!last) return;
      const wall = (at - last.at) / 1000, clock = q.c - last.c, frames = q.f - last.f;
      if (clock <= 1 || Math.abs(clock - wall) > 1.5 || frames < 0) return;   // a seek, a stall or a new title: the next sample starts afresh
      const rate = frames / clock, dropped = frames > 0 ? (q.d - last.d) / frames : 0;
      w!.nominal = Math.max(w!.nominal, Math.min(rate, 61));
      const behind = (w!.nominal >= 10 && rate < w!.nominal * 0.85) || dropped > 0.1;
      w!.bad = behind ? w!.bad + 1 : 0;
      if (w!.bad < 2) return;
      w!.bad = 0;
      if (at - w!.nudgedAt > AV_NUDGE_GAP_MS) { w!.nudgedAt = at; this.nudgeAv(tileId, "the picture fell behind the sound"); return; }
      this.healStall(tileId, "the picture stayed behind the sound");
    }, () => { w!.probing = false; });
  }
  /** The pause and play a person would press (the service's own player control), which brings sound and picture back together. */
  private nudgeAv(tileId: string, why: string): boolean {
    const spec = this.host.adapterOf(tileId);
    const pause = this.cmdJs(spec, "pause"), play = this.cmdJs(spec, "play");
    if (!pause || !play) return false;
    this.healNote.set(tileId, { why, attempt: 0, at: Date.now() });
    void this.host.inject(tileId, pause);
    setTimeout(() => { void this.host.inject(tileId, play); }, 700);
    return true;
  }
  /**
   * The person's Re-sync (the stage bar): pause and play; pressed again within RESYNC_AGAIN_MS, the title is opened again at its place - the wall's
   * "close the app and open it again". "nudged" | "reopened" | "unavailable".
   */
  static readonly RESYNC_AGAIN_MS = 10_000;
  private readonly resyncAt = new Map<string, number>();
  resync(tileId: string): "nudged" | "reopened" | "unavailable" {
    const now = Date.now();
    const last = this.resyncAt.get(tileId) ?? 0;
    this.resyncAt.set(tileId, now);
    if (now - last < VideoController.RESYNC_AGAIN_MS) { this.resyncAt.delete(tileId); return this.healStall(tileId, "re-synced by hand: opened again") ? "reopened" : "unavailable"; }
    return this.nudgeAv(tileId, "re-synced by hand") ? "nudged" : "unavailable";
  }
  /** The page's own words for what went wrong, when it has any, then the heal. */
  private probeThenHeal(tileId: string, d: DoctorWatch, why: string): void {
    if (d.probing) return;
    if (!this.host.evaluate) { this.heal(tileId, d, why); return; }
    d.probing = true;
    void this.host.evaluate(tileId, PLAYBACK_ERROR_PROBE_JS).then((said) => {
      d.probing = false;
      let words = "";
      if (typeof said === "string") { try { const j: unknown = JSON.parse(said); words = typeof j === "string" ? j.trim() : ""; } catch { words = said.trim(); } }   // WebView2 answers JSON
      if (words) this.errors.set(tileId, { text: words, at: Date.now(), refreshed: false });
      this.heal(tileId, d, words || why);
    }, () => { d.probing = false; this.heal(tileId, d, why); });
  }
  /** A stall the orchestrator saw and could not nudge loose (an ad clock standing still): healed as the doctor heals, the title opened again. */
  healStall(tileId: string, why: string): boolean {
    const d = this.doctor.get(tileId);
    if (!d || d.healing || d.gaveUp) return false;
    this.heal(tileId, d, why);
    return true;
  }
  private heal(tileId: string, d: DoctorWatch, why: string): void {
    const hint = this.hints.get(tileId);
    if (!hint?.url || d.healing || d.gaveUp) return;
    const now = Date.now();
    d.attempts = d.attempts.filter((t) => now - t < DOCTOR_WINDOW_MS);
    const last = d.attempts[d.attempts.length - 1] ?? 0;
    if (last && now - last < DOCTOR_GAP_MS) return;   // the last reopen is still being given its time
    const starts = (this.titleStarts.get(hint.url) ?? []).filter((t) => now - t < 3_600_000);
    if (d.attempts.length >= DOCTOR_MAX || starts.length >= DOCTOR_HOURLY) {
      d.gaveUp = true;
      this.healNote.set(tileId, { why, attempt: d.attempts.length, at: now, gaveUp: true });
      const pend = this.pending.get(tileId);
      if (pend) pend.failed = why;
      else this.pending.set(tileId, { kind: "title", id: hint.id, name: hint.name, at: hint.at, failed: why });
      return;
    }
    d.attempts.push(now);
    starts.push(now); this.titleStarts.set(hint.url, starts);
    d.healing = true; d.lostAt = 0; d.lastPos = null;
    this.healNote.set(tileId, { why, attempt: d.attempts.length, at: now });
    const url = hint.url, stage = d.wasStage;
    setTimeout(() => {
      d.healing = false;
      if (!this.host.tileExists(tileId) || this.hints.get(tileId)?.url !== url) return;
      this.pending.set(tileId, { kind: "title", id: hint.id, name: hint.name, at: Date.now() });
      if (stage) this.stageAsk.set(tileId, Date.now());   // it was on the stage when it failed: back on it once it plays
      void this.host.navigate(tileId, url);
    }, 2500);
  }

  /** Retry (2026-09-21): the person's second try after the page's error - the title's own address opened again, the pick and the stage asked afresh. */
  async retry(tileId: string): Promise<"ok" | "unavailable" | "unknown-tile"> {
    if (!this.host.tileExists(tileId)) return "unknown-tile";
    const hint = this.hints.get(tileId);
    if (!hint?.url) return "unavailable";
    this.errors.delete(tileId);
    this.host.arm(tileId);
    await this.host.claimAudio(tileId);
    this.pending.set(tileId, { kind: "title", id: hint.id, name: hint.name, at: Date.now() });
    this.hints.set(tileId, { ...hint, at: Date.now() });
    this.stageAsk.set(tileId, Date.now());
    await this.host.navigate(tileId, hint.url);
    return "ok";
  }
  /** Phase 2 (§2 row 5): the person's words entered into the service's own search, through the adapter's videoSearch script. */
  async search(tileId: string, q: string, open?: string | null): Promise<"ok" | "unavailable" | "unknown-tile"> {
    if (!this.host.tileExists(tileId)) return "unknown-tile";
    const spec = this.host.adapterOf(tileId);
    if (!spec?.videoSearch) return "unavailable";
    this.host.arm(tileId);
    if (open) { await this.host.claimAudio(tileId); this.pending.set(tileId, { kind: "title", id: open, name: open, at: Date.now() }); this.stageAsk.set(tileId, Date.now()); }
    await this.host.inject(tileId, `window.__prismVideoSearch && window.__prismVideoSearch(${JSON.stringify(q)}${open ? ", " + JSON.stringify(open) : ""})`);
    return "ok";
  }

  /**
   * Cross-service search (2026-09-19): a hidden search surface meets the service's profile gate. The household's standing
   * "always" choice for the App is applied there as it is on the screen; without one the surface can only report it.
   */
  /** The household as a page names it, kept and nothing more (the Who's watching page read in the background). */
  noteProfiles(appKey: string, info: NowPlaying | null): void { this.keepProfiles(appKey, info); }

  // ---- profile presets (2026-09-24, "if another user logs in, they can change the preset and therefore all service profiles, and see their
  // My & Continue items update"): a switch the PERSON asked for. Unlike a background read, which never changes whose account a service
  // watches as, a preset (or a profile picked in the Profiles window) is the ask to change it - the service's hidden page presses the profile.
  private readonly wantSwitch = new Map<string, { id: string; at: number }>();
  /** Each profile's last rows (Continue / My List / shelves), so a switch shows that person's rows at once while the fresh read runs. */
  private readonly rowsBy = new Map<string, Pick<VideoLibrary, "continue" | "list" | "shelves">>();
  /**
   * The person switches this App to profile `id`: the standing choice set (chooseProfile), the rows swapped to that profile's last known
   * (the previous profile's kept for next time), and the switch asked of the next hidden page that shows the gate or a switcher.
   */
  switchProfile(appKey: string, id: string): "ok" | "unknown-profile" | "same" {
    const before = this.choices.get(appKey)?.id ?? this.sessionProfile.get(appKey) ?? null;
    const session = this.sessionProfile.get(appKey) ?? null;
    const r = this.chooseProfile(appKey, id);
    if (r !== "ok") return r;
    // already on it (2026-09-24, "Why is it still switching my profile on disney" - one profile, a preset asked for it again): nothing to press,
    // nothing to hold
    if (before === id && (session === null || session === id)) return "same";
    this.wantSwitch.set(appKey, { id, at: Date.now() });
    // the service's windows on the wall still show the last person until they load a page again: their rows are not kept till then
    // (2026-09-24, "it switched brought Sam's in, switched, brought some of Alex's back, now I think it's working on Sam again")
    for (const tileId of this.contexts.keys()) if (this.appKey(tileId) === appKey) this.rowsHeld.add(tileId);
    if (before === id) return "ok";   // the choice was this one already, the session is someone else's: the switch still runs
    this.swapRows(appKey, before, id);
    return "ok";
  }
  private rowsKey(appKey: string, profileId: string): string | null { const dash = this.host.dashId(); return dash ? `video:rows-for:${dash}:${appKey}:${profileId}` : null; }
  private swapRows(appKey: string, from: string | null, to: string): void {
    const have = this.libraries.get(appKey);
    const store = this.host.store();
    if (from && have && ((have.continue?.length ?? 0) + (have.list?.length ?? 0) > 0)) {
      const rows = { continue: have.continue ?? [], list: have.list ?? [], shelves: have.shelves ?? [] };
      this.rowsBy.set(appKey + "|" + from, rows);
      const k = this.rowsKey(appKey, from);
      if (k && store) { try { void store.set(k, JSON.stringify(rows)); } catch { /* best effort */ } }
    }
    const put = (rows: Pick<VideoLibrary, "continue" | "list" | "shelves"> | null) => {
      const cur = this.libraries.get(appKey) ?? { continue: [], list: [], shelves: [] };
      const next: VideoLibrary = { ...cur, continue: rows?.continue ?? [], list: rows?.list ?? [], shelves: rows?.shelves ?? [] };
      this.libraries.set(appKey, next);
      this.persist(appKey, "library", next);
    };
    const mem = this.rowsBy.get(appKey + "|" + to);
    put(mem ?? null);   // never the other person's rows: that profile's last, or none until the read
    if (mem) return;
    const k = this.rowsKey(appKey, to);
    if (!k || !store) return;
    void (async () => {
      try {
        const raw = await store.get(k);
        if (!raw) return;
        const rows = cleanLibrary(JSON.parse(raw));
        const now = this.libraries.get(appKey);
        // only while no fresh read has come in since the switch
        if ((now?.continue?.length ?? 0) + (now?.list?.length ?? 0) === 0) { this.rowsBy.set(appKey + "|" + to, rows); put(rows); }
      } catch { /* none kept */ }
    })();
  }
  /**
   * A hidden page of an App with a switch asked: the gate or switcher that lists the wanted profile gets its press, once. Returns true
   * when the page is handled (pressed, or already on the profile). An others-only switcher that does not list the wanted profile is on it.
   */
  pressWantedProfile(surfaceId: string, appKey: string, info: NowPlaying | null): boolean {
    const want = this.wantSwitch.get(appKey);
    if (!want) return false;
    if (Date.now() - want.at > 10 * 60_000) { this.wantSwitch.delete(appKey); return false; }
    const prof = info?.videoProfiles && typeof info.videoProfiles === "object" && Array.isArray(info.videoProfiles.profiles) ? info.videoProfiles : null;
    if (!prof) return false;
    const known = this.known.get(appKey)?.find((p) => p.id === want.id);
    const listed = prof.profiles.find((p) => p.id === want.id);
    const onIt = !prof.gate && ((typeof prof.current === "string" && (prof.current === want.id || prof.current === (listed ?? known)?.name)) || (prof.othersOnly === true && !listed && !!known));
    if (onIt) { this.setSessionProfile(appKey, want.id); this.wantSwitch.delete(appKey); return true; }
    if (!listed) return false;
    const last = this.gatePicked.get(surfaceId) ?? 0;
    if (Date.now() - last < 15_000) return true;
    this.gatePicked.set(surfaceId, Date.now());
    this.setSessionProfile(appKey, want.id);
    this.wantSwitch.delete(appKey);
    this.pressedAt.set(appKey, Date.now());
    void this.host.inject(surfaceId, `window.__prismVideoProfile && window.__prismVideoProfile(${JSON.stringify(want.id)})`);
    return true;
  }
  /** The switch done by the service's own switch address (videoProfileSwitchUrl): the session is on it, nothing left to press. */
  switchedByAddress(appKey: string, id: string): void { this.setSessionProfile(appKey, id); this.wantSwitch.delete(appKey); this.pressedAt.set(appKey, Date.now()); }
  /** When this App's last switch was pressed (or its switch address opened): a hidden page's rows count again only once it has loaded since. */
  pressedSince(appKey: string): number { return this.pressedAt.get(appKey) ?? 0; }
  /**
   * A switched service's rows stand still (2026-09-24, "switching from Alex to Sam in the presets, the continue watching and my list were
   * combined for at least a couple minutes"): a hidden page read before its switch was pressed reported Alex's rows over Sam's. While the
   * switch waits for its press, and for PRESS_SETTLE_MS after it while the page reloads as the new person, no report changes the rows.
   */
  private readonly pressedAt = new Map<string, number>();
  static readonly PRESS_SETTLE_MS = 6000;
  rowsFrozen(appKey: string): boolean {
    const want = this.wantSwitch.get(appKey);
    return (!!want && Date.now() - want.at < 10 * 60_000) || Date.now() - (this.pressedAt.get(appKey) ?? 0) < VideoController.PRESS_SETTLE_MS;
  }
  /** Windows of a switched service whose reports are not kept until they load a page again (the new person's). */
  private readonly rowsHeld = new Set<string>();
  /** A window loaded a page: after a switch, it is the new person's. */
  tileNavigated(tileId: string): void { this.rowsHeld.delete(tileId); }
  /** The switch still waiting for a hidden page (the Profiles window says so). */
  switchPending(appKey: string): boolean { return this.wantSwitch.has(appKey); }
  /**
   * A hidden surface (search, list) met the service's gate: it is answered with the profile the session is already on, as
   * the wall knows it - the same account the screen watches as - so the background read goes on without changing anyone's
   * profile. Never the household's standing choice on its own: that is a press for a gate a person is looking at.
   */
  applyStandingProfile(surfaceId: string, appKey: string, info: NowPlaying | null): boolean {
    const prof = info?.videoProfiles && typeof info.videoProfiles === "object" && Array.isArray(info.videoProfiles.profiles) ? info.videoProfiles : null;
    this.keepProfiles(appKey, info);
    if (!prof?.gate) { this.gatePicked.delete(surfaceId); return false; }
    const on = this.sessionProfile.get(appKey);
    const last = this.gatePicked.get(surfaceId) ?? 0;
    if (!on || !prof.profiles.some((p) => p.id === on)) return false;
    if (Date.now() - last > 15_000) {
      this.gatePicked.set(surfaceId, Date.now());
      void this.host.inject(surfaceId, `window.__prismVideoProfile && window.__prismVideoProfile(${JSON.stringify(on)})`);
    }
    return true;
  }
  /** The App's standing choice, for a hidden surface's own read of the gate. */
  standingProfile(appKey: string): VideoProfileChoice | null { return this.choices.get(appKey) ?? null; }

  /** Phase 2 (video-menu-spec §3 tune): a human's press on a Live now card - the page's own guide item, through the adapter's videoTune. */
  async tune(tileId: string, channelId: string): Promise<"ok" | "unavailable" | "unknown-tile"> {
    if (!this.host.tileExists(tileId)) return "unknown-tile";
    const spec = this.host.adapterOf(tileId);
    if (!spec?.videoTune) return "unavailable";
    this.stageAsk.set(tileId, Date.now());
    this.host.arm(tileId);
    await this.host.claimAudio(tileId);
    await this.host.inject(tileId, `window.__prismVideoTune && window.__prismVideoTune(${JSON.stringify(channelId)})`);
    return "ok";
  }

  /** The page-side try of a transport verb through the adapter's videoCmd, as an expression that is true when the player took it. */
  cmdJs(spec: AdapterSpec | undefined, cmd: string): string | null {
    return spec?.videoCmd ? `(window.__prismVideoCmd&&window.__prismVideoCmd(${JSON.stringify(cmd)}))` : null;
  }

  private key(kind: "library" | "resume" | "recent" | "live" | "session-profile" | "removed" | "hidden", appKey: string): string | null {
    const dash = this.host.dashId();
    return dash ? `video:${kind}:${dash}:${appKey}` : null;
  }
  private persist(appKey: string, kind: "library" | "resume" | "recent" | "live" | "removed" | "hidden", value: unknown): void {
    const k = this.key(kind, appKey);
    const store = this.host.store();
    if (!k || !store) return;
    try { void store.set(k, JSON.stringify(value)); } catch { /* best effort */ }
  }
  private load(tileId: string): Promise<void> { return this.loadApp(this.appKey(tileId)); }
  private async loadApp(appKey: string): Promise<void> {
    const store = this.host.store();
    if (this.loaded.has(appKey) || !store || !this.host.dashId()) return;   // no wall yet: nothing to key by - ask again later
    this.loaded.add(appKey);
    this.loading++;
    try {
      const lk = this.key("library", appKey), rk = this.key("resume", appKey);
      if (lk && !this.libraries.has(appKey)) { const raw = await store.get(lk); if (raw) { const lib = cleanLibrary(JSON.parse(raw)); if (lib.continue.length || lib.list.length) this.libraries.set(appKey, lib); } }
      if (rk && !this.resumes.has(appKey)) { const raw = await store.get(rk); if (raw) { const p = JSON.parse(raw) as VideoResumePoint; if (p && typeof p.title === "string") this.resumes.set(appKey, p); } }
      const lv = this.key("live", appKey);
      if (lv && !this.live.has(appKey)) { const raw = await store.get(lv); if (raw) { const l = JSON.parse(raw); if (Array.isArray(l)) this.live.set(appKey, l.filter((c): c is VideoChannel => !!c && typeof c === "object" && typeof (c as VideoChannel).url === "string")); } }
      const hd = this.key("hidden", appKey);
      if (hd && !this.hiddenCont.has(appKey)) { const raw = await store.get(hd); if (raw) { const o = JSON.parse(raw) as Record<string, { at: number; progress: number | null }>; if (o && typeof o === "object") this.hiddenCont.set(appKey, new Map(Object.entries(o))); } }
      const rm = this.key("removed", appKey);
      if (rm && !this.removed.has(appKey)) { const raw = await store.get(rm); if (raw) { const o = JSON.parse(raw) as Record<string, { at: number; tries: number; item: VideoItem }>; if (o && typeof o === "object") this.removed.set(appKey, new Map(Object.entries(o).filter(([, r]) => r && typeof r.at === "number" && r.item && typeof r.item.id === "string").map(([id, r]) => [id, { at: r.at, tries: r.tries | 0, item: r.item, retrying: false }]))); } }
      const sp = this.key("session-profile", appKey);
      if (sp && !this.sessionProfile.has(appKey)) { const raw = await store.get(sp); if (raw) this.sessionProfile.set(appKey, raw); }
      const rc = this.key("recent", appKey);
      if (rc && !this.recents.has(appKey)) { const raw = await store.get(rc); if (raw) { const l = JSON.parse(raw); if (Array.isArray(l)) this.recents.set(appKey, l.filter((p): p is VideoResumePoint => !!p && typeof p.title === "string").slice(0, VIDEO_RECENT_MAX)); } }
      const dash = this.host.dashId();
      if (dash && !this.choices.has(appKey)) { const raw = await store.get(`video:profile:${dash}:${appKey}`); if (raw) { const c = JSON.parse(raw) as VideoProfileChoice; if (c && typeof c.id === "string") this.choices.set(appKey, c); } }
      if (dash && !this.known.has(appKey)) { const raw = await store.get(`video:profiles:${dash}:${appKey}`); if (raw) { const l = JSON.parse(raw); if (Array.isArray(l)) this.known.set(appKey, l.filter((p): p is { id: string; name: string; avatar: string | null } => !!p && typeof p.id === "string" && typeof p.name === "string").slice(0, 12)); } }
    } catch { /* unreadable: nothing kept */ } finally { this.loading--; }
  }
  /** Reads of the kept rows still in flight (2026-09-24: Watch waits for them at boot rather than drawing empty rows and then full ones). */
  private loading = 0;
  warming(): boolean { return this.loading > 0; }
}

/** Apple's image server hands out .webp, which Windows draws only with its WebP extension; the same address as .jpg is the JPEG (2026-09-23). */
export function jpegArt(u: string): string { return /^https:[/][/][a-z0-9-]+[.]mzstatic[.]com[/]/.test(u) ? u.replace(/[.]webp([?]|$)/, ".jpg$1") : u; }

/**
 * An episode entry named "<series> - <episode>" (2026-09-25, Disney+'s Continue Watching: "Star Wars: Maul \u2013 Shadow Lord - Chapter 7: Call to
 * Oblivion" was the card's whole title): the series is the card's title - what TMDB is asked, what folds with the same show elsewhere - and the
 * episode goes before the subtitle. Only an episode, only a spaced hyphen (a title's own en dash stays), both halves real words.
 */
export function splitEpisodeName<T extends { kind?: unknown; title: string; subtitle?: unknown }>(x: T): T {
  if (x.kind !== "episode") return x;
  const m = /^(.{2,}?)\s-\s(.{2,})$/.exec(x.title.trim());
  if (!m) return x;
  const sub = typeof x.subtitle === "string" && x.subtitle.trim() ? x.subtitle.trim() : "";
  return { ...x, title: m[1]!.trim(), subtitle: sub ? m[2]!.trim() + " \u00B7 " + sub : m[2]!.trim() };
}
export function cleanLibrary(raw: unknown): { continue: VideoItem[]; list: VideoItem[]; shelves: Array<{ title: string; items: VideoItem[] }>; owned: VideoItem[]; ownedComplete: boolean; continueOnly: boolean } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const clean = (l: unknown): VideoItem[] => Array.isArray(l)
    ? l.filter((x): x is VideoItem => !!x && typeof x === "object" && typeof (x as VideoItem).id === "string" && typeof (x as VideoItem).title === "string")
      .map(splitEpisodeName)
      .map((x) => ({ id: x.id, title: x.title, kind: typeof x.kind === "string" ? x.kind : "video", url: typeof x.url === "string" ? x.url : null, artwork: typeof x.artwork === "string" ? jpegArt(x.artwork) : null, subtitle: typeof x.subtitle === "string" ? x.subtitle : null, progress: typeof x.progress === "number" ? x.progress : null, ...(typeof x.badge === "string" && x.badge.trim() && !isAwardBadge(x.badge) ? { badge: x.badge.replace(/\s+/g, " ").trim().slice(0, 48), ...(x.badgeInArt === true ? { badgeInArt: true } : {}) } : {}) }))
    : [];
  const shelves = Array.isArray(r.shelves)
    ? r.shelves.filter((s): s is { title: string; items: unknown } => !!s && typeof s === "object" && typeof (s as { title?: unknown }).title === "string")
      .map((s) => ({ title: s.title, items: clean(s.items) })).filter((s) => s.items.length > 0).slice(0, 12)
    : [];
  // continueOnly (2026-09-23): a page that carries Continue Watching alone (Fandango's /content/browse/continuewatching) says nothing about the list
  return { continue: clean(r.continue), list: clean(r.list), shelves, owned: clean(r.owned).slice(0, 3000), ownedComplete: r.ownedComplete === true, continueOnly: r.continueOnly === true };
}
