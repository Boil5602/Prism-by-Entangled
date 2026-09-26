/**
 * Surface driver over the Chrome DevTools Protocol (spec §23 — PrismOS /
 * Windows-recipe seam). One Chromium window per tile, one isolated browser
 * context per tile profile (see the §10 note in the README), positioned on
 * a virtual wall anchored at (originX, originY). Transport is the CDP pipe
 * (cdp-pipe.ts) with flat sessions.
 *
 * v0 honesty: freeze/crossfade are no-ops here (windows can't overlay each
 * other's pixels the way the Android snapshot layer does — the Wayland
 * compositor does that on real PrismOS); hidden-until-reveal is approximated
 * by keeping windows minimized until core reveals them.
 */

import type { Rect, SurfaceCreateOptions, SurfaceDriver, SurfaceEvent } from "prism-core";
import type { PipeCdp } from "./cdp-pipe.js";
import type { Browser, BrowserPool } from "./browsers.js";

/** Injected on every new document: PrismTile host shim + media listeners. */
const TILE_SHIM_JS = `
(function () {
  if (window.__prismShim) return;
  window.__prismShim = true;
  var send = function (payload) {
    try { prismNotify(JSON.stringify(payload)); } catch (e) {}
  };
  window.PrismTile = {
    notifyPlayback: function (p) { send({ type: "playback", playing: !!p }); },
    notifyReady: function () { send({ type: "adapter-ready" }); },
    notifyFocusResult: function (f) { send({ type: "focus-result", found: !!f }); },
    notifyAdBreak: function (a) { send({ type: "ad-break", active: !!a }); },
    notifySkipAvailable: function (a, t) { send({ type: "skip-available", available: !!a, target: typeof t === "string" && t ? t : undefined }); },
    notifySkip: function () { send({ type: "intermission-skip" }); },
    notifyPosition: function (p, d) { send({ type: "media-position", position: +p || 0, duration: d > 0 ? +d : null }); },
  };
  document.addEventListener("playing", function () { PrismTile.notifyPlayback(true); }, true);
  document.addEventListener("pause", function () { PrismTile.notifyPlayback(false); }, true);
})();
`.trim();

interface Tile {
  /** The persistent per-profile browser this tile lives in (§10). */
  cdp: PipeCdp;
  targetId: string;
  sessionId: string;
  windowId: number | null;
  rect: Rect | null;
  revealed: boolean;
  opts: SurfaceCreateOptions;
}

function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 14, g: 14, b: 16, a: 1 };
  const v = parseInt(m[1]!, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255, a: 1 };
}

export class CdpSurfaceDriver implements SurfaceDriver {
  private tiles = new Map<string, Tile>();
  private bySession = new Map<string, string>();

  constructor(
    private pool: BrowserPool,
    private origin: { x: number; y: number },
    private events: (event: SurfaceEvent) => void,
    private options: {
      /** §5: the list that blocks a host, or null. */
      blockedBy?: (host: string) => { name: string } | null;
      /** §27: local image URLs for a pack source. */
      packImages?: (source: string) => string[];
      /** §14: start/stop the one capture mix; absent = private listening unsupported. */
      capture?: (enable: boolean) => void;
    } = {},
  ) {
    if (options.capture) {
      // Optional driver method, present only when the daemon has a capture source.
      (this as { captureAudio?: (enable: boolean) => void }).captureAudio = (enable) => options.capture!(enable);
    }
    // Every browser the pool spawns (one per profile) reports into the same
    // event handlers; sessions are unique per browser, so one map suffices.
    pool.onSpawn = (browser: Browser) => this.attachEvents(browser.cdp);
  }

  private attachEvents(cdp: PipeCdp): void {
    // §5 network-level blocking: per-tile `blocking` flag from core; blocked
    // requests get an empty 200 (nothing on the wall changes); the log names
    // the list that decided. Main-frame navigations are never blocked.
    cdp.on("Fetch.requestPaused", (params, sessionId) => {
      const id = sessionId && this.bySession.get(sessionId);
      const requestId = String(params["requestId"]);
      if (!id || !sessionId) return;
      const tile = this.tiles.get(id);
      const req = params["request"] as { url?: string } | undefined;
      let host = "";
      try {
        host = new URL(req?.url ?? "").hostname;
      } catch {
        /* non-URL requests continue */
      }
      const isMain = params["resourceType"] === "Document";
      const src = tile?.opts.blocking !== false && !isMain ? this.options.blockedBy?.(host) : null;
      if (src) {
        console.log(`[prism-daemon] blocked ${host} for '${id}' — ${src.name}`);
        void cdp
          .send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [], body: "" }, sessionId)
          .catch(() => {});
      } else {
        void cdp.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
      }
    });
    cdp.on("Runtime.bindingCalled", (params, sessionId) => {
      if (params["name"] !== "prismNotify" || !sessionId) return;
      const id = this.bySession.get(sessionId);
      if (!id) return;
      try {
        const parsed = JSON.parse(String(params["payload"])) as Record<string, unknown>;
        this.events({ ...parsed, id } as SurfaceEvent);
      } catch {
        /* malformed page payloads are ignored */
      }
    });
    cdp.on("Page.loadEventFired", (_params, sessionId) => {
      const id = sessionId && this.bySession.get(sessionId);
      if (id) this.events({ type: "load-finished", id, ok: true });
    });
    cdp.on("Page.lifecycleEvent", (params, sessionId) => {
      if (params["name"] !== "firstContentfulPaint") return;
      const id = sessionId && this.bySession.get(sessionId);
      if (id) this.events({ type: "first-paint", id });
    });
  }

  async create(opts: SurfaceCreateOptions): Promise<void> {
    if (this.tiles.has(opts.id)) return;
    // §10: the tile's profile selects a persistent browser (its own
    // user-data-dir); the tile opens in that browser's default context, so
    // its storage survives restarts. No ephemeral contexts, ever.
    const browser = await this.pool.get(opts.profile);
    const tile: Tile = {
      cdp: browser.cdp,
      targetId: "",
      sessionId: "",
      windowId: null,
      rect: null,
      revealed: false,
      opts,
    };
    this.tiles.set(opts.id, tile);
    await this.attachTarget(opts.id, tile);
  }

  /** Shared by create and §18 resume: new target + session in the tile's browser. */
  private async attachTarget(id: string, tile: Tile): Promise<void> {
    const cdp = tile.cdp;
    const { targetId } = (await cdp.send("Target.createTarget", {
      url: "about:blank",
      newWindow: true,
    })) as { targetId: string };
    tile.targetId = targetId;

    const { sessionId } = (await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId: string };
    tile.sessionId = sessionId;
    this.bySession.set(sessionId, id);

    const s = sessionId;
    await cdp.send("Page.enable", {}, s);
    await cdp.send("Page.setLifecycleEventsEnabled", { enabled: true }, s);
    await cdp.send("Runtime.enable", {}, s);
    await cdp.send("Runtime.addBinding", { name: "prismNotify" }, s);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: TILE_SHIM_JS }, s);
    // §5: only tiles with blocking on pay the interception cost.
    if (tile.opts.blocking !== false && this.options.blockedBy) {
      await cdp
        .send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, s)
        .catch(() => {});
    }
    await cdp.send(
      "Emulation.setDefaultBackgroundColorOverride",
      { color: hexToRgba(tile.opts.background) },
      s,
    );

    const { windowId } = (await cdp.send("Browser.getWindowForTarget", { targetId })) as {
      windowId: number;
    };
    tile.windowId = windowId;
    // Hidden until core reveals (§16 contract, minimized approximation).
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
    tile.revealed = false;
  }

  async destroy(id: string): Promise<void> {
    const tile = this.tiles.get(id);
    if (!tile) return;
    this.tiles.delete(id);
    this.bySession.delete(tile.sessionId);
    if (tile.targetId) {
      await tile.cdp.send("Target.closeTarget", { targetId: tile.targetId }).catch(() => {});
    }
    // The profile's browser (and its storage) stays — §10.
  }

  async setRect(id: string, rect: Rect): Promise<void> {
    const tile = this.tiles.get(id);
    if (!tile) return;
    tile.rect = rect;
    if (tile.revealed) await this.applyBounds(tile);
  }

  private async applyBounds(tile: Tile): Promise<void> {
    if (tile.windowId === null || !tile.rect) return;
    await tile.cdp
      .send("Browser.setWindowBounds", {
        windowId: tile.windowId,
        bounds: {
          windowState: "normal",
          left: Math.round(this.origin.x + tile.rect.x),
          top: Math.round(this.origin.y + tile.rect.y),
          width: Math.round(tile.rect.w),
          height: Math.round(tile.rect.h),
        },
      })
      .catch(() => {});
  }

  async setOpacity(_id: string, _opacity: number): Promise<void> {
    /* window opacity is compositor territory (PrismOS); no-op in the recipe */
  }

  async setZ(_id: string, _z: number): Promise<void> {
    /* stacking is compositor territory; no-op in the recipe */
  }

  async navigate(id: string, url: string): Promise<void> {
    const tile = this.tiles.get(id);
    if (!tile?.sessionId) return;
    await tile.cdp.send("Page.navigate", { url }, tile.sessionId).catch(() => {});
  }

  async inject(id: string, css: string | null, js: string | null): Promise<void> {
    const tile = this.tiles.get(id);
    if (!tile?.sessionId) return;
    if (css !== null) {
      const wrapped = `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})()`;
      await tile.cdp.send("Runtime.evaluate", { expression: wrapped }, tile.sessionId).catch(() => {});
    }
    if (js !== null) {
      await tile.cdp.send("Runtime.evaluate", { expression: js }, tile.sessionId).catch(() => {});
    }
  }

  /** Read-only evaluate for core's field checks. */
  async evaluate(id: string, js: string): Promise<string | null> {
    const tile = this.tiles.get(id);
    if (!tile?.sessionId) return null;
    try {
      const r = (await tile.cdp.send("Runtime.evaluate", { expression: js, returnByValue: true }, tile.sessionId)) as {
        result?: { value?: unknown };
      };
      return JSON.stringify(r.result?.value ?? null);
    } catch {
      return null;
    }
  }

  async freeze(_id: string): Promise<void> {
    /* §16 snapshot overlay needs a compositor; no-op in the recipe (README) */
  }

  async reveal(id: string, _durationMs: number): Promise<void> {
    const tile = this.tiles.get(id);
    if (!tile) return;
    tile.revealed = true;
    await this.applyBounds(tile);
  }

  /** §18 warm: close the target (renderer gone); context/session storage stays. */
  async suspend(id: string): Promise<void> {
    const tile = this.tiles.get(id);
    if (!tile) return;
    this.bySession.delete(tile.sessionId);
    if (tile.targetId) {
      await tile.cdp.send("Target.closeTarget", { targetId: tile.targetId }).catch(() => {});
    }
    tile.targetId = "";
    tile.sessionId = "";
    tile.windowId = null;
  }

  async resume(id: string): Promise<void> {
    const tile = this.tiles.get(id);
    if (!tile || tile.sessionId) return;
    await this.attachTarget(id, tile);
  }

  async setMuted(id: string, muted: boolean): Promise<void> {
    await this.inject(
      id,
      null,
      `document.querySelectorAll('video,audio').forEach(function(m){m.muted=${muted}})`,
    );
  }

  /**
   * §26 intermission for the recipe: no compositor, so the scenery is an
   * in-page fixed overlay (the ad plays untouched beneath it). Imagery from
   * the local pack when present, a gradient otherwise.
   */
  async showIntermission(id: string, source: string): Promise<void> {
    const images = this.options.packImages?.(source) ?? [];
    const img = images.length ? images[Math.floor(Math.random() * images.length)] : null;
    const bg = img
      ? `background:#0e0e10 url(${JSON.stringify(img)}) center/cover no-repeat;`
      : `background:linear-gradient(135deg,${source.includes("nature") ? "#12241a,#060d08" : "#141b33,#05070f"});`;
    await this.inject(
      id,
      null,
      `(function(){if(document.getElementById('__prismIntermission'))return;` +
        `var v=document.createElement('div');v.id='__prismIntermission';` +
        `v.style.cssText='position:fixed;inset:0;z-index:2147483647;${bg}opacity:0;transition:opacity .4s;';` +
        `var g=document.createElement('span');g.textContent='\\u25D0 intermission';` +
        `g.style.cssText='position:absolute;right:24px;bottom:18px;font:13px system-ui,sans-serif;color:rgba(215,220,227,.4)';` +
        `v.appendChild(g);document.documentElement.appendChild(v);requestAnimationFrame(function(){v.style.opacity='1'});})()`,
    );
  }

  async hideIntermission(id: string): Promise<void> {
    await this.inject(
      id,
      null,
      `(function(){var v=document.getElementById('__prismIntermission');if(!v)return;` +
        `v.style.transition='opacity .2s';v.style.opacity='0';setTimeout(function(){v.remove()},220);})()`,
    );
  }

  /**
   * §26 pass-through: a REAL Skip chip on the scenery. Its click is a human
   * click on our own element, reported as `intermission-skip`; core forwards
   * it to the player's declared control. Nothing here clicks anything.
   */
  async setIntermissionSkip(id: string, available: boolean): Promise<void> {
    await this.inject(
      id,
      null,
      `(function(){var v=document.getElementById('__prismIntermission');` +
        `var c=document.getElementById('__prismSkip');` +
        `if(!${available}){if(c)c.remove();return;}` +
        `if(!v||c)return;c=document.createElement('button');c.id='__prismSkip';c.textContent='Skip  \\u2713';` +
        `c.style.cssText='position:absolute;left:28px;bottom:22px;padding:9px 18px;border:0;border-radius:20px;` +
        `background:#f0a83c;color:#0a0c0f;font:600 15px system-ui,sans-serif;cursor:pointer';` +
        `c.addEventListener('click',function(){try{PrismTile.notifySkip()}catch(e){}});v.appendChild(c);})()`,
    );
  }

  /** §27: local pack imagery, served by the daemon's own HTTP listener. */
  veilImagery(source: string): string[] {
    return this.options.packImages?.(source) ?? [];
  }
}
