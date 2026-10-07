/**
 * Remote API (spec §6) — device-local HTTP, core-side brain.
 *
 * The shell owns the socket (a JS runtime can't listen on TCP); core owns
 * everything else: routing, token auth, pairing, and command semantics. The
 * shell forwards each request as a RemoteRequest and writes back whatever
 * RemoteResponse core returns, verbatim.
 *
 * Pairing (§6): each QR render mints a fresh per-phone bearer token so
 * devices can be individually named and revoked. Tokens persist via the
 * Store driver (§10 — never wiped).
 */

import type { StoreDriver } from "./drivers.js";
import { CONTEXT_SHEET_ACTIONS, isPrismRoute, routeForAction, routes, type ContextSheetAction } from "./routes.js";
import { transportAvailability } from "./music-state.js";
import { AGENDA_KEY, CHORES_KEY, applyTilesIntent, normalizeAgenda, normalizeChores } from "./tiles-data.js";
import type { Orchestrator } from "./orchestrator.js";

export interface RemoteRequest {
  method: string;
  /** Path without query string, e.g. "/tiles/yt/command". */
  path: string;
  body: string | null;
  /** Bearer token from `Authorization` or `?token=`; null if absent. */
  token: string | null;
  /** The client's User-Agent, if the shell passes it — names a phone ("iPhone", "Android", "Chrome on Windows"). */
  userAgent?: string | null;
}

export interface RemoteResponse {
  status: number;
  body: string;
  contentType: string;
}

interface PairedDevice {
  token: string;
  name: string;
  created: string;
  /** Day this token last authenticated a request; absent = a QR nobody scanned. */
  lastSeen?: string;
}

/** A human-readable name for the phone behind a User-Agent — never the UA itself. */
export function deviceNameFor(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux PC";
  return null;
}

const TOKENS_KEY = "remote:tokens";

/** §6a parity hooks the runtime supplies: item → model entities, and the shell's UI router. */
export interface RemoteSceneContext {
  itemContext(itemId: string): { facet?: string | null; app?: string | null } | null;
  route(route: string, source: string, id?: string): unknown;
}

const json = (status: number, value: unknown): RemoteResponse => ({
  status,
  body: JSON.stringify(value),
  contentType: "application/json",
});

function randomToken(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class RemoteApi {
  /** §6a parity hooks (runtime-supplied); absent in bare tests → routes still answer, deep links go nowhere. */
  sceneContext: RemoteSceneContext | null = null;
  private devices: PairedDevice[] = [];
  private loaded = false;
  private usedTokens = new Set<string>();
  /** A token's first authenticated use — the shell dismisses its pairing QR. */
  onPaired: ((token: string) => void) | null = null;
  /** The phone's Music tab (2026-10-04): the music sources by name (the runtime knows the Apps) and the play of a listed collection
   *  through the same path the wall's Quick play uses; absent in bare tests. */
  musicQuick: (() => Array<{ tile: string; app: string | null; name: string; session: string | null; active: boolean }>) | null = null;
  playCollection: ((tile: string, kind: string, id: string, order?: string) => void) | null = null;
  /** "Play after this track" (2026-10-04): one queued pick, started when the track playing now ends; read, set, cleared. */
  musicNext: { get: () => unknown; set: (tile: string, kind: string, id: string, order?: string) => { ok: boolean; error?: string; started?: boolean }; clear: () => void } | null = null;
  /** The previous session (2026-10-04, "a temporary restore previous session button"): what played before the last stop, offered while nothing plays. */
  musicRestore: { offer: () => unknown; restore: () => { ok: boolean; error?: string }; dismiss: () => void } | null = null;
  /** The two players as the shell's corner toggle sees them: which exist, which is on (runtime players()); absent in bare tests. */
  players: (() => unknown) | null = null;
  /** The phone's Video tab (2026-10-04, "a full watch (with no video) page for video"): the Watch screen's rows and the big window's
   *  state, and the same plays, tunes, seeks and start-over the PC's own bar makes; absent in bare tests. */
  video: {
    view: () => unknown;
    play: (facet: string, kind: string, id: string, url: string | null, name: string | null) => unknown;
    tune: (facet: string, channel: string, url: string | null, name: string | null) => unknown;
    seek: (tile: string, seconds: number) => string;
    startOver: () => unknown;
    /** More of the Watch screen for the phone (2026-10-05): Search everywhere, the Episodes of the series on screen, the lens rows. */
    search: (q: string) => unknown;
    searchState: () => unknown;
    playResult: (app: string, candidate: unknown) => unknown;
    episodes: () => unknown;
    playEpisode: (id: string) => unknown;
    lenses: () => unknown;
    browsePlay: (app: string, cardId: string) => unknown;
    /** The phone's Live section is a person looking at the live guides (docs/features/live.md: read only while a person has the Live tab
     *  open) - the phone asks for the read as the PC's tab does (2026-10-05, "Why does it say no live channels on any of my services?":
     *  only the PC's Live tab asked, so a phone opened after a restart saw none). */
    liveRead: () => unknown;
    /** The windows a phone can listen to and the choice (2026-10-05). */
    listenWindows: (listener?: string) => unknown;
    listenWindow: (tile: string | null, listener?: string) => Promise<unknown>;
    /** The PC's playback device muted while this phone listens, or not (2026-10-05). */
    privateMute: (on: boolean) => unknown;
    breakWatch: (on: boolean) => unknown;
    /** The service's own subtitle and audio tracks for the phone's Captions sheet, a pick, and the sheet closed (2026-10-05). */
    tracks: (tile: string) => Promise<unknown>;
    track: (tile: string, kind: string, id: string) => Promise<string>;
    tracksDone: (tile: string) => Promise<void>;
  } | null = null;

  constructor(
    private orchestrator: Orchestrator,
    private store?: StoreDriver,
  ) {}

  /** Mint a fresh pairing token and return the URL the QR should encode. */
  async mintPairing(baseUrl: string): Promise<{ url: string; token: string }> {
    await this.ensureLoaded();
    const token = randomToken();
    this.devices.push({
      token,
      name: `Phone ${this.devices.length + 1}`,
      created: new Date().toISOString().slice(0, 10),
    });
    await this.persist();
    return { url: `${baseUrl.replace(/\/$/, "")}/remote?token=${token}`, token };
  }

  async revoke(token: string): Promise<void> {
    await this.ensureLoaded();
    this.devices = this.devices.filter((d) => d.token !== token);
    await this.persist();
  }

  async listDevices(): Promise<Array<Omit<PairedDevice, "token">>> {
    await this.ensureLoaded();
    return this.devices.map(({ name, created, lastSeen }) => ({ name, created, ...(lastSeen ? { lastSeen } : {}) }));
  }

  /**
   * Token → the paired device's human name, for the §14 chips (CS-10.2).
   * The token is the map KEY and never leaves this process: the chip renders
   * the name, and core drops the pairing (`listeningChips`) before anything is
   * shown or logged. Deliberately not exposed over the remote API — /state
   * already carries the chips themselves, without tokens.
   */
  async listenerNames(): Promise<Record<string, string>> {
    await this.ensureLoaded();
    const out: Record<string, string> = {};
    for (const d of this.devices) if (d.name) out[d.token] = d.name;
    return out;
  }

  /** Phones that have actually connected — what "paired" means to a human. */
  async pairedCount(): Promise<number> {
    await this.ensureLoaded();
    return this.devices.filter((d) => d.lastSeen).length;
  }

  /**
   * Drop QR tokens nobody ever scanned (every boot used to mint one), keeping
   * the newest so a code still on screen keeps working. Used tokens are never
   * touched here — forgetting a phone is that phone's DELETE /pairing.
   */
  async pruneUnused(): Promise<number> {
    await this.ensureLoaded();
    const unused = this.devices.filter((d) => !d.lastSeen);
    if (unused.length <= 1) return 0;
    const keep = unused[unused.length - 1]!;
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.lastSeen || d === keep);
    await this.persist();
    return before - this.devices.length;
  }

  /* ------------------- §14 stream tickets (not pairing tokens) ------------------ */

  private streamTickets = new Map<string, { listener: string; expires: number }>();
  private static readonly STREAM_TICKET_TTL_MS = 60_000;

  private mintStreamTicket(listener: string): { value: string; expires: number } {
    const now = Date.now();
    for (const [t, v] of this.streamTickets) if (v.expires <= now) this.streamTickets.delete(t);
    const value = randomToken();
    const expires = now + RemoteApi.STREAM_TICKET_TTL_MS;
    this.streamTickets.set(value, { listener, expires });
    return { value, expires };
  }

  /**
   * Shells serving GET /audio/stream call this with the `ticket` query
   * value. Returns the listener's pairing token (their listener id) or
   * null. Tickets stay valid for reconnects within the TTL — an HLS player
   * fetches many segments — and never grant anything but the stream.
   */
  redeemStreamTicket(ticket: string | null): string | null {
    if (!ticket) return null;
    const v = this.streamTickets.get(ticket);
    if (!v || v.expires <= Date.now()) {
      this.streamTickets.delete(ticket);
      return null;
    }
    return v.listener;
  }

  async handle(req: RemoteRequest): Promise<RemoteResponse> {
    await this.ensureLoaded();
    // The stream path is the shell's (bytes); it authenticates by ticket
    // only. A pairing token here is a bug in the client — refuse loudly.
    if (req.path === "/audio/stream" || req.path === "/audio/live.mp3") {
      return json(400, { error: "GET " + req.path + " is served by the shell and takes ?ticket= from POST /audio/stream-ticket, never a pairing token" });
    }
    if (!req.token || !this.devices.some((d) => d.token === req.token)) {
      return json(401, { error: "invalid or missing token, so pair again with Prism's QR code" });
    }
    // First authenticated use of a token = the phone is paired: the shell
    // can take the QR down without anyone touching the TV remote.
    if (!this.usedTokens.has(req.token)) {
      this.usedTokens.add(req.token);
      this.onPaired?.(req.token);
    }
    // A real phone: remember the day and give it a name the menu can show.
    {
      const dev = this.devices.find((d) => d.token === req.token)!;
      const today = new Date().toISOString().slice(0, 10);
      const name = deviceNameFor(req.userAgent);
      if (dev.lastSeen !== today || (name && /^Phone \d+$/.test(dev.name))) {
        dev.lastSeen = today;
        if (name && /^Phone \d+$/.test(dev.name)) dev.name = name;
        await this.persist();
      }
    }

    const parts = req.path.replace(/\/+$/, "").split("/").filter(Boolean);

    // GET /state
    if (req.method === "GET" && req.path === "/state") {
      const state = this.orchestrator.getState();
      return state ? json(200, state) : json(503, { error: "no dashboard loaded" });
    }

    // DELETE /pairing — this phone forgets this frame: revoke its own token (§6).
    if (req.method === "DELETE" && req.path === "/pairing") {
      await this.revoke(req.token);
      return json(200, { ok: true });
    }

    // GET /rects — conformance hook (§23): solved gap-free partition rects.
    if (req.method === "GET" && req.path === "/rects") {
      return json(200, {
        viewport: this.orchestrator.getViewport(),
        rects: this.orchestrator.rects(),
      });
    }

    // POST /tiles/{id}/command  {"cmd": "..."}
    if (req.method === "POST" && parts.length === 3 && parts[0] === "tiles" && parts[2] === "command") {
      const cmd = this.parseBody(req.body)?.["cmd"];
      if (typeof cmd !== "string") return json(400, { error: "body must be {\"cmd\": \"...\"}" });
      const result = await this.orchestrator.tileCommand(parts[1]!, cmd);
      if (result === "ok") return json(200, { ok: true });
      if (result === "unknown-tile") return json(404, { error: `no tile '${parts[1]}'` });
      if (result === "unavailable") return json(409, { error: "the player's skip control is not available right now" });
      return json(400, { error: `unsupported cmd '${cmd}'` });
    }

    // PUT /tiles/{id}/mode {"mode": "web"|"native"} — opt into the native app (default web).
    if (req.method === "PUT" && parts.length === 3 && parts[0] === "tiles" && parts[2] === "mode") {
      const mode = this.parseBody(req.body)?.["mode"];
      if (mode !== "web" && mode !== "native") return json(400, { error: 'body must be {"mode": "web"|"native"}' });
      const r = await this.orchestrator.setTileMode(parts[1]!, mode);
      if (r === "ok") return json(200, { ok: true });
      if (r === "unknown-tile") return json(404, { error: `no tile '${parts[1]}'` });
      return json(409, { error: "this tile has only one form (needs both url and launch)" });
    }

    // §7 page input from the phone: POST /tiles/{id}/enter, POST /input/leave,
    // POST /tiles/{id}/key {"key"}, POST /tiles/{id}/type {"text"}
    if (req.method === "POST" && parts.length === 3 && parts[0] === "tiles" && parts[2] === "enter") {
      return (await this.orchestrator.enterTile(parts[1]!)) ? json(200, { ok: true }) : json(409, { error: "not a web tile" });
    }
    if (req.method === "POST" && req.path === "/input/leave") {
      await this.orchestrator.leaveTile();
      return json(200, { ok: true });
    }
    if (req.method === "POST" && parts.length === 3 && parts[0] === "tiles" && parts[2] === "key") {
      const key = this.parseBody(req.body)?.["key"];
      if (typeof key !== "string" || !key) return json(400, { error: 'body must be {"key": "DPAD_DOWN"|"ENTER"|...}' });
      return (await this.orchestrator.sendKeyToTile(parts[1]!, key)) ? json(200, { ok: true }) : json(501, { error: "this shell cannot forward keys" });
    }
    if (req.method === "POST" && parts.length === 3 && parts[0] === "tiles" && parts[2] === "type") {
      const body = this.parseBody(req.body);
      const text = body?.["text"];
      if (typeof text !== "string") return json(400, { error: 'body must be {"text": "...", "field"?: "email"|"password"|"any"}' });
      const field = body?.["field"];
      const f = field === "email" || field === "password" || field === "code" ? field : "any";
      const submit = body?.["submit"] === true;
      if (text === "" && f === "any") return json(400, { error: "empty text clears a field only with \"field\": \"email\"|\"password\"" });
      const r = await this.orchestrator.typeIntoTile(parts[1]!, text, f, submit);
      if (r === "ok") return json(200, { ok: true });
      if (r === "unsupported") return json(501, { error: "this shell cannot type into pages" });
      // No field: tell the phone what the page IS showing so the human can
      // press through a consent gate or open the form.
      const buttons = await this.orchestrator.visibleButtons(parts[1]!);
      return json(409, { error: `no ${f} field appeared on the page. Is it still loading, or on a different step?`, buttons });
    }
    // GET /tiles/{id}/fields — which sign-in fields the page shows now; read-only.
    if (req.method === "GET" && parts.length === 3 && parts[0] === "tiles" && parts[2] === "fields") {
      return json(200, await this.orchestrator.visibleFields(parts[1]!));
    }
    // GET /tiles/{id}/buttons — what the page is showing (consent first); read-only.
    if (req.method === "GET" && parts.length === 3 && parts[0] === "tiles" && parts[2] === "buttons") {
      return json(200, { buttons: await this.orchestrator.visibleButtons(parts[1]!) });
    }
    // POST /tiles/{id}/press {"label": "Agree"} — the human tapped a page button on the phone.
    if (req.method === "POST" && parts.length === 3 && parts[0] === "tiles" && parts[2] === "press") {
      const label = this.parseBody(req.body)?.["label"];
      if (typeof label !== "string" || !label.trim()) return json(400, { error: 'body must be {"label": "..."}' });
      const r = await this.orchestrator.pressButton(parts[1]!, label);
      if (r === "ok") return json(200, { ok: true });
      if (r === "unsupported") return json(501, { error: "this shell cannot press page buttons" });
      return json(409, { error: `no visible "${label}" button on the page`, buttons: await this.orchestrator.visibleButtons(parts[1]!) });
    }

    // POST /navigate {"tile": "yt", "url": "https://..."} (§6)
    if (req.method === "POST" && req.path === "/navigate") {
      const body = this.parseBody(req.body);
      if (!body || typeof body["tile"] !== "string" || typeof body["url"] !== "string") {
        return json(400, { error: 'body must be {"tile": "...", "url": "https://..."}' });
      }
      const result = await this.orchestrator.navigateTile(body["tile"], body["url"]);
      if (result === "ok") return json(200, { ok: true });
      if (result === "unknown-tile") return json(404, { error: `no tile '${body["tile"]}'` });
      if (result === "not-web") return json(409, { error: "that tile is a launch tile, so it has no page to navigate" });
      return json(400, { error: "url must be http(s)" });
    }

    // §7 native: POST /apps/type {"text"} into the foreground app's focused field; POST /apps/back
    // the phone keyboard (2026-10-03): text and keys into whatever has focus on the wall - the sign-in window when one is up, else the
    // screen; nothing kept, nothing logged (the body never reaches a log)
    // what the phone is typing into: the focused field's own label, its kind, its length (never its contents), the page's name
    if (req.method === "GET" && req.path === "/keyboard/target") {
      const f = await this.orchestrator.keyboardFocus();
      return json(200, f ?? { target: null, editable: false });
    }
    if (req.method === "POST" && req.path === "/keyboard/type") {
      const body = this.parseBody(req.body);
      const text = body?.["text"];
      if (typeof text !== "string" || !text) return json(400, { error: 'body must be {"text": "...", "submit"?: true}' });
      const target = this.orchestrator.keyboardTarget();
      if (!target) return json(409, { error: "nothing on the wall takes typing right now" });
      if (!await this.orchestrator.typeIntoSurface(target, text)) return json(501, { error: "this shell cannot type into pages" });
      if (body?.["submit"] === true) await this.orchestrator.sendKeyToSurface(target, "ENTER");
      return json(200, { ok: true, into: target });
    }
    if (req.method === "POST" && req.path === "/keyboard/key") {
      const key = this.parseBody(req.body)?.["key"];
      if (typeof key !== "string" || !key) return json(400, { error: 'body must be {"key": "ENTER"|"BACKSPACE"|"TAB"|"ESCAPE"|"DPAD_UP"|...}' });
      const target = this.orchestrator.keyboardTarget();
      if (!target) return json(409, { error: "nothing on the wall takes keys right now" });
      return (await this.orchestrator.sendKeyToSurface(target, key)) ? json(200, { ok: true, into: target }) : json(501, { error: "this shell cannot forward keys" });
    }
    if (req.method === "POST" && req.path === "/apps/type") {
      const text = this.parseBody(req.body)?.["text"];
      if (typeof text !== "string" || !text) return json(400, { error: 'body must be {"text": "..."}' });
      const r = await this.orchestrator.typeIntoApp(text);
      if (r === "ok") return json(200, { ok: true });
      if (r === "no-app") return json(409, { error: "no native app is in front" });
      if (r === "no-field") return json(409, { error: "no text field is focused in the app. Move to it with the TV remote first" });
      return json(501, { error: "this frame has no app observer enabled" });
    }
    if (req.method === "POST" && req.path === "/apps/back") {
      const r = await this.orchestrator.backInApp();
      return r === "ok" ? json(200, { ok: true }) : r === "no-app" ? json(409, { error: "no native app is in front" }) : json(501, { error: "no app observer" });
    }

    // §12 apps: GET /apps (installed, launchable), POST /launch {"package", "deepLink"?}
    if (req.method === "GET" && req.path === "/apps") {
      return json(200, { apps: await this.orchestrator.listApps() });
    }
    if (req.method === "POST" && req.path === "/launch") {
      const body = this.parseBody(req.body);
      if (!body || typeof body["package"] !== "string") return json(400, { error: 'body must be {"package": "...", "deepLink"?: "..."}' });
      const ok = await this.orchestrator.launchApp(body["package"], typeof body["deepLink"] === "string" ? body["deepLink"] : undefined);
      return ok ? json(200, { ok: true }) : json(501, { error: "this shell cannot launch apps" });
    }

    // POST /display  {"brightness": 0.5} | {"power": "sleep"|"wake"}
    if (req.method === "POST" && req.path === "/display") {
      const body = this.parseBody(req.body);
      if (!body) return json(400, { error: "invalid JSON body" });
      const ok = await this.orchestrator.displayCommand(body as { brightness?: number; power?: "sleep" | "wake" });
      return ok ? json(200, { ok: true }) : json(501, { error: "no display driver" });
    }

    // PUT /layout/{id} — direct dashboard jump (§6).
    if (req.method === "PUT" && parts.length === 2 && parts[0] === "layout") {
      const ok = await this.orchestrator.switchTo(parts[1]!);
      return ok ? json(200, { ok: true }) : json(404, { error: `unknown dashboard '${parts[1]}'` });
    }

    // §19: pending compatibility-report offers (edit-mode surface) and
    // per-incident decisions. The payload shown IS the payload sent.
    if (req.method === "GET" && req.path === "/compat/pending") {
      return json(200, { pending: await this.orchestrator.pendingReports() });
    }
    if (req.method === "POST" && req.path === "/compat/decide") {
      const body = this.parseBody(req.body);
      if (!body || typeof body["key"] !== "string" || typeof body["send"] !== "boolean") {
        return json(400, { error: 'body must be {"key": "...", "send": true|false}' });
      }
      const sent = await this.orchestrator.decideReport(body["key"], body["send"]);
      return json(200, { sent: sent !== null });
    }

    // POST /alarms/dismiss | /alarms/snooze (§24)
    if (req.method === "POST" && parts.length === 2 && parts[0] === "alarms") {
      if (parts[1] === "dismiss") {
        this.orchestrator.dismissAlarm();
        return json(200, { ok: true });
      }
      if (parts[1] === "snooze") {
        this.orchestrator.snoozeAlarm();
        return json(200, { ok: true });
      }
      return json(404, { error: "alarm routes: dismiss, snooze" });
    }

    // §14 private listening (dual transport): GET /audio/listen,
    // POST /audio/listen {"enable", "mode"?, "transport"?: "webrtc"|"http"},
    // POST /audio/heartbeat, POST /audio/resume, POST /audio/offset {"ms", "transport"?}
    // GET /audio/windows - the windows a phone can listen to in multiview, big first, with what each plays; POST /audio/listen-window {tile|null}
    // - the one the phone hears (null: the big window again). 2026-10-05, "with remote listening, we should allow any 1 (big or mini) window"
    if (req.method === "GET" && req.path === "/audio/windows") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      return json(200, this.video.listenWindows(req.token));   // this phone's own choice among them
    }
    if (req.method === "POST" && req.path === "/audio/listen-window") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const b = this.parseBody(req.body);
      const tile = b?.["tile"];
      if (tile !== null && tile !== undefined && typeof tile !== "string") return json(400, { error: 'body must be {"tile": "<id>" | null}' });
      return json(200, await this.video.listenWindow(typeof tile === "string" ? tile : null, req.token));   // this phone's, not the room's
    }
    // POST /audio/private-mute {on} - the phone's "mute Prism on the PC while this phone listens" (2026-10-05, "no audio is coming through"):
    // the PC's playback device, which the phone's stream ignores. The wall mute below mutes the pages themselves and silences the stream too -
    // it is the person's mute button, never the listening switch.
    if (req.method === "POST" && req.path === "/audio/private-mute") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const b = this.parseBody(req.body);
      const on = b?.["on"];
      if (typeof on !== "boolean") return json(400, { error: 'body must be {"on": true|false}' });
      return json(200, this.video.privateMute(on));
    }
    // POST /audio/wall-mute {on} - the person's mute of everything on the PC (B-175), from the phone (2026-10-05: muted while a phone listens,
    // by the phone's own choice, with the notice and the checkbox there)
    // POST /video/break-watch {on} - the phone's switch for covering YouTube TV's channel breaks (2026-10-07, "we'll have to make this a
    // feature they can shut down")
    if (req.method === "POST" && req.path === "/video/break-watch") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const on = this.parseBody(req.body)?.["on"];
      if (typeof on !== "boolean") return json(400, { error: 'body must be {"on": true|false}' });
      return json(200, this.video.breakWatch(on));
    }
    if (req.method === "POST" && req.path === "/audio/wall-mute") {
      const on = this.parseBody(req.body)?.["on"];
      if (typeof on !== "boolean") return json(400, { error: 'body must be {"on"}' });
      await this.orchestrator.setWallMuted(on);
      return json(200, { ok: true, wallMuted: on });
    }
    if (req.method === "GET" && req.path === "/audio/listen") {
      return json(200, this.orchestrator.listeningStatus());
    }
    if (req.method === "POST" && req.path === "/audio/listen") {
      const body = this.parseBody(req.body);
      if (!body || typeof body["enable"] !== "boolean") {
        return json(400, { error: 'body must be {"enable": true|false, "mode"?: "mute-speakers"|"duck"|"both", "transport"?: "webrtc"|"http"}' });
      }
      const mode = body["mode"];
      if (mode !== undefined && mode !== "mute-speakers" && mode !== "duck" && mode !== "both") {
        return json(400, { error: "mode must be mute-speakers, duck, or both" });
      }
      const transport = body["transport"];
      if (transport !== undefined && transport !== "webrtc" && transport !== "http") {
        return json(400, { error: "transport must be webrtc or http" });
      }
      // The listener is this phone (its token) — two phones leave independently.
      const ok = await this.orchestrator.setListening(req.token, body["enable"], mode as never, transport as never);
      return ok
        ? json(200, this.orchestrator.listeningStatus())
        : json(501, { error: "private listening (or that transport) is not available on this frame" });
    }
    // Stream credential: <audio> cannot send Authorization, so the stream URL
    // carries a SHORT-LIVED ticket scoped to GET /audio/stream — never the
    // pairing token (which would land in access logs). Re-mint on reconnect.
    if (req.method === "POST" && req.path === "/audio/stream-ticket") {
      const ticket = this.mintStreamTicket(req.token);
      return json(200, { ticket: ticket.value, expiresAt: new Date(ticket.expires).toISOString(), path: "/audio/stream" });
    }
    // §14 WebRTC signaling (listener must already be on the webrtc transport):
    // POST /audio/webrtc/offer {"sdp"} → {"sdp"}; POST /audio/webrtc/ice {"candidate"}
    if (req.method === "POST" && req.path === "/audio/webrtc/offer") {
      const sdp = this.parseBody(req.body)?.["sdp"];
      if (typeof sdp !== "string") return json(400, { error: 'body must be {"sdp": "<offer>"}' });
      const answer = await this.orchestrator.webrtcOffer(req.token, sdp);
      return answer === null
        ? json(409, { error: "join on the webrtc transport first (POST /audio/listen), or this frame has no WebRTC sender" })
        : json(200, { sdp: answer });
    }
    if (req.method === "POST" && req.path === "/audio/webrtc/ice") {
      const candidate = this.parseBody(req.body)?.["candidate"];
      if (typeof candidate !== "string") return json(400, { error: 'body must be {"candidate": "<ice candidate json>"}' });
      const ok = await this.orchestrator.webrtcIce(req.token, candidate);
      return ok ? json(200, { ok: true }) : json(409, { error: "no webrtc session for this phone" });
    }
    if (req.method === "POST" && req.path === "/audio/heartbeat") {
      const known = await this.orchestrator.listenerHeartbeat(req.token);
      return known ? json(200, { ok: true }) : json(404, { error: "this phone is not listening" });
    }
    if (req.method === "POST" && req.path === "/audio/resume") {
      await this.orchestrator.resumeSpeakers();
      return json(200, this.orchestrator.listeningStatus());
    }
    if (req.method === "POST" && req.path === "/audio/offset") {
      const body = this.parseBody(req.body);
      if (!body || typeof body["ms"] !== "number") return json(400, { error: 'body must be {"ms": number, "transport"?: "webrtc"|"http"}' });
      const transport = body["transport"];
      if (transport !== undefined && transport !== "webrtc" && transport !== "http") {
        return json(400, { error: "transport must be webrtc or http" });
      }
      return json(200, { avOffsetMs: await this.orchestrator.setAvOffset(body["ms"], transport as never) });
    }

    // §11 remotes: GET /input/devices (paired HID remotes + override slugs),
    // POST /input/pair (shell-owned scan/pair UI)
    if (req.method === "GET" && req.path === "/input/devices") {
      return json(200, { devices: await this.orchestrator.listRemotes() });
    }
    if (req.method === "POST" && req.path === "/input/pair") {
      const ok = await this.orchestrator.startRemotePairing();
      return ok ? json(200, { ok: true }) : json(501, { error: "this shell has no pairing UI" });
    }

    // §5 blocking: GET /blocking, POST /blocking/sync, PUT /blocking/{id}
    // {"enabled": bool}, POST /blocking {"id","name","url",...} (user list),
    // DELETE /blocking/{id}, GET /blocking/why/{host}
    if (req.method === "GET" && req.path === "/blocking") {
      return json(200, { sources: this.orchestrator.blockingStatus() });
    }
    if (req.method === "POST" && req.path === "/blocking/sync") {
      return json(200, { sources: await this.orchestrator.syncBlockLists() });
    }
    if (req.method === "POST" && req.path === "/blocking") {
      const body = this.parseBody(req.body);
      const ok =
        body &&
        typeof body["id"] === "string" &&
        typeof body["name"] === "string" &&
        typeof body["url"] === "string" &&
        (body["format"] === "abp" || body["format"] === "hosts");
      if (!ok) return json(400, { error: 'body must be {"id","name","url","format":"abp"|"hosts","maintainer"?,"license"?}' });
      const added = await this.orchestrator.addBlockList({
        id: body["id"] as string,
        name: body["name"] as string,
        url: body["url"] as string,
        format: body["format"] as "abp" | "hosts",
        maintainer: typeof body["maintainer"] === "string" ? body["maintainer"] : "user-added",
        license: typeof body["license"] === "string" ? body["license"] : "unknown",
      });
      return added ? json(200, { sources: this.orchestrator.blockingStatus() }) : json(400, { error: "url must be a plain https list URL (no query string)" });
    }
    if (parts.length === 3 && parts[0] === "blocking" && parts[1] === "why" && req.method === "GET") {
      return json(200, { host: parts[2], blockedBy: this.orchestrator.blockedBy(parts[2]!) });
    }
    if (parts.length === 2 && parts[0] === "blocking" && req.method === "PUT") {
      const enabled = this.parseBody(req.body)?.["enabled"];
      if (typeof enabled !== "boolean") return json(400, { error: 'body must be {"enabled": true|false}' });
      const ok = await this.orchestrator.setBlockingEnabled(parts[1]!, enabled);
      return ok ? json(200, { sources: this.orchestrator.blockingStatus() }) : json(404, { error: `no list '${parts[1]}'` });
    }
    if (parts.length === 2 && parts[0] === "blocking" && req.method === "DELETE") {
      await this.orchestrator.removeBlockList(parts[1]!);
      return json(200, { sources: this.orchestrator.blockingStatus() });
    }

    // §28 updates: GET /updates, POST /updates/check, PUT /updates/channel
    // {"channel": "stable"|"beta"}, POST /updates/notes/dismiss
    if (req.method === "GET" && req.path === "/updates") {
      return json(200, this.orchestrator.updateStatus());
    }
    if (req.method === "POST" && req.path === "/updates/check") {
      return json(200, await this.orchestrator.checkUpdates());
    }
    if (req.method === "PUT" && req.path === "/updates/channel") {
      const channel = this.parseBody(req.body)?.["channel"];
      if (channel !== "stable" && channel !== "beta") return json(400, { error: "channel must be stable or beta" });
      await this.orchestrator.setUpdateChannel(channel);
      return json(200, this.orchestrator.updateStatus());
    }
    if (req.method === "POST" && req.path === "/updates/notes/dismiss") {
      await this.orchestrator.dismissReleaseNotes();
      return json(200, { ok: true });
    }

    // §21 VPN: GET /vpn, PUT /vpn {"conf": "<wireguard .conf>"}, DELETE /vpn
    if (req.method === "GET" && req.path === "/vpn") {
      return json(200, await this.orchestrator.vpnStatus());
    }
    if (req.method === "PUT" && req.path === "/vpn") {
      const conf = this.parseBody(req.body)?.["conf"];
      if (typeof conf !== "string") return json(400, { error: 'body must be {"conf": "<wireguard .conf>"}' });
      const result = await this.orchestrator.configureVpn(conf);
      if (result === "ok") return json(200, await this.orchestrator.vpnStatus());
      if (result === "invalid") return json(400, { error: "not a valid WireGuard config ([Interface] PrivateKey + [Peer] PublicKey required)" });
      return json(501, { error: "this frame's shell has no VPN driver" });
    }
    if (req.method === "DELETE" && req.path === "/vpn") {
      await this.orchestrator.clearVpn();
      return json(200, await this.orchestrator.vpnStatus());
    }

    // ---- scene-model era (SM-4): §6a quick actions, §32 music, scenes ----

    // GET /music - {sources, reveal, feeds}
    if (req.method === "GET" && req.path === "/music") {
      return json(200, this.orchestrator.musicState());
    }
    // GET /now-playing - the phone's now-playing card: metadata + transport availability per playing/paused source
    if (req.method === "GET" && req.path === "/now-playing") {
      const m = this.orchestrator.musicState();
      // the service's name and the collection it holds (a station, a playlist), for the phone's line under the title (2026-10-04)
      const quick = this.musicQuick?.() ?? [];
      const names = new Map(quick.map((s) => [s.tile, s.name] as const));
      const sessions = new Map(quick.map((s) => [s.tile, s.session] as const));
      const onStage = new Set(quick.filter((s) => s.active).map((s) => s.tile));
      const cards = Object.values(m.sources).map((src) => ({
        tile: src.facet, playbackState: src.playbackState, metadata: src.metadata, position: src.position, duration: src.duration,
        transport: transportAvailability(src),
        service: names.get(src.facet) ?? null,
        session: sessions.get(src.facet) ?? null,
        onStage: onStage.has(src.facet),
        // the collection: the page's own word, else Prism's standing order (a Prism-made queue is a list of songs to the page, which then
        // names no playlist; 2026-10-04, "It still has in order selected but reverse is what is in effect")
        collection: ((c, o) => (c ? { kind: c.kind, id: c.id, label: c.label ?? null } : o ? { kind: o.kind, id: o.id, label: o.name } : null))(this.orchestrator.musicCollectionOf(src.facet), this.orchestrator.musicOrderOf(src.facet)),
        // the track after this one, where the service's player says (Apple Music's queue); null elsewhere
        upNext: ((t) => { const nx = t?.nowPlaying?.context?.next; return nx && nx.title ? { title: nx.title, artist: nx.artist ?? "" } : null; })(this.orchestrator.getState()?.tiles.find((t) => t.id === src.facet)),
        // the order and repeat as the PC's own order menu has them, what this service can do, and a pick on its way (2026-10-04, the phone's order chips)
        order: this.orchestrator.musicOrderOf(src.facet),
        repeat: this.orchestrator.musicRepeatOf(src.facet),
        orderSupport: this.orchestrator.musicOrderSupport(src.facet),
        pending: ((t) => (t?.musicPending ? { kind: t.musicPending.kind, id: t.musicPending.id, name: t.musicPending.name, at: t.musicPending.at, failed: t.musicPending.failed ?? null } : null))(this.orchestrator.getState()?.tiles.find((t) => t.id === src.facet)),
        // the work behind a true shuffle or reverse (reading the track list, queueing), as the PC's own feed says it (2026-10-04, "it doesn't really indicate that processing is occurring")
        work: ((t) => (t?.musicWork ? { what: t.musicWork.what, name: t.musicWork.name, count: t.musicWork.count ?? null, total: t.musicWork.total ?? null, error: t.musicWork.error ?? null } : null))(this.orchestrator.getState()?.tiles.find((t) => t.id === src.facet)),
        ...(m.reveal.facet === src.facet ? { revealed: m.reveal.mode } : {}),
      }));
      // the card is what the PC's stage shows when that source holds anything, else what plays, else what is paused (2026-10-04,
      // "It says Apple Music is on the stage, but the stage says it's Pandora": the two readings now agree)
      // a paused leftover on another service is not the card (2026-10-04, "Why does it say Pandora is playing rn? Should be Apple": after a
      // restart Apple Music's page held nothing and Pandora's had restored its last station, paused); the card is the stage's source, else a
      // source that plays, else nothing - the stage's own name goes with it
      const playing = cards.find((c) => c.onStage && c.playbackState !== "none") ?? cards.find((c) => c.playbackState === "playing") ?? null;
      const stage = cards.find((c) => c.onStage) ?? null;
      return json(200, { now: playing, stage: stage ? { tile: stage.tile, service: stage.service, session: stage.session } : null, sources: cards, wallMuted: this.orchestrator.wallMutedNow, next: this.musicNext?.get() ?? null, restore: this.musicRestore?.offer() ?? null });
    }
    // GET /players - {active: "music"|"video"|null, music: {id,name}|null, video: {id,name}|null}; a switch is POST /ui/route
    // {"route":"prism://player/music"}, which the shell dispatches through its own player switch
    if (req.method === "GET" && req.path === "/players") {
      return json(200, this.players?.() ?? { active: null, music: null, video: null });
    }
    // ---- the phone's Video tab (docs/features/phone.md) ----
    // GET /video - {active, screen, now, continue[], list[], live[], services[]}: what the PC's Watch screen shows, without the picture
    if (req.method === "GET" && req.path === "/video") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      return json(200, this.video.view());
    }
    // POST /video/play {facet, kind, id, url?, name?} - a card, as the Watch screen plays it (the PC switches to the Video player if needed)
    if (req.method === "POST" && req.path === "/video/play") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const b = this.parseBody(req.body);
      const facet = b?.["facet"], kind = b?.["kind"], id = b?.["id"], url = b?.["url"], name = b?.["name"];
      if (typeof facet !== "string" || typeof kind !== "string" || typeof id !== "string") return json(400, { error: 'body must be {"facet","kind","id","url"?,"name"?}' });
      return json(200, this.video.play(facet, kind, id, typeof url === "string" ? url : null, typeof name === "string" ? name : null));
    }
    // POST /video/live-read - the phone's Live section open: the guides read as the PC's Live tab reads them (core's own 15 min cadence)
    if (req.method === "POST" && req.path === "/video/live-read") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      return json(200, this.video.liveRead());
    }
    // POST /video/tune {facet, channel, url?, name?} - a live channel
    if (req.method === "POST" && req.path === "/video/tune") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const b = this.parseBody(req.body);
      const facet = b?.["facet"], channel = b?.["channel"], url = b?.["url"], name = b?.["name"];
      if (typeof facet !== "string" || typeof channel !== "string") return json(400, { error: 'body must be {"facet","channel","url"?,"name"?}' });
      return json(200, this.video.tune(facet, channel, typeof url === "string" ? url : null, typeof name === "string" ? name : null));
    }
    // POST /video/tracks {tile} - the service's own subtitle and audio tracks for the phone's Captions sheet (2026-10-05, "The caption button
    // should open the menu of options and allow selection"); POST /video/track {tile, kind, id} - a pick; POST /video/tracks-done {tile} - the sheet closed
    if (req.method === "POST" && req.path === "/video/tracks") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const b = this.parseBody(req.body);
      const tile = b?.["tile"];
      if (typeof tile !== "string") return json(400, { error: 'body must be {"tile"}' });
      const t = await this.video.tracks(tile) as { subtitles: unknown[]; audio: unknown[] } | null;
      return json(200, t ? { ok: true, subtitles: t.subtitles, audio: t.audio } : { ok: false, error: "The player lists no tracks right now." });
    }
    if (req.method === "POST" && req.path === "/video/track") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const b = this.parseBody(req.body);
      const tile = b?.["tile"], kind = b?.["kind"], id = b?.["id"];
      if (typeof tile !== "string" || typeof kind !== "string" || typeof id !== "string") return json(400, { error: 'body must be {"tile","kind","id"}' });
      const r = await this.video.track(tile, kind, id);
      return r === "ok" ? json(200, { ok: true }) : json(409, { ok: false, error: r === "unavailable" ? "This service lists no tracks Prism can pick" : r });
    }
    if (req.method === "POST" && req.path === "/video/tracks-done") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const b = this.parseBody(req.body);
      const tile = b?.["tile"];
      if (typeof tile !== "string") return json(400, { error: 'body must be {"tile"}' });
      await this.video.tracksDone(tile);
      return json(200, { ok: true });
    }
    // POST /video/seek {tile, seconds} - to a spot; POST /video/start-over - the bar's own rule (previous episode in the first 5 s)
    if (req.method === "POST" && req.path === "/video/seek") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const b = this.parseBody(req.body);
      const tile = b?.["tile"], seconds = b?.["seconds"];
      if (typeof tile !== "string" || typeof seconds !== "number") return json(400, { error: 'body must be {"tile","seconds"}' });
      const r = this.video.seek(tile, seconds);
      return r === "ok" ? json(200, { ok: true }) : json(409, { ok: false, error: r });
    }
    if (req.method === "POST" && req.path === "/video/start-over") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      return json(200, this.video.startOver());
    }
    // ---- more of the Watch screen (2026-10-05, "more of the watch screen items added to the companion app") ----
    // POST /video/search {q} starts Search everywhere (TMDB first, then the services' own pages); GET /video/search reads it as it fills
    if (req.method === "POST" && req.path === "/video/search") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const q = this.parseBody(req.body)?.["q"];
      if (typeof q !== "string" || !q.trim()) return json(400, { error: 'body must be {"q"}' });
      return json(200, this.video.search(q));
    }
    if (req.method === "GET" && req.path === "/video/search") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      return json(200, this.video.searchState() ?? { none: true });
    }
    // POST /video/play-result {app, candidate} - a search result on a service, as the Watch screen plays it
    if (req.method === "POST" && req.path === "/video/play-result") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const b = this.parseBody(req.body);
      const app = b?.["app"], candidate = b?.["candidate"];
      if (typeof app !== "string" || !candidate || typeof candidate !== "object") return json(400, { error: 'body must be {"app","candidate"}' });
      return json(200, this.video.playResult(app, candidate));
    }
    // GET /video/episodes - the series on screen, its seasons and episodes as the service lists them; POST /video/episodes/play {id}
    if (req.method === "GET" && req.path === "/video/episodes") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      return json(200, this.video.episodes());
    }
    if (req.method === "POST" && req.path === "/video/episodes/play") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const id = this.parseBody(req.body)?.["id"];
      if (typeof id !== "string") return json(400, { error: 'body must be {"id"}' });
      return json(200, this.video.playEpisode(id));
    }
    // GET /video/lenses - the Watch screen's lens rows (New episodes this week, Released this month, Most read, The Binge ...) as poster rows
    if (req.method === "GET" && req.path === "/video/lenses") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      return json(200, this.video.lenses());
    }
    // POST /video/browse-play {app, card} - a catalog card (TMDB's title) on a service, through the service's own search
    if (req.method === "POST" && req.path === "/video/browse-play") {
      if (!this.video) return json(501, { error: "this shell has no Video player" });
      const b = this.parseBody(req.body);
      const app = b?.["app"], card = b?.["card"];
      if (typeof app !== "string" || typeof card !== "string") return json(400, { error: 'body must be {"app","card"}' });
      return json(200, this.video.browsePlay(app, card));
    }
    // GET /music/quick - the phone's Quick play (2026-10-04, "access the quickplay menu on the phone companion web app"): each music
    // source with its name, session and whether it is on the stage, its playlists and stations as the service listed them
    if (req.method === "GET" && req.path === "/music/quick") {
      const sources = this.musicQuick?.() ?? [];
      const m = this.orchestrator.musicState();
      const out = sources.map((s) => {
        const lib = this.orchestrator.musicLibraryNow(s.tile);
        const src = m.sources[s.tile];
        return { ...s, playbackState: src?.playbackState ?? null, playlists: lib.playlists.map((p) => ({ id: p.id, name: p.name })), stations: lib.stations.map((p) => ({ id: p.id, name: p.name })) };
      });
      return json(200, { sources: out });
    }
    // POST /music/play {tile, kind, id, order?} - a listed collection, as the wall's Quick play plays it
    if (req.method === "POST" && req.path === "/music/play") {
      const b = this.parseBody(req.body);
      const tile = b?.["tile"], kind = b?.["kind"], id = b?.["id"], order = b?.["order"], when = b?.["when"];
      if (typeof tile !== "string" || typeof kind !== "string" || typeof id !== "string") return json(400, { error: 'body must be {"tile","kind","id","order"?,"when"?:"now"|"next"}' });
      if (when === "next") {
        if (!this.musicNext) return json(501, { error: "this shell cannot queue a collection" });
        const r = this.musicNext.set(tile, kind, id, typeof order === "string" ? order : undefined);
        return r.ok ? json(200, r) : json(409, r);
      }
      if (!this.playCollection) return json(501, { error: "this shell cannot play collections from the phone" });
      this.playCollection(tile, kind, id, typeof order === "string" ? order : undefined);
      return json(200, { ok: true });
    }
    // POST /music/restore - the previous session back: its collection in its order, the track and the spot for a playlist; DELETE dismisses the offer
    if (req.method === "POST" && req.path === "/music/restore") {
      if (!this.musicRestore) return json(501, { error: "this shell cannot restore a session" });
      const r = this.musicRestore.restore();
      return r.ok ? json(200, r) : json(409, r);
    }
    if (req.method === "DELETE" && req.path === "/music/restore") { this.musicRestore?.dismiss(); return json(200, { ok: true }); }
    // DELETE /music/next - the queued pick dropped
    if (req.method === "DELETE" && req.path === "/music/next") { this.musicNext?.clear(); return json(200, { ok: true }); }
    // POST /music/repeat {tile, on} - the standing repeat beside the order (2026-09-18), from the phone
    if (req.method === "POST" && req.path === "/music/repeat") {
      const b = this.parseBody(req.body);
      const tile = b?.["tile"], on = b?.["on"];
      if (typeof tile !== "string" || typeof on !== "boolean") return json(400, { error: 'body must be {"tile","on"}' });
      await this.orchestrator.setMusicRepeat(tile, on);
      return json(200, { ok: true, repeat: on });
    }
    // POST /music/collapse · POST /music/{id}/reveal {"mode":"panel"|"hero"} (§32 reveal is transient)
    if (req.method === "POST" && req.path === "/music/collapse") {
      return json(200, { ok: true, result: await this.orchestrator.collapseMusic() });
    }
    if (req.method === "POST" && parts.length === 3 && parts[0] === "music" && parts[2] === "reveal") {
      const mode = this.parseBody(req.body)?.["mode"] === "hero" ? "hero" : "panel";
      const r = await this.orchestrator.revealMusic(parts[1]!, mode);
      if (r === "ok") return json(200, { ok: true, mode });
      if (r === "unknown") return json(404, { error: `'${parts[1]}' is not a hidden music facet or a visualization of the scene` });
      return json(501, { error: "this shell has no presence surface op" });
    }
    // POST /items/{id}/tap - single tap: music/visualization → reveal, video → promote (fullscreen presentation)
    if (req.method === "POST" && parts.length === 3 && parts[0] === "items" && parts[2] === "tap") {
      const id = parts[1]!;
      const st = this.orchestrator.getState();
      const tile = st?.tiles.find((t) => t.id === id);
      if (!tile) return json(404, { error: `no item '${id}'` });
      if (tile.visualization || (tile.kind === "floating" && tile.float?.hidden)) {
        const r = await this.orchestrator.revealMusic(id, "panel");
        return r === "ok" ? json(200, { ok: true, did: "reveal" }) : json(409, { error: "reveal " + r });
      }
      // concept-scenes §5: the placement's tapAction decides — promote (§6a,
      // the default), audio (the sound moves here), or both. Same meaning as
      // a tap on the wall; the remote is not a second path.
      const r = await this.orchestrator.tapItem(id);
      return r.ok
        ? json(200, { ok: true, did: r.did, ...(r.audio ? { audio: r.audio } : {}) })
        : json(409, { error: `${r.action} ${r.error ?? "failed"}` });
    }
    // POST /items/{id}/sheet - the context sheet (what a long-press / remote-hold opens)
    if (req.method === "POST" && parts.length === 3 && parts[0] === "items" && parts[2] === "sheet") {
      const id = parts[1]!;
      if (!this.orchestrator.getState()?.tiles.some((t) => t.id === id)) return json(404, { error: `no item '${id}'` });
      await this.sceneContext?.route(routes.itemSheet(id), "remote", id);
      return json(200, { ok: true, route: routes.itemSheet(id) });
    }
    // POST /items/{id}/action {"action": "open-setup"|"edit-facet"|"app-settings"|"swap-facet"|"mute"}
    if (req.method === "POST" && parts.length === 3 && parts[0] === "items" && parts[2] === "action") {
      const id = parts[1]!;
      if (!this.orchestrator.getState()?.tiles.some((t) => t.id === id)) return json(404, { error: `no item '${id}'` });
      const action = this.parseBody(req.body)?.["action"];
      if (!CONTEXT_SHEET_ACTIONS.includes(action as ContextSheetAction)) return json(400, { error: `action must be one of ${CONTEXT_SHEET_ACTIONS.join(", ")}` });
      if (action === "mute") {
        const r = await this.orchestrator.tileCommand(id, "mute");
        return r === "ok" ? json(200, { ok: true, did: "mute" }) : json(409, { error: "mute " + r });
      }
      const ctx = { item: id, ...(this.sceneContext?.itemContext(id) ?? this.orchestrator.itemContext(id) ?? {}) };
      const route = routeForAction(action as ContextSheetAction, ctx);
      if (!route) return json(409, { error: `${action}: this item has no ${action === "edit-facet" ? "facet" : "app"} behind it` });
      await this.sceneContext?.route(route, "remote", id);
      return json(200, { ok: true, route });
    }
    // POST /ui/route {"route": "prism://..."} - any registered deep link (route strings are data; the shell's registry decides)
    if (req.method === "POST" && req.path === "/ui/route") {
      const route = this.parseBody(req.body)?.["route"];
      if (!isPrismRoute(route)) return json(400, { error: "body must be {\"route\": \"prism://...\"}" });
      await this.sceneContext?.route(route, "remote");
      return json(200, { ok: true, route });
    }
    // PUT /scenes/{id} · POST /scenes/next | /scenes/prev (§9 over scenes)
    if (req.method === "PUT" && parts.length === 2 && parts[0] === "scenes") {
      const ok = await this.orchestrator.sceneApply(parts[1]!);
      return ok ? json(200, { ok: true, scene: parts[1] }) : json(404, { error: `no scene '${parts[1]}'` });
    }
    if (req.method === "POST" && parts.length === 2 && parts[0] === "scenes" && (parts[1] === "next" || parts[1] === "prev")) {
      const id = await this.orchestrator.sceneStep(parts[1] === "next" ? 1 : -1);
      return id ? json(200, { scene: id }) : json(409, { error: "fewer than two scenes" });
    }

    // ---- first-party micro-facets (docs/concept-scenes.md §6): the chore list from the shop ----
    // GET /chores · POST /chores {"text","who"?} · POST /chores/{id}/check {"done"} · PUT /chores/notes {"notes"}
    // The phone edits the same document the wall panel does (core owns it,
    // tiles-data.ts); nothing here ever checks an item off by itself.
    if (parts[0] === "chores") {
      if (!this.store) return json(501, { error: "this device has no store, so the household list has nowhere to live" });
      const read = async (): Promise<string | null> => {
        try { return (await this.store!.get(CHORES_KEY)) ?? null; } catch { return null; }
      };
      const commit = async (result: ReturnType<typeof applyTilesIntent>): Promise<RemoteResponse> => {
        if (!result) return json(500, { error: "the household list is not a document core knows" });
        if (!result.ok) return json(result.error?.startsWith("no item") ? 404 : 400, { error: result.error ?? "refused" });
        if (result.changed) await this.store!.set(CHORES_KEY, JSON.stringify(result.doc));
        return json(200, result.doc);
      };
      if (req.method === "GET" && parts.length === 1) {
        return json(200, normalizeChores(await read()));
      }
      if (req.method === "POST" && parts.length === 1) {
        const body = this.parseBody(req.body);
        const text = body?.["text"];
        if (typeof text !== "string" || !text.trim()) return json(400, { error: 'body must be {"text": "milk", "who"?: "Sam"}' });
        const who = typeof body?.["who"] === "string" ? body["who"] : undefined;
        return commit(applyTilesIntent(CHORES_KEY, await read(), { op: "chores.add", text, ...(who ? { who } : {}) }));
      }
      // A human tapped the row on their phone — the same edit as tapping the panel.
      if (req.method === "POST" && parts.length === 3 && parts[2] === "check") {
        const done = this.parseBody(req.body)?.["done"];
        if (typeof done !== "boolean") return json(400, { error: 'body must be {"done": true|false}' });
        return commit(applyTilesIntent(CHORES_KEY, await read(), { op: "chores.check", id: parts[1]!, done }));
      }
      if (req.method === "PUT" && parts.length === 2 && parts[1] === "notes") {
        const notes = this.parseBody(req.body)?.["notes"];
        if (typeof notes !== "string") return json(400, { error: 'body must be {"notes": "..."}' });
        return commit(applyTilesIntent(CHORES_KEY, await read(), { op: "chores.notes", notes }));
      }
      return json(404, { error: "chores routes: GET /chores, POST /chores, POST /chores/{id}/check, PUT /chores/notes" });
    }

    // ---- the agenda facet's week (CS-10.3) ----
    // GET /agenda · PUT /agenda {"events":[...], "weekOf"?:"YYYY-MM-DD"}
    // Same posture as /chores: core owns the document, the wall panel and the
    // phone land on the same functions, and nothing here reaches a calendar
    // service — the week is local data (§19/§22).
    if (parts[0] === "agenda") {
      if (!this.store) return json(501, { error: "this device has no store, so the week has nowhere to live" });
      const read = async (): Promise<string | null> => {
        try { return (await this.store!.get(AGENDA_KEY)) ?? null; } catch { return null; }
      };
      if (req.method === "GET" && parts.length === 1) {
        return json(200, normalizeAgenda(await read()));
      }
      if (req.method === "PUT" && parts.length === 1) {
        const body = this.parseBody(req.body);
        const events = body?.["events"];
        if (!Array.isArray(events)) return json(400, { error: 'body must be {"events": [...], "weekOf"?: "YYYY-MM-DD"}' });
        const weekOf = typeof body?.["weekOf"] === "string" ? body["weekOf"] : undefined;
        const result = applyTilesIntent(AGENDA_KEY, await read(), { op: "agenda.set", events, ...(weekOf ? { weekOf } : {}) });
        if (!result) return json(500, { error: "the week is not a document core knows" });
        if (!result.ok) return json(400, { error: result.error ?? "refused" });
        if (result.changed) await this.store.set(AGENDA_KEY, JSON.stringify(result.doc));
        return json(200, result.doc);
      }
      return json(404, { error: "agenda routes: GET /agenda, PUT /agenda" });
    }

    // POST /carousel/next | /carousel/prev (§9)
    if (req.method === "POST" && parts.length === 2 && parts[0] === "carousel") {
      if (parts[1] !== "next" && parts[1] !== "prev") {
        return json(404, { error: "carousel routes: next, prev" });
      }
      const id = await this.orchestrator.carouselStep(parts[1] === "next" ? 1 : -1);
      return json(200, { dashboard: id ?? this.orchestrator.getState()?.dashboard ?? null });
    }

    return json(404, { error: `no route ${req.method} ${req.path}` });
  }

  private parseBody(body: string | null): Record<string, unknown> | null {
    if (!body) return null;
    try {
      const parsed: unknown = JSON.parse(body);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.store) return;
    try {
      const raw = await this.store.get(TOKENS_KEY);
      if (raw) this.devices = JSON.parse(raw) as PairedDevice[];
    } catch {
      this.devices = [];
    }
  }

  private async persist(): Promise<void> {
    if (this.store) await this.store.set(TOKENS_KEY, JSON.stringify(this.devices));
  }
}
