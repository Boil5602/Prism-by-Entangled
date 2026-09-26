/**
 * The driver seam (spec §23) — the ONLY porting surface.
 *
 * Each shell (Android, PrismOS daemon, Windows recipe) implements these
 * interfaces and decides nothing: layout, audio policy, lifecycle, and
 * readiness all live in core. Drivers execute primitive operations and
 * report primitive events.
 *
 * Methods may complete synchronously or asynchronously; core awaits them
 * either way. Shells bridging over a JS-runtime boundary (Android) may treat
 * void-returning commands as fire-and-forget as long as ordering per surface
 * is preserved.
 */

import type { Rect } from "./solver.js";
import type { NowPlaying } from "./types.js";

export type MaybePromise<T> = T | Promise<T>;

export interface SurfaceCreateOptions {
  id: string;
  /** Storage profile name (§10). Never wiped by the shell — normative. */
  profile: string;
  /** Substrate color painted before first paint (§16 — no white frames). */
  background: string;
  /** UA/viewport mode (§2). */
  viewport?: "auto" | "desktop" | "mobile" | "wide";
  /** Desktop identity claimed when viewport is "desktop". */
  uaPlatform?: "windows" | "mac";
  zoom?: number;
  /**
   * §12 launch tile: the surface is a poster for this app package, not a
   * web view. The shell resolves icon/label; taps and the launch command
   * still route through core to Media.launch.
   */
  launch?: string;
  /** §33 empty slot: the shell draws an "empty slot" (no web view, no session); `label` names its shape. */
  placeholder?: boolean;
  label?: string;
  /**
   * §5 content blocking for this surface (network-level, shell-owned).
   * Core resolves it from the tile's `blocking` flag and §27 veil mode —
   * `veil-only` implies false. Default true.
   */
  blocking?: boolean;
  /**
   * Scene-model surface kind (win-host-spec §5 coverage): "slot" (default),
   * "floating" (above slots, below veils), "hidden" (off-canvas audio surface:
   * intermission is audio-only - page-invisible mute + optional ambient),
   * "preview" (an App setup / facet-preview surface outside the wall: full
   * window, above the wall, never in layout or audio focus, destroyed on close).
   * Informational for the shell's engine attach; core decides everything else.
   */
  kind?: "slot" | "floating" | "hidden" | "preview";
}

/** §32 what a visualization surface renders from (music-state.ts VisualizationFeed, serialized). */
export interface VisualizationSurfaceOptions {
  id: string;
  style: string;
  /** The hidden music facet (tile id) this visualization listens to. */
  source: string;
  artwork: "off" | "backdrop" | "focal";
  /** Draw past the tile's bounds (over neighbours) instead of clipping. Optional, default contained. */
  spill?: boolean;
}

/** §32 reveal states of a hidden facet: never a placement, never persisted. */
/** "window" (B-146, 2026-09-08): the page as an inline window in the middle of the wall, a menu bar of Prism's own above it. */
export type SurfacePresence = "hidden" | "panel" | "hero" | "window";

/**
 * Surface = one web tile (WebView on Android, Chromium window on PrismOS).
 *
 * Contract (§16): a created surface starts HIDDEN over the dark substrate;
 * core calls `reveal` when the page is ready. Nothing unstyled is ever
 * presented — the shell never shows a surface on its own initiative.
 */
export interface SurfaceDriver {
  create(opts: SurfaceCreateOptions): MaybePromise<void>;
  destroy(id: string): MaybePromise<void>;
  setRect(id: string, rect: Rect): MaybePromise<void>;
  setOpacity(id: string, opacity: number): MaybePromise<void>;
  setZ(id: string, z: number): MaybePromise<void>;
  /**
   * Solo layout: a tile that is laid out but not on screen neither draws nor
   * ticks (View gone + WebView paused); its renderer and session stay. Optional —
   * shells without it just draw everything beneath the top tile.
   */
  setVisible?(id: string, visible: boolean): MaybePromise<void>;
  /** Go back one step in the tile's own page history; false when there is nothing to go back to. */
  goBack?(id: string): MaybePromise<boolean>;
  navigate(id: string, url: string): MaybePromise<void>;
  inject(id: string, css: string | null, js: string | null): MaybePromise<void>;
  /** Capture current pixels and display them frozen over the surface (§16). */
  freeze(id: string): MaybePromise<void>;
  /**
   * Crossfade to the live surface: from frozen pixels after a refresh, or
   * from hidden on first load. Idempotent when already live (§16).
   */
  reveal(id: string, durationMs: number): MaybePromise<void>;
  /**
   * §18 warm state: release the tile's renderer while the frozen pixels stay
   * on screen. Profile/session storage is untouched (§10). Core always calls
   * freeze first, so there are pixels to hold.
   */
  suspend(id: string): MaybePromise<void>;
  /**
   * §18 revive: recreate the renderer hidden behind the frozen pixels, with
   * the same profile and options as create. Core then navigates and reveals
   * at readiness (§16).
   */
  resume(id: string): MaybePromise<void>;
  /**
   * §25 living previews: this surface's revival is a PEEK — a muted,
   * transient renderer that exists only to refresh the still. Core brackets
   * every peek with `setPeek(id, true)` … `setPeek(id, false)`, so the shell
   * can hold the §16 guarantee across it: the surface stays hidden behind
   * its own still until readiness, and a `freeze` that arrives while the
   * peek never revealed (the `PEEK_TIMEOUT_MS` abort) must KEEP the last
   * still rather than capture a half-loaded page. Optional; a shell without
   * it simply shows the ordinary revive crossfade.
   */
  setPeek?(id: string, peeking: boolean): MaybePromise<void>;
  /** Persist a snapshot to disk for instant-boot display (§18); optional. */
  snapshot?(id: string): MaybePromise<string>;
  /**
   * §26 intermission overlay: full-bleed imagery crossfaded over the tile.
   * Optional — shells without it degrade to nothing (ads simply show).
   */
  showIntermission?(id: string, source: string): MaybePromise<void>;
  hideIntermission?(id: string): MaybePromise<void>;
  /**
   * §26 pass-through skip: show/hide a real "Skip" chip on the intermission
   * scenery. A tap reports `intermission-skip`; core forwards it to the
   * player's own control. The shell never taps it itself.
   */
  setIntermissionSkip?(id: string, available: boolean, target?: string): MaybePromise<void>;
  /** §26 break progress on the card ("Ad 1 of 2 · 0:14"); display only, observation-fed. */
  setAdInfo?(id: string, count: string, remaining: number): MaybePromise<void>;
  setMuted(id: string, muted: boolean): MaybePromise<void>;
  /** A trusted pointer move to (x, y) in a hidden lookup surface's page - never a press (a shell without it leaves the hover to the page's own events). */
  hover?(id: string, x: number, y: number): MaybePromise<void>;
  /**
   * Layout viewport for a live surface, in CSS px: the page lays out at w×h
   * (responsive breakpoints respond; any size, wider than the slot or the
   * window included) and is drawn scaled to fit the surface's rect. 0×0
   * clears it (the page lays out at the rect). Backs §2 `zoom` (rect/zoom)
   * and §17 `focus.viewport`. Optional; a shell without it shows pages at 1×.
   */
  setViewport?(id: string, w: number, h: number): MaybePromise<void>;
  /** §32 push the tile's now-playing state to the shell's player control (null = clear). */
  setNowPlaying?(id: string, info: NowPlaying | null): MaybePromise<void>;
  /** §32 which chrome a surface wears: a wall slot (none), or a floating facet showing its control or its page. "frame" is the pre-rename wire spelling of "slot" - shells accept both for one release. */
  setChrome?(id: string, kind: "slot" | "floating", face: "control" | "page", hidden?: boolean): MaybePromise<void>;
  /** §12 TV d-pad: draw/clear the focus ring on a tile. Optional (touch-only shells). */
  setFocused?(id: string, focused: boolean): MaybePromise<void>;
  /**
   * §7 "entered" tile: the page receives the remote. The shell gives the
   * tile's renderer keyboard focus (and takes it back on leave).
   */
  setPageInput?(id: string, active: boolean): MaybePromise<void>;
  /**
   * Forward a HUMAN key press into the tile's page as a real platform key
   * event (never a synthetic DOM event). Keys are named like "DPAD_DOWN",
   * "ENTER", "BACK", "SPACE", "TAB".
   */
  sendKey?(id: string, key: string): MaybePromise<void>;
  /** Forward HUMAN-typed text into the page's focused field (sign-ins, searches). */
  typeText?(id: string, text: string): MaybePromise<void>;
  /**
   * Evaluate an expression in the tile's page and return its result as a
   * string (JSON-ish). Used by core to confirm a field exists / holds the
   * human's text before pressing on — never to act on the page.
   */
  evaluate?(id: string, js: string): MaybePromise<string | null>;
  /** A trusted press (move, down, up) at a page point - only the slider's seek on a service's own scrubber (adapter videoSeekPoint). */
  scrub?(id: string, x: number, y: number, press?: boolean): MaybePromise<void>;
  /**
   * §27 veil imagery: locally-served URLs the page may use for a source
   * (`pack:cosmos`, a photos album…). Never fetched from the web at render
   * time. Optional — without it the veil degrades to a textured fill.
   */
  veilImagery?(source: string): MaybePromise<string[]>;
  /** Private listening capture (§14); optional per platform. */
  captureAudio?(enable: boolean): MaybePromise<void>;
  /**
   * §32 visualization surface: a shell-rendered, audio-reactive surface (the
   * FFT never crosses the seam - the shell taps its own loopback). Placed and
   * removed like any surface (setRect/setZ/setOpacity/destroy). Optional: a
   * shell without it renders the placement dark.
   */
  createVisualization?(opts: VisualizationSurfaceOptions): MaybePromise<void>;
  /** §32 the feed a visualization renders from (active / metadata / artwork); JSON of music-state VisualizationFeed. */
  setVisualizationFeed?(id: string, feedJson: string): MaybePromise<void>;
  /**
   * §32 reveal/collapse through §16: "hidden" collapses the surface to zero
   * size (audio uninterrupted - the renderer is never destroyed), "panel" /
   * "hero" show it at `rect` with a crossfade. Optional.
   */
  setPresence?(id: string, presence: SurfacePresence, rect: Rect, durationMs: number): MaybePromise<void>;
}

/**
 * §6a deep links: the shell's UI router opens a prism:// route (scene, facet
 * editor, app setup, item context sheet). Route strings are data owned by the
 * shell's route registry; core forwards, never routes.
 */
export interface UiDriver {
  route(route: string, source: string, id?: string): MaybePromise<void>;
  /**
   * What a single tap on a scene item resolved to (docs/concept-scenes.md §5):
   * the shell asked core to interpret the tap and core answers here, so the
   * on-wall pill and the phone see the same verdict. Reported for every tap
   * core resolves — from the wall and from the §6 remote alike. Optional.
   */
  tapResult?(id: string, result: TapOutcome): MaybePromise<void>;
}

/** The resolved meaning of one tap (orchestrator's `TapResult`, flattened for the seam). */
export interface TapOutcome {
  action: "promote" | "audio" | "both";
  did: "promote" | "audio" | "audio+promote" | "none";
  audio?: "moved" | "already-owner" | "peeking";
  error?: "unknown-tile" | "unavailable";
}

/** Events a surface driver reports back into core. */
export type SurfaceEvent =
  | { type: "load-finished"; id: string; ok: boolean }
  | { type: "first-paint"; id: string }
  /** Explicit adapter readiness signal — `frame.ready()` for late-painting SPAs (§16). */
  | { type: "adapter-ready"; id: string }
  | { type: "playback"; id: string; playing: boolean; /** the element reached its end (the media `ended` event) - §26 onEnd / presentation keeping */ ended?: boolean }
  /** User touched/focused the tile — feeds §18 recency and revives warm tiles. */
  | { type: "interaction"; id: string }
  /** SPA navigation within the page — adapters re-inject their JS (§5).
   * `url` (where the shell can read it) feeds resume-last-location: the tile
   * returns to this URL on the next boot, like a TV turning off while the
   * streaming box holds state. */
  | { type: "navigated"; id: string; url?: string }
  /** §17 framing script result: was the focus selector found and framed? */
  | { type: "focus-result"; id: string; found: boolean }
  /** §26 adapter ad-break signal (`frame.adBreak`) — observation only. */
  | { type: "ad-break"; id: string; active: boolean }
  /**
   * §26 adapter observed the player's skip affordance appear/disappear
   * (`frame.skipAvailable(available, target?)`). `target` is the observed
   * control's selector; it refines the adapter's declared `controls.skip`.
   */
  | { type: "skip-available"; id: string; available: boolean; target?: string }
  /** §26 observed break progress (`frame.adInfo`): count "N of M", seconds left. */
  | { type: "ad-info"; id: string; count?: string; remaining?: number }
  /** §14 a listener's stream ended without the listener asking (peer gone, stream closed). */
  | { type: "listener-lost"; id: string; listener: string }
  /**
   * §26 for NATIVE apps (§12 launch tiles): the shell's accessibility
   * observer saw the app's own ad markers / skip affordance in its UI tree.
   * Observation only — keyed by package; core maps it to the launch tile.
   * `target` is an opaque node reference the shell can click on a HUMAN's
   * request (tileCommand "skip").
   */
  | { type: "app-ad-break"; id: string; package: string; active: boolean }
  | { type: "app-skip-available"; id: string; package: string; available: boolean; target?: string }
  /** The foreground app changed (accessibility window events); "" = the frame itself. */
  | { type: "app-foreground"; id: string; package: string }
  /** §26 a HUMAN tapped the intermission Skip chip — the only path that forwards a skip. */
  | { type: "intermission-skip"; id: string }
  /**
   * §25 media position report (`frame.position`) — feeds the virtual
   * playhead. `duration` null/absent = live stream (the still is simply now).
   */
  | { type: "media-position"; id: string; position: number; duration?: number | null }
  /** §32 what the page says is playing (Media Session + audible element); null = nothing / gone. */
  | { type: "now-playing"; id: string; info: NowPlaying | null }
  /** B-123: the adapter's standing session watch saw the account (or its absence) on the page. */
  | { type: "session"; id: string; state: "signed-in" | "signed-out" }
  /** §26 the page entered/left element fullscreen (the shell auto-grants; presentation keeping reads state from here). */
  | { type: "fullscreen-element"; id: string; contains: boolean }
  /**
   * §30 a popup child surface opened/closed under `opener` (its own id is
   * `<opener>#popup-N`; it runs the full engine and reports like any surface).
   */
  | { type: "popup"; id: string; opener: string; url?: string; open: boolean }
  /**
   * The answer to a music action core asked the page for (Quick play cross-service lookup, 2026-09-16):
   * the adapter's musicLookup script posts it through PrismTile.notifyMusicResult with the token core
   * handed it. op "lookup" carries the service's candidates; "add" / "station" carry ok or an error.
   */
  | { type: "music-result"; id: string; token: string; op: "lookup" | "add" | "station" | "tracks" | "queue" | "progress" | "remove" | "episodes" | "episodes-part" | "hover" | "list"; ok: boolean; /** op "progress" (2026-09-18): how far a long answer has got - the wall's status feed says so */ count?: number; total?: number; candidates?: Array<{ id: string; title: string; artist: string; album?: string; url?: string; isrc?: string; durationMs?: number; artwork?: string }>; error?: string };

export interface DisplayDriver {
  setBrightness(value: number): MaybePromise<void>;
  setPower(state: "sleep" | "wake"): MaybePromise<void>;
}

/** A paired physical remote as the shell sees it (§11). */
export interface RemoteDeviceInfo {
  /** Stable slug used as the `device:` key in input maps. */
  device: string;
  name: string;
  connected: boolean;
  /** 0–100 where the HID battery service reports it; null otherwise. */
  battery: number | null;
}

export interface InputDriver {
  /** Shell-owned BT pairing UI hooks (§11); core only requests them. */
  startPairing?(): MaybePromise<void>;
  /** Paired HID remotes — surfaced in edit mode with battery where reported. */
  listRemotes?(): MaybePromise<RemoteDeviceInfo[]>;
}

/** Raw input event pushed from shell into core (§7 input mapping). */
export interface InputEvent {
  key: string;
  /** Named device for per-device overrides (§11); undefined = any. */
  device?: string;
}

/** An installed, launchable app as the shell sees it (§12). */
export interface AppInfo {
  package: string;
  label: string;
}

export interface MediaDriver {
  /** Launch tiles (§12) — Android TV intent or stick deep link. */
  launch(pkg: string, deepLink?: string): MaybePromise<void>;
  /** Installed launchable apps for the remote's "open" sheet (§12); absent = none. */
  listApps?(): MaybePromise<AppInfo[]>;
  /**
   * §26 pass-through for native apps: perform a click on the observed skip
   * node (`target`) in `package`. Called ONLY on a human's activation.
   * Returns false when the node is gone or the shell has no observer.
   */
  appSkip?(pkg: string, target: string): MaybePromise<boolean>;
  /**
   * §7 for native apps: put HUMAN-typed text into the field focused in the
   * foreground app (sign-ins, searches) via the accessibility observer.
   * False when nothing editable is focused.
   */
  appType?(pkg: string, text: string): MaybePromise<boolean>;
  /** Forward a HUMAN Back press to the foreground app (accessibility global action). */
  appBack?(pkg: string): MaybePromise<boolean>;
  /**
   * §14 frame speakers while someone listens privately. Optional: without
   * it core mutes/unmutes every surface instead (duck degrades to mute).
   */
  setSpeakers?(mode: "normal" | "mute" | "duck"): MaybePromise<void>;
  /**
   * §14 dual transport: which outputs this shell can serve from its one
   * capture mix. Absent/empty = private listening unsupported here.
   */
  audioTransports?(): MaybePromise<Array<"webrtc" | "http">>;
  /** Start/stop serving the capture mix over a transport (both feed from one capture). */
  serveAudio?(transport: "webrtc" | "http", enable: boolean): MaybePromise<void>;
  /** Path of the HTTP stream the remote's <audio> plays (e.g. "/audio/stream"). */
  audioStreamPath?(): string;
  /**
   * §14 WebRTC transport, signaled through the remote API. The shell owns
   * the peer connection and feeds it from the same capture mix; core only
   * relays SDP/ICE for listeners it has admitted on `webrtc`.
   */
  webrtcOffer?(listener: string, offerSdp: string): MaybePromise<string>;
  webrtcIce?(listener: string, candidate: string): MaybePromise<void>;
  webrtcClose?(listener: string): MaybePromise<void>;
}

/**
 * §28 updates. The shell fetches exactly the URL core hands it — no query
 * string, no identifiers in headers — and applies signed releases (device-
 * owner APK install on Android; A/B image with rollback on PrismOS).
 */
export interface UpdateDriver {
  fetchManifest(url: string): MaybePromise<string>;
  apply(release: { version: string; url?: string; sha256?: string }): MaybePromise<"applied" | "staged" | "failed">;
}

export interface NetDriver {
  /**
   * §5 list sync: fetch exactly this URL — no query string, no identifying
   * headers. Core only ever passes static list URLs.
   */
  fetchStatic?(url: string): MaybePromise<string>;
  /**
   * §4a lenses (2026-09-20): the person's OWN keyed call to a source they chose (TMDB under their key) - the address and
   * the headers exactly as core built them, on the device, routed through nobody (§22). The shell never logs the headers.
   * Absent on a shell without it: core then makes no keyed call at all.
   */
  fetchKeyed?(url: string, headers: Record<string, string>): MaybePromise<string>;
  /**
   * §5 install a synced host set for a named source at the network layer.
   * Empty = source disabled. The shell's blocked-request log names `name`.
   */
  applyBlockHosts?(sourceId: string, name: string, hosts: string[]): MaybePromise<void>;
  /** §21 device-level WireGuard: always-on + lockdown, LAN exempted by explicit rule. */
  configureVpn?(wireguardConf: string): MaybePromise<void>;
  clearVpn?(): MaybePromise<void>;
  vpnStatus?(): MaybePromise<"up" | "down" | "unconfigured">;
  /**
   * §19: transmit one user-approved compatibility report to the configured
   * (public) destination. Self-hosted builds ship with no destination —
   * absence of this hook means reports are simply never transmitted.
   */
  submitCompatReport?(reportJson: string): MaybePromise<void>;
}

/** Key-value persistence + snapshot store. Storage guarantees are §10. */
export interface StoreDriver {
  get(key: string): MaybePromise<string | null>;
  set(key: string, value: string): MaybePromise<void>;
}

/** §24 alarm tone — a bundled or system-default sound, always local. */
export interface AlarmDriver {
  setTone(playing: boolean): MaybePromise<void>;
}

export interface Drivers {
  surface: SurfaceDriver;
  display?: DisplayDriver;
  input?: InputDriver;
  media?: MediaDriver;
  net?: NetDriver;
  store?: StoreDriver;
  alarm?: AlarmDriver;
  update?: UpdateDriver;
  ui?: UiDriver;
}
