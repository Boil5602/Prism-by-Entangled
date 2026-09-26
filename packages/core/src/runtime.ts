/**
 * Embedded-runtime entry for shells that host core in a JS runtime
 * (Android: a hidden WebView; see shells/android). Bundled standalone via
 * `npm run bundle` → dist/prism-runtime.js, shipped as a shell asset.
 *
 * Bridge protocol (v0):
 *  - Shell injects a `PrismBridge` host object before loading this bundle:
 *      dispatch(json)     — fire-and-forget driver command (ordered per surface)
 *      storeGet(key)      — synchronous read from the shell's §10-safe store
 *  - Core → shell commands are JSON: { op: "surface.create", ... } etc.
 *  - Shell → core calls go through `globalThis.PrismRuntime`:
 *      init(docJson, w, h) · resize(w, h) · event(json) · input(json) ·
 *      promoteHero(id) · setHeroSize(size, commit) · rects()
 *
 * The Kotlin side executes commands and decides nothing (§23).
 */

import { FRESH_EPISODES, FRESH_MOVIES } from "./fresh-rows.js";
import { KIDS_AGES, THE_BINGE, bingeDay, bingeGenreRows, bingeSettingsOf, bingeWords, selectBinge, type BingeThresholds, type KidsMode } from "./binge.js";
import { libraryForWorks, libraryHits, searchWorks, type LibraryEntry, type LibraryHit, type SearchRowIn } from "./search-view.js";
import { HUB_SORTS, hubSortOf, filterLookupRows, type HubSort } from "./hub-sort.js";
import { MOST_READ_CATALOG } from "./most-read.js";
import { BROWSE_GENRES, BROWSE_OFFERS, BROWSE_REGION, BROWSE_ROWS, browseGenre, browseOfferOf } from "./browse.js";
import { dedupeKey, newEpisodeBadge } from "./menu-order.js";
import { orderLookup } from "./video-lookup.js";
import type { VideoItem } from "./types.js";
import { normalizeTrackText } from "./music-lookup.js";
import { MV_MAX, Orchestrator, type DashboardBundle, type LayoutRequest, type TilePatch } from "./orchestrator.js";
import { customTile, pickerTile, validCatalogEntry, type PickerChoices } from "./catalog.js";
import { htmlIcons, manifestIcons, manifestUrl, markIcons, wordmark } from "./poster.js";
import { RemoteApi, type RemoteRequest } from "./remote.js";
import { PopupPolicy, popupHost, type PopupAttempt } from "./popups.js";
import type {
  Drivers,
  InputEvent,
  SurfaceCreateOptions,
  SurfaceEvent,
  SurfacePresence,
  VisualizationSurfaceOptions,
} from "./drivers.js";
import { isPrismRoute } from "./routes.js";
import { PrismModelEval } from "./model-eval.js";
import { SLOT_PURPOSES, type DashboardDocument, type NowPlaying } from "./types.js";
import { SceneModelStore } from "./scene-model-store.js";
import type { App, Facet, FloatingPlacement, Scene } from "./scene-model.js";
import { PLAYER_TEMPLATES, carryHiddenMusic, isPlayerKind, playerOfScene, playerScenes, type PlayerKind } from "./players.js";
import { NEWS_SHELF } from "./news-shelf.data.js";
import { applyTilesIntent, parseTilesIntent, readTilesDoc } from "./tiles-data.js";
import type { Rect } from "./solver.js";
import { decodeBase64Bytes } from "./visualization.js";

interface PrismBridgeHost {
  dispatch(json: string): void;
  storeGet(key: string): string | null;
}

declare global {
  // eslint-disable-next-line no-var
  var PrismBridge: PrismBridgeHost | undefined;
  // eslint-disable-next-line no-var
  var PrismRuntime: PrismRuntimeApi | undefined;
}

export interface PrismRuntimeApi {
  /** optionsJson: optional {"maxLiveTiles": n} device budget (§18). */
  init(docJson: string, w: number, h: number, optionsJson?: string): void;
  resize(w: number, h: number): void;
  event(json: string): void;
  input(json: string): void;
  promoteHero(tileId: string): void;
  setHeroSize(size: number, commit: boolean): void;
  refreshTile(tileId: string): void;
  /**
   * Remote API request (§6). Async: the response comes back over the bridge
   * as {op:"http.response", requestId, status, body, contentType}.
   */
  http(requestId: number, requestJson: string): void;
  /**
   * Mint a pairing token (§6). The QR payload comes back over the bridge as
   * {op:"remote.pairing", url, token}.
   */
  /**
   * `onlyIfUnpaired`: the boot-time call — a frame that already has phones
   * paired must not mint a token per boot (they accumulate) nor cover the
   * wall with a QR nobody asked for; it answers {op:"remote.paired-count", n}
   * instead. The menu's explicit "Pair a phone" always mints.
   */
  mintPairing(baseUrl: string, onlyIfUnpaired?: boolean): void;
  /** Switch to another dashboard of the bundle (the TV menu's layout picker). */
  switchTo(dashboardId: string): void;
  /** §31 host picker: add a catalog pick to the current dashboard (core runs pickerTile - the host never builds tiles). */
  addCatalogTile(entryJson: string, choicesJson: string, selectorTableJson: string | null): void;
  /** §8 arrange: remove a tile from the current dashboard (persisted). */
  removeTile(tileId: string): void;
  /** Maximize a tile to the full window / restore the solved layout. */
  toggleFullscreen(tileId: string): void;
  /** §31 poster resolution plan for a fetched page: candidates in normative order + the wordmark fallback. Sync JSON return. */
  posterPlan(name: string, baseUrl: string, html: string, manifestJson: string | null): string;
  /** A service's symbol at card size (2026-09-23): the page's own small icons, best first - JSON string {candidates:[{url,size}]}. */
  markPlan(baseUrl: string, html: string): string;
  /** JSON of current gap-free partition rects — conformance/debug hook. */
  rects(): string;
  /** Shell answers a request-lane op (see `request`). */
  resolve(requestId: number, resultJson: string | null, error: string | null): void;
  /** §14 stream auth: the shell's HTTP listener redeems a stream ticket (sync). Listener id or "". */
  redeemStreamTicket(ticket: string): string;
  /** Edit-mode menu on the device: current state as JSON (same shape as GET /state). */
  state(): string;
  /** Edit-mode menu: flip a both-ways tile between web player and native app. */
  setTileMode(tileId: string, mode: "web" | "native"): void;
  /** Edit: patch a tile's plain fields — {url?, zoom?|null, focus?|null} — persisted (§10); a url change reloads on the §16 path. */
  updateTile(tileId: string, patchJson: string): void;
  /** Edit: the wall's layout — {"mode":"hero",hero?,heroSize?} | {"mode":"solo"} | {"mode":"grid",cols,rows} (grid auto-flows areas). Persisted. */
  setLayout(layoutJson: string): void;
  /** §31 step 2 "any website": add a custom tile for a URL; choices {tileId?, profile?, zoom?}. */
  addCustomTile(url: string, choicesJson: string): void;
  /** Configure slot: this slot becomes the catalog pick (core runs pickerTile); it keeps its slot. */
  replaceWithCatalogTile(tileId: string, entryJson: string, choicesJson: string, selectorTableJson: string | null): void;
  /** Configure slot: this slot becomes a custom site tile for the URL; it keeps its slot. */
  replaceWithCustomTile(tileId: string, url: string): void;
  /** App layouts (named places on an app): save {label, url?, focus?|null, aspectHint?} for the tile's app - persisted. */
  saveShortcut(tileId: string, shortcutJson: string): void;
  removeShortcut(tileId: string, shortcutId: string): void;
  /** Go to a shortcut: its page and view become the tile's. */
  applyShortcut(tileId: string, shortcutId: string): void;
  /** §31 step 3 viewfinder: the slot pops out full screen (the page lays out at window width), unframed; the shell draws the box and previews zoom. */
  startFraming(tileId: string): void;
  /** End the viewfinder: resultJson {region:{x,y,w,h}, viewport:{w,h}} (CSS px of that layout) becomes the tile's focus (persisted); null cancels. */
  finishFraming(tileId: string, resultJson: string | null): void;
  /** §32 a HUMAN tap on the shell's player control (or any slot chrome): play | pause | next | prev | mute | unmute … - the §6 command path. */
  tileCommand(tileId: string, cmd: string): void;
  /**
   * concept-scenes §5 (normative): a HUMAN single tap on a scene item. The
   * placement's standing `tapAction` decides — `promote` (§6a, the default,
   * unchanged), `audio` (the sound moves here, no layout change) or `both`.
   * The shell never chooses: it reports the tap and core answers with
   * {op:"ui.tapResult", id, action, did, audio?, error?}.
   */
  tapItem(tileId: string): void;
  /** §33 master layouts (app-less slots): upsert {id?, label, mode, cols?, rows?, heroSize?, gap?, slots:[{id?, purpose, aspectHint?, kind?, float?, hero?}]} - persisted. */
  saveMasterLayout(layoutJson: string): void;
  removeMasterLayout(id: string): void;
  /** The wall becomes the master layout: apps fill its slots in order, the rest are empty slots; apps beyond the slots leave the wall (profiles kept). */
  applyMasterLayout(id: string): void;
  /** Sync: the rects a master layout solves to at w×h - JSON {rects, floats, unplaced}, or "null". The editor's preview IS the solver (§8). */
  previewLayout(layoutJson: string, w: number, h: number): string;
  /** Sync: §33 SLOT_PURPOSES as JSON - "what is this slot for?" and the shape each wants; the shell renders it, adds nothing. */
  slotPurposes(): string;
  /**
   * Sync §30: the shell asks before a page's window.open / target=_blank is honored.
   * `pageUrl` = the opener's current URL, `popupUrl` = the requested one,
   * `userInitiated` = the shell saw a gesture. JSON {action:"allow"|"intercept", reason}.
   * Interceptions land in the local ledger; nothing is ever opened silently.
   */
  popupDecision(pageUrl: string, popupUrl: string, userInitiated: boolean): string;
  /** §34 scenes: upsert {id?, label, layoutId, slots:{slotId: {app, view?} | null}} - persisted. */
  saveScene(sceneJson: string): void;
  removeScene(id: string): void;
  /** The wall becomes the scene: its layout's slots with the assigned app facets; unassigned slots stay empty. */
  applyScene(id: string): void;
  /** Sync §33: saved layouts a draft would duplicate at w×h - JSON [{id, label}]. Flagged, never refused. */
  similarLayouts(layoutJson: string, w: number, h: number): string;

  // ---- scene model (docs/scene-model-spec.md) - ADDITIVE; the calls above keep their semantics until the rename commit.
  /** Sync: every scene-model store as JSON {apps, facets, layouts, scenes, activeScene, slotClasses, migrated}. */
  modelState(): string;
  /** Sync: upsert an App (spec §2 shape) - JSON {ok, value, warnings} | {ok:false, error}. Persisted under scene-model:apps. */
  modelSaveApp(appJson: string): string;
  /** Sync: upsert a Facet (spec §4 shape; slotClass "16:9·XL") - JSON result. */
  modelSaveFacet(facetJson: string): string;
  /** Sync: remove an unreferenced facet - "ok" | "unknown" | "referenced". */
  modelRemoveFacet(facetId: string): string;
  /** Sync: upsert a Layout ({id?, name, canvasSize:{w,h}|canvas, slots:[{id, rect:{x,y,w,h} 0-1, class?, custom?}], source?}) - JSON result; `value.duplicates` FLAGS possible duplicates (IoU ≥ 0.85), never refuses. */
  modelSaveLayout(layoutJson: string): string;
  /** Sync: the duplicates a draft layout would be flagged with, without saving - JSON [{id, name, archived}]. */
  modelLayoutDuplicates(layoutJson: string): string;
  /** Sync: archive (hide from pickers) / unarchive a layout - "ok" | "unknown". Never deletes. */
  modelArchiveLayout(layoutId: string, archived: boolean): string;
  /** Sync: upsert a Scene (spec §5 shape + settings/visualizations) - JSON result; compatibility problems are warnings (placeholders render). */
  modelSaveScene(sceneJson: string): string;
  modelRemoveScene(sceneId: string): string;
  /** The wall becomes the scene (materialized as a fixed-rect document at the current canvas). Sync JSON {ok, notes} | {ok:false, error}; the apply itself runs on the §16 path. */
  modelApplyScene(sceneId: string): string;
  /** Sync JSON: the two players (players.ts) - {active: "music"|"video"|null, music: {id, name}|null, video: {id, name}|null}. */
  players(): string;
  /** VP-2 sync JSON: every video tile with its face (video.ts VideoTileState[]): what plays, Continue Watching / My List, the resume point, what it can do. */
  videoState(): string;
  /** VP-2 async JSON: a video tile's library {continue, list}, from the page's last report or the store. */
  videoLibrary(tileId: string): Promise<string>;
  /** VP-2: play a title on a video tile - the adapter's videoPlay, else the title's page (a human's tap). */
  videoPlay(tileId: string, kind: string, id: string, url: string | null, name: string | null): void;
  /** VP-3 sync JSON: the Video player's services - {scene, active, screen:{slot, facet, app}|null, services:[{app, name, facet, status, onScreen}]}. */
  videoServices(): string;
  /** VP-3 sync JSON: the Video player's screen becomes this service's facet (the scene's assignment saved, the wall re-applied) - {ok, sceneId, ...}. */
  videoSwitch(facetId: string): string;
  /** VP-3 sync JSON: play a title on a service, switching the screen to it first when another is up - {ok, switched}. */
  videoPlayOn(facetId: string, kind: string, id: string, url: string | null, name: string | null): string;
  /** VP-3: a human's pick on a service's profile gate; always = the household's standing choice for that App. */
  videoProfile(tileId: string, id: string, always: boolean): void;
  /** A human's pick of the service's own subtitle / audio track from the stage bar (adapter videoTracks). */
  videoTrack(tileId: string, kind: string, id: string): void;
  /** The slider: the service's own seek to that many seconds into the title; "ok" | "unavailable" | "ad" | "unknown-tile". */
  videoSeek(tileId: string, seconds: number): string;
  /** Sync JSON {ok, name}: the profile a service's App watches as, chosen plainly from the menu - stands until changed; applied to the gate wherever it shows (2026-09-19). */
  videoProfileChoose(appId: string, profileId: string): string;
  /** Sync JSON {ok}: the choice cleared - the service asks who is watching again. */
  videoProfileAsk(appId: string): string;
  /** Sync JSON (2026-09-24, the Profiles window): {services:[{app, name, status, profiles:[{id,name,avatar}], current:{id,name}|null, switching}], presets:[{id,name,picks:{app:{id,name}}}], active}. Only services with profiles. */
  videoProfilesView(): string;
  /** Sync JSON {ok, error?}: the person switches one service to a profile - chosen, its rows swapped, the service's page pressed, the rows read again. */
  videoProfileSet(appId: string, profileId: string): string;
  /** Sync JSON {ok, excluded}: a service excluded (on) or included for the person on now - its cards leave Watch's Continue watching and My list only (2026-09-24). */
  videoProfileExclude(appId: string, on: boolean): string;
  /** Sync JSON {ok, switched, preset}: the Profiles window's draft {picks:{app:profileId}, off:[app], preset?:id, name?:string} committed at once (2026-09-24). */
  videoProfilesCommit(draftJson: string): string;
  /** Sync JSON {ok, preset}: the services' current profiles saved as a preset under `name` (the same name replaces it). */
  videoPresetSave(name: string): string;
  /** Sync JSON {ok}: a preset deleted. */
  videoPresetDelete(presetId: string): string;
  /** Sync JSON {ok, switched:[app], missing:[app]}: every service in the preset switched to its profile at once. */
  videoPresetApply(presetId: string): string;
  /** Sync JSON {ok, removed}: a watch taken out of the local log (and the App's resume point / recents) by its id, address or title - the person's eraser. */
  videoForgetWatch(appId: string, what: string): string;
  /** Sync JSON {ok, asked:[app]}: every signed-in service's own list page read again on a hidden surface (the combined My list); force ignores the half-hour guard. */
  videoRefreshLists(force?: boolean): string;
  /** Sync JSON {ok, asked}: the services not read in the last ten minutes read again (Watch opened, 2026-09-24). */
  videoRefreshStale(): string;
  /** Sync JSON {app: {readAt, working}}: when each service's lists were last read, and whether its pages are being read now. */
  videoFreshness(): string;
  /** Sync JSON {pause:{on,from,to}, tmdbKey, background}: Watch settings (2026-09-24). */
  videoSettings(): string;
  /** Sync JSON (2026-09-24): {services:[{app,name,status,working,lists:{at}|null,owned:{at}|null,profiles:{at,page}|null}], feeds:[{id,name,source,every,at,done,count}], ratings:{key,pending}, schedule:{last,listsAt,everyMs,ownedAt,ownedEveryMs,pause,paused}}. */
  videoUpdatesStatus(): string;
  /** Sync JSON {ok}: one service's pages read again now. */
  videoRefreshApp(appId: string): string;
  /** Sync JSON {ok, pause}: the timed refresh's quiet hours (off by default); HH:MM local. */
  videoSetPause(on: boolean, from: string, to: string): string;
  /** §4a lenses. Sync JSON {ok, active}: the lens over the menu's rows, or null for none (the default). Not persisted: every boot starts with none. */
  lensChoose(lensId: string | null): string;
  /** Sync JSON {ok, set}: the person's own TMDB key kept on the device (lens:tmdb:key:<dash>); null clears it and every TMDB number. */
  lensSetTmdbKey(key: string | null): string;
  /** Sync JSON {rating, links, facts}: a card's rating disclosure (what / who / decides, the source, the date) and outbound links - navigation only. */
  lensDisclosure(title: string): string;
  /** Sync "true" | "false": whether a TMDB key is set (the household's own, or the product's). */
  lensHasKey(): string;
  /** Sync JSON: what the lens resolver is doing right now (pending, in flight, queued, the last read asked) - a diagnostic. */
  lensDiag(): string;
  /** Sync JSON {ready, next:{season, episode, name, still, airDate, overview}|null, series}: the next episode of the series a video tile plays, as TMDB knows it (a key); ready false while it is being read. */
  videoNextEpisode(tileId: string): string;
  /** Sync JSON {ok, on, target, max, windows:[{index, tile, app, name, title, playing}]}: multiview - on | off | swap | focus <tile> | target <0..3> | state (2026-09-23). */
  videoMultiview(action: string, arg?: string | null): string;
  /** Sync JSON EpisodesView: every season and episode of the series on the Video player's screen, which one plays, and whether a pick can play (2026-09-22). */
  videoEpisodes(): string;
  /** Sync JSON {title, art}: the picture of what plays on a video tile, from the service's own pages - the wall shot's stand-in for a protected frame (2026-09-23). */
  videoArtOf(tileId: string): string;
  /** Sync JSON {ok, error?}: play an episode the service itself listed for the series on the screen - its own id, through the play path (2026-09-22). */
  videoPlayEpisode(episodeId: string): string;
  /** Sync JSON {ok, did: "start" | "previous", season?, episode?}: the big screen's back-to-start button: back to the start, or within its first seconds the previous episode. */
  videoStartOver(): string;
  /** Sync JSON {ok, did: "nudged" | "reopened"}: the big screen's sound and picture brought back together - pause and play, or pressed again within 10 s, the title opened again at its place. */
  videoResync(): string;
  /** Sync JSON {now, rowsCache, menuReady, lists:{app: ms}}: startup milestones in ms since this runtime began, null until reached. */
  bootTimings(): string;
  /** Sync JSON EpisodesView: a series' episodes on a service, for its Details page (poll until ready); itemId/season/episode = what Continue watching knows. */
  titleEpisodes(appId: string, series: string, itemId: string | null, season: number | null, episode: number | null): string;
  /** Sync JSON {ok, resolving?}: one episode of a series played on that service - by the service's own episode address, else its search. */
  titleEpisodePlay(appId: string, series: string, season: number, episode: number): string;
  /** Dev: every kept episode list measured against TMDB (started; read with videoEpisodeHealthResult). */
  videoEpisodeHealth(): string;
  videoEpisodeHealthResult(): string;
  /** Dev: forget one kept episode list. */
  videoEpisodesForget(appId: string, series: string): string;
  /** Sync JSON {state: "yes"|"no"|"checking"|"n/a", app, name}: whether the service that also carries a service's titles has this one (Hulu's in the Disney+ app), checked in the background on its own search and kept a week. */
  titleAlsoOn(kind: string, id: number, title: string, viaApp: string): string;
  /** The details card (2026-09-23): {status: working | ready | none, details?, why?} - ask again until it is not working. */
  titleDetails(title: string, kind: string | null, app: string | null): string;
  /** A work's details by TMDB id (a person's credit): the same shape as titleDetails. */
  titleDetailsById(kind: string, id: number): string;
  /** A person's page (2026-09-23): {status, person?: {id, name, photo, known, born, bio, credits:[{kind, id, title, date, year, poster, backdrop, role}]}}. */
  personPage(id: number): string;
  /** Play the screen's series' episode by number on the service's own control (adapter videoEpisodeNumber): {ok} | {ok:false, error}. */
  videoPlayEpisodeNumber(season: number, episode: number): string;
  /** Sync JSON {can, warning}: whether a service's Continue Watching cards can be removed on the service, and what to warn first (2026-09-22). */
  /** Dev: hold an App's hidden work page at an address (null releases it). */
  devHoldPage(appId: string, url: string | null, height?: number): string;
  videoRemoveInfo(appId: string): string;
  /** Sync JSON {status: working|done|failed, error?}: remove a title from the service's own Continue Watching - starts the job, or reports it (2026-09-22). */
  videoRemoveContinue(appId: string, itemId: string, title: string): string;
  /** Hide a title from the wall's Continue Watching when its service's site cannot remove it (2026-09-23): the service still lists it. */
  videoHideContinue(appId: string, itemId: string): string;
  /** Sync JSON {can}: whether the App's service can add to and take off its own My List from the wall (2026-09-23). */
  videoListInfo(appId: string): string;
  /** Sync JSON {status, error?}: start (or poll) one My List change on the service itself - want "add" | "remove"; catalog "1" finds the
   *  service's own copy of a catalog title first (the catalog play's resolve). Poll with the same arguments until done or failed. */
  videoListSet(appId: string, want: string, itemId: string, title: string, url: string | null, kind: string | null, catalog: string | null): string;
  /** Sync JSON {ok, paused}: call off a pick that has not played yet - queued plays dropped, pending picks cleared, a screen that began paused (2026-09-22). */
  videoCancelPick(): string;
  /**
   * Phase 2 sync JSON: the universal video menu (docs/video-menu-spec.md §2) - {continue: MenuCard[], list: MenuCard[],
   * live: [{app, name, facet, channels}], services: [...videoServices], search: [{app, name, facet, hasSearch}],
   * suggestions: [{app, name, facet, shelves}], log: n, now}. Ordered by §4 through menu-order.ts alone.
   */
  videoMenu(): string;
  /** Phase 2 (§2 row 5): open a service's own search page with the words in place, the screen switched to it first when needed - {ok, switched}. */
  videoSearch(facetId: string, q: string, open?: string | null): string;
  /** Sync JSON: cross-service search started - {ok, q, token, done, services:[{app,name,facet,status,candidates}]}; every signed-in service asked at once on hidden surfaces (§2 row 5). */
  videoLookup(q: string): string;
  /** A person's work on the household's services (TMDB combined credits, under the key): the same state as a search, `person` set. */
  videoLookupPerson(id: number, name: string): string;
  /** Dev: the automatic removal retries, newest last. */
  listRetries(): string;
  /** Dev: what the background refresh last did, and when the lists and owned libraries were read. */
  backgroundState(): string;
  /** Sync JSON: the cross-service search as it stands (poll until done) - the same shape, or null. */
  videoLookupState(): string;
  /** Sync JSON: Browse by genre (2026-09-22) - {tmdbKey, region, genre, genreName, done, genres:[{id,name,count}], rows:[{id,name,formula,source,counted,who,decides,sourceUrl,dataDate,cards}]}; genre null = the one last chosen. */
  videoBrowse(genre?: string | null, offer?: string | null): string;
  /** Sync JSON {ok, resolving}: a Browse card plays on the named service through the service's own search (the catalog press). */
  videoBrowsePlay(appId: string, cardId: string): string;
  /** Sync JSON: The Binge in full (docs/features/the-binge.md) - {ok, head, kids, ages, caveat, genres:[{genre, cards}], reading, tmdbKey}. */
  videoBingeView(): string;
  /** Sync JSON {ok, thresholds, kids, animation}: The Binge's thresholds, kids mode and Include animation, kept on the device; null keeps a part as it is. */
  videoBingeSet(thresholdsJson: string | null, kidsJson: string | null, animation?: boolean | null): string;
  /** Sync JSON {ok}: a Binge title hidden (on) or shown again (off) on this device. */
  videoBingeHide(cardId: string, on: boolean, title?: string | null): string;
  /** Sync JSON {items:[{id, title, why, service, at, until}]}: The Binge's hidden titles on this device, newest first (Watch settings, 2026-09-24). */
  videoBingeHidden(): string;
  /** Sync JSON {ok, resolving}: a Binge card plays on that service; on a miss, the service's own search, and the card noted missing locally. */
  videoBingePlay(appId: string, cardId: string): string;
  /** Sync JSON: one Browse row in full - {ok, ...the row's head, cards, total, done, more}; Yours is every household title in the genre, a catalog row is read deeper (2026-09-22). */
  videoBrowseRow(genre: string | null, row: string, offer?: string | null, want?: number | null): string;
  /** Sync JSON {rows:[{genre, cards}], pending, rated, total, twice, services, tmdbKey}: the Library tab - what the person owns across services, one card per title, rated, by TMDB genre. */
  /** group: "genre" (a row per genre, the default) or "none" (every title in one list, 2026-09-23). */
  videoLibraryTab(sort?: string | null, group?: string | null): string;
  /** Sync JSON: the cross-service search as it stands under a filter - the lookup state with `rows` filtered by genre (as TMDB names it) and / or service (App id), and the `genres` / `services` chips the unfiltered rows offer (2026-09-22). */
  videoLookupView(genre?: string | null, app?: string | null): string;
  /** Sync JSON: a result of the cross-service search plays on its service - {ok, switched}: its own address, else the service's search with the result pressed. */
  videoPlayResult(appId: string, candidateJson: string): string;
  /** Phase 2 (§2 row 3, §3 tune): tune a live channel - the guide item pressed in the service's own page, the screen switched to the service and its guide first when needed - {ok, switched}. */
  videoTune(facetId: string, channelId: string, url: string | null, name: string | null): string;
  videoForgetProfile(tileId: string): void;
  /** Sync JSON: the wall becomes the household's Music or Video player - {ok, kind, sceneId, notes} | {ok:false, reason:"no-scene", template} | {ok:false, error}. The Video player carries the Music player's hidden sources; the way back resumes what was playing. */
  switchPlayer(kind: string): string;
  /** Sync: the shipped scene templates (slot ROLES, never apps) as JSON. */
  modelTemplates(): string;
  /** Sync: complete a template - resolvedJson {roleId: facetId}; refused while any role is unresolved. JSON result with the Layout + Scene created. */
  modelInstantiateTemplate(templateId: string, resolvedJson: string, name: string | null): string;
  /**
   * Sync, one-shot, explicit (spec §7): migrate the pre-scene-model store. `storeJson` is the host's whole
   * key→value map (or the store file object); core writes ONLY new scene-model:* keys and returns the
   * review report as JSON {status, report}. Refuses to run twice unless `force`. Source keys are never touched.
   */
  modelMigrate(storeJson: string, force: boolean): string;
  /** Sync §31: the derived news shelf (Perennial Sources "generally reliable", attributed) as JSON. */
  newsShelf(): string;

  // ---- §32 music + §6a parity (SM-4)
  /** Sync: {sources, reveal, feeds} - Media Session state of the scene's hidden music facets, the transient reveal, the visualization feeds. */
  musicState(): string;
  /** §32 reveal: a hidden music facet (or a visualization → its source) as a transient overlay, "panel" | "hero" | "window", via surface.setPresence. */
  revealMusic(id: string, mode: string): void;
  /** §32 collapse the revealed player back to hidden; audio never interrupted. */
  collapseMusic(): void;
  /** §32 swap a visualization's style pack (and optionally artwork mode) in place - only that surface is rebuilt; audio untouched. */
  restyleVisualization(tileId: string, style: string, artwork: string | null): void;
  /** Quick play: JSON of the last few collections this music tile played from (most recent first). Sync from core's cache; a read refreshes it for the next open. */
  musicRecent(tileId: string): string;
  /** Quick play: go to one of those collections and press the page's Play. */
  playRecent(tileId: string, url: string): void;
  /** Quick play: JSON {playlists, stations} of the service's library as the page reported it (sync from core's cache). */
  musicLibrary(tileId: string): string;
  /** Quick play: queue a listed collection by id through the adapter's musicPlay script and play it - in the order asked (normal | shuffle | true-shuffle | reverse; spec 32 layer 5). */
  playCollection(tileId: string, kind: string, id: string, order?: string): void;
  /** Read this collection's track list ahead of any order (the order menu opening), so a true shuffle or reverse picked next starts at once. */
  musicPrepareOrder(tileId: string, kind: string, id: string): void;
  /** The standing repeat switch beside the order (2026-09-18): on, the list plays again when it ends - the service's own repeat for its orders, Prism's next pass (a fresh draw for true shuffle) for its own. */
  musicRepeat(tileId: string, on: boolean): void;
  /** B-205: switch the wall to this music service - the stage follows it and it plays on: what it holds, else what it last played. */
  resumeService(tileId: string): void;
  /** Quick play cross-service lookup (2026-09-16): ask this service's page whether it has the song playing now (async; read musicLookupState). */
  musicLookup(tileId: string): void;
  /** Sync JSON (orchestrator MusicLookupState + playlists): status, the song, the match, the candidates, the playlists the service may add to, the last add / station action. */
  musicLookupState(tileId: string): string;
  /** An ambiguous lookup: the person names the candidate that is the song. */
  musicLookupPick(tileId: string, songId: string): void;
  /** Add the found song to one of the service's own playlists (ids the page itself listed / returned). */
  musicAddToPlaylist(tileId: string, playlistId: string, songId: string): void;
  /** Start the service's station seeded from the found song; the stage follows it. */
  musicStationFromSong(tileId: string, songId: string): void;
  /** B-124 recovery: destroy and recreate the App's wall surfaces (by profile) after App setup closes - a stranded engine starts over. */
  recycleApp(profile: string): void;
  /** Multi-service lounge: the scene's hidden music sources as JSON [{tile, app, name, session, active}] (sync) - the quick-play menu groups by these. */
  musicSources(): string;
  /** §26 ambient audio: the soundscape for every music source's breaks (a recording id from docs/soundscape-credits.md; the older synthesized ids still map), or null for silence. */
  setIntermissionAmbient(sound: string | null): void;
  /** The shell declares the style packs it loaded as {styleId: ["#RRGGBB", …]} so CORE does the §32 backdrop tint. Sync: how many were accepted. */
  registerStylePalettes(json: string): string;
  /** The shell sampled a hidden facet's artwork (base64 RGBA bytes of a small decode); core derives the dominant colours and re-pushes the tinted feeds. */
  noteArtworkColors(facet: string, url: string, pixelsBase64: string): void;
  /** §9 carousel over scenes: the next (1) / previous (-1) scene of the model becomes the wall. */
  sceneStep(direction: number): void;
  /** The shell reports a prism:// route it opened (from its own UI); core records nothing but the flight recorder sees one shape everywhere. */
  uiRoute(route: string, source: string): void;

  // ---- editors' model evaluation (B-40): sync JSON, identical to PrismModelEval.* (model-eval.ts) - the stub retires itself
  modelClassifyLayout(layoutJson: string): string;
  modelNearestBucket(ratio: number): string;
  modelRepresentativeRect(slotClass: string, w: number, h: number): string;
  modelClassRatio(slotClass: string): string;
  modelFacetPresets(entryJson: string, slotClass: string): string;
  modelPresetFacet(entryJson: string, presetId: string, appId: string, slotClass: string, selectorTableJson: string | null, facetId: string | null): string;
  modelLoginRedirect(url: string, loginPrefix: string | null, baseUrl: string | null): string;
  /** Page JS for an adapter's session probe (selectors as JSON literals; either may be null). */
  modelSessionProbeJs(signedIn: string | null, signedOut: string | null): string;
  /** JSON of "signed-in" | "needs-attention" | null from the probe's raw ExecuteScript result. */
  modelSessionVerdict(resultJson: string | null): string;
  modelFacetPickerJs(): string;
  modelFacetPickPollJs(): string;
  modelFacetPickStopJs(): string;
  /** Aliases of modelFacetPickPollJs / modelFacetPickStopJs. */
  modelPickPollJs(): string;
  modelPickStopJs(): string;
  modelSelectorRectJs(selector: string): string;

  // ---- first-party micro-facets (docs/concept-scenes.md §6): the shell's tiles.* pages
  /**
   * Sync: the stored micro-facet document for `key` ("tiles:chores" |
   * "tiles:timer"), normalized, as JSON — "null" for any other key. The page
   * reads its own state through the shell; core owns the shape.
   */
  /** §14 chips as JSON: [{id, label, slot, transport, state}] — pairing tokens never leave core. */
  listeningChips(): string;
  tilesGet(key: string): string;
  /**
   * Sync: apply ONE human edit (`intentJson`, see tiles-data.ts TilesIntent)
   * and persist the result through the Store driver (§10). JSON
   * {ok, doc, changed} | {ok:false, error}. The page's tap and the phone's
   * §6 request are the same edit path; nothing here runs on a timer.
   */
  tilesApply(key: string, intentJson: string): string;

  // ---- App preview / setup surfaces (B-41)
  /** Sync: open a full-window surface in the App's profile OUTSIDE the wall (kind "preview", engine-covered); returns its surface id, "" for an unknown App. `url` null = the App's home. */
  modelOpenAppSurface(appId: string, url: string | null): string;
  /** Sync: destroy a preview surface - "ok" | "unknown". */
  modelCloseAppSurface(surfaceId: string): string;
}

function bridge(): PrismBridgeHost {
  const b = globalThis.PrismBridge;
  if (!b) throw new Error("PrismBridge host object missing — shell must inject it before the runtime bundle");
  return b;
}

function send(op: string, payload: Record<string, unknown>): void {
  bridge().dispatch(JSON.stringify({ op, ...payload }));
}

/**
 * Request/response lane for the few driver calls that return a value
 * (veil imagery, update manifest/apply, VPN status). Core sends
 * `{op, requestId, ...}`; the shell answers with
 * `PrismRuntime.resolve(requestId, resultJson, error)`. A shell that never
 * answers gets a timeout, so an unimplemented op degrades to "unsupported"
 * rather than a hung frame.
 */
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let nextRequestId = 1;
const REQUEST_TIMEOUT_MS = 30_000;

function request<T>(op: string, payload: Record<string, unknown>): Promise<T> {
  const requestId = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`${op}: no response from shell`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });
    send(op, { requestId, ...payload });
  });
}

function resolveRequest(requestId: number, resultJson: string | null, error: string | null): void {
  const p = pending.get(requestId);
  if (!p) return;
  pending.delete(requestId);
  clearTimeout(p.timer);
  if (error) return p.reject(new Error(error));
  try {
    p.resolve(resultJson === null ? null : JSON.parse(resultJson));
  } catch (e) {
    p.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

/** §14 capability declared by the shell at init (`audio` option). */
const bridgeAudio: { transports: Array<"webrtc" | "http">; streamPath: string | null } = {
  transports: [],
  streamPath: null,
};

export function createBridgeDrivers(): Drivers {
  return {
    surface: {
      create: (opts: SurfaceCreateOptions) => send("surface.create", { ...opts, placeholder: !!opts.placeholder }),
      destroy: (id: string) => send("surface.destroy", { id }),
      setRect: (id: string, rect: Rect) => send("surface.setRect", { id, rect }),
      setOpacity: (id: string, opacity: number) => send("surface.setOpacity", { id, opacity }),
      setZ: (id: string, z: number) => send("surface.setZ", { id, z }),
      setVisible: (id: string, visible: boolean) => send("surface.setVisible", { id, visible }),
      goBack: (id: string) => request<boolean | string | null>("surface.goBack", { id }).then((r) => r === true || r === "true").catch(() => false),
      navigate: (id: string, url: string) => send("surface.navigate", { id, url }),
      inject: (id: string, css: string | null, js: string | null) =>
        send("surface.inject", { id, css, js }),
      freeze: (id: string) => send("surface.freeze", { id }),
      reveal: (id: string, durationMs: number) => send("surface.reveal", { id, durationMs }),
      suspend: (id: string) => send("surface.suspend", { id }),
      resume: (id: string) => send("surface.resume", { id }),
      // §25: brackets one peek — the shell keeps the still up until readiness and never lets an
      // aborted peek's freeze replace it (no white frames, §16).
      setPeek: (id: string, peeking: boolean) => send("surface.setPeek", { id, peeking }),
      showIntermission: (id: string, source: string) =>
        send("surface.showIntermission", { id, source }),
      hideIntermission: (id: string) => send("surface.hideIntermission", { id }),
      setIntermissionSkip: (id: string, available: boolean, target?: string) =>
        send("surface.setIntermissionSkip", { id, available, target: target ?? null }),
      setAdInfo: (id: string, count: string, remaining: number) =>
        send("surface.setAdInfo", { id, count, remaining }),
      setMuted: (id: string, muted: boolean) => send("surface.setMuted", { id, muted }),
      hover: (id: string, x: number, y: number) => send("surface.hover", { id, x, y }),
      scrub: (id: string, x: number, y: number, press = true) => send("surface.scrub", { id, x, y, press }),
      setViewport: (id: string, w: number, h: number) => send("surface.setViewport", { id, w, h }),
      setNowPlaying: (id: string, info: NowPlaying | null) => send("surface.setNowPlaying", { id, json: JSON.stringify(info) }),
      setChrome: (id: string, kind: "slot" | "floating", face: "control" | "page", hidden?: boolean) => send("surface.setChrome", { id, kind, face, hidden: !!hidden }),
      setFocused: (id: string, focused: boolean) => send("surface.setFocused", { id, focused }),
      setPageInput: (id: string, active: boolean) => send("surface.setPageInput", { id, active }),
      sendKey: (id: string, key: string) => send("surface.sendKey", { id, key }),
      typeText: (id: string, text: string) => send("surface.typeText", { id, text }),
      evaluate: (id: string, js: string) => request<string | null>("surface.evaluate", { id, js }).catch(() => null),
      // §27: locally-served veil imagery for a source; [] when the shell has none.
      veilImagery: (source: string) =>
        request<string[]>("surface.veilImagery", { source }).catch(() => []),
      // §14: one capture mix; the shell owns the platform capture.
      captureAudio: (enable: boolean) => send("surface.captureAudio", { enable }),
      // §32 visualization surfaces + reveal/collapse presence (the FFT stays inside the shell)
      createVisualization: (opts: VisualizationSurfaceOptions) => send("surface.createVisualization", { ...opts }),
      setVisualizationFeed: (id: string, feedJson: string) => send("surface.setVisualizationFeed", { id, json: feedJson }),
      setPresence: (id: string, presence: SurfacePresence, rect: Rect, durationMs: number) => send("surface.setPresence", { id, presence, rect, durationMs }),
    },
    ui: {
      // §6a deep links: the shell's router opens the route; core forwards only prism:// strings
      route: (route: string, source: string, id?: string) => { if (isPrismRoute(route)) send("ui.route", { route, source, id: id ?? null }); },
      // concept-scenes §5: the verdict of one tap, back to whoever is showing state (pill, phone).
      tapResult: (id: string, r: import("./drivers.js").TapOutcome) =>
        send("ui.tapResult", { id, action: r.action, did: r.did, audio: r.audio ?? null, error: r.error ?? null }),
    },
    display: {
      setBrightness: (value: number) => send("display.setBrightness", { value }),
      setPower: (state: "sleep" | "wake") => send("display.setPower", { state }),
    },
    media: {
      launch: (pkg: string, deepLink?: string) =>
        send("media.launch", { package: pkg, deepLink: deepLink ?? null }),
      setSpeakers: (mode: "normal" | "mute" | "duck") => send("media.setSpeakers", { mode }),
      listApps: () => request<import("./drivers.js").AppInfo[]>("media.listApps", {}).catch(() => []),
      appSkip: (pkg, target) => request<boolean>("media.appSkip", { package: pkg, target }).catch(() => false),
      appType: (pkg, text) => request<boolean>("media.appType", { package: pkg, text }).catch(() => false),
      appBack: (pkg) => request<boolean>("media.appBack", { package: pkg }).catch(() => false),
      // §14: capability comes from init options (`audio`); serving is fire-and-forget.
      audioTransports: () => bridgeAudio.transports,
      serveAudio: (transport, enable) => send("media.serveAudio", { transport, enable }),
      audioStreamPath: () => bridgeAudio.streamPath ?? "/audio/stream",
      webrtcOffer: (listener, offerSdp) => request<string>("media.webrtcOffer", { listener, offerSdp }),
      webrtcIce: (listener, candidate) => send("media.webrtcIce", { listener, candidate }),
      webrtcClose: (listener) => send("media.webrtcClose", { listener }),
    },
    input: {
      startPairing: () => send("input.startPairing", {}),
      listRemotes: () =>
        request<import("./drivers.js").RemoteDeviceInfo[]>("input.listRemotes", {}).catch(() => []),
    },
    update: {
      fetchManifest: (url: string) => request<string>("update.fetchManifest", { url }),
      apply: (release) =>
        request<"applied" | "staged" | "failed">("update.apply", { release }).catch(
          () => "failed" as const,
        ),
    },
    store: {
      get: (key: string) => bridge().storeGet(key),
      set: (key: string, value: string) => send("store.set", { key, value }),
    },
    alarm: {
      setTone: (playing: boolean) => send("alarm.setTone", { playing }),
    },
    net: {
      submitCompatReport: (reportJson: string) =>
        send("net.submitCompatReport", { report: reportJson }),
      // §5 list sync: exactly this URL, nothing appended.
      fetchStatic: (url: string) => request<string>("net.fetchStatic", { url }),
      // §4a: the person's own keyed call (their TMDB key), headers as core built them
      fetchKeyed: (url: string, headers: Record<string, string>) => request<string>("net.fetchKeyed", { url, headers: JSON.stringify(headers) }),
      applyBlockHosts: (sourceId: string, name: string, hosts: string[]) =>
        send("net.applyBlockHosts", { sourceId, name, hosts }),
    },
  };
}

export function createRuntime(drivers: Drivers = createBridgeDrivers()): PrismRuntimeApi {
  const orchestrator = new Orchestrator(drivers);
  const remote = new RemoteApi(orchestrator, drivers.store);
  // §30 popup doctrine for the host: the same policy the extension runs (functional
  // sign-in / payment popups, click consistency, same-site, the local allow-list + ledger)
  // §14 chip labels: token -> the paired device's human name. The host call is
  // SYNC (ExecuteScript) while reading pairing is async, so the map is cached
  // here and refreshed after each read. A first call before the store answers
  // renders the neutral fallback rather than a wrong name or a blank wall -
  // `listeningChips` is written for exactly that case.
  let listenerNames: Record<string, string> = {};
  const refreshListenerNames = () => {
    void remote.listenerNames().then((n) => { listenerNames = n; }).catch(() => { /* fallback labels stand */ });
  };
  refreshListenerNames();

  const popups = new PopupPolicy(drivers.store ?? null);
  void popups.load().catch(() => { /* defaults stand (§10 posture) */ });
  const report = (e: unknown) => send("runtime.error", { message: String(e) });
  // §6: first use of a fresh token ⇒ paired ⇒ the shell takes the QR down.
  remote.onPaired = (token) => send("remote.paired", { token });
  // scene model stores (additive; the old stores stay untouched until the rename commit)
  let migrationInput: Record<string, string> | null = null;
  const model = new SceneModelStore(drivers.store ?? null, { readAll: () => migrationInput ?? {} });
  const modelLoaded = model.load().catch(report);
  const json = (v: unknown): string => JSON.stringify(v);
  /**
   * §6 micro-facets: a SYNCHRONOUS store read. The win-host bridge answers
   * storeGet from the snapshot it mirrors on every store.set (brain.html), so
   * the page's read and the phone's write see the same document. A shell whose
   * store is async returns a promise here; the page then starts from an empty
   * document rather than blocking, and the write path still persists.
   */
  const tilesRead = (key: string): string | null => {
    try {
      const v = drivers.store?.get(key);
      return typeof v === "string" ? v : null;
    } catch { return null; }
  };

  // the wall becomes a scene (schedules, carousel, the remote, the rail all come through here)
  const applyScene = (sceneId: string, after?: () => void): { ok: boolean; notes?: string[]; error?: string } => {
    const st = orchestrator.getState();
    if (!st) return { ok: false, error: "no dashboard loaded" };
    const m = model.materialize(sceneId, orchestrator.canvasSize(), st.dashboard);
    if (!m) return { ok: false, error: "unknown scene or layout " + sceneId };
    model.setActiveScene(sceneId);
    orchestrator.applyModelDocument(m.doc).then((r) => {
      if (r !== "ok") report(new Error("modelApplyScene: " + r));
      else if (after) { try { after(); } catch (e) { report(e); } }
      try { videoServices(); } catch { /* no video services yet */ }   // the kept rows warmed for the menu
    }, report);
    return { ok: true, notes: m.notes };
  };
  // The two players (players.ts, 2026-09-19): the household's Music Lounge and its Movie Night, switched from the
  // Prism menu. The Video player carries the lounge's hidden sources so the switch keeps them warm; the way back
  // resumes the source that was playing when the wall left the Music player, if a video has since paused it.
  const playersNow = () => {
    const snap = model.snapshot();
    return playerScenes(snap.scenes, (id) => model.layout(id), (id) => model.facet(id), snap.activeScene);
  };
  let playerReturn: string | null = null;
  const players = (): { active: PlayerKind | null; music: { id: string; name: string } | null; video: { id: string; name: string } | null } => {
    const found = playersNow();
    const active = model.activeScene();
    const scene = active ? model.scene(active) : undefined;
    const brief = (s: Scene | null) => (s ? { id: s.id, name: s.name } : null);
    return { active: scene ? playerOfScene(scene, model.layout(scene.layout), (id) => model.facet(id)) : null, music: brief(found.music), video: brief(found.video) };
  };
  // VP-3 (2026-09-19): the Video player as a UNIVERSAL player - "our movie player would seemingly play from any service,
  // LIKE THE MUSIC PLAYER". Its services are the household's video facets (audio exclusive, not music), one App each; the
  // screen slot holds the one up now; a switch re-assigns the slot and re-applies the scene; a Quick play on another
  // service switches first and asks for the title once the page is up (orchestrator.videoPlayWhenUp).
  const isVideoFacet = (f: Facet, apps: readonly App[]): boolean => !f.music && (f.audio === "exclusive" || apps.find((a) => a.id === f.app)?.render?.audio === "exclusive");
  const videoServices = () => {
    const snap = model.snapshot();
    const facets = snap.facets.filter((f) => isVideoFacet(f, snap.apps));
    const scene = playersNow().video;
    const active = !!scene && model.activeScene() === scene.id;
    const screenEntry = scene ? Object.entries(scene.assign).find(([, ref]) => facets.some((f) => f.id === ref)) : undefined;
    let screen = screenEntry ? { slot: screenEntry[0], facet: screenEntry[1], app: facets.find((f) => f.id === screenEntry[1])!.app } : null;
    // multiview (2026-09-23): the screen is the big window - the stage bar, the transport keys, the picks all follow it
    const hero = orchestrator.videoMultiviewHero();
    if (screen && scene && hero && hero !== screen.slot) {
      const fl = (scene.floating ?? []).find((x) => x.facet === hero) ?? (scene.floating ?? []).find((x) => x.facet && hero.startsWith(x.facet + "-"));
      const f = fl?.facet ? facets.find((x) => x.id === fl.facet) : undefined;
      if (f) screen = { slot: hero, facet: f.id, app: f.app };
    }
    const byApp = new Map<string, Facet>();
    for (const f of facets) {
      const have = byApp.get(f.app);
      if (!have || f.id === screen?.facet || (!/XL$/.test(have.slotClass) && /XL$/.test(f.slotClass))) byApp.set(f.app, f);
    }
    const services = [...byApp.values()].map((f) => {
      const app = snap.apps.find((a) => a.id === f.app);
      const key = app?.adapter ?? app?.catalogRef ?? orchestrator.adapterNameForUrl(f.url) ?? f.app;   // the adapter's name, as video.ts keys it
      const kept = orchestrator.videoLibraryOf(key);
      return { app: f.app, name: app?.name ?? f.app, facet: f.id, status: app?.setup?.status ?? "unknown", onScreen: screen?.facet === f.id, adapter: key, library: kept.library, resume: kept.resume, recent: kept.recent, live: kept.live, hasSearch: orchestrator.videoSearchUrlFor(key, "x") !== null || !!orchestrator.adapterSpec(key)?.videoSearch, profiles: orchestrator.videoKnownProfiles(key), profile: ((c) => c?.always ? c : null)(orchestrator.videoStandingProfile(key)) };   // only a STANDING choice is the service's profile; a one-time pick on the gate is not
    }).sort((a, b) => Number(b.onScreen) - Number(a.onScreen) || a.name.localeCompare(b.name));
    return { scene: scene?.id ?? null, active, screen, services };
  };
  // ---- multiview (2026-09-23, "up to 3 PIPs, and a button to turn it on/off and one for swapping the video of focus to the next service
  // instantly"; "a quick change on the watch page too. So people can set their programs quickly for all 4"). The windows are the scene's
  // screen slot and its floating video facets; core keeps their order (the big one first) and places them. A pick with multiview on goes
  // to the TARGET window: the big one by default (what was there moves down into a small window and keeps playing), or small window
  // 2 / 3 / 4 when the Watch page's quick change names it. Sound follows the big window. Off closes the small windows.
  let mvTarget = 0;
  const mvWindows = (): Array<{ tile: string; facet: string; app: string; slot: boolean }> => {
    const sv = videoServices();
    const scene = sv.scene ? model.scene(sv.scene) : undefined;
    const st = orchestrator.videoMultiviewState();
    if (!scene || !st.on || !st.slot) return [];
    const out: Array<{ tile: string; facet: string; app: string; slot: boolean }> = [];
    const slotFacet = scene.assign[st.slot];
    const sf = slotFacet ? model.facet(slotFacet) : undefined;
    // the screen slot is a window while it is in the order: dragged out (2026-09-23) it is parked, paused, off the wall
    if (sf && st.order.includes(st.slot)) out.push({ tile: st.slot, facet: sf.id, app: sf.app, slot: true });
    for (const fl of scene.floating ?? []) {
      const f = fl.facet ? model.facet(fl.facet) : undefined;
      // only a window with a place in the order is a window (2026-09-23, "there seems to be a 5th one hiding behind #2"): six had piled up
      if (f && st.order.includes(f.id) && sv.services.some((x) => x.facet === f.id || x.app === f.app)) out.push({ tile: f.id, facet: f.id, app: f.app, slot: false });
    }
    const rank = (t: string) => { const i = st.order.indexOf(t); return i < 0 ? 99 : i; };
    return out.sort((a, b) => rank(a.tile) - rank(b.tile)).slice(0, MV_MAX);
  };
  /** A floating video window the order no longer holds leaves the scene - nothing is left drawn behind the windows. Returns whether it changed. */
  const mvReconcile = (): boolean => {
    const sv = videoServices();
    const scene = sv.scene ? model.scene(sv.scene) : undefined;
    const st = orchestrator.videoMultiviewState();
    if (!scene || !st.on) return false;
    const videoFacets = new Set(sv.services.map((x) => x.facet));
    const keep = (scene.floating ?? []).filter((fl) => !fl.facet || !videoFacets.has(fl.facet) || st.order.includes(fl.facet));
    if (keep.length === (scene.floating ?? []).length) return false;
    const r = model.saveScene({ ...scene, floating: keep });
    if (!r.ok) { report(new Error("multiview reconcile: " + r.error)); return false; }
    mvDropCopies();
    applyScene(scene.id);
    return true;
  };
  const mvFloatingOf = (facetId: string): FloatingPlacement => ({ facet: facetId, anchor: "top-right", size: 0.24, face: "page" });
  // several windows of one service (2026-09-24, "When I drag into any of the window options, they seem to just become the big window" -
  // both titles were Paramount+, and a service had one window): a second window of a service is a copy of its facet, "<facet>-w2" and on,
  // the same App, profile and sign-in; made when a window needs it and removed when that window closes. The service's own stream limit
  // (its plan) decides how many play at once.
  const MV_COPY = /-w[2-9]$/;
  const mvFacetFor = (facet: Facet, wins: ReadonlyArray<{ facet: string }>): string | null => {
    const used = new Set(wins.map((w) => w.facet));
    const base = facet.id.replace(MV_COPY, "");
    if (!used.has(base) && model.facet(base)) return base;
    for (let n = 2; n <= 9; n++) {
      const id = `${base}-w${n}`;
      if (used.has(id)) continue;
      if (!model.facet(id)) {
        const src = model.facet(base) ?? facet;
        const r = model.saveFacet({ ...src, id, label: (src.label || base) + " " + n });
        if (!r.ok) { report(new Error("multiview copy: " + r.error)); return null; }
      }
      return id;
    }
    return null;
  };
  /** A copy whose window has closed goes (the model refuses while a scene still names it). */
  const mvDropCopies = (): void => {
    for (const f of model.snapshot().facets) if (MV_COPY.test(f.id)) model.removeFacet(f.id);
  };
  /** Where a pick lands with multiview on: {tile, ready} - ready when the service already had a window (play now), else once its page is up. */
  const mvPlace = (facetId: string): { tile: string; ready: boolean; sceneId?: string } | null => {
    const st = orchestrator.videoMultiviewState();
    if (!st.on || !st.slot) return null;
    const sv = videoServices();
    const scene = sv.scene ? model.scene(sv.scene) : undefined;
    const facet = model.facet(facetId);
    if (!scene || !facet) return null;
    const wins = mvWindows();
    const target = st.collapsed ? 0 : Math.max(0, Math.min(MV_MAX - 1, mvTarget));   // hidden: a pick is the big window's
    const order = wins.map((w) => w.tile);
    // the target place already shows this service: the title plays there; a service elsewhere keeps its window and its title
    const atTarget = target < wins.length ? wins[target] : undefined;
    const have = atTarget && atTarget.app === facet.app ? atTarget : undefined;
    // the screen slot was dragged out and its service is picked again: the slot comes back at the target place, its page as it was
    const parked = !order.includes(st.slot) ? model.facet(scene.assign[st.slot] ?? "") : undefined;
    if (!have && parked && parked.app === facet.app) {
      order.splice(Math.min(target, order.length), 0, st.slot);
      void orchestrator.videoMultiviewOrder(order.slice(0, MV_MAX));
      return { tile: st.slot, ready: true };
    }
    if (have) return { tile: have.tile, ready: true };
    // a new window for the service - or the service replaces the one in the target place
    let floating = [...(scene.floating ?? [])];
    let assign = scene.assign;
    const winFacet = mvFacetFor(facet, wins.filter((w) => !w.slot));   // the screen slot is its own surface: its facet may be shown again
    if (!winFacet) return null;
    let tile = winFacet;
    if (target > 0 && target < order.length) {   // small window N named: that window's service gives way
      const out = wins[target]!;
      if (out.slot) { assign = { ...assign, [st.slot]: facet.id }; tile = st.slot; orchestrator.videoClearTile(st.slot); }
      else { floating = floating.filter((f) => f.facet !== out.facet); floating.push(mvFloatingOf(winFacet)); }
      order[target] = tile;
    } else {
      floating.push(mvFloatingOf(winFacet));
      if (target === 0) order.unshift(tile); else order.push(tile);
      if (order.length > MV_MAX) {   // the oldest small window closes (never the scene's own screen slot - it stays, the next oldest goes)
        let drop = order.length - 1;
        while (drop > 0 && order[drop] === st.slot) drop--;
        const gone = wins.find((w) => w.tile === order[drop]);
        if (gone && !gone.slot) floating = floating.filter((f) => f.facet !== gone.facet);
        order.splice(drop, 1);
      }
    }
    const r = model.saveScene({ ...scene, assign, floating });
    if (!r.ok) { report(new Error("multiview: " + r.error)); return null; }
    mvDropCopies();   // a copy whose window gave way
    const applied = applyScene(scene.id);
    void orchestrator.videoMultiviewOrder(order);
    return { tile, ready: false, ...(applied && (applied as { ok?: boolean }).ok !== false ? { sceneId: scene.id } : {}) };
  };
  // a small window with no video closes (2026-09-24, "all the multiview windows are filled with some junk. Its not supposed to show any of
  // them if not assigned a video"): a pick that failed closes its window at once; a window with nothing playing a title - a home page, a
  // service's own preview, a window a restart brought back on no title - closes after MV_EMPTY_MS, the windows after it moving up one
  const MV_EMPTY_MS = 45_000;
  const MV_PICK_MS = 60_000;
  const mvEmptySince = new Map<string, number>();
  const mvPruneEmpty = (): string[] => {
    const st = orchestrator.videoMultiviewState();
    if (!st.on || st.collapsed) { mvEmptySince.clear(); return []; }
    const vs = orchestrator.videoState();
    const now = Date.now();
    const gone: string[] = [];
    const wins = mvWindows();
    for (const w of wins.slice(1)) {
      const t = vs.find((x) => x.id === w.tile);
      // a pick that never started counts as failed after MV_PICK_MS (Gilmore Girls on Hulu stopped on the show's page, "loading" for good)
      const failed = !!t?.pending?.failed || (!!t?.pending && now - t.pending.at > MV_PICK_MS);
      const loading = !!t?.pending && !failed;
      // a window a restart is bringing back has 3 minutes, not 45 s (2026-09-24: Georgie & Mandy's window was closed 45 s after a restart)
      const restoring = !!t?.pending?.restored && now - t.pending.at < 180_000;
      if (t?.video || loading || restoring) { mvEmptySince.delete(w.tile); continue; }
      const since = mvEmptySince.get(w.tile) ?? now;
      mvEmptySince.set(w.tile, since);
      if (failed || now - since >= MV_EMPTY_MS) gone.push(w.tile);
    }
    for (const t of new Set(mvEmptySince.keys())) if (!wins.some((w) => w.tile === t)) mvEmptySince.delete(t);
    for (const tile of gone) { mvEmptySince.delete(tile); videoMultiview("remove", tile); }
    return gone;
  };
  // the episode lists for Continue watching series read ahead (2026-09-24, "season and episode on Continue watching"): one series at a time on
  // its service's hidden work page, read only, every 90 s at most, never while a title plays or another list is being read; each series once a day
  const cwReadAhead = () => {
    try {
      if (orchestrator.videoState().some((t) => t.playing) || orchestrator.episodeListWorking() || orchestrator.politeIdle()) return;   // resting while nobody is about (2026-09-25)
      const sv = videoServices();
      const hs = hiddenServices();
      const rows = orchestrator.videoMenuRows(sv.services.map((s) => ({ app: s.app, name: s.name, facet: s.facet, adapter: s.adapter })));
      for (const c of rows.continue) {
        const it = c.item;
        if (!it?.id || (it.kind !== "series" && it.kind !== "episode" && it.kind !== "title") || /\bS\d+\s*E\d+/.test(it.subtitle ?? "")) continue;
        const known = orchestrator.cwEpisodeOf(c.app, it.title, it.id);
        if (known && !known.fromResume) continue;   // an episode id is that episode for good; the show's "on now" episode is read again daily
        const s = hs.find((x) => x.app === c.app);
        if (!s || s.status !== "signed-in" || !orchestrator.adapterSpec(s.adapter)?.videoEpisodes) continue;
        if (orchestrator.episodeListRecent(c.app, it.title, 24 * 3_600_000)) continue;
        orchestrator.episodesOf(s, it.title, { kind: "episode", title: "", series: it.title, id: it.id } as import("./types.js").VideoContext);
        return;   // one at a time
      }
    } catch (e) { report(e); }
  };
  setInterval(cwReadAhead, 90_000);
  // the Library's TMDB answers (its pictures, genres and ratings) in memory before it is opened (2026-09-25, "When I go from watch to library, I'm
  // surprised by how slow it is to load the images"): kept on the device for three days, but read back one title at a time when Library first
  // asked - its rows filled and re-sorted for seconds. Once, a little after the start; the services' own libraries are not read here
  setTimeout(() => {
    try {
      orchestrator.modelApps = () => model.snapshot().apps.map((a) => ({ id: a.id, ...(a.adapter ? { adapter: a.adapter } : {}), ...(a.catalogRef ? { catalogRef: a.catalogRef } : {}) }));
      orchestrator.videoLibraryRows(ownedCards(), hubSortSet(null), "genre");
    } catch (e) { report(e); }
  }, 20_000);
  // checked every few seconds while multiview is on - nothing may be asking for its state while a person just watches
  setInterval(() => { try { if (orchestrator.videoMultiviewState().on) mvPruneEmpty(); } catch (e) { report(e); } }, 5000);
  const videoMultiview = (action: string, arg?: string | null): Record<string, unknown> => {
    if (action === "state") { try { mvReconcile(); mvPruneEmpty(); } catch (e) { report(e); } }
    const sv = videoServices();
    const scene = sv.scene ? model.scene(sv.scene) : undefined;
    const st = orchestrator.videoMultiviewState();
    if (action === "on") {
      if (!scene || !sv.screen) return { ok: false, error: "the Video player has no screen" };
      if (!st.on) { orchestrator.videoMultiviewSet(true, sv.screen.slot); mvTarget = 0; }
      else if (st.collapsed) { void orchestrator.videoMultiviewCollapse(false); mvTarget = 0; }   // the hidden windows come back
    } else if (action === "off") {
      // off HIDES the small windows (2026-09-23): the big one plays on untouched; "close" is the teardown
      if (st.on && !st.collapsed) void orchestrator.videoMultiviewCollapse(true);
      return { ok: true, ...mvState(), on: false };
    } else if (action === "close") {
      if (st.on && scene) {
        const wins = mvWindows();
        const hero = wins[0];
        const keepUrl = hero && !hero.slot ? orchestrator.currentUrlOf(hero.tile) : null;
        const videoFacets = new Set(wins.filter((w) => !w.slot).map((w) => w.facet));
        const floating = (scene.floating ?? []).filter((f) => !f.facet || !videoFacets.has(f.facet));
        const assign = hero && !hero.slot && st.slot ? { ...scene.assign, [st.slot]: hero.facet } : scene.assign;
        orchestrator.videoMultiviewSet(false, null);
        const r = model.saveScene({ ...scene, assign, floating });
        if (!r.ok) return { ok: false, error: r.error };
        mvDropCopies();
        if (hero && !hero.slot && st.slot) orchestrator.videoClearTile(st.slot);
        applyScene(scene.id);
        // the big window was a small one's service: the screen slot takes it, at the title it was playing
        if (hero && !hero.slot && st.slot && keepUrl) orchestrator.videoPlayWhenUp(st.slot, { kind: "title", id: keepUrl, url: keepUrl });
        return { ok: true, on: false, sceneId: scene.id, ...mvState() };
      }
    } else if (action === "clearAll") {
      // Clear screens (2026-09-24, "from the watch window, I want to be able to clear all the video screens even if only 1 is playing"):
      // every small window closes, the big screen is paused and its title forgotten (not brought back at the next start)
      let sceneId: string | undefined;
      if (st.on && scene) { const r = videoMultiview("close"); if (typeof r.sceneId === "string") sceneId = r.sceneId; }
      const sv2 = videoServices();
      for (const t of orchestrator.videoState()) if (t.playing) orchestrator.tileCommand(t.id, "pause").catch(report);
      if (sv2.screen) {
        orchestrator.videoClearTile(sv2.screen.slot);
        // the page leaves the title too (2026-09-25, "I had to click the X just now on the big window twice to get rid of Paramount. it
        // disappeared and came back the first time"): paused on its watch page, its next report named the title again and the screen was back
        const home = model.facet(sv2.screen.facet)?.url;
        if (home) orchestrator.navigateTile(sv2.screen.slot, home).catch(report);
      }
      return { ok: true, cleared: true, ...mvState(), ...(sceneId ? { sceneId } : {}) };
    } else if (action === "swap") {
      if (st.collapsed) return { ok: true, ...mvState() };
      const order = mvWindows().map((w) => w.tile);
      if (order.length > 1) void orchestrator.videoMultiviewOrder([...order.slice(1), order[0]!]);   // the next window is the big one; the big one goes to the back
    } else if (action === "focus" && arg) {
      const order = mvWindows().map((w) => w.tile);
      const i = order.indexOf(arg);
      if (i > 0) { order.splice(i, 1); order.unshift(arg); void orchestrator.videoMultiviewOrder(order); }
    } else if (action === "remove" && arg) {
      // one window out of multiview (2026-09-23, "let me drag something OUT to get it back out of Multiview config"). The big one out, the
      // next small one backfills it (and has the sound); the last one out leaves the big window empty - nothing playing, the host draws the
      // empty stage ("If someone pulls something out of the big window, backfill a small window item into it, if nothing is playing, then I
      // guess just nothing is playing"). A small window's service closes; the screen slot cannot leave the scene, so it is parked - paused,
      // off the wall - until its service is picked into multiview again.
      if (st.collapsed || !scene) return { ok: false, error: "multiview is off", ...mvState() };
      const wins = mvWindows();
      const w = wins.find((x) => x.tile === arg);
      if (!w) return { ok: false, error: "no such window", ...mvState() };
      const order = wins.map((x) => x.tile).filter((t) => t !== arg);
      let sceneId: string | undefined;
      void orchestrator.videoMultiviewOrder(order);   // the order first (set at once): the scene's apply lays out without the window
      if (!w.slot) {
        const r = model.saveScene({ ...scene, floating: (scene.floating ?? []).filter((f) => f.facet !== w.facet) });
        if (!r.ok) return { ok: false, error: r.error };
        mvDropCopies();
        const applied = applyScene(scene.id);
        if (applied && (applied as { ok?: boolean }).ok !== false) sceneId = scene.id;
      }
      // one window left is no multiview (2026-09-24, no Multiview button): it ends, the one left playing as the single screen - when that one is
      // the screen slot itself. A window of its own left alone plays on as the big screen, untouched (2026-09-25, "I clicked the window 2 X and it
      // cleared both the big window and window 2"): ending multiview moved its title into the slot by opening it again, both screens went dark
      // and Paramount+ came back on another episode
      if (order.length === 1 && wins.find((x) => x.tile === order[0])?.slot) return videoMultiview("close");
      return { ok: true, ...mvState(), ...(sceneId ? { sceneId } : {}) };
    } else if (action === "place" && arg) {
      // a window dragged onto another place in the strip: "tile:index" - the two trade places
      const [tile, at] = [arg.slice(0, arg.lastIndexOf(":")), Number(arg.slice(arg.lastIndexOf(":") + 1))];
      const order = mvWindows().map((w) => w.tile);
      const i = order.indexOf(tile);
      if (st.collapsed || i < 0 || !Number.isInteger(at)) return { ok: false, error: "no such window", ...mvState() };
      const to = Math.max(0, Math.min(order.length - 1, at));
      if (i !== to) { const other = order[to]!; order[to] = tile; order[i] = other; void orchestrator.videoMultiviewOrder(order); }
    } else if (action === "target") {
      mvTarget = Math.max(0, Math.min(MV_MAX - 1, Number(arg) || 0));
    } else if (action !== "state") return { ok: false, error: "unknown multiview action " + action };
    return { ok: true, ...mvState() };
  };
  const mvState = (): Record<string, unknown> => {
    const st = orchestrator.videoMultiviewState();
    const vs = orchestrator.videoState();
    const sv = videoServices();
    const wins = mvWindows().map((w, i) => {
      const t = vs.find((x) => x.id === w.tile);
      const v = t?.video ?? null;
      return { index: i, tile: w.tile, app: w.app, facet: w.facet, name: sv.services.find((x) => x.app === w.app)?.name ?? w.app, title: v ? [v.series, v.title].filter(Boolean).join(" \u00B7 ") : null, playing: !!t?.playing };
    });
    // what the big screen holds, with multiview on or off (2026-09-24, "Should screen 2 show if nothing has been added to screen 1?"): a
    // second window is offered only once the big one has a title playing or loading
    const scr = sv.screen;
    const bt = scr ? vs.find((x) => x.id === scr.slot) : undefined;
    const loading = !!bt?.pending && !bt.pending.failed && !bt.video;
    const bigTitle = bt?.video ? [bt.video.series, bt.video.title].filter(Boolean).join(" \u00B7 ") : loading ? bt!.pending!.name : null;
    const big = scr ? { tile: scr.slot, app: scr.app, name: sv.services.find((x) => x.app === scr.app)?.name ?? scr.app, title: bigTitle, loading, has: !!bt?.video || loading } : null;
    return { on: st.on && !st.collapsed, target: mvTarget, max: MV_MAX, windows: st.collapsed ? wins.slice(0, 1) : wins, big };
  };
  const videoSwitch = (facetId: string): Record<string, unknown> => {
    const mv = mvPlace(facetId);   // multiview: the service gets a window (or its window comes forward); the screen slot is never re-pointed under it
    if (mv) return { ok: true, switched: !mv.ready, multiview: true, slot: mv.tile, ...(mv.sceneId ? { sceneId: mv.sceneId } : {}) };
    const sv = videoServices();
    const scene = sv.scene ? model.scene(sv.scene) : undefined;
    if (!scene) return { ok: false, reason: "no-scene", template: PLAYER_TEMPLATES.video[0] };
    const facet = model.facet(facetId);
    if (!facet) return { ok: false, error: "unknown facet " + facetId };
    const layout = model.layout(scene.layout);
    const slot = sv.screen?.slot ?? layout?.slots.find((s) => s.class === facet.slotClass)?.id ?? layout?.slots[0]?.id;
    if (!slot) return { ok: false, error: "the Video player has no screen slot" };
    if (scene.assign[slot] !== facetId) {
      const r = model.saveScene({ ...scene, assign: { ...scene.assign, [slot]: facetId } });
      if (!r.ok) return { ok: false, error: r.error };
      orchestrator.videoClearTile(slot);   // the last service's pick, hint and face leave the slot with it
    }
    return sv.active ? { ...applyScene(scene.id), sceneId: scene.id, slot } : { ...switchPlayer("video"), slot };
  };
  // Phase 2: the universal menu - the merged rows come from video.ts through menu-order.ts (pure over the §4 inputs); the
  // suggestions (each service's own rows) are handed over labeled by service for the host to show only when asked (off by
  // default, the transparency rule); the services row is every service, so nothing is unreachable; search is the chips.
  // what the person owns, every service's purchases as ONE library ("it will be nice to see a consolidated library", 2026-09-22): one
  // card per title ("Dedupe but I still want the option to choose a service if it resides in both") - the first service in the
  // household's order is the card's, the others ride along as `also` and the card offers the choice; a card the service gave no
  // poster takes another service's, else TMDB's
  const ownedCards = (): Array<{ app: string; service: string; facet: string; item: VideoItem; also: Array<{ app: string; service: string; facet: string; item: VideoItem }> }> => {
    const sv = videoServices();
    const order = model.snapshot().apps.map((a) => a.id);
    const byTitle = new Map<string, { app: string; service: string; facet: string; item: VideoItem; also: Array<{ app: string; service: string; facet: string; item: VideoItem }> }>();
    for (const s of [...sv.services].sort((a, b) => order.indexOf(a.app) - order.indexOf(b.app)))
      for (const item of s.library.owned ?? []) {
        const k = dedupeKey(item.title);   // punctuation- and article-blind: '10,000 B.C.' / '10,000 BC', 'Meg 2: The Trench' / 'The Meg 2: The Trench'
        const have = byTitle.get(k);
        if (!have) byTitle.set(k, { app: s.app, service: s.name, facet: s.facet, item, also: [] });
        else if (have.app !== s.app && !have.also.some((x) => x.app === s.app)) have.also.push({ app: s.app, service: s.name, facet: s.facet, item });
      }
    // TMDB's landscape backdrop first (a store's art is a tall poster), else the store's own landscape picture (videoOwnedArtWide,
    // 2026-09-24: Fandango's background still, darkened by Fandango for its own page - so second), else the store's art, else TMDB's poster
    const adapterOf = new Map(sv.services.map((s) => [s.app, s.adapter]));
    const ownWide = (c: { app: string; item: VideoItem; also: Array<{ app: string; item: VideoItem }> }) => [c, ...c.also].map((x) => orchestrator.ownedWideArt(adapterOf.get(x.app) ?? x.app, x.item.id)).find((u) => !!u) ?? null;
    return [...byTitle.values()].map((c) => { const wide = orchestrator.backdropFor(c.item.title, c.item.kind) ?? ownWide(c); return wide ? { ...c, item: { ...c.item, artwork: wide } } : c.item.artwork ? c : { ...c, item: { ...c.item, artwork: c.also.find((x) => x.item.artwork)?.item.artwork ?? orchestrator.posterFor(c.item.title, c.item.kind) } }; }).sort((a, b) => a.item.title.localeCompare(b.item.title, undefined, { sensitivity: "base" }));
  };
  // the Library tab: the owned titles by genre, rated (orchestrator.videoLibraryRows)
  // the Library tab's sort (2026-09-22; the Watch tab's rows keep their own order - a global sort there made every lens row look the same): the person's choice kept on the device; the host passes it with each ask and reads it back in the answer
  const hubSortNow = (): HubSort => hubSortOf(tilesRead("video:hub-sort"));
  const hubSortSet = (v: unknown): HubSort => { const sort = hubSortOf(v); if (v !== undefined && v !== null && sort !== hubSortNow()) { try { void drivers.store?.set("video:hub-sort", sort); } catch (e) { report(e); } } return v === undefined || v === null ? hubSortNow() : sort; };
  const LIBRARY_GROUPS = [
    { id: "genre", label: "Genre", hint: "A row per genre (TMDB's first genre for each title), the biggest genres first." },
    { id: "none", label: "None", hint: "Every title in one list, in the sort you chose." },
  ] as const;
  const videoLibraryTab = (sortArg?: string | null, groupArg?: string | null): Record<string, unknown> => {
    try { orchestrator.videoRefreshOwnedIfStale(hiddenServices()); } catch (e) { report(e); }   // the owned libraries read again when Library opens and they are hours old
    orchestrator.modelApps = () => model.snapshot().apps.map((a) => ({ id: a.id, ...(a.adapter ? { adapter: a.adapter } : {}), ...(a.catalogRef ? { catalogRef: a.catalogRef } : {}) }));
    const cards = ownedCards();
    const sort = hubSortSet(sortArg);
    const group = groupArg === "none" ? "none" : "genre";
    const r = orchestrator.videoLibraryRows(cards, sort, group);
    const services = [...new Set(cards.flatMap((c) => [c.service, ...c.also.map((a) => a.service)]))];
    return { ...r, total: cards.length, twice: cards.filter((c) => c.also.length > 0).length, services, tmdbKey: orchestrator.lensHasKey(), sort, sorts: HUB_SORTS, group, groups: LIBRARY_GROUPS };
  };
  let bootRowsAsked = false;
  // startup timings (2026-09-24): measured from this runtime's creation, read by the host into host.log ("boot timing")
  let episodeHealthResult: unknown = null;
  const bootAt = Date.now();
  let menuReadyAt: number | null = null;   // the boot's Phase 2 has asked for every service's kept rows
  const videoMenu = () => {
    try { videoRefreshLists(false); } catch (e) { report(e); }   // the lists as of now, for the next open (stale-guarded)
    const sv = videoServices();
    // the merge takes the services in the order the household added them (the App list) - a fact of the household, not a
    // Prism choice, and never what happens to be on the screen; ties inside a recency class keep that order (§4 Decision)
    const order = model.snapshot().apps.map((a) => a.id);
    const names = [...sv.services].sort((a, b) => order.indexOf(a.app) - order.indexOf(b.app)).map((s) => ({ app: s.app, name: s.name, facet: s.facet, adapter: s.adapter }));
    const rows = orchestrator.videoMenuRows(names);
    // season and episode on Continue watching (2026-09-24): "S5 E7 - Silver Alert" when the service's own list has told which episode the entry is
    rows.continue = rows.continue.map((c) => {
      const it = c.item;
      if (!it?.id || /\bS\d+\s*E\d+/.test(it.subtitle ?? "")) return c;
      const known = orchestrator.cwEpisodeOf(c.app, it.title, it.id);
      if (!known) return c;
      const label = `S${known.season} E${known.episode}` + (known.title ? " \u00B7 " + known.title : "");
      return { ...c, item: { ...it, subtitle: it.subtitle ? label + " \u00B7 " + it.subtitle : label } };
    });
    const owned = ownedCards();
    // Most read on Wikipedia reads the catalog on the household's services under the key (most-read.ts, 2026-09-22: "the lens should be
    // looking at all movies & TV I have access to"); without a key it stays the lens over the household's own titles
    const offer = browseOfferOf(tilesRead("video:browse-offer"));
    const mr = orchestrator.videoMostRead(hiddenServices(), offer, [...rows.continue, ...rows.list, ...owned].map((c) => ({ title: c.item.title, kind: c.item.kind })));
    const offerWords = BROWSE_OFFERS.find((o) => o.id === offer)!.words;
    const lensRows = mr ? rows.lensRows.map((lr) => lr.id !== "wiki-reads" ? lr : {
      ...lr, ...MOST_READ_CATALOG, formula: MOST_READ_CATALOG.formula.replace("{offer}", offerWords),
      catalog: true, cards: mr.cards.slice(0, 40), total: mr.cards.length, dataDate: mr.through, reading: mr.done ? 0 : 1, weighed: mr.read,
    }) : rows.lensRows;
    // New episodes this week and Released this month (fresh-rows.ts, 2026-09-23): TMDB's dates on the household's services, after Most read
    const freshRow = (def: typeof FRESH_EPISODES | typeof FRESH_MOVIES, e: ReturnType<typeof orchestrator.videoFresh>) => e && (e.cards.length || !e.done) ? [{
      id: def.id, name: def.name, counted: def.counted, who: def.who, decides: def.decides, source: def.source, sourceUrl: def.sourceUrl,
      formula: def.formula.replace("{offer}", offerWords), attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
      catalog: true, total: e.cards.length, dataDate: e.through, reading: e.done ? 0 : 1,
      // the New episodes row's cards carry My List's red ribbon (2026-09-24, "including the banner on the New episodes, Last 10 Days lens")
      cards: e.cards.slice(0, 40).map((c) => { const badge = def.id === FRESH_EPISODES.id ? newEpisodeBadge(c.date, Date.now()) : null; return badge ? { ...c, badge, badgeFrom: "tmdb" } : c; }),
    }] : [];
    const epRow = freshRow(FRESH_EPISODES, orchestrator.videoFresh(hiddenServices(), offer, "episodes"));
    const mvRow = freshRow(FRESH_MOVIES, orchestrator.videoFresh(hiddenServices(), offer, "movies"));
    lensRows.push(...(epRow as never[]), ...(mvRow as never[]));
    // The Binge (2026-09-24): after the fresh rows; off without a key
    const bgRow = bingeRow();
    if (bgRow) lensRows.push(bgRow as never);
    const lens = mr && !mr.done ? { ...rows.lens, pending: rows.lens.pending + 1 } : rows.lens;
    const off = excludedNow();
    if (off.size) { rows.continue = rows.continue.filter((c) => !off.has(c.app)); rows.list = rows.list.filter((c) => !off.has(c.app)); }
    return {
      // ready: the kept rows are in (2026-09-24, "Would like to not see this whole page refresh on relaunch (no results, replaced with
      // results)"): at boot the page waits for this and opens once, full
      ready: ((r) => { if (r && menuReadyAt === null) menuReadyAt = Date.now(); return r; })(bootRowsAsked && !orchestrator.videoWarming()),
      continue: rows.continue, list: rows.list, lens, lensRows,
      // what the person owns, every service's purchases as ONE library ("it will be nice to see a consolidated library", 2026-09-22): the
      // titles alphabetical, each card badged with its service; the same title bought twice is two cards, one per service
      owned,

      live: sv.services.filter((s) => s.live.length > 0).map((s) => ({ app: s.app, name: s.name, facet: s.facet, channels: s.live })),
      services: sv.services.map((s) => ({ app: s.app, name: s.name, facet: s.facet, status: s.status, onScreen: s.onScreen, adapter: s.adapter, profiles: s.profiles, profile: s.profile })),
      search: sv.services.filter((s) => s.hasSearch).map((s) => ({ app: s.app, name: s.name, facet: s.facet })),
      suggestions: sv.services.filter((s) => (s.library.shelves ?? []).length > 0).map((s) => ({ app: s.app, name: s.name, facet: s.facet, shelves: s.library.shelves })),
      screen: sv.screen, active: sv.active, log: rows.log, now: Date.now(),
    };
  };
  const videoSearch = (facetId: string, q: string, open?: string | null): Record<string, unknown> => {
    const sv = videoServices();
    const s = sv.services.find((x) => x.facet === facetId);
    if (!s) return { ok: false, error: "unknown service " + facetId };
    // a service with a search script: the words go into its own search control from a mounted page - on the screen now,
    // else once the screen has become the service (Hulu ignores the address; Peacock's search page is a deep link)
    if (orchestrator.adapterSpec(s.adapter)?.videoSearch) {
      const mv = mvPlace(facetId);
      if (mv) {
        if (mv.ready) orchestrator.videoSearchIn(mv.tile, q, open).then((r) => { if (r !== "ok") report(new Error("videoSearch " + facetId + ": " + r)); }, report);
        else orchestrator.videoSearchWhenUp(mv.tile, q, open);
        return { ok: true, switched: !mv.ready, multiview: true, ...(mv.sceneId ? { sceneId: mv.sceneId } : {}) };
      }
      if (sv.active && sv.screen?.facet === facetId) {
        orchestrator.videoSearchIn(sv.screen.slot, q, open).then((r) => { if (r !== "ok") report(new Error("videoSearch " + facetId + ": " + r)); }, report);
        return { ok: true, switched: false };
      }
      const r = videoSwitch(facetId);
      if (r.ok && typeof r.slot === "string") orchestrator.videoSearchWhenUp(r.slot, q, open);
      return { ...r, switched: true };
    }
    if (open) return { ok: false, error: s.name + " cannot open a search result without an address" };
    const url = orchestrator.videoSearchUrlFor(s.adapter, q);
    if (!url) return { ok: false, error: s.name + " has no search address" };
    return videoPlayOn(facetId, "search", "search:" + q, url, "Search " + s.name + " for " + q);
  };
  // Cross-service search (video-menu-spec §2 row 5, 2026-09-19): every signed-in service asked at once on hidden surfaces
  // (orchestrator.videoLookupStart); the host polls videoLookupState until done and draws one labeled row. A result plays
  // through the paths that exist: its own address (a play or a details page), else the service's search with the result
  // pressed once shown.
  // ---- profile presets (2026-09-24, "allow the user to save any number of profile presets. So if another user logs in, they can change the
  // preset and therefore all service profiles"): {presets:[{id, name, picks:{app:{id,name}}}], active} on the device
  // off: the services EXCLUDED for the person on now (2026-09-24, "add an <Exclude> option too, so if someone doesn't want to use a specific
  // service for their profile specific items Continue + My list, they can, but we'll still bring it into the lists below, library and browse")
  type ProfilePreset = { id: string; name: string; picks: Record<string, { id: string; name: string }>; off?: string[] };
  type PresetState = { presets: ProfilePreset[]; active: string | null; off: string[] };
  const PRESETS_KEY = "video:profile-presets";
  const presetsNow = (): PresetState => {
    try {
      const j = JSON.parse(tilesRead(PRESETS_KEY) ?? "null") as { presets?: unknown; active?: unknown; off?: unknown } | null;
      const presets = Array.isArray(j?.presets) ? (j!.presets as ProfilePreset[]).filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.picks && typeof p.picks === "object") : [];
      const off = Array.isArray(j?.off) ? (j!.off as unknown[]).filter((a): a is string => typeof a === "string") : [];
      return { presets, active: typeof j?.active === "string" && presets.some((p) => p.id === j.active) ? j.active : null, off };
    } catch { return { presets: [], active: null, off: [] }; }
  };
  const presetsWrite = (st: PresetState): void => { try { void drivers.store?.set(PRESETS_KEY, JSON.stringify(st)); } catch (e) { report(e); } };
  /** The services excluded for the person on now: their cards leave Watch's Continue watching and My list, nowhere else. */
  const excludedNow = (): Set<string> => new Set(presetsNow().off);
  /** The Profiles window: the services that HAVE profiles (a service without them is not listed), each with its profiles and the current one. */
  const profilesView = () => {
    const sv = videoServices();
    const st = presetsNow();
    const hasProfiles = (s: (typeof sv.services)[number]) => (s.profiles?.length ?? 0) > 0 || !!orchestrator.adapterSpec(s.adapter)?.videoProfiles;
    const services = sv.services.filter(hasProfiles)
      .map((s) => ({ app: s.app, name: s.name, status: s.status, profiles: s.profiles ?? [], current: s.profile ? { id: s.profile.id, name: s.profile.name } : null, switching: orchestrator.videoSwitchWorking(s.app, s.adapter), excluded: st.off.includes(s.app) }));
    // the services without profiles: nothing to pick, but each can be excluded for a person
    const others = sv.services.filter((s) => !hasProfiles(s)).map((s) => ({ app: s.app, name: s.name, status: s.status, excluded: st.off.includes(s.app) }));
    return { services, others, presets: st.presets, active: st.active, off: st.off };
  };
  const hiddenServices = () => {
    const sv = videoServices();
    const snap = model.snapshot();
    const order = snap.apps.map((a) => a.id);
    return [...sv.services].sort((a, b) => order.indexOf(a.app) - order.indexOf(b.app)).map((s) => {
      const app = snap.apps.find((a) => a.id === s.app);
      return { app: s.app, name: s.name, facet: s.facet, adapter: s.adapter, profile: app?.profileId ?? s.app, home: app?.baseUrl ?? model.facet(s.facet)?.url ?? "", status: s.status };
    });
  };
  // the Episodes list read in the background for the series on the Video player's screen (2026-09-23): the same read the menu asks for
  orchestrator.onSeriesUp = (tileId) => {
    const sv = videoServices();
    if (sv.screen?.slot !== tileId) return;
    const s = hiddenServices().find((x) => x.app === sv.screen!.app);
    if (s) orchestrator.videoEpisodes(tileId, s);
  };
  // the combined My list (2026-09-20): each service's own list page read on a hidden surface; stale after half an hour
  const videoRefreshLists = (force: boolean): Record<string, unknown> => ({ ok: true, asked: orchestrator.videoRefreshLists(hiddenServices(), force) });
  // the wall keeps itself current (2026-09-23): a tick every few minutes; core decides whether it is time and whether the wall is quiet
  // the household's optional quiet hours for the timed refresh (Watch settings, 2026-09-24 - off by default: "people watch tv overnight")
  const BG_PAUSE_KEY = "video:bg-pause";
  const loadPause = () => {
    try {
      const j = JSON.parse(tilesRead(BG_PAUSE_KEY) ?? "null") as { on?: unknown; from?: unknown; to?: unknown } | null;
      if (j) orchestrator.bgPause = { on: j.on === true, from: typeof j.from === "string" ? j.from : "23:00", to: typeof j.to === "string" ? j.to : "07:00" };
    } catch { /* the default: no pause */ }
  };
  let pauseLoaded = false;
  setInterval(() => { try { if (!pauseLoaded) { loadPause(); pauseLoaded = true; } orchestrator.backgroundTick(hiddenServices()); } catch (e) { report(e); } }, 4 * 60_000);
  // the row as the host draws it: a catalog search's rows come ordered from catalog-search.ts (TMDB's order, the title
  // that IS the words first, one card per household service that carries it); a services search orders through the pure
  // rule of video-lookup.ts. Never the host.
  const lookupView = (st: ReturnType<typeof orchestrator.videoLookupState>): Record<string, unknown> | null =>
    st ? { ...st, rows: st.source === "catalog" && st.catalog?.length ? st.catalog : orderLookup(st.q, st.services), library: st.person ? [] : lookupLibrary(st.q) } : null;
  // the household's own titles the words match (2026-09-23 search upgrade): every service's Continue Watching, My List and owned titles as the
  // wall already holds them - no page asked, no network - so the first answers are there as the person types
  const lookupLibrary = (q: string): LibraryHit[] => libraryHits(q, libraryEntries());
  const libraryEntries = (): LibraryEntry[] => {
    const entries: LibraryEntry[] = [];
    for (const s of videoServices().services) {
      const lib = orchestrator.videoLibraryOf(s.adapter).library;
      for (const [from, items] of [["continue", lib.continue], ["list", lib.list], ["owned", lib.owned]] as const)
        for (const it of (items ?? []) as VideoItem[]) {
          // a title the service gave no picture (Movies Anywhere's Serenity, 2026-09-23): TMDB's landscape one, else its poster
          const art = it.artwork || orchestrator.backdropFor(it.title, it.kind) || orchestrator.posterFor(it.title, it.kind);
          entries.push({ app: s.app, name: s.name, facet: s.facet, from, item: { ...it, artwork: art } as LibraryEntry["item"] });
        }
    }
    return entries;
  };
  const videoLookup = (q: string): Record<string, unknown> => {
    const words = q.trim();
    if (!words) return { ok: false, error: "nothing to search for" };
    const services = hiddenServices();
    const st = orchestrator.videoLookupStart(words, services);
    return { ok: true, ...lookupView(st) };
  };
  orchestrator.hiddenServiceOf = (adapterKey) => hiddenServices().find((s) => s.adapter === adapterKey);   // what a retried removal runs on (2026-09-23)
  const videoLookupNow = (): Record<string, unknown> | null => lookupView(orchestrator.videoLookupState());
  // each "Where to watch" offer a signed-in service of the household carries says which one: its logo plays the title there (2026-09-23)
  // the services that also carry another's titles (2026-09-25): Hulu's shows play in the Disney+ app with the bundle - not every one, so each is
  // asked of Disney+ itself (titleAlsoOn) and the answer kept a week
  const ALSO_VIA: Record<string, string> = { hulu: "disneyplus" };
  const ALSO_KEY = "video:also-on";
  const ALSO_TTL_MS = 7 * 24 * 3_600_000;
  const alsoChecking = new Set<string>();
  const alsoMap = (): Record<string, { v: boolean; at: number }> => { try { const j = JSON.parse(tilesRead(ALSO_KEY) ?? "{}"); return j && typeof j === "object" ? j : {}; } catch { return {}; } };
  const withPlay = (r: { status: string; details?: unknown; why?: string }): Record<string, unknown> => {
    const d = (r as { details?: { providers?: Record<string, Array<{ id?: number; play?: { app: string; name: string } }>> } }).details;
    if (!d?.providers) return r as Record<string, unknown>;
    const svcs = videoServices().services.filter((s) => s.status === "signed-in").map((s) => ({ app: s.app, name: s.name, providers: orchestrator.providersOfAdapter(s.adapter) }));
    return { ...r, details: { ...d, providers: Object.fromEntries(Object.entries(d.providers).map(([k, list]) => [k, list.map((o) => { const s = typeof o.id === "number" ? svcs.find((x) => x.providers.includes(o.id!)) : undefined; return s ? { ...o, play: { app: s.app, name: s.name } } : o; })])) } };
  };
  const videoLookupPerson = (id: number, name: string): Record<string, unknown> => {
    if (!Number.isFinite(id) || !name.trim()) return { ok: false, error: "no person" };
    return { ok: true, ...lookupView(orchestrator.videoLookupPersonStart(id, name.trim(), hiddenServices())) };
  };
  // the search under a filter (2026-09-22, "When searching, should be able to filter by genre and service"): the rows filtered
  // by hub-sort.ts, the chips the unfiltered rows offer; the state itself is untouched (a press still checks the service's own answer)
  const videoLookupFiltered = (genre: string | null, app: string | null): Record<string, unknown> | null => {
    const v = videoLookupNow();
    if (!v) return null;
    const rows = (v.rows as Array<{ app: string; name: string; candidate: { genres?: string[] } }> | undefined) ?? [];
    const f = filterLookupRows(rows, { genre, app });
    // one card per work, every service that carries it on the card (search-view.ts)
    const works = searchWorks(String(v.q ?? ""), f.rows as unknown as SearchRowIn[]);
    // the household's own titles: the words' matches, then any title the search found that they have (a person's work in their Continue Watching)
    const library = libraryForWorks(v.person ? "" : String(v.q ?? ""), libraryEntries(), works);
    return { ...v, rows: f.rows, works, library, all: rows.length, genres: f.genres, filterServices: f.services, filter: { genre, app } };
  };
  const videoPlayResult = (appId: string, candidateJson: string): Record<string, unknown> => {
    const sv = videoServices();
    const s = sv.services.find((x) => x.app === appId);
    if (!s) return { ok: false, error: "unknown service " + appId };
    let c: { id?: string; title?: string; kind?: string; url?: string; play?: boolean };
    try { c = JSON.parse(candidateJson); } catch { return { ok: false, error: "malformed result" }; }
    if (!c || typeof c.id !== "string" || typeof c.title !== "string") return { ok: false, error: "malformed result" };
    // a catalog title (TMDB's) goes to the service's own search whatever page it was pressed on (2026-09-25, "tried to play American Gods and
    // received an error": a Details page opened from My List, not from Search, had no search result to match, so the guard below refused it) -
    // the exact match the service answers with is what plays, as before
    if (orchestrator.isCatalogCandidate(c.id)) return playCatalog(s, c.title, c.kind ?? "title");
    // only a result the service itself answered with is ever sent back to it (the same guard as the music lookup)
    const st = orchestrator.videoLookupState();
    const own = st?.services.find((x) => x.app === appId)?.candidates.find((x) => x.id === c.id);
    if (!own) return { ok: false, error: "not a result " + s.name + " gave" };
    // a catalog card (2026-09-21): TMDB named the title and the service; the service's own search is asked for it in the
    // background and the exact match it answers with plays - so nothing the service did not itself give is ever sent to
    // it. The screen becomes the service now (the person pressed); when the service does not name the title, its own
    // search opens on the screen with the words, so the person sees what it has.
    if (orchestrator.isCatalogCandidate(own.id)) return playCatalog(s, own.title, own.kind);
    // a show the service marks as not played from its result is played as a series - its page opened, then the adapter presses the service's own
    // Play (2026-09-25, "I tried to start american gods in Tubi but nothing ever happened": "open" only opened the page, and the page's Play was
    // asked for before the adapter was on it); anything else not playable from its result is opened, as before
    if (own.url) return videoPlayOn(s.facet, own.play === false ? (own.kind === "series" ? "series" : "open") : own.kind === "live" ? "live" : "title", own.id, own.url, own.title);
    if (st && orchestrator.adapterSpec(s.adapter)?.videoSearch) return videoSearch(s.facet, st.q, own.id);
    return { ok: false, error: s.name + " gave no address for " + own.title };
  };
  // a catalog title pressed (search, Browse): the title resolved FIRST, the screen switched after (the host's curtain covers the
  // wait) - a press had switched the screen to Hulu's home and only then asked, and the person watched the home page while the
  // answer came (2026-09-21)
  // a pick called off (videoCancelPick) drops the catalog resolve still running for it: its answer arrives and plays nothing
  let pickGen = 0;
  const playCatalog = (s: { app: string; name: string; facet: string; adapter: string }, title: string, kind: string, onMiss?: () => void): Record<string, unknown> => {
    const appId = s.app;
    const gen = pickGen;
    {
      orchestrator.videoCatalogResolve(appId, title, hiddenServices()).then((hit) => {
        if (gen !== pickGen) return;
        if (!hit && onMiss) { try { onMiss(); } catch (e) { report(e); } }
        const r = hit?.url ? videoPlayOn(s.facet, hit.play === false ? (hit.kind === "series" ? "series" : "open") : hit.kind === "live" ? "live" : "title", hit.id, hit.url, hit.title)
          : hit && orchestrator.adapterSpec(s.adapter)?.videoSearch ? videoSearch(s.facet, title, hit.id)
          : orchestrator.adapterSpec(s.adapter)?.videoSearch ? videoSearch(s.facet, title, null)
          : ((): Record<string, unknown> => { const url = orchestrator.videoSearchUrlFor(s.adapter, title); return url ? videoPlayOn(s.facet, "open", "search:" + title, url, title) : { ok: false, error: s.name + " has no search" }; })();
        if (!r.ok) report(new Error("catalog " + s.name + " " + kind + " " + title + ": " + String(r.error ?? "")));
      }, report);
      return { ok: true, switched: false, resolving: true };
    }
  };
  // a Browse card pressed: only a title Browse listed on that service goes to it (the same guard as a search result)
  const videoBrowsePlay = (appId: string, cardId: string): Record<string, unknown> => {
    const s = videoServices().services.find((x) => x.app === appId);
    if (!s) return { ok: false, error: "unknown service " + appId };
    const card = orchestrator.videoBrowseCard(cardId, appId);
    if (!card) return { ok: false, error: "not a title Browse listed on " + s.name };
    return playCatalog(s, card.title, card.kind);
  };

  // ---- The Binge (binge.ts is the rule; docs/features/the-binge.md, 2026-09-24): thresholds and kids mode kept on the device, shared by
  // the row and the full view; a hidden title, and one a press found missing on its service (until the provider data is read again)
  const BINGE_SETTINGS_KEY = "video:binge-settings";
  const BINGE_HIDDEN_KEY = "video:binge-hidden";
  const BINGE_MISS_MS = 24 * 3_600_000;
  const bingeSettingsNow = (): { thresholds: BingeThresholds; kids: KidsMode; animation: boolean } => { try { return bingeSettingsOf(JSON.parse(tilesRead(BINGE_SETTINGS_KEY) ?? "null")); } catch { return bingeSettingsOf(null); } };
  type BingeNote = { id: string; why: "hidden" | "missing"; app?: string; at: number; title?: string | undefined };
  const bingeNotes = (): BingeNote[] => { try { const v = JSON.parse(tilesRead(BINGE_HIDDEN_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((n): n is BingeNote => !!n && typeof n.id === "string") : []; } catch { return []; } };
  const bingeHidden = (): Set<string> => new Set(bingeNotes().filter((n) => n.why === "hidden" || Date.now() - n.at < BINGE_MISS_MS).map((n) => n.id));
  const bingeNote = (n: BingeNote | null, dropId?: string) => {
    const list = bingeNotes().filter((x) => x.id !== (n?.id ?? dropId) && (x.why === "hidden" || Date.now() - x.at < BINGE_MISS_MS));
    if (n) list.push(n);
    void drivers.store?.set(BINGE_HIDDEN_KEY, JSON.stringify(list));
  };
  const BINGE_CAVEAT = "Each network sets its own ratings. TV-PG has no official age, so where it falls here is Prism's own choice. Unrated titles are hidden while Kids mode is on.";
  const bingeHead = () => {
    const { thresholds } = bingeSettingsNow();
    const w = bingeWords(thresholds);
    return { id: THE_BINGE.id, name: THE_BINGE.name, label: w.label, counted: w.counted, who: THE_BINGE.who, decides: THE_BINGE.decides, source: THE_BINGE.source, sourceUrl: THE_BINGE.sourceUrl, formula: w.formula,
      thresholds, attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability data from JustWatch, through TMDB." };
  };
  const bingeEntry = () => orchestrator.videoBinge(hiddenServices(), browseOfferOf(tilesRead("video:browse-offer")), bingeSettingsNow().thresholds);
  const bingeRow = (): Record<string, unknown> | null => {
    const e = bingeEntry();
    if (!e || (!e.cands.length && e.done)) return null;
    const { thresholds, kids, animation } = bingeSettingsNow();
    const items = selectBinge(e.cands, { thresholds, kids, animation, day: bingeDay(Date.now()), hidden: bingeHidden() });
    if (!items.length && e.done) return null;
    return { ...bingeHead(), catalog: true, binge: true, kids, animation, cards: items.map((c) => ({ ...c.card, genres: c.genres, play: "binge" })), total: items.length, dataDate: e.through, reading: e.done ? 0 : 1 };
  };
  const videoBingeView = (): Record<string, unknown> => {
    const { thresholds, kids, animation } = bingeSettingsNow();
    const e = bingeEntry();
    const rows = e ? bingeGenreRows(e.cands, { thresholds, kids, animation, day: bingeDay(Date.now()), hidden: bingeHidden() }) : [];
    return { ok: true, tmdbKey: orchestrator.lensHasKey(), head: bingeHead(), kids, animation, caveat: BINGE_CAVEAT,
      ages: KIDS_AGES.map((a) => ({ id: a.id, label: a.label, ratings: a.ratings })),
      genres: rows.map((r) => ({ genre: r.genre, cards: r.items.map((c) => ({ ...c.card, genres: c.genres, play: "binge" })) })),
      reading: e && !e.done ? 1 : 0, dataDate: e?.through ?? null };
  };
  const videoBingeSet = (thresholdsJson: string | null, kidsJson: string | null, animation?: boolean | null): Record<string, unknown> => {
    const now = bingeSettingsNow();
    const parse = (v: string | null) => { if (v === null || v === undefined || v === "") return undefined; try { return JSON.parse(v); } catch { return undefined; } };
    const t = parse(thresholdsJson); const k = parse(kidsJson);
    const next = bingeSettingsOf({ thresholds: t === undefined ? now.thresholds : { ...now.thresholds, ...t }, kids: k === undefined ? now.kids : { ...now.kids, ...k }, animation: typeof animation === "boolean" ? animation : now.animation });
    void drivers.store?.set(BINGE_SETTINGS_KEY, JSON.stringify(next));
    return { ok: true, ...next };
  };
  // the hidden titles as Watch settings lists them (2026-09-24, "I wouldn't mind that info on a tab in settings, scrollable"): a missing
  // note shows until it lapses; a note kept before titles were stored is named from the read, else by its TMDB id
  const videoBingeHidden = (): Record<string, unknown> => {
    const names = new Map(videoServices().services.map((x) => [x.app, x.name]));
    const items = bingeNotes().filter((n) => n.why === "hidden" || Date.now() - n.at < BINGE_MISS_MS).sort((a, b) => b.at - a.at).map((n) => ({
      id: n.id, title: n.title ?? orchestrator.videoBingeTitle(n.id) ?? n.id, why: n.why,
      service: n.app ? names.get(n.app) ?? n.app : null, at: n.at, until: n.why === "missing" ? n.at + BINGE_MISS_MS : null,
    }));
    return { items };
  };
  const videoBingePlay = (appId: string, cardId: string): Record<string, unknown> => {
    const s = videoServices().services.find((x) => x.app === appId);
    if (!s) return { ok: false, error: "unknown service " + appId };
    const card = orchestrator.videoBingeCard(cardId, appId);
    if (!card) return { ok: false, error: "not a title The Binge listed on " + s.name };
    // a miss: the service's search opens with the words in place, and the card is noted missing here until the providers are read again
    return playCatalog(s, card.title, card.kind, () => bingeNote({ id: cardId, why: "missing", app: appId, at: Date.now(), title: card.title }));
  };

  // a row opened in full (2026-09-22, "I can't actually see those 988"): the same row and the same rule, all of it - Yours is the
  // household's own titles in the genre, the catalog rows are read deeper (up to BROWSE_FULL_SIZE)
  const videoBrowseRow = (genreArg: string | null, rowArg: string, offerArg?: string | null, wantArg?: number | null): Record<string, unknown> => {
    const genre = browseGenre(genreArg) ?? browseGenre(tilesRead("video:browse-genre")) ?? BROWSE_GENRES[0]!;
    const offer = browseOfferOf(offerArg ?? tilesRead("video:browse-offer"));
    const offerWords = BROWSE_OFFERS.find((o) => o.id === offer)!.words;
    const def = BROWSE_ROWS.find((r) => r.id === rowArg);
    if (!def) return { ok: false, error: "no row " + rowArg };
    const today = new Date().toISOString().slice(0, 10);
    const head = (dataDate: string) => ({ ...def, formula: def.formula.replace("{genre}", genre.name).replace("{offer}", offerWords), dataDate, genre: genre.id, genreName: genre.name, offer });
    if (def.id === "yours") {
      orchestrator.modelApps = () => model.snapshot().apps.map((a) => ({ id: a.id, ...(a.adapter ? { adapter: a.adapter } : {}), ...(a.catalogRef ? { catalogRef: a.catalogRef } : {}) }));
      const sv = videoServices();
      const order = model.snapshot().apps.map((a) => a.id);
      const names = [...sv.services].sort((a, b) => order.indexOf(a.app) - order.indexOf(b.app)).map((s) => ({ app: s.app, name: s.name, facet: s.facet, adapter: s.adapter }));
      const rows2 = orchestrator.videoMenuRows(names);
      const seen = new Set<string>();
      const household = [...rows2.continue, ...rows2.list, ...ownedCards()].filter((c) => { const k = dedupeKey(c.item.title); if (seen.has(k)) return false; seen.add(k); return true; });
      const yours = orchestrator.videoBrowseYours(household, genre.id);
      const size = Math.max(1, wantArg ?? 60);
      return { ok: true, ...head(today), cards: yours.cards.slice(0, size), total: yours.cards.length, done: true, more: yours.cards.length > size, reading: yours.unread };
    }
    const hasKey = orchestrator.lensHasKey();
    const entry = hasKey ? orchestrator.videoBrowseFull(genre.id, def.id as "top" | "newest" | "voted", hiddenServices(), offer, wantArg ?? undefined) : null;
    return { ok: true, ...head(entry ? new Date(entry.at).toISOString().slice(0, 10) : today), cards: entry?.cards ?? [], total: entry?.cards.length ?? 0, done: entry?.done ?? !hasKey, more: entry?.more ?? false, tmdbKey: hasKey };
  };
  // Browse by genre (2026-09-22, "only transparent algorithms"): browse.ts names the rows and their rules; the orchestrator reads;
  // this assembles the page - a chip per genre (with its count on the household's services), then Yours and the three discover rows,
  // each with its formula, source, region and data date. The genre chosen is kept on the device.
  const videoBrowse = (genreArg?: string | null, offerArg?: string | null): Record<string, unknown> => {
    const remembered = tilesRead("video:browse-genre");
    const genre = browseGenre(genreArg) ?? browseGenre(remembered) ?? BROWSE_GENRES[0]!;
    if (genreArg && genre.id !== remembered) { try { void drivers.store?.set("video:browse-genre", genre.id); } catch (e) { report(e); } }
    // the offer filter (Included by default): the person's choice kept on the device
    const offerWas = tilesRead("video:browse-offer");
    const offer = offerArg ? browseOfferOf(offerArg) : browseOfferOf(offerWas);
    if (offerArg && offer !== browseOfferOf(offerWas)) { try { void drivers.store?.set("video:browse-offer", offer); } catch (e) { report(e); } }
    const offerWords = BROWSE_OFFERS.find((o) => o.id === offer)!.words;
    orchestrator.modelApps = () => model.snapshot().apps.map((a) => ({ id: a.id, ...(a.adapter ? { adapter: a.adapter } : {}), ...(a.catalogRef ? { catalogRef: a.catalogRef } : {}) }));
    const services = hiddenServices();
    const hasKey = orchestrator.lensHasKey();
    const counts = hasKey ? orchestrator.videoBrowseCounts(services, offer) : {};
    const entry = hasKey ? orchestrator.videoBrowseStart(genre.id, services, offer) : null;
    // Yours: the household's titles - Continue watching, My list, the Library - each title once
    const sv = videoServices();
    const order = model.snapshot().apps.map((a) => a.id);
    const names = [...sv.services].sort((a, b) => order.indexOf(a.app) - order.indexOf(b.app)).map((s) => ({ app: s.app, name: s.name, facet: s.facet, adapter: s.adapter }));
    const menuRows = orchestrator.videoMenuRows(names);
    const seen = new Set<string>();
    const household = [...menuRows.continue, ...menuRows.list, ...ownedCards()].filter((c) => { const k = dedupeKey(c.item.title); if (seen.has(k)) return false; seen.add(k); return true; });
    const yours = orchestrator.videoBrowseYours(household, genre.id);
    const today = new Date().toISOString().slice(0, 10);
    const dataDate = entry ? new Date(entry.at).toISOString().slice(0, 10) : today;
    const def = (id: string) => { const d = BROWSE_ROWS.find((r) => r.id === id)!; return { ...d, formula: d.formula.replace("{genre}", genre.name).replace("{offer}", offerWords), dataDate: id === "yours" ? today : dataDate }; };
    return {
      tmdbKey: hasKey, region: BROWSE_REGION, genre: genre.id, genreName: genre.name, done: entry?.done ?? true,
      offer, offers: BROWSE_OFFERS.map((o) => ({ id: o.id, label: o.label, hint: o.hint })),
      genres: BROWSE_GENRES.map((g) => ({ id: g.id, name: g.name, count: (counts as Record<string, number | null>)[g.id] ?? null })),
      rows: [
        { ...def("yours"), cards: yours.cards, reading: yours.unread },
        ...(hasKey ? (["top", "newest", "voted"] as const).map((id) => ({ ...def(id), cards: entry?.rows[id] ?? [] })) : []),
      ],
    };
  };

  const videoTune = (facetId: string, channelId: string, url: string | null, name: string | null): Record<string, unknown> => {
    const sv = videoServices();
    const s = sv.services.find((x) => x.facet === facetId);
    if (!s) return { ok: false, error: "unknown service " + facetId };
    const hasTune = !!orchestrator.adapterSpec(s.adapter)?.videoTune;
    if (!hasTune) return videoPlayOn(facetId, "live", "live:" + channelId, url, name ?? channelId);   // no script: the channel's own address, as any title
    // Read live 2026-09-19: Peacock's app mounts only when reached the way a person reaches it - a deep link into a fresh
    // document leaves the navigation bar and nothing else, while the app's own Channels link from a mounted home opens the
    // live player with its guide. So a service with a tune script is never sent to an address: on the screen, the press
    // goes to the page now and the script walks the app's own route; off the screen, the screen becomes the service (its
    // home mounts) and the press waits for the page.
    const mv = mvPlace(facetId);
    if (mv) {
      if (mv.ready) orchestrator.videoTune(mv.tile, channelId).then((r) => { if (r !== "ok") report(new Error("videoTune " + facetId + ": " + r)); }, report);
      else orchestrator.videoTuneWhenUp(mv.tile, channelId);
      return { ok: true, switched: !mv.ready, multiview: true, ...(mv.sceneId ? { sceneId: mv.sceneId } : {}) };
    }
    if (sv.active && sv.screen?.facet === facetId) {
      orchestrator.videoTune(sv.screen.slot, channelId).then((r) => { if (r !== "ok") report(new Error("videoTune " + facetId + ": " + r)); }, report);
      return { ok: true, switched: false };
    }
    const r = videoSwitch(facetId);
    if (r.ok && typeof r.slot === "string") orchestrator.videoTuneWhenUp(r.slot, channelId);
    return { ...r, switched: true };
  };
  const videoPlayOn = (facetId: string, kind: string, id: string, url: string | null, name: string | null): Record<string, unknown> => {
    orchestrator.notePersonAbout();   // a pick: a person is about
    // a series straight to the episode left partway, when the wall saw it (2026-09-25, Paramount+'s slow starts): the show page's load is
    // skipped; an episode left near its end, or never seen here, still goes through the show page, which moves on to the next one
    { const pf = model.facet(facetId); if (pf) orchestrator.notePickStarting(pf.app); }   // its background reading waits (orchestrator.pickQuiet)
    if (kind === "series" && name && url) {
      const f = model.facet(facetId);
      const adapterKey = f ? model.app(f.app)?.adapter ?? null : null;
      const ep = adapterKey ? orchestrator.videoSeriesEpisodeUrl(adapterKey, name) : null;
      let same = false;
      try { same = !!ep && new URL(ep).host === new URL(url).host && ep !== url; } catch { same = false; }
      if (ep && same) { kind = "episode"; id = ep; url = ep; }
    }
    const mv = mvPlace(facetId);
    if (mv) {
      if (mv.ready) orchestrator.videoPlay(mv.tile, kind, id, url, name ?? undefined).then((r) => { if (r !== "ok") report(new Error("videoPlayOn " + facetId + ": " + r)); }, report);
      else orchestrator.videoPlayWhenUp(mv.tile, { kind, id, url, ...(name ? { name } : {}) });
      return { ok: true, switched: !mv.ready, multiview: true, tile: mv.tile, ...(mv.sceneId ? { sceneId: mv.sceneId } : {}) };
    }
    const sv = videoServices();
    if (sv.active && sv.screen?.facet === facetId) {
      orchestrator.videoPlay(sv.screen.slot, kind, id, url, name ?? undefined).then((r) => { if (r !== "ok") report(new Error("videoPlayOn " + facetId + ": " + r)); }, report);
      return { ok: true, switched: false };
    }
    const r = videoSwitch(facetId);
    if (r.ok && typeof r.slot === "string") orchestrator.videoPlayWhenUp(r.slot, { kind, id, url, ...(name ? { name } : {}) });
    return { ...r, switched: true };
  };
  const switchPlayer = (kind: string): Record<string, unknown> => {
    if (!isPlayerKind(kind)) return { ok: false, error: "unknown player " + kind };
    const found = playersNow();
    const target = found[kind];
    if (!target) return { ok: false, reason: "no-scene", template: PLAYER_TEMPLATES[kind][0] };
    const leaving = model.activeScene() !== target.id;
    let after: (() => void) | undefined;
    if (kind === "video") {
      if (found.music) {
        const carried = carryHiddenMusic(target, found.music, (id) => model.facet(id));
        if (carried) { const r = model.saveScene(carried); if (!r.ok) report(new Error("switchPlayer: could not carry the music sources: " + r.error)); }
      }
      if (leaving) {
        const sources = new Set(orchestrator.musicSourceTiles().map((s) => s.tile));
        playerReturn = orchestrator.getState()?.tiles.find((t) => sources.has(t.id) && t.nowPlaying?.playing)?.id ?? null;
      }
    } else if (leaving) {
      const back = playerReturn;
      playerReturn = null;
      after = () => {
        if (!back || !orchestrator.musicSourceTiles().some((s) => s.tile === back)) return;
        if (orchestrator.getState()?.tiles.find((t) => t.id === back)?.nowPlaying?.playing) return;   // never paused: nothing to resume
        orchestrator.tileCommand(back, "play").then((r) => { if (r !== "ok") report(new Error("switchPlayer: resume " + back + ": " + r)); }, report);
      };
    }
    // the Music player's sources woken if the live budget had put them to sleep while the Video player was on (2026-09-24)
    const wake = kind === "music" ? () => { orchestrator.wakeTiles(orchestrator.musicSourceTiles().map((s) => s.tile)).then(() => after?.(), report); } : after;
    return { ...applyScene(target.id, wake), kind, sceneId: target.id };
  };
  // Multi-service lounge (2026-09-07): the visual follows the music a person picked. Every stage in the
  // active scene that draws another source moves to this one - in the scene's own record (so the next
  // boot agrees) and on the wall (resourceVisualization). A stage already on it is left alone.
  const followMusic = (tileId: string): void => {
    try {
      const active = model.activeScene();
      const scene = active ? model.scene(active) : undefined;
      const facet = itemContext(tileId)?.facet ?? tileId;
      if (scene?.visualizations?.some((v) => v.source !== facet)) {
        model.saveScene({ ...scene, visualizations: scene.visualizations.map((v) => ({ ...v, source: facet })) });
      }
      for (const s of orchestrator.musicSourceTiles()) if (s.tile !== tileId) for (const stage of s.stages) orchestrator.resourceVisualization(stage, tileId).catch(report);
    } catch (e) { report(e); }
  };
  // §6a: what an on-scene item is in the model (slot / floating / visualization id → facet + app)
  const itemContext = (itemId: string): { facet?: string | null; app?: string | null } | null => {
    const active = model.activeScene();
    const scene = active ? model.scene(active) : undefined;
    if (!scene) return null;
    const base = itemId.replace(/-\d+$/, "");
    const viz = scene.visualizations?.find((v) => v.id === itemId || v.id === base);
    const facetId = viz ? viz.source : scene.assign[itemId] ?? (model.facet(itemId) ? itemId : model.facet(base) ? base : null);
    const facet = facetId ? model.facet(facetId) : undefined;
    return { facet: facet?.id ?? null, app: facet?.app ?? null };
  };
  // B-217 (2026-09-16): "Receiving 'Apple music needs attention - sign in', why? I go into the player and it's already signed
  // in" - Apple's web player shows its Sign In control for a few seconds after every load, before the account chrome lands
  // (host.log: signed-out at 14:14:53, signed-in at 14:14:57, on every boot; the first is the one recycle, the second was
  // believed). A signed-out becomes needs-attention only once it has stood for SESSION_SETTLE_MS with no signed-in after
  // it; a signed-in is written at once. Section 26 in spirit: cover slow, uncover fast.
  const SESSION_SETTLE_MS = 15_000;
  const sessionSettle = new Map<string, ReturnType<typeof setTimeout>>();
  orchestrator.setSceneHooks({
    apply: (id) => applyScene(id),
    ids: () => model.snapshot().scenes.map((sc) => sc.id),
    active: () => model.activeScene(),
    itemContext,
  });
  remote.sceneContext = {
    itemContext,
    route: (route, source, id) => drivers.ui?.route(route, source, id),
  };

  return {
    init(docJson, w, h, optionsJson) {
      if (optionsJson) {
        try {
          const opts = JSON.parse(optionsJson) as {
            maxLiveTiles?: number;
            adapters?: Record<string, import("./adapters.js").AdapterSpec>;
            compat?: import("./compat.js").CompatContext;
            /** §25 decode cap + peek floor for this device class. */
            previewBudget?: import("./preview.js").PreviewBudget;
            /** §27/§5 attributed element-hiding lists (legacy; prefer `blocking`). */
            cosmeticSources?: import("./veil.js").CosmeticSourceSpec[];
            /** §5 block sources with bundled baseline text; core syncs and applies them. */
            blocking?: { sources: import("./blocking.js").BlockSourceSpec[] };
            /** §28 shell version + static manifest URL. */
            update?: import("./updates.js").UpdateConfig;
            /** §14 what this shell can serve from its capture mix. */
            audio?: { transports: Array<"webrtc" | "http">; streamPath?: string };
          };
          if (typeof opts.maxLiveTiles === "number") {
            orchestrator.setMaxLiveTiles(opts.maxLiveTiles);
          }
          if (opts.adapters) orchestrator.setAdapters(opts.adapters);
          if (opts.compat) orchestrator.setCompatContext(opts.compat);
          if (opts.previewBudget) orchestrator.setPreviewBudget(opts.previewBudget);
          if (opts.cosmeticSources) orchestrator.setCosmeticSources(opts.cosmeticSources);
          if (opts.blocking) orchestrator.startBlocking(opts.blocking.sources).catch(report);
          if (opts.audio) {
            bridgeAudio.transports = opts.audio.transports;
            bridgeAudio.streamPath = opts.audio.streamPath ?? null;
            orchestrator.setAudioTransports(opts.audio.transports);
          }
          if (opts.update) orchestrator.startUpdates(opts.update).catch(report);
          orchestrator.restoreVpn().catch(report); // §21: tunnel before tiles
        } catch (e) {
          report(e);
        }
      }
      const parsed = JSON.parse(docJson) as DashboardDocument | DashboardBundle;
      if ("dashboards" in parsed) {
        orchestrator.loadBundle(parsed, { w, h }).catch(report);
      } else {
        // B-106/B-120 boot reconcile: the persisted document is a CACHE of the active scene's projection.
        // Project the scene fresh at boot - same ids, same store keys (§10), the persisted document as the
        // base for everything a projection does not own - so a repaired projection reaches the wall on the
        // next start instead of the next hand-apply. The persisted document stands when there is no active
        // scene, the scene is gone, or the model could not load.
        modelLoaded.then(() => {
          let doc = parsed;
          try {
            const active = model.activeScene();
            const m = active && parsed.id ? model.materialize(active, { w, h }, parsed.id, parsed) : null;
            if (m) doc = { ...m.doc, id: parsed.id };
          } catch (e) { report(e); }
          return orchestrator.load(doc, { w, h });
        }).then(() => { try { videoServices(); videoRefreshLists(false); videoMenu(); } catch { /* no video services yet */ } finally { bootRowsAsked = true; } }, report);   // Phase 2: the services' kept rows read now, so the menu's first open is full; the lists from their own pages; the lens cache (ratings) read back at boot (§4a)
      }
    },
    resize(w, h) {
      orchestrator.resize({ w, h }).catch(report);
    },
    event(json) {
      const ev = JSON.parse(json) as SurfaceEvent;
      orchestrator.onSurfaceEvent(ev).catch(report);
      // Phase 2: the rows a person browses on an App's popped-out page (App setup, the sign-in wizard) are kept the way
      // the screen's are - the surface is app:<id>:preview, the rows belong to the App
      if (ev.type === "now-playing" && /^app:.+:(preview|lookup|work)$/.test(ev.id)) {
        try {
          const lookup = ev.id.endsWith(":lookup") || ev.id.endsWith(":work");   // the background work page answers the profile gate as the lookup page does
          const appId = ev.id.replace(/^app:/, "").replace(/:(preview|lookup|work)$/, "");
          const app = model.app(appId);
          const key = app?.adapter ?? app?.catalogRef ?? orchestrator.adapterNameForUrl(app?.baseUrl) ?? appId;
          if (lookup) orchestrator.videoObserveLookup(ev.id, key, ev.info); else orchestrator.videoObservePreview(key, ev.info);
        } catch (e) { report(e); }
      }
      // B-123: the session watch's verdict becomes the App's setup status, evidence "probe" - the same
      // fact the sign-in wizard records, now kept current by the wall itself. Written only on change.
      // B-129: the stage follows whichever source is audible - a play started in the service's own page (setup,
      // the revealed player) moves the visual and its transport there, the same as a Quick play pick would
      if (ev.type === "now-playing" && ev.info?.playing && orchestrator.getState()?.audioOwner === ev.id) followMusic(ev.id);
      if (ev.type === "session" && orchestrator.sessionOf(ev.id) === ev.state) {   // B-124: a boot-window signed-out that triggers the one recycle is not believed
        const write = (status: "signed-in" | "needs-attention") => {
          try {
            const appId = itemContext(ev.id)?.app;
            const app = appId ? model.app(appId) : undefined;
            if (app && app.setup?.status !== status) model.saveApp({ ...app, setup: { status, lastVerified: new Date().toISOString().slice(0, 10), evidence: "probe" } });
          } catch (e) { report(e); }
        };
        const standing = sessionSettle.get(ev.id);
        if (standing) { clearTimeout(standing); sessionSettle.delete(ev.id); }
        if (ev.state === "signed-in") write("signed-in");
        else sessionSettle.set(ev.id, setTimeout(() => { sessionSettle.delete(ev.id); if (orchestrator.sessionOf(ev.id) === "signed-out") write("needs-attention"); }, SESSION_SETTLE_MS));   // B-217
      }
    },
    input(json) {
      orchestrator.onInput(JSON.parse(json) as InputEvent).catch(report);
    },
    promoteHero(tileId) {
      orchestrator.promoteHero(tileId).catch(report);
    },
    setHeroSize(size, commit) {
      orchestrator.setHeroSize(size, commit).catch(report);
    },
    refreshTile(tileId) {
      orchestrator.refreshTile(tileId);
    },
    http(requestId, requestJson) {
      const respond = (status: number, body: string, contentType: string) =>
        send("http.response", { requestId, status, body, contentType });
      try {
        const req = JSON.parse(requestJson) as RemoteRequest;
        remote.handle(req).then(
          (res) => respond(res.status, res.body, res.contentType),
          (e) => respond(500, JSON.stringify({ error: String(e) }), "application/json"),
        );
      } catch (e) {
        respond(400, JSON.stringify({ error: String(e) }), "application/json");
      }
    },
    addCatalogTile(entryJson, choicesJson, selectorTableJson) {
      try {
        const entry: unknown = JSON.parse(entryJson);
        if (!validCatalogEntry(entry)) { report(new Error("addCatalogTile: invalid catalog entry")); return; }
        const choices = JSON.parse(choicesJson || "{}") as PickerChoices;
        const table = selectorTableJson ? (JSON.parse(selectorTableJson) as Record<string, string>) : undefined;
        const tile = pickerTile(entry, choices, table);
        orchestrator.addTile(tile, (entry as { name?: string }).name).then((r) => {   // §34 the registry learns the app's catalog name
          if (r !== "ok") report(new Error("addCatalogTile: " + r));
        }, report);
      } catch (e) {
        report(e);
      }
    },
    removeTile(tileId) {
      orchestrator.removeTile(tileId).then((r) => {
        if (r !== "ok") report(new Error("removeTile: " + r));
      }, report);
    },
    toggleFullscreen(tileId) {
      const st = orchestrator.getState();
      if (st && st.fullscreen === tileId) orchestrator.exitFullscreen().catch(report);
      else orchestrator.enterFullscreen(tileId).then((ok) => {
        if (!ok) report(new Error("toggleFullscreen: unknown tile " + tileId));
      }, report);
    },
    markPlan(baseUrl, html) {
      try { return JSON.stringify({ candidates: markIcons(String(html ?? ""), String(baseUrl ?? "")) }); } catch { return JSON.stringify({ candidates: [] }); }
    },
    posterPlan(name, baseUrl, html, manifestJson) {
      try {
        const mUrl = manifestUrl(html, baseUrl);
        const candidates = [
          ...(manifestJson && mUrl ? manifestIcons(manifestJson, mUrl) : []),
          ...htmlIcons(html, baseUrl),
        ];
        return JSON.stringify({ manifestUrl: mUrl, candidates, wordmark: wordmark(name, html) });
      } catch (e) {
        report(e);
        return JSON.stringify({ manifestUrl: null, candidates: [], wordmark: wordmark(name, null) });
      }
    },
    switchTo(dashboardId) {
      orchestrator.switchTo(dashboardId).catch(report);
    },
    mintPairing(baseUrl, onlyIfUnpaired) {
      const go = (): Promise<void> =>
        remote.mintPairing(baseUrl).then(({ url, token }) => send("remote.pairing", { url, token }));
      const p = onlyIfUnpaired
        ? remote.pruneUnused().then(() => remote.pairedCount()).then((n) => (n ? send("remote.paired-count", { n }) : go()))
        : go();
      p.catch(report);
    },
    rects() {
      return JSON.stringify(orchestrator.rects());
    },
    resolve(requestId, resultJson, error) {
      resolveRequest(requestId, resultJson, error);
    },
    redeemStreamTicket(ticket) {
      return remote.redeemStreamTicket(ticket) ?? "";
    },
    state() {
      return JSON.stringify(orchestrator.getState());
    },
    setTileMode(tileId, mode) {
      orchestrator.setTileMode(tileId, mode).catch(report);
    },
    updateTile(tileId, patchJson) {
      try {
        const patch = JSON.parse(patchJson) as TilePatch;
        orchestrator.updateTile(tileId, patch).then((r) => {
          if (r !== "ok") report(new Error("updateTile: " + r));
        }, report);
      } catch (e) {
        report(e);
      }
    },
    setLayout(layoutJson) {
      try {
        const req = JSON.parse(layoutJson) as LayoutRequest;
        orchestrator.setLayout(req).then((r) => {
          if (r !== "ok") report(new Error("setLayout: " + r));
        }, report);
      } catch (e) {
        report(e);
      }
    },
    addCustomTile(url, choicesJson) {
      try {
        const choices = JSON.parse(choicesJson || "{}") as PickerChoices;
        const tile = customTile(url, choices);
        if (!tile) { report(new Error("addCustomTile: not an http(s) URL")); return; }
        // dedupe against the wall (the picker's own nicety; core still enforces)
        const taken = new Set((orchestrator.getState()?.tiles ?? []).map((t) => t.id));
        const base = tile.id;
        for (let n = 2; taken.has(tile.id); n++) tile.id = base + "-" + n;
        if (tile.id !== base && !choices.profile) tile.profile = tile.id;
        orchestrator.addTile(tile).then((r) => {
          if (r !== "ok") report(new Error("addCustomTile: " + r));
        }, report);
      } catch (e) {
        report(e);
      }
    },
    replaceWithCatalogTile(tileId, entryJson, choicesJson, selectorTableJson) {
      try {
        const entry: unknown = JSON.parse(entryJson);
        if (!validCatalogEntry(entry)) { report(new Error("replaceWithCatalogTile: invalid catalog entry")); return; }
        const choices = JSON.parse(choicesJson || "{}") as PickerChoices;
        const table = selectorTableJson ? (JSON.parse(selectorTableJson) as Record<string, string>) : undefined;
        orchestrator.replaceTile(tileId, pickerTile(entry, choices, table), (entry as { name?: string }).name).then((r) => {
          if (r !== "ok") report(new Error("replaceWithCatalogTile: " + r));
        }, report);
      } catch (e) {
        report(e);
      }
    },
    replaceWithCustomTile(tileId, url) {
      const tile = customTile(url);
      if (!tile) { report(new Error("replaceWithCustomTile: not an http(s) URL")); return; }
      orchestrator.replaceTile(tileId, tile).then((r) => {
        if (r !== "ok") report(new Error("replaceWithCustomTile: " + r));
      }, report);
    },
    saveShortcut(tileId, shortcutJson) {
      try {
        const input = JSON.parse(shortcutJson) as { label: string; url?: string; focus?: import("./types.js").FocusSpec | null; aspectHint?: string | null };
        orchestrator.saveShortcut(tileId, input).then((r) => {
          if (r !== "ok") report(new Error("saveShortcut: " + r));
        }, report);
      } catch (e) {
        report(e);
      }
    },
    removeShortcut(tileId, shortcutId) {
      orchestrator.removeShortcut(tileId, shortcutId).then((r) => {
        if (r !== "ok") report(new Error("removeShortcut: " + r));
      }, report);
    },
    applyShortcut(tileId, shortcutId) {
      orchestrator.applyShortcut(tileId, shortcutId).then((r) => {
        if (r !== "ok") report(new Error("applyShortcut: " + r));
      }, report);
    },
    tileCommand(tileId, cmd) {
      orchestrator.tileCommand(tileId, cmd).then((r) => {
        if (r !== "ok") report(new Error("tileCommand " + cmd + ": " + r));
      }, report);
    },
    tapItem(tileId) {
      // Fire-and-forget: the promote half is async. The verdict reaches the
      // shell as ui.tapResult (the orchestrator reports every tap it resolves,
      // the remote's included), so there is one answer for both paths.
      orchestrator.tapItem(tileId).catch(report);
    },
    saveMasterLayout(layoutJson) {
      try {
        orchestrator.saveMasterLayout(JSON.parse(layoutJson)).then((r) => {
          if (r !== "ok") report(new Error("saveMasterLayout: " + r));
        }, report);
      } catch (e) {
        report(e);
      }
    },
    removeMasterLayout(id) {
      orchestrator.removeMasterLayout(id).then((r) => {
        if (r !== "ok") report(new Error("removeMasterLayout: " + r));
      }, report);
    },
    applyMasterLayout(id) {
      orchestrator.applyMasterLayout(id).then((r) => {
        if (r !== "ok") report(new Error("applyMasterLayout: " + r));
      }, report);
    },
    previewLayout(layoutJson, w, h) {
      try {
        return JSON.stringify(orchestrator.previewLayout(JSON.parse(layoutJson), { w, h }));
      } catch (e) {
        report(e);
        return "null";
      }
    },
    slotPurposes() {
      return JSON.stringify(SLOT_PURPOSES);
    },
    popupDecision(pageUrl, popupUrl, userInitiated) {
      try {
        const attempt: PopupAttempt = {
          site: popupHost(pageUrl),
          url: popupUrl,
          ...(userInitiated ? { gesture: { windowsThisGesture: 1 } } : {}),
        };
        const decision = popups.evaluate(attempt);
        popups.record(attempt, decision);
        return JSON.stringify(decision);
      } catch (e) {
        report(e);
        return JSON.stringify({ action: "intercept", reason: "policy error" });
      }
    },
    saveScene(sceneJson) {
      try {
        orchestrator.saveScene(JSON.parse(sceneJson)).then((r) => {
          if (r !== "ok") report(new Error("saveScene: " + r));
        }, report);
      } catch (e) {
        report(e);
      }
    },
    removeScene(id) {
      orchestrator.removeScene(id).then((r) => {
        if (r !== "ok") report(new Error("removeScene: " + r));
      }, report);
    },
    applyScene(id) {
      orchestrator.applyScene(id).then((r) => {
        if (r !== "ok") report(new Error("applyScene: " + r));
      }, report);
    },
    similarLayouts(layoutJson, w, h) {
      try {
        return JSON.stringify(orchestrator.similarLayouts(JSON.parse(layoutJson), { w, h }));
      } catch (e) {
        report(e);
        return "[]";
      }
    },
    tilesGet(key) {
      const doc = readTilesDoc(key, tilesRead(key));
      return doc ? json(doc) : "null";
    },
    tilesApply(key, intentJson) {
      const intent = parseTilesIntent(intentJson);
      if (!intent) return json({ ok: false, error: "not a micro-facet edit" });
      const result = applyTilesIntent(key, tilesRead(key), intent);
      if (!result) return json({ ok: false, error: "'" + key + "' is not a micro-facet document" });
      if (result.ok && result.changed) {
        try { void drivers.store?.set(key, JSON.stringify(result.doc)); } catch (e) { report(e); }
      }
      return json(result.ok ? { ok: true, doc: result.doc, changed: result.changed } : { ok: false, error: result.error ?? "refused" });
    },
    listeningChips() {
      // §14 chips for the wall. The paired-device NAMES come from the remote
      // store (that is where pairing lives); the tokens are the map key only
      // and core drops them before a chip exists - nothing rendered, logged or
      // sent carries one (§22).
      refreshListenerNames();          // for the next call; this one uses what we hold
      try {
        return json(orchestrator.listeningChips(listenerNames));
      } catch (e) {
        report(e);
        return "[]";
      }
    },
    modelState() {
      return json(model.snapshot());
    },
    modelSaveApp(appJson) {
      try { return json(model.saveApp(JSON.parse(appJson))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    modelSaveFacet(facetJson) {
      try { return json(model.saveFacet(JSON.parse(facetJson))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    modelRemoveFacet(facetId) {
      return model.removeFacet(facetId);
    },
    modelSaveLayout(layoutJson) {
      try { return json(model.saveLayout(JSON.parse(layoutJson))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    modelLayoutDuplicates(layoutJson) {
      try { return json(model.duplicatesOf(JSON.parse(layoutJson))); } catch (e) { report(e); return "[]"; }
    },
    modelArchiveLayout(layoutId, archived) {
      return model.archiveLayout(layoutId, archived !== false);
    },
    modelSaveScene(sceneJson) {
      try { return json(model.saveScene(JSON.parse(sceneJson))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    modelRemoveScene(sceneId) {
      return model.removeScene(sceneId);
    },
    modelApplyScene(sceneId) {
      return json(applyScene(sceneId));
    },
    players() {
      try { return json(players()); } catch (e) { report(e); return json({ active: null, music: null, video: null }); }
    },
    videoState() {
      try { return json(orchestrator.videoState()); } catch (e) { report(e); return "[]"; }
    },
    async videoLibrary(tileId) {
      try { return json(await orchestrator.videoLibrary(tileId)); } catch (e) { report(e); return json({ continue: [], list: [] }); }
    },
    videoPlay(tileId, kind, id, url, name) {
      orchestrator.videoPlay(tileId, kind, id, url ?? null, name ?? undefined).then((r) => { if (r !== "ok") report(new Error("videoPlay " + tileId + ": " + r)); }, report);
    },
    videoServices() {
      try { return json(videoServices()); } catch (e) { report(e); return json({ scene: null, active: false, screen: null, services: [] }); }
    },
    videoSwitch(facetId) {
      try { return json(videoSwitch(facetId)); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoPlayOn(facetId, kind, id, url, name) {
      try { return json(videoPlayOn(facetId, kind, id, url ?? null, name ?? null)); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoMenu() {
      try { return json(videoMenu()); } catch (e) { report(e); return json({ continue: [], list: [], live: [], services: [], search: [], suggestions: [], screen: null, active: false, log: 0, now: Date.now() }); }
    },
    videoTune(facetId, channelId, url, name) {
      try { return json(videoTune(facetId, channelId, url ?? null, name ?? null)); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoSearch(facetId, q, open) {
      try { return json(videoSearch(facetId, String(q ?? ""), open ?? null)); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    titleDetailsById(kind, id) {
      try { return json(withPlay(orchestrator.titleDetailsById(kind === "tv" ? "tv" : "movie", Number(id)))); } catch (e) { report(e); return json({ status: "none", why: String(e) }); }
    },
    personPage(id) {
      try { return json(orchestrator.personPage(Number(id))); } catch (e) { report(e); return json({ status: "none", why: String(e) }); }
    },
    videoLookup(q) {
      try { return json(videoLookup(String(q ?? ""))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoLookupPerson(id, name) {
      try { return json(videoLookupPerson(Number(id), String(name ?? ""))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoLibraryTab(sort, group) { try { return json(videoLibraryTab(sort ?? null, group ?? null)); } catch (e) { report(e); return json({ rows: [], pending: 0, rated: 0, total: 0, twice: 0, services: [], tmdbKey: false }); } },
    videoLookupState() {
      try { return json(videoLookupNow()); } catch (e) { report(e); return "null"; }
    },
    videoBrowse(genre, offer) {
      try { return json(videoBrowse(genre ? String(genre) : null, offer ? String(offer) : null)); } catch (e) { report(e); return json({ tmdbKey: false, genres: [], rows: [], done: true, error: String(e) }); }
    },
    videoBrowseRow(genre, row, offer, want) {
      try { return json(videoBrowseRow(genre ? String(genre) : null, String(row ?? ""), offer ? String(offer) : null, typeof want === "number" ? want : null)); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoBrowsePlay(appId, cardId) {
      try { return json(videoBrowsePlay(String(appId ?? ""), String(cardId ?? ""))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoBingeView() { try { return json(videoBingeView()); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    videoBingeSet(thresholdsJson, kidsJson, animation) { try { return json(videoBingeSet(thresholdsJson ?? null, kidsJson ?? null, animation ?? null)); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    videoBingeHide(cardId, on, title) { try { const id = String(cardId ?? ""); bingeNote(on ? { id, why: "hidden", at: Date.now(), title: title ? String(title) : orchestrator.videoBingeTitle(id) ?? undefined } : null, id); return json({ ok: true }); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    videoBingeHidden() { try { return json(videoBingeHidden()); } catch (e) { report(e); return json({ items: [] }); } },
    videoBingePlay(appId, cardId) { try { return json(videoBingePlay(String(appId ?? ""), String(cardId ?? ""))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    videoLookupView(genre, app) {
      try { return json(videoLookupFiltered(genre ? String(genre) : null, app ? String(app) : null)); } catch (e) { report(e); return "null"; }
    },
    videoPlayResult(appId, candidateJson) {
      try { return json(videoPlayResult(appId, String(candidateJson ?? ""))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoProfile(tileId, id, always) {
      orchestrator.videoProfile(tileId, id, always === true).then((r) => { if (r !== "ok") report(new Error("videoProfile " + tileId + ": " + r)); }, report);
    },
    videoSeek(tileId, seconds) { return orchestrator.videoSeek(String(tileId), Number(seconds)); },
    videoTrack(tileId, kind, id) {
      const k = kind === "audio" ? "audio" : "subtitles";
      orchestrator.videoTrack(tileId, k, String(id ?? "")).then((r) => { if (r !== "ok") report(new Error("videoTrack " + tileId + ": " + r)); }, report);
    },
    videoProfileChoose(appId, profileId) {
      try {
        const s = videoServices().services.find((x) => x.app === appId);
        if (!s) return json({ ok: false, error: "unknown service " + appId });
        const r = orchestrator.videoChooseProfile(s.adapter, String(profileId ?? ""));
        return json(r === "ok" ? { ok: true, name: orchestrator.videoStandingProfile(s.adapter)?.name ?? profileId } : { ok: false, error: r });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoRefreshLists(force) {
      try { return json(videoRefreshLists(force === true)); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoRefreshStale() { try { return json({ ok: true, asked: orchestrator.videoRefreshStale(hiddenServices()) }); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    videoFreshness() { try { orchestrator.videoRefreshStale(hiddenServices(), Number.MAX_SAFE_INTEGER); return json(orchestrator.videoFreshness()); } catch (e) { report(e); return json({}); } },
    videoUpdatesStatus() {
      try {
        const hs = hiddenServices();
        orchestrator.videoRefreshStale(hs, Number.MAX_SAFE_INTEGER);   // (names the services to core; reads nothing)
        return json(orchestrator.videoUpdatesStatus(hs.map((s) => ({ app: s.app, name: s.name, adapter: s.adapter, status: s.status }))));
      } catch (e) { report(e); return json({ services: [], feeds: [], ratings: null, schedule: null }); }
    },
    videoRefreshApp(appId) { try { return json({ ok: orchestrator.videoRefreshApp(hiddenServices(), String(appId ?? "")) }); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    videoSettings() {
      try { if (!pauseLoaded) { loadPause(); pauseLoaded = true; } return json({ pause: orchestrator.bgPause, tmdbKey: orchestrator.lensHasKey(), background: orchestrator.backgroundState() }); }
      catch (e) { report(e); return json({ pause: { on: false, from: "23:00", to: "07:00" }, tmdbKey: false }); }
    },
    videoSetPause(on, from, to) {
      try {
        const hm = (v: unknown, d: string) => (typeof v === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v) ? v.padStart(5, "0") : d);
        orchestrator.bgPause = { on: on === true, from: hm(from, orchestrator.bgPause.from), to: hm(to, orchestrator.bgPause.to) };
        pauseLoaded = true;
        void drivers.store?.set(BG_PAUSE_KEY, JSON.stringify(orchestrator.bgPause));
        return json({ ok: true, pause: orchestrator.bgPause });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    lensChoose(lensId) {
      try { return json({ ok: true, active: orchestrator.lensChoose(lensId ?? null) }); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    lensSetTmdbKey(key) {
      try { orchestrator.lensSetTmdbKey(key ?? null); return json({ ok: true, set: orchestrator.lensHasKey() }); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    lensHasKey() { try { return orchestrator.lensHasKey() ? "true" : "false"; } catch { return "false"; } },
    lensDiag() { try { return json(orchestrator.lensDiag()); } catch (e) { return json({ error: String(e) }); } },
    videoCancelPick() { try { pickGen++; return json(orchestrator.videoCancelPick()); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    /** Dev: hold an App's hidden work page at an address (null releases it) - reading a service's pages to write its adapter. */
    /** Dev: what the automatic removal retries did (2026-09-23). */
    listRetries() { return json(orchestrator.listRetries); },
    backgroundState() { return json(orchestrator.backgroundState()); },
    devHoldPage(appId: string, url: string | null, height?: number) { const s = hiddenServices().find((x) => x.app === String(appId)); if (!s) return "unknown app " + appId; void orchestrator.devHoldPage(s, url, typeof height === "number" ? height : undefined).catch(report); return "asked"; },
    videoHideContinue(appId, itemId) { try { const s = videoServices().services.find((x) => x.app === String(appId ?? "")); if (!s) return json({ ok: false, error: "unknown service" }); orchestrator.videoHideContinue(s.adapter, String(itemId ?? "")); return json({ ok: true }); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    videoRemoveInfo(appId) { try { const s = videoServices().services.find((x) => x.app === String(appId ?? "")); return json(s ? orchestrator.videoRemoveInfo(s.adapter) : { can: false, warning: null }); } catch (e) { report(e); return json({ can: false, warning: null }); } },
    videoListInfo(appId) { try { const s = videoServices().services.find((x) => x.app === String(appId ?? "")); return json(s ? orchestrator.videoListInfo(s.adapter) : { can: false, name: "My List" }); } catch (e) { report(e); return json({ can: false, name: "My List" }); } },
    videoListSet(appId, want, itemId, title, url, kind, catalog) {
      try {
        const s = hiddenServices().find((x) => x.app === String(appId ?? ""));
        if (!s) return json({ status: "failed", error: "unknown service" });
        const t = String(title ?? "");
        const item = { id: String(itemId ?? ""), title: t, kind: String(kind ?? "title"), ...(url ? { url: String(url) } : {}) };
        const resolve = catalog === "1" || (catalog === "auto" && orchestrator.isCatalogCandidate(String(itemId ?? ""))) ? () => orchestrator.videoCatalogResolve(s.app, t, hiddenServices()) : undefined;
        return json(orchestrator.videoListSet(s, String(want) === "add", item, resolve));
      } catch (e) { report(e); return json({ status: "failed", error: String(e) }); }
    },
    videoRemoveContinue(appId, itemId, title) { try { const s = hiddenServices().find((x) => x.app === String(appId ?? "")); return json(s ? orchestrator.videoRemoveContinue(s, String(itemId ?? ""), String(title ?? "")) : { status: "failed", error: "unknown service" }); } catch (e) { report(e); return json({ status: "failed", error: String(e) }); } },
    videoArtOf(tileId) { try { return json(orchestrator.videoArtOf(String(tileId ?? ""))); } catch (e) { report(e); return json({ title: null, art: null }); } },
    videoEpisodes() {
      try {
        const sv = videoServices();
        const s = sv.screen ? hiddenServices().find((x) => x.app === sv.screen!.app) ?? null : null;
        return json(sv.screen ? orchestrator.videoEpisodes(sv.screen.slot, s) : { ready: true, series: null, service: null, current: null, seasons: [], canPlay: false, source: null, error: "no Video player screen" });
      } catch (e) { report(e); return json({ ready: true, series: null, service: null, current: null, seasons: [], canPlay: false, source: null, error: String(e) }); }
    },
    titleDetails(title, kind, app) {
      try { return json(withPlay(orchestrator.titleDetails(String(title ?? ""), kind ? String(kind) : null, app ? String(app) : null))); }
      catch (e) { report(e); return json({ status: "none", why: String(e) }); }
    },
    videoPlayEpisodeNumber(season, episode) {
      try {
        const sv = videoServices();
        if (!sv.screen) return json({ ok: false, error: "no Video player screen" });
        const r = orchestrator.videoPlayEpisodeNumber(sv.screen.slot, Number(season), Number(episode));
        return json(r === "ok" ? { ok: true } : { ok: false, error: r === "unavailable" ? "this service cannot play a chosen episode yet" : r });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoPlayEpisode(episodeId) {
      try {
        const sv = videoServices();
        if (!sv.screen) return json({ ok: false, error: "no Video player screen" });
        const ep = orchestrator.videoEpisodeById(sv.screen.slot, sv.screen.app, String(episodeId ?? ""));
        if (!ep || !ep.id) return json({ ok: false, error: "not an episode the service listed" });
        return json(videoPlayOn(sv.screen.facet, "title", ep.id, ep.url, ep.title));
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoMultiview(action, arg) { try { return json(videoMultiview(String(action ?? "state"), arg === undefined || arg === null ? null : String(arg))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    titleAlsoOn(kind, id, title, viaApp) {
      // Hulu's shows in the Disney+ app (2026-09-25): not every title, and JustWatch lists them under Hulu alone - so Disney+ is asked, once per
      // title a week, when that title's Details opens; the page shows the answer when it comes
      try {
        const alsoApp = ALSO_VIA[String(viaApp ?? "")];
        const s = alsoApp ? hiddenServices().find((x) => x.app === alsoApp && x.status === "signed-in") : undefined;
        const name = alsoApp ? videoServices().services.find((x) => x.app === alsoApp)?.name ?? alsoApp : null;
        if (!s || !alsoApp) return json({ state: "n/a", app: alsoApp ?? null, name });
        const key = "v2|" + alsoApp + "|" + String(kind) + ":" + Number(id);   // v2: answers from before badge-free names and the page check are not trusted
        const kept = alsoMap()[key];
        if (kept && Date.now() - kept.at < ALSO_TTL_MS) return json({ state: kept.v ? "yes" : "no", app: alsoApp, name });
        if (!alsoChecking.has(key)) {
          alsoChecking.add(key);
          orchestrator.serviceCarries(s, String(title ?? "")).then((v) => {
            if (v === null) return;
            const m = alsoMap(); m[key] = { v, at: Date.now() };
            void drivers.store?.set(ALSO_KEY, JSON.stringify(m));
          }, report).finally(() => alsoChecking.delete(key));
        }
        return json({ state: "checking", app: alsoApp, name });
      } catch (e) { report(e); return json({ state: "n/a", app: null, name: null }); }
    },
    titleEpisodes(appId, series, itemId, season, episode) {
      orchestrator.notePersonAbout();
      // the Details page's episode picker (2026-09-24, "Show the current episode on the details screen, with a play button, but also the
      // episode selector lets them choose something else if needed"): the list the screen's Episodes menu reads, for any series on a service
      try {
        const s = hiddenServices().find((x) => x.app === String(appId ?? ""));
        const name = String(series ?? "").trim();
        if (!s || !name) return json({ ready: true, series: name || null, service: null, current: null, seasons: [], canPlay: false, source: null, error: s ? "no series named" : "unknown service" });
        const v = { kind: "episode", title: "", series: name, ...(itemId ? { id: String(itemId) } : {}), season: typeof season === "number" ? season : null, episode: typeof episode === "number" ? episode : null } as import("./types.js").VideoContext;
        return json(orchestrator.episodesOf(s, name, v));
      } catch (e) { report(e); return json({ ready: true, series: null, service: null, current: null, seasons: [], canPlay: false, source: null, error: String(e) }); }
    },
    videoEpisodeHealth() {
      episodeHealthResult = null;
      void orchestrator.episodeHealthReport().then((r) => { episodeHealthResult = r; }, (e) => { episodeHealthResult = { error: String(e) }; });
      return json({ started: true });
    },
    videoEpisodeHealthResult() { return json(episodeHealthResult); },
    videoEpisodesForget(appId, series) { return json({ ok: orchestrator.forgetEpisodeList(String(appId ?? ""), String(series ?? "")) }); },
    titleEpisodePlay(appId, series, season, episode) {
      try {
        const s = videoServices().services.find((x) => x.app === String(appId ?? ""));
        if (!s) return json({ ok: false, error: "unknown service " + appId });
        const name = String(series ?? "");
        const ep = orchestrator.episodeByNumber(s.app, name, Number(season), Number(episode));
        const label = `${name} S${Number(season)} E${Number(episode)}`;
        if (ep?.id && ep.url) return json(videoPlayOn(s.facet, "title", ep.id, ep.url, label));
        // no address for that episode (TMDB's list): the series on the service, through its own search
        return json(playCatalog(s, name, "series"));
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    bootTimings() {
      const rel = (t: number | null | undefined) => (typeof t === "number" ? t - bootAt : null);
      return json({ now: rel(Date.now()), rowsCache: rel(orchestrator.rowsCacheReadyAt), menuReady: rel(menuReadyAt), lists: Object.fromEntries([...orchestrator.firstListRead].map(([a, t]) => [a, rel(t)])) });
    },
    videoStartOver() {
      // the back-to-start button (2026-09-24, "a start over button to the video controls, go to the previous episode if in the first 5 seconds of the show or whatever
      // is typical"): past START_OVER_S the title starts again; within it an episode goes to the one before (the season's last of the season
      // before, when the Episodes list knows it); a film, the first episode or a list not known yet starts over
      try {
        const START_OVER_S = 5;
        const sv = videoServices();
        if (!sv.screen) return json({ ok: false, error: "no Video player screen" });
        const tile = sv.screen.slot;
        const v = orchestrator.videoState().find((x) => x.id === tile)?.video ?? null;
        const pos = typeof v?.position === "number" ? v.position : null;
        const start = () => { const r = orchestrator.videoSeek(tile, 0); return json(r === "ok" ? { ok: true, did: "start" } : { ok: false, error: String(r) }); };
        if (pos !== null && pos > START_OVER_S) return start();
        if (!v?.series || typeof v.season !== "number" || typeof v.episode !== "number") return start();
        let season = v.season, episode = v.episode - 1;
        const list = orchestrator.videoEpisodes(tile, hiddenServices().find((x) => x.app === sv.screen!.app) ?? null);
        if (episode < 1) {
          const before = list.seasons.find((x) => x.season === v.season! - 1);
          const last = before?.episodes.reduce((m, e) => Math.max(m, e.episode), 0) ?? 0;
          if (!last) return start();
          season = v.season - 1; episode = last;
        }
        // the episode's own address when the Episodes list has it (most services), else the service's episode-by-number control (Peacock)
        const ep = list.seasons.find((x) => x.season === season)?.episodes.find((e) => e.episode === episode);
        orchestrator.videoExpectEpisode(tile, { series: v.series, season, episode, title: ep?.title || `Episode ${episode}`, id: ep?.id ?? null });   // shown at once, not when the service says so
        if (ep?.id && ep.url) {
          const p = videoPlayOn(sv.screen.facet, "title", ep.id, ep.url, ep.title || `S${season} E${episode}`);
          if (p.ok) return json({ ok: true, did: "previous", season, episode });
        }
        const r = orchestrator.videoPlayEpisodeNumber(tile, season, episode);
        return r === "ok" ? json({ ok: true, did: "previous", season, episode }) : start();
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoResync() {
      try {
        const sv = videoServices();
        if (!sv.screen) return json({ ok: false, error: "no Video player screen" });
        const r = orchestrator.videoResync(sv.screen.slot);
        return json(r === "unavailable" ? { ok: false, error: "this service's player cannot be paused from Prism" } : { ok: true, did: r });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoNextEpisode(tileId) { try { const r = orchestrator.videoNextEpisode(tileId); const a = orchestrator.videoState().find((x) => x.id === tileId)?.adapter; return json({ ...r, service: hiddenServices().find((x) => x.adapter === a)?.name ?? null }); } catch (e) { report(e); return json({ ready: true, next: null, series: null }); } },
    lensDisclosure(title) {
      try { return json(orchestrator.lensDisclosure(String(title ?? ""))); } catch (e) { report(e); return json({ rating: null, links: [], facts: null }); }
    },
    videoForgetWatch(appId, what) {
      try {
        const s = videoServices().services.find((x) => x.app === appId);
        if (!s) return json({ ok: false, error: "unknown service " + appId });
        return json({ ok: true, removed: orchestrator.videoForgetWatch(s.adapter, String(what ?? "")) });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoProfilesView() { try { return json(profilesView()); } catch (e) { report(e); return json({ services: [], presets: [], active: null }); } },
    videoProfileSet(appId, profileId) {
      try {
        const asked = orchestrator.videoSwitchProfiles(hiddenServices(), { [String(appId ?? "")]: String(profileId ?? "") });
        if (!asked.length) return json({ ok: false, error: "not a profile this service has listed" });
        const st = presetsNow(); if (st.active) { st.active = null; presetsWrite(st); }   // a hand-picked profile: no preset is the one on now
        return json({ ok: true });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    // the Profiles window as a draft (2026-09-24, "let me switch and view and make changes without refreshing data UNTIL I save and exit this
    // window. Also give me a save & exit button"): the whole draft committed at once - only the services whose profile changed are switched
    videoProfilesCommit(draftJson) {
      try {
        const d = JSON.parse(String(draftJson ?? "{}")) as { picks?: Record<string, string>; off?: string[]; preset?: string | null; name?: string | null };
        const view0 = profilesView();
        const known = new Map(view0.services.map((s) => [s.app, s]));
        const picks: Record<string, string> = {};
        for (const [app, id] of Object.entries(d.picks ?? {})) {
          const s = known.get(app);
          if (!s || typeof id !== "string" || !id || !s.profiles.some((p) => p.id === id)) continue;
          picks[app] = id;
        }
        const allApps = new Set(videoServices().services.map((s) => s.app));
        const off = [...new Set((d.off ?? []).filter((a) => typeof a === "string" && allApps.has(a)))];
        // switch only what changed
        const changed = Object.fromEntries(Object.entries(picks).filter(([app, id]) => known.get(app)?.current?.id !== id && !off.includes(app)));
        const switched = Object.keys(changed).length ? orchestrator.videoSwitchProfiles(hiddenServices(), changed) : [];
        const st = presetsNow();
        st.off = off;
        const named = (app: string, id: string) => ({ id, name: known.get(app)?.profiles.find((p) => p.id === id)?.name ?? id });
        const presetPicks = Object.fromEntries(Object.entries(picks).map(([app, id]) => [app, named(app, id)]));
        // a preset: the one the draft was loaded from is updated, a new name makes a new one, else the preset that matches exactly is the one on
        const newName = typeof d.name === "string" ? d.name.trim().slice(0, 40) : "";
        let target: ProfilePreset | undefined = newName ? st.presets.find((p) => p.name.toLowerCase() === newName.toLowerCase()) : st.presets.find((p) => p.id === d.preset);
        if (newName || target) {
          let fresh = "p" + Date.now().toString(36);
          for (let i = 2; st.presets.some((p) => p.id === fresh); i++) fresh = "p" + Date.now().toString(36) + "-" + i;
          const preset: ProfilePreset = { id: target?.id ?? fresh, name: newName || target!.name, picks: presetPicks, off: [...off] };
          st.presets = target ? st.presets.map((p) => (p.id === target!.id ? preset : p)) : [...st.presets, preset];
          target = preset;
        }
        st.active = target?.id ?? null;
        presetsWrite(st);
        return json({ ok: true, switched, preset: target ? { id: target.id, name: target.name } : null });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoProfileExclude(appId, on) {
      try {
        const app = String(appId ?? "");
        if (!videoServices().services.some((s) => s.app === app)) return json({ ok: false, error: "unknown service" });
        const st = presetsNow();
        const was = st.off.includes(app);
        st.off = on === true ? (was ? st.off : [...st.off, app]) : st.off.filter((a) => a !== app);
        if (was !== st.off.includes(app)) st.active = null;   // the person on now no longer matches a saved preset until it is saved again
        presetsWrite(st);
        return json({ ok: true, excluded: st.off.includes(app) });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoPresetSave(name) {
      try {
        const n = String(name ?? "").trim().slice(0, 40);
        if (!n) return json({ ok: false, error: "a preset needs a name" });
        const picks: Record<string, { id: string; name: string }> = {};
        for (const s of profilesView().services) if (s.current) picks[s.app] = s.current;
        if (!Object.keys(picks).length && !presetsNow().off.length) return json({ ok: false, error: "no service has a profile chosen yet" });
        const st = presetsNow();
        const same = st.presets.find((p) => p.name.toLowerCase() === n.toLowerCase());
        let fresh = "p" + Date.now().toString(36);
        for (let i = 2; st.presets.some((p) => p.id === fresh); i++) fresh = "p" + Date.now().toString(36) + "-" + i;   // two saves in one millisecond
        const preset: ProfilePreset = { id: same?.id ?? fresh, name: n, picks, off: [...st.off] };
        st.presets = same ? st.presets.map((p) => (p.id === same.id ? preset : p)) : [...st.presets, preset];
        st.active = preset.id;
        presetsWrite(st);
        return json({ ok: true, preset });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoPresetDelete(presetId) {
      try {
        const st = presetsNow();
        st.presets = st.presets.filter((p) => p.id !== presetId);
        if (st.active === presetId) st.active = null;
        presetsWrite(st);
        return json({ ok: true });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoPresetApply(presetId) {
      try {
        const st = presetsNow();
        const p = st.presets.find((x) => x.id === presetId);
        if (!p) return json({ ok: false, error: "unknown preset" });
        const svcs = hiddenServices();
        const off = p.off ?? [];
        const picks = Object.fromEntries(Object.entries(p.picks).filter(([app]) => !off.includes(app)).map(([app, c]) => [app, c.id]));   // an excluded service is left as it is
        const switched = orchestrator.videoSwitchProfiles(svcs, picks);
        const missing = Object.keys(picks).filter((a) => !switched.includes(a));
        st.active = p.id;
        st.off = [...off];
        presetsWrite(st);
        return json({ ok: true, switched, missing });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoProfileAsk(appId) {
      try {
        const s = videoServices().services.find((x) => x.app === appId);
        if (!s) return json({ ok: false, error: "unknown service " + appId });
        orchestrator.videoAskProfile(s.adapter);
        return json({ ok: true });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoForgetProfile(tileId) {
      orchestrator.videoForgetProfile(tileId);
    },
    switchPlayer(kind) {
      try { return json(switchPlayer(kind)); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    musicState() {
      return json(orchestrator.musicState());
    },
    revealMusic(id, mode) {
      orchestrator.revealMusic(id, mode === "hero" ? "hero" : mode === "window" ? "window" : "panel").then((r) => {   // B-146: the inline app window
        if (r !== "ok") report(new Error("revealMusic " + id + ": " + r));
      }, report);
    },
    collapseMusic() {
      orchestrator.collapseMusic().catch(report);
    },
    musicRecent(tileId) {
      return json(orchestrator.recentMusicNow(tileId));
    },
    musicLibrary(tileId) {
      return json({ ...orchestrator.musicLibraryNow(tileId), orders: orchestrator.musicOrderSupport(tileId), order: orchestrator.musicOrderOf(tileId), repeat: orchestrator.musicRepeatOf(tileId) });   // 2026-09-17: what orders the service can do, the standing one with its spot, and the repeat switch, ride along for the menu
    },
    recycleApp(profile) {
      orchestrator.recycleAppSurfaces(profile).catch(report);
    },
    setIntermissionAmbient(sound) {
      orchestrator.setIntermissionAmbient(sound && sound !== "off" ? sound : null).catch(report);
    },
    musicSources() {
      return json(orchestrator.musicSourceTiles().map((s) => {
        const appId = itemContext(s.tile)?.app ?? null;
        const app = appId ? model.app(appId) : undefined;
        return { tile: s.tile, app: appId, name: app?.name ?? appId ?? s.tile, session: orchestrator.sessionOf(s.tile) ?? null, active: s.stages.length > 0, stages: s.stages };
      }));
    },
    musicPrepareOrder(tileId, kind, id) {
      try { orchestrator.prepareOrder(tileId, kind, id); } catch (e) { report(e); }
    },
    musicRepeat(tileId, on) {
      orchestrator.setMusicRepeat(tileId, !!on).catch(report);
    },
    playCollection(tileId, kind, id, order) {
      const o = order === "normal" || order === "shuffle" || order === "true-shuffle" || order === "reverse" ? order : "auto";   // no order named = the plain press: continue a saved spot, else in order
      orchestrator.playCollection(tileId, kind, id, o).then((r) => { if (r !== "ok") report(new Error("playCollection " + tileId + " " + o + ": " + r)); else followMusic(tileId); }, report);
    },
    playRecent(tileId, url) {
      orchestrator.playRecent(tileId, url).then((r) => { if (r !== "ok") report(new Error("playRecent " + tileId + ": " + r)); else followMusic(tileId); }, report);
    },
    resumeService(tileId) {
      // the stage follows the service either way (B-205): with nothing to start it shows the service's empty block and its Play
      orchestrator.switchToService(tileId).then((r) => { if (r === "unknown-tile") report(new Error("resumeService " + tileId + ": " + r)); else followMusic(tileId); }, report);
    },
    musicLookup(tileId) {
      orchestrator.musicLookup(tileId).catch(report);
    },
    musicLookupState(tileId) {
      return json(orchestrator.musicLookupState(tileId));
    },
    musicLookupPick(tileId, songId) {
      if (!orchestrator.musicLookupPick(tileId, songId)) report(new Error("musicLookupPick " + tileId + ": not a candidate"));
    },
    musicAddToPlaylist(tileId, playlistId, songId) {
      orchestrator.musicAddToPlaylist(tileId, playlistId, songId).then((r) => { if (r === "unknown" || r === "unknown-tile") report(new Error("musicAddToPlaylist " + tileId + ": " + r)); }, report);
    },
    musicStationFromSong(tileId, songId) {
      orchestrator.musicStationFromSong(tileId, songId).then((r) => { if (r === "unknown" || r === "unknown-tile") report(new Error("musicStationFromSong " + tileId + ": " + r)); else if (r === "ok") followMusic(tileId); }, report);
    },
    restyleVisualization(tileId, style, artwork) {
      orchestrator.restyleVisualization(tileId, style, artwork ?? undefined).then((r) => {
        if (r !== "ok") report(new Error("restyleVisualization " + tileId + ": " + r));
      }, report);
    },
    registerStylePalettes(jsonText) {
      let map: Record<string, unknown> = {};
      try { const p = JSON.parse(jsonText); if (p && typeof p === "object" && !Array.isArray(p)) map = p as Record<string, unknown>; } catch { /* malformed pack data is dropped, never guessed at */ }
      return json(orchestrator.registerStylePalettes(map));
    },
    noteArtworkColors(facet, url, pixelsBase64) {
      orchestrator.noteArtworkColors(facet, url, decodeBase64Bytes(pixelsBase64)).catch(report);
    },
    sceneStep(direction) {
      orchestrator.sceneStep(direction < 0 ? -1 : 1).catch(report);
    },
    uiRoute(route, source) {
      if (!isPrismRoute(route)) report(new Error("uiRoute: not a prism:// route: " + route));
      else void source;   // recorded by the shell's flight recorder as the `call` line; nothing to decide here
    },
    // B-40: the editors' evaluation, straight from model-eval.ts (one implementation, core-side constants)
    modelClassifyLayout: (layoutJson) => PrismModelEval.classifyLayout(layoutJson),
    modelNearestBucket: (ratio) => PrismModelEval.nearestBucket(ratio),
    modelRepresentativeRect: (slotClass, w, h) => PrismModelEval.representativeRect(slotClass, w, h),
    modelClassRatio: (slotClass) => PrismModelEval.classRatio(slotClass),
    modelFacetPresets: (entryJson, slotClass) => PrismModelEval.facetPresets(entryJson, slotClass),
    modelPresetFacet: (entryJson, presetId, appId, slotClass, selectorTableJson, facetId) => PrismModelEval.presetFacet(entryJson, presetId, appId, slotClass, selectorTableJson, facetId),
    modelLoginRedirect: (url, loginPrefix, baseUrl) => PrismModelEval.loginRedirect(url, loginPrefix, baseUrl),
    modelSessionProbeJs: (signedIn, signedOut) => PrismModelEval.sessionProbeJs(signedIn, signedOut),
    modelSessionVerdict: (resultJson) => PrismModelEval.sessionVerdict(resultJson),
    modelFacetPickerJs: () => PrismModelEval.facetPickerJs(),
    modelFacetPickPollJs: () => PrismModelEval.facetPickPollJs(),
    modelFacetPickStopJs: () => PrismModelEval.facetPickStopJs(),
    modelPickPollJs: () => PrismModelEval.facetPickPollJs(),
    modelPickStopJs: () => PrismModelEval.facetPickStopJs(),
    modelSelectorRectJs: (selector) => PrismModelEval.selectorRectJs(selector),
    // B-41: App setup / facet previews get their own surface - the wall never churns
    modelOpenAppSurface(appId, url) {
      const app = model.app(appId);
      if (!app) return "";
      const target = url && /^https?:\/\//i.test(url) ? url : app.baseUrl;
      return orchestrator.openAppSurface(appId, app.profileId, target, app.adapter ?? null);
    },
    modelCloseAppSurface(surfaceId) {
      return orchestrator.closeAppSurface(surfaceId) ? "ok" : "unknown";
    },
    modelTemplates() {
      return json(model.templates());
    },
    modelInstantiateTemplate(templateId, resolvedJson, name) {
      try {
        const resolved = JSON.parse(resolvedJson || "{}") as Record<string, string | undefined>;
        return json(model.instantiateTemplate(templateId, orchestrator.canvasSize(), resolved, name ?? undefined));
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    modelMigrate(storeJson, force) {
      try {
        const parsed = JSON.parse(storeJson) as unknown;
        const wrapped = parsed && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>) ? (parsed as { data: Record<string, unknown> }).data : (parsed as Record<string, unknown>);
        migrationInput = Object.fromEntries(Object.entries(wrapped ?? {}).filter(([, v]) => typeof v === "string")) as Record<string, string>;
        const canvas = orchestrator.canvasSize();
        const r = model.migrate(canvas.w > 0 && canvas.h > 0 ? canvas : undefined, force === true);
        migrationInput = null;
        return json(r);
      } catch (e) { migrationInput = null; report(e); return json({ status: "error", error: String(e) }); }
    },
    newsShelf() {
      return json(NEWS_SHELF);
    },
    startFraming(tileId) {
      orchestrator.startFraming(tileId).then((ok) => {
        if (!ok) report(new Error("startFraming: no live web tile " + tileId));
      }, report);
    },
    finishFraming(tileId, resultJson) {
      try {
        const result = resultJson ? (JSON.parse(resultJson) as unknown) : null;
        orchestrator.finishFraming(tileId, result).then((r) => {
          if (r !== "ok") report(new Error("finishFraming: " + r));
        }, report);
      } catch (e) {
        report(e);
      }
    },
  };
}

// When bundled for a shell (IIFE), install the runtime globally on load.
// Guarded so importing this module from tests/Node does not require a bridge.
if (typeof globalThis.PrismBridge !== "undefined") {
  globalThis.PrismRuntime = createRuntime();
}
