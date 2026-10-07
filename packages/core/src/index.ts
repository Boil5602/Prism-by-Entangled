export {
  SCHEMA_VERSION,
  aliasTileKind,
  parseAspectHint,
  tileKind,
} from "./types.js";
export type {
  AudioPolicy,
  AudioSpec,
  DashboardDocument,
  FocusSpec,
  GridLayout,
  GridSpec,
  FixedLayout,
  HeroLayout,
  InputBinding,
  InputMap,
  LayoutSpec,
  PreviewSpec,
  ScheduleEntry,
  TapAction,
  ThemeMode,
  ThemeSpec,
  TileSpec,
  TileState,
  TouchMode,
  ViewportMode,
} from "./types.js";

export { aspectCost, fitQuality, solveHero } from "./solver.js";
export type { Rect, SolvedRects, SolverTile } from "./solver.js";

export type {
  AlarmDriver,
  AppInfo,
  Drivers,
  DisplayDriver,
  InputDriver,
  InputEvent,
  MaybePromise,
  MediaDriver,
  NetDriver,
  RemoteDeviceInfo,
  StoreDriver,
  SurfaceCreateOptions,
  UpdateDriver,
  SurfaceDriver,
  SurfaceEvent,
} from "./drivers.js";

export {
  DEFAULT_ASPECT_HINT,
  DEFAULT_ASPECT_WEIGHT,
  clampHeroSize,
  insetRects,
  layoutDashboard,
  parseArea,
  tileToSolverTile,
} from "./layout.js";
export type { HeroOverride, Viewport } from "./layout.js";

export { AudioFocusMachine } from "./audio-focus.js";
export type { AudioCommand } from "./audio-focus.js";

export { AlarmEngine } from "./alarm.js";
export type { AlarmHooks, AlarmOptions, AlarmStatus } from "./alarm.js";

export { CompatTracker, REPORT_KINDS, toDomain, validateReport } from "./compat.js";
export type { CompatContext, CompatReport, PendingOffer, ReportKind } from "./compat.js";

export { IntermissionController } from "./intermission.js";
export type {
  IntermissionHooks,
  IntermissionOptions,
  IntermissionTileConfig,
} from "./intermission.js";

export { collectionKind, collectionSlug, type RecentMusic } from "./orchestrator.js";
export { DEFAULT_BACKGROUND, Orchestrator } from "./orchestrator.js";
export type { DashboardBundle, RemoteStateSnapshot, TapResult } from "./orchestrator.js";
export { ScheduleEngine, msUntil } from "./schedule.js";
export type { ScheduleActions } from "./schedule.js";
export { LifecycleManager } from "./lifecycle.js";
export type { LifecycleHooks, LifecycleTileSpec } from "./lifecycle.js";
export {
  AdapterRegistry,
  FRAME_PRELUDE_JS,
  SYNTHETIC_INTERACTION_PATTERNS,
  CONTROL_NAMES,
  PRESENTATION_NAMES,
  clickControlJs,
  lintAdapter,
  lintAdapterData,
  mediaCommandJs,
  parseControl,
} from "./adapters.js";
export type { AdapterSpec, ControlBinding, ControlName, PresentationName } from "./adapters.js";
// §26 presentation actions: resolved ONLY by the keeper's handler (adapters-presentation.ts)
export { PresentationKeeperRunner, resolvePresentationAction } from "./adapters-presentation.js";
export type { KeeperSurface, ResolvedPresentationAction } from "./adapters-presentation.js";
// §31 utility facet presets, login-redirect verification, representative shapes, the element picker
export {
  FACET_PICK_POLL_JS, FACET_PICK_STOP_JS, facetPickerJs, facetPresetsFor, loginRedirect, presetFacet, presetSelectorNames, sessionProbeJs, sessionVerdict,
  representativeRect, representativeShare, selectorRectJs, setupStatusFor, slotClassSlug, stableSelector, tunedPresetFor,
} from "./adapters-facets.js";
export type { CatalogEntryWithFacets, FacetPreset, LoginRedirect } from "./adapters-facets.js";
export { focusFramingJs } from "./focus.js";
// docs/concept-scenes.md §6 first-party micro-facets: the chores + timer documents (one edit path for the panel and the phone)
export {
  AGENDA_KEY, CHORES_KEY, DEFAULT_TIMER_VOLUME, MAX_AGENDA_EVENTS, MAX_AGENDA_TITLE, MAX_CHORES, MAX_CHORE_TEXT, MAX_NOTES,
  MAX_TIMER_MS, TILES_KEYS, TIMER_KEY, TIMER_PRESETS,
  addChore, advanceTimer, agendaOnDay, applyTilesIntent, clearDoneChores, emptyAgenda, emptyChores, emptyTimer, isTilesKey,
  normalizeAgenda, normalizeChores, normalizeTimer, parseTilesIntent, readTilesDoc, removeChore, reorderChore, setAgenda,
  setChoreDone, setChoreNotes, timerRemaining,
} from "./tiles-data.js";
export type { AgendaDoc, AgendaEvent, ChoreItem, ChoresDoc, TilesApplyResult, TilesIntent, TilesKey, TimerDoc, TimerMode } from "./tiles-data.js";
export {
  DEVICE_PROFILES,
  KNOWN_SLOTS,
  SHARE_SCHEMA,
  exportLayout,
  fitReport,
  importLayout,
  importPlan,
} from "./sharing.js";
export type {
  DeviceProfileSpec,
  ExportOptions,
  FitReportEntry,
  ImportResult,
  SharedLayout,
  SharedTile,
  SlotPrompt,
} from "./sharing.js";
export { RemoteApi } from "./remote.js";
export type { RemoteRequest, RemoteResponse } from "./remote.js";
export {
  DEFAULT_PREVIEW_BUDGET,
  PEEK_TIMEOUT_MS,
  PREVIEW_BUDGETS,
  PeekScheduler,
  REPORT_POSITION_JS,
  VirtualPlayhead,
  seekJs,
} from "./preview.js";
export type { PeekHooks, PeekTileConfig, PreviewBudget } from "./preview.js";
export {
  DEFAULT_INPUT_MAP,
  DEVICE_PREFIX,
  deviceMap,
  nextTileInDirection,
  overriddenDevices,
  resolveBinding,
} from "./input.js";
export type { FocusDirection } from "./input.js";
export { RefreshEngine } from "./refresh.js";
export {
  BlockListManager,
  DEFAULT_BLOCK_SOURCES,
  parseAbpHosts,
  parseHosts,
  parseHostsFile,
} from "./blocking.js";
export type { BlockSourceSpec, BlockSourceStatus, BlockingHooks } from "./blocking.js";
export { FUNCTIONAL_POPUPS, MorphCoalescer, PopupPolicy, aggregateLedger, allowSentence, allowedSentence, popupHost } from "./popups.js";
export { ReclaimedLedger, dayKey, monthStartKey, weekStartKey, windowsFrom } from "./reclaimed.js";
export type { ReclaimedEntry, ReclaimedWindows } from "./reclaimed.js";
export type { AggregateRow, AllowedRow, ButtonPrefs, LedgerEntry, PopupAction, PopupAttempt, PopupDecision, PopupEvent, PopupGesture, PopupPolicyState, SitePolicy } from "./popups.js";
export { UpdateChecker, UPDATE_CHANNELS, asUpdateChannel, channelLabel, compareVersions, isUnparameterized, parseManifest } from "./updates.js";
export type { ReleaseInfo, UpdateChannel, UpdateConfig, UpdateHooks, UpdateManifest, UpdateStatus } from "./updates.js";
export { DEFAULT_AV_OFFSET_MS, PrivateListening, UNNAMED_LISTENER, avOffsetJs, listeningChips } from "./listening.js";
export type {
  ListenTransport,
  ListenerInfo,
  ListeningChip,
  ListeningHooks,
  ListeningOptions,
  ListeningStatus,
  SpeakerMode,
} from "./listening.js";
export { VPN_NOTES, VpnManager, parseWireGuardConf } from "./vpn.js";
export type { ParsedWireGuard, VpnHooks, VpnStatus } from "./vpn.js";
export { CLEAR_VEIL_JS, CosmeticRegistry, VEIL_ATTR, parseCosmeticRules, veilJs } from "./veil.js";
export type {
  CosmeticSourceAttribution,
  CosmeticSourceInfo,
  CosmeticSourceSpec,
  SelectorSet,
  VeilMode,
  VeilOverlay,
  VeilPageConfig,
} from "./veil.js";
export type { RefreshEngineOptions } from "./refresh.js";
export { createBridgeDrivers, createRuntime } from "./runtime.js";
export type { PrismRuntimeApi } from "./runtime.js";
// §31 site catalog & poster resolution
export { pickerTile, assertPlainTile, clampZoom, validCatalogEntry, PICKER_TILE_FIELDS } from "./catalog.js";
export type { CatalogEntry, CatalogPreset, PickerChoices } from "./catalog.js";
export { manifestUrl, manifestIcons, htmlIcons, themeColor, wordmark, nameHue } from "./poster.js";
export type { PosterCandidate, WordmarkFallback } from "./poster.js";
// Scene model (docs/scene-model-spec.md): App · Slot · Layout · Facet · Scene · Canvas class · Visualization
export {
  ASPECT_BUCKETS,
  CANVAS_ASPECT_TOLERANCE,
  CLASS_SEPARATOR,
  CUSTOM_CLASS_NOTE,
  DEFAULT_ASSIGNMENT_SETTINGS,
  DEFAULT_PEEK_INTERVAL_SEC,
  FAMILY_HUB,
  KITCHEN_CLASSIC,
  KITCHEN_COMMAND,
  MOVIE_NIGHT,
  MUSIC_LOUNGE,
  MUSIC_LOUNGE_CLOCK,
  LAYOUT_DUPLICATE_IOU,
  SCENE_MODEL_SCHEMA,
  SCENE_TEMPLATES,
  SPORTS_MULTIVIEW,
  SIZE_TIERS,
  TIER_SHARE,
  archiveLayout,
  assignmentSettings,
  bucketAspectHint,
  canvasClassMatches,
  canvasClassOf,
  classifyRect,
  classifySolvedLayout,
  denormalizeRect,
  duplicateFlag,
  facetFitsSlot,
  facetTile,
  floatingRect,
  formatCanvasClass,
  formatSlotClass,
  instantiateTemplate,
  layoutDuplicates,
  layoutFromSolved,
  nearestAspectBucket,
  normalizeApp,
  normalizeFacet,
  normalizeLayout,
  normalizeRect,
  normalizeScene as normalizeModelScene,
  normalizeSceneTemplate,
  normalizeTemplateRole,
  normalizeTemplateVisualization,
  orderFacetsForSlot,
  parseSlotClass,
  pickableLayouts,
  reclassLayout,
  rectIoU,
  resolutionBucket,
  resolveAssignment,
  sceneDocument,
  sizeTier,
  slotClassRatio,
  slotClassesInLayouts,
  templateAudioOwner,
  templateCompletion,
  templateVisualizationId,
} from "./scene-model.js";
export type {
  App,
  AppRenderDefaults,
  AppSetup,
  AppSetupStatus,
  ArtworkMode,
  AspectBucket,
  Assignment,
  AssignmentSettings,
  CanvasClass,
  CanvasSize,
  Facet,
  FacetFit,
  FloatAnchor,
  FloatingPlacement,
  HiddenPlacement,
  Layout,
  LayoutDuplicate,
  LayoutProvenance,
  NormalizedRect,
  OnEnd,
  ResolutionBucket,
  Scene as ModelScene,
  SceneMaterials,
  SceneTemplate,
  SizeTier,
  Slot,
  SlotClass,
  TemplateCompletion,
  TemplateInstance,
  TemplateRole,
  TemplateRoleKind,
  TemplateVisualization,
  Visualization,
  VisualizationStyle,
} from "./scene-model.js";
export { SceneModelStore } from "./scene-model-store.js";
export type { SaveResult, SceneModelSnapshot, SceneModelStoreOptions } from "./scene-model-store.js";
export { SCENE_MODEL_KEYS, appKeyOf, assertWritesOnlyNewKeys, inferCanvasFromBoot, migrateStore, storeData } from "./scene-migration.js";
export type { InferredClass, MigrationOptions, MigrationReport, MigrationResult, SceneModelBundle } from "./scene-migration.js";
export { CORRELATION_MS, USER_INPUT_MS, initialKeeperState, keeperConfig, run as runKeeper, step as stepKeeper } from "./presentation-keeper.js";
export type { KeeperConfig, KeeperEvent, KeeperReason, KeeperState, PresentationAction, PresentationState } from "./presentation-keeper.js";
export { MusicStateModel, TRANSPORT_ACTIONS, emptySource, reduceSource, transportAvailability, visualizationFeed } from "./music-state.js";
export type { MediaPlaybackState, MediaSessionEvent, MediaSessionMetadata, MusicSourceState, RevealState, TransportAction, VisualizationFeed } from "./music-state.js";
// §26/§27 imagery packs: the pack format, its attribution gate and the card-corner rule
export { ATTRIBUTION_REQUIRED, IMAGERY_LICENSE_IDS, IMAGERY_PACK_SCHEMA, attributionSentence, cardAttribution, unfetchedImages, validateImageryPack } from "./imagery-pack.js";
export type { AttributionMode, CardAttribution, ImageryLicense, ImageryLicenseId, ImageryPack, PackDiskFile, PackImage } from "./imagery-pack.js";
export { buildNewsShelf, slugify, usableDomain } from "./news-shelf.js";
export type { NewsShelf, NewsShelfCriterion, NewsShelfEntry, PerennialSourceRow, PerennialSourcesSnapshot, PerennialStatus } from "./news-shelf.js";
export { NEWS_SHELF, NEWS_SHELF_SNAPSHOT_FILE } from "./news-shelf.data.js";
// §6a quick actions: the prism:// route registry, context sheet, reach table, back stack
export { CONTEXT_SHEET_ACTIONS, REACH, ROUTES, ROUTE_SCHEME, RouteStack, SELECTION_GESTURES, SHEET_LABELS, actionCount, buildRoute, contextSheetActions, cornerAffordance, isPrismRoute, matchRoute, needsAttentionRoute, routeDef, routeForAction, routeRegistry, routes, tapRoute } from "./routes.js";
export type { ContextSheetAction, ItemContext, ReachEntry, RouteDef, RouteEntity, RouteKind, RouteMatch, RouteRegistry, SceneItemKind, SceneItemRef, SheetAction } from "./routes.js";
// §32 visualizations: style packs, artwork modes, palette tint, the audio-source contract and the seam op
export { ARTWORK_CROSSFADE_MS, ARTWORK_MODES, DEFAULT_MOTION, PRISM_BANDS, SILENT_SOURCE, VISUALIZATION_STYLE_IDS, artworkPresentation, dominantColors, hexToRgb, normalizeStylePack, rgbToHex, smoothBands, testSignal, tintPalette } from "./visualization.js";
export type { ArtworkPresentation, Rgb, StyleMotion, StylePack, VisualizationAudioSource, VisualizationCreateOptions, VisualizationDriver } from "./visualization.js";
export { WORDMARK_ANGLE, WORDMARK_GUARD_MS, WORDMARK_RUN, WORDMARK_WORD, bandsReachWhite, wordmarkCss, wordmarkFactors, wordmarkHtml, wordmarkScript, wordmarkSnippet } from "./wordmark.js";
export type { WordmarkOptions } from "./wordmark.js";
