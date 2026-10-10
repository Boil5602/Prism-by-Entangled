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

import { asUpdateChannel } from "./updates.js";
import { FRESH_EPISODES, FRESH_MOVIES } from "./fresh-rows.js";
import { KIDS_AGES, THE_BINGE, bingeDay, bingeGenreRows, bingeSettingsOf, bingeWords, selectBinge, type BingeThresholds, type KidsMode } from "./binge.js";
import { libraryForWorks, libraryHits, searchWorks, type LibraryEntry, type LibraryHit, type SearchRowIn } from "./search-view.js";
import { HUB_SORTS, hubSortOf, filterLookupRows, type HubSort } from "./hub-sort.js";
import { MOST_READ_CATALOG } from "./most-read.js";
import { BROWSE_GENRES, BROWSE_OFFERS, BROWSE_REGION, BROWSE_ROWS, browseGenre, browseOfferOf } from "./browse.js";
import { dedupeKey, newEpisodeBadge, CONTINUE_ORDERS, LIST_ORDERS, continueOrderOf, listOrderOf, reverseOf } from "./menu-order.js";
import { orderLookup } from "./video-lookup.js";
import type { VideoChannel, VideoItem } from "./types.js";
import { SCORE_SOURCE, appsCarrying, gamesOfLastDay, namesGame, scoreLine, sportOf } from "./scores.js";
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
import { setupPlayers, setupServices, removeFromPlayers, parseRemoved, profileFor, REMOVED_KEY, type SetupEntry } from "./player-setup.js";
import { SIGN_INS_KEY, FIRST_SIGN_IN_NAME, SHARED_PROFILE, isSharedProfile, sharedPlan, accountKey, addSignIn, hideSignIn, labelFromPage, noteStatus, parseSignIns, renameSignIn, showSignIn, signInById, signInByProfile, wantsLabel, withProfile, type SignInState } from "./sign-ins.js";
import { accountLabel, accountReadJs } from "./adapters-facets.js";
import { PLAYER_TEMPLATES, withWarmMusic, withoutMusic, isPlayerKind, playerOfScene, playerScenes, type PlayerKind } from "./players.js";
import { NEWS_SHELF } from "./news-shelf.data.js";
import { applyTilesIntent, parseTilesIntent, readTilesDoc } from "./tiles-data.js";
import type { Rect } from "./solver.js";
import { decodeBase64Bytes } from "./visualization.js";
import { createPlaylists, type PlSource } from "./playlists.js";
import { liveGuide, programOnNow } from "./live-guide.js";
import { leftOutWhy, pairFeeds, storiesOf, type NewsFeedSpec, type NewsGuideRow } from "./news-feeds.js";
import { isKidsRating, isShowName, typeFromGenres } from "./live-titles.js";
import { liveItemsOf, watchlistMissing } from "./video.js";
import { titleKey } from "./lenses.js";

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
  /** Sync JSON (2026-10-06, the report flag): what a report may carry - the player on now, each service with its adapter, the adapter's version and the page its tile is on (origin and path, never the query), and the service to preselect. {active, services:[{app,name,kind,adapter,version,page}], selected}. */
  reportContext(): string;
  /** The window a phone listens to in multiview (2026-10-05): set from the phone; the host clears it when the last phone stops listening. */
  listenWindow(tile: string | null): Promise<string>;
  /** §28 updates for the host's Device screen (2026-10-05): the status, a check now, an install now, the channel. */
  updateStatus(): string;
  updateCheck(): Promise<string>;
  updateInstallNow(): Promise<string>;
  updateSetChannel(channel: string): Promise<string>;
  /** Sync JSON: when the update check runs (2026-10-06, "Let the user check for updates at a scheduled time") - {"at":"HH:MM","weekday":0-6|null} or null for a day after the last; enabled false = Never. Taken at once; answers the status. */
  updateSetSchedule(scheduleJson: string | null, enabled: boolean): string;
  /** Plays the next episode of the series on screen from the Episodes list, when the service's own Next did nothing (2026-10-05). */
  videoPlayNextEpisode(): string;
  /** "Play after this track" from the wall's own Quick play (2026-10-05): one queued pick, as the phone's; -> {ok, started?, error?}. */
  musicPlayNext(tile: string, kind: string, id: string): string;
  musicNextNow(): string;
  /** Sync JSON [{id, name, kind: "music"|"video", added, status}]: the catalog's services as the first-run page lists them (player-setup.ts); entries = [{id, name, url, adapter, audio}]. */
  playerSetupServices(entriesJson: string): string;
  /** Sync JSON {ok, error?, music, video, made, services}: the Music and Video players made from the services chosen; what is there already is kept. */
  playerSetup(entriesJson: string, catalogJson?: string | null): string;
  /** The profile a new App of this catalog entry gets (player-setup profileFor): one a shared account, else its own id. */
  playerProfileFor(entryJson: string, catalogJson: string): string;
  /** Sync JSON {ok, kind, changed, removed}: a service leaves the players and Watch; its App and its sign-in stand. The setup page brings it back. */
  playerRemove(appId: string): string;
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
  /** Sync JSON {ok, error?}: a preset given another name (two never share one). */
  videoPresetRename(presetId: string, name: string): string;
  /**
   * Sign-ins (sign-ins.ts). Sync JSON {services:[{app, name, kind:"music"|"video", status, account, shares:[name], signIns:[{id, name}], current}]}:
   * every service of the two players with the sign-ins its account has on this device and the one it uses. catalogJson (the shell's
   * catalog entries, with signInWith) teaches core which services share an account; null leaves what it knows.
   */
  signInsView(catalogJson: string | null): string;
  /** Sync JSON {ok, signIn:{id, name}, made}: a new sign-in for the service's account under a person's name; nobody is signed in to it yet. */
  signInAdd(appId: string, name: string): string;
  /** Sync JSON {ok, changed, status}: the service uses this sign-in from now; its windows are made again in it. */
  signInUse(appId: string, signInId: string): string;
  /** Sync JSON {ok}: a sign-in renamed. */
  signInRename(appId: string, signInId: string, name: string): string;
  /** Sync JSON {ok, error?}: a sign-in taken off the list (its login kept, untouched) - never the one a service is on, nor the last one; and one brought back. */
  signInHide(appId: string, signInId: string): string;
  signInShow(appId: string, signInId: string): string;
  /**
   * Sync JSON {ok, asked:[app]}: the sign-ins nobody has named are named from their services' own account pages (adapter `account`), read
   * on hidden pages one at a time; only services signed in, only a sign-in not read in the last week. The names land as they are read.
   */
  signInsLabel(): string;
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
  /** Sync JSON {ok, look}: Watch settings' Video ads - "veil" (scenery and mute, the default), "mute" (the ad's picture, its sound off) or "show". */
  videoSetAdsLook(look: string): string;
  /** Sync JSON {ok, on, asked}: Watch's Service suggestions switch, named to core - while on, each service's home page is read on its hidden surface for the service's own rows (every few hours); `asked` = the Apps whose home page is being read now. */
  videoSetSuggestions(on: boolean): string;
  /** Sync JSON {ok}: a muted-only break's Unmute (true) or Mute again (false), for this break. */
  intermissionUnmute(tileId: string, on: boolean): string;
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
  /** Sync JSON {ok, did}: the shell saw a window's picture stand still while its player plays (2026-10-06, "FOX 8, freezes should be detected and
   *  video reloaded"): the playback doctor opens it again (a channel tuned again), within its usual tries. */
  videoPictureFrozen(tileId: string, seconds: number): string;
  /** Sync JSON {ok}: the shell's break watch knows this window's break runs for this many more seconds (a paid programme's half hour,
   *  B-364); its cover's safety backstop waits for that end. Said again at each look; a shell that stops saying it gets the backstop. */
  adBreakHold(tileId: string, remainingSec: number): string;
  /** Sync JSON {title, start, end} | null: the program a channel window is on, as its guide lists it (the break watch's program edges, 2026-10-06). */
  videoProgramEdges(tileId: string): string;
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
  /** Which services to ask about a title that plays on these apps (2026-09-28, the host no longer names them): [{via, viaName, app, name}]. */
  titleAlsoOnPlan(appsJson: string): string;
  /** Sync JSON {ok, service, ...}: a live game watched on the service that carries it - its event played, or its channel tuned (2026-10-01). */
  liveScoreWatch(league: string, id: string): string;
  /**
   * Sync JSON (2026-09-30, the Live tab's Sports mode): the day's games from ESPN - {source, readAt, reading, games:[{league, leagueName, id, start,
   * state, detail, home, away, tv, short, line}], errors}; in play first, then over, then to come. A read starts when stale (two minutes) or forced.
   */
  liveScores(force: boolean): string;
  liveNews(force: boolean, mode?: string | null): string;
  watchlistSet(kind: string, id: number, on: boolean | string): string;
  watchlistHas(kind: string, id: number): string;
  watchlistImport(): string;
  watchlistView(force: boolean): string;
  watchlistHasTitle(title: string, kind: string | null): string;
  watchlistSetTitle(title: string, kind: string | null, on: boolean | string): string;
  tmdbLinkState(): string;
  tmdbLinkStart(): string;
  tmdbLinkFinish(): string;
  tmdbUnlink(): string;
  tmdbRated(kind: string, id: number): string;
  tmdbRate(kind: string, id: number, value: number | null): string;
  liveNowOn(type: string | null): string;
  /** The Live tab (docs/features/live.md): the guide - rows, type chips, live events, each service's read - filtered by type and the live search. */
  videoLiveGuide(type: string | null, q: string | null): string;
  /** The Live tab open (or Refresh): each service's guide page read on its hidden page; forced = Refresh. */
  videoLiveRead(force: boolean): string;
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
  /** The menu's rows alone - continue, list, the watchlist, orders, lens, screen, now; the lens rows too when asked - without the Library (2026-10-03). */
  videoMenuRows(withLenses?: boolean | string): string;
  /** A row's order, kept on the device (2026-09-26): row "continue" ("title" the default, "service") or "list" ("prism" the default, "title",
   *  "service"), and reverse ("1"/"0"); a null leaves that part as it is. Returns {row, order, reverse, orders}. */
  videoRowOrder(row: string, order?: string | null, reverse?: string | null): string;
  /** Playlists (docs/features/playlists.md, 2026-09-27), all sync JSON, kept per profile set on the device: the Playlists screen's view
   *  {lists, total, open, run, undo, services} (filter q by name and contained titles; sort "name" | "updated"); the Send to picker
   *  {items (the open playlist first, then recent ones), total}; create / open / rename / delete / undo. */
  playlistsView(q?: string | null, sort?: string | null, listId?: string | null): string;
  playlistsPicker(): string;
  playlistCreate(name: string, isPublic?: boolean | string): string;
  /** Whether playlists are on (a TMDB account with lists linked), with the link's state for the gate's wording (2026-10-03). */
  playlistGate(): string;
  /** TMDB's lists read now. */
  playlistSync(): string;
  /** The device's own earlier playlists copied onto TMDB as private lists. */
  playlistCopyLocal(): string;
  /** A playlist public on TMDB or private. */
  playlistSetPublic(id: string, on: boolean | string): string;
  playlistOpen(listId: string): string;
  playlistRename(listId: string, name: string): string;
  playlistDelete(listId: string): string;
  playlistUndo(): string;
  /** Send a title: target {id} or {newName}; source {type:"movie", title, services:[{app,id,url}]} or {type:"series", show, app, services:[app],
   *  scope:"all"|"season"|"episode"|"rest", season, episode}. Returns {job}; playlistJob(job) -> {status: reading|confirm|done|error, message,
   *  count, added, skipped}; a large add waits for playlistJobConfirm(job, "1"). */
  playlistSend(targetJson: string, sourceJson: string): string;
  playlistImport(targetJson: string, appsJson: string, scope: string): string;
  playlistJob(jobId: string): string;
  playlistJobConfirm(jobId: string, yes: string): string;
  /** An edit {op: move|moveBy|mark|markShow|remove|removeShow|clearCompleted|pin|view|order, ...}; a reorder outside Manual is refused. */
  playlistEdit(listId: string, opJson: string): string;
  /** Play from the first not-completed item (or the item named), on to the next as each ends; stop "after" this one or "now". */
  playlistPlay(listId: string, itemKey?: string | null): string;
  playlistStop(mode: string): string;
  /** Sync JSON {ok, error?}: the playing playlist goes to its previous or next item ("previous" | "next"). */
  playlistMove(dir: string): string;
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
  /** Sync JSON (2026-10-06): the track playing on a music tile and the collections Prism has read that hold it - {songId, title, artist, lists} | null. */
  musicPlayingIn(tileId: string): string;
  /** Remove the track playing now from one of the person's own playlists, by the playlist page's own control on a hidden page; dry stops before the press. Sync JSON {ok, asked} | {ok:false, error}. */
  musicRemovePlaying(tileId: string, playlistId: string, dry?: boolean): string;
  /** Sync JSON: what the last removal on a tile did - {song, playlist, status: pending | ok | error | dry, error?} | null. */
  musicRemoveState(tileId: string): string;
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
  /** The adapter's login address when it is a page to open, else "" (the sign-in is on the service's own page). */
  modelSignInPage(login: string | null, signIn?: string | null): string;
  /** Page JS that presses the service's own Sign In control (the adapter's signed-out marker); a person's press only. */
  modelSignInPressJs(signedOut: string | null): string;
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

/** One browser, many sign-ins (sign-ins.ts, 2026-10-03): once the legacy folders have been moved, every surface asks for a shared profile -
 *  a legacy id still named by a kept document, a multiview window or a first-party page goes to the first shared one, whose sessions it had. */
let sharedProfilesOn = false;
export function createBridgeDrivers(): Drivers {
  return {
    surface: {
      create: (opts: SurfaceCreateOptions) => send("surface.create", { ...opts, ...(sharedProfilesOn && !isSharedProfile(opts.profile) ? { profile: SHARED_PROFILE } : {}), placeholder: !!opts.placeholder }),
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
      showIntermission: (id: string, source: string, look?: string) =>
        send("surface.showIntermission", { id, source, ...(look ? { look } : {}) }),
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
      videoPick: (title: string, service: string, poster: string | null) => send("ui.videoPick", { title, service, poster }),
      privateMute: (on: boolean) => send("ui.privateMute", { on }),
      listenRoutes: (json: string) => send("ui.listenRoutes", { json }),
      breakWatch: (on: boolean) => send("ui.breakWatch", { on }),
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
      // a value the store already holds is not sent again (2026-09-28: a music page's library, saved on every one-second report, unchanged -
      // 1,551 saves in 35 minutes, each a rewrite of the whole store on the host). A value that keeps changing reaches the host once per quiet
      // five seconds, thirty seconds at the most (2026-10-03, perf.log: the watch log, the recents and the resume point were set 54 times a
      // minute by three playing windows, and the host wrote its whole 7 MB store 20 times a minute - a gigabyte of churn a minute). The
      // brain's own snapshot takes the value at once, so a get sees it; only the host's write waits.
      set: (key: string, value: string) => {
        storeSend ??= (k, v) => send("store.set", { key: k, value: v });
        const pend = storePending.get(key);
        try { if (!pend && bridge().storeGet(key) === value) return; } catch { /* send it */ }
        try { const snap = (globalThis as unknown as { __prismStoreSnapshot?: Record<string, string> }).__prismStoreSnapshot; if (snap) snap[key] = value; } catch { /* no snapshot: the host's copy stands */ }
        if (pend) {
          pend.value = value;
          if (Date.now() - pend.first >= STORE_COALESCE_MAX_MS) { storeFlush(key); return; }
          clearTimeout(pend.timer); pend.timer = setTimeout(() => storeFlush(key), STORE_COALESCE_MS);   // quiet five seconds, counted from the latest change
          return;
        }
        storePending.set(key, { value, first: Date.now(), timer: setTimeout(() => storeFlush(key), STORE_COALESCE_MS) });
      },
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
      fetchKeyed: (url: string, headers: Record<string, string>, method?: string, body?: string) => request<string>("net.fetchKeyed", { url, headers: JSON.stringify(headers), ...(method ? { method } : {}), ...(body !== undefined ? { body } : {}) }),
      applyBlockHosts: (sourceId: string, name: string, hosts: string[]) =>
        send("net.applyBlockHosts", { sourceId, name, hosts }),
    },
  };
}

// the person's TMDB account as the host sees it (tmdb-account.ts, 2026-10-03): the link's page and error, the account's own ratings read
const tmdbUi = { state: null as null | { linked: boolean; username: string | null; linkedAt: number | null; pending: boolean; hasKey: boolean; lists?: boolean; listsPossible?: boolean }, loading: false, busy: false, url: null as string | null, error: null as string | null, rated: new Map<string, number | null>(), reading: new Set<string>() };
// the brain's store writes coalesced per key (2026-10-03): the host hears a changing value every quiet five seconds, thirty at the most
const STORE_COALESCE_MS = 5_000, STORE_COALESCE_MAX_MS = 30_000;
const storePending = new Map<string, { value: string; first: number; timer: ReturnType<typeof setTimeout> }>();
let storeSend: ((key: string, value: string) => void) | null = null;
function storeFlush(key: string): void {
  const p = storePending.get(key);
  if (!p) return;
  clearTimeout(p.timer);
  storePending.delete(key);
  storeSend?.(key, p.value);
}
/** Every pending value to the host now (the page going away). */
export function storeFlushAll(): void { for (const key of [...storePending.keys()]) storeFlush(key); }
try { (globalThis as unknown as { addEventListener?: (n: string, f: () => void) => void }).addEventListener?.("pagehide", storeFlushAll); } catch { /* no window */ }

export function createRuntime(drivers: Drivers = createBridgeDrivers()): PrismRuntimeApi {
  const orchestrator = new Orchestrator(drivers);
  const remote = new RemoteApi(orchestrator, drivers.store);
  // the phone's Music tab (2026-10-04): the sources by name, and the play of a collection with the wall's own follow
  const musicSourcesNow = () => orchestrator.musicSourceTiles().map((s) => {
    const appId = itemContext(s.tile)?.app ?? null;
    const app = appId ? model.app(appId) : undefined;
    return { tile: s.tile, app: appId, name: app?.name ?? appId ?? s.tile, session: orchestrator.sessionOf(s.tile) ?? null, active: s.stages.length > 0, stages: s.stages };
  });
  remote.musicQuick = () => musicSourcesNow();
  remote.players = () => players();
  // a pick from the phone cuts the sound at once (2026-10-04, "cant we cut the audio immediately"): every other music source that plays is
  // paused before the new collection is asked for, so the room does not hear the old one under the new one's loading
  const phonePlay = (tile: string, kind: string, id: string, order: string | undefined) => {
    const o = order === "normal" || order === "shuffle" || order === "true-shuffle" || order === "reverse" ? order : "auto";
    const playing = orchestrator.getState()?.tiles.filter((t) => t.id !== tile && t.nowPlaying?.playing && orchestrator.musicSourceTiles().some((s) => s.tile === t.id)) ?? [];
    for (const t of playing) orchestrator.tileCommand(t.id, "pause").then((r) => { if (r !== "ok") report(new Error("phone pick: pause " + t.id + ": " + r)); }, report);
    orchestrator.playCollection(tile, kind, id, o).then((r) => { if (r !== "ok") report(new Error("playCollection (phone) " + tile + " " + o + ": " + r)); else followMusic(tile); }, report);
  };
  remote.playCollection = (tile, kind, id, order) => phonePlay(tile, kind, id, order);
  // "play after this track" (2026-10-04): one queued pick. It starts when the track playing now gives way - the page names another title,
  // or stops at its end - never on a person's pause; with nothing playing it starts at once. A newer queue replaces it; the phone can drop it.
  let musicNext: { tile: string; kind: string; id: string; name: string; service: string; order: string | undefined; from: string; title: string; at: number } | null = null;
  const musicNextStart = (why: string) => {
    const n = musicNext; if (!n) return; musicNext = null;
    report(new Error("music next: starting " + n.name + " on " + n.tile + " (" + why + ")"));
    phonePlay(n.tile, n.kind, n.id, n.order);
  };
  remote.musicNext = {
    get: () => (musicNext ? { tile: musicNext.tile, kind: musicNext.kind, id: musicNext.id, name: musicNext.name, service: musicNext.service, after: musicNext.title, at: musicNext.at } : null),
    set: (tile, kind, id, order) => {
      const lib = orchestrator.musicLibraryNow(tile);
      const item = [...lib.playlists, ...lib.stations].find((x) => x.id === id && x.kind === kind);
      if (!item) return { ok: false, error: "that collection is not in the service's list" };
      const src = musicSourcesNow().find((s) => s.tile === tile);
      // the track playing now, else one held paused (2026-10-05: a paused track is still "this track" to wait behind)
      const sourcesNow = orchestrator.musicSourceTiles();
      const held = orchestrator.getState()?.tiles.filter((t) => t.nowPlaying?.title && sourcesNow.some((s) => s.tile === t.id)) ?? [];
      const nowOn = held.find((t) => t.nowPlaying?.playing) ?? held[0];
      const title = nowOn?.nowPlaying?.title ?? "";
      if (!nowOn || !title) { phonePlay(tile, kind, id, order); return { ok: true, started: true }; }
      musicNext = { tile, kind, id, name: item.name, service: src?.name ?? tile, order, from: nowOn.id, title, at: Date.now() };
      return { ok: true, started: false };
    },
    clear: () => { musicNext = null; },
  };
  // the previous session (2026-10-04, "restore whatever collection and order setting and if a playlist, the song that was playing and the time
  // elapsed"): what the audible music source held is written as it plays (every few seconds, and on a new title), kept in the store across a
  // restart. While nothing plays the phone is offered it; Restore plays the collection in its order, then - a playlist or album, through the
  // service's own player - jumps to the track and the spot. A station starts where the station starts. The offer goes when music plays
  // again on its own, when dismissed, or after a day.
  const SESSION_KEY = "music:last-session";
  type LastSession = { tile: string; service: string; kind: string; id: string; label: string | null; order: string; repeat: boolean; title: string; artist: string; position: number | null; duration: number | null; at: number };
  let lastSession: LastSession | null = null;
  let sessionWroteAt = 0;
  let restoreOffered: LastSession | null = null;
  let restoreDismissed = false;
  // read once the store is up (the record is a store key like the orders; the store answers after the model's load, which is declared below)
  setTimeout(() => void (async () => {
    try {
      const raw = await drivers.store?.get(SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as LastSession;
      if (s && typeof s.tile === "string" && Date.now() - s.at < 24 * 3600_000) { lastSession = s; restoreOffered = s; }
    } catch (e) { report(e); }
  })(), 0);
  const sessionWatch = (ev: SurfaceEvent) => {
    if (ev.type !== "now-playing" || !ev.info) return;
    const info = ev.info as { playing?: boolean; title?: string; artist?: string; context?: { kind?: string; id?: string; label?: string; position?: number | null; duration?: number | null } | null };
    if (!orchestrator.musicSourceTiles().some((s) => s.tile === ev.id)) return;
    if (!info.playing || !info.title) return;
    // music plays on its own: the offer is spent, unless the restore itself is what plays
    if (restoreOffered && !restoring) restoreOffered = null;
    const cx = info.context;
    const o = orchestrator.musicOrderOf(ev.id);
    // the collection: the page's own word for what it holds, else Prism's standing order (a Prism-made queue - true shuffle, reverse - is a list
    // of songs to the page, which then names no playlist; 2026-10-04: the record froze before a reverse and Restore came back in order)
    let kind: string, id: string, label: string | null, order: string;
    if (cx?.kind && cx.id) { kind = cx.kind; id = cx.id; label = cx.label ?? null; order = o && o.kind === kind && o.id === id ? o.order : "normal"; }
    else if (o) { kind = o.kind; id = o.id; label = o.name; order = o.order; }
    else return;
    const rec: LastSession = {
      tile: ev.id, service: musicSourcesNow().find((s) => s.tile === ev.id)?.name ?? ev.id, kind, id, label,
      order, repeat: orchestrator.musicRepeatOf(ev.id),
      title: info.title, artist: info.artist ?? "", position: typeof cx?.position === "number" ? cx.position : null, duration: typeof cx?.duration === "number" ? cx.duration : null, at: Date.now(),
    };
    const fresh = !lastSession || lastSession.title !== rec.title || lastSession.id !== rec.id || Date.now() - sessionWroteAt > 5000;
    lastSession = rec;
    if (fresh) { sessionWroteAt = Date.now(); try { void drivers.store?.set(SESSION_KEY, JSON.stringify(rec)); } catch (e) { report(e); } }
  };
  let restoring = false;
  remote.musicRestore = {
    offer: () => {
      if (!restoreOffered || restoreDismissed) return null;
      const anyPlaying = orchestrator.getState()?.tiles.some((t) => t.nowPlaying?.playing && orchestrator.musicSourceTiles().some((s) => s.tile === t.id));
      if (anyPlaying) return null;
      const s = restoreOffered;
      return { tile: s.tile, service: s.service, kind: s.kind, label: s.label, order: s.order, repeat: s.repeat, title: s.kind === "station" ? null : s.title, artist: s.kind === "station" ? null : s.artist, position: s.kind === "station" ? null : s.position, duration: s.duration, at: s.at };
    },
    dismiss: () => { restoreDismissed = true; },
    restore: () => {
      const s = restoreOffered;
      if (!s) return { ok: false, error: "nothing to restore" };
      restoreOffered = null; restoring = true;
      // a Prism order (true shuffle, reverse) still standing for this collection carries on at its saved spot through "auto"; one no longer
      // standing is named outright and starts afresh (the track and spot are then found by name below); a station starts where the station starts
      const standing = orchestrator.musicOrderOf(s.tile);
      const stands = !!standing && standing.kind === s.kind && standing.id === s.id && standing.order === s.order;
      const named = s.order === "true-shuffle" || s.order === "reverse" || s.order === "shuffle" ? s.order : "auto";
      phonePlay(s.tile, s.kind, s.id, s.kind === "station" || s.order === "normal" || stands ? "auto" : named);
      if (s.repeat) void orchestrator.setMusicRepeat(s.tile, true);
      if (s.kind !== "station" && s.title) {
        // once the collection plays: the track, then the spot (the service's own player, where the adapter has the verbs)
        const t0 = Date.now();
        const tick = () => {
          const t = orchestrator.getState()?.tiles.find((x) => x.id === s.tile);
          const np = t?.nowPlaying;
          if (np?.playing && np.title && !t?.musicPending) {
            const same = np.title === s.title;
            void (async () => {
              try {
                if (!same) { await orchestrator.musicPlayerVerb(s.tile, "jumpto:" + s.title + "|" + s.artist); await new Promise((r) => setTimeout(r, 1800)); }
                if (typeof s.position === "number" && s.position > 3) await orchestrator.musicPlayerVerb(s.tile, "seekto:" + Math.floor(s.position));
              } catch (e) { report(e); }
              restoring = false;
            })();
            return;
          }
          if (Date.now() - t0 > 40_000) { restoring = false; return; }
          setTimeout(tick, 700);
        };
        setTimeout(tick, 1500);
      } else { setTimeout(() => { restoring = false; }, 15_000); }
      return { ok: true };
    },
  };
  const musicNextWatch = (ev: SurfaceEvent) => {
    const n = musicNext;
    if (!n || ev.type !== "now-playing" || ev.id !== n.from || !ev.info) return;
    const info = ev.info as { playing?: boolean; title?: string; context?: { position?: number | null; duration?: number | null } | null };
    const title = info.title || "";
    if (title && title !== n.title) { musicNextStart("the next track began: " + title); return; }
    const pos = info.context?.position, dur = info.context?.duration;
    if (info.playing === false && typeof pos === "number" && typeof dur === "number" && dur > 0 && pos >= dur - 2) musicNextStart("the track ended");
  };
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

  // A scene as the wall draws it - every path that puts a scene on the wall comes through here (a switch, and the boot's reconcile: the
  // first cut left the boot out, and a restart in the Video player came up without the music). The Video player is drawn with the Music
  // player's sources warm beside it; its scene holds none of them (players.ts).
  const drawScene = (sceneId: string, canvas: { w: number; h: number }, dashId: string, base?: DashboardDocument) => {
    const asked = model.scene(sceneId);
    const isVideo = !!asked && playerOfScene(asked, model.layout(asked.layout), (id) => model.facet(id)) === "video";
    return isVideo
      ? model.materializeScene(withWarmMusic(asked!, playersNow().music, (id) => model.facet(id)), canvas, dashId, base)
      : model.materialize(sceneId, canvas, dashId, base);
  };
  // the wall becomes a scene (schedules, carousel, the remote, the rail all come through here)
  const applyScene = (sceneId: string, after?: () => void): { ok: boolean; notes?: string[]; error?: string } => {
    const st = orchestrator.getState();
    if (!st) return { ok: false, error: "no dashboard loaded" };
    const m = drawScene(sceneId, orchestrator.canvasSize(), st.dashboard);
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
  // Prism menu. The Video player keeps the lounge's sources warm on the wall; the switch to it pauses the one that was
  // playing (2026-10-05), and the way back resumes it.
  const playersNow = () => {
    const snap = model.snapshot();
    return playerScenes(snap.scenes, (id) => model.layout(id), (id) => model.facet(id), snap.activeScene);
  };
  /** A catalog entry is a music service when its adapter speaks the media session: the adapter it names, the one of its id, else the one its address binds. */
  const speaksMediaSession = (e: SetupEntry): boolean => {
    const spec = (e.adapter ? orchestrator.adapterSpec(e.adapter) : undefined) ?? orchestrator.adapterSpec(e.id) ?? ((n) => (n ? orchestrator.adapterSpec(n) : undefined))(orchestrator.adapterNameForUrl(e.url));
    return !!spec?.capabilities?.includes("media-session");
  };
  // the services a person took off the players (player-setup.ts): kept on the device, read as it stands
  let removedKept: string[] | null = null;
  const removedNow = (): string[] => (removedKept ??= parseRemoved(tilesRead(REMOVED_KEY)));
  const setRemoved = (list: string[]): void => { removedKept = [...list]; try { void drivers.store?.set(REMOVED_KEY, JSON.stringify(removedKept)); } catch (e) { report(e); } };
  // once the stores are read: music sources an earlier build wrote into the Video player's scene leave it (players.ts - the two players are
  // separate; the wall as it stands is not touched, it keeps the music warm)
  void Promise.resolve(modelLoaded).then(() => {
    try { const v = playersNow().video; const clean = v ? withoutMusic(v, (id) => model.facet(id)) : null; if (clean) model.saveScene(clean); } catch (e) { report(e); }
  });
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
    const off = removedNow();
    const facets = snap.facets.filter((f) => isVideoFacet(f, snap.apps) && !off.includes(f.app));   // a service taken off the players is not the Video player's
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
  /** A line in the shell's log about a window multiview closed (why), never an error that stops the close. */
  const mvNote = (line: string): void => { try { report(new Error(line)); } catch { /* no shell (tests) */ } };
  const mvReconcile = (): boolean => {
    const sv = videoServices();
    const scene = sv.scene ? model.scene(sv.scene) : undefined;
    const st = orchestrator.videoMultiviewState();
    if (!scene || !st.on) return false;
    const videoFacets = new Set(sv.services.map((x) => x.facet));
    const keep = (scene.floating ?? []).filter((fl) => !fl.facet || !videoFacets.has(fl.facet) || st.order.includes(fl.facet));
    if (keep.length === (scene.floating ?? []).length) return false;
    mvNote("multiview: reconcile drops " + JSON.stringify((scene.floating ?? []).filter((fl) => !keep.includes(fl)).map((fl) => fl.facet)) + " (order " + JSON.stringify(st.order) + ")");
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
  const mvPlace = (facetId: string): { tile: string; ready: boolean; sceneId?: string; refused?: string } | null => {
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
    // the service's own limit on streams at once (adapter maxStreams): a window past it would sit on an empty player with no word from the
    // service (2026-09-29, a fourth Paramount+ live window) - refused, in words, before it is made
    const app = model.app(facet.app);
    const cap = orchestrator.adapterSpec(app?.adapter ?? app?.catalogRef ?? orchestrator.adapterNameForUrl(facet.url) ?? facet.app)?.maxStreams;
    const outgoing = target > 0 && target < order.length ? wins[target] : undefined;   // the window that would give way
    // ... or the oldest small window, when the wall is full and a new window is made (the overflow rule below)
    let dropped: (typeof wins)[number] | undefined;
    if (!outgoing && order.length >= MV_MAX) { let drop = order.length - 1; while (drop > 0 && order[drop] === st.slot) drop--; dropped = wins.find((w) => w.tile === order[drop] && !w.slot); }
    const open = wins.filter((w) => w.app === facet.app && w !== outgoing && w !== dropped).length;
    if (cap && open >= cap) return { tile: "", ready: false, refused: (app?.name ?? facet.app) + " plays " + cap + " at once on one account. Close one of its windows first" };
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
    if (!r.ok) { mvNote(("multiview: " + r.error)); return null; }
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
  // A window on a channel that goes quiet is tuned once more before it is given up, and a window that is closed says so (2026-10-09,
  // "What happened to window 5? I think it shut down and dont know why. Or at least one window did and they all collapsed to 4
  // windows": Comedy Central's window stopped reporting anything at the top of an hour, and 45 s on it was closed without a word).
  // What a person would do by hand, done once (ten minutes between tries a window); a tune that does not take closes the window as a
  // failed pick does. The words go to the shell as a notice.
  const MV_RETUNE_MS = 600_000;
  const mvRetuneAt = new Map<string, number>();
  const mvSay = (text: string): void => { try { report(new Error("notice: " + text)); } catch { /* no shell (tests) */ } };
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
      // a window a restart is bringing back has 3 minutes, not 45 s (2026-09-24: Georgie & Mandy's window was closed 45 s after a restart) - and
      // its pick is not failed by age inside them (2026-10-06: five YouTube TV channels walked the guide at once after a restart; C-SPAN2's took
      // longer than the pick's clock and its window was closed, twice)
      const restoring = !!t?.pending?.restored && now - t.pending.at < 180_000;
      const failed = !restoring && (!!t?.pending?.failed || (!!t?.pending && now - t.pending.at > MV_PICK_MS));
      const loading = !!t?.pending && !failed;
      // ... and a window in an ad break is not empty (2026-09-28, the Live tab: a Paramount+ channel tuned into window 2 opened on a 2.5-minute
      // ad break, its page naming nothing until the channel itself began - the window was closed as empty in the middle of the break)
      // ... and a window whose player plays is not empty, even before its page names what it plays (C-SPAN2's, playing for five seconds when closed)
      if (t?.video || t?.playing || loading || restoring || orchestrator.inAdBreak(w.tile)) { mvEmptySince.delete(w.tile); continue; }
      const since = mvEmptySince.get(w.tile) ?? now;
      mvEmptySince.set(w.tile, since);
      if (!(failed || now - since >= MV_EMPTY_MS)) continue;
      const ch = failed ? null : orchestrator.videoChannelOf(w.tile);
      if (ch && now - (mvRetuneAt.get(w.tile) ?? -MV_RETUNE_MS) >= MV_RETUNE_MS) {
        mvRetuneAt.set(w.tile, now); mvEmptySince.delete(w.tile);
        mvNote("multiview: window " + w.tile + " went quiet on " + ch.name + ": tuning it again");
        mvSay(ch.name + " stopped playing in window " + (wins.indexOf(w) + 1) + ", so Prism is tuning it again");
        orchestrator.videoTune(w.tile, ch.id, ch.name, null).then((r) => { if (r !== "ok") report(new Error("multiview retune " + w.tile + ": " + r)); }, report);
        continue;
      }
      gone.push(w.tile);
      mvSay("Window " + (wins.indexOf(w) + 1) + " closed. " + (ch ? ch.name + " stopped playing and didn't come back" : "Nothing was playing in it"));
    }
    for (const t of new Set(mvEmptySince.keys())) if (!wins.some((w) => w.tile === t)) mvEmptySince.delete(t);
    for (const t of new Set(mvRetuneAt.keys())) if (!wins.some((w) => w.tile === t)) mvRetuneAt.delete(t);
    for (const tile of gone) { const t = vs.find((x) => x.id === tile); mvNote("multiview: window " + tile + " closed as empty (" + JSON.stringify({ pending: t?.pending ?? null, video: !!t?.video, playing: !!t?.playing }) + ")"); mvEmptySince.delete(tile); videoMultiview("remove", tile); }
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
      // nothing new to read: the kept list read longest ago, once it is a week old, is read again (one at a time, the same quiet rules)
      const old = orchestrator.oldestEpisodeList(7 * 24 * 3_600_000);
      const os = old ? hs.find((x) => x.app === old.app) : undefined;
      if (old && os && os.status === "signed-in" && orchestrator.adapterSpec(os.adapter)?.videoEpisodes) {
        orchestrator.episodesOf(os, old.series, { kind: "episode", title: "", series: old.series } as import("./types.js").VideoContext);
      }
    } catch (e) { report(e); }
  };
  setInterval(cwReadAhead, 90_000);
  // sign-ins nobody named, named from their account pages: two minutes after the start, then every half hour (each read once a week at most)
  setTimeout(() => { try { labelSignIns(); } catch (e) { report(e); } }, 120_000);
  // the Live tab's channels with TMDB's word (2026-10-02): a show-named channel's type, and the modes what is on now adds
  const withShowType = (ch: VideoChannel): VideoChannel => {
    if ((ch.category ?? "").trim() || ch.event || !isShowName(ch.name)) return ch;
    const t = orchestrator.liveTitle(ch.name);
    if (!t) return ch;
    const type = typeFromGenres(t.genres);
    return type ? { ...ch, tmdbType: type, tmdbTitle: t.title } : ch;
  };
  // what is on now, by TMDB's word (2026-10-02, Movies mode): a film on makes the channel count in Movies, a documentary in Documentary
  const withNowTypes = (ch: VideoChannel): VideoChannel => {
    if (ch.event) return ch;
    // the same reading of the schedule the guide draws (review 2026-10-02: a raw end ran past the next program's start, and a channel
    // stayed under Movies after its film had given way)
    const on = programOnNow(ch, Date.now())?.title ?? null;
    if (!on) return ch;
    const t = orchestrator.liveTitle(on);
    if (!t) return ch;
    const nowTypes: Array<{ type: string; title: string; of: string }> = [];
    if (t.kind === "movie") nowTypes.push({ type: "Movies", title: t.title, of: on });
    if (t.genres.includes("Documentary")) nowTypes.push({ type: "Documentary", title: t.title, of: on });
    return nowTypes.length ? { ...ch, nowTypes } : ch;
  };
  const withTmdbWord = (ch: VideoChannel): VideoChannel => withNowTypes(withShowType(ch));
  /**
   * A live game's way in on this wall (2026-10-01): the services ESPN names as carrying it, signed in here, searched for the game by the teams'
   * names - an event of the service's (Apple TV's MLS) first, else a live channel whose program names it (Paramount+'s CBS games). Null when
   * no service on the wall carries it, or none names it.
   */
  const scoreWatch = (g: { league: string; id: string; state: string; tv: string[]; home: { name: string; abbr: string }; away: { name: string; abbr: string } }): { service: string; app: string; facet: string; how: "event" | "channel"; id: string; url: string | null; title: string } | null => {
    if (g.state !== "in") return null;
    const sv = videoServices();
    const apps = appsCarrying(g.tv, sv.services.map((s) => ({ app: s.app, broadcasters: orchestrator.adapterSpec(s.adapter)?.broadcasters })));
    if (!apps.length) return null;
    for (const app of apps) {
      const s = sv.services.find((x) => x.app === app && x.status === "signed-in");
      if (!s) continue;
      const ev = orchestrator.liveEvents(s.app).find((e) => e.live && namesGame(e.title, g as never));
      if (ev) return { service: s.name, app: s.app, facet: s.facet, how: "event", id: ev.id, url: ev.url ?? null, title: ev.title };
      const ch = s.live.find((c) => namesGame((c.now ?? "") + " " + c.name, g as never));
      if (ch) return { service: s.name, app: s.app, facet: s.facet, how: "channel", id: ch.id, url: ch.url, title: ch.name };
    }
    return null;
  };
  // live events (Apple TV's Formula 1 and MLS pages): the kept ones at once, read afresh a minute and a half after the start, then every half hour
  setTimeout(() => { try { void orchestrator.videoEventsLoad(hiddenServices()); } catch (e) { report(e); } }, 5_000);
  // the scores kept across the day: read back at the start, then ESPN's header read every quarter hour (one bare address) so the last day's
  // games are there when Sports mode opens, finals included
  setTimeout(() => { try { void orchestrator.scoresLoad(); } catch (e) { report(e); } }, 6_000);
  setTimeout(() => { try { orchestrator.scores(false, 15 * 60_000); } catch (e) { report(e); } }, 60_000);
  setInterval(() => { try { orchestrator.scores(false, 15 * 60_000); } catch (e) { report(e); } }, 15 * 60_000);
  // the per-league day pages, today's and yesterday's, in a hidden page: three minutes after the start, then hourly
  setTimeout(() => { try { orchestrator.scoresDayRead(); } catch (e) { report(e); } }, 180_000);
  setInterval(() => { try { orchestrator.scoresDayRead(); } catch (e) { report(e); } }, 60 * 60_000);
  setTimeout(() => { try { orchestrator.videoEventsRead(hiddenServices()); } catch (e) { report(e); } }, 90_000);
  setInterval(() => { try { orchestrator.videoEventsRead(hiddenServices()); } catch (e) { report(e); } }, 30 * 60_000);
  setInterval(() => { try { labelSignIns(); } catch (e) { report(e); } }, 30 * 60_000);
  // the music services' playlist pages (adapter musicLibraryUrl): a minute after the start, then every ten (each service at most every six hours)
  setTimeout(() => { try { orchestrator.musicLibraryRefresh(); } catch (e) { report(e); } }, 60_000);
  setInterval(() => { try { orchestrator.musicLibraryRefresh(); } catch (e) { report(e); } }, 10 * 60_000);
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
  // the wall's cover over the service's pages while a press moves the screen to another episode (2026-10-06: start-over's previous episode,
  // "I pressed back episode 3x ... it showed the pages while I was navigating"; the next episode, "it showed the big door prize home page, and
  // then started the video"): the same word a phone pick sends; the screen only, and not while multiview's small windows are up (that word
  // steps their target, and the wall is not one screen then)
  const coverScreen = (tile: string, title: string): void => {
    const sv = videoServices();
    if (!sv.screen || sv.screen.slot !== tile) return;
    const mv = orchestrator.videoMultiviewState();
    if (mv.on && !mv.collapsed) return;
    const s = sv.services.find((x) => x.facet === sv.screen!.facet);
    void drivers.ui?.videoPick?.(title, s?.name ?? sv.screen.app, orchestrator.videoArtOf(tile)?.art ?? null);
  };
  orchestrator.episodeMoveHook = coverScreen;
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
      for (const w of mvWindows()) if (w.tile !== sv2.screen?.slot) orchestrator.noteTitleCleared(w.tile);   // their services' Continue Watching read soon (2026-09-26)
      if (sv2.screen) {
        orchestrator.noteTitleCleared(sv2.screen.slot);
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
      orchestrator.noteTitleCleared(arg);   // a window's X: its service's Continue Watching read soon (2026-09-26)
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
      return { index: i, tile: w.tile, app: w.app, facet: w.facet, name: sv.services.find((x) => x.app === w.app)?.name ?? w.app, title: v ? [v.series, v.title].filter(Boolean).join(" \u00B7 ") : null, playing: !!t?.playing, can: t?.can ?? null };   // can: the big window's bar draws the screen's verbs (2026-10-01)
    });
    // what the big screen holds, with multiview on or off (2026-09-24, "Should screen 2 show if nothing has been added to screen 1?"): a
    // second window is offered only once the big one has a title playing or loading
    const scr = sv.screen;
    const bt = scr ? vs.find((x) => x.id === scr.slot) : undefined;
    const loading = !!bt?.pending && !bt.pending.failed && !bt.video;
    const bigTitle = bt?.video ? [bt.video.series, bt.video.title].filter(Boolean).join(" \u00B7 ") : loading ? bt!.pending!.name : null;
    const big = scr ? { tile: scr.slot, app: scr.app, name: sv.services.find((x) => x.app === scr.app)?.name ?? scr.app, title: bigTitle, loading, playing: !!bt?.playing, starting: !!scr && orchestrator.videoStartingOpen(scr.slot), has: !!bt?.video || loading } : null;   // playing: the host's corner holds a loading title out until it plays (2026-10-06)
    return { on: st.on && !st.collapsed, target: mvTarget, max: MV_MAX, windows: st.collapsed ? wins.slice(0, 1) : wins, big };
  };
  const videoSwitch = (facetId: string): Record<string, unknown> => {
    const mv = mvPlace(facetId);   // multiview: the service gets a window (or its window comes forward); the screen slot is never re-pointed under it
    if (mv?.refused) return { ok: false, error: mv.refused };
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
    // TMDB's landscape backdrop first (a store's art is a tall poster), else the store's own poster, drawn bright and centred in the wide card,
    // else the store's own landscape picture (videoOwnedArtWide: Fandango's background still, darkened by Fandango for its own page), else
    // TMDB's poster. The still came before the poster until 2026-10-06 ("without TMDB connected, I have a library but all of the posters are
    // dimmed ... We shouldn't intentionally degrade any functionality"): without a key nearly every Fandango card showed the darkened still.
    const adapterOf = new Map(sv.services.map((s) => [s.app, s.adapter]));
    const ownWide = (c: { app: string; item: VideoItem; also: Array<{ app: string; item: VideoItem }> }) => [c, ...c.also].map((x) => orchestrator.ownedWideArt(adapterOf.get(x.app) ?? x.app, x.item.id)).find((u) => !!u) ?? null;
    return [...byTitle.values()].map((c) => { const backdrop = orchestrator.backdropFor(c.item.title, c.item.kind); if (backdrop) return { ...c, item: { ...c.item, artwork: backdrop } }; const own = c.item.artwork ?? c.also.find((x) => x.item.artwork)?.item.artwork ?? null; const art = own ?? ownWide(c) ?? orchestrator.posterFor(c.item.title, c.item.kind); return art && art !== c.item.artwork ? { ...c, item: { ...c.item, artwork: art } } : c; }).sort((a, b) => a.item.title.localeCompare(b.item.title, undefined, { sensitivity: "base" }));
  };
  // the Library tab: the owned titles by genre, rated (orchestrator.videoLibraryRows)
  // the Library tab's sort (2026-09-22; the Watch tab's rows keep their own order - a global sort there made every lens row look the same): the person's choice kept on the device; the host passes it with each ask and reads it back in the answer
  // the sort settings are the profile set's (2026-09-27, "Make sure the sort settings are saved by profile set too. So if I switch, they get updated
  // to the new profile set preference"): kept under <key>:<preset> for the active set (the first while none is active); a set that never chose
  // reads the shared value, which is also where a choice goes while no set exists
  const setKeyOf = (key: string): string | null => { const st = presetsNow(); return st.presets.length ? key + ":" + (st.active ?? st.presets[0]!.id) : null; };
  const setRead = (key: string): string | null => { const k = setKeyOf(key); return (k ? tilesRead(k) : null) ?? tilesRead(key); };
  const setWrite = (key: string, v: string): void => { try { void drivers.store?.set(setKeyOf(key) ?? key, v); } catch (e) { report(e); } };
  const hubSortNow = (): HubSort => hubSortOf(setRead("video:hub-sort"));
  // Continue watching's order (2026-09-26): grouped by service or A to Z, the person's choice kept on the device
  const rowOrderNow = (row: "continue" | "list"): string => row === "continue" ? continueOrderOf(setRead("video:continue-order")) : listOrderOf(setRead("video:list-order"));
  const rowOrderSet = (row: "continue" | "list", v: unknown): string => {
    const o = row === "continue" ? continueOrderOf(v) : listOrderOf(v);
    if (v !== undefined && v !== null && o !== rowOrderNow(row)) setWrite(row === "continue" ? "video:continue-order" : "video:list-order", o);
    return v === undefined || v === null ? rowOrderNow(row) : o;
  };
  const rowReverseNow = (row: "continue" | "list"): boolean => reverseOf(setRead("video:" + row + "-reverse"));
  const rowReverseSet = (row: "continue" | "list", v: unknown): boolean => {
    if (v === undefined || v === null || v === "") return rowReverseNow(row);
    const r = reverseOf(v);
    if (r !== rowReverseNow(row)) setWrite("video:" + row + "-reverse", r ? "1" : "0");
    return r;
  };
  orchestrator.rowOrders = () => ({ continue: continueOrderOf(rowOrderNow("continue")), list: listOrderOf(rowOrderNow("list")), continueReverse: rowReverseNow("continue"), listReverse: rowReverseNow("list") });
  const hubSortSet = (v: unknown): HubSort => { const sort = hubSortOf(v); if (v !== undefined && v !== null && sort !== hubSortNow()) setWrite("video:hub-sort", sort); return v === undefined || v === null ? hubSortNow() : sort; };
  const LIBRARY_GROUPS = [
    { id: "genre", label: "Genre", hint: "A row per genre (TMDB's first genre for each title), the biggest genres first." },
    { id: "none", label: "None", hint: "Every title in one list, in the sort you chose." },
  ] as const;
  const videoLibraryTab = (sortArg?: string | null, groupArg?: string | null): Record<string, unknown> => {
    try { orchestrator.videoRefreshOwnedIfStale(hiddenServices()); } catch (e) { report(e); }   // the owned libraries read again when Library opens and they are hours old
    orchestrator.modelApps = () => model.snapshot().apps.map((a) => ({ id: a.id, ...(a.adapter ? { adapter: a.adapter } : {}), ...(a.catalogRef ? { catalogRef: a.catalogRef } : {}) }));
    const cards = ownedCards();
    const sort = hubSortSet(sortArg);
    // no TMDB key: one A to Z grid (2026-10-06, "I should be able to just view an A-Z grid of all items even when TMDB isn't connected. Right
    // now it says Unsorted 2223"): genres are TMDB's, so without a key every title had sat in one Unsorted row; Genre is offered with a key
    const hasKey = orchestrator.lensHasKey();
    const group = groupArg === "none" || !hasKey ? "none" : "genre";
    const r = orchestrator.videoLibraryRows(cards, sort, group);
    const services = [...new Set(cards.flatMap((c) => [c.service, ...c.also.map((a) => a.service)]))];
    return { ...r, total: cards.length, twice: cards.filter((c) => c.also.length > 0).length, services, tmdbKey: hasKey, sort, sorts: HUB_SORTS, group, groups: hasKey ? LIBRARY_GROUPS : LIBRARY_GROUPS.filter((g) => g.id === "none") };
  };
  let bootRowsAsked = false;
  // startup timings (2026-09-24): measured from this runtime's creation, read by the host into host.log ("boot timing")
  let episodeHealthResult: unknown = null;
  const bootAt = Date.now();
  let menuReadyAt: number | null = null;   // the boot's Phase 2 has asked for every service's kept rows
  // the services' My List titles not on the watchlist yet, counted and named (video.ts watchlistMissing; the copy matches properly)
  const watchOfferOf = (list: ReadonlyArray<{ service?: string; app?: string; item: { title: string; kind?: string } }>, w: { cards: ReadonlyArray<{ title: string; kind: string }> }): { offer: number; offerTitles: Array<{ title: string; service: string }> } => {
    const missing = watchlistMissing(list, w.cards);
    return { offer: missing.length, offerTitles: missing.slice(0, 40) };
  };
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
      // My list is the TMDB watchlist while an account is linked (2026-10-03); the offer counts the services' list titles not on it yet
      watchlist: (() => { try { const w = orchestrator.videoWatchlist(hiddenServices()); return w.active ? { ...w, ...watchOfferOf(rows.list as Array<{ service?: string; app?: string; item: { title: string; kind?: string } }>, w), importing: orchestrator.watchlistImportState() } : null; } catch (e) { report(e); return null; } })(),
      continue: rows.continue, list: rows.list, orders: orchestrator.rowOrders(), orderChoices: { continue: CONTINUE_ORDERS, list: LIST_ORDERS }, lens, lensRows,
      // what the person owns, every service's purchases as ONE library ("it will be nice to see a consolidated library", 2026-09-22): the
      // titles alphabetical, each card badged with its service; the same title bought twice is two cards, one per service
      owned,

      live: sv.services.filter((s) => s.live.length > 0).map((s) => ({ app: s.app, name: s.name, facet: s.facet, channels: s.live })),
      services: sv.services.map((s) => ({ app: s.app, name: s.name, facet: s.facet, status: s.status, onScreen: s.onScreen, adapter: s.adapter, profiles: s.profiles, profile: s.profile })),
      search: sv.services.filter((s) => s.hasSearch).map((s) => ({ app: s.app, name: s.name, facet: s.facet })),
      suggestions: sv.services.filter((s) => (s.library.shelves ?? []).length > 0).map((s) => ({ app: s.app, name: s.name, facet: s.facet, shelves: s.library.shelves })),
      // the person's own rows on a service (2026-10-05: Twitch's Followed channels and latest videos): drawn on Watch always, never a suggestion
      ownRows: sv.services.filter((s) => (s.library.own ?? []).length > 0).map((s) => ({ app: s.app, name: s.name, facet: s.facet, rows: s.library.own })),
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
      if (mv?.refused) return { ok: false, error: mv.refused };
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
  // ---- sign-ins (sign-ins.ts, 2026-09-29): one login kept on the device, by name; a service uses one at a time; a profile set names one
  // for any service of either player
  let signInsKept: SignInState | null = null;
  const signInsNow = (): SignInState => (signInsKept ??= parseSignIns(tilesRead(SIGN_INS_KEY)));
  const signInsWrite = (st: SignInState): void => { if (st === signInsKept) return; signInsKept = st; try { void drivers.store?.set(SIGN_INS_KEY, JSON.stringify(st)); } catch (e) { report(e); } };
  const learnAccounts = (entries: readonly SetupEntry[]): void => {
    const st = signInsNow();
    let accountOf = st.accountOf, accounts = st.accounts;
    for (const e of entries) {
      if (!e || typeof e.id !== "string" || !e.id) continue;
      const key = accountKey(e.id, e.signInWith);
      const old = accountOf[e.id];
      if (old === key) continue;
      accountOf = { ...accountOf, [e.id]: key };
      // a service's account changed (a catalog that now shares it): its sign-ins come along, names and all (2026-09-29 review)
      if (old && accounts[old]?.length) {
        const there = accounts[key] ?? [];
        const renamed: Array<[string, string]> = [];
        const moved = accounts[old]!.filter((s) => !there.some((t) => t.profile === s.profile)).map((s) => { if (!there.some((t) => t.id === s.id)) return s; const id = s.id + "-" + old.replace(/[^a-z0-9]+/gi, "-"); renamed.push([s.id, id]); return { ...s, id }; });
        // the old account stays for any other service still on it (a service un-shared from an account keeps nobody else's sign-ins from it)
        const othersOnOld = Object.entries(accountOf).some(([app, k]) => app !== e.id && k === old);
        const rest = othersOnOld ? accounts : Object.fromEntries(Object.entries(accounts).filter(([k]) => k !== old));
        accounts = { ...rest, [key]: [...there, ...moved] };
        if (renamed.length) { const ps = presetsNow(); let changed = false; for (const p of ps.presets) for (const [was, is] of renamed) if (p.signIns?.[e.id] === was) { p.signIns[e.id] = is; changed = true; } if (changed) presetsWrite(ps); }
      }
    }
    if (accountOf !== st.accountOf || accounts !== st.accounts) signInsWrite({ ...st, accountOf, accounts });
  };
  const accountOfApp = (appId: string): string => signInsNow().accountOf[appId] ?? accountKey(appId);
  const adapterKeyOf = (appId: string): string => { const a = model.app(appId); return a?.adapter ?? a?.catalogRef ?? orchestrator.adapterNameForUrl(a?.baseUrl) ?? appId; };
  /** The services of the two players: the Video player's, and the Music player's sources. */
  const playerApps = (): Array<{ app: string; name: string; kind: "music" | "video"; status: string }> => {
    const out: Array<{ app: string; name: string; kind: "music" | "video"; status: string }> = [];
    const music = playersNow().music;
    for (const h of music?.hidden ?? []) {
      const f = model.facet(h.facet);
      const a = f?.music ? model.app(f.app) : undefined;
      if (a && !out.some((x) => x.app === a.id)) out.push({ app: a.id, name: a.name, kind: "music", status: a.setup.status });
    }
    for (const s of videoServices().services) if (!out.some((x) => x.app === s.app)) out.push({ app: s.app, name: s.name, kind: "video", status: s.status });
    return out;
  };
  /** Every service's present profile is a sign-in of its account (a device from before sign-ins, a first sign-in). */
  // ---- one browser, many sign-ins (sign-ins.ts, 2026-10-03): the one-time move of legacy profiles onto the shared ones. Core plans the
  // move (every account's sign-ins onto slots) and asks the host to copy each old folder's sessions - cookies, local storage for the
  // service's origin, IndexedDB - onto the shared folder, then moves the sign-ins and the Apps. The old folders stay (section 10). A host
  // that does not answer leaves everything as it was for the next boot. Marker: PROFILES_SHARED_KEY, with what was done.
  const PROFILES_SHARED_KEY = "profiles:shared";
  let sharedMigrated: ((ev: Extract<SurfaceEvent, { type: "profile-migrated" }>) => void) | null = null;
  const sharedMoves = new Map<string, string>();
  const sharedMovesMap = () => sharedMoves;
  const originOf = (url: string | null | undefined): string | null => { try { return url ? new URL(url).origin : null; } catch { return null; } };
  const sharedProfilesMigrate = async (): Promise<void> => {
    try {
      if (tilesRead(PROFILES_SHARED_KEY)) { sharedProfilesOn = true; return; }
      const apps = model.snapshot().apps;
      const plan = sharedPlan(signInsSettled());
      for (const a of apps) if (!isSharedProfile(a.profileId) && !plan.moves.some((m) => m.from === a.profileId)) plan.moves.push({ from: a.profileId, to: SHARED_PROFILE });
      if (!plan.moves.length) { void drivers.store?.set(PROFILES_SHARED_KEY, JSON.stringify({ moves: [] })); sharedProfilesOn = true; return; }
      const moves = plan.moves.map((m) => {
        const origins = new Set<string>();
        for (const a of apps) if (a.profileId === m.from) { const o = originOf(a.baseUrl); if (o) origins.add(o); for (const f of model.snapshot().facets) if (f.app === a.id) { const fo = originOf(f.url); if (fo) origins.add(fo); } }
        return { ...m, origins: [...origins] };
      });
      const answer = await new Promise<Extract<SurfaceEvent, { type: "profile-migrated" }> | null>((resolve) => {
        const timer = setTimeout(() => { sharedMigrated = null; resolve(null); }, 240_000);
        sharedMigrated = (ev) => { clearTimeout(timer); sharedMigrated = null; resolve(ev); };
        send("profile.migrate", { moves });
      });
      if (!answer || !answer.ok) { report(new Error("shared profiles: the host " + (answer ? "could not move the sessions: " + (answer.note ?? "") : "did not answer") + " - left as they were")); return; }
      for (const m of plan.moves) sharedMoves.set(m.from, m.to);
      signInsWrite(plan.state);
      for (const a of apps) { const to = sharedMoves.get(a.profileId); if (to) model.saveApp({ ...a, profileId: to }); }
      void drivers.store?.set(PROFILES_SHARED_KEY, JSON.stringify({ moves: answer.moves, note: answer.note ?? null }));
      sharedProfilesOn = true;
    } catch (e) { report(e); }
  };
  const signInsSettled = (): SignInState => {
    let st = signInsNow();
    for (const s of playerApps()) { const a = model.app(s.app); if (a) st = withProfile(st, accountOfApp(s.app), a.profileId, a.name); }
    signInsWrite(st);
    return st;
  };
  const signInsView = () => {
    const st = signInsSettled();
    const apps = playerApps();
    return { services: apps.map((s) => {
      const key = accountOfApp(s.app);
      const list = st.accounts[key] ?? [];
      const cur = signInByProfile(st, key, model.app(s.app)?.profileId ?? "");
      // a hidden sign-in is not offered - unless a service is on it still (a set brought it back): then it is listed, marked
      return { app: s.app, name: s.name, kind: s.kind, status: s.status, account: key, shares: apps.filter((o) => o.app !== s.app && accountOfApp(o.app) === key).map((o) => o.name), signIns: list.filter((x) => !x.hidden || x.id === cur?.id).map((x) => ({ id: x.id, name: x.name, ...(x.hidden ? { hidden: true } : {}) })), hidden: list.filter((x) => x.hidden && x.id !== cur?.id).map((x) => ({ id: x.id, name: x.name })), current: cur?.id ?? null };
    }) };
  };
  // A sign-in nobody named is named from what its service's own account page shows (2026-09-29, "Instead of even naming the sign ins,
  // can you just capture the username or likely email address that is used?"): the page is read once, hidden, after the person has signed
  // in - never the sign-in form, never a page's script data. One service at a time; an account's label found on one of its services names
  // the sign-in for all of them.
  let labelling = false;
  const labelSignIns = (): string[] => {
    const now = Date.now();
    const st = signInsSettled();
    const jobs: Array<{ app: string; key: string; profile: string; adapter: string; url: string; within?: string; name?: string }> = [];
    const taken = new Set<string>();
    for (const s of playerApps()) {
      if (s.status !== "signed-in") continue;
      const app = model.app(s.app);
      if (!app) continue;
      const key = accountOfApp(s.app);
      const cur = signInByProfile(st, key, app.profileId);
      if (!cur || !wantsLabel(cur, now) || taken.has(key + "|" + cur.id)) continue;
      const adapter = adapterKeyOf(s.app);
      const spec = orchestrator.adapterSpec(adapter)?.account;
      if (!spec?.url || !/^https:\/\//i.test(spec.url)) continue;
      taken.add(key + "|" + cur.id);
      jobs.push({ app: s.app, key, profile: app.profileId, adapter, url: spec.url, ...(spec.within ? { within: spec.within } : {}), ...(spec.name ? { name: spec.name } : {}) });
    }
    if (!jobs.length || labelling) return [];
    labelling = true;
    void (async () => {
      try {
        for (const j of jobs) {
          const raw = await orchestrator.readHiddenPage({ app: j.app, adapter: j.adapter, profile: j.profile }, j.url, accountReadJs(j), (r) => accountLabel(r) !== null);
          // the service may have moved to another sign-in while its page was read: the label is this profile's
          if (model.app(j.app)?.profileId !== j.profile) continue;
          signInsWrite(labelFromPage(signInsNow(), j.key, j.profile, accountLabel(raw)?.label ?? null, Date.now()));
        }
      } catch (e) { report(e); } finally { labelling = false; }
    })();
    return jobs.map((j) => j.app);
  };
  /** The sign-in each player service uses now, by App - what a profile set keeps. */
  const signInsInUse = (): Record<string, string> => Object.fromEntries(signInsView().services.filter((s) => s.current).map((s) => [s.app, s.current!]));
  /** One service to one sign-in; the wall is NOT applied here (the caller applies once for every move it makes). */
  const moveToSignIn = (appId: string, signInId: string): { ok: boolean; changed: boolean; status?: string; error?: string } => {
    const app = model.app(appId);
    if (!app) return { ok: false, changed: false, error: "unknown service" };
    const key = accountOfApp(appId);
    let st = withProfile(signInsSettled(), key, app.profileId, app.name);
    const to = signInById(st, key, signInId);
    if (!to) return { ok: false, changed: false, error: "not a sign-in of this service" };
    if (to.profile === app.profileId) return { ok: true, changed: false, status: app.setup.status };
    const from = signInByProfile(st, key, app.profileId)!;
    st = noteStatus(st, key, app.profileId, appId, app.setup.status);   // what it knew here, for its return
    const status = to.status?.[appId] === "signed-in" || to.status?.[appId] === "needs-attention" ? to.status[appId]! : "unknown";
    const r = model.saveApp({ ...app, profileId: to.profile, setup: { status } });
    appSignedIn(appId);   // another sign-in: the hidden page's word about the last one is over (2026-09-30 review)
    if (!r.ok) return { ok: false, changed: false, error: r.error };
    signInsWrite(st);
    orchestrator.appSignInChanged(appId, adapterKeyOf(appId), from.id, to.id, from.profile);
    return { ok: true, changed: true, status };
  };
  /** Several services moved, the wall applied once after (its windows are made again in the new profiles). */
  const moveToSignIns = (picks: Record<string, string>): { moved: string[]; failed: string[] } => {
    const moved: string[] = [], failed: string[] = [];
    for (const [app, id] of Object.entries(picks)) { const r = moveToSignIn(app, id); if (!r.ok) failed.push(app); else if (r.changed) moved.push(app); }
    if (moved.length) { const active = model.activeScene(); if (active) applyScene(active); }
    return { moved, failed };
  };
  // ---- profile presets (2026-09-24, "allow the user to save any number of profile presets. So if another user logs in, they can change the
  // preset and therefore all service profiles"): {presets:[{id, name, picks:{app:{id,name}}}], active} on the device
  // off: the services EXCLUDED for the person on now (2026-09-24, "add an <Exclude> option too, so if someone doesn't want to use a specific
  // service for their profile specific items Continue + My list, they can, but we'll still bring it into the lists below, library and browse")
  // signIns (2026-09-29): the sign-in each service uses for this person, music and video alike - the Music player's people are these sets
  type ProfilePreset = { id: string; name: string; picks: Record<string, { id: string; name: string }>; off?: string[]; signIns?: Record<string, string> };
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
  const videoRefreshLists = (force: boolean): Record<string, unknown> => ({ ok: true, asked: orchestrator.videoRefreshLists(hiddenServices(), force, force) });   // forced = a person's Refresh: at once
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
  // Watch settings' Video ads (2026-10-07): veil (the default), mute or show - read once the store answers, kept on every change
  const ADS_LOOK_KEY = "video:ads-look";
  let adsLookLoaded = false;
  const loadAdsLook = () => {
    if (adsLookLoaded) return;
    try {
      const v = tilesRead(ADS_LOOK_KEY);
      if (v === "veil" || v === "mute" || v === "show") orchestrator.videoAdsLook = v;
      adsLookLoaded = true;
    } catch { /* tried again below */ }
  };
  loadAdsLook();
  setTimeout(loadAdsLook, 5_000);
  // Service suggestions (2026-10-08): Watch's switch, named to core so the hidden reads fetch each service's own rows from its home page
  // while it is on. The host keeps the switch (its pref) and says it again whenever Watch opens; kept here so a restart knows before then.
  const SUGGESTIONS_KEY = "video:suggestions";
  let suggestionsLoaded = false;
  const loadSuggestions = () => {
    if (suggestionsLoaded) return;
    try {
      const v = tilesRead(SUGGESTIONS_KEY);
      if (v === "1" || v === "0") { orchestrator.videoSuggestions = v === "1"; suggestionsLoaded = true; }
      const at = JSON.parse(tilesRead(Orchestrator.HOME_ROWS_KEY) ?? "null") as Record<string, unknown> | null;
      if (at && typeof at === "object") for (const [app, t] of Object.entries(at)) {
        if (orchestrator.homeRows.has(app)) continue;
        const h = t as { at?: unknown; miss?: unknown } | number | null;
        if (typeof h === "number") orchestrator.homeRows.set(app, { at: h, miss: 0 });   // (the first build kept the time alone)
        else if (h && typeof h.at === "number") orchestrator.homeRows.set(app, { at: h.at, miss: typeof h.miss === "number" ? h.miss : 0 });
      }
    } catch { /* tried again below */ }
  };
  loadSuggestions();
  setTimeout(loadSuggestions, 5_000);
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
      orchestrator.videoCatalogResolve(appId, title, hiddenServices(), kind).then((hit) => {
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
  // a hidden title is the profile set's (2026-09-26, "When someone hides something in the binge, that should be stored by profile set. So if its
  // set to Alex, thats where it's saved. i guess if no profile set is saved, then just save it to the base and once a profile set is saved, move
  // it to the first one"): hidden notes live under video:binge-hidden:<preset> for the active set (the first set while none is active), in the
  // base key only while no set exists; the base's hidden notes move to the first set once one does. A title found missing on its service is
  // about the service, not the person: those notes stay in the base, shared.
  const bingeRead = (key: string): BingeNote[] => { try { const v = JSON.parse(tilesRead(key) ?? "[]"); return Array.isArray(v) ? v.filter((n): n is BingeNote => !!n && typeof n.id === "string") : []; } catch { return []; } };
  const bingeLive = (x: BingeNote) => x.why === "hidden" || Date.now() - x.at < BINGE_MISS_MS;
  const bingeSetKey = (): string | null => {
    const st = presetsNow();
    if (!st.presets.length) return null;
    const first = BINGE_HIDDEN_KEY + ":" + st.presets[0]!.id;
    const base = bingeRead(BINGE_HIDDEN_KEY);
    if (base.some((x) => x.why === "hidden")) {   // the base's hidden titles move to the first set, once
      const into = bingeRead(first);
      const moved = [...into, ...base.filter((x) => x.why === "hidden" && !into.some((y) => y.id === x.id))];
      try { void drivers.store?.set(first, JSON.stringify(moved)); void drivers.store?.set(BINGE_HIDDEN_KEY, JSON.stringify(base.filter((x) => x.why !== "hidden"))); } catch (e) { report(e); }
    }
    return BINGE_HIDDEN_KEY + ":" + (st.active ?? st.presets[0]!.id);
  };
  const bingeNotes = (): BingeNote[] => {
    const set = bingeSetKey();
    const base = bingeRead(BINGE_HIDDEN_KEY);
    return set ? [...base.filter((x) => x.why !== "hidden"), ...bingeRead(set).filter((x) => x.why === "hidden")] : base;
  };
  const bingeHidden = (): Set<string> => new Set(bingeNotes().filter(bingeLive).map((n) => n.id));
  const bingeNote = (n: BingeNote | null, dropId?: string) => {
    const id = n?.id ?? dropId;
    const set = bingeSetKey();
    const write = (key: string, keep: (x: BingeNote) => boolean, add: boolean) => {
      const list = bingeRead(key).filter((x) => x.id !== id && bingeLive(x) && keep(x));
      if (add && n) list.push(n);
      void drivers.store?.set(key, JSON.stringify(list));
    };
    if (set) {
      write(BINGE_HIDDEN_KEY, () => true, !!n && n.why === "missing");
      write(set, (x) => x.why === "hidden", !!n && n.why === "hidden");
    } else write(BINGE_HIDDEN_KEY, () => true, !!n);
  };
  const BINGE_CAVEAT = "Each network sets its own ratings. TV-PG has no official age, so where it falls here is Prism's own choice. Unrated titles are hidden while Kids mode is on.";
  const bingeHead = () => {
    const { thresholds } = bingeSettingsNow();
    const w = bingeWords(thresholds);
    return { id: THE_BINGE.id, name: THE_BINGE.name, label: w.label, counted: w.counted, who: THE_BINGE.who, decides: THE_BINGE.decides, source: THE_BINGE.source, sourceUrl: THE_BINGE.sourceUrl, formula: w.formula,
      thresholds, attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability data from JustWatch, through TMDB." };
  };
  // ---- Playlists (docs/features/playlists.md, 2026-09-27): playlists.ts, wired to the real services, the details window's episode path and the
  // existing play path; continuous play follows the screen through the orchestrator's watch reports and the player's `ended`
  const playlists = createPlaylists({
    read: (k) => tilesRead(k),
    write: (k, v) => { try { void drivers.store?.set(k, v); } catch (e) { report(e); } },
    presets: () => presetsNow(),
    services: () => { const byApp = new Map(videoServices().services.map((s) => [s.app, s])); return hiddenServices().map((h) => ({ ...h, facet: byApp.get(h.app)?.facet ?? h.facet, status: byApp.get(h.app)?.status ?? h.status })); },
    screen: () => videoServices().screen?.slot ?? null,
    state: (id) => (orchestrator.videoState().find((t) => t.id === id) as never) ?? null,
    playOn: (facet, kind, id, url, name) => videoPlayOn(facet, kind, id, url, name),
    playCatalog: (s, title, kind) => playCatalog(s, title, kind),
    episodesOf: (s, series) => orchestrator.episodesOf({ app: s.app, name: s.name, adapter: s.adapter, profile: s.profile ?? s.app, home: s.home ?? "", status: s.status }, series, { kind: "series", title: "", series } as import("./types.js").VideoContext),
    episodeByNumber: (app, series, sn, en) => orchestrator.episodeByNumber(app, series, sn, en),
    myList: () => (videoMenu().list as never) ?? [],
    onEndOf: (id) => orchestrator.onEndOf(id),
    pause: (id) => { orchestrator.tileCommand(id, "pause").catch(report); },
    atEnd: (id) => orchestrator.titleAtEnd(id),
    releaseOf: (title, kind) => orchestrator.releaseFor(title, kind),
    airDatesOf: (show) => orchestrator.tvAirDates(show),
    tvSeasonsById: (id) => orchestrator.tvSeasonsById(id),
    altTitlesOf: (id) => orchestrator.tvAltTitles(id),
    tmdbIdOf: (title, kind) => orchestrator.tmdbIdOf(title, kind),
    // playlists on the person's TMDB lists (playlist-tmdb.ts, 2026-10-03): the account with lists, the lens primitives, TMDB's seasons, the
    // services here that carry a title
    tmdb: {
      account: () => orchestrator.tmdbLists.listsAccount(),
      api: orchestrator.tmdbLists,
      seasonsOf: async (id) => { const s = await orchestrator.tvSeasonsById(id); return s ? s.map((x) => ({ season: x.season, episodes: x.episodes.map((e) => ({ episode: e.episode, title: e.title, still: e.still, airDate: e.airDate })) })) : null; },
      carriedBy: (kind, id) => orchestrator.carriedBy(hiddenServices(), kind, id),
    },
    pictureOf: (title, kind) => {
      const wide = orchestrator.backdropFor(title, kind) ?? orchestrator.posterFor(title, kind);
      if (wide) return wide;
      const k = titleKey(title);
      const own = ownedCards().find((c) => titleKey(c.item.title) === k || [c, ...c.also].some((x) => titleKey(x.item.title) === k));
      return own ? ([own, ...own.also].map((x) => x.item.artwork).find((a) => !!a) ?? null) : null;
    },
    now: () => Date.now(),
    later: (fn, ms) => void setTimeout(fn, ms),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    report,
  });
  orchestrator.onWatchReport = (id) => playlists.step(id, false);
  orchestrator.onPlaybackEnded = (id) => playlists.step(id, true);
  const plJson = <T,>(fn: () => T): string => { try { return json(fn()); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } };
  const parseObj = (s: unknown): Record<string, unknown> => { try { const v = JSON.parse(String(s ?? "")); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
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
    if (mv?.refused) return { ok: false, error: mv.refused };
    if (mv) {
      if (mv.ready) orchestrator.videoTune(mv.tile, channelId, name ?? undefined, url).then((r) => { if (r !== "ok") report(new Error("videoTune " + facetId + ": " + r)); }, report);
      else orchestrator.videoTuneWhenUp(mv.tile, channelId, name ?? undefined, url);
      return { ok: true, switched: !mv.ready, multiview: true, ...(mv.sceneId ? { sceneId: mv.sceneId } : {}) };
    }
    if (sv.active && sv.screen?.facet === facetId) {
      orchestrator.videoTune(sv.screen.slot, channelId, name ?? undefined, url).then((r) => { if (r !== "ok") report(new Error("videoTune " + facetId + ": " + r)); }, report);
      return { ok: true, switched: false };
    }
    const r = videoSwitch(facetId);
    if (r.ok && typeof r.slot === "string") orchestrator.videoTuneWhenUp(r.slot, channelId, name ?? undefined, url);
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
    if (mv?.refused) return { ok: false, error: mv.refused };
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
  // ---- no spot keeper: the service's own position wins, as a rule (B-318, 2026-10-06, "I think the position the service thinks you're at
  // should win. Just as a rule."). Prism had kept where a title was left and sought there when a replay began near the top; that fought a
  // service resuming itself to a newer point (watched further on a TV app). Prism never seeks to a spot of its own now; the record it kept
  // (video:spots) stays in the store unread (section 10).
  // ---- a cold deep link the service bounced (2026-10-05, Show video after a restart "ended up on the main apple tv page"): the screen's
  // page went to the resume point's own address and the service sent it to its home within seconds (Apple TV does this on a cold load);
  // once the page says it is signed in, the title is asked for again through the adapter's own play, once per boot
  let bounced: { app: string; facet: string; slot: string; url: string; at: number } | null = null;
  let bounceRecovered = false;
  const bounceWatch = (ev: SurfaceEvent) => {
    if (ev.type === "navigated") {
      const sv = videoServices();
      if (!sv.screen || ev.id !== sv.screen.slot) return;
      const s = sv.services.find((x) => x.facet === sv.screen!.facet);
      const resume = s?.resume;
      if (!resume?.url) { bounced = null; return; }
      const url = (ev as { url?: string }).url ?? "";
      if (url === resume.url) { bounced = { app: s!.app, facet: s!.facet, slot: sv.screen.slot, url, at: Date.now() }; return; }
      if (bounced && Date.now() - bounced.at < 15_000) {
        let home = false;
        try { const u = new URL(url), r = new URL(bounced.url); home = u.host === r.host && (u.pathname === "/" || u.pathname.split("/").filter(Boolean).length <= 1); } catch { home = false; }
        if (home && !bounceRecovered) {
          bounceRecovered = true;
          const b = bounced; bounced = null;
          // the ask waits for the page's own signed-in report (the session probe) and two seconds more: 2.5 s after the bounce it bounced again
          // (09:25, 2026-10-05) - the app had not finished its sign-in; without the report, 20 s
          report(new Error("cold link bounced to " + url + "; " + resume.title + " will be asked for again through " + b.app + "'s own play once the page is signed in"));
          const ask = () => { if (!bounceAsk) return; bounceAsk = null; const r = videoPlayOn(b.facet, resume.kind, resume.id ?? resume.url ?? resume.title, resume.url ?? null, resume.title); report(new Error("cold link recovery: asked" + (r.ok ? "" : ", " + String(r.error)))); };
          bounceAsk = { slot: b.slot, ask };
          setTimeout(ask, 20_000);
          return;
        }
      }
      bounced = null;
    }
    if (ev.type === "session" && bounceAsk && ev.id === bounceAsk.slot && (ev as { state?: string }).state === "signed-in") {
      const a = bounceAsk.ask; setTimeout(a, 2000);
    }
  };
  let bounceAsk: { slot: string; ask: () => void } | null = null;
  const nextEpisodeFromList = (): Record<string, unknown> => {
    const sv = videoServices();
    if (!sv.screen) return { ok: false, error: "no Video player screen" };
    const tile = sv.screen.slot;
    const v = orchestrator.videoState().find((x) => x.id === tile)?.video ?? null;
    if (!v?.series || typeof v.season !== "number" || typeof v.episode !== "number") return { ok: false, error: "the page names no episode" };
    const list = orchestrator.videoEpisodes(tile, hiddenServices().find((x) => x.app === sv.screen!.app) ?? null);
    const season = list.seasons.find((x) => x.season === v.season);
    let next = season?.episodes.filter((e) => e.episode > v.episode!).sort((a, b) => a.episode - b.episode)[0] ?? null;
    let sn = v.season;
    if (!next) { const after = list.seasons.filter((x) => x.season > v.season!).sort((a, b) => a.season - b.season)[0]; if (after) { next = after.episodes.slice().sort((a, b) => a.episode - b.episode)[0] ?? null; sn = after.season; } }
    if (!next) return { ok: false, error: "no episode after this one in the list" };
    orchestrator.videoExpectEpisode(tile, { series: v.series, season: sn, episode: next.episode, title: next.title || `Episode ${next.episode}`, id: next.id ?? null });
    if (next.id && next.url) { const p = videoPlayOn(sv.screen.facet, "title", next.id, next.url, next.title || `S${sn} E${next.episode}`); if (p.ok) return { ok: true, did: "list", season: sn, episode: next.episode }; }
    const r = orchestrator.videoPlayEpisodeNumber(tile, sn, next.episode);
    return r === "ok" ? { ok: true, did: "number", season: sn, episode: next.episode } : { ok: false, error: String(r) };
  };
  const switchPlayer = (kind: string): Record<string, unknown> => {
    if (!isPlayerKind(kind)) return { ok: false, error: "unknown player " + kind };
    const found = playersNow();
    const target = found[kind];
    if (!target) return { ok: false, reason: "no-scene", template: PLAYER_TEMPLATES[kind][0] };
    const leaving = model.activeScene() !== target.id;
    let after: (() => void) | undefined;
    if (kind === "video") {
      // music sources an earlier build wrote into the Video player's scene leave it (the wall keeps them warm without them there)
      const clean = withoutMusic(target, (id) => model.facet(id));
      if (clean) { const r = model.saveScene(clean); if (!r.ok) report(new Error("switchPlayer: could not take the music sources out of the Video player: " + r.error)); }
      // the screen takes the sound back (2026-10-05): the music source that played kept the audio across the trip, and the video ran muted
      const layout = model.layout(target.layout);
      const screenSlot = layout?.slots.find((sl) => sl.id === "screen")?.id ?? layout?.slots[0]?.id ?? null;
      after = () => { const slot = videoServices().screen?.slot ?? screenSlot; if (slot) orchestrator.videoTakeAudio(slot).catch(report); };
      if (leaving) {
        const sources = new Set(orchestrator.musicSourceTiles().map((s) => s.tile));
        playerReturn = orchestrator.getState()?.tiles.find((t) => sources.has(t.id) && t.nowPlaying?.playing)?.id ?? null;
        // the music pauses on the way out (2026-10-05, "I switched from Music to Video, but the song continues to play. Please pause it when
        // switching to Video"): through its own player, so the way back can resume it where it stopped
        if (playerReturn) { const back = playerReturn; orchestrator.tileCommand(back, "pause").then((r) => { if (r !== "ok") report(new Error("switchPlayer: pause " + back + ": " + r)); }, report); }
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
  // a service's hidden page saying "signed out" on the service's own pages, not its sign-in page, is not believed at once (Apple TV's
  // watch sees a Sign In control for seconds while signed in) - but one that has said so for ten minutes with no account seen since, on
  // any page of the service, is believed (2026-09-30: Peacock's session lapsed at noon, its hidden page said signed out every twenty
  // minutes for five hours, and the wall still called it signed in)
  const HIDDEN_OUT_MS = 10 * 60_000;
  const hiddenOutSince = new Map<string, number>();
  /** An App written signed in by any path (the wizard's Done, a sign-in switch, a page seeing the account): the hidden page's streak ends (2026-09-30 review). */
  const appSignedIn = (appId: string): void => { hiddenOutSince.delete(appId); };
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

  const api: PrismRuntimeApi = {
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
        // one browser, many sign-ins (sign-ins.ts, 2026-10-03): the legacy profiles moved onto the shared ones before the first surface
        modelLoaded.then(() => sharedProfilesMigrate()).then(() => {
          let doc = parsed;
          try {
            const active = model.activeScene();
            const m = active && parsed.id ? drawScene(active, { w, h }, parsed.id, parsed) : null;
            if (m) doc = { ...m.doc, id: parsed.id };
            if (!m && Array.isArray((doc as { tiles?: unknown }).tiles)) {   // no scene drawn: the kept document's tiles follow the moved profiles too
              const map = sharedMovesMap();
              if (map.size) doc = { ...doc, tiles: doc.tiles.map((t) => (typeof t.profile === "string" && map.has(t.profile) ? { ...t, profile: map.get(t.profile)! } : t)) };
            }
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
      if (ev.type === "profile-migrated") { sharedMigrated?.(ev); return; }
      try { musicNextWatch(ev); sessionWatch(ev); bounceWatch(ev); } catch (e) { report(e); }
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
      // a service's hidden page tells the truth about its sign-in too (2026-09-28, the connections sweep: Hulu and Disney+ had been signed out all
      // day - their hidden pages went to MyDisney's login at every read - while the wall still called them signed in and kept reading them): a
      // hidden page still on the service's own sign-in page a while after it went there makes the App "needs attention"; its watch seeing the
      // account makes it signed in again. Every service with a sign-in page named.
      const hiddenApp = /^app:([^:]+):(lookup|work)$/.exec(ev.id)?.[1];
      if (hiddenApp) {
        const writeApp = (status: "signed-in" | "needs-attention") => {
          try { const app = model.app(hiddenApp); if (app && app.setup?.status !== status) model.saveApp({ ...app, setup: { status, lastVerified: new Date().toISOString().slice(0, 10), evidence: "probe" } }); } catch (e) { report(e); }
        };
        const svc = hiddenServices().find((x) => x.app === hiddenApp);
        const onLogin = (url: string | null | undefined): boolean => {
          const login = svc ? orchestrator.adapterSpec(svc.adapter)?.login : undefined;
          if (!login || !url) return false;
          try { const a = new URL(url), b = new URL(login); return a.host === b.host && a.pathname.replace(/[/]+$/, "").startsWith(b.pathname.replace(/[/]+$/, "")); } catch { return false; }
        };
        const standing = sessionSettle.get(ev.id);
        if (ev.type === "navigated" && onLogin(ev.url)) {
          if (!standing) sessionSettle.set(ev.id, setTimeout(() => { sessionSettle.delete(ev.id); if (onLogin(orchestrator.currentUrlOf(ev.id))) writeApp("needs-attention"); }, SESSION_SETTLE_MS));
        } else if (ev.type === "session" && ev.state === "signed-in") {
          // the account seen: signed in (again). A hidden page's "signed out" is not taken alone - Apple TV's watch saw a Sign In control on its
          // episode pages twice today while signed in; the sign-in page itself is the evidence
          if (standing) { clearTimeout(standing); sessionSettle.delete(ev.id); }
          appSignedIn(hiddenApp);
          writeApp("signed-in");
        } else if (ev.type === "session" && ev.state === "signed-out") {
          const since = hiddenOutSince.get(hiddenApp) ?? Date.now();
          hiddenOutSince.set(hiddenApp, since);
          if (Date.now() - since >= HIDDEN_OUT_MS) writeApp("needs-attention");
        }
      }
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
        if (ev.state === "signed-in") { write("signed-in"); const app = itemContext(ev.id)?.app; if (app) appSignedIn(app); }
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
      if (cmd === "play") orchestrator.videoPersonPlay(String(tileId));   // the person's Play on the wall: a stopped autoplay is theirs after all
      // Next episode (2026-10-05, Apple TV: "the scan time indicator switched episodes but the video never did"): the service's own Next first;
      // when the page still names the same episode three seconds on, the next one from the Episodes list, through the same play as a card
      if (cmd === "nextepisode") {
        const sv0 = videoServices();
        const before = sv0.screen && sv0.screen.slot === tileId ? orchestrator.videoState().find((x) => x.id === tileId)?.video ?? null : null;
        orchestrator.tileCommand(tileId, cmd).then((r) => {
          if (r !== "ok") report(new Error("tileCommand " + cmd + ": " + r));
          if (!before) return;
          setTimeout(() => {
            const now = orchestrator.videoState().find((x) => x.id === tileId)?.video ?? null;
            const same = !!now && now.id === before.id && now.episode === before.episode && now.season === before.season;
            if (!same) return;
            const r2 = nextEpisodeFromList() as { ok?: boolean; error?: string; did?: string };
            report(new Error("next episode: the service's own Next did nothing; " + (r2.ok ? "played the next from the Episodes list (" + r2.did + ")" : "the list could not: " + r2.error)));
          }, 3000);
        }, report);
        return;
      }
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
      try {
        const r = model.saveApp(JSON.parse(appJson));
        if (r.ok && r.value.setup?.status === "signed-in") appSignedIn(r.value.id);   // the wizard's Done, the setup window
        return json(r);
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
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
    playerSetupServices(entriesJson) {
      try { return json(setupServices(model, JSON.parse(entriesJson || "[]") as SetupEntry[], speaksMediaSession, removedNow())); } catch (e) { report(e); return "[]"; }
    },
    playerSetup(entriesJson, catalogJson) {
      try {
        const entries = JSON.parse(entriesJson || "[]") as SetupEntry[];
        const catalog = catalogJson ? (JSON.parse(catalogJson) as SetupEntry[]) : undefined;
        learnAccounts(catalog ?? entries);
        const r = setupPlayers(model, entries, speaksMediaSession, orchestrator.canvasSize(), catalog);
        // a service chosen again is on the players again
        if (r.ok) { const back = new Set(r.services.map((s) => s.id)); const was = removedNow(); if (was.some((a) => back.has(a))) setRemoved(was.filter((a) => !back.has(a))); }
        return json(r);
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    playerProfileFor(entryJson, catalogJson) {
      try { const e = JSON.parse(entryJson) as SetupEntry; return profileFor(model, e, JSON.parse(catalogJson || "[]") as SetupEntry[]); } catch (e) { report(e); return ""; }
    },
    playerRemove(appId) {
      try {
        const r = removeFromPlayers(model, String(appId ?? ""), removedNow());
        if (!r.ok) return json(r);
        setRemoved(r.removed);
        const active = model.activeScene();
        // its pages leave the wall now - a music service's warm page beside the Video player too (2026-09-29 review)
        if (active && (r.changed.includes(active) || (r.kind === "music" && playersNow().video?.id === active))) applyScene(active);
        return json(r);
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    reportContext() {
      try {
        const active = players().active;
        const pageOf = (tile: string | null | undefined): string | null => { const u = tile ? orchestrator.currentUrlOf(tile) : null; try { if (!u) return null; const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin + x.pathname : null; } catch { return null; } };
        const sv = videoServices();
        const ms = orchestrator.musicState() as unknown as { feeds?: Array<{ source?: string; active?: boolean }>; sources?: Record<string, { playbackState?: string }> };
        const musicTile = (ms.feeds ?? []).find((f) => f.active)?.source ?? Object.entries(ms.sources ?? {}).find(([, v]) => v.playbackState === "playing")?.[0] ?? null;
        const services = playerApps().map((a) => {
          const adapter = adapterKeyOf(a.app);
          const facets = model.snapshot().facets.filter((f) => f.app === a.app).map((f) => f.id);
          const onScreen = sv.screen && sv.services.find((x) => x.app === a.app)?.facet === sv.screen.facet ? sv.screen.slot : null;
          const tile = onScreen ?? facets.find((f) => !!orchestrator.currentUrlOf(f)) ?? null;
          return { app: a.app, name: a.name, kind: a.kind, adapter, version: orchestrator.adapterSpec(adapter)?.version ?? null, page: pageOf(tile) };
        });
        const videoApp = sv.screen ? sv.services.find((x) => x.facet === sv.screen!.facet)?.app ?? null : null;
        const musicApp = musicTile ? model.facet(musicTile)?.app ?? null : null;
        const selected = active === "video" ? videoApp : active === "music" ? musicApp : null;
        return json({ active, services, selected });
      } catch (e) { report(e); return json({ active: null, services: [], selected: null, error: String(e) }); }
    },
    players() {
      try { return json(players()); } catch (e) { report(e); return json({ active: null, music: null, video: null, error: String(e) }); }
    },
    async listenWindow(tile) { try { return json({ result: await orchestrator.setListenWindow(tile ? String(tile) : null), tile: orchestrator.listenWindow }); } catch (e) { report(e); return json({ error: String(e) }); } },
    updateStatus() { try { return json(orchestrator.updateStatus()); } catch (e) { report(e); return json({ error: String(e) }); } },
    async updateCheck() { try { return json(await orchestrator.checkUpdates()); } catch (e) { report(e); return json({ error: String(e) }); } },
    async updateInstallNow() { try { return json({ result: await orchestrator.installUpdateNow(), ...orchestrator.updateStatus() }); } catch (e) { report(e); return json({ error: String(e) }); } },
    updateSetSchedule(scheduleJson, enabled) {
      try {
        let s: { at: string; weekday?: number | null } | null = null;
        if (scheduleJson) { const j = JSON.parse(String(scheduleJson)) as { at?: unknown; weekday?: unknown }; if (typeof j.at === "string") s = { at: j.at, weekday: typeof j.weekday === "number" && j.weekday >= 0 && j.weekday <= 6 ? Math.floor(j.weekday) : null }; }
        orchestrator.setUpdateSchedule(s, enabled !== false);
        return json(orchestrator.updateStatus());
      } catch (e) { report(e); return json({ error: String(e) }); }
    },
    async updateSetChannel(channel) { try { await orchestrator.setUpdateChannel(asUpdateChannel(channel)); return json(orchestrator.updateStatus()); } catch (e) { report(e); return json({ error: String(e) }); } },
    musicPlayNext(tile, kind, id) { try { return json(remote.musicNext ? remote.musicNext.set(String(tile), String(kind), String(id)) : { ok: false, error: "no queue" }); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    musicNextNow() { try { return json(remote.musicNext?.get() ?? null); } catch (e) { report(e); return "null"; } },
    videoPlayNextEpisode() { try { return json(nextEpisodeFromList()); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
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
    // the menu without the Library (2026-10-03, perf): the Watch page's follow loops asked for the whole menu every three seconds - 1.5 MB a
    // call, the owned library 1 MB of it - and parsed it; the rows they follow are 30 KB, the lens rows 160 KB more
    videoMenuRows(withLenses) {
      try {
        const m = videoMenu() as Record<string, unknown>;
        const keep = ["ready", "watchlist", "continue", "list", "orders", "lens", "screen", "active", "log", "now", ...(withLenses === true || withLenses === "true" || withLenses === "1" ? ["lensRows"] : [])];
        return json(Object.fromEntries(keep.map((k) => [k, m[k]])));
      } catch (e) { report(e); return json({ error: String(e) }); }
    },
    videoMenu() {
      try { return json(videoMenu()); } catch (e) { report(e); return json({ continue: [], list: [], live: [], services: [], search: [], suggestions: [], screen: null, active: false, log: 0, now: Date.now() }); }
    },
    playlistsView(q, sort, listId) { return plJson(() => playlists.view(q ?? null, sort ?? null, listId ?? null)); },
    playlistsPicker() { return plJson(() => playlists.picker()); },
    playlistCreate(name, isPublic) { return plJson(() => playlists.create(String(name ?? ""), isPublic === true || isPublic === "true" || isPublic === "1")); },
    playlistGate() { return plJson(() => ({ ...playlists.gate(), ...(tmdbUi.state ? { linked: tmdbUi.state.linked, lists: !!tmdbUi.state.lists, listsPossible: !!tmdbUi.state.listsPossible, hasKey: tmdbUi.state.hasKey } : {}) })); },
    playlistSync() { return plJson(() => playlists.sync()); },
    playlistCopyLocal() { return plJson(() => playlists.copyLocal()); },
    playlistSetPublic(id, on) { return plJson(() => playlists.setPublic(String(id ?? ""), on === true || on === "true" || on === "1")); },
    playlistOpen(listId) { return plJson(() => playlists.open(String(listId ?? ""))); },
    playlistRename(listId, name) { return plJson(() => playlists.rename(String(listId ?? ""), String(name ?? ""))); },
    playlistDelete(listId) { return plJson(() => playlists.remove(String(listId ?? ""))); },
    playlistUndo() { return plJson(() => playlists.undo()); },
    playlistSend(targetJson, sourceJson) { orchestrator.notePersonAbout(); return plJson(() => playlists.send(parseObj(targetJson), parseObj(sourceJson) as unknown as PlSource)); },
    playlistImport(targetJson, appsJson, scope) { orchestrator.notePersonAbout(); return plJson(() => playlists.importMyList(parseObj(targetJson), (() => { try { const a = JSON.parse(String(appsJson ?? "[]")); return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []; } catch { return []; } })(), scope === "s1" ? "s1" : "all")); },
    playlistJob(jobId) { return plJson(() => playlists.job(String(jobId ?? ""))); },
    playlistJobConfirm(jobId, yes) { return plJson(() => playlists.confirm(String(jobId ?? ""), yes === "1" || yes === "true")); },
    playlistEdit(listId, opJson) { return plJson(() => playlists.edit(String(listId ?? ""), parseObj(opJson))); },
    playlistPlay(listId, itemKey) { orchestrator.notePersonAbout(); return plJson(() => playlists.play(String(listId ?? ""), itemKey ? String(itemKey) : null)); },
    playlistStop(mode) { return plJson(() => playlists.stop(mode === "now" ? "now" : "after")); },
    playlistMove(dir) { return plJson(() => playlists.move(dir === "previous" ? "previous" : "next")); },
    videoRowOrder(row, order, reverse) {
      const r = row === "list" ? "list" : "continue";
      const orders = r === "list" ? LIST_ORDERS : CONTINUE_ORDERS;
      try { return json({ row: r, order: rowOrderSet(r, order || null), reverse: rowReverseSet(r, reverse ?? null), orders }); } catch (e) { report(e); return json({ row: r, order: r === "list" ? "prism" : "title", reverse: false, orders }); }
    },
    videoTune(facetId, channelId, url, name) {
      try {
        // an event row of the grid (2026-09-30): the event plays as one, not as a channel
        const f = model.facet(String(facetId ?? ""));
        const ev = f ? orchestrator.liveEvents(f.app).find((e) => e.id === String(channelId ?? "")) : undefined;
        // one still to come is not opened (2026-09-30 review: its page's first primary button is not Watch, and a press there could write to
        // the household's Up Next); the answer says when
        if (ev && !ev.live) return json({ ok: false, error: ev.title + " has not started" + (ev.start ? ". It starts " + new Date(ev.start).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "") });
        if (ev) return json(videoPlayOn(String(facetId), "live", ev.id, ev.url ?? (url ?? null), ev.title));
        return json(videoTune(facetId, channelId, url ?? null, name ?? null));
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
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
      try { if (!pauseLoaded) { loadPause(); pauseLoaded = true; } loadAdsLook(); return json({ pause: orchestrator.bgPause, tmdbKey: orchestrator.lensHasKey(), background: orchestrator.backgroundState(), adsLook: orchestrator.videoAdsLook, suggestions: orchestrator.videoSuggestions }); }
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
    videoSetAdsLook(look) {
      try {
        if (look !== "veil" && look !== "mute" && look !== "show") return json({ ok: false, error: "look is veil, mute or show" });
        orchestrator.videoAdsLook = look; adsLookLoaded = true;
        void drivers.store?.set(ADS_LOOK_KEY, look);
        return json({ ok: true, look });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoSetSuggestions(on) {
      try {
        loadSuggestions();
        const was = orchestrator.videoSuggestions;
        orchestrator.videoSuggestions = on === true; suggestionsLoaded = true;
        if (was !== orchestrator.videoSuggestions) void drivers.store?.set(SUGGESTIONS_KEY, orchestrator.videoSuggestions ? "1" : "0");
        // switched on (or said again with rows still due): the services' home pages are read now, hidden, one at a time
        const asked = orchestrator.videoSuggestions ? orchestrator.videoRefreshSuggestions(hiddenServices()) : [];
        return json({ ok: true, on: orchestrator.videoSuggestions, asked });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    intermissionUnmute(tileId, on) {
      try { return json({ ok: orchestrator.intermissionUnmute(String(tileId ?? ""), on === true) }); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
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
    devHoldPage(appId: string, url: string | null, height?: number) {
      // a music service too (2026-09-29, the account pages read for a sign-in's label): its App, in its profile
      const s = hiddenServices().find((x) => x.app === String(appId)) ?? ((a) => (a ? { app: a.id, name: a.name, adapter: adapterKeyOf(a.id), profile: a.profileId, home: a.baseUrl, status: a.setup.status } : undefined))(playerApps().some((x) => x.app === String(appId)) ? model.app(String(appId)) : undefined);
      if (!s) return "unknown app " + appId; void orchestrator.devHoldPage(s, url, typeof height === "number" ? height : undefined).catch(report); return "asked"; },
    videoHideContinue(appId, itemId) { try { const s = videoServices().services.find((x) => x.app === String(appId ?? "")); if (!s) return json({ ok: false, error: "unknown service" }); orchestrator.videoHideContinue(s.adapter, String(itemId ?? "")); return json({ ok: true }); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    videoRemoveInfo(appId) { try { const s = videoServices().services.find((x) => x.app === String(appId ?? "")); return json(s ? orchestrator.videoRemoveInfo(s.adapter) : { can: false, warning: null }); } catch (e) { report(e); return json({ can: false, warning: null }); } },
    videoListInfo(appId) { try { const s = videoServices().services.find((x) => x.app === String(appId ?? "")); return json(s ? orchestrator.videoListInfo(s.adapter) : { can: false, name: "My List" }); } catch (e) { report(e); return json({ can: false, name: "My List" }); } },
    videoListSet(appId, want, itemId, title, url, kind, catalog) {
      try {
        const s = hiddenServices().find((x) => x.app === String(appId ?? ""));
        if (!s) return json({ status: "failed", error: "unknown service" });
        const t = String(title ?? "");
        const item = { id: String(itemId ?? ""), title: t, kind: String(kind ?? "title"), ...(url ? { url: String(url) } : {}) };
        const resolve = catalog === "1" || (catalog === "auto" && orchestrator.isCatalogCandidate(String(itemId ?? ""))) ? () => orchestrator.videoCatalogResolve(s.app, t, hiddenServices(), String(kind ?? "")) : undefined;
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
    videoLiveGuide(type, q) {
      try {
        const sv = videoServices();
        // a channel named after one show and given no category by its service takes the Live type TMDB's first genre names (2026-10-02,
        // Entertainment mode: "Are We There Yet?" to Comedy, "Below Deck" to Reality); TMDB is asked once a week a name, one at a time

        // a service's live events stand in the grid as rows too (2026-09-30, "Why does your screenshot not show apple in the jump to items"): the
        // series as the channel's type, one on now as what is on, one to come as its schedule - so Apple TV groups and jumps like the others
        const eventRows = (app: string): VideoChannel[] => eventRowsOf(orchestrator, app);
        const services = sv.services.filter((s) => s.status === "signed-in" || s.live.length > 0).map((s) => ({ app: s.app, name: s.name, facet: s.facet, channels: [...s.live.map(withTmdbWord), ...eventRows(s.app)] })).filter((s) => s.channels.length > 0);
        const g = liveGuide(services, Date.now(), { type: type ? String(type) : null, q: q ? String(q) : null });
        const reads = orchestrator.liveReadState();
        const guides = sv.services.filter((s) => !!orchestrator.adapterSpec(s.adapter)?.videoLiveUrl || s.live.length > 0 || orchestrator.liveEvents(s.app).length > 0)
          .map((s) => ({ app: s.app, name: s.name, status: s.status, channels: s.live.length, readAt: reads[s.app]?.readAt ?? null, reading: reads[s.app]?.reading ?? false, canRead: !!orchestrator.adapterSpec(s.adapter)?.videoLiveUrl,
            events: orchestrator.liveEvents(s.app).length, eventsReadAt: orchestrator.eventsReadState()[s.app]?.readAt ?? null, eventsReading: orchestrator.eventsReadState()[s.app]?.reading ?? false }));
        // live events: the ones a service's rows list as live, and the ones its events pages list (Apple TV's Formula 1 and MLS, 2026-09-30) - on now first, then by start
        const now = Date.now();
        const events = sv.services.flatMap((s) => [
          ...liveItemsOf(s.library).map((it) => ({ app: s.app, service: s.name, facet: s.facet, id: it.id, title: it.title, url: it.url ?? null, artwork: it.artwork ?? null, badge: it.badge ?? null, start: null as number | null, end: null as number | null, live: true, group: null as string | null })),
          ...orchestrator.liveEvents(s.app, now).map((it) => ({ app: s.app, service: s.name, facet: s.facet, id: it.id, title: it.title, url: it.url ?? null, artwork: it.artwork ?? null, badge: it.badge ?? null, start: it.start ?? null, end: it.end ?? null, live: !!it.live, group: it.group ?? null, sport: sportOf(it.title, it.group) })),
        ]).sort((a, b) => Number(b.live) - Number(a.live) || (a.start ?? 0) - (b.start ?? 0));
        const eventReads = orchestrator.eventsReadState();
        return json({ ...g, guides, events, eventReads });
      } catch (e) { report(e); return json({ window: null, types: [], rows: [], guides: [], events: [], error: String(e) }); }
    },
    liveScoreWatch(league, id) {
      try {
        const g = orchestrator.scores(false).games.find((x) => x.league === String(league ?? "") && x.id === String(id ?? ""));
        if (!g) return json({ ok: false, error: "no such game" });
        const w = scoreWatch(g);
        if (!w) return json({ ok: false, error: "no service on this wall carries " + g.short });
        if (w.how === "event") return json({ ...videoPlayOn(w.facet, "live", w.id, w.url, w.title), service: w.service });
        return json({ ...videoTune(w.facet, w.id, w.url, w.title), service: w.service });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    liveNowOn(type) {
      try {
        // what is on across a mode's channels, as TMDB knows it (2026-10-02, Entertainment mode: "A Now-on strip ... a row of posters for
        // what's on across the Entertainment channels, each with TMDB's rating and year, press to tune"): the program on now, or the show
        // a loop channel is named after; a card where TMDB matched the name exactly, in the guide's own order - Prism ranks nothing
        const sv = videoServices();
        const services = sv.services.filter((s) => s.status === "signed-in" || s.live.length > 0).map((s) => ({ app: s.app, name: s.name, facet: s.facet, channels: s.live.map(withTmdbWord) }));
        const g = liveGuide(services, Date.now(), { type: type ? String(type) : null, q: null });
        const cards: Array<Record<string, unknown>> = [];
        let asked = 0, none = 0;
        for (const r of g.rows) {
          const on = r.programs.find((p) => p.now);
          const name = on?.title ?? (isShowName(r.name) ? r.name : null);
          if (!name) continue;
          const t = orchestrator.liveTitle(name);
          if (t === undefined) { asked++; continue; }
          if (t === null) { none++; continue; }
          cards.push({ name, kind: t.kind, tmdb: t.id, title: t.title, year: t.year, poster: t.poster, backdrop: t.backdrop, rating: t.rating, overview: t.overview, genres: t.genres, from: on ? "program" : "channel",
            cert: t.cert ?? null, kids: isKidsRating(t.cert),
            // the program's span, for the poster's elapsed part (2026-10-02, "If the show has already started can we show the lapsed time on the poster?")
            // the program's real start; none when only "what is on" is known (review 2026-10-02: the window's edge had read as "just started")
            start: on?.began ?? on?.startsAt ?? (on && on.start > g.window.start ? on.start : null), end: on?.end ?? null,
            channel: { id: r.id, name: r.name, service: r.service, app: r.app, facet: r.facet, url: r.url, logo: r.logo } });
        }
        // one poster a title (2026-10-02, Reality mode: Survivor on two channels): the first channel in the guide's order is the press,
        // the others are named on the card
        const seenTitle = new Map<string, Record<string, unknown>>();
        const merged: Array<Record<string, unknown>> = [];
        for (const c of cards) {
          const k = c.kind + ":" + c.tmdb;
          const first = seenTitle.get(k);
          if (first) { (first.also as Array<Record<string, unknown>>).push(c.channel as Record<string, unknown>); continue; }
          const card = { ...c, also: [] as Array<Record<string, unknown>> };
          seenTitle.set(k, card); merged.push(card);
        }
        return json({ cards: merged, pending: orchestrator.liveTitlesHaveKey() ? Math.max(orchestrator.liveTitlesPending(), asked) : 0, unmatched: none, source: "TMDB", hasKey: orchestrator.liveTitlesHaveKey() });
      } catch (e) { report(e); return json({ cards: [], pending: 0, unmatched: 0, source: "TMDB", hasKey: false, error: String(e) }); }
    },
    // the person's TMDB account and their ratings (tmdb-account.ts, 2026-10-03): the host's calls are synchronous, so each starts the work
    // and answers the state it has; the host asks again a moment later (the pattern titleDetails uses)
    tmdbLinkState() {
      try {
        if (!tmdbUi.state && !tmdbUi.loading) { tmdbUi.loading = true; void orchestrator.tmdbLinkState().then((s) => { tmdbUi.state = s; }).catch(report).finally(() => { tmdbUi.loading = false; }); }
        return json({ ...(tmdbUi.state ?? { linked: false, username: null, linkedAt: null, pending: false, hasKey: false, loading: true }), url: tmdbUi.url, error: tmdbUi.error, busy: tmdbUi.busy });
      } catch (e) { report(e); return json({ linked: false, error: String(e) }); }
    },
    tmdbLinkStart() {
      try {
        tmdbUi.busy = true; tmdbUi.error = null; tmdbUi.url = null;
        void orchestrator.tmdbLinkStart().then((r) => { if ("url" in r) tmdbUi.url = r.url; else tmdbUi.error = r.error; }).catch((e) => { tmdbUi.error = String(e); }).finally(() => { tmdbUi.busy = false; tmdbUi.state = null; });
        return json({ status: "working" });
      } catch (e) { report(e); return json({ status: "failed", error: String(e) }); }
    },
    tmdbLinkFinish() {
      try {
        tmdbUi.busy = true; tmdbUi.error = null;
        void orchestrator.tmdbLinkFinish().then((r) => { if (r.ok) { tmdbUi.url = null; tmdbUi.rated.clear(); } else tmdbUi.error = r.error; }).catch((e) => { tmdbUi.error = String(e); }).finally(() => { tmdbUi.busy = false; tmdbUi.state = null; });
        return json({ status: "working" });
      } catch (e) { report(e); return json({ status: "failed", error: String(e) }); }
    },
    tmdbUnlink() {
      try {
        tmdbUi.busy = true; tmdbUi.error = null; tmdbUi.url = null;
        void orchestrator.tmdbUnlink().catch(report).finally(() => { tmdbUi.busy = false; tmdbUi.state = null; tmdbUi.rated.clear(); });
        return json({ status: "working" });
      } catch (e) { report(e); return json({ status: "failed", error: String(e) }); }
    },
    tmdbRated(kind, id) {
      try {
        const k = (String(kind) === "tv" ? "tv" : "movie") + ":" + Number(id);
        if (tmdbUi.rated.has(k)) return json({ value: tmdbUi.rated.get(k) ?? null, working: false });
        if (!tmdbUi.reading.has(k)) { tmdbUi.reading.add(k); void orchestrator.tmdbRated(String(kind) === "tv" ? "tv" : "movie", Number(id)).then((v) => { tmdbUi.rated.set(k, v); }).catch(report).finally(() => { tmdbUi.reading.delete(k); }); }
        return json({ value: null, working: true });
      } catch (e) { report(e); return json({ value: null, working: false, error: String(e) }); }
    },
    tmdbRate(kind, id, value) {
      try {
        const kk = String(kind) === "tv" ? "tv" : "movie"; const k = kk + ":" + Number(id);
        const v = value === null || value === undefined || (typeof value === "string" && value === "") ? null : Number(value);
        tmdbUi.rated.delete(k); tmdbUi.reading.add(k);
        void orchestrator.tmdbRate(kk, Number(id), v).then((r) => { if (r.ok) tmdbUi.rated.set(k, r.value); else tmdbUi.error = r.error; }).catch((e) => { tmdbUi.error = String(e); }).finally(() => { tmdbUi.reading.delete(k); });
        return json({ status: "working" });
      } catch (e) { report(e); return json({ status: "failed", error: String(e) }); }
    },
    // the TMDB watchlist (2026-10-03): a toggle by TMDB title, its state, and the copy of the services' lists
    watchlistSet(kind, id, on) {
      try {
        const kk = String(kind) === "tv" || String(kind) === "series" ? "tv" : "movie";
        tmdbUi.error = null;
        void orchestrator.watchlistSet(kk, Number(id), on === true || on === "true" || on === "1").then((r) => { if (!r.ok) tmdbUi.error = r.error; }).catch((e) => { tmdbUi.error = String(e); });
        return json({ status: "working" });
      } catch (e) { report(e); return json({ status: "failed", error: String(e) }); }
    },
    watchlistHas(kind, id) {
      try { const kk = String(kind) === "tv" || String(kind) === "series" ? "tv" : "movie"; return json({ on: orchestrator.watchlistHas(kk, Number(id)), linked: orchestrator.watchlistActive(), error: tmdbUi.error }); }
      catch (e) { report(e); return json({ on: null, linked: false }); }
    },
    watchlistView(force) {
      try { const w = orchestrator.videoWatchlist(hiddenServices(), force === true); const menu = w.active ? videoMenu() : null; return json({ ...w, ...(menu ? watchOfferOf(menu.list as Array<{ service?: string; app?: string; item: { title: string; kind?: string } }>, w) : { offer: 0, offerTitles: [] }), importing: orchestrator.watchlistImportState(), error: tmdbUi.error }); }
      catch (e) { report(e); return json({ active: false, reading: false, cards: [], count: 0, offer: 0 }); }
    },
    watchlistHasTitle(title, kind) {
      try { return json({ ...orchestrator.watchlistHasTitle(String(title ?? ""), kind ? String(kind) : null), error: tmdbUi.error }); }
      catch (e) { report(e); return json({ on: null, work: null }); }
    },
    watchlistSetTitle(title, kind, on) {
      try {
        tmdbUi.error = null;
        void orchestrator.watchlistSetTitle(String(title ?? ""), kind ? String(kind) : null, on === true || on === "true" || on === "1").then((r) => { if (!r.ok) tmdbUi.error = r.error; }).catch((e) => { tmdbUi.error = String(e); });
        return json({ status: "working" });
      } catch (e) { report(e); return json({ status: "failed", error: String(e) }); }
    },
    // one private list made, a long comment written and read back, the list deleted (2026-10-03, asked for: "Yes"): how much a comment keeps
    watchlistImport() {
      try {
        const sv = videoServices();
        const menu = videoMenu();
        const seen = new Set<string>();
        const items: Array<{ title: string; kind: string; providers: number[] }> = [];
        for (const c of (menu.list ?? []) as Array<{ app: string; item: { title: string; kind?: string } }>) {
          const k = normalizeTrackText(c.item.title) + "|" + (c.item.kind ?? "");
          if (seen.has(k)) continue; seen.add(k);
          const s = sv.services.find((x) => x.app === c.app);
          items.push({ title: c.item.title, kind: c.item.kind ?? "title", providers: s ? orchestrator.providersOfAdapter(s.adapter) : [] });
        }
        return json({ started: orchestrator.watchlistImportStart(items), total: items.length });
      } catch (e) { report(e); return json({ started: false, error: String(e) }); }
    },
    liveNews(force, mode) {
      try {
        // Local mode's front page is the stations' (2026-10-02): a station's feed shows there and not in News mode
        const wantLocal = String(mode ?? "") === "Local";
        // what a live news show reported (2026-10-01): the adapters' feed pairings against the guide's news rows and what is on them now
        const sv = videoServices();
        const services = sv.services.filter((s) => s.status === "signed-in" || s.live.length > 0).map((s) => ({ app: s.app, name: s.name, facet: s.facet, channels: s.live }));
        const g = liveGuide(services, Date.now(), { type: null, q: null });
        const rows: NewsGuideRow[] = g.rows.map((r) => ({ id: r.id, name: r.name, service: r.service, app: r.app, facet: r.facet, url: r.url ?? null, now: r.programs.find((p) => p.now)?.title ?? null }));
        const specs: NewsFeedSpec[] = sv.services.flatMap((s) => orchestrator.adapterSpec(s.adapter)?.newsFeeds ?? []).filter((f) => !!f.local === wantLocal);
        // several feeds paired with one channel under one name (NBC News' sections, each with the stream's segments) make one group
        const byGroup = new Map<string, { name: string; show: string | null; feeds: string[]; readAt: number | null; reading: boolean; error: string | null; stories: ReturnType<typeof storiesOf>; leftOut: Record<string, number>; channel: Record<string, string | null> }>();
        for (const p of pairFeeds(specs, rows)) {
          const f = orchestrator.newsFeed(p.spec.feed, force === true);
          const key = p.row.id + "|" + p.name;
          const g0 = byGroup.get(key) ?? { name: p.name, show: p.spec.show ?? null, feeds: [], readAt: null, reading: false, error: null, stories: [], leftOut: {},
            channel: { id: p.row.id, name: p.row.name, service: p.row.service, app: p.row.app, facet: p.row.facet, url: p.row.url ?? null, now: p.row.now ?? null } };
          g0.feeds.push(p.spec.feed);
          g0.readAt = g0.readAt === null ? f.readAt : f.readAt === null ? g0.readAt : Math.max(g0.readAt, f.readAt);
          g0.reading = g0.reading || f.reading;
          g0.error = g0.error ?? f.error;
          for (const it of f.items) { const why = leftOutWhy(it, p.spec); if (why) g0.leftOut[why] = (g0.leftOut[why] ?? 0) + 1; }
          const seen = new Set(g0.stories.map((x) => x.link));
          g0.stories = storiesOf([...g0.stories, ...storiesOf(f.items, p.spec, 50).filter((x) => !seen.has(x.link))], {}, 24);
          byGroup.set(key, g0);
        }
        const groups = [...byGroup.values()].map((g0) => ({ ...g0, feed: g0.feeds.join(" "), stories: g0.stories.slice(0, 12) }));
        return json({ groups, rules: ["the networks' opinion sections are never paired", "a full episode is the show, not a story", "a shopping segment is not news"] });
      } catch (e) { report(e); return json({ groups: [], rules: [], error: String(e) }); }
    },
    liveScores(force) {
      try {
        const s = orchestrator.scores(force === true);
        // the last day's games (2026-10-01): a line a game with the day's word when it was not today's
        const now = Date.now();
        const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        const games = gamesOfLastDay(s.games, now).map((g) => ({ ...g, watch: scoreWatch(g), line: scoreLine(g, clock), day: new Date(g.start).toDateString() === new Date(now).toDateString() ? "today" : new Date(g.start).toDateString() === new Date(now - 24 * 3_600_000).toDateString() ? "yesterday" : new Date(g.start).toLocaleDateString(undefined, { weekday: "short" }) }));
        return json({ source: s.source, readAt: s.readAt, reading: s.reading, games, errors: s.errors });
      } catch (e) { report(e); return json({ source: SCORE_SOURCE, readAt: null, reading: false, games: [], errors: { all: String(e) } }); }
    },
    videoLiveRead(force) {
      try { orchestrator.notePersonAbout(); const hs = hiddenServices(); if (force === true) orchestrator.scoresDayRead(true); return json({ ok: true, asked: [...orchestrator.videoLiveRead(hs, force === true), ...orchestrator.videoEventsRead(hs, force === true)] }); }
      catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    titleAlsoOnPlan(appsJson) {
      // the decision is core's (2026-09-28, "standardize the ruleset outside of the adapters"): the host had named Hulu and Disney+ itself - for a
      // title that plays on these apps, each service that also carries one of them and is not among them already is worth asking
      try {
        let list: unknown = [];
        try { list = JSON.parse(String(appsJson ?? "[]")); } catch { return "[]"; }   // nothing to plan for
        const apps = new Set((Array.isArray(list) ? list : []).map((a) => String(a)));
        const named = (app: string) => videoServices().services.find((x) => x.app === app)?.name ?? app;
        return json(Object.entries(ALSO_VIA).filter(([via, app]) => apps.has(via) && !apps.has(app)).map(([via, app]) => ({ via, viaName: named(via), app, name: named(app) })));
      } catch (e) { report(e); return "[]"; }
    },
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
        // the wall's cover over the service's pages while it moves to the episode (2026-10-06, "I pressed back episode 3x to go to episode 6, and it
        // showed the pages while I was navigating"): the same word a pick from the phone sends, so the stage bar's press and the phone's both get it
        const cover = () => coverScreen(tile, `${v.series}, S${season} E${episode}`);
        if (ep?.id && ep.url) {
          const p = videoPlayOn(sv.screen.facet, "title", ep.id, ep.url, ep.title || `S${season} E${episode}`);
          if (p.ok) { cover(); return json({ ok: true, did: "previous", season, episode }); }
        }
        const r = orchestrator.videoPlayEpisodeNumber(tile, season, episode);
        if (r === "ok") { cover(); return json({ ok: true, did: "previous", season, episode }); }
        return start();
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoProgramEdges(tileId) { try { return json(orchestrator.videoProgramEdges(String(tileId))); } catch (e) { report(e); return "null"; } },
    adBreakHold(tileId, remainingSec) { try { return json(orchestrator.adBreakHold(String(tileId), Number(remainingSec))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); } },
    videoPictureFrozen(tileId, seconds) {
      try { return json(orchestrator.videoPictureFrozen(String(tileId), Number(seconds))); } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
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
        const d = JSON.parse(String(draftJson ?? "{}")) as { picks?: Record<string, string>; off?: string[]; preset?: string | null; name?: string | null; signIns?: Record<string, string> };
        const asked = Object.fromEntries(Object.entries(d.signIns ?? {}).filter(([, id]) => typeof id === "string" && !!id));
        const movedTo = moveToSignIns(asked);
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
          const preset: ProfilePreset = { id: target?.id ?? fresh, name: newName || target!.name, picks: presetPicks, off: [...off], signIns: signInsInUse() };
          st.presets = target ? st.presets.map((p) => (p.id === target!.id ? preset : p)) : [...st.presets, preset];
          target = preset;
        }
        st.active = target?.id ?? null;
        presetsWrite(st);
        return json({ ok: true, switched, moved: movedTo.moved, preset: target ? { id: target.id, name: target.name } : null });
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
        const inUse = signInsInUse();
        if (!Object.keys(picks).length && !presetsNow().off.length && !Object.keys(inUse).length) return json({ ok: false, error: "no service has a profile chosen yet" });
        const st = presetsNow();
        const same = st.presets.find((p) => p.name.toLowerCase() === n.toLowerCase());
        let fresh = "p" + Date.now().toString(36);
        for (let i = 2; st.presets.some((p) => p.id === fresh); i++) fresh = "p" + Date.now().toString(36) + "-" + i;   // two saves in one millisecond
        const preset: ProfilePreset = { id: same?.id ?? fresh, name: n, picks, off: [...st.off], signIns: inUse };
        st.presets = same ? st.presets.map((p) => (p.id === same.id ? preset : p)) : [...st.presets, preset];
        st.active = preset.id;
        presetsWrite(st);
        return json({ ok: true, preset });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    signInsView(catalogJson) {
      try { if (catalogJson) learnAccounts(JSON.parse(catalogJson) as SetupEntry[]); return json(signInsView()); } catch (e) { report(e); return json({ services: [] }); }
    },
    signInAdd(appId, name) {
      try {
        const app = model.app(String(appId ?? ""));
        if (!app) return json({ ok: false, error: "unknown service" });
        const key = accountOfApp(app.id);
        const st = withProfile(signInsSettled(), key, app.profileId, app.name);
        const taken = new Set(model.snapshot().apps.map((a) => a.profileId));
        const r = addSignIn(st, key, String(name ?? ""), taken);
        if ("error" in r) return json({ ok: false, error: r.error });
        // the way back: before the first other person is added, the wall as it stands is kept as a set of its own ("Household"), so
        // there is one to switch back to
        if (r.made) {
          const ps = presetsNow();
          if (!ps.presets.length) {
            const picks: Record<string, { id: string; name: string }> = {};
            for (const s of profilesView().services) if (s.current) picks[s.app] = s.current;
            const first: ProfilePreset = { id: "p" + Date.now().toString(36), name: FIRST_SIGN_IN_NAME, picks, off: [...ps.off], signIns: signInsInUse() };
            presetsWrite({ ...ps, presets: [first], active: first.id });
          }
        }
        signInsWrite(r.state);
        return json({ ok: true, made: r.made, signIn: { id: r.signIn.id, name: r.signIn.name } });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    signInUse(appId, signInId) {
      try {
        const r = moveToSignIn(String(appId ?? ""), String(signInId ?? ""));
        if (r.ok && r.changed) {
          const st = presetsNow(); if (st.active) { st.active = null; presetsWrite(st); }   // a hand-picked sign-in: no set is the one on now
          const active = model.activeScene(); if (active) applyScene(active);
        }
        return json(r);
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    signInsLabel() {
      try { return json({ ok: true, asked: labelSignIns() }); } catch (e) { report(e); return json({ ok: false, asked: [] }); }
    },
    signInHide(appId, signInId) {
      try {
        const app = model.app(String(appId ?? ""));
        if (!app) return json({ ok: false, error: "unknown service" });
        const key = accountOfApp(app.id);
        const inUse = new Set(model.snapshot().apps.filter((a) => accountOfApp(a.id) === key).map((a) => a.profileId));
        const r = hideSignIn(signInsSettled(), key, String(signInId ?? ""), inUse);
        if ("error" in r) return json({ ok: false, error: r.error });
        signInsWrite(r);
        return json({ ok: true });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    signInShow(appId, signInId) {
      try {
        const app = model.app(String(appId ?? ""));
        if (!app) return json({ ok: false, error: "unknown service" });
        const r = showSignIn(signInsSettled(), accountOfApp(app.id), String(signInId ?? ""));
        if ("error" in r) return json({ ok: false, error: r.error });
        signInsWrite(r);
        return json({ ok: true });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    signInRename(appId, signInId, name) {
      try {
        const before = signInsSettled();
        const key = accountOfApp(String(appId ?? ""));
        const was = signInById(before, key, String(signInId ?? ""))?.name ?? "";
        const r = renameSignIn(before, key, String(signInId ?? ""), String(name ?? ""));
        if ("error" in r) return json({ ok: false, error: r.error });
        // the name is a person's: every other account's sign-in that carried it takes the new one too ("Household" renamed is renamed
        // on every service), where that account has no sign-in of the new name already
        let st = r, also = 0;
        for (const [k, list] of Object.entries(before.accounts)) {
          if (k === key) continue;
          for (const s of list) {
            if (s.name.toLowerCase() !== was.toLowerCase()) continue;
            const n = renameSignIn(st, k, s.id, String(name ?? ""));
            if (!("error" in n)) { st = n; also++; }
          }
        }
        signInsWrite(st);
        return json({ ok: true, also });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    videoPresetRename(presetId, name) {
      try {
        const n = String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        if (!n) return json({ ok: false, error: "a preset needs a name" });
        const st = presetsNow();
        if (!st.presets.some((p) => p.id === presetId)) return json({ ok: false, error: "unknown preset" });
        if (st.presets.some((p) => p.id !== presetId && p.name.toLowerCase() === n.toLowerCase())) return json({ ok: false, error: "another preset has that name" });
        st.presets = st.presets.map((p) => (p.id === presetId ? { ...p, name: n } : p));
        presetsWrite(st);
        return json({ ok: true });
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
        // the person's sign-ins first, music and video alike: a login's profiles are its own, so the profiles are pressed after
        const movedTo = moveToSignIns(p.signIns ?? {});
        const svcs = hiddenServices();
        const off = p.off ?? [];
        const picks = Object.fromEntries(Object.entries(p.picks).filter(([app]) => !off.includes(app)).map(([app, c]) => [app, c.id]));   // an excluded service is left as it is
        const switched = orchestrator.videoSwitchProfiles(svcs, picks);
        const missing = Object.keys(picks).filter((a) => !switched.includes(a));
        st.active = p.id;
        st.off = [...off];
        presetsWrite(st);
        return json({ ok: true, switched, missing, moved: movedTo.moved });
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
      return json(musicSourcesNow());
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
    musicPlayingIn(tileId) { try { return json(orchestrator.musicPlayingIn(String(tileId))); } catch (e) { report(e); return "null"; } },
    musicRemovePlaying(tileId, playlistId, dry) {
      try {
        const tile = String(tileId);
        const appId = model.facet(tile)?.app ?? null;
        const a = appId ? model.app(appId) : undefined;
        if (!a) return json({ ok: false, error: "no service for " + tile });
        const s = { app: a.id, adapter: adapterKeyOf(a.id), profile: a.profileId };
        orchestrator.notePersonAbout();
        orchestrator.musicRemovePlaying(s, tile, String(playlistId), dry === true).then((r) => { if (r === "unknown" || r === "unknown-tile") report(new Error("musicRemovePlaying " + tile + ": " + r)); }, report);
        return json({ ok: true, asked: true });
      } catch (e) { report(e); return json({ ok: false, error: String(e) }); }
    },
    musicRemoveState(tileId) { try { return json(orchestrator.musicRemoveState(String(tileId))); } catch (e) { report(e); return "null"; } },
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
    modelSignInPage: (login, signIn) => PrismModelEval.signInPage(login, signIn ?? null),
    modelSignInPressJs: (signedOut) => PrismModelEval.signInPressJs(signedOut),
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
  // the phone's Video tab (2026-10-04, "a full watch (with no video) page for video"): the Watch screen's two rows and the live channels,
  // the big window's state with its art, and the plays the PC's own bar makes - never a picture (the services' video is DRM, and
  // Prism does not touch it: docs/third-party-services-policy.md)
  remote.video = {
    view: () => {
      const sv = videoServices();
      const order = model.snapshot().apps.map((a) => a.id);
      const names = [...sv.services].sort((a, b) => order.indexOf(a.app) - order.indexOf(b.app)).map((s) => ({ app: s.app, name: s.name, facet: s.facet, adapter: s.adapter }));
      const rows = orchestrator.videoMenuRows(names);
      const off = excludedNow();
      const card = (c: { app: string; service: string; facet: string; item: VideoItem }) => ({
        app: c.app, service: c.service, facet: c.facet,
        item: { id: c.item.id, title: c.item.title, subtitle: c.item.subtitle ?? null, kind: c.item.kind, url: c.item.url ?? null, artwork: c.item.artwork ?? null, progress: c.item.progress ?? null },
      });
      const trim = (cs: Array<{ app: string; service: string; facet: string; item: VideoItem }>) => cs.filter((c) => !off.has(c.app)).slice(0, 40).map(card);
      const tile = sv.screen?.slot ?? null;
      const st = tile ? orchestrator.videoState().find((x) => x.id === tile) ?? null : null;
      const art = tile ? orchestrator.videoArtOf(tile) : null;
      const now = st ? { tile, playing: st.playing, video: st.video, skip: st.skip ?? null, error: st.error, can: st.can, pending: st.pending, art: art?.art ?? null, artTitle: art?.title ?? null } : null;
      return {
        active: sv.active, screen: sv.screen, now,
        continue: trim(rows.continue), list: trim(rows.list),
        // each channel's program on now with its span (2026-10-05, "a data bar in each live channel in the companion app showing how much runtime and
        // how close to complete each current show is"): start and end from the guide's schedule; a service that names only what is on gives the end alone
        // a service's live events stand among its rows here as on the PC's tab (2026-10-05, "Isn't Live supposed to show the Formula 1 stuff
        // from Apple?": the phone's list came from the channel guides alone, and Apple TV has events and no channels, so it was never listed)
        live: sv.services.filter((s) => (s.live.length > 0 || orchestrator.liveEvents(s.app).length > 0) && !off.has(s.app)).map((s) => ({ app: s.app, name: s.name, facet: s.facet, channels: [...s.live, ...eventRowsOf(orchestrator, s.app)].slice(0, 160).map((c) => {
          const on = programOnNow(c, Date.now());
          return { id: c.id, name: c.name, url: c.url, now: on?.title ?? c.now ?? null, logo: c.logo ?? null, event: !!c.event, series: c.series ?? null, start: on?.start ?? null, end: on?.end ?? null };
        }) })),
        // the guides being read right now, so the phone can say so instead of "none" (2026-10-05)
        liveReading: Object.values(orchestrator.liveReadState()).some((r) => r.reading),
        liveCanRead: sv.services.some((s) => !!orchestrator.adapterSpec(s.adapter)?.videoLiveUrl),
        services: sv.services.map((s) => ({ app: s.app, name: s.name, facet: s.facet, status: s.status, onScreen: s.onScreen })),
      };
    },
    play: (facet, kind, id, url, name) => {
      orchestrator.notePersonAbout();
      const r = videoPlayOn(facet, kind, id, url, name);
      // the PC's Watch screen stood over the playing video (2026-10-05, "No video playing on the PC"): the same close-and-curtain its own press does
      if (r.ok) { const sv = videoServices().services.find((x) => x.facet === facet); void drivers.ui?.videoPick?.(name ?? id, sv?.name ?? facet, null); }
      return r;
    },
    tune: (facet, channel, url, name) => {
      orchestrator.notePersonAbout();
      const r = videoTune(facet, channel, url, name);
      if (r.ok) { const sv = videoServices().services.find((x) => x.facet === facet); void drivers.ui?.videoPick?.(name ?? channel, sv?.name ?? facet, null); }
      return r;
    },
    seek: (tile, seconds) => orchestrator.videoSeek(tile, seconds),
    // the service's own subtitle and audio tracks for the phone's Captions sheet (2026-10-05, "The caption button should open the menu of
    // options and allow selection"): read from the page as the PC's menu reads them, a pick through core, and the sheet closed
    tracks: (tile) => orchestrator.videoTracks(tile),
    track: (tile, kind, id) => orchestrator.videoTrack(tile, kind === "audio" ? "audio" : "subtitles", id),
    tracksDone: (tile) => orchestrator.videoTracksDone(tile),
    startOver: () => { try { return JSON.parse(api.videoStartOver()) as unknown; } catch (e) { report(e); return { ok: false, error: String(e) }; } },
    // more of the Watch screen (2026-10-05): every play below is the Watch screen's own path, with the curtain signal the PC's own press gives
    search: (q) => { orchestrator.notePersonAbout(); return videoLookup(q); },
    searchState: () => videoLookupNow(),
    playResult: (app, candidate) => {
      orchestrator.notePersonAbout();
      const c = candidate as { title?: string };
      const r = videoPlayResult(app, JSON.stringify(candidate));
      if (r.ok) { const sv = videoServices().services.find((x) => x.app === app); void drivers.ui?.videoPick?.(c.title ?? "the title", sv?.name ?? app, null); }
      return r;
    },
    episodes: () => { try { return JSON.parse(api.videoEpisodes()) as unknown; } catch (e) { report(e); return { ready: true, seasons: [], error: String(e) }; } },
    playEpisode: (id) => {
      orchestrator.notePersonAbout();
      try {
        const sv = videoServices();
        const ep = sv.screen ? orchestrator.videoEpisodeById(sv.screen.slot, sv.screen.app, id) : null;
        const r = JSON.parse(api.videoPlayEpisode(id)) as { ok?: boolean };
        if (r.ok && sv.screen) { const s = sv.services.find((x) => x.facet === sv.screen!.facet); void drivers.ui?.videoPick?.(ep?.title ?? "the episode", s?.name ?? sv.screen.app, null); }
        return r;
      } catch (e) { report(e); return { ok: false, error: String(e) }; }
    },
    lenses: () => {
      const m = videoMenu() as { lensRows?: Array<Record<string, unknown>> };
      const rows = (m.lensRows ?? []).map((lr) => {
        const catalog = lr.catalog === true;
        const cards = ((lr.cards as Array<Record<string, unknown>>) ?? []).slice(0, 30).map((c) => {
          if (catalog) {
            const svcs = (c.services as Array<{ app: string; name: string; facet: string; offer: string }>) ?? [];
            return { catalog: true, id: c.id, title: c.title, kind: c.kind, year: c.year ?? null, artwork: c.poster ?? c.backdrop ?? null, value: c.value ?? null, rating: c.rating ?? null, services: svcs.map((s) => ({ app: s.app, name: s.name, offer: s.offer })) };
          }
          const it = c.item as VideoItem;
          return { catalog: false, app: c.app, service: c.service, facet: c.facet, lens: (c.lens as { label?: string } | null)?.label ?? null, rating: c.rating ?? null, item: { id: it.id, title: it.title, subtitle: it.subtitle ?? null, kind: it.kind, url: it.url ?? null, artwork: it.artwork ?? null, progress: it.progress ?? null } };
        });
        return { id: lr.id, name: lr.name, counted: lr.counted, who: lr.who ?? null, source: lr.source, dataDate: lr.dataDate ?? null, reading: lr.reading ?? 0, cards };
      }).filter((r) => r.cards.length || r.reading);
      return { rows };
    },
    browsePlay: (app, cardId) => {
      orchestrator.notePersonAbout();
      const card = orchestrator.videoBrowseCard(cardId, app);
      const r = videoBrowsePlay(app, cardId);
      if (r.ok) { const sv = videoServices().services.find((x) => x.app === app); void drivers.ui?.videoPick?.(card?.title ?? "the title", sv?.name ?? app, card?.poster ?? null); }
      return r;
    },
    liveRead: () => { try { return JSON.parse(api.videoLiveRead(false)) as unknown; } catch (e) { report(e); return { ok: false, error: String(e) }; } },
    // the windows a phone can listen to (2026-10-05): multiview's, big first, each with what it plays and which one the phone hears now
    listenWindows: (listener?: string) => {
      const st = mvState();
      const wins = (st.windows as Array<Record<string, unknown>> | undefined) ?? [];
      const listening = listener ? orchestrator.listenWindowOf(listener) : orchestrator.listenWindow;   // this phone's own choice
      const owner = orchestrator.getState()?.audioOwner ?? null;
      return { on: !!st.on, listening, windows: wins.map((w, i) => ({ tile: w.tile, index: i, label: i === 0 ? "Big window" : "Window " + (i + 1), name: w.name, title: w.title, playing: w.playing, heard: (listening ?? wins[0]?.tile) === w.tile, owner: owner === w.tile })) };
    },
    listenWindow: async (tile: string | null, listener?: string) => { const r = await orchestrator.setListenWindow(tile, listener); return { ok: r === "ok", result: r, listening: listener ? orchestrator.listenWindowOf(listener) : orchestrator.listenWindow }; },
    privateMute: (on: boolean) => { void drivers.ui?.privateMute?.(on); return { ok: !!drivers.ui?.privateMute, on }; },
    breakWatch: (on: boolean) => { void drivers.ui?.breakWatch?.(on); return { ok: !!drivers.ui?.breakWatch, on }; },
  };
  return api;
}

// When bundled for a shell (IIFE), install the runtime globally on load.
// Guarded so importing this module from tests/Node does not require a bridge.
if (typeof globalThis.PrismBridge !== "undefined") {
  globalThis.PrismRuntime = createRuntime();
}

/**
 * A service's live events as rows of its guide (2026-09-30, "Why does your screenshot not show apple in the jump to items"): type Sports,
 * the series (Formula 1, MLS) a label of its own (2026-10-01, "Would rather these fall under sports"), one on now as what is on, one to
 * come as its schedule. The PC's Live tab and the phone's Live section take the same rows (2026-10-05).
 */
function eventRowsOf(orchestrator: Orchestrator, app: string): VideoChannel[] {
  return orchestrator.liveEvents(app).map((e) => ({
    id: e.id, name: e.title, url: e.url ?? "", logo: e.artwork ?? null, favorite: false, category: "Sports", event: true, ...(e.group ? { series: e.group } : {}),
    now: e.live ? (e.badge && /^live/i.test(e.badge) ? e.title + (e.badge.length > 4 ? " (" + e.badge.slice(4).trim() + ")" : "") : e.title) : null,
    ...(e.live ? { nowEnds: e.end ?? (e.start ? e.start + 3 * 3_600_000 : Date.now() + 2 * 3_600_000) } : {}),
    ...(e.start ? { schedule: [{ title: e.title, start: e.start, end: e.end ?? e.start + 3 * 3_600_000, desc: null }] } : {}),
  }));
}
