/**
 * Windows host channel schema (win-host-spec §2) — THE single source of truth
 * for the JSON messages crossing the brain boundary:
 *
 *   core → host  (WebMessageReceived on the brain WebView2): seam COMMANDS —
 *                exactly the ops `createBridgeDrivers()` emits (runtime.ts),
 *                plus the request/response lane and runtime notices.
 *   host → core  (PostWebMessageAsJson into the brain): EVENTS — surface
 *                events (drivers.ts SurfaceEvent), input, resize, and calls
 *                into the PrismRuntime API, wrapped as {fn, args}.
 *
 * The C# side NEVER hand-writes these shapes: `npm run gen:win-channel`
 * (scripts/generate-win-channel.mjs) turns COMMAND_SCHEMA / HOST_CALLS below
 * into targets/win-host/PrismHost/Channel/Channel.g.cs. The generator and the
 * schema test (tests/win-channel.test.ts) both read this module, so a command
 * added to runtime.ts without a schema row fails CI — the host cannot grow
 * its own behavior or drift (§23).
 *
 * Field type vocabulary (keep it JSON-primitive so C# stays honest):
 *   "string" | "string?" | "number" | "boolean" | "json" (opaque object,
 *   forwarded verbatim) | "rect" ({x,y,w,h} numbers).
 */

export type ChannelFieldType =
  | "string"
  | "string?"
  | "number"
  | "boolean"
  | "json"
  | "rect";

export interface ChannelOp {
  /** Wire name, e.g. "surface.navigate". */
  op: string;
  /** Payload fields beside `op` (and `requestId` when request is true). */
  fields: Record<string, ChannelFieldType>;
  /** Request/response lane: host must answer via PrismRuntime.resolve. */
  request?: boolean;
  /** M1 scope: the host implements it now; the rest are generated stubs. */
  m1?: boolean;
}

/** core → host seam commands (must cover every `send(...)` in runtime.ts). */
export const COMMAND_SCHEMA: ChannelOp[] = [
  // -------------------------------------------------------------- surface
  // `kind` (scene model): "slot" | "floating" | "hidden" | "preview" - which engine attach the host runs (win-host-spec §5:
  // hidden = off-canvas audio surface, audio intermission instead of scenery; preview = an App setup / facet-preview
  // surface outside the wall, full-window, destroyed on close - B-41). Absent = slot.
  { op: "surface.create", m1: true, fields: { id: "string", profile: "string", background: "string", viewport: "string?", uaPlatform: "string?", zoom: "number", launch: "string?", blocking: "boolean", placeholder: "boolean", label: "string?", kind: "string?" } },
  { op: "surface.destroy", m1: true, fields: { id: "string" } },
  // one browser, many sign-ins (sign-ins.ts, 2026-10-03): the legacy profile folders' sessions copied onto the shared ones before any surface
  // is made - moves = [{from, to, origins:[...]}]; the host answers with a "profile-migrated" event and keeps every old folder (section 10)
  { op: "profile.migrate", m1: true, fields: { moves: "json" } },
  { op: "surface.setRect", m1: true, fields: { id: "string", rect: "rect" } },
  { op: "surface.setOpacity", m1: true, fields: { id: "string", opacity: "number" } },
  { op: "surface.setZ", m1: true, fields: { id: "string", z: "number" } },
  { op: "surface.setVisible", fields: { id: "string", visible: "boolean" } },
  { op: "surface.goBack", request: true, fields: { id: "string" } },
  { op: "surface.navigate", m1: true, fields: { id: "string", url: "string" } },
  { op: "surface.inject", m1: true, fields: { id: "string", css: "string?", js: "string?" } },
  { op: "surface.freeze", m1: true, fields: { id: "string" } },
  { op: "surface.reveal", m1: true, fields: { id: "string", durationMs: "number" } },
  { op: "surface.suspend", m1: true, fields: { id: "string" } },
  { op: "surface.resume", m1: true, fields: { id: "string" } },
  // §25 living previews: this revival is a peek (muted, transient, one at a time). Core brackets every peek
  // with peeking=true … peeking=false so the host can hold §16 across it: the still stays up until readiness,
  // and a freeze arriving from the PEEK_TIMEOUT_MS abort keeps the last still instead of capturing a blank.
  { op: "surface.setPeek", m1: true, fields: { id: "string", peeking: "boolean" } },
  { op: "surface.showIntermission", m1: true, fields: { id: "string", source: "string", look: "string?" } },
  { op: "surface.hideIntermission", m1: true, fields: { id: "string" } },
  { op: "surface.setIntermissionSkip", m1: true, fields: { id: "string", available: "boolean", target: "string?" } },
  { op: "surface.setAdInfo", m1: true, fields: { id: "string", count: "string", remaining: "number" } },
  { op: "surface.setMuted", m1: true, fields: { id: "string", muted: "boolean" } },
  { op: "surface.setViewport", m1: true, fields: { id: "string", w: "number", h: "number" } },
  { op: "surface.setNowPlaying", m1: true, fields: { id: "string", json: "string" } },
  { op: "surface.setChrome", m1: true, fields: { id: "string", kind: "string", face: "string", hidden: "boolean" } },
  { op: "surface.setFocused", fields: { id: "string", focused: "boolean" } },
  { op: "surface.setPageInput", fields: { id: "string", active: "boolean" } },
  { op: "surface.sendKey", m1: true, fields: { id: "string", key: "string" } },   // the phone keyboard (2026-10-03): Enter, Backspace, the D-pad
  // a trusted pointer MOVE over a hidden service page (2026-09-22): some controls draw only for a real hover (Hulu's Continue Watching X).
  // Asked by core alone, only for a job a person confirmed, only on the wall's own hidden lookup surfaces - never a press, never the screen
  { op: "surface.hover", fields: { id: "string", x: "number", y: "number" }, m1: true },
  // a trusted pointer PRESS on a service's own scrubber (2026-09-23, "we need to try harder to make that slider move faster behind the scenes"):
  // Peacock's player follows only its own scrubber, which takes no scripted press. Asked by core alone, only for the person's own drag of
  // Prism's slider, at the point the adapter's videoSeekPoint names - never anything else
  // press false: the move alone - the scrubber's own preview thumbnail, drawn only under a real pointer (the slider's preview while dragging)
  { op: "surface.scrub", fields: { id: "string", x: "number", y: "number", press: "boolean" }, m1: true },
  { op: "surface.typeText", m1: true, fields: { id: "string", text: "string" } },   // the phone keyboard (2026-10-03): text into the focused field
  // a small read of a page, answered (2026-09-23: the playback doctor asks for a stalled player's own error words; the phone's sign-in helper
  // reads the fields on screen) - declared without m1 until now, so every ask was answered "unsupported" by the host's stub
  { op: "surface.evaluate", request: true, m1: true, fields: { id: "string", js: "string" } },
  { op: "surface.veilImagery", request: true, m1: true, fields: { source: "string" } },
  { op: "surface.captureAudio", fields: { enable: "boolean" } },
  // §32 visualization surface: host-rendered, audio-reactive (WASAPI FFT stays inside the host), fed by
  // core's music state. Placed with setRect/setZ/setOpacity, removed with surface.destroy like any surface.
  { op: "surface.createVisualization", m1: true, fields: { id: "string", style: "string", source: "string", artwork: "string", spill: "boolean" } },
  { op: "surface.setVisualizationFeed", m1: true, fields: { id: "string", json: "string" } },
  // §32 reveal/collapse of a hidden facet through §16: "hidden" = zero-size (audio uninterrupted, never destroyed),
  // "panel" = a transient floating panel at rect, "hero" = hero-sized overlay at rect; the host crossfades.
  { op: "surface.setPresence", m1: true, fields: { id: "string", presence: "string", rect: "rect", durationMs: "number" } },
  // §6a deep links from the phone / context sheet: the host's UI router opens a prism:// route (route strings are data).
  { op: "ui.route", m1: true, fields: { route: "string", source: "string", id: "string?" } },
  // concept-scenes §5: what one tap resolved to. The host calls `tapItem` (fire-and-forget, the promote half is
  // async) and core answers here — from an on-wall tap and from the §6 remote alike, so both report one verdict.
  { op: "ui.tapResult", m1: true, fields: { id: "string", action: "string", did: "string", audio: "string?", error: "string?" } },
  // a video pick from the phone (2026-10-05): the host closes its Watch screen and raises its curtain, as its own card press does
  { op: "ui.videoPick", m1: true, fields: { title: "string", service: "string", poster: "string?" } },
  { op: "ui.privateMute", m1: true, fields: { on: "boolean" } },
  { op: "ui.listenRoutes", m1: true, fields: { json: "string" } },
  { op: "ui.breakWatch", m1: true, fields: { on: "boolean" } },   // the phone's switch for covering YouTube TV's channel breaks (2026-10-07)   // each phone's window (2026-10-06): {routes: {listener: tile}, hero}
  // -------------------------------------------------------------- display
  { op: "display.setBrightness", fields: { value: "number" } },
  { op: "display.setPower", fields: { state: "string" } },
  // ---------------------------------------------------------------- media
  { op: "media.launch", fields: { package: "string", deepLink: "string?" } },
  { op: "media.setSpeakers", fields: { mode: "string" } },
  { op: "media.listApps", request: true, fields: {} },
  { op: "media.appSkip", request: true, fields: { package: "string", target: "string" } },
  { op: "media.appType", request: true, fields: { package: "string", text: "string" } },
  { op: "media.appBack", request: true, fields: { package: "string" } },
  { op: "media.serveAudio", fields: { transport: "string", enable: "boolean" } },
  { op: "media.webrtcOffer", request: true, fields: { listener: "string", offerSdp: "string" } },
  { op: "media.webrtcIce", fields: { listener: "string", candidate: "string" } },
  { op: "media.webrtcClose", fields: { listener: "string" } },
  // ---------------------------------------------------------------- input
  { op: "input.startPairing", fields: {} },
  { op: "input.listRemotes", request: true, fields: {} },
  // --------------------------------------------------------------- update
  // the Windows host serves both since 2026-10-05 (Services/Updates.cs): the signed manifest, the verified install into the data folder
  { op: "update.fetchManifest", m1: true, request: true, fields: { url: "string" } },
  { op: "update.apply", m1: true, request: true, fields: { release: "json" } },
  // ---------------------------------------------------------------- store
  { op: "store.set", m1: true, fields: { key: "string", value: "string" } },
  // ---------------------------------------------------------------- misc
  { op: "alarm.setTone", fields: { playing: "boolean" } },
  { op: "net.submitCompatReport", fields: { report: "string" } },
  { op: "net.applyBlockHosts", fields: { sourceId: "string", name: "string", hosts: "json" } },
  { op: "net.fetchStatic", request: true, m1: true, fields: { url: "string" } },
  { op: "net.fetchKeyed", request: true, m1: true, fields: { url: "string", headers: "string", method: "string?", body: "string?" } },
  { op: "runtime.error", m1: true, fields: { message: "string" } },
  { op: "remote.paired", m1: true, fields: { token: "string" } },
  { op: "remote.pairing", m1: true, fields: { url: "string", token: "string" } },
  { op: "remote.paired-count", m1: true, fields: { n: "number" } },
  { op: "http.response", m1: true, fields: { requestId: "number", status: "number", body: "string", contentType: "string" } },
];

/**
 * host → core: calls into the PrismRuntime API, wrapped as one JSON shape
 * {fn, args:[…]} posted into the brain (a listener in brain.html routes them).
 * Args are positional and JSON-encoded exactly as PrismRuntime declares them.
 */
export const HOST_CALLS: string[] = [
  "init",          // (docJson, w, h, optionsJson?)
  "resize",        // (w, h)
  "event",         // (surfaceEventJson) — drivers.ts SurfaceEvent
  "input",         // (inputEventJson)
  "promoteHero",   // (tileId)
  "setHeroSize",   // (size, commit)
  "refreshTile",   // (tileId)
  "http",          // (requestId, requestJson)
  "mintPairing",   // (baseUrl, onlyIfUnpaired?)
  "switchTo",      // (dashboardId)
  "resolve",       // (requestId, resultJson|null, error|null) — answers request ops
  "addCatalogTile",
  "removeTile",     // (tileId) - arrange mode: drop a tile, persisted
  "toggleFullscreen", // (tileId) - maximize to the window / restore the layout // (entryJson, choicesJson, selectorTableJson|null) - §31 host picker
  "posterPlan",     // (name, baseUrl, html, manifestJson|null) -> JSON string (sync, via ExecuteScript)
  "markPlan",       // (baseUrl, html) -> JSON string: a service symbol's own small icons, best first (2026-09-23)
  "redeemStreamTicket",
  "state",
  "setTileMode",
  "rects",
  "updateTile",     // (tileId, patchJson) - {url?, zoom?|null, focus?|null}: persisted tile edit
  "setLayout",      // (layoutJson) - {"mode":"hero"|"solo"|"grid", cols?, rows?, hero?, heroSize?}: persisted
  "addCustomTile",  // (url, choicesJson) - §31 "any website" tile
  "replaceWithCatalogTile", // (tileId, entryJson, choicesJson, selectorTableJson|null) - configure slot: this slot becomes the pick
  "replaceWithCustomTile",  // (tileId, url) - configure slot: this slot becomes a custom site
  "saveShortcut",   // (tileId, shortcutJson) - {label, url?, focus?|null} for the tile's app
  "removeShortcut", // (tileId, shortcutId)
  "applyShortcut",  // (tileId, shortcutId) - the shortcut's page + view become the tile's
  "startFraming",   // (tileId) - §31 step 3 viewfinder: the slot pops out full screen (window-width layout), unframed
  "finishFraming",  // (tileId, resultJson|null) - {region:{x,y,w,h}, viewport:{w,h}} in that layout's CSS px → focus; null cancels
  "tileCommand",    // (tileId, cmd) - §32 a HUMAN tap on slot chrome / the player control: play|pause|next|prev|mute|unmute|restart|thumbup|thumbdown…
  "tapItem",        // (tileId) - concept-scenes §5 a HUMAN single tap on a scene item; the placement's tapAction decides (promote | audio | both). The verdict comes back as {op:"ui.tapResult"}.
  "saveMasterLayout",   // (layoutJson) - §33 upsert a master layout (app-less slots), persisted
  "removeMasterLayout", // (id)
  "applyMasterLayout",  // (id) - the wall becomes the layout: apps fill slots in order, the rest are empty slots
  "previewLayout", "slotPurposes", // (layoutJson, w, h) / () -> SLOT_PURPOSES JSON (sync)
  "popupDecision",  // (pageUrl, popupUrl, userInitiated) -> JSON {action, reason} (sync) - §30 the shell asks before honoring a popup
  "saveScene", "removeScene", "applyScene", "similarLayouts", // §34 scenes; §33 near-duplicate layouts (sync JSON) -> JSON {rects, floats, unplaced} (sync, via ExecuteScript) - the editor's preview IS the solver
  // scene model (docs/scene-model-spec.md) - additive, all sync JSON via ExecuteScript; the calls above are unchanged
  "modelState",            // () -> {apps, facets, layouts, scenes, activeScene, slotClasses, migrated}
  "modelSaveApp",          // (appJson) -> {ok, value, warnings} | {ok:false, error}
  "modelSaveFacet",        // (facetJson)
  "modelRemoveFacet",      // (facetId) -> "ok" | "unknown" | "referenced"
  "modelSaveLayout",       // (layoutJson) -> result; value.duplicates flags IoU ≥ 0.85 twins, never refuses
  "modelLayoutDuplicates", // (layoutJson) -> [{id, name, archived}]
  "modelArchiveLayout",    // (layoutId, archived) -> "ok" | "unknown"; never deletes
  "modelSaveScene",        // (sceneJson)
  "modelRemoveScene",      // (sceneId)
  "modelApplyScene",       // (sceneId) -> {ok, notes}; the wall becomes the scene (fixed-rect document)
  "playerSetupServices",
  "playerSetup",
  "playerRemove",
  "playerProfileFor",
  "signInsView",
  "signInAdd",
  "signInUse",
  "signInRename",
  "signInHide",
  "signInShow",
  "signInsLabel",
  "videoPresetRename",
  "updateStatus",          // () -> UpdateStatus (sync): §28 for the Device screen (2026-10-05)
  "updateCheck",           // () -> UpdateStatus (async): a check now
  "listenWindow",          // (tile|null) -> {result, tile} (async): the window a phone listens to in multiview; null = the big window (2026-10-05)
  "updateInstallNow",      // () -> {result, ...UpdateStatus} (async): download, verify, stage - the night window's path, by the person's press
  "updateSetChannel",      // (channel) -> UpdateStatus (async): stable | beta
  "videoPlayNextEpisode",  // () -> {ok, did: list|number, season, episode} (sync): plays the next from the Episodes list (2026-10-05)
  "musicPlayNext",         // (tile, kind, id) -> {ok, started?, error?} (sync): Play after this track from the wall's Quick play (2026-10-05)
  "musicNextNow",          // () -> {tile, kind, id, name, service, after, at} | null (sync): the queued pick
  "players",               // () -> {active, music:{id,name}|null, video:{id,name}|null} - the two players (players.ts)
  "switchPlayer",          // (kind) -> {ok, kind, sceneId, notes} | {ok:false, reason:"no-scene", template}; the wall becomes the Music or Video player
  "videoState",            // () -> VideoTileState[] (video.ts): each video tile's face, library, resume point, what it can do
  "videoLibrary",          // (tileId) -> Promise {continue, list}
  "videoPlay",             // (tileId, kind, id, url|null, name|null) - a human's Quick play of a title
  "videoServices",         // () -> {scene, active, screen:{slot,facet,app}|null, services:[{app,name,facet,status,onScreen}]} - the universal Video player (VP-3)
  "videoSwitch",           // (facetId) -> {ok, sceneId, slot} - the Video player's screen becomes this service
  "videoPlayOn",           // (facetId, kind, id, url|null, name|null) -> {ok, switched} - a Quick play on any service, the screen switched first when needed
  "videoProfile",          // (tileId, profileId, always) - a human's pick on the service's profile gate; always = the household's standing choice
  "videoLibraryTab",       // () -> {rows:[{genre, cards}], pending, rated, total, twice, services, tmdbKey} (sync): the Library tab, the owned titles by genre
  "videoProfilesView",     // () -> {services:[{app,name,status,profiles,current,switching}], presets, active} (sync): the Profiles window (2026-09-24)
  "playlistsView",        // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistsPicker",      // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistCreate",       // Playlists (docs/features/playlists.md, 2026-09-27); (name, isPublic) on TMDB (2026-10-03)
  "playlistGate",         // playlists on TMDB lists (2026-10-03): on or the gate
  "playlistSync",         // TMDB's lists read now
  "playlistCopyLocal",    // the device's earlier playlists copied up, once
  "playlistSetPublic",    // a list public or private on TMDB
  "playlistOpen",         // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistRename",       // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistDelete",       // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistUndo",         // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistSend",         // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistImport",       // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistJob",          // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistJobConfirm",   // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistEdit",         // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistPlay",         // Playlists (docs/features/playlists.md, 2026-09-27)
  "playlistStop",
  "playlistMove",         // Playlists (docs/features/playlists.md, 2026-09-27)
  "videoRowOrder",         // (row, order, reverse) -> {row, order, reverse, orders} (sync): Continue watching / My list order, kept on the device (2026-09-26)
  "videoProfileSet",       // (appId, profileId) -> {ok, error?} (sync): one service switched to a profile - rows swapped, the page pressed, read again
  "videoProfileExclude",   // (appId, on) -> {ok, excluded} (sync): a service left out of Watch's Continue watching / My list for the person on now
  "videoRefreshStale",     // () -> {ok, asked} (sync): the services not read in ten minutes read again - Watch opened (2026-09-24)
  "videoFreshness",        // () -> {app:{readAt, working}} (sync): each service's last read and whether it is being read now
  "videoSettings",         // () -> {pause:{on,from,to}, tmdbKey, background} (sync): Watch settings
  "videoUpdatesStatus",    // () -> {services, feeds, ratings, schedule} (sync): the Content updates tab's grid (2026-09-24)
  "videoRefreshApp",       // (appId) -> {ok} (sync): one service's pages read again now
  "videoSetPause",         // (on, from, to) -> {ok, pause} (sync): the timed refresh's quiet hours, off by default
  "videoProfilesCommit",   // (draftJson) -> {ok, switched, preset} (sync): the Profiles window's draft committed - changed profiles switched, exclusions set, a preset saved
  "videoPresetSave",       // (name) -> {ok, preset} (sync): the services' current profiles saved as a named preset
  "videoPresetDelete",     // (presetId) -> {ok} (sync)
  "videoPresetApply",      // (presetId) -> {ok, switched, missing} (sync): every service in the preset switched at once
  "videoCancelPick",       // () -> {ok, paused, restored} (sync): a pick called off before it played - the curtain's "Cancel and return to Watch"
  "videoRemoveInfo",       // (appId) -> {can, warning} (sync): whether a Continue Watching card can be removed on its service
  "videoRemoveContinue",   // (appId, itemId, title) -> {status, error?} (sync): start or report removing a title from the service's own Continue Watching
  "videoEpisodes",         // () -> EpisodesView (sync): every season and episode of the series on the screen - the stage bar's Episodes menu
  "videoListInfo",         // (appId) -> {can} (sync): the service can change its own My List from the wall
  "videoListSet",          // (appId, want, itemId, title, url, kind, catalog) -> {status, error?} (sync, polled): one My List add / remove on the service
  "videoArtOf",            // (tileId) -> {title, art} (sync): what plays on a tile, as its service pictures it - the wall shot's stand-in for a protected frame
  "videoPlayEpisode",      // (episodeId) -> {ok, error?} (sync): play an episode the service itself listed
  "videoMultiview",        // (action, arg?) -> {ok, on, target, max, windows} (sync): multiview - on | off | swap | focus <tile> | target <0..3> | state
  "titleEpisodes",         // (appId, series, itemId|null, season|null, episode|null) -> EpisodesView (sync, poll): a series' episodes for its Details page (2026-09-24)
  "videoLiveGuide",        // (type, q) -> {window, types, rows, guides, events}: the Live tab's guide (docs/features/live.md, 2026-09-28)
  "videoLiveRead",
  "liveScores",
  "liveNews",             // what a live news show reported (docs/features/live.md, 2026-10-01)
  "liveNowOn",            // what is on across a mode's channels, as TMDB knows it (2026-10-02)
  "tmdbLinkState",        // the person's TMDB account (tmdb-account.ts, 2026-10-03): linked or not
  "tmdbLinkStart",        // a request token and its approval page
  "tmdbLinkFinish",       // the token traded for a session after the approval
  "tmdbUnlink",           // the session ended and forgotten
  "tmdbRated",            // the account's own rating of a title
  "tmdbRate",             // a rating written, or taken back
  "watchlistSet",         // the TMDB watchlist (2026-10-03): a title on or off
  "watchlistHas",         // whether a title is on it
  "watchlistImport",      // the services' My List titles copied onto it
  "watchlistView",        // the watchlist row's cards, the offer and the copy's progress
  "watchlistHasTitle",    // a card's title on the watchlist or not
  "watchlistSetTitle",    // a card's title put on or taken off
  "liveScoreWatch",         // (force) -> {ok, asked}: the Live tab open or Refresh - each service's guide page read on its hidden page
  "titleAlsoOnPlan",       // (appsJson) -> [{via, viaName, app, name}]: the services worth asking about a title that plays on these apps - core's ALSO_VIA (2026-09-28)
  "titleAlsoOn",           // (kind, id, title, viaApp) -> {state: yes|no|checking|n/a, app, name} (sync, poll): Hulu titles on Disney+, asked of Disney+ when Details opens (2026-09-25)
  "titleEpisodePlay",      // (appId, series, season, episode) -> {ok, resolving?}: one episode played on that service
  "bootTimings",           // () -> {now, rowsCache, menuReady, lists} (sync): startup milestones in ms since the runtime began (2026-09-24)
  "videoResync",           // () -> {ok, did: nudged|reopened} (sync): the big screen's sound and picture together again - pause/play, or again soon: reopened at its place
  "videoProgramEdges",     // (tile) -> {title, start, end}|null (sync): the guide's program on a channel window now - the break watch's program edges (2026-10-06)
  "videoPictureFrozen",    // (tile, seconds) -> {ok, did} (sync): the shell saw the picture stand still while it plays; the doctor reopens it (2026-10-06)
  "videoStartOver",        // () -> {ok, did: start|previous, season?, episode?} (sync): the big screen back to its start, or in its first 5 s the episode before (2026-09-24)
  "videoNextEpisode",      // (tileId) -> {ready, next, series} (sync): the next episode of the series the tile plays, as TMDB knows it - the stage bar's card
  "videoTrack",            // (tileId, kind, trackId) - a human's pick of the service's own subtitle / audio track from the stage bar (adapter videoTracks)
  "videoMenu",             // () -> the universal video menu's rows (video-menu-spec §2), ordered by §4 through menu-order.ts alone
  "videoMenuRows",         // (withLenses) -> the menu's rows without the Library, for the page's follow loops (2026-10-03, perf)
  "videoSearch",           // (facetId, q, open|null) -> {ok, switched}: the service's own search page with the words in place (§2 row 5); open = the result to press once shown
  "videoLookup",           // (q) -> {ok, q, token, done, services:[{app,name,facet,status,candidates}]}: cross-service search, every signed-in service at once on hidden surfaces
  "videoLookupState",      // () -> the cross-service search as it stands (poll until done) | null
  "videoBrowse",           // (genre|null, offer|null) -> Browse by genre (offer: included | any, kept on the device): the chips, then Yours and the three discover rows, each with its formula and source (2026-09-22)
  "videoBrowsePlay",       // (appId, cardId) -> {ok, resolving}: a Browse card plays on that service through its own search
  "videoBingeView",        // () -> {ok, head, kids, ages, caveat, genres:[{genre, cards}], reading} (sync): The Binge in full (2026-09-24)
  "videoBingeSet",         // (thresholdsJson|null, kidsJson|null, animation|null) -> {ok, thresholds, kids, animation} (sync): kept on the device
  "videoBingeHide",        // (cardId, on, title|null) -> {ok} (sync): a Binge title hidden on this device
  "videoBingeHidden",      // () -> {items:[{id, title, why, service, at, until}]} (sync): the hidden titles, for Watch settings
  "videoBingePlay",        // (appId, cardId) -> {ok, resolving}: a Binge card plays; a miss opens the service's search and notes the card missing
  "videoBrowseRow",        // (genre|null, row, offer|null, want|null) -> one Browse row in full: its head and all its cards (2026-09-22)
  "videoLookupView",       // (genre|null, app|null) -> the search as it stands with rows filtered by genre / service, plus the genres and services the rows offer (2026-09-22)
  "videoPlayResult",       // (appId, candidateJson) -> {ok, switched}: a cross-service result plays on its service
  "videoTune",             // (facetId, channelId, url|null, name|null) -> {ok, switched}: a Live now card's press - the channel's guide item pressed in the service's page (§3 tune)
  "videoForgetProfile",    // (tileId) - the standing choice forgotten
  "videoProfileChoose",    // (appId, profileId) -> {ok, name}: the profile a service watches as, chosen plainly from the menu; stands until changed
  "videoProfileAsk",       // (appId) -> {ok}: the choice cleared, the service asks again
  "videoForgetWatch",      // (appId, what) -> {ok, removed}: a watch taken out of the local log, resume point and recents by id / address / title
  "videoRefreshLists",     // (force?) -> {ok, asked}: every signed-in service's own list page read on a hidden surface - the combined My list
  "lensChoose",            // (lensId|null) -> {ok, active}: the lens laid over the menu's rows (§4a); null = none, the default
  "lensSetTmdbKey",        // (key|null) -> {ok, set}: the person's own TMDB key, kept on the device; null clears it and every TMDB number with it
  "lensDisclosure",        // (title) -> {rating, links:[{name,url}], facts}: a card's rating disclosure and its outbound links (navigation only)
  "lensHasKey",            // () -> "true" | "false": a TMDB key is set (the household's own, or the product's)
  "modelTemplates",        // () -> SceneTemplate[] (roles, never apps)
  "modelInstantiateTemplate", // (templateId, resolvedJson, name|null) -> result with the Layout + Scene; refused while a role is unresolved
  "modelMigrate",          // (storeJson, force) -> {status, report}; writes ONLY scene-model:* keys (§7, §10)
  "newsShelf",             // () -> the derived news shelf (§31), attributed
  "listeningChips",        // () -> §14 chips: [{id, label, slot, transport, state}] - who is listening privately and the slot they hear (all the audio owner: §14 is ONE capture of the frame's output). Pairing tokens stay core-side.
  // §32 music (SM-4): Media Session state of the scene's hidden music facets + the transient reveal
  "musicState",            // () -> {sources:{facet: MusicSourceState}, reveal:{facet,mode}, feeds:[VisualizationFeed]} (sync JSON)
  "revealMusic",           // (facetOrVisualizationId, mode "panel"|"hero") - the hidden facet's native player as a transient overlay (§16 path)
  "collapseMusic",         // () - back to hidden; audio never interrupted
  "restyleVisualization",  // (tileId, style, artwork|null) - rebuild ONLY that visualization surface with the new pack; the source's audio is never touched
  "musicRecent",           // (tileId) -> JSON RecentMusic[] (async) - quick play: the last five collections this tile played from
  "playRecent",            // (tileId, url) - quick play: go to one of them and press the page's Play (only a page Prism saw play)
  "musicLibrary",          // (tileId) -> JSON {playlists, stations} (sync) - the service's library as the page reported it
  "playCollection",        // (tileId, kind, id) - queue a LISTED collection through the adapter's musicPlay and play it
  "resumeService",         // (tileId) - B-205: switch the wall to this service - the stage follows, and it plays what it holds, else what it last played
  "musicLookup",           // (tileId) - Quick play cross-service lookup (2026-09-16): ask this service's page for the song playing now; the state is read back
  "musicLookupState",      // (tileId) -> JSON {status, song, match, candidates, playlists, action} (sync) - what the lookup found, and what the last add / station did
  "musicLookupPick",       // (tileId, songId) - an ambiguous lookup: the person names which candidate is the song
  "musicAddToPlaylist",    // (tileId, playlistId, songId) - add the found song to one of this service's playlists (ids the page itself listed)
  "musicStationFromSong",  // (tileId, songId) - start this service's station seeded from the found song; the stage follows
  "recycleApp",            // (appId) - B-124 recovery: destroy + recreate the App's own wall surfaces after App setup closes (by App since 2026-10-05, one browser)
  "musicSources",          // () -> JSON [{tile, app, name, session, active, stages}] (sync) - the scene's music sources, for a menu grouped by service
  "setIntermissionAmbient", // (sound|null) - section 26 ambient audio: the soundscape for every music source's breaks, or silence
  "registerStylePalettes", // (json {styleId: ["#RRGGBB", …]}) -> count (sync) - the shell declares the packs it loaded so CORE does the §32 backdrop tint
  "noteArtworkColors",     // (facet, url, pixelsBase64) - the shell's RGBA sample of the artwork; core derives dominantColors + tintPalette into the feed
  "sceneStep",             // (direction 1|-1) -> next/previous scene of the model (carousel over scenes, §9)
  "uiRoute",               // (route, source) - the host reports a prism:// route it opened (flight recorder + remote parity); core never routes
  // editors' model evaluation (B-40): sync JSON, the same functions model-eval.ts exposes as PrismModelEval.* - core-side constants, no C# mirror
  "modelClassifyLayout",   // (layoutJson) -> Layout + {canvasLabel} | "null"
  "modelNearestBucket",    // (ratio) -> {bucket, deviation, ratio}
  "modelRepresentativeRect", // (slotClass, w, h) -> {x,y,w,h}
  "modelClassRatio",       // (slotClass) -> number | null
  "modelFacetPresets",     // (entryJson, slotClass) -> FacetPreset[]
  "modelPresetFacet",      // (entryJson, presetId, appId, slotClass, selectorTableJson|null, facetId|null) -> facet input | "null"
  "modelLoginRedirect",    // (url, loginPrefix|null, baseUrl|null) -> {redirect, status}
  "modelFacetPickerJs",    // () -> page JS (the §31 element picker)
  "modelFacetPickPollJs",  // () -> poll expression
  "modelFacetPickStopJs",  // () -> stop expression
  "modelPickPollJs", "modelPickStopJs", // aliases of the two above (the work order named them so; the C# probes the Facet* names)
  "modelSelectorRectJs",   // (selector) -> verifier expression
  // App preview / setup surfaces (B-41): outside the wall, in the App's profile, engine-covered, destroyed on close
  "modelOpenAppSurface",   // (appId, url|null) -> surfaceId | "" (unknown app); the surface loads url or the App's baseUrl
  "modelCloseAppSurface",  // (surfaceId) -> "ok" | "unknown"
];

/** Surface event type names the host may post via `event` (drivers.ts). */
export const SURFACE_EVENT_TYPES: string[] = [
  "load-finished", "first-paint", "adapter-ready", "playback", "interaction",
  "navigated", "focus-result", "ad-break", "skip-available", "ad-info", "listener-lost",
  "app-ad-break", "app-skip-available", "app-foreground", "intermission-skip", "gpu-reset",
  "media-position", "now-playing", "session", "fullscreen-element", "popup", "music-result",
  "profile-migrated",
];
