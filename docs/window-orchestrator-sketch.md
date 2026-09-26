# Sketch — Window Orchestrator (6 windows, one layout brain)

The extension is the compositor. Each tile is a real browser window (installed-app window preferred, `type:"popup"` fallback). The orchestrator owns *intent*; windows carry *actual*. Every frame it drives actual toward intent — and when a human drags a window out of sync, the drag becomes a new intent instead of a fight.

```mermaid
flowchart LR
  subgraph EXT[Extension background]
    S[Hero solver<br/>(prism-core)] --> L[Layout intent<br/>rects per tile]
    L --> A[Animator<br/>tween actual→intent<br/>~30fps windows.update]
    R[Window registry<br/>tileId ↔ windowId<br/>actual bounds, z, focus] --> A
    E[Events<br/>onBoundsChanged<br/>onFocusChanged<br/>onRemoved] --> P{Reconciler}
    P -- programmatic move --> R
    P -- human drag --> I[Intent editor<br/>promote / pin / release] --> S
    NTP[New-tab dashboard page<br/>metric tiles + hero region] <--> L
  end
  subgraph WIN[Browser windows]
    W1[Netflix app win]
    W2[Hulu app win]
    W3[YouTube win]
    W4[Twitch win]
    W5[Calendar win]
    W6[Cams win]
  end
  A --> W1 & W2 & W3 & W4 & W5 & W6
  W1 & W2 & W3 & W4 & W5 & W6 --> E
  CS[Content scripts in each window<br/>veil · popups · pill] -.-> W1
```

## The three loops

**1. Intent → solver → rects.** Layout state is tiny: `{hero, heroSize, order, pinned[], deviceRect}`. The reference solver (unchanged from the editor) turns it into a rect per tile. Any change to intent re-solves.

**2. Animator (actual → intent).** Per tile, tween current bounds toward target with an ease-out over ~180–250ms, issuing `windows.update({left,top,width,height})` at ~30fps. Batch all six per tick. Mark each issued update with a *nonce* so the reconciler can recognize its own echoes. Animation respects reduced-motion (jump instead of tween).

**3. Reconciler (events → intent or registry).** `windows.onBoundsChanged` fires for *every* move — ours and the human's. Classify:
- Bounds match a pending nonce → programmatic echo → update registry, done.
- Otherwise → **human drag/resize**. Policy (not a fight):
  - **Drag** → the human is expressing intent. Snap the dragged window to the nearest solver slot *and re-solve everything else around it* (drag Netflix to the big region → Netflix becomes hero; drag it to a small slot → it demotes, the previous occupant takes its old spot). The other five animate to their new rects. Feels like rearranging tiles, because it is.
  - **Resize** → adjust `heroSize` if it's the hero; otherwise treat as "pin at this size" (the solver honors pinned rects as fixed constraints and flows the rest).
  - **Close** (`onRemoved`) → tile leaves the layout; re-solve.
  - **Focus** (`onFocusChanged`) → re-assert z-order for the layout (hero above satellites) *only if* the focused window is one of ours; never steal focus from unrelated windows.

Debounce human events (~120ms after the last change) before re-solving so a drag in progress doesn't cause six windows to chase the cursor.

## Sketch of the core loop (TypeScript, prism-core + thin extension glue)

```ts
type Rect = { x: number; y: number; w: number; h: number };
type Intent = { hero: string; heroSize: number; order: string[]; pinned: Record<string, Rect>; screen: Rect };

class Orchestrator {
  registry = new Map<string, { windowId: number; actual: Rect; tweenFrom?: Rect; t0?: number }>();
  intent: Intent;
  pendingNonces = new Map<number, Rect>(); // windowId -> rect we asked for
  target: Record<string, Rect> = {};

  applyIntent() {
    this.target = solveHero(this.intent);        // reference solver, pinned honored
    for (const [id, t] of this.registry) { t.tweenFrom = t.actual; t.t0 = performance.now(); }
    this.tick();
  }

  tick = () => {
    const now = performance.now(); let busy = false;
    for (const [id, t] of this.registry) {
      const to = this.target[id]; if (!to) continue;
      const k = Math.min(1, (now - t.t0!) / 220), e = 1 - Math.pow(1 - k, 3);
      const r = lerpRect(t.tweenFrom!, to, prefersReducedMotion ? 1 : e);
      if (!sameRect(r, t.actual)) {
        this.pendingNonces.set(t.windowId, r);                   // expect an echo
        chrome.windows.update(t.windowId, { left: r.x, top: r.y, width: r.w, height: r.h });
        t.actual = r;
      }
      if (k < 1) busy = true;
    }
    if (busy) setTimeout(this.tick, 33);
  };

  onBoundsChanged(win: chrome.windows.Window) {
    const id = this.tileFor(win.id!); if (!id) return;
    const got = boundsOf(win), expect = this.pendingNonces.get(win.id!);
    if (expect && sameRect(got, expect)) { this.pendingNonces.delete(win.id!); return; } // our echo
    this.registry.get(id)!.actual = got;
    this.humanEdit(id, got);                                     // debounced
  }

  humanEdit = debounce((id: string, got: Rect) => {
    const slot = nearestSlot(got, this.target);                  // which region did they put it in?
    if (slot === this.intent.hero && id !== this.intent.hero) this.intent.hero = id;          // promoted
    else if (sizeChanged(got, this.target[id])) {
      if (id === this.intent.hero) this.intent.heroSize = fractionOf(got, this.intent.screen);
      else this.intent.pinned[id] = got;                         // pin at human size
    } else swapOrder(this.intent, id, slot);                     // moved into another tile's slot
    this.applyIntent();                                          // everyone else animates around it
  }, 120);
}
```

## Notes that keep it honest

- **Own the windows you created only.** The registry is populated by windows the extension opened (or windows the user explicitly "added to the dashboard"). Never touch unrelated windows.
- **Installed-app windows** (Edge "install as app") give chromeless tiles; `type:"popup"` is the fallback with a thin title bar. Both are visible to the windows API.
- **Multi-monitor:** `screen` in intent is a chosen display's work area (`system.display` API); tiles never cross displays unless intent says so.
- **Veil independence:** content scripts inside each window run the §26/§27/§30 engine regardless of orchestration — the layout brain and the veil never need to talk. A Netflix ad break veils inside its tile whether the tile is hero or satellite.
- **Failure mode is calm:** if a window refuses a bounds update (minimized, OS constraint), the animator skips it that tick and the reconciler leaves intent alone; nothing loops or thrashes.
- **Later, the compositor companion** fuses this: hides title bars, draws seams/gaps, and renders the veil OS-level — same intent model, richer hands.
