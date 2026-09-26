/**
 * Private listening (spec §14): the frame's audio streams live to phone
 * remotes, playing through whatever headphones the phone is using.
 *
 * ONE capture mix, TWO outputs (dual transport, negotiated per platform):
 * - `webrtc`: Opus, ~100–250ms — the default where background playback is
 *   reliable. Signaled over the §6 remote socket.
 * - `http`: chunked Opus/AAC or low-latency HLS served by the frame,
 *   ~1–2.5s — the background-proof path (plain <audio> is ordinary media to
 *   the OS). The REMOTE CLIENT selects it (iOS, or when backgrounding is
 *   expected); core only serves what is asked for.
 *
 * Core owns: the listener set (per phone, per transport), speaker policy
 * while anyone listens, a transport-aware A/V offset (auto-measured per
 * transport, user-nudgeable), and PEER-DROP GRACE: when a listener's stream
 * stops unexpectedly, speakers STAY MUTED with a "listening paused on your
 * phone" state, resuming only on explicit action or grace expiry — never
 * blaring mid-movie. The shell owns capture and both transports.
 */

import type { MaybePromise } from "./drivers.js";

export type SpeakerMode = "mute-speakers" | "duck" | "both";
export type ListenTransport = "webrtc" | "http";

export interface ListeningHooks {
  /** Start/stop the single platform capture mix (shell). */
  capture(enable: boolean): MaybePromise<void>;
  /** Start/stop serving the mix over a transport; both feed from one capture. */
  serve(transport: ListenTransport, enable: boolean): MaybePromise<void>;
  /** Frame speakers: "normal" when nobody listens and no grace is pending. */
  speakers(mode: "normal" | "mute" | "duck"): MaybePromise<void>;
  now(): number;
}

export interface ListeningOptions {
  /** Heartbeat interval the remote client is asked to keep. */
  heartbeatMs?: number;
  /** Missed-heartbeat window before a listener counts as dropped. */
  dropAfterMs?: number;
  /** Peer-drop grace: how long speakers stay muted after an unexpected loss. */
  graceMs?: number;
}

export interface ListenerInfo {
  id: string;
  transport: ListenTransport;
  /** "paused" = stream lost unexpectedly; speakers held muted until action or grace expiry. */
  state: "listening" | "paused";
  since: string;
}

export interface ListeningStatus {
  active: boolean;
  listeners: ListenerInfo[];
  mode: SpeakerMode | null;
  /** True while peer-drop grace holds the speakers muted. */
  paused: boolean;
  /** Grace deadline (ISO) while paused. */
  graceUntil: string | null;
  /** Transport-aware video delay for lip-sync, ms; the active one is what tiles get. */
  avOffsetMs: Record<ListenTransport, number>;
  activeTransport: ListenTransport | null;
  /** Transports the shell can serve (both fed by one capture mix). */
  transports: ListenTransport[];
  heartbeatMs: number;
  /** Shell cannot capture at all — the toggle should say so. */
  supported: boolean;
}

/** Nominal per-transport delays, refined by measurement (§14). */
export const DEFAULT_AV_OFFSET_MS: Record<ListenTransport, number> = { webrtc: 150, http: 2_000 };
const MAX_OFFSET_MS = 5_000;

const DEFAULTS: Required<ListeningOptions> = {
  heartbeatMs: 5_000,
  dropAfterMs: 15_000,
  graceMs: 120_000,
};

type Timer = ReturnType<typeof setTimeout>;

interface Listener {
  transport: ListenTransport;
  state: "listening" | "paused";
  since: number;
  lastBeat: number;
}

/**
 * One §14 chip on the wall: a phone that is listening privately, and the slot
 * it is hearing (CS-10.2, 2026-09-03).
 */
export interface ListeningChip {
  /** The listener's pairing token — the chip's identity, never rendered. */
  id: string;
  /** The paired device's human name ("Sam's phone"), or a neutral fallback. */
  label: string;
  /** The slot every private listener hears: the §3 audio owner. Null when nothing owns audio. */
  slot: string | null;
  transport: ListenTransport;
  state: "listening" | "paused";
}

/** What a chip falls back to when the token matches no paired device we still hold. */
export const UNNAMED_LISTENER = "a phone";

/**
 * The §14 chips, composed from state core already has (CS-10.2).
 *
 * **Every listener hears the same thing.** §14 streams THE FRAME's audio — one
 * capture of system output (WASAPI loopback on Windows, the PipeWire monitor on
 * Pi) — so a private listener hears whatever owns audio under §3, and the chips
 * all name that one slot. There is no per-listener source: two phones on two
 * different games would need per-surface capture (the B-25 process-loopback
 * upgrade) and a §14 amendment, and the maintainer's decision of 2026-09-03 was
 * to render what §14 actually supports rather than imply a capability it has
 * not got. The website mockup was redrawn to match.
 *
 * `names` maps a pairing token to the paired device's name — the same
 * human-readable string the pairing flow derived (`deviceNameFor`), never a
 * User-Agent and never an account. A token we no longer hold a device for
 * renders as {@link UNNAMED_LISTENER}: the chip still appears, because someone
 * IS hearing the wall and hiding that would be the dishonest half.
 *
 * A paused listener (peer-drop grace) keeps its chip — the speakers are still
 * held muted on its behalf, so it is exactly when the household most needs to
 * see who is listening.
 */
export function listeningChips(
  status: Pick<ListeningStatus, "listeners">,
  names: Readonly<Record<string, string>> = {},
  audioOwner: string | null = null,
): ListeningChip[] {
  return status.listeners.map((l) => ({
    id: l.id,
    label: (names[l.id] ?? "").trim() || UNNAMED_LISTENER,
    slot: audioOwner,
    transport: l.transport,
    state: l.state,
  }));
}

export class PrivateListening {
  private listeners = new Map<string, Listener>();
  private mode: SpeakerMode | null = null;
  private avOffset: Record<ListenTransport, number> = { ...DEFAULT_AV_OFFSET_MS };
  private serving = new Set<ListenTransport>();
  private capturing = false;
  private graceTimer: Timer | null = null;
  private graceUntil: number | null = null;
  private watchdog: Timer | null = null;
  private readonly opts: Required<ListeningOptions>;

  constructor(
    private hooks: ListeningHooks,
    private transports: ListenTransport[],
    options?: ListeningOptions,
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  get supported(): boolean {
    return this.transports.length > 0;
  }

  /** Shells that learn their capabilities after construction (bridge init options). */
  setTransports(transports: ListenTransport[]): void {
    this.transports = [...transports];
  }

  status(): ListeningStatus {
    const active = [...this.listeners.values()].some((l) => l.state === "listening");
    return {
      active,
      listeners: [...this.listeners.entries()].map(([id, l]) => ({
        id,
        transport: l.transport,
        state: l.state,
        since: new Date(l.since).toISOString(),
      })),
      mode: this.mode,
      paused: this.graceUntil !== null,
      graceUntil: this.graceUntil === null ? null : new Date(this.graceUntil).toISOString(),
      avOffsetMs: { ...this.avOffset },
      activeTransport: this.activeTransport(),
      transports: [...this.transports],
      heartbeatMs: this.opts.heartbeatMs,
      supported: this.supported,
    };
  }

  /** The offset tiles should apply right now: the slowest transport anyone is on. */
  activeOffsetMs(): number {
    const t = this.activeTransport();
    return t ? this.avOffset[t] : 0;
  }

  /**
   * A remote toggles "Listen on this phone". `listener` is the phone's
   * pairing token so two phones join and leave independently. Returns false
   * when the frame cannot capture or the transport is not served here.
   */
  async setListening(
    listener: string,
    enable: boolean,
    mode?: SpeakerMode,
    transport?: ListenTransport,
  ): Promise<boolean> {
    if (!this.supported) return false;
    if (enable) {
      const t = transport ?? this.transports[0]!;
      if (!this.transports.includes(t)) return false;
      const now = this.hooks.now();
      const existing = this.listeners.get(listener);
      this.listeners.set(listener, {
        transport: t,
        state: "listening",
        since: existing?.since ?? now,
        lastBeat: now,
      });
      if (mode) this.mode = mode;
      if (!this.mode) this.mode = "mute-speakers";
      this.clearGrace(); // an explicit (re)join ends any pause
    } else {
      // Explicit leave: this phone's stream ends by choice — no grace for it.
      const gone = this.listeners.get(listener);
      this.listeners.delete(listener);
      if (gone && this.graceUntil !== null && !this.anyPaused()) this.clearGrace();
    }
    await this.reconcile();
    return true;
  }

  /** Remote client keepalive (every `heartbeatMs`). Silently revives a paused listener. */
  async heartbeat(listener: string): Promise<boolean> {
    const l = this.listeners.get(listener);
    if (!l) return false;
    l.lastBeat = this.hooks.now();
    if (l.state === "paused") {
      l.state = "listening";
      if (!this.anyPaused()) this.clearGrace();
      await this.reconcile();
    }
    return true;
  }

  /**
   * The shell noticed a stream end that the listener did not ask for (WebRTC
   * peer gone, HTTP stream closed). Speakers stay muted through grace.
   */
  async onListenerLost(listener: string): Promise<void> {
    const l = this.listeners.get(listener);
    if (!l || l.state === "paused") return;
    l.state = "paused";
    this.armGrace();
    await this.reconcile();
  }

  /** Explicit "resume speakers" from any paired phone: ends grace, drops paused listeners. */
  async resumeSpeakers(): Promise<void> {
    for (const [id, l] of this.listeners) if (l.state === "paused") this.listeners.delete(id);
    this.clearGrace();
    await this.reconcile();
  }

  /** Remote/session/device gone for good — leave cleanly (no grace). */
  async dropListener(listener: string): Promise<void> {
    if (this.listeners.has(listener)) await this.setListening(listener, false);
  }

  /** Per-transport measurement or nudge; clamped. Returns the value stored. */
  setAvOffset(ms: number, transport?: ListenTransport): number {
    const t = transport ?? this.activeTransport() ?? "webrtc";
    if (!Number.isFinite(ms)) return this.avOffset[t];
    this.avOffset[t] = Math.min(MAX_OFFSET_MS, Math.max(0, Math.round(ms)));
    return this.avOffset[t];
  }

  /** Stop everything (shutdown/tests). */
  async stop(): Promise<void> {
    this.listeners.clear();
    this.clearGrace();
    await this.reconcile();
  }

  /* ------------------------------------------------------------------ */

  private activeTransport(): ListenTransport | null {
    let slowest: ListenTransport | null = null;
    for (const l of this.listeners.values()) {
      if (l.state !== "listening") continue;
      if (slowest === null || this.avOffset[l.transport] > this.avOffset[slowest]) slowest = l.transport;
    }
    return slowest;
  }

  private anyPaused(): boolean {
    return [...this.listeners.values()].some((l) => l.state === "paused");
  }

  private armGrace(): void {
    this.graceUntil = this.hooks.now() + this.opts.graceMs;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      void this.resumeSpeakers(); // grace expired: speakers come back, paused phones are gone
    }, this.opts.graceMs);
  }

  private clearGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.graceUntil = null;
  }

  /** Drive capture, both transports, speakers, and the heartbeat watchdog from the listener set. */
  private async reconcile(): Promise<void> {
    const listening = [...this.listeners.values()].filter((l) => l.state === "listening");
    const wantCapture = listening.length > 0;
    const wantServe = new Set(listening.map((l) => l.transport));

    if (wantCapture && !this.capturing) {
      await this.hooks.capture(true);
      this.capturing = true;
    }
    for (const t of this.transports) {
      const want = wantServe.has(t);
      if (want && !this.serving.has(t)) {
        await this.hooks.serve(t, true);
        this.serving.add(t);
      } else if (!want && this.serving.has(t)) {
        await this.hooks.serve(t, false);
        this.serving.delete(t);
      }
    }
    if (!wantCapture && this.capturing) {
      await this.hooks.capture(false);
      this.capturing = false;
    }

    // Speakers: muted while anyone listens OR grace holds; ducking follows mode.
    if (wantCapture) {
      await this.hooks.speakers(this.mode === "duck" ? "duck" : "mute");
    } else if (this.graceUntil !== null) {
      await this.hooks.speakers("mute"); // "listening paused on your phone"
    } else {
      await this.hooks.speakers("normal");
      this.mode = null;
    }

    if (this.listeners.size > 0 && !this.watchdog) {
      this.watchdog = setTimeout(() => {
        this.watchdog = null;
        void this.checkHeartbeats();
      }, this.opts.heartbeatMs);
    } else if (this.listeners.size === 0 && this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private async checkHeartbeats(): Promise<void> {
    const now = this.hooks.now();
    for (const [id, l] of this.listeners) {
      if (l.state === "listening" && now - l.lastBeat > this.opts.dropAfterMs) {
        await this.onListenerLost(id); // missed heartbeats = unexpected loss
      }
    }
    if (this.listeners.size > 0) {
      this.watchdog = setTimeout(() => {
        this.watchdog = null;
        void this.checkHeartbeats();
      }, this.opts.heartbeatMs);
    }
  }
}

/**
 * Page-side lip-sync nudge for a video tile: hold the picture for the
 * stream delay so it lands with the audio the listener hears. This is a
 * media-element API call driven by a human's "listen" action (§14) — not a
 * simulated input (§26). Adapters may override via `window.__prismAvOffset`.
 */
export function avOffsetJs(ms: number): string {
  const delay = Math.min(MAX_OFFSET_MS, Math.max(0, Math.round(ms)));
  return (
    `(function(ms){if(window.__prismAvOffset)return window.__prismAvOffset(ms);` +
    `var m=document.querySelector('video');if(!m||m.paused||!ms)return;` +
    `m.pause();setTimeout(function(){try{m.play();}catch(e){}},ms);})(${delay})`
  );
}
