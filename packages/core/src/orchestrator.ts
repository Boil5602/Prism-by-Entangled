/**
 * The orchestrator — core's runtime brain for one frame (spec §23).
 *
 * Owns dashboard state: which surfaces exist, where they sit, what they show,
 * who is audible. Drives the shell exclusively through the driver seam
 * (drivers.ts); the shell pushes events back in. Kotlin/daemon code decides
 * nothing.
 *
 * v0 scope (build-order step 2 — first dashboard on a real tablet): load a
 * document, create+navigate surfaces, solve and apply layout, live hero
 * resize/promotion with persistence, viewport resize, audio focus. Tile
 * lifecycle (§18), no-white-frame refresh (§16), schedules (§4), and the
 * remote API (§6) layer on next.
 */

import { newEpisodeBadge } from "./menu-order.js";
import { aliasTileKind, parseAspectHint, SCHEMA_VERSION, type AppRecord, type VideoItem, type VideoContext, type DashboardDocument, type FloatSpec, type FocusSpec, type SlotShape, type LayoutSpec, type MasterLayout, type MasterSlot, type NowPlaying, type LibraryItem, type Scene, type SceneSlot, type Shortcut, type TapAction, type TileSpec } from "./types.js";
import { LOOKUP_CHOICES, lookupTerm, matchTrack, normalizeTrackText, type MatchConfidence, type TrackCandidate } from "./music-lookup.js";
import { isPlayOrder, orderTracks, playOrderLabel, type PlayOrder } from "./play-order.js";
import { validRegion } from "./focus.js";
import { clampZoom, hostSlug } from "./catalog.js";
import type { Drivers, SurfaceEvent, InputEvent } from "./drivers.js";
import type { Rect, SolvedRects } from "./solver.js";
import { fillItemAddress, AdapterRegistry, FRAME_PRELUDE_JS, clickControlJs, mediaFallbackJs, type AdapterSpec } from "./adapters.js";
import { cleanCandidates, type LookupState, type LookupServiceState } from "./video-lookup.js";
import { sortCards, releaseOf, type HubSort } from "./hub-sort.js";
import { BROWSE_FULL_PAGES, BROWSE_FULL_SIZE, BROWSE_GENRES, BROWSE_LOOKAHEAD, BROWSE_MAX_PAGES, BROWSE_REGION, BROWSE_ROW_SIZE, browseGenre, browseValue, discoverQuery, discoverTitles, inGenre, mergeDiscover, offerCounts, type BrowseCard, type BrowseGenre, type BrowseOffer, type BrowseTitle, type DiscoverRowId } from "./browse.js";
import { MOST_READ_NAMED_MAX, isScreenDescription, mostReadDays, orderMostRead, readsValue, topListCandidates, type MostReadEntry } from "./most-read.js";
import { creditsAsResults, normSearch, peopleFromSearch } from "./search-view.js";
import { FRESH_EPISODE_DAYS, FRESH_MOVIE_DAYS, dayBefore, freshValue, orderFresh } from "./fresh-rows.js";
import { type BingeCandidate, type BingeThresholds } from "./binge.js";
/** The Binge's candidates (docs/features/the-binge.md): TMDB's details for each series on the household's services; the rule and order are binge.ts's. */
export interface BingeEntry { at: number; done: boolean; cands: BingeCandidate[]; through: string | null }
/** One fresh row as it stands (fresh-rows.ts). */
export interface FreshEntry { at: number; done: boolean; cards: Array<import("./browse.js").BrowseCard & { date: string }>; through: string | null }
import { CATALOG_ATTRIBUTION, atHomeFrom, catalogRows, isCatalogId, offersFromProviders, ownedIsThis, providersOf, titlesFromSearch, type CatalogTitle } from "./catalog-search.js";
import { cleanLibrary, isVideoAdapter } from "./video.js";
import { episodeCount, episodeHealth, fillFromTmdb, type EpisodeHealth } from "./episode-health.js";
import { LENSES, LensResolver, factsFor, lensById, lensDataDate, orderByLens, outboundLinks, ratingLabel, titleKey, type LensDef, type LensedCard, TMDB_ATTRIBUTION } from "./lenses.js";

/** What the menu says about its lens (§4a): the active one with its full disclosure, the choices, the data date, the work in flight. */
export interface LensBlock { active: LensDef | null; lenses: Array<{ id: string; name: string; needsKey: string | null }>; dataDate: string | null; pending: number; tmdbKey: boolean; attribution: string | null }
/** One lens as a row of the menu (2026-09-21): the household's titles in the lens's order, with the lens's own disclosure on the row. */
/** One episode in the Episodes menu: the service's own id and address when the service listed it (null from TMDB's list). */
export interface EpisodeItem { season: number; episode: number; title: string; id: string | null; url: string | null; synopsis: string | null; still: string | null; duration: string | null; airDate?: string | null; /** the episode the account is on, as the service's show page marks it (Netflix's "current") */ resume?: boolean; /** listed by TMDB where the service's own list came back short: shown, not the service's (no id) */ fromTmdb?: boolean }
export interface EpisodesSeason { season: number; label: string; episodes: EpisodeItem[] }
interface EpisodesEntry { at: number; status: "working" | "done" | "failed"; source: "service" | "tmdb"; seasons: EpisodesSeason[]; error?: string | null; /** the series' own name (a kept list read back has only its key) */ series?: string; /** the service's read measured against TMDB's aired episodes */ health?: EpisodeHealth | null; /** the service's own seasons so far, while it reads the rest */ partial?: boolean }
export interface EpisodesView { ready: boolean; series: string | null; service: string | null; current: { season: number; episode: number } | null; seasons: EpisodesSeason[]; canPlay: boolean; source: "service" | "tmdb" | null; error: string | null; /** how Play works: the service's own episode id, or its number pressed in the service's own control (videoEpisodeNumber) */ playBy?: "id" | "number" | null }
/** The service's episode list, as its script answered it, into seasons (a season named "Season 3" or given as 3; "Specials" as season 0). */
export function seasonsFrom(raw: unknown): EpisodesSeason[] {
  if (!Array.isArray(raw)) return [];
  const by = new Map<number, EpisodesSeason>();
  for (const x of raw as Array<Record<string, unknown>>) {
    if (!x || typeof x !== "object") continue;
    const sl = typeof x.season === "number" ? String(x.season) : typeof x.season === "string" ? x.season : "";
    const m = /(\d+)/.exec(sl); const sn = m ? Number(m[1]) : /special/i.test(sl) ? 0 : 1;
    const ep = typeof x.episode === "number" ? x.episode : Number(String(x.episode ?? "").replace(/[^0-9]/g, "")) || 0;
    const id = typeof x.id === "string" || typeof x.id === "number" ? String(x.id) : null;
    const title = typeof x.title === "string" ? x.title.trim() : "";
    if (!id || !title) continue;
    const str = (k: string) => (typeof x[k] === "string" && (x[k] as string).trim() ? (x[k] as string).trim() : null);
    const season = by.get(sn) ?? { season: sn, label: sl && /[a-z]/i.test(sl) ? sl : sn === 0 ? "Specials" : "Season " + sn, episodes: [] };
    if (!season.episodes.some((e) => e.id === id)) season.episodes.push({ season: sn, episode: ep, title, id, url: str("url"), synopsis: str("synopsis")?.slice(0, 600) ?? null, still: str("still"), duration: str("duration"), ...(x.resume === true ? { resume: true } : {}) });
    by.set(sn, season);
  }
  return [...by.values()].sort((a, b) => (a.season === 0 ? 1 : b.season === 0 ? -1 : a.season - b.season)).map((s) => ({ ...s, episodes: s.episodes.sort((a, b) => a.episode - b.episode) }));
}
/** A series' name as a search result or the playing page gives it ("Cover art for The Rookie." - Hulu's alt text), for matching. */
export function seriesKey(s: string): string { return String(s ?? "").replace(/^cover art for\s+/i, "").replace(/\.$/, "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim(); }
/** Which listed episode plays now: the service's own id when it matches, else the season and episode the page names. */
export function currentEpisode(seasons: readonly EpisodesSeason[], v: { id?: string; season?: number | null; episode?: number | null; title?: string }): { season: number; episode: number } | null {
  if (v.id) for (const s of seasons) for (const e of s.episodes) if (e.id === String(v.id)) return { season: s.season, episode: e.episode };
  if (typeof v.season === "number" && typeof v.episode === "number") return { season: v.season, episode: v.episode };
  if (typeof v.episode === "number" && v.title) for (const s of seasons) for (const e of s.episodes) if (e.episode === v.episode && e.title.toLowerCase() === v.title.toLowerCase()) return { season: s.season, episode: e.episode };
  return null;
}

/**
 * The page's largest player un-muted - only when it is muted. The service's OWN Unmute control first (an aria-label starting "Unmute"): a
 * service keeps its mute in its own settings and put it back on the next episode when only the element was un-muted (Peacock's
 * player-volume-settings {muted:true}, 2026-09-23, "my sound seems to be off but no idea why"); the element itself when the page has none.
 */
export const UNMUTE_PLAYER_JS = "(function(){var vs=[].slice.call(document.querySelectorAll('video')),big=null,a=0;vs.forEach(function(v){var r=v.getBoundingClientRect();if(r.width*r.height>a){a=r.width*r.height;big=v;}});if(!big||!(big.muted||big.volume===0))return;var bs=document.querySelectorAll('button,[role=button]');for(var i=0;i<bs.length;i++){if(/^unmute/i.test(bs[i].getAttribute('aria-label')||'')){bs[i].click();break;}}setTimeout(function(){if(big.muted||big.volume===0){big.muted=false;if(big.volume===0)big.volume=1;}},300);})()";
/** Multiview: the windows at most - the big one and four small ones (2026-09-23, "time to add a 4th multiview window (so 1 big and 0-4 multi windows)"). */
/** An adapter field that is a page address (some carry a note in its place). */
function isPageUrl(u: unknown): u is string { return typeof u === "string" && /^https?:\/\//i.test(u); }
export const MV_MAX = 5;
/** A small window's place in multiview: stacked down the right edge of the big window, 16:9, a quarter of its width. Pure. */
export function mvPipRect(base: { x: number; y: number; w: number; h: number }, index: number): { x: number; y: number; w: number; h: number } {
  const margin = Math.round(base.w * 0.012);
  const w = Math.round(base.w * 0.24);
  const h = Math.round(w * 9 / 16);
  const gap = Math.round(margin * 0.8);
  return { x: base.x + base.w - w - margin, y: base.y + margin + index * (h + gap), w, h };
}

type MvRect = { x: number; y: number; w: number; h: number };
/**
 * Multiview's places for a screen slot and its small windows (2026-09-23, "the multiview video windows, #2 is entirely off the screen on
 * my wide screen monitors. Reorganize because I have a lot of black space on my 49" monitors when we go full screen"). Pure.
 * - A slot about 16:9 keeps the small windows over the big one's right edge (mvPipRect), shrunk if the stack would run off the bottom.
 * - A slot much wider than 16:9 (a 32:9 or 21:9 monitor) - where a big window the slot's width is mostly black bars and a quarter-width
 *   stack runs off the bottom - puts the big window at the slot's full height and exactly 16:9 on the left, and the small ones in a grid in
 *   the space to its right: as many columns as make the windows largest, each 16:9, the grid centred in that space.
 */
export function mvLayout(base: MvRect, smalls: number): { hero: MvRect; smalls: MvRect[] } {
  const k = Math.max(0, Math.min(MV_MAX - 1, smalls));
  if (k === 0) return { hero: { ...base }, smalls: [] };
  const heroW = Math.round(base.h * 16 / 9);
  const gap = 8;
  if (base.w / base.h > (16 / 9) * 1.2 && base.w - heroW - gap > base.w * 0.15) {
    const area = { x: base.x + heroW + gap, y: base.y, w: base.w - heroW - gap, h: base.h };
    let best = { c: 1, r: k, w: 0 };
    for (let c = 1; c <= k; c++) {
      const r = Math.ceil(k / c);
      const w = Math.floor(Math.min((area.w - gap * (c - 1)) / c, ((area.h - gap * (r - 1)) / r) * 16 / 9));
      if (w > best.w) best = { c, r, w };
    }
    const w = best.w, h = Math.round(w * 9 / 16);
    const gridW = best.c * w + gap * (best.c - 1), gridH = best.r * h + gap * (best.r - 1);
    const x0 = area.x + Math.round((area.w - gridW) / 2), y0 = area.y + Math.round((area.h - gridH) / 2);
    const out: MvRect[] = [];
    for (let i = 0; i < k; i++) out.push({ x: x0 + (i % best.c) * (w + gap), y: y0 + Math.floor(i / best.c) * (h + gap), w, h });
    return { hero: { x: base.x, y: base.y, w: heroW, h: base.h }, smalls: out };
  }
  const pips = Array.from({ length: k }, (_, i) => mvPipRect(base, i));
  const last = pips[k - 1]!;
  if (last.y + last.h <= base.y + base.h) return { hero: { ...base }, smalls: pips };
  // the stack runs off the bottom (a short, wide slot): each shrinks so the whole stack fits, still down the right edge
  const margin = Math.round(base.w * 0.012), g = Math.round(margin * 0.8);
  const h = Math.floor((base.h - 2 * margin - g * (k - 1)) / k), w = Math.round(h * 16 / 9);
  return { hero: { ...base }, smalls: Array.from({ length: k }, (_, i) => ({ x: base.x + base.w - w - margin, y: base.y + margin + i * (h + g), w, h })) };
}

/** The one lens row on the Watch tab (2026-09-22). */
export const WATCH_LENS = "wiki-reads";

export interface LensRow { id: string; name: string; counted: string; who: string; decides: string; source: string; sourceUrl: string; formula: string; attribution: string | null; dataDate: string | null; cards: LensedCard[] }
import { VIDEO_ONLY_CMDS, VideoController, type VideoTileState } from "./video.js";
import { sessionWatchJs } from "./adapters-facets.js";
import { PresentationKeeperRunner, type ResolvedPresentationAction } from "./adapters-presentation.js";
import { CORRELATION_MS, type KeeperEvent } from "./presentation-keeper.js";
import { AlarmEngine } from "./alarm.js";
import { AudioFocusMachine, type AudioCommand } from "./audio-focus.js";
import { CompatTracker, type CompatContext, type CompatReport, type PendingOffer, type ReportKind } from "./compat.js";
import { CLEAR_FRAMING_JS, focusFramingJs } from "./focus.js";
import { IntermissionController } from "./intermission.js";
import { LifecycleManager } from "./lifecycle.js";
import { nextTileInDirection, overriddenDevices, resolveBinding, type FocusDirection } from "./input.js";
import {
  BlockListManager,
  DEFAULT_BLOCK_SOURCES,
  type BlockSourceSpec,
  type BlockSourceStatus,
} from "./blocking.js";
import {
  PrivateListening,
  listeningChips,
  avOffsetJs,
  type ListenTransport,
  type ListeningChip,
  type ListeningStatus,
  type SpeakerMode,
} from "./listening.js";
import { UpdateChecker, type UpdateChannel, type UpdateConfig, type UpdateStatus } from "./updates.js";
import { VpnManager, type VpnStatus } from "./vpn.js";
import {
  CLEAR_VEIL_JS,
  CosmeticRegistry,
  veilJs,
  type CosmeticSourceInfo,
  type CosmeticSourceSpec,
  type VeilMode,
} from "./veil.js";
import {
  DEFAULT_PREVIEW_BUDGET,
  PeekScheduler,
  REPORT_POSITION_JS,
  VirtualPlayhead,
  seekJs,
  type PreviewBudget,
} from "./preview.js";
import { RefreshEngine, type RefreshEngineOptions } from "./refresh.js";
import { ScheduleEngine, msUntil } from "./schedule.js";
import { MusicStateModel, type MediaSessionEvent, type MusicSourceState, type RevealState, type VisualizationFeed } from "./music-state.js";
import { routes } from "./routes.js";
import { clampHeroSize, insetRects, layoutDashboard, type HeroOverride, type Viewport } from "./layout.js";

/** §16: every surface substrate is dark before first paint — never white. */
/**
 * How long an interaction in a tile keeps that tile armed for §3 human
 * attribution. Generous on purpose: a music service can take ten seconds to get
 * from a play click to a playback report (licence, buffer), and the old
 * seven-second window silently demoted those presses to autoplay.
 */
export const HUMAN_INTENT_MS = 60_000;

export const DEFAULT_BACKGROUND = "#0e0e10";

/** Normalize remote/phone key names to the shell's page-key vocabulary. */
function pageKeyName(key: string): string {
  const k = key.replace(/^KEYCODE_/, "").toUpperCase();
  const map: Record<string, string> = {
    ARROWUP: "DPAD_UP", ARROWDOWN: "DPAD_DOWN", ARROWLEFT: "DPAD_LEFT", ARROWRIGHT: "DPAD_RIGHT",
    UP: "DPAD_UP", DOWN: "DPAD_DOWN", LEFT: "DPAD_LEFT", RIGHT: "DPAD_RIGHT",
    OK: "DPAD_CENTER", SELECT: "DPAD_CENTER", ENTER: "ENTER", " ": "SPACE",
  };
  return map[k] ?? k;
}

/**
 * Page-side helpers for the remote's sign-in flow. Everything here acts only
 * on a HUMAN's explicit request from the phone (Send email / Send password /
 * a button they tapped) — the §26 boundary: forwarded human input, never
 * autonomous. Sites hide their forms in shadow roots (HBO Max) and
 * same-origin iframes (Apple TV's commerce sheet), so lookups walk both.
 */
const DEEP_PRELUDE =
  `function deep(root,fn){var st=[root];while(st.length){var r=st.pop();var all;try{all=r.querySelectorAll('*');}catch(x){continue;}` +
  `for(var i=0;i<all.length;i++){var e=all[i];if(fn(e))return e;if(e.shadowRoot)st.push(e.shadowRoot);` +
  `if(e.tagName==='IFRAME'){try{var d=e.contentDocument;if(d)st.push(d);}catch(x){}}}}return null;}` +
  `function vis(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled;}` +
  // A field under a consent sheet / modal is not usable: whatever is on top at its
  // centre must be the field itself or one of its ancestors/descendants. Off-screen
  // (elementFromPoint null) passes — the caller scrolls it into view first.
  `function uncovered(e){try{var r=e.getBoundingClientRect();var root=e.getRootNode();var doc=(root&&root.elementFromPoint)?root:e.ownerDocument;` +
  `var top=doc.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!top)return true;` +
  `var n=top;while(n){if(n===e)return true;n=n.parentNode||n.host;}n=e;while(n){if(n===top)return true;n=n.parentNode||n.host;}return false;}catch(x){return true;}}` +
  `function target(){var t=deep(document,function(e){return e.hasAttribute&&e.hasAttribute('data-prism-target');});if(t)return t;` +
  `var a=document.activeElement;while(a&&a.shadowRoot&&a.shadowRoot.activeElement)a=a.shadowRoot.activeElement;` +
  `while(a&&a.tagName==='IFRAME'){try{var d=a.contentDocument;if(!d)break;a=d.activeElement;}catch(x){break;}}return a;}` +
  `function label(b){return (b.innerText||b.value||b.getAttribute('aria-label')||'').trim();}`;

type FieldKind = "email" | "password" | "code" | "any";

/** Selector ladders per field kind — best match first, then progressively looser. */
function fieldSelectors(field: FieldKind): string[] {
  if (field === "password") return ["input[type=password]"];
  if (field === "code")
    return [
      "input[autocomplete~=one-time-code]",
      "input[name*=code i],input[id*=code i],input[name*=otp i],input[id*=otp i],input[name*=passcode i]",
      "input[inputmode=numeric],input[type=number],input[type=tel]",
      "input[type=text]:not([name*=mail i]):not([name*=user i])",
    ];
  if (field === "any")
    return [
      "input[type=email],input[autocomplete~=username],input[type=password]",
      "input[type=text],input[type=search],input[type=tel],input[type=url],input:not([type]),textarea,[contenteditable=true]",
    ];
  return [
    "input[type=email]",
    "input[autocomplete~=username],input[autocomplete~=email]",
    "input[name*=mail i],input[name*=user i],input[name*=login i],input[name*=account i],input[id*=mail i]",
    "input[type=text],input[type=tel],input:not([type])",
  ];
}

/** Read-only: which sign-in fields the page is showing right now (usable: visible, not covered). */
function probeFieldsJs(): string {
  // Per kind: 0 absent, 1 shown and empty, 2 shown and already holding text.
  const kinds: FieldKind[] = ["email", "password", "code"];
  const ladders = JSON.stringify(Object.fromEntries(kinds.map((k) => [k, fieldSelectors(k).join(",")])));
  return (
    `(function(){${DEEP_PRELUDE}var L=${ladders};var out={};var found={};` +
    `for(var k in L){var e=deep(document,function(n){return n.matches&&n.matches(L[k])&&vis(n)&&uncovered(n);});found[k]=e;out[k]=e?(String(e.value||'').length?2:1):0;}` +
    `if(found.code&&(found.code===found.email||found.code===found.password))out.code=0;` + // a code needs its own box
    `return JSON.stringify(out);})()`
  );
}

function focusFieldJs(field: FieldKind): string {
  // Best match first, then progressively looser (document order within each).
  // "any" (the phone's free-text box): whatever editable element the page
  // already has focused wins; otherwise the first visible text-like field.
  const sels = fieldSelectors(field);
  const keepActive =
    field === "any"
      ? `var cur=target();if(cur&&cur!==document.body&&vis(cur)&&(cur.tagName==='INPUT'||cur.tagName==='TEXTAREA'||cur.isContentEditable)){cur.setAttribute('data-prism-target','1');return true;}`
      : "";
  return (
    `(function(){${DEEP_PRELUDE}${keepActive}var sels=${JSON.stringify(sels)};` +
    `for(var s=0;s<sels.length;s++){var e=deep(document,function(n){return n.matches&&n.matches(sels[s])&&vis(n)&&uncovered(n);});if(!e)continue;` +
    `var old=deep(document,function(n){return n.hasAttribute&&n.hasAttribute('data-prism-target');});while(old){old.removeAttribute('data-prism-target');old=deep(document,function(n){return n.hasAttribute&&n.hasAttribute('data-prism-target');});}` +
    `e.setAttribute('data-prism-target','1');try{e.scrollIntoView({block:'center',inline:'nearest'});}catch(x){}e.focus();try{e.select&&e.select();}catch(x){}return true;}return false;})()`
  );
}

/**
 * A consent gate (terms / cookies) is a decision only the human may take:
 * while one of these is visible, nothing is typed into the page — the phone
 * is handed the button instead. Labels only; never pressed by core.
 */
function consentGateJs(): string {
  return (
    `(function(){${DEEP_PRELUDE}var re=/^(agree|i agree|accept|accept all|allow all|got it|ok|continue to site)$/i;var out=[];` +
    `deep(document,function(e){if((e.tagName==='BUTTON'||e.tagName==='A'&&e.getAttribute('role')==='button'||e.tagName==='INPUT'&&e.type==='submit')&&vis(e)&&re.test(label(e)))out.push(label(e));return false;});` +
    `return JSON.stringify(out);})()`
  );
}

/** Visible buttons the page is showing — what a human could press when no field is up (consent gates, "Sign In"). */
function visibleButtonsJs(): string {
  return (
    `(function(){${DEEP_PRELUDE}var out=[];deep(document,function(e){if((e.tagName==='BUTTON'||e.tagName==='A'&&e.getAttribute('role')==='button'||e.tagName==='INPUT'&&e.type==='submit')&&vis(e)){var t=label(e);if(t&&t.length<=32&&out.indexOf(t)<0)out.push(t);}return out.length>=8;});return JSON.stringify(out);})()`
  );
}

/** The human tapped this button on their phone: press the page's button with exactly that label (§26: forwarded human input). */
function pressButtonJs(text: string): string {
  return (
    `(function(){${DEEP_PRELUDE}var want=${JSON.stringify(text)}.trim().toLowerCase();` +
    `var b=deep(document,function(e){return (e.tagName==='BUTTON'||e.tagName==='A'||e.tagName==='INPUT'&&e.type==='submit')&&vis(e)&&label(e).toLowerCase()===want;});` +
    `if(!b)return false;try{b.scrollIntoView({block:'center'});}catch(x){}b.focus();b.click();return true;})()`
  );
}

function submitStepJs(): string {
  return (
    `(function(){${DEEP_PRELUDE}var a=target();` +
    `if(a&&a.form&&a.form.requestSubmit){try{a.form.requestSubmit();return 'form';}catch(e){}}` +
    `var re=/^\s*(continue|next|sign in|log in|login|submit|go)\s*$/i;` +
    `var root=(a&&a.getRootNode&&a.getRootNode())||document;` +
    `var b=deep(root,function(e){return (e.tagName==='BUTTON'||e.tagName==='INPUT'&&e.type==='submit'||e.getAttribute&&e.getAttribute('role')==='button')&&re.test(label(e))&&vis(e);})` +
    `||deep(document,function(e){return (e.tagName==='BUTTON'||e.tagName==='INPUT'&&e.type==='submit'||e.getAttribute&&e.getAttribute('role')==='button')&&re.test(label(e))&&vis(e);});` +
    `if(b){b.click();return 'button';}return 'none';})()`
  );
}

/**
 * The text a human sent must be what the field holds before we submit for
 * them: key events are asynchronous and some characters take a different
 * path, so verify and repair (value setter + input/change events).
 */
function ensureValueJs(text: string): string {
  return (
    `(function(t){${DEEP_PRELUDE}var e=target();if(!e||!('value' in e))return 'nofield';` +
    `if(e.maxLength===1)return 'multibox';` + // six one-digit boxes: the keystrokes already advanced through them
    `if(String(e.value).indexOf(t)>=0)return 'ok';` +
    `var proto=Object.getPrototypeOf(e);var d=Object.getOwnPropertyDescriptor(proto,'value')||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');` +
    `try{if(d&&d.set)d.set.call(e,t);else e.value=t;}catch(x){e.value=t;}` +
    `try{e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}catch(x){}` +
    `return 'repaired';})(${JSON.stringify(text)})`
  );
}

/** Blank the marked/active field the way a human clearing it would leave it (input+change fired). */
function clearFieldJs(): string {
  return (
    `(function(){${DEEP_PRELUDE}var e=target();if(!e||!('value' in e))return 'nofield';` +
    `var proto=Object.getPrototypeOf(e);var d=Object.getOwnPropertyDescriptor(proto,'value')||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');` +
    `try{if(d&&d.set)d.set.call(e,'');else e.value='';}catch(x){e.value='';}` +
    `try{e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}catch(x){}` +
    `return 'cleared';})()`
  );
}

/**
 * §7 page mode on a TV: web pages do not move focus with arrow keys, so a
 * HUMAN's ◀ ▶ ▲ ▼ becomes spatial navigation — the nearest focusable element
 * in that direction takes focus (scrolled into view, outlined); OK activates
 * the focused element exactly as a click would. Only ever run on a keypress.
 */
function spatialNavJs(dir: "left" | "right" | "up" | "down"): string {
  // 1. Enumerate every target on the page (not just the viewport): real controls
  //    plus anything that looks clickable (pointer cursor, card-sized). Nested
  //    elements sharing a rect count once. Off-screen targets must be genuinely
  //    visible (no hidden/zero-opacity ancestor); on-screen ones must also be
  //    hit-testable, which excludes menus laid invisibly over rows.
  // 2. Cluster them into rows by vertical overlap, order rows top-down and items
  //    left-right. ◀ ▶ walk the row; ▲ ▼ go to the adjacent row's nearest item.
  //    The chosen item is outlined and scrolled just enough to be seen.
  return (
    `(function(d){${DEEP_PRELUDE}` +
    `var SEL='a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[role=button],[role=link],[role=menuitem],[role=tab],[role=option],video';` +
    `var cur=target();if(cur===document.body||cur===document.documentElement)cur=null;` +
    `function shown(e){var n=e,depth=0;while(n&&n.nodeType===1&&depth<12){var cs=getComputedStyle(n);if(cs.visibility==='hidden'||cs.display==='none'||cs.opacity==='0')return false;n=n.parentElement;depth++;}return true;}` +
    `function hit(e,r){var x=Math.min(innerWidth-1,Math.max(0,(r.left+r.right)/2)),y=Math.min(innerHeight-1,Math.max(0,(r.top+r.bottom)/2));var top=e.ownerDocument.elementFromPoint(x,y);if(!top)return false;var n=top;while(n){if(n===e)return true;n=n.parentNode||n.host;}n=e;while(n){if(n===top)return true;n=n.parentNode||n.host;}return false;}` +
    `var items=[],seen={};deep(document,function(e){if(!e.getBoundingClientRect||e.tagName==='HTML'||e.tagName==='BODY')return false;var r=e.getBoundingClientRect();` +
    `if(r.width<24||r.height<24||r.bottom<-4000||r.top>innerHeight+6000)return false;if(r.width>innerWidth*0.9&&r.height>innerHeight*0.9)return false;` +
    `var ctl=e.matches&&e.matches(SEL);if(!ctl){var cs=getComputedStyle(e);if(cs.cursor!=='pointer')return false;}` +
    `if(!shown(e))return false;var onscreen=r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;if(onscreen&&!hit(e,r))return false;` +
    `var key=Math.round(r.left)+':'+Math.round(r.top)+':'+Math.round(r.width)+':'+Math.round(r.height);if(seen[key])return false;seen[key]=1;items.push({e:e,r:r,cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2});return false;});` +
    `if(!items.length)return 'none';` +
    // rows: greedy clustering by vertical overlap of centres
    `items.sort(function(a,b){return a.cy-b.cy||a.cx-b.cx;});var rows=[];for(var i=0;i<items.length;i++){var it=items[i],row=rows[rows.length-1];` +
    `if(row&&Math.abs(it.cy-row.cy)<Math.max(24,Math.min(it.r.height,row.h)*0.6)){row.items.push(it);row.cy=(row.cy*row.n+it.cy)/(row.n+1);row.n++;row.h=Math.max(row.h,it.r.height);}else rows.push({cy:it.cy,n:1,h:it.r.height,items:[it]});}` +
    `rows.forEach(function(r){r.items.sort(function(a,b){return a.cx-b.cx;});});` +
    // where are we?
    `var ri=-1,ci=-1;if(cur){for(var a=0;a<rows.length&&ri<0;a++)for(var c=0;c<rows[a].items.length;c++)if(rows[a].items[c].e===cur){ri=a;ci=c;break;}}` +
    `var best=null;` +
    `if(ri<0){var fr=cur?cur.getBoundingClientRect():null;var fx=fr?(fr.left+fr.right)/2:innerWidth/2,fy=fr?(fr.top+fr.bottom)/2:0;` + // no current: nearest on-screen item to the current position / top
    `var bs=1e18;items.forEach(function(it){if(it.r.bottom<0||it.r.top>innerHeight)return;var dx=it.cx-fx,dy=it.cy-fy;var sc=dx*dx+dy*dy;if(sc<bs){bs=sc;best=it.e;}});}` +
    `else if(d==='left'||d==='right'){var row=rows[ri].items;var ni=ci+(d==='left'?-1:1);if(ni<0||ni>=row.length)return 'edge';best=row[ni].e;}` +
    `else{var nr=ri+(d==='up'?-1:1);if(nr<0||nr>=rows.length)return 'edge';var x=rows[ri].items[ci].cx,bd=1e18;rows[nr].items.forEach(function(it){var dd=Math.abs(it.cx-x);if(dd<bd){bd=dd;best=it.e;}});}` +
    `if(!best)return 'none';` +
    `var old=deep(document,function(n){return n.hasAttribute&&n.hasAttribute('data-prism-target');});while(old){old.removeAttribute('data-prism-target');old.style.outline=old.getAttribute('data-prism-outline')||'';old.removeAttribute('data-prism-outline');old.style.boxShadow=old.getAttribute('data-prism-shadow')||'';old.removeAttribute('data-prism-shadow');old=deep(document,function(n){return n.hasAttribute&&n.hasAttribute('data-prism-target');});}` +
    `best.setAttribute('data-prism-target','1');best.setAttribute('data-prism-outline',best.style.outline||'');best.setAttribute('data-prism-shadow',best.style.boxShadow||'');best.style.outline='6px solid #F0A83C';best.style.outlineOffset='3px';best.style.boxShadow='0 0 0 3px #14171C, 0 0 28px 8px rgba(240,168,60,.9)';` +
    `try{best.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});}catch(x){try{best.scrollIntoView(false);}catch(y){}}try{best.focus({preventScroll:true});}catch(x){}return 'ok';})(${JSON.stringify(dir)})`
  );
}

/** OK on the TV remote inside a page: activate what is outlined — a click for controls, focus for fields. */
function activateFocusedElementJs(): string {
  return (
    `(function(){${DEEP_PRELUDE}var e=target();if(!e||e===document.body)return 'none';` +
    `if(e.tagName==='INPUT'||e.tagName==='TEXTAREA'||e.isContentEditable){e.focus();return 'field';}` +
    `if(e.tagName==='VIDEO'){if(e.paused)e.play();else e.pause();return 'video';}var a=e.closest&&e.closest('a,button,[role=button]');var t=a||e;` +
    // Hover-driven menus (a profile switcher that unfolds on mouse-over) need the
    // pointer to arrive first; a TV has no pointer, so the human's OK carries it.
    `try{['pointerover','pointerenter','mouseover','mouseenter'].forEach(function(n){t.dispatchEvent(new MouseEvent(n,{bubbles:n==='mouseover'||n==='pointerover',cancelable:true,view:window}));});}catch(x){}` +
    `t.click();return 'click';})()`
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

interface PersistedLayoutState {
  hero?: string;
  heroSize?: number;
  solo?: string;
}

/** Edit patch for `updateTile`: absent = unchanged; `focus: null` / `zoom: null` / `aspectHint: null` clear. */
export interface TilePatch {
  url?: string;
  zoom?: number | null;
  focus?: FocusSpec | null;
  /** §8 aspect hint ("W:H"); the solver reflows the wall for it. */
  aspectHint?: string | null;
  /** §32: "floating" lifts the tile out of the wall (it reflows without it); "slot"/null docks it back. */
  kind?: "slot" | "floating" | null;
  /** §32 the floating place / face; partial patches merge (a drag end sends x,y; a resize w,h; a flip face). null = core's default. */
  float?: Partial<FloatSpec> | null;
  /** §34.1 with `url`: this page is the APP's home page from now on (the registry learns it; every later tile of the app starts there). */
  home?: boolean;
  /** With `url`: false = the page is already showing (Save & close) - persist without reloading. Default true. */
  reload?: boolean;
}

/** §32 default place for a floating facet: bottom-right, a music-control footprint. */
export const DEFAULT_FLOAT: FloatSpec = { x: 0.62, y: 0.76, w: 0.36, h: 0.2, face: "control" };

/** Keep a floating place on the wall and no smaller than a usable control. */
export function clampFloat(f: Partial<FloatSpec> | undefined): FloatSpec {
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const w = Math.min(1, Math.max(0.12, num(f?.w, DEFAULT_FLOAT.w)));
  const h = Math.min(1, Math.max(0.06, num(f?.h, DEFAULT_FLOAT.h)));
  const x = Math.min(1 - w, Math.max(0, num(f?.x, DEFAULT_FLOAT.x)));
  const y = Math.min(1 - h, Math.max(0, num(f?.y, DEFAULT_FLOAT.y)));
  return { x, y, w, h, face: f?.face === "page" ? "page" : "control", ...(f?.hidden ? { hidden: true } : {}) };
}

const MASTER_LAYOUTS_KEY = "masterlayouts";
const APPS_KEY = "apps";
const SCENES_KEY = "scenes";
const SCENE_CURRENT_KEY = "scene:current";
/** §34 two aspect ratios within this relative distance are one slot shape (16:9 ≈ 7:4; 16:9 ≠ 16:10). */
export const SHAPE_TOLERANCE = 0.04;
/** §33 slots overlapping at least this much (intersection over union) count as the same slot when flagging duplicate layouts. */
export const DUPLICATE_IOU = 0.85;

function prettyName(id: string): string {
  return id.split(/[-_]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

function iou(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Every rect of A pairs with a distinct rect of B at IoU ≥ DUPLICATE_IOU, and the counts match. */
function rectSetsMatch(a: Rect[], b: Rect[]): boolean {
  if (a.length !== b.length) return false;
  const used = new Set<number>();
  for (const r of a) {
    let best = -1, bestIou = 0;
    b.forEach((s, i) => { if (used.has(i)) return; const v = iou(r, s); if (v > bestIou) { bestIou = v; best = i; } });
    if (best < 0 || bestIou < DUPLICATE_IOU) return false;
    used.add(best);
  }
  return true;
}

/** §34 validate/shape a scene from untrusted input. null = unusable. */
export function normalizeScene(input: unknown): Scene | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  if (typeof m.layoutId !== "string" || !m.layoutId.trim()) return null;
  const slots: Record<string, SceneSlot | null> = {};
  if (m.slots && typeof m.slots === "object" && !Array.isArray(m.slots)) {
    for (const [slotId, v] of Object.entries(m.slots as Record<string, unknown>)) {
      if (!slotId) continue;
      if (!v || typeof v !== "object") { slots[slotId] = null; continue; }
      const r = v as Record<string, unknown>;
      if (typeof r.app !== "string" || !r.app) { slots[slotId] = null; continue; }
      slots[slotId] = { app: r.app, ...(typeof r.view === "string" && r.view ? { view: r.view } : {}) };
    }
  }
  return {
    id: typeof m.id === "string" ? m.id.trim() : "",
    label: typeof m.label === "string" && m.label.trim() ? m.label.trim() : "Untitled scene",
    layoutId: m.layoutId.trim(),
    slots,
  };
}

/** §33 validate/shape a master layout from untrusted input (the editor, the store). null = unusable. */
export function normalizeMasterLayout(input: unknown): MasterLayout | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  const mode = m.mode === "grid" ? "grid" : "hero";
  const slotsIn = Array.isArray(m.slots) ? (m.slots as unknown[]) : [];
  const slots: MasterSlot[] = [];
  const seen = new Set<string>();
  slotsIn.forEach((s, i) => {
    if (!s || typeof s !== "object") return;
    const r = s as Record<string, unknown>;
    const floating = r.kind === "floating";
    const aspect = typeof r.aspectHint === "string" && parseAspectHint(r.aspectHint) ? r.aspectHint : undefined;
    let id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : `slot-${i + 1}`;
    for (let n = 2; seen.has(id); n++) id = `${id}-${n}`;
    seen.add(id);
    slots.push({
      id,
      purpose: typeof r.purpose === "string" && r.purpose ? r.purpose : "custom",
      ...(aspect ? { aspectHint: aspect } : {}),
      ...(floating ? { kind: "floating" as const, float: clampFloat(r.float as Partial<FloatSpec> | undefined) } : {}),
      ...(r.hero === true ? { hero: true } : {}),
    });
  });
  if (slots.length === 0 || slots.length > 24) return null;
  const cols = Math.floor(Number(m.cols)), rows = Math.floor(Number(m.rows));
  const gap = typeof m.gap === "number" && m.gap >= 0 && m.gap <= 40 ? m.gap : 8;
  return {
    id: typeof m.id === "string" ? m.id.trim() : "",
    label: typeof m.label === "string" && m.label.trim() ? m.label.trim() : "Untitled layout",
    mode,
    ...(mode === "grid" ? { cols: cols >= 1 && cols <= 8 ? cols : 2, rows: rows >= 1 && rows <= 8 ? rows : 2 } : {}),
    ...(typeof m.heroSize === "number" ? { heroSize: clampHeroSize(m.heroSize) } : {}),
    gap,
    slots,
  };
}

/**
 * §33 the document a master layout produces. Wall slots take `apps` (the
 * non-floating ones) in order, floating slots take the floating apps; every
 * slot without an app becomes a placeholder tile - a shape and a place, no
 * page. `base` carries the dashboard's other fields (theme, audio, schedule…).
 */
export function masterDocument(ml: MasterLayout, dashId: string, apps: TileSpec[], base?: DashboardDocument): DashboardDocument {
  const wallApps = apps.filter((t) => t.kind !== "floating");
  const floatApps = apps.filter((t) => t.kind === "floating");
  const taken = new Set(apps.map((a) => a.id));
  const uniq = (id: string) => { let out = id; for (let n = 2; taken.has(out); n++) out = `${id}-${n}`; taken.add(out); return out; };
  const cols = ml.cols ?? 2, rows = ml.rows ?? 2, gap = ml.gap ?? 8;
  const tiles: TileSpec[] = [];
  let wi = 0, fi = 0, cell = 0;
  let heroTile: string | undefined;
  for (const slot of ml.slots) {
    const floating = slot.kind === "floating";
    const app = floating ? floatApps[fi++] : wallApps[wi++];
    let tile: TileSpec;
    if (app) {
      tile = { ...app };
      delete tile.area;
      if (slot.aspectHint) tile.aspectHint = slot.aspectHint; else if (!floating) delete tile.aspectHint;
    } else {
      tile = { id: uniq(slot.id), placeholder: true, audio: "mute", ...(slot.aspectHint ? { aspectHint: slot.aspectHint } : {}) };
    }
    if (floating) {
      tile.kind = "floating";
      tile.float = app?.float ?? slot.float ?? { ...DEFAULT_FLOAT };
    } else {
      delete tile.kind;
      delete tile.float;
      if (ml.mode === "grid") {
        const r = Math.floor(cell / cols) + 1, c = (cell % cols) + 1;
        if (r <= rows) tile.area = `${r} / ${c} / ${r + 1} / ${c + 1}`;
        cell++;
      }
      if (slot.hero && !heroTile) heroTile = tile.id;
    }
    tiles.push(tile);
  }
  const firstWall = tiles.find((t) => t.kind !== "floating")?.id;
  const hero = heroTile ?? firstWall;
  const layout: LayoutSpec = ml.mode === "hero" && hero
    ? { mode: "hero", hero, heroSize: clampHeroSize(ml.heroSize ?? 0.62), satellites: "auto", gap }
    : { mode: "grid" };
  return {
    ...(base ?? { schema: SCHEMA_VERSION, name: "Wall" }),
    schema: SCHEMA_VERSION,
    id: dashId,
    name: base?.name ?? "Wall",
    grid: { cols, rows, gap },
    layout,
    tiles,
  };
}

/** `setLayout` request (menu): the lattice for grid, an optional anchor/size for hero. */
export interface LayoutRequest {
  mode: "hero" | "grid" | "solo";
  cols?: number;
  rows?: number;
  hero?: string;
  heroSize?: number;
}

/** §32 what the remote / visualizations read: sources by hidden facet, the transient reveal, the feeds. */
export interface MusicStateSnapshot {
  sources: Record<string, MusicSourceState>;
  reveal: RevealState;
  feeds: VisualizationFeed[];
}

/** Scene-model hooks the runtime supplies (the model lives beside the orchestrator, not in it). */
export interface SceneHooks {
  /** The wall becomes the scene (runtime.modelApplyScene). */
  apply(sceneId: string): Promise<unknown> | unknown;
  /** Scene ids in carousel order. */
  ids(): string[];
  active(): string | null;
  /** slot / floating / visualization id → the facet and app behind it, for §6a deep links. */
  itemContext?(itemId: string): { facet?: string | null; app?: string | null } | null;
}

export interface RemoteStateSnapshot {
  dashboard: string;
  name: string;
  layoutMode: "hero" | "grid" | "solo" | "fixed";
  /** Grid lattice when layoutMode is "grid". */
  grid?: { cols: number; rows: number };
  /** §31 viewfinder in progress on this tile (popped out, unframed). */
  framing?: string;
  /** Tile currently taking over the screen (§2 fullscreen), if any. */
  fullscreen: string | null;
  hero: string | null;
  heroSize: number | null;
  /** §33 saved master layouts (app-less slots), full objects - the editor loads and lists them. */
  masterLayouts?: MasterLayout[];
  /** §34 the app registry (every app Prism has seen), its views per app, the saved scenes, the slot shapes the layouts define. */
  apps?: Array<{ id: string; name: string; floating?: boolean }>;
  appViews?: Record<string, Shortcut[]>;
  scenes?: Scene[];
  currentScene?: string | null;
  slotShapes?: SlotShape[];
  /** §30 popup child surfaces open right now (id = `<opener>#popup-N`), for the Control Center / remote. */
  popups?: Array<{ id: string; opener: string; url?: string }>;
  /** §32 music state of the scene's hidden music facets. */
  music?: MusicStateSnapshot;
  tiles: Array<{
    id: string;
    audio: string;
    playing: boolean;
    state: "live" | "warm";
    /** Current page (web tiles) — what the remote's mirror labels and what /navigate changed. */
    url?: string;
    /** §17 framing on this tile (selector or region), when set. */
    focus?: FocusSpec;
    /** The app this tile shows (adapter id, else the site's host slug) - shortcuts are keyed by it. */
    app: string;
    /** User-made layouts for this tile's app (apply via applyShortcut): what each holds, for the menus. */
    userShortcuts?: Array<{ id: string; label: string; url: string; hasRegion: boolean; aspectHint?: string }>;
    /** §32 floating facet: its place (wall fractions) and face. */
    kind?: "floating";
    float?: FloatSpec;
    /** §32 what the page says is playing. */
    nowPlaying?: NowPlaying;
    /** §33 an empty slot (no app yet). */
    placeholder?: boolean;
    /** §32 a visualization surface (style, its hidden source, artwork mode). */
    visualization?: { style: string; source: string; artwork: "off" | "backdrop" | "focal" };
    /** §32 hidden music facet whose native player is currently revealed ("panel" | "hero" | "window"). */
    revealed?: "panel" | "hero" | "window";
    /** §26 the page is in element fullscreen right now (shell auto-granted). */
    elementFullscreen?: boolean;
    /** A quick-play pick the page has not started yet (or could not): the wall's loading signal. */
    musicPending?: { kind: string; id: string; name: string; at: number; failed?: string };
    /** B-155: the source takes a thumbs up / down (its adapter declares the control or the player's rating API). */
    rate?: boolean;
    /** B-204 (2026-09-15): nothing is loaded on the page, but Prism remembers what this tile played - what a Play press would resume. The wall names it instead of an empty block over a dead Play. */
    resume?: { title: string; artist?: string; label?: string; kind?: string };
    /** Play orders (2026-09-17, spec 32 layer 5): the collection this tile plays in the order a person asked for - "shuffle" is the service's own switch, "true-shuffle" and "reverse" are Prism's queue. The block names it. */
    musicOrder?: { kind: string; id: string; name: string; order: "normal" | "shuffle" | "true-shuffle" | "reverse"; label: string; count?: number; /** the saved spot, 1-based, in a Prism-ordered play */ spot?: number; /** repeat: which pass this is, from the second on */ pass?: number };
    /** 2026-09-18: the standing repeat switch beside the order - the service's repeat-all for its orders, Prism's next pass for its own */
    musicRepeat?: true;
    /** 2026-09-18: the work in hand on this tile - a long read of a track list, with how far it has got - for the wall's status feed; with `error`, a read that failed and why (kept 12 s) */
    musicWork?: { what: string; name: string; count?: number; total?: number; at: number; error?: string };
    /** 2026-09-18: the last stall the watchdog saw on this tile - a player saying playing with a frozen clock - the strike, and the spot the wall's queue was re-run from (null: not the wall's queue, or given up) */
    stall?: { at: number; strikes: number; spot: number | null };
    /** B-123: what the adapter's session watch last saw on this page. */
    session?: "signed-in" | "signed-out";
    aspectHint?: string;
    /** §2 page zoom, when not 1. */
    zoom?: number;
    /** §12 launch tile: the app package it opens. */
    launch?: string;
    /** Present when the tile offers both a web player and a native app: the active choice. */
    mode?: "web" | "native";
    /** Adapter-declared sign-in page for this service (web tiles). */
    loginUrl?: string;
    /** Button on the login page a human presses to open the form (Apple TV: "Sign In"). */
    loginPress?: string;
    /** Adapter-declared places on the service (e.g. "Switch profile"). */
    shortcuts?: Array<{ label: string; url: string }>;
    /** True while the tile is on its sign-in page (a "login tile"). */
    onLogin?: boolean;
    /** The other option's target, when the tile has both (package for native, url for web). */
    alternative?: { mode: "web" | "native"; target: string };
    /** §25: a peek is in flight (muted, transient renderer). */
    peeking?: boolean;
    /** concept-scenes §5: what a single tap here means; absent === "promote" (§6a). */
    tapAction?: TapAction;
    /** §27: veil mode and whether network blocking is active for the tile. */
    veil?: { mode: VeilMode; blocking: boolean; sources: string[] };
    /** §26: the player's own skip control is reachable — a human may forward a skip. */
    skipAvailable?: boolean;
    /** §26: present (true) only while the tile is behind an intermission. */
    intermission?: boolean;
    /** §26: the page's own count of the break's ads ("2 of 3" - frame.adInfo's count) while the tile is behind an intermission: the wall says why its clock starts over (2026-09-15). */
    adCount?: string;
  }>;
  /**
   * §3 × concept-scenes §5: the item the sound is currently with — the one
   * the exclusive audio last moved to, by a play report or by a tap. Null
   * before anything has been made audible. The §6 remote's now-playing
   * follows this, so a tap on the phone and a tap on the wall agree.
   */
  audioOwner: string | null;
  /** B-150: the wall's one mute switch is on - the owner of the audio is kept silent until unmute. */
  muted?: boolean;
  /** §12/§26: the native app in the foreground right now (package), or null when the wall is. */
  foregroundApp: string | null;
  /** §12 d-pad focus ring: the tile select activates. */
  focused: string | null;
  /** §7: the tile currently receiving the remote's keys (page input mode), else null. */
  entered: string | null;
  /** Carousel order (§9) — every dashboard the device holds. */
  dashboards: string[];
  /** §24 alarm state: sunrise/ringing status plus any missed-alarm notice. */
  alarm: { status: string; missed: string | null };
}

/** What a single tap did (§6a × concept-scenes §5) — the shell and the §6 remote report it verbatim. */
export interface TapResult {
  /** False only when the tap could not be honored (unknown item, promotion unavailable). */
  ok: boolean;
  /** The placement's standing instruction. */
  action: TapAction;
  did: "promote" | "audio" | "audio+promote" | "none";
  /**
   * The audio half's outcome, when the tap asked for one: "moved" (the sound
   * is here now), "already-owner" (a no-op — never a mute), "peeking" (§25:
   * an item mid-peek is not a tap target for the switch).
   */
  audio?: "moved" | "already-owner" | "peeking";
  error?: "unknown-tile" | "unavailable";
}

/** Device payload: the dashboards it holds plus carousel order (§9). */
export interface DashboardBundle {
  dashboards: DashboardDocument[];
  carousel?: { order?: string[]; wrap?: boolean };
}

/** One quick-play entry: a collection page this tile played from. */
export interface RecentMusic {
  url: string;
  label: string;
  kind: "album" | "playlist" | "station" | "artist" | "video";
  /** The service's own id for the collection (B-124): with it, quick play queues by id through the adapter's musicPlay and never navigates. */
  id?: string;
  artist?: string;
  album?: string;
  title: string;
  at: number;
}

/** The collection kind a music page's address names, or null for pages that are not a collection (home, search, library, login). */
/**
 * B-124 (2026-09-07): a LIBRARY collection lives under /library/ - `/us/playlist/p.xxx` is Apple's not-found
 * page (a signed-out shell with no player), and the first musicContext built exactly that. Every address
 * core keeps or follows for a music tile goes through here, so a stored bad one heals on read.
 */
/** Everything an adapter runs in a page, in one script: its js, the music scripts, the session watch (null when it has none). */
function adapterScript(spec: AdapterSpec): string | null {
  return [spec.js, spec.musicContext, spec.musicLibrary, spec.musicPlay, spec.musicCmd, spec.musicLookup, spec.musicShuffle, spec.musicTracks, spec.musicQueue, spec.musicQueueAppend, spec.musicRepeat, spec.musicStartOver, spec.videoContext, spec.videoLibrary, spec.videoPlay, spec.videoCmd, spec.videoLookup, spec.videoProfiles, spec.videoLive, spec.videoTune, spec.videoSearch, spec.videoTracks, spec.videoSeek, spec.videoSeekPoint, spec.videoPreview, spec.videoEpisodeNumber, spec.videoListRoute, spec.session && (spec.session.signedIn || spec.session.signedOut) ? sessionWatchJs(spec.session) : null].filter((x): x is string => !!x).join("\n;\n") || null;
}

export function normalizeCollectionUrl(url: string): string {
  return url.replace(/^(https:\/\/music\.apple\.com\/[a-z]{2})\/(playlist|album)\/((?:p|l)\.[A-Za-z0-9]+)/, "$1/library/$2/$3");
}

/**
 * B-125 (2026-09-07): the service's own id, read from a collection address, so an older quick-play entry
 * (recorded before ids travelled) still plays by id through the player instead of navigating - a
 * navigation mid-playback is what raised the page's "leave site?" prompt. Apple Music forms only; null
 * for anything else, and the navigation path stands for those.
 */
export function collectionIdFromUrl(url: string): { kind: "playlist" | "station" | "album"; id: string } | null {
  if (!/^https:\/\/music\.apple\.com\//.test(url)) return null;
  const path = url.replace(/^https:\/\/music\.apple\.com/, "").split(/[?#]/)[0]!;
  let m = /\/station\/(?:[^/]+\/)?(ra\.[\w-]+)$/.exec(path);
  if (m) return { kind: "station", id: m[1]! };
  m = /\/library\/playlist\/(p\.[\w]+)$/.exec(path) ?? /\/playlist\/(?:[^/]+\/)?(pl\.[\w-]+)$/.exec(path);
  if (m) return { kind: "playlist", id: m[1]! };
  m = /\/library\/album\/(l\.[\w]+)$/.exec(path) ?? /\/album\/(?:[^/]+\/)?(\d+)$/.exec(path);
  if (m) return { kind: "album", id: m[1]! };
  return null;
}

export function collectionKind(url: string): RecentMusic["kind"] | null {
  let path: string;
  try { path = new URL(url).pathname.toLowerCase(); } catch { return null; }
  if (/\/(album|albums)\//.test(path)) return "album";
  if (/\/(playlist|playlists)\//.test(path)) return "playlist";
  if (/\/(station|stations|radio)\//.test(path)) return "station";
  if (/\/artist\//.test(path)) return "artist";
  if (/\/(watch|video)\b/.test(path)) return "video";
  return null;
}

/** A readable name from a collection page's slug ("/us/playlist/todays-hits/pl.abc" -> "Todays hits"); null when the address has none. */
export function collectionSlug(url: string): string | null {
  let parts: string[];
  try { parts = new URL(url).pathname.split("/").filter(Boolean); } catch { return null; }
  const i = parts.findIndex((p) => /^(album|albums|playlist|playlists|station|stations|radio|artist)$/i.test(p));
  const slug = i >= 0 ? parts[i + 1] : undefined;
  if (!slug || /^(pl|ra|id)\.|^\d+$|^play$/i.test(slug)) return null;   // "play" (Pandora's /station/play/<id>) is a verb, not a name
  const words = decodeURIComponent(slug).replace(/[-_+]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

/** Quick play cross-service lookup (2026-09-16): what one service's page said about the song playing now, and the last thing asked of it. */
export interface MusicLookupState {
  status: "idle" | "searching" | "found" | "ambiguous" | "not-found" | "unavailable" | "error";
  /** the song asked about, from the audio owner's face */
  song: { title: string; artist?: string | undefined; album?: string | undefined; artwork?: string | undefined } | null;
  /** normalized title|artist - a second open with the same song reads the answer already there */
  key: string;
  match: TrackCandidate | null;
  candidates: TrackCandidate[];
  /** how sure core is that the match IS the song (found only, absent after a person's pick): 90+ title and artist agree, lower for a lone title-only / artist-only hit (2026-09-17) */
  confidence?: MatchConfidence;
  /** why unavailable / error, in words for the menu */
  reason?: string;
  /** B-228: which kind of unavailable - the wall has no song to look up, or this service cannot be searched (the menu words them apart) */
  why?: "no-song" | "no-lookup";
  /** the match was a person's pick among candidates (the chooser stays, the pick marked) */
  picked?: boolean;
  /** the last add-to-playlist / station action on this service */
  action: { op: "add" | "station"; status: "pending" | "ok" | "error"; playlist?: string; song?: string; error?: string; at: number } | null;
  /** B-218: a verb this service cannot do from the wall, with the reason (Spotify's Web API cannot start a song radio) */
  cannot?: { station?: string };
  at: number;
}
type MusicResultEvent = Extract<SurfaceEvent, { type: "music-result" }>;

/** Chromium's own media controls, off on a video service's page (drawn over a fullscreen <video> on a pause, whatever the page asked). */
export const NO_NATIVE_VIDEO_CONTROLS_CSS = "video::-webkit-media-controls, video::-webkit-media-controls-enclosure, video::-webkit-media-controls-panel { display:none !important; opacity:0 !important; }";

export class Orchestrator {
  private doc: DashboardDocument | null = null;
  private viewport: Viewport = { w: 0, h: 0 };
  private override: HeroOverride = {};
  private surfaces = new Set<string>();
  private audio = new AudioFocusMachine({});
  private focusWaits = new Map<string, (found: boolean) => void>();
  private refresh: RefreshEngine;
  private schedule: ScheduleEngine;
  private lifecycle: LifecycleManager;
  private alarm: AlarmEngine;
  private intermission: IntermissionController;
  private compat: CompatTracker;
  private preview: PeekScheduler;
  private playhead = new VirtualPlayhead();
  private previewBudget: PreviewBudget = DEFAULT_PREVIEW_BUDGET;
  /** Video tiles currently playing, oldest first — the §25 decode-cap order. */
  private playingVideo: string[] = [];
  private adapters = new AdapterRegistry();
  private cosmetics = new CosmeticRegistry();
  private updates: UpdateChecker;
  private blocking: BlockListManager;
  private listening: PrivateListening;
  private vpn: VpnManager;
  private lowPower = false;
  /** §12 d-pad focus (TV): which tile select activates. */
  private focused: string | null = null;
  /** §7 page input mode: keys go INTO this tile's page until Back. */
  private entered: string | null = null;
  /** §2 `fullscreen`: one tile takes the whole viewport; Back returns to the solved layout unchanged. */
  private fullscreen: string | null = null;
  /** §31 step 3 viewfinder in progress: the slot raised and unframed, its previous framing to restore. */
  private framing: { id: string; prevFocus: FocusSpec | null; wasFullscreen: string | null } | null = null;
  /** How long a phone "Send email/password" waits for the page's field to appear (slow first loads). */
  fieldWaitMs = 12_000;
  /** §12: package of the native app in front (from the shell's observer), null = the wall. */
  private foregroundApp: string | null = null;
  /** §26 native: observed skip node per launch tile (opaque shell reference). */
  private appSkipTargets = new Map<string, string>();
  private missedAlarm: string | null = null;
  private docs = new Map<string, DashboardDocument>();
  private order: string[] = [];
  private wrap = true;

  constructor(private drivers: Drivers, refreshOptions?: RefreshEngineOptions) {
    this.refresh = new RefreshEngine(drivers.surface, refreshOptions);
    this.lifecycle = new LifecycleManager({
      freeze: (id) => this.drivers.surface.freeze(id),
      suspend: (id) => this.drivers.surface.suspend(id),
      resume: (id) => this.drivers.surface.resume(id),
      startLoad: (id, url, refreshSec, queued) => this.refresh.load(id, url, refreshSec, { queued }),
      stopLoad: (id) => this.refresh.stop(id),
      isPlaying: (id) => this.audio.isPlaying(id),
    });
    // §25 living previews: one muted transient renderer at a time.
    this.preview = new PeekScheduler({
      isWarm: (id) => this.lifecycle.status(id) === "warm",
      isPlaying: (id) => this.audio.isPlaying(id),
      peek: async (id) => {
        await this.drivers.surface.setMuted(id, true); // peeks are muted, always
        // §16 × §25: the shell holds the still up for the whole revival and
        // refuses to overwrite it from a load that never reached readiness.
        await this.drivers.surface.setPeek?.(id, true);
        try {
          await this.lifecycle.peek(id);
        } finally {
          await this.drivers.surface.setPeek?.(id, false);
        }
      },
      abortPeek: async (id) => {
        // abandonPeek freezes + suspends; the surface is still flagged, so the
        // shell keeps the previous still rather than capturing a blank page.
        await this.lifecycle.abandonPeek(id);
        await this.drivers.surface.setPeek?.(id, false);
      },
      now: () => Date.now(),
    });
    // §18 enforcement runs when a tile has real pixels on the wall.
    this.refresh.onReveal = (id) => void this.lifecycle.onRevealed(id);
    // §17: frame the focus region in the hidden buffer before the crossfade;
    // §25: then seek VOD preview tiles to their virtual playhead.
    this.refresh.beforeReveal = async (id) => {
      const ok = await this.applyFocus(id);
      if (ok) await this.seekToVirtualPlayhead(id);
      return ok;
    };
    // §19 incident sources (facts about software, never about people).
    this.compat = new CompatTracker(
      { shell: "prism-core@0.1.0", engine: "unknown", device: "unknown" },
      drivers.store,
    );
    this.refresh.onReadinessTimeout = (id) => void this.recordCompat("readiness-timeout", id);
    this.intermission = new IntermissionController({
      show: (id, source) => this.drivers.surface.showIntermission?.(id, source),
      hide: (id) => this.drivers.surface.hideIntermission?.(id),
      // B-147 (2026-09-08): the break's end gives the sound back only to the tile that still OWNS the audio (section 3).
      // A person who muted the music during the break (or before it) has said what they want; the engine's
      // "restore" is not a reason to override them, and a source another service out-ranks stays silent too.
      setMuted: (id, muted) => this.drivers.surface.setMuted(id, muted || this.wallMuted || this.audio.focusedMedia !== id),
      ambient: (id, sound, on) => this.ambientSound(id, sound, on),
      setSkip: (id, available, target) => this.drivers.surface.setIntermissionSkip?.(id, available, target ?? undefined),
    });
    // §28: static manifest, local comparison, install in the night window.
    this.updates = new UpdateChecker(
      {
        fetchManifest: (url) => {
          if (!drivers.update) throw new Error("no update driver");
          return drivers.update.fetchManifest(url);
        },
        apply: (release) => drivers.update?.apply(release) ?? "failed",
        now: () => Date.now(),
      },
      drivers.store,
    );
    // §5: attributed lists, synced by core, applied by the shell.
    this.blocking = new BlockListManager(
      {
        fetchStatic: (url) => {
          if (!drivers.net?.fetchStatic) throw new Error("no static fetch");
          return drivers.net.fetchStatic(url);
        },
        applyHosts: (id, name, hosts) => drivers.net?.applyBlockHosts?.(id, name, hosts),
        cosmeticsChanged: (sources) => this.setCosmeticSources(sources),
        now: () => Date.now(),
      },
      drivers.store,
    );
    // §14: one capture mix, two transports, all shell-owned; speakers
    // degrade to per-surface mute. Transports are resolved lazily on first use.
    this.listening = new PrivateListening(
      {
        capture: (enable) => this.drivers.surface.captureAudio?.(enable),
        serve: (transport, enable) => this.drivers.media?.serveAudio?.(transport, enable),
        now: () => Date.now(),
        speakers: async (mode) => {
          if (this.drivers.media?.setSpeakers) return this.drivers.media.setSpeakers(mode);
          for (const id of this.surfaces) {
            if (mode === "normal") {
              // Back to policy: only the audio-focused tile is audible.
              await this.drivers.surface.setMuted(id, id !== this.audio.focusedMedia);
            } else {
              await this.drivers.surface.setMuted(id, true);
            }
          }
        },
      },
      this.resolveTransports(drivers),
    );
    // §21: device-level WireGuard through the Net driver.
    this.vpn = new VpnManager(
      {
        ...(drivers.net?.configureVpn ? { configure: (c: string) => drivers.net!.configureVpn!(c) } : {}),
        ...(drivers.net?.clearVpn ? { clear: () => drivers.net!.clearVpn!() } : {}),
        ...(drivers.net?.vpnStatus ? { status: () => drivers.net!.vpnStatus!() } : {}),
      },
      drivers.store,
    );
    this.alarm = new AlarmEngine({
      setBrightness: (v) => this.drivers.display?.setBrightness(v),
      wake: () => this.wakeUp(),
      setTone: (playing) => this.drivers.alarm?.setTone(playing),
      onDismissed: () => this.schedule.trigger("alarm-dismissed"),
    });
    this.schedule = new ScheduleEngine({
      dim: (value) => this.drivers.display?.setBrightness(value),
      sleep: () => this.drivers.display?.setPower("sleep"),
      wake: () => void this.wakeUp(),
      layout: (id) => void this.switchTo(id),
      scene: (id) => void this.sceneHooks?.apply(id),
      night: (floor) => void this.enterNight(floor),
      lowpower: () => void this.enterLowPower(),
      alarm: () => this.fireAlarm(),
    });
  }

  /** Device budget (§18): most tiles allowed a live renderer at once. */
  setMaxLiveTiles(max: number): void {
    this.lifecycle.setMaxLive(max);
  }

  /** §25 decode budget: concurrently playing video cap + peek interval floor. */
  setPreviewBudget(budget: PreviewBudget): void {
    this.previewBudget = budget;
    this.preview.setBudget(budget);
  }

  /** Register the shell's bundled adapter set (§5). */
  /** §27/§5: attributed element-hiding lists the veil may draw on. */
  setCosmeticSources(sources: CosmeticSourceSpec[]): void {
    for (const name of this.cosmetics.list().map((s) => s.name)) this.cosmetics.unregister(name);
    for (const s of sources) this.cosmetics.register(s);
  }

  /** What the settings UI shows for every list: name, maintainer, URL, license, sync, count. */
  cosmeticSources(): CosmeticSourceInfo[] {
    return this.cosmetics.list();
  }

  /** Adapters refused by the §26 synthetic-interaction lint (edit-mode surface). */
  rejectedAdapters(): Record<string, string[]> {
    return this.adapters.rejected();
  }

  setAdapters(adapters: Record<string, AdapterSpec>): void {
    this.adapters.registerAll(adapters);
  }

  /** Single-dashboard convenience — a bundle of one. */
  async load(doc: DashboardDocument, viewport: Viewport): Promise<void> {
    await this.loadBundle({ dashboards: [doc] }, viewport);
  }

  /** Load the device's dashboard set + carousel order (§9). */
  async loadBundle(bundle: DashboardBundle, viewport: Viewport): Promise<void> {
    if (!bundle.dashboards.length) return;
    this.viewport = viewport;
    this.bootAt = Date.now();
    // §24: an armed alarm whose time passed while we were off is surfaced,
    // never silently skipped.
    if (this.drivers.store) {
      try {
        const armed = await this.drivers.store.get("alarm:armed");
        try { this.wallMuted = (await this.drivers.store.get(Orchestrator.PERSON_MUTED_KEY)) === "1"; } catch { /* unmuted */ }   // B-150: the wall's mute survives a restart; boot is silent regardless (no owner yet)
        if (armed && Date.parse(armed) < Date.now()) this.missedAlarm = armed;
      } catch {
        /* unreadable state never blocks boot */
      }
    }
    // SM-6 read-alias: a stored tile with the pre-rename `kind: "frame"` loads as a slot (§10: the document itself is not rewritten for it).
    this.docs = new Map(bundle.dashboards.map((d) => [d.id, d.tiles?.some((t) => (t.kind as unknown) === "frame") ? { ...d, tiles: d.tiles.map(aliasTileKind) } : d]));
    this.order = (bundle.carousel?.order ?? bundle.dashboards.map((d) => d.id)).filter((id) =>
      this.docs.has(id),
    );
    if (!this.order.length) this.order = bundle.dashboards.map((d) => d.id);
    this.wrap = bundle.carousel?.wrap ?? true;
    await this.applyDocument(this.docs.get(this.order[0]!)!);
  }

  /** Direct jump (§6 PUT /layout/{id}, §7 {action:"layout"} bindings). */
  async switchTo(dashboardId: string): Promise<boolean> {
    const doc = this.docs.get(dashboardId);
    if (!doc) return false;
    if (this.doc?.id !== dashboardId) await this.applyDocument(doc);
    return true;
  }

  /** Carousel step (§9); returns the new dashboard id, or null at an edge. */
  async carouselStep(direction: 1 | -1): Promise<string | null> {
    // scene model (§9): when the wall is a scene and the model holds more than one, the carousel steps scenes
    if (this.sceneHooks && this.sceneHooks.active() && this.sceneHooks.ids().length >= 2) return this.sceneStep(direction);
    if (!this.doc || this.order.length < 2) return null;
    const at = this.order.indexOf(this.doc.id);
    let next = at + direction;
    if (next < 0 || next >= this.order.length) {
      if (!this.wrap) return null;
      next = (next + this.order.length) % this.order.length;
    }
    const id = this.order[next]!;
    await this.switchTo(id);
    return id;
  }

  dashboards(): string[] {
    return [...this.order];
  }

  /** Persisted per-tile web/native choice (§10); default web. */
  private async tileMode(dashId: string, tileId: string): Promise<"web" | "native"> {
    const v = await this.drivers.store?.get(`tile:mode:${dashId}:${tileId}`);
    return v === "native" ? "native" : "web";
  }

  /**
   * A tile that declares both `url` and `launch` is rendered as ONE of them:
   * the active mode strips the other so every downstream path (create,
   * lifecycle, navigate, activate) sees a plain web or launch tile.
   */
  private async resolveModes(doc: DashboardDocument): Promise<DashboardDocument> {
    const tiles: TileSpec[] = [];
    for (const t of doc.tiles) {
      if (t.url && t.launch) {
        const mode = t.mode ?? (await this.tileMode(doc.id, t.id));
        const { url, launch, ...rest } = t;
        tiles.push(mode === "native" ? { ...rest, launch, mode } : { ...rest, url, mode });
      } else {
        tiles.push(t);
      }
    }
    return { ...doc, tiles };
  }

  /** State fields describing the web/native choice for tiles that have both. */
  private modeFields(tileId: string): { mode?: "web" | "native"; alternative?: { mode: "web" | "native"; target: string } } {
    const original = this.docs.get(this.doc?.id ?? "")?.tiles.find((t) => t.id === tileId);
    const active = this.tile(tileId);
    if (!original?.url || !original.launch || !active) return {};
    const mode = active.launch ? "native" : "web";
    return {
      mode,
      alternative: mode === "native" ? { mode: "web", target: original.url } : { mode: "native", target: original.launch.package },
    };
  }

  /** Remote: flip a both-ways tile between its web player and its native app; rebuilds that tile. */
  async setTileMode(tileId: string, mode: "web" | "native"): Promise<"ok" | "unknown-tile" | "not-switchable"> {
    if (!this.doc) return "unknown-tile";
    const original = this.docs.get(this.doc.id)?.tiles.find((t) => t.id === tileId);
    if (!original) return "unknown-tile";
    if (!original.url || !original.launch) return "not-switchable";
    await this.drivers.store?.set(`tile:mode:${this.doc.id}:${tileId}`, mode);
    if (this.entered === tileId) await this.leaveTile();
    // Tear this tile's surface down so applyDocument recreates it as the other kind.
    if (this.surfaces.has(tileId)) {
      this.refresh.stop(tileId);
      this.lifecycle.drop(tileId);
      await this.drivers.surface.destroy(tileId);
      this.surfaces.delete(tileId);
      this.dropKeeper(tileId);
    }
    await this.applyDocument(this.docs.get(this.doc.id)!);
    return "ok";
  }

  private async applyDocument(original: DashboardDocument): Promise<void> {
    const doc = await this.resolveModes(original);
    // VP-2 (2026-09-19): a tile whose App names no adapter and no catalog entry binds the adapter that claims its host
    // (the registry's `match`) - the Netflix App added by address had none, so its page got no scripts and no session probe
    for (const t of doc.tiles) if (!t.adapter && !t.launch && t.url) { const a = this.adapters.forUrl(t.url); if (a) t.adapter = a; }
    const previous = this.doc;   // what the wall shows now, for the survivor check below
    this.doc = doc;
    this.lensBoot();   // §4a: the TMDB key, if the household set one - read once the document (the store's key) is known
    // a new document may ask its placements to play again; the SAME document re-applied (B-124's recycle of an App's
    // surfaces, a resize) does not - Apple's placement played Vibes a second time on the recycled engine (2026-09-16)
    const placements = (d: DashboardDocument | null) => (d ? d.id + "|" + d.tiles.map((t) => t.id).sort().join(",") : "");
    if (placements(previous) !== placements(doc)) this.activatedOnce.clear();
    await this.primeResumePoints(doc);   // B-204: a fresh wall knows what each music tile would resume
    const wasSolo = this.isSolo();
    await this.leaveTile(); // a page never keeps the remote across a switch
    this.fullscreen = null; // a switch always lands on the new document's own layout
    if (this.drivers.surface.setVisible) for (const id of this.surfaces) await this.drivers.surface.setVisible(id, true); // solo may have hidden some
    this.override = await this.readPersistedLayout(doc.id);
    await this.ensureApps();                                            // §34 the app registry…
    for (const t of doc.tiles) await this.rememberApp(t);               // …learns every app on this wall
    await this.loadShortcuts(doc);
    await this.ensureMasterLayouts();   // §33: state() is sync; have them ready
    await this.ensureScenes();          // §34
    await this.videoUpBoot(doc, !previous);   // the TV off and on again: what was up comes back (2026-09-23)

    // §9: surviving tiles keep playing; policies retarget globally.
    this.audio.retarget(
      Object.fromEntries(doc.tiles.map((t) => [t.id, t.audio ?? "mute"])),
    );

    const wanted = new Set(doc.tiles.map((t) => t.id));
    // A survivor is a tile with the same id AND the same shape. A placeholder that became an
    // app, an app whose page changed, a slot that became floating, a visualization that became
    // a page: those are different surfaces, so the old one is destroyed and the create path
    // below rebuilds it (§16). Found live 2026-09-05: "Save to this scene" wrote three facets
    // into Kitchen Command and the wall kept its three placeholders.
    const nextById = new Map(doc.tiles.map((t) => [t.id, t]));
    const prevById = new Map((previous?.tiles ?? []).map((t) => [t.id, t]));
    const reshaped = (id: string): boolean => {
      const a = prevById.get(id), b = nextById.get(id);
      if (!a || !b) return false;
      return !!a.placeholder !== !!b.placeholder || (a.url ?? "") !== (b.url ?? "") || JSON.stringify(a.visualization ?? null) !== JSON.stringify(b.visualization ?? null)
        || (a.kind ?? "") !== (b.kind ?? "") || (a.launch?.package ?? "") !== (b.launch?.package ?? "");
    };
    for (const id of [...this.surfaces]) {
      if (this.lookups.has(id)) continue;   // a hidden search / list surface is not the wall's: a scene switch had destroyed one 30 ms into a catalog card's press (Gilmore Girls on Hulu, 2026-09-21), and the press fell back to Hulu's search page
      if (!wanted.has(id) || reshaped(id)) {
        this.refresh.stop(id);
        this.lifecycle.drop(id);
        await this.drivers.surface.destroy(id);
        this.surfaces.delete(id);
        this.dropKeeper(id);
      }
    }

    const background = doc.theme?.background ?? DEFAULT_BACKGROUND;
    const survivors = new Set([...this.surfaces].filter((id) => wanted.has(id)));
    for (const tile of doc.tiles) {
      if (!this.surfaces.has(tile.id)) {
        if (tile.visualization) {
          // §32 visualization surface: shell-rendered, audio-reactive; a shell without one shows a placeholder
          if (this.drivers.surface.createVisualization) {
            await this.drivers.surface.createVisualization({ id: tile.id, style: tile.visualization.style, source: tile.visualization.source, artwork: tile.visualization.artwork, spill: tile.visualization.spill === true });
          } else {
            await this.drivers.surface.create({ id: tile.id, profile: tile.id, background, placeholder: true, label: tile.label ?? tile.aspectHint ?? "", blocking: false });
          }
          this.surfaces.add(tile.id);
          await this.drivers.surface.reveal(tile.id, 300);
          continue;
        }
        await this.drivers.surface.create({
          id: tile.id,
          ...(tile.kind === "floating" ? { kind: tile.float?.hidden ? "hidden" as const : "floating" as const } : {}),
          profile: tile.profile ?? tile.id, // §10: implicit per-tile profile
          background,
          ...(tile.viewport !== undefined ? { viewport: tile.viewport } : {}),
          ...(tile.uaPlatform !== undefined ? { uaPlatform: tile.uaPlatform } : {}),
          ...(tile.zoom !== undefined ? { zoom: tile.zoom } : {}),
          ...(tile.launch ? { launch: tile.launch.package } : {}),
          ...(tile.placeholder ? { placeholder: true, label: tile.label ?? tile.aspectHint ?? "" } : {}),
          blocking: this.blockingFor(tile),
        });
        this.surfaces.add(tile.id);
        // §16: the engine navigates, awaits readiness, and reveals; the
        // surface stays hidden over the substrate until then.
        if (tile.url && !tile.placeholder) {
          // a pick waiting for this slot loads the title's OWN address straight away, not the service's home first (a switch
          // had cost the home's load before the play: fifteen seconds to an episode on Paramount+, 2026-09-21)
          const queued = this.videoPlayQueued.get(tile.id);
          this.refresh.load(tile.id, queued?.url ?? this.bootTitles.get(tile.id)?.url ?? await this.resumeUrlFor(doc.id, tile), tile.refresh);
        } else if (tile.launch || tile.placeholder) {
          // §12 posters and §33 empty slots have no load path — reveal immediately.
          await this.drivers.surface.reveal(tile.id, 300);
        }
      }
    }

    for (const cmd of this.audio.initialCommands()) {
      await this.drivers.surface.setMuted(cmd.tile, true);
    }

    await this.applyLayout();
    if (this.bootTitles.size) await this.videoUpMark(false);
    if (wasSolo && doc.layout?.mode !== "solo") await this.lifecycle.reviveAll(); // back to the wall: the budget decides again
    this.schedule.start(doc.schedule ?? []); // §4 — active dashboard's schedule
    for (const t of doc.tiles) if (t.visualization?.source) { void this.recentMusic(t.visualization.source); void this.musicLibrary(t.visualization.source); }   // quick play: warm the lists for the chrome's menu
    await this.persistNextAlarm(); // §24 bookkeeping

    // §17 × §9: surviving tiles don't reload on a switch, so apply (or
    // clear) this dashboard's framing directly.
    for (const tile of doc.tiles) {
      if (!survivors.has(tile.id)) continue;
      await this.drivers.surface.inject(
        tile.id,
        null,
        tile.focus ? focusFramingJs(tile.focus) : CLEAR_FRAMING_JS,
      );
    }

    // §26: intermission config per tile; switches uncover everything.
    this.intermission.configure(
      doc.tiles.map((t) => ({
        id: t.id,
        enabled: this.defaultIntermission(t) || (t.intermission?.enabled ?? false),
        source: t.intermission?.source ?? "pack:cosmos",
        audio: t.intermission?.audio ?? "mute",
        ambient: t.intermission?.ambient ?? null,
      })),
    );
    for (const [k, v] of [...this.ambient]) if (!this.surfaces.has(v.surface)) this.ambient.delete(k);   // an apply destroyed the old soundscape surfaces

    // §32: the scene's hidden music facets are the music sources; visualizations read feeds from them.
    this.music.configure(doc.tiles.filter((t) => t.kind === "floating" && t.float?.hidden && t.url).map((t) => t.id));
    for (const t of doc.tiles) if (t.visualization) await this.pushFeed(t);

    // §25: peek tiles (video tiles with a preview) and their playheads.
    const peekTiles = doc.tiles.filter((t) => t.url && t.preview?.mode === "peek");
    this.playhead.configure(
      peekTiles.map((t) => ({ id: t.id, playhead: t.preview?.playhead ?? "advance" })),
    );
    this.preview.configure(
      peekTiles.map((t) => ({
        id: t.id,
        intervalSec: t.preview?.interval ?? this.previewBudget.minPeekIntervalSec,
        playhead: t.preview?.playhead ?? "advance",
      })),
    );
    this.playingVideo = this.playingVideo.filter((id) => wanted.has(id));

    // §12: focus starts on the hero (or the first tile); a switch re-seats it.
    if (!this.focused || !wanted.has(this.focused)) {
      const first = doc.layout?.mode === "hero" ? doc.layout.hero : doc.tiles[0]?.id ?? null;
      this.focused = null;
      await this.setFocus(first ?? null);
    }

    // §18: reconcile the lifecycle set; enforcement runs as tiles reveal.
    this.lifecycle.track(
      doc.tiles.map((t) => ({
        id: t.id,
        url: t.url ?? null,
        persist: t.persist ?? false,
        refreshSec: t.refresh ?? null,
      })),
    );
    await this.lifecycle.enforce();
    // Solo: the one app on screen — AFTER the lifecycle knows the tiles, so
    // every other tile goes warm right away (one live renderer at boot too).
    if (doc.layout?.mode === "solo") {
      const start = this.override.solo ?? doc.layout.start ?? doc.tiles[0]?.id;
      const first = doc.tiles.find((t) => t.id === start && !t.launch) ?? doc.tiles.find((t) => !t.launch);
      if (first) await this.enterFullscreen(first.id);
    }
  }

  /** Current gap-free partition rects (what the conformance kit compares). */
  /** §31 picker (host flow): add a tile to the CURRENT dashboard, persist, re-apply. */
  async addTile(tile: TileSpec, appName?: string): Promise<"ok" | "duplicate-id" | "no-doc"> {
    if (!this.doc) return "no-doc";
    const original = this.docs.get(this.doc.id);
    if (!original) return "no-doc";
    if (original.tiles.some((t) => t.id === tile.id)) return "duplicate-id";
    await this.rememberApp(tile, appName);   // §34: the app registry learns it (its catalog name, its home page)
    const next = { ...original, tiles: [...original.tiles, tile] };
    this.docs.set(next.id, next);
    await this.applyDocument(next);
    await this.persistDocument(next);
    return "ok";
  }

  /**
   * Configure slot: the tile keeps its slot (index, grid area) but becomes a
   * different tile - a catalog pick or a custom site. The old surface goes
   * (its profile stays on disk, §10); the new one is created fresh. The hero
   * / satellite bookkeeping follows the id when it changes. Persisted.
   */
  async replaceTile(oldId: string, tile: TileSpec, appName?: string): Promise<"ok" | "unknown-tile" | "no-doc"> {
    if (!this.doc) return "no-doc";
    const original = this.docs.get(this.doc.id);
    if (!original) return "no-doc";
    const idx = original.tiles.findIndex((t) => t.id === oldId);
    if (idx < 0) return "unknown-tile";
    const prev = original.tiles[idx]!;
    await this.rememberApp(tile, appName);   // §34
    const next: TileSpec = { ...tile };
    if (prev.area && !next.area) next.area = prev.area;
    if (prev.placeholder) {
      // §33 choosing an app for an empty slot: the slot's shape and place win
      if (prev.aspectHint) next.aspectHint = prev.aspectHint;
      if (prev.kind === "floating") { next.kind = "floating"; next.float = next.float ?? prev.float ?? { ...DEFAULT_FLOAT }; }
      delete next.placeholder;
    }
    // a unique id (never collide with a neighbour; the old id itself is free)
    const taken = new Set(original.tiles.filter((t) => t.id !== oldId).map((t) => t.id));
    const base = next.id;
    for (let n = 2; taken.has(next.id); n++) next.id = base + "-" + n;
    if (next.id !== base && (next.profile === undefined || next.profile === base)) next.profile = next.id;

    if (this.framing?.id === oldId) this.framing = null;
    if (this.entered === oldId) await this.leaveTile();
    if (this.fullscreen === oldId) this.fullscreen = null;
    if (this.surfaces.has(oldId)) {
      this.refresh.stop(oldId);
      this.lifecycle.drop(oldId);
      await this.drivers.surface.destroy(oldId);
      this.surfaces.delete(oldId);
    }
    const tiles = original.tiles.slice();
    tiles[idx] = next;
    let layout = original.layout;
    if (layout?.mode === "hero") {
      const hero = layout.hero === oldId ? next.id : layout.hero;
      const satellites = Array.isArray(layout.satellites) ? layout.satellites.map((s) => (s === oldId ? next.id : s)) : layout.satellites;
      layout = { ...layout, hero, satellites };
    }
    if (this.override.hero === oldId) this.override = { ...this.override, hero: next.id };
    if (this.override.solo === oldId) this.override = { ...this.override, solo: next.id };
    const nextDoc = { ...original, tiles, ...(layout ? { layout } : {}) };
    this.docs.set(nextDoc.id, nextDoc);
    await this.persistLayout();
    await this.applyDocument(nextDoc);
    await this.persistDocument(nextDoc);
    return "ok";
  }

  /* ------------------------------ §33 master layouts (a wall without apps) */

  private masterLayouts: MasterLayout[] | null = null;

  private async ensureMasterLayouts(): Promise<MasterLayout[]> {
    if (this.masterLayouts) return this.masterLayouts;
    let list: MasterLayout[] = [];
    if (this.drivers.store) {
      try {
        const raw = await this.drivers.store.get(MASTER_LAYOUTS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) list = parsed.map((m) => normalizeMasterLayout(m)).filter((m): m is MasterLayout => !!m && !!m.id);
        }
      } catch { /* §10 posture: unreadable state never breaks the wall */ }
    }
    this.masterLayouts = list;
    return list;
  }

  /** Saved master layouts (loaded with the dashboard; state() is sync). */
  listMasterLayouts(): MasterLayout[] {
    return this.masterLayouts ?? [];
  }

  /** Upsert a master layout; a missing id gets `ml-<n>`. Persisted locally (§22). */
  async saveMasterLayout(input: unknown): Promise<"ok" | "invalid"> {
    const ml = normalizeMasterLayout(input);
    if (!ml) return "invalid";
    const list = await this.ensureMasterLayouts();
    if (!ml.id) { let n = 1; while (list.some((m) => m.id === `ml-${n}`)) n++; ml.id = `ml-${n}`; }
    const idx = list.findIndex((m) => m.id === ml.id);
    if (idx >= 0) list[idx] = ml; else list.push(ml);
    await this.persistMasterLayouts();
    return "ok";
  }

  async removeMasterLayout(id: string): Promise<"ok" | "unknown"> {
    const list = await this.ensureMasterLayouts();
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return "unknown";
    list.splice(idx, 1);
    await this.persistMasterLayouts();
    return "ok";
  }

  private async persistMasterLayouts(): Promise<void> {
    if (!this.drivers.store) return;
    await this.drivers.store.set(MASTER_LAYOUTS_KEY, JSON.stringify(this.masterLayouts ?? []));
  }

  /**
   * The rects a master layout solves to at a viewport - the editor's live
   * preview. Same solver, same law (§8): the preview never approximates.
   * `unplaced`: wall slots a grid lattice has no cell for.
   */
  previewLayout(input: unknown, viewport: Viewport): { rects: SolvedRects; floats: Record<string, Rect>; unplaced: string[] } | null {
    const ml = normalizeMasterLayout(input);
    if (!ml) return null;
    const doc = masterDocument(ml, "preview", []);
    const rects = layoutDashboard(doc, viewport);
    const floats: Record<string, Rect> = {};
    for (const t of doc.tiles) {
      if (t.kind !== "floating") continue;
      const f = clampFloat(t.float);
      floats[t.id] = { x: Math.round(f.x * viewport.w), y: Math.round(f.y * viewport.h), w: Math.round(f.w * viewport.w), h: Math.round(f.h * viewport.h) };
    }
    const unplaced = doc.tiles.filter((t) => t.kind !== "floating" && !rects[t.id]).map((t) => t.id);
    return { rects, floats, unplaced };
  }

  /**
   * The wall becomes the master layout: existing apps fill its wall slots in
   * document order, floating apps fill its floating slots, and every slot
   * without an app is an empty slot until one is chosen. Apps beyond the
   * slots leave the wall (their profiles stay - §10).
   */
  async applyMasterLayout(id: string): Promise<"ok" | "unknown" | "no-doc"> {
    if (!this.doc) return "no-doc";
    const original = this.docs.get(this.doc.id);
    if (!original) return "no-doc";
    const ml = (await this.ensureMasterLayouts()).find((m) => m.id === id);
    if (!ml) return "unknown";
    const apps = original.tiles.filter((t) => !t.placeholder);
    const next = masterDocument(ml, original.id, apps, original);
    if (this.fullscreen) await this.exitFullscreen();
    const hero = next.layout?.mode === "hero" ? next.layout.hero : undefined;
    this.override = {
      ...this.override,
      ...(hero ? { hero } : {}),
      ...(ml.heroSize !== undefined ? { heroSize: clampHeroSize(ml.heroSize) } : {}),
    };
    this.docs.set(next.id, next);
    await this.persistLayout();
    await this.applyDocument(next);
    await this.persistDocument(next);
    return "ok";
  }

  /* ------------------------------ §34 apps, slot shapes, scenes ---------- */

  private apps: Map<string, AppRecord> | null = null;
  private scenes: Scene[] | null = null;
  private currentScene: string | null = null;

  private async ensureApps(): Promise<Map<string, AppRecord>> {
    if (this.apps) return this.apps;
    const map = new Map<string, AppRecord>();
    if (this.drivers.store) {
      try {
        const raw = await this.drivers.store.get(APPS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed))
            for (const a of parsed as Array<Partial<AppRecord>>)
              if (a && typeof a.id === "string" && a.tile && typeof a.tile === "object")
                map.set(a.id, { id: a.id, name: typeof a.name === "string" && a.name ? a.name : prettyName(a.id), tile: a.tile as TileSpec });
        }
      } catch { /* §10 posture */ }
    }
    this.apps = map;
    return map;
  }

  /**
   * The app registry: every app Prism has seen, as the base tile a scene builds
   * from - so a scene can put an app in a slot whether or not it is on the wall
   * now. The catalog name arrives with a pick; the home page is the first URL
   * seen (a pick's URL is authoritative); the §10 profile is the first tile's,
   * so every later tile of the app shares its sign-in.
   */
  private async rememberApp(tile: TileSpec, name?: string): Promise<void> {
    if (!tile.url || tile.placeholder || tile.launch) return;
    const apps = await this.ensureApps();
    const id = this.appKeyOf(tile);
    const prev = apps.get(id);
    const base: TileSpec = {
      id,
      url: name ? tile.url : prev?.tile.url ?? tile.url,
      profile: prev?.tile.profile ?? tile.profile ?? tile.id,
    };
    for (const k of ["adapter", "audio", "zoom", "viewport", "uaPlatform", "intermission", "veil", "blocking", "kind", "float", "aspectHint", "persist"] as const) {
      const v = prev && !name ? prev.tile[k] ?? tile[k] : tile[k];
      if (v !== undefined) (base as unknown as Record<string, unknown>)[k] = v;
    }
    const record: AppRecord = { id, name: name ?? prev?.name ?? prettyName(id), tile: base };
    if (prev && JSON.stringify(prev) === JSON.stringify(record)) return;
    apps.set(id, record);
    await this.persistApps();
  }

  /** §34.1 the app's home page changes (Configure an app → Save & close): the registry follows, so every later tile of the app starts there. */
  private async setAppHome(tile: TileSpec, url: string): Promise<void> {
    if (tile.placeholder || tile.launch) return;
    const apps = await this.ensureApps();
    const id = this.appKeyOf(tile);
    const prev = apps.get(id);
    if (!prev) { await this.rememberApp({ ...tile, url }); return; }
    if (prev.tile.url === url) return;
    apps.set(id, { ...prev, tile: { ...prev.tile, url } });
    await this.persistApps();
  }

  private async persistApps(): Promise<void> {
    if (!this.drivers.store || !this.apps) return;
    await this.drivers.store.set(APPS_KEY, JSON.stringify([...this.apps.values()]));
  }

  /** §34 every app Prism has seen (the registry), by name. (listApps() is the §12 native-app list.) */
  knownApps(): AppRecord[] {
    return [...(this.apps?.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The slot shapes the saved layouts define, grouped within SHAPE_TOLERANCE
   * (16:9 and 7:4 are one shape; 16:9 and 16:10 are two). Facets are made for
   * these. With no layouts yet, 16:9 alone.
   */
  slotShapes(viewport: Viewport): SlotShape[] {
    const groups: Array<SlotShape & { ids: Set<string> }> = [];
    for (const ml of this.listMasterLayouts()) {
      const preview = this.previewLayout(ml, viewport);
      for (const slot of ml.slots) {
        const floating = slot.kind === "floating";
        const aspect = slot.aspectHint ?? (floating ? "16:5" : undefined);
        const ratio = aspect ? parseAspectHint(aspect) : null;
        if (!aspect || !ratio) continue;
        const rect = preview?.rects[slot.id] ?? preview?.floats[slot.id];
        let g = groups.find((x) => x.floating === floating && Math.abs(x.ratio - ratio) / x.ratio <= SHAPE_TOLERANCE);
        if (!g) {
          g = { aspect, ratio, floating, layouts: 0, sample: { w: 0, h: 0 }, ids: new Set() };
          groups.push(g);
        }
        g.ids.add(ml.id);
        if (rect && rect.w * rect.h > g.sample.w * g.sample.h) g.sample = { w: rect.w, h: rect.h };
      }
    }
    if (groups.length === 0) {
      const w = Math.round(viewport.w / 2);
      groups.push({ aspect: "16:9", ratio: 16 / 9, floating: false, layouts: 0, sample: { w, h: Math.round(w / (16 / 9)) }, ids: new Set() });
    }
    return groups
      .map(({ ids, ...g }) => ({ ...g, layouts: ids.size }))
      .sort((a, b) => Number(a.floating) - Number(b.floating) || b.layouts - a.layouts || b.ratio - a.ratio);
  }

  /**
   * Saved layouts a draft would duplicate: same number of slots and every
   * slot overlapping one of theirs by IoU ≥ DUPLICATE_IOU at this viewport
   * (floating slots compared the same way). Flagged, never refused.
   */
  similarLayouts(input: unknown, viewport: Viewport): Array<{ id: string; label: string }> {
    const draft = normalizeMasterLayout(input);
    if (!draft) return [];
    const a = this.previewLayout(draft, viewport);
    if (!a) return [];
    const out: Array<{ id: string; label: string }> = [];
    for (const ml of this.listMasterLayouts()) {
      if (ml.id === draft.id) continue;
      const b = this.previewLayout(ml, viewport);
      if (!b) continue;
      if (rectSetsMatch(Object.values(a.rects), Object.values(b.rects)) && rectSetsMatch(Object.values(a.floats), Object.values(b.floats))) out.push({ id: ml.id, label: ml.label });
    }
    return out;
  }

  private async ensureScenes(): Promise<Scene[]> {
    if (this.scenes) return this.scenes;
    let list: Scene[] = [];
    if (this.drivers.store) {
      try {
        const raw = await this.drivers.store.get(SCENES_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) list = parsed.map((s) => normalizeScene(s)).filter((s): s is Scene => !!s && !!s.id);
        }
        this.currentScene = (await this.drivers.store.get(SCENE_CURRENT_KEY)) || null;
      } catch { /* §10 posture */ }
    }
    this.scenes = list;
    return list;
  }

  listScenes(): Scene[] {
    return this.scenes ?? [];
  }

  /** Upsert a scene; a missing id gets `scene-<n>`. The layout must exist. */
  async saveScene(input: unknown): Promise<"ok" | "invalid" | "unknown-layout"> {
    const scene = normalizeScene(input);
    if (!scene) return "invalid";
    if (!(await this.ensureMasterLayouts()).some((m) => m.id === scene.layoutId)) return "unknown-layout";
    const list = await this.ensureScenes();
    if (!scene.id) { let n = 1; while (list.some((s) => s.id === `scene-${n}`)) n++; scene.id = `scene-${n}`; }
    const idx = list.findIndex((s) => s.id === scene.id);
    if (idx >= 0) list[idx] = scene; else list.push(scene);
    await this.persistScenes();
    return "ok";
  }

  async removeScene(id: string): Promise<"ok" | "unknown"> {
    const list = await this.ensureScenes();
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) return "unknown";
    list.splice(idx, 1);
    if (this.currentScene === id) { this.currentScene = null; try { await this.drivers.store?.set(SCENE_CURRENT_KEY, ""); } catch { /* best effort */ } }
    await this.persistScenes();
    return "ok";
  }

  private async persistScenes(): Promise<void> {
    if (!this.drivers.store) return;
    await this.drivers.store.set(SCENES_KEY, JSON.stringify(this.scenes ?? []));
  }

  /**
   * The wall becomes the scene: its layout's slots, each holding the app
   * (from the registry) and view (page + region) assigned to it; unassigned
   * or unknown slots stay empty. Every tile of an app shares the app's §10
   * profile, so a sign-in made in one scene holds in all of them.
   */
  async applyScene(id: string): Promise<"ok" | "unknown" | "no-doc"> {
    if (!this.doc) return "no-doc";
    const original = this.docs.get(this.doc.id);
    if (!original) return "no-doc";
    const scene = (await this.ensureScenes()).find((s) => s.id === id);
    if (!scene) return "unknown";
    const ml = (await this.ensureMasterLayouts()).find((m) => m.id === scene.layoutId);
    if (!ml) return "unknown";
    const apps = await this.ensureApps();
    await this.loadShortcuts(original);                                  // views of registry apps not on this wall
    const base = masterDocument(ml, original.id, [], original);          // every slot an empty slot tile, ids = slot ids
    const taken = new Set<string>();
    const tiles: TileSpec[] = [];
    const renamed = new Map<string, string>();
    for (const ph of base.tiles) {
      const asg = scene.slots[ph.id];
      const app = asg ? apps.get(asg.app) : undefined;
      if (!asg || !app) { taken.add(ph.id); tiles.push(ph); continue; }
      let tid = app.id;
      for (let n = 2; taken.has(tid); n++) tid = `${app.id}-${n}`;
      taken.add(tid);
      const tile: TileSpec = { ...app.tile, id: tid, profile: app.tile.profile ?? app.id };
      if (ph.area) tile.area = ph.area; else delete tile.area;
      if (ph.aspectHint) tile.aspectHint = ph.aspectHint;
      if (ph.kind === "floating") { tile.kind = "floating"; tile.float = ph.float ?? tile.float ?? { ...DEFAULT_FLOAT }; }
      else { delete tile.kind; delete tile.float; }
      const view = asg.view ? (this.shortcuts.get(app.id) ?? []).find((v) => v.id === asg.view) : undefined;
      if (view) { tile.url = view.url; if (view.focus) tile.focus = view.focus; else delete tile.focus; }
      else delete tile.focus;
      renamed.set(ph.id, tid);
      tiles.push(tile);
    }
    let layout = base.layout;
    if (layout?.mode === "hero") layout = { ...layout, hero: renamed.get(layout.hero) ?? layout.hero };
    const next: DashboardDocument = { ...base, tiles, ...(layout ? { layout } : {}) };
    if (this.fullscreen) await this.exitFullscreen();
    const hero = layout?.mode === "hero" ? layout.hero : undefined;
    this.override = {
      ...this.override,
      ...(hero ? { hero } : {}),
      ...(ml.heroSize !== undefined ? { heroSize: clampHeroSize(ml.heroSize) } : {}),
    };
    this.currentScene = id;
    this.docs.set(next.id, next);
    await this.persistLayout();
    await this.applyDocument(next);
    await this.persistDocument(next);
    try { await this.drivers.store?.set(SCENE_CURRENT_KEY, id); } catch { /* best effort */ }
    return "ok";
  }

  /* ------------------------------ scene model (docs/scene-model-spec.md) -- */

  /** The canvas the wall is solved for right now (the scene model's canvas size). */
  canvasSize(): Viewport {
    return { ...this.viewport };
  }

  /**
   * The wall becomes a materialized scene-model document (`sceneDocument`,
   * layout mode "fixed"). Same path every wall change takes: surfaces
   * reconcile, the §16 load path runs, the document persists (§10 - the
   * dashboard key is the wall's; profiles are never touched).
   */
  async applyModelDocument(next: DashboardDocument): Promise<"ok" | "no-doc"> {
    if (!this.doc) return "no-doc";
    const original = this.docs.get(this.doc.id);
    if (!original) return "no-doc";
    const doc: DashboardDocument = { ...next, id: original.id };
    if (this.fullscreen) await this.exitFullscreen();
    this.docs.set(doc.id, doc);
    await this.applyDocument(doc);
    await this.persistDocument(doc);
    return "ok";
  }

  /* ------------------------------ App preview / setup surfaces (B-41) ----- */

  /**
   * B-129 (2026-09-07): what a person started in App setup carries on. Closing setup recycles the App's
   * wall surface (B-124), which killed whatever the setup page was playing; now the closed preview's last
   * word (its page, its collection, whether it played) is kept for a minute, and the recycled music tile
   * picks it up - by id through the player where there is one, else by address with the page's own Play.
   */
  private lastClosedPreview: { profile: string; url: string | undefined; np: NowPlaying | null; at: number } | null = null;

  /** Surfaces outside the wall: App setup mode and facet previews (scene-model-spec §2 / §4, win-host-spec §5). */
  private readonly previews = new Map<string, { app: string; profile: string; adapter: string | null }>();

  /**
   * Open a full-window surface in the App's profile, outside the dashboard:
   * created through the shell's engine seam (kind "preview"), loaded on the
   * §16 path (hidden until load-finished, then revealed), never in layout or
   * audio focus. One per App: reopening navigates the existing surface.
   */
  openAppSurface(appId: string, profile: string, url: string, adapter: string | null): string {
    const id = `app:${appId}:preview`;
    if (this.previews.has(id) && this.surfaces.has(id)) {
      void this.drivers.surface.navigate(id, url);
      return id;
    }
    this.previews.set(id, { app: appId, profile, adapter });
    void (async () => {
      await this.drivers.surface.create({ id, profile, background: this.doc?.theme?.background ?? DEFAULT_BACKGROUND, kind: "preview", blocking: true });
      this.surfaces.add(id);
      await this.drivers.surface.setZ(id, 900);                       // above the wall, below popups (950) and the pill
      await this.drivers.surface.navigate(id, url);
    })().catch(() => { /* reported by the shell's status line */ });
    return id;
  }

  closeAppSurface(id: string): boolean {
    const p = this.previews.get(id);
    if (p) this.lastClosedPreview = { profile: p.profile, url: this.currentUrl.get(id), np: this.nowPlaying.get(id) ?? null, at: Date.now() };
    this.nowPlaying.delete(id); this.currentUrl.delete(id);
    if (!this.previews.delete(id)) return false;
    if (this.surfaces.has(id)) { this.surfaces.delete(id); void this.drivers.surface.destroy(id); }
    return true;
  }

  /** Ids of open preview surfaces with their Apps (state / debugging). */
  previewSurfaces(): Array<{ id: string; app: string }> {
    return [...this.previews].map(([id, p]) => ({ id, app: p.app }));
  }

  private async onPreviewEvent(event: SurfaceEvent): Promise<void> {
    const p = this.previews.get(event.id)!;
    if (event.type === "load-finished" && event.ok) {
      await this.drivers.surface.inject(event.id, null, FRAME_PRELUDE_JS);
      const spec = p.adapter ? this.adapters.get(p.adapter) : undefined;
      if (spec) await this.drivers.surface.inject(event.id, spec.css ?? null, adapterScript(spec));   // the App's adapter, the music scripts too (B-129: the preview names what it plays)
      await this.drivers.surface.reveal(event.id, 220);
    }
    // navigated / now-playing / playback on a preview: nothing to orchestrate (the setup UI reads the URL itself)
  }

  /* ------------------------------ scene hooks / music (§32) / presence ---- */

  private sceneHooks: SceneHooks | null = null;
  private readonly music = new MusicStateModel();
  /** §26 tiles whose page is in element fullscreen (shell-reported). */
  private readonly elementFullscreen = new Set<string>();

  /* ------------------------------ §26 presentation keeping (standing instruction) ----- */

  /**
   * One keeper state per surface whose tile carries `presentation` (the
   * scene assignment's keepPresentation / onEnd). Fed from the events the
   * shell already posts: interaction → user-input, fullscreen-element →
   * presentation state, ad-break, playback{ended} → ended. Actions come out
   * of the machine only under the instruction and are applied in ONE place
   * (applyPresentationAction) through the adapter's named presentation
   * control - never a guess, never a timer.
   */
  private readonly keeper = new PresentationKeeperRunner();
  private readonly keeperTicks = new Map<string, ReturnType<typeof setTimeout>>();

  private dropKeeper(tileId: string): void {
    this.keeper.detach(tileId);
    clearTimeout(this.keeperTicks.get(tileId));
    this.keeperTicks.delete(tileId);
  }

  private async feedKeeper(tileId: string, event: KeeperEvent): Promise<void> {
    const tile = this.tile(tileId);
    const p = tile?.presentation;
    if (!tile || !p) {
      if (this.keeper.has(tileId)) this.keeper.detach(tileId);
      return;
    }
    // attach keeps existing state; settings / adapter follow the current tile
    this.keeper.attach(tileId, p, tile.adapter ? this.adapters.get(tile.adapter) : undefined);
    const actions = this.keeper.handle(tileId, event);
    if (event.type === "presentation" && event.state === "none") {
      // a drop waits CORRELATION_MS for its ad-break / ended signal; a tick then settles it (doubt → nothing)
      clearTimeout(this.keeperTicks.get(tileId));
      this.keeperTicks.set(tileId, setTimeout(() => {
        this.keeperTicks.delete(tileId);
        void this.feedKeeper(tileId, { type: "tick", at: Date.now() });
      }, CORRELATION_MS + 50));
    }
    for (const a of actions) await this.applyPresentationAction(tileId, a);
  }

  /** THE call site for presentation actions: the keeper's resolved JS (the adapter's own control), or nothing. */
  private async applyPresentationAction(tileId: string, r: ResolvedPresentationAction): Promise<void> {
    if (!this.surfaces.has(tileId)) return;
    if (r.js) { await this.drivers.surface.inject(tileId, null, r.js); return; }
    // no adapter control for it: enterFullscreen / enterTheater degrade to nothing (never a generic hunt);
    // `play` under onEnd replays the media element itself - driving playback under a standing instruction,
    // the same class as start-paused (see adapters.ts on the HTMLMediaElement boundary)
    if (r.action.kind === "play") {
      await this.drivers.surface.inject(tileId, null, "document.querySelectorAll('video,audio').forEach(function(m){try{m.currentTime=0;m.play()}catch(e){}})");
    }
  }
  /** §30 popup child surfaces open right now. */
  private readonly popups = new Map<string, { opener: string; url?: string }>();

  setSceneHooks(hooks: SceneHooks | null): void {
    this.sceneHooks = hooks;
  }

  /** The wall becomes the named scene of the model (false when no model / unknown scene). */
  async sceneApply(sceneId: string): Promise<boolean> {
    if (!this.sceneHooks || !this.sceneHooks.ids().includes(sceneId)) return false;
    await this.sceneHooks.apply(sceneId);
    return true;
  }

  /** §6a what an on-scene item is in the scene model (facet + app), when a model is attached. */
  itemContext(itemId: string): { facet?: string | null; app?: string | null } | null {
    return this.sceneHooks?.itemContext?.(itemId) ?? null;
  }

  /** Carousel over the model's scenes (§9): the next/previous scene becomes the wall. */
  async sceneStep(direction: 1 | -1): Promise<string | null> {
    const hooks = this.sceneHooks;
    if (!hooks) return null;
    const ids = hooks.ids();
    if (ids.length < 2) return null;
    const at = ids.indexOf(hooks.active() ?? "");
    const next = ids[(at + direction + ids.length) % ids.length]!;
    await hooks.apply(next);
    return next;
  }

  /** §32 Layer 2: the page's Media Session observation, reduced into the music model for hidden music facets. */
  private async onMusicObservation(tileId: string, info: NowPlaying | null): Promise<void> {
    if (!this.music.source(tileId)) return;
    const idleLibrary = !!info && !info.title && !info.playing && !!info.library;   // lists while idle: the session is gone, the lists are kept
    const events: MediaSessionEvent[] = info && !idleLibrary
      ? [
          { type: "metadata", metadata: { ...(info.title !== undefined ? { title: info.title } : {}), ...(info.artist !== undefined ? { artist: info.artist } : {}), ...(info.album !== undefined ? { album: info.album } : {}), artwork: info.artwork ?? null } },
          { type: "playbackState", state: info.playing ? "playing" : "paused" },
          { type: "position", position: info.position ?? null, duration: info.duration ?? null },
          { type: "actions", actions: info.actions ?? [] },
        ]
      : [{ type: "gone" }];
    for (const e of events) this.music.onMediaSession(tileId, e);
    for (const t of this.doc?.tiles ?? []) if (t.visualization?.source === tileId) await this.pushFeed(t);
    const ctx = info?.context && typeof info.context === "object" ? info.context : null;
    // the pending pick: the page playing that collection clears it; the page's own word that the play failed marks it
    const pend = this.musicPending.get(tileId);
    if (pend) {
      const ps = info?.playState && typeof info.playState === "object" ? info.playState : null;
      // no MusicKit instance = the page is signed out (the service's own word); the wall says "sign in", not "couldn't start"
      if (ps?.id === pend.id && typeof ps.status === "string" && ps.status.startsWith("error")) pend.failed = ps.status.includes("no-musickit") ? "needs-signin" : ps.status;
      else if (info?.playing && (pend.kind === "play" || (!!ctx?.url && ctx.url.includes(pend.id)) || (!!ctx?.label && ctx.label === pend.name) || (!!pend.url && (ctx?.url === pend.url || this.currentUrl.get(tileId) === pend.url))
        || (pend.kind === "station" && !!pend.title && !!ctx?.label && normalizeTrackText(ctx.label).includes(normalizeTrackText(pend.title))))) this.musicPending.delete(tileId);   // B-181: a Play's wait ends with any playing; B-218: a station named after the song (Pandora: "<song> Radio")
    }
    // the service's library, as the page reported it (the adapter's musicLibrary script): kept for the quick-play menu
    if (info?.library && typeof info.library === "object" && this.doc && this.drivers.store) {
      const clean = (l: unknown): LibraryItem[] => Array.isArray(l) ? l.filter((x): x is LibraryItem => !!x && typeof x === "object" && typeof (x as LibraryItem).id === "string" && typeof (x as LibraryItem).name === "string").slice(0, 200) : [];
      const lib = { playlists: clean(info.library.playlists), stations: clean(info.library.stations) };
      if (lib.playlists.length || lib.stations.length) {
        this.libraryCache.set(tileId, lib);
        try { void this.drivers.store.set(this.libraryKey(this.doc.id, tileId), JSON.stringify(lib)); } catch { /* best effort */ }
      }
    }
    // B-216: a station the page plays is kept by the wall, whether the service lists it or not (Apple never lists a song station)
    if (info?.playing && ctx?.kind === "station") void this.rememberStationMade(tileId, ctx);
    if (info?.playing && ctx?.trackId) this.noteOrderSpot(tileId, ctx.trackId, ctx);   // 2026-09-17: the saved spot in a Prism-ordered play follows a PLAYING face of the wall's own queue
    if (info?.playing) void this.applyPendingSwitches(tileId);   // 2026-09-18: a page-route play's shuffle / repeat, once its page plays
    void this.watchStall(tileId, info, ctx);   // 2026-09-18: a player that says playing while its clock stands still
    // §32 resume point: the page something was PLAYING from (the album / playlist / station page), with what it
    // was, so Play on a fresh wall can go back there and press the page's own Play. Only ever what Prism saw play.
    // B-225 (2026-09-17): never an ad - Pandora's break names its face "Advertisement / Your station will be right
    // back." and the row read it as the station's last track; a face under a break (the adapter's ad signal, or the
    // keeper's cover) is the break, not the collection. The station played before it stays the resume point.
    const underBreak = this.adActive.has(tileId) || this.intermission.isCovered(tileId);
    if (info?.playing && info.title && this.doc && this.drivers.store && !underBreak) {
      // the page's own word about the collection wins (a station started from Home never navigates anywhere)
      const rawUrl = (ctx?.url && /^https?:\/\//.test(ctx.url) ? ctx.url : null) ?? this.currentUrl.get(tileId) ?? this.tile(tileId)?.url;
      const url = rawUrl ? normalizeCollectionUrl(rawUrl) : rawUrl;
      if (url) {
        const point = { url, title: info.title, ...(info.artist ? { artist: info.artist } : {}), ...(info.album ? { album: info.album } : {}), ...(ctx?.label ? { label: ctx.label } : {}), ...(ctx?.kind ? { kind: ctx.kind } : {}), ...(ctx?.id ? { id: ctx.id } : {}), at: Date.now() };
        try { void this.drivers.store.set(this.resumeKey(this.doc.id, tileId), JSON.stringify(point)); } catch { /* best effort */ }
        this.resumeCache.set(tileId, point);   // B-204: the wall row reads it without a store round-trip
        void this.rememberRecent(tileId, point);
      }
    }
  }

  /**
   * Quick play (2026-09-06): the last few collections - album, playlist, station pages - this tile
   * played from, most recent first, one entry per page. The label is what the page's address and the
   * track's metadata say (an album's name; a playlist's or station's slug), never a guess beyond that.
   */
  async recentMusic(tileId: string): Promise<RecentMusic[]> {
    if (!this.doc || !this.drivers.store) return [];
    try {
      const raw = await this.drivers.store.get(this.recentKey(this.doc.id, tileId));
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      const out = (!Array.isArray(list) ? [] : list.filter((e): e is RecentMusic => !!e && typeof e === "object" && typeof (e as RecentMusic).url === "string" && typeof (e as RecentMusic).label === "string").slice(0, Orchestrator.RECENT_MAX))
        .map((e) => ({ ...e, url: normalizeCollectionUrl(e.url) }))   // B-124: a stored bad address heals on read
        // B-173 (2026-09-08): an album entry labelled with its own track's title named a song, not a collection (Spotify's
        // context read took the now-playing bar's track link text for the name); the album the track carries is the collection
        .map((e) => (e.kind === "album" && e.album && e.title && e.label === e.title && e.label !== e.album ? { ...e, label: e.album } : e));
      this.recentCache.set(tileId, out);
      return out;
    } catch { return []; }
  }

  /**
   * B-124 recovery (2026-09-07): a WebView that booted on a page the service could not serve stays
   * stranded - Apple Music's app aborted its boot on the route's 404 and every later document in that
   * WebView came up signed out, while a fresh surface signed in fine. When App setup closes (the sign-in
   * wizard, the rail's Setup mode), the App's wall surfaces are destroyed and created again through the
   * ordinary apply path: a new engine, the App's own profile, the remembered page. Returns how many.
   */
  async recycleAppSurfaces(profile: string): Promise<number> {
    if (!this.doc) return 0;
    const ids = this.doc.tiles.filter((t) => !t.visualization && !t.placeholder && (t.profile ?? t.id) === profile && this.surfaces.has(t.id)).map((t) => t.id);
    for (const id of ids) {
      this.refresh.stop(id);
      this.lifecycle.drop(id);
      await this.drivers.surface.destroy(id);
      this.surfaces.delete(id);
      this.dropKeeper(id);
      this.sessionState.delete(id);
      this.nowPlaying.delete(id);
      this.musicPending.delete(id);
    }
    if (ids.length) await this.applyDocument(this.doc);
    const carry = this.lastClosedPreview;
    if (carry && carry.profile === profile && carry.np?.playing && Date.now() - carry.at < 60_000) {
      this.lastClosedPreview = null;
      const tile = this.doc.tiles.find((t) => (t.profile ?? t.id) === profile && this.music.source(t.id));
      if (tile) {
        const ctx = carry.np.context && typeof carry.np.context === "object" ? carry.np.context : null;
        const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
        const kind = ctx?.kind && /^(playlist|station|album)$/.test(ctx.kind) ? ctx.kind : null;
        this.lastInteract.set(tile.id, Date.now());   // the person pressed play in setup: a human's play
        if (spec?.musicPlay && ctx?.id && kind) {
          await this.drivers.surface.inject(tile.id, null, `window.__prismMusicPlay && window.__prismMusicPlay(${JSON.stringify(kind)}, ${JSON.stringify(ctx.id)})`);
          this.setMusicPending(tile.id, { kind, id: ctx.id, name: ctx.label ?? carry.np.title ?? kind });
        } else {
          const url = ctx?.url && /^https?:\/\//.test(ctx.url) ? normalizeCollectionUrl(ctx.url) : carry.url;
          if (url) await this.playByAddress(tile.id, url, ctx?.label ?? carry.np.title ?? "the player", kind ?? "page");
        }
      }
    }
    return ids.length;
  }

  /** The service's library as last reported (playlists, stations), from the cache or the store. */
  async musicLibrary(tileId: string): Promise<{ playlists: LibraryItem[]; stations: LibraryItem[] }> {
    await this.loadStationsMade(tileId);
    const merged = (lib: { playlists: LibraryItem[]; stations: LibraryItem[] }) => this.withStationsMade(tileId, lib);
    const cached = this.libraryCache.get(tileId);
    if (cached) return merged(cached);
    if (!this.doc || !this.drivers.store) return merged({ playlists: [], stations: [] });
    try {
      const raw = await this.drivers.store.get(this.libraryKey(this.doc.id, tileId));
      const p = raw ? (JSON.parse(raw) as { playlists?: LibraryItem[]; stations?: LibraryItem[] }) : {};
      const lib = { playlists: Array.isArray(p.playlists) ? p.playlists : [], stations: Array.isArray(p.stations) ? p.stations : [] };
      this.libraryCache.set(tileId, lib);
      return merged(lib);
    } catch { return merged({ playlists: [], stations: [] }); }
  }
  musicLibraryNow(tileId: string): { playlists: LibraryItem[]; stations: LibraryItem[] } {
    const c = this.libraryCache.get(tileId);
    if (!c) void this.musicLibrary(tileId);
    return this.withStationsMade(tileId, c ?? { playlists: [], stations: [] });
  }

  /**
   * B-216 (2026-09-16): "it appears to have started a new station in Apple Music ... but it doesn't add it to my Apple Music
   * stations list". A station created from a song (Apple: ra.cp-<song>) is not on Apple's recent-radio list, which is what
   * the page's Stations come from - so the wall keeps its own list of the stations it has heard the page play, per service,
   * and lists them with the page's (same id = the page's entry). Recorded from the playing context, which carries the id
   * and the name; a wall with nothing kept yet starts from the stations among its recents (the one made before this shipped).
   */
  private readonly stationsMade = new Map<string, LibraryItem[]>();
  private stationsMadeKey(dashId: string, tileId: string): string { return `music:stations-kept:${dashId}:${tileId}`; }
  static readonly STATIONS_MADE_MAX = 30;
  private async loadStationsMade(tileId: string): Promise<void> {
    if (this.stationsMade.has(tileId) || !this.doc || !this.drivers.store) return;
    let list: LibraryItem[] = [];
    try {
      const raw = await this.drivers.store.get(this.stationsMadeKey(this.doc.id, tileId));
      const p = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(p)) list = p.filter((x): x is LibraryItem => !!x && typeof x === "object" && typeof (x as LibraryItem).id === "string" && typeof (x as LibraryItem).name === "string");
    } catch { /* none */ }
    if (!list.length) {   // nothing kept yet: the stations among the recents (played before the kept list existed)
      try { list = (await this.recentMusic(tileId)).filter((e) => e.kind === "station" && !!e.id).map((e) => ({ id: e.id!, name: e.label, kind: "station" as const, url: e.url })); } catch { /* none */ }
      if (list.length) { try { await this.drivers.store.set(this.stationsMadeKey(this.doc.id, tileId), JSON.stringify(list)); } catch { /* best effort */ } }   // kept, so the recents rolling on cannot lose it
    }
    if (!this.stationsMade.has(tileId)) this.stationsMade.set(tileId, list);
  }
  private withStationsMade(tileId: string, lib: { playlists: LibraryItem[]; stations: LibraryItem[] }): { playlists: LibraryItem[]; stations: LibraryItem[] } {
    const made = this.stationsMade.get(tileId);
    if (!made?.length) return lib;
    // B-229 (2026-09-17): the same station under three ids - the page's own, a kept one, and a name-only one from a play the
    // page could not pin an id to ("All Hits Radio" three times) - is one station to a person. The page's entry wins; a
    // kept one joins only when neither its id nor its name is listed already.
    const seenId = new Set(lib.stations.map((s) => s.id));
    const seenName = new Set(lib.stations.map((s) => normalizeTrackText(s.name)));
    const extra: LibraryItem[] = [];
    for (const s of made) {
      const n = normalizeTrackText(s.name);
      if (seenId.has(s.id) || seenName.has(n)) continue;
      seenId.add(s.id); seenName.add(n); extra.push(s);
    }
    return { playlists: lib.playlists, stations: [...lib.stations, ...extra] };
  }
  private async rememberStationMade(tileId: string, ctx: NowPlaying["context"] | null): Promise<void> {
    if (!ctx || ctx.kind !== "station" || !ctx.id || !ctx.label) return;
    await this.loadStationsMade(tileId);
    // B-229: a name-only id (the adapter's "station:<slug>" when the page showed no item for the play) is the same station
    // as one kept under a real id - one entry per name; a real id replaces a name-only twin, never the other way round
    const nameOnly = (id: string) => /^[a-z]+:[a-z0-9-]+$/.test(id);
    const label = normalizeTrackText(ctx.label);
    const kept = this.stationsMade.get(tileId) ?? [];
    const twin = kept.find((s) => s.id !== ctx.id && normalizeTrackText(s.name) === label);
    if (twin && nameOnly(ctx.id) && !nameOnly(twin.id)) return;   // the real one is kept already; the nameless play adds nothing
    const list = kept.filter((s) => s.id !== ctx.id && !(twin && s.id === twin.id));
    list.unshift({ id: ctx.id, name: ctx.label, kind: "station", ...(ctx.url ? { url: ctx.url } : {}) });
    this.stationsMade.set(tileId, list.slice(0, Orchestrator.STATIONS_MADE_MAX));
    if (this.doc && this.drivers.store) { try { await this.drivers.store.set(this.stationsMadeKey(this.doc.id, tileId), JSON.stringify(this.stationsMade.get(tileId))); } catch { /* best effort */ } }
  }

  /**
   * Quick play from the library: queue a collection by id through the adapter's musicPlay script and
   * play it. Only an id the page itself listed (library or recent) is accepted - a remote cannot make
   * the player queue an arbitrary thing.
   */
  async playCollection(tileId: string, kind: string, id: string, asked: PlayOrder | "auto" = "auto"): Promise<"ok" | "unknown-tile" | "unknown" | "unsupported"> {
    const tile = this.tile(tileId);
    if (!tile) return "unknown-tile";
    const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
    const lib = await this.musicLibrary(tileId);
    let item = [...lib.playlists, ...lib.stations].find((x) => x.id === id && x.kind === kind);
    if (!item) {
      // 2026-09-18: the order button acts on what is PLAYING, and an album the page plays is never in the library's lists -
      // the page named it (its context), so it is as listed as anything the page returned; the standing order's own id too
      const held = this.heldCollection(tileId);
      const standing = this.musicOrder.get(tileId);
      if (held && held.kind === kind && held.id === id) item = { id, name: held.label ?? id, kind: kind as LibraryItem["kind"], ...(held.url ? { url: held.url } : {}) };
      else if (standing && standing.kind === kind && standing.id === id) item = { id, name: standing.name, kind: kind as LibraryItem["kind"] };
    }
    if (!item) return "unknown";
    // "auto" is the plain press (a Quick play row, 2026-09-17): a Prism-ordered play of THIS collection with a saved spot carries
    // on from it; anything else plays in order. An order named outright (the transport's order button) always starts afresh.
    let order: PlayOrder = "normal";
    if (asked === "auto") {
      const o = this.musicOrder.get(tileId);
      if (o && o.kind === kind && o.id === id && o.ids?.length && await this.continueOrder(tileId)) return "ok";
    } else {
      if (!isPlayOrder(asked)) return "unsupported";
      order = asked;
    }
    if (kind === "station" && order !== "normal") return "unsupported";   // a station has no order to give
    const support = this.musicOrderSupport(tileId);
    if (!spec?.musicPlay && !(spec?.musicTracks && spec?.musicQueue && (order === "true-shuffle" || order === "reverse"))) {
      // a service with no in-page player API (Spotify, Pandora): the page listed the collection with its
      // address, so go there and press the page's own Play - the resume path, at a page the page named.
      // 2026-09-18: its own shuffle and repeat switches follow once the page reports playing (pendingSwitches) - the
      // page may load afresh on the way, and the switches live on the page
      if (order === "shuffle" && support.shuffle !== true) return "unsupported";
      if ((order === "true-shuffle" || order === "reverse")) return "unsupported";
      this.arm(tileId);
      if (order === "shuffle") await this.setMusicOrder(tileId, { kind, id, name: item.name, order }); else await this.clearMusicOrder(tileId);
      // B-243 (2026-09-19): the page already holds this collection - nothing is sent to its page (a full load that stopped
      // Spotify's player). A plain press carries on with the switch flipped in place; an order named outright STARTS OVER in
      // that order through the page's own start-over ("I changed it to Shuffle, and it just changed the label, but never
      // changed or even paused the song"), which also stands down a Prism order's driver on the page.
      if (this.holdsCollection(tileId, kind, id)) {
        if (asked !== "auto" && spec?.musicStartOver) {
          await this.claimAudio(tileId);
          await this.drivers.surface.inject(tileId, null, `window.__prismMusicStartOver && window.__prismMusicStartOver(${JSON.stringify(kind)}, ${JSON.stringify(id)}, ${order === "shuffle"})`);
          if (spec?.musicRepeat) await this.drivers.surface.inject(tileId, null, `window.__prismMusicRepeat && window.__prismMusicRepeat(${this.musicRepeatOf(tileId)})`);
          this.setMusicPending(tileId, { kind, id, name: item.name });
          return "ok";
        }
        if (this.audio.isPlaying(tileId)) await this.claimAudio(tileId); else await this.resumeHeld(tileId);
        if (spec?.musicShuffle) await this.drivers.surface.inject(tileId, null, `window.__prismMusicShuffle && window.__prismMusicShuffle(${order === "shuffle"})`);
        if (spec?.musicRepeat) await this.drivers.surface.inject(tileId, null, `window.__prismMusicRepeat && window.__prismMusicRepeat(${this.musicRepeatOf(tileId)})`);
        return "ok";
      }
      if (!item.url || !/^https?:\/\//.test(item.url)) return "unsupported";
      this.pendingSwitches.set(tileId, { shuffle: spec?.musicShuffle ? order === "shuffle" : null, repeat: spec?.musicRepeat ? this.musicRepeatOf(tileId) : null, at: Date.now() });
      await this.playByAddress(tileId, item.url, item.name, kind);
      return "ok";
    }
    if (order === "shuffle" && support.shuffle !== true) return "unsupported";
    if ((order === "true-shuffle" || order === "reverse") && support.own !== true) return "unsupported";
    this.arm(tileId);   // B-126: a pick on the wall is a human's ask to HEAR it - the playback that follows is not autoplay
    if (order === "true-shuffle" || order === "reverse") {
      // Prism's order (spec 32 layer 5, 2026-09-17): the page's track list, put in order here, handed to the player's queue
      await this.claimAudio(tileId);
      const ids = await this.musicTracks(tileId, kind, id);
      if (!ids.length) return "unsupported";
      const ordered = orderTracks(ids, order);
      // 2026-09-18: no cap - the player gets the order in windows (the first now, the next appended as the spot nears its end)
      const token = this.musicToken("qu");
      const r = await this.askMusic(tileId, token, `window.__prismMusicQueue && window.__prismMusicQueue(${JSON.stringify(token)}, ${JSON.stringify(ordered.slice(0, this.orderWindow))}, ${JSON.stringify({ kind, id })})`, Orchestrator.TRACKS_TIMEOUT_MS);
      this.musicWork.delete(tileId);
      if (!r?.ok) return "unsupported";
      // no pending here: the queue answered after the player's own play() resolved, and a Prism-made queue names no
      // collection the pending could clear on (the page's container is the song, not the playlist)
      this.musicPending.delete(tileId);
      await this.setMusicOrder(tileId, { kind, id, name: item.name, order, count: ordered.length, ids: ordered, index: 0 });
      this.orderQueuedUpTo.set(tileId, Math.min(this.orderWindow, ordered.length));
      return "ok";
    }
    // the service's own order: its queue, and its shuffle switch set the way the person asked (off for "in order" - a
    // switch left on inside the player would shuffle a plain play too)
    const shuffleJs = spec.musicShuffle ? `window.__prismMusicShuffle && window.__prismMusicShuffle(${order === "shuffle"})` : null;
    if (asked === "auto" && this.holdsCollection(tileId, kind, id)) {   // B-140: the page still has it - the plain press carries on, no re-queue; an order named outright re-queues (starts over)
      await this.resumeHeld(tileId);
      if (shuffleJs) await this.drivers.surface.inject(tileId, null, shuffleJs);
      await this.applyServiceRepeat(tileId, this.musicRepeatOf(tileId));
      if (order === "shuffle") await this.setMusicOrder(tileId, { kind, id, name: item.name, order }); else await this.clearMusicOrder(tileId);
      return "ok";
    }
    await this.claimAudio(tileId);   // B-137: the quick jump - the other source goes quiet now; this one sounds the moment its queue starts
    if (shuffleJs) await this.drivers.surface.inject(tileId, null, shuffleJs);
    await this.applyServiceRepeat(tileId, this.musicRepeatOf(tileId));   // the standing repeat, on the service's own switch
    await this.drivers.surface.inject(tileId, null, `window.__prismMusicPlay && window.__prismMusicPlay(${JSON.stringify(kind)}, ${JSON.stringify(id)})`);
    this.setMusicPending(tileId, { kind, id, name: item.name });
    if (order === "shuffle") await this.setMusicOrder(tileId, { kind, id, name: item.name, order }); else await this.clearMusicOrder(tileId);
    return "ok";
  }

  // ---------------------------------------------------------------- play orders (spec 32 layer 5, 2026-09-17)
  /** What this service can do about order: true, or the reason it cannot (the menu's grey rows carry it). */
  musicOrderSupport(tileId: string): { shuffle: true | string; own: true | string; repeat: true | string } {
    const tile = this.tile(tileId);
    const spec = tile?.adapter ? this.adapters.get(tile.adapter) : undefined;
    const name = tile?.adapter ?? "this service";
    return {
      shuffle: spec?.musicShuffle ? true : `${name} has no shuffle switch the wall can reach yet`,
      own: spec?.musicTracks && spec?.musicQueue ? true : `true shuffle and reverse need ${name}'s track lists, and the wall can't read them yet`,
      repeat: spec?.musicRepeat ? true : `${name} has no repeat switch the wall can reach yet, but repeat works with Prism's true shuffle and reverse`,
    };
  }
  // ---------------------------------------------------------------- repeat (2026-09-18): a standing switch beside the order
  /** "We should have a repeat option with the sort order options but it needs to be one that can be enabled in addition to the selected order." Per tile, kept; the service's own repeat-all for its orders, Prism's next pass for Prism's. */
  private readonly musicRepeat = new Map<string, boolean>();
  private musicRepeatKey(dashId: string, tileId: string): string { return `music:repeat:${dashId}:${tileId}`; }
  musicRepeatOf(tileId: string): boolean { return this.musicRepeat.get(tileId) === true; }
  async setMusicRepeat(tileId: string, on: boolean): Promise<void> {
    this.musicRepeat.set(tileId, on);
    if (this.doc && this.drivers.store) { try { await this.drivers.store.set(this.musicRepeatKey(this.doc.id, tileId), on ? "1" : ""); } catch { /* best effort */ } }
    // a play in the service's order under way: its switch follows now; a Prism order repeats by Prism's hand (its player's repeat stays off)
    const o = this.musicOrder.get(tileId);
    const prism = !!o?.ids?.length;
    if (!prism) await this.applyServiceRepeat(tileId, on);
    else if (on) void this.extendOrderWindow(tileId);   // the list may already be at its end: the next pass, now
  }
  /** The service's own switches a page-route play still owes once its page reports playing (the page may have loaded afresh on the way). */
  private readonly pendingSwitches = new Map<string, { shuffle: boolean | null; repeat: boolean | null; at: number }>();
  private async applyPendingSwitches(tileId: string): Promise<void> {
    const p = this.pendingSwitches.get(tileId);
    if (!p) return;
    if (Date.now() - p.at > 60_000) { this.pendingSwitches.delete(tileId); return; }   // stale: the page never came back
    this.pendingSwitches.delete(tileId);
    const tile = this.tile(tileId);
    const spec = tile?.adapter ? this.adapters.get(tile.adapter) : undefined;
    if (p.shuffle !== null && spec?.musicShuffle) await this.drivers.surface.inject(tileId, null, `window.__prismMusicShuffle && window.__prismMusicShuffle(${p.shuffle})`);
    if (p.repeat !== null && spec?.musicRepeat) await this.drivers.surface.inject(tileId, null, `window.__prismMusicRepeat && window.__prismMusicRepeat(${p.repeat})`);
  }
  private async applyServiceRepeat(tileId: string, on: boolean): Promise<void> {
    const tile = this.tile(tileId);
    const spec = tile?.adapter ? this.adapters.get(tile.adapter) : undefined;
    if (!spec?.musicRepeat) return;
    await this.drivers.surface.inject(tileId, null, `window.__prismMusicRepeat && window.__prismMusicRepeat(${on})`);
  }
  private async loadMusicRepeat(tileId: string): Promise<void> {
    if (!this.doc || !this.drivers.store) return;
    try { const raw = await this.drivers.store.get(this.musicRepeatKey(this.doc.id, tileId)); if (raw === "1") this.musicRepeat.set(tileId, true); } catch { /* none */ }
  }
  /**
   * The track lists read, per tile: a read is slow (a page a second for a hundred tracks), so a list is kept for a while
   * and read AHEAD - the moment a playlist starts playing in any order, and when the order menu opens - so that a later
   * true shuffle or reverse starts at once ("couldn't it have taken that time to load the playlist order details so it
   * could be ready to run?", 2026-09-18).
   */
  private readonly trackLists = new Map<string, { kind: string; id: string; ids: string[]; at: number }>();
  private readonly trackReads = new Set<string>();
  /** How long a list read stays good for a later order (a setting so tests can ask for a fresh read every time). */
  tracksFreshMs = 30 * 60_000;
  /** Read this collection's tracks ahead of any order, once; a fresh list already read is left alone. */
  // (2026-09-24, "Why does it need to read them all if I've not yet done the true shuffle or any ordering config"): no read after a play any
  // more - Spotify's reader walked a 3,903-track playlist for a minute and the play waited behind it. The list is read when the order menu
  // opens (prepareOrder, from the host) or when True shuffle / Reverse is chosen.
  prepareOrder(tileId: string, kind: string, id: string): void {
    const tile = this.tile(tileId);
    const spec = tile?.adapter ? this.adapters.get(tile.adapter) : undefined;
    if (!spec?.musicTracks || kind === "station") return;
    const have = this.trackLists.get(tileId);
    if (have && have.kind === kind && have.id === id && Date.now() - have.at < this.tracksFreshMs) return;
    void this.musicTracks(tileId, kind, id);
  }
  /** The collection's track ids in the service's own order, from the page (the adapter's musicTracks script), or the list read a moment ago. Empty when it cannot say. */
  private async musicTracks(tileId: string, kind: string, id: string): Promise<string[]> {
    const have = this.trackLists.get(tileId);
    if (have && have.kind === kind && have.id === id && Date.now() - have.at < this.tracksFreshMs) return have.ids.slice();
    const key = tileId + "|" + kind + "|" + id;
    if (this.trackReads.has(key)) {   // a read is under way (the prefetch): wait for it rather than ask twice - and say so
      if (!this.musicWork.has(tileId)) this.musicWork.set(tileId, { what: "reading the track list", name: this.collectionName(tileId, kind, id), at: Date.now() });
      for (let i = 0; i < 1200 && this.trackReads.has(key); i++) await new Promise((r) => setTimeout(r, 200));
      const got = this.trackLists.get(tileId);
      return got && got.kind === kind && got.id === id ? got.ids.slice() : [];
    }
    // B-245 (2026-09-19): a read of another collection on this tile is superseded - its page has moved on with this one, and
    // its question would otherwise stand for four minutes while every later order on the tile waited on it in silence
    for (const [token, w] of this.musicResultWaits) {
      if (w.tileId === tileId && token.startsWith("tr")) w.resolve({ type: "music-result", id: tileId, token, op: "tracks", ok: false, error: "superseded by a newer read" });
    }
    for (const k of [...this.trackReads]) if (k.startsWith(tileId + "|") && k !== key) this.trackReads.delete(k);
    this.trackReads.add(key);
    try {
      const ids = await this.readTracks(tileId, kind, id);
      if (ids.length) this.trackLists.set(tileId, { kind, id, ids, at: Date.now() });
      return ids.slice();
    } finally { this.trackReads.delete(key); }
  }
  /**
   * The work in hand on a tile (2026-09-18, "we should have some kind of processing/loading indicator ... a status feed
   * at the top that slowly fades away"): a long read of a track list, with how far it has got when the page says. The
   * state carries it; the wall's feed reads it and says when it is done.
   */
  private readonly musicWork = new Map<string, { what: string; name: string; count?: number; total?: number; at: number; error?: string }>();
  private noteWork(tileId: string, count?: number, total?: number): void {
    const w = this.musicWork.get(tileId);
    if (!w) return;
    if (typeof count === "number") w.count = count;
    if (typeof total === "number") w.total = total;
  }
  private collectionName(tileId: string, kind: string, id: string): string {
    const lib = this.musicLibraryNow(tileId);
    return [...lib.playlists, ...lib.stations].find((x) => x.id === id && x.kind === kind)?.name ?? (kind === "album" ? "the album" : "the playlist");
  }
  private async readTracks(tileId: string, kind: string, id: string): Promise<string[]> {
    const name = this.collectionName(tileId, kind, id);
    this.musicWork.set(tileId, { what: "reading the track list", name, at: Date.now() });
    let error: string | null = null;
    try {
      const { ids, error: why } = await this.readTracksInner(tileId, kind, id);
      if (!ids.length) error = why ?? "the page listed no tracks";
      return ids;
    } finally {
      this.musicWork.delete(tileId);
      if (error) {   // 2026-09-19: a failed read is said in the feed, not only logged - a dead end a person can see
        const note = { what: "could not read the track list", name, at: Date.now(), error };
        this.musicWork.set(tileId, note);
        setTimeout(() => { if (this.musicWork.get(tileId) === note) this.musicWork.delete(tileId); }, 12_000);
      }
    }
  }
  /** A page's progress under a queue question (Spotify reading its list again for the queue after a reload): the feed says so. */
  private noteQueueWork(tileId: string, kind: string, id: string, count?: number, total?: number): void {
    if (!this.musicWork.has(tileId)) this.musicWork.set(tileId, { what: "reading the track list", name: this.collectionName(tileId, kind, id), at: Date.now() });
    this.noteWork(tileId, count, total);
  }
  private async readTracksInner(tileId: string, kind: string, id: string): Promise<{ ids: string[]; error?: string }> {
    const token = this.musicToken("tr");
    const r = await this.askMusic(tileId, token, `window.__prismMusicTracks && window.__prismMusicTracks(${JSON.stringify(token)}, ${JSON.stringify(kind)}, ${JSON.stringify(id)})`, Orchestrator.TRACKS_TIMEOUT_MS);   // a hundred tracks a page: a page a second, give or take
    if (!r) return { ids: [], error: "the page did not answer" };
    if (!r.ok) return { ids: [], error: r.error || "the page could not read the list" };
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const c of r.candidates ?? []) { if (c && typeof c.id === "string" && c.id && !seen.has(c.id)) { seen.add(c.id); ids.push(c.id); } }
    return { ids: ids.slice(0, Orchestrator.ORDER_MAX_TRACKS) };
  }
  /** 2026-09-18: no practical cap - the order is handed to the player in windows; this is only a sanity ceiling on the read. */
  static readonly ORDER_MAX_TRACKS = 50_000;
  static readonly TRACKS_TIMEOUT_MS = 240_000;
  /** How many of the order the player holds at a time, and how close to the window's end the next one is appended. */
  orderWindow = 400;
  orderWindowAhead = 60;
  private readonly orderQueuedUpTo = new Map<string, number>();
  private readonly orderAppending = new Set<string>();
  /** The next window of a Prism-ordered play, appended after what the player holds (musicQueueAppend), once the spot nears the end of the handed part. */
  private async extendOrderWindow(tileId: string): Promise<void> {
    const o = this.musicOrder.get(tileId);
    const tile = this.tile(tileId);
    const spec = tile?.adapter ? this.adapters.get(tile.adapter) : undefined;
    if (!o?.ids?.length || !spec?.musicQueueAppend || this.orderAppending.has(tileId)) return;
    let upTo = this.orderQueuedUpTo.get(tileId);
    if (upTo === undefined) return;
    if ((o.index ?? 0) < upTo - this.orderWindowAhead) return;
    if (upTo >= o.ids.length) {
      // the whole list is handed: with repeat on, the next pass - a fresh draw for true shuffle, the same order for reverse -
      // joins the list (the list holds at most two passes: noteOrderSpot drops a pass once the spot is past it)
      if (!this.musicRepeatOf(tileId) || !o.count) return;
      const lastPass = o.ids.slice(-o.count);
      o.ids = o.ids.concat(o.order === "true-shuffle" ? orderTracks(lastPass, "true-shuffle") : lastPass.slice());   // a fresh draw, or the same way round again
      if (this.doc && this.drivers.store) { try { await this.drivers.store.set(this.musicOrderKey(this.doc.id, tileId), JSON.stringify(o)); } catch { /* best effort */ } }
      upTo = this.orderQueuedUpTo.get(tileId) ?? upTo;
    }
    this.orderAppending.add(tileId);
    try {
      const next = o.ids.slice(upTo, upTo + this.orderWindow);
      const token = this.musicToken("qa");
      const r = await this.askMusic(tileId, token, `window.__prismMusicQueueAppend && window.__prismMusicQueueAppend(${JSON.stringify(token)}, ${JSON.stringify(next)}, ${JSON.stringify({ kind: o.kind, id: o.id })})`);
      if (r?.ok && this.musicOrder.get(tileId) === o) this.orderQueuedUpTo.set(tileId, upTo + next.length);   // the same order still stands
    } finally { if (this.musicOrder.get(tileId) === o) this.orderAppending.delete(tileId); }
  }
  /** The standing play order per tile: the collection and the order it was asked in (the wall's block names it; a restart restores it). */
  private readonly musicOrder = new Map<string, { kind: string; id: string; name: string; order: PlayOrder; count?: number; ids?: string[]; index?: number; pass?: number; at: number }>();
  private musicOrderKey(dashId: string, tileId: string): string { return `music:order:${dashId}:${tileId}`; }
  private async setMusicOrder(tileId: string, o: { kind: string; id: string; name: string; order: PlayOrder; count?: number; ids?: string[]; index?: number }): Promise<void> {
    const rec = { ...o, at: Date.now() };
    this.orderAppending.delete(tileId);   // a new order: an append under way for the old one no longer holds the door
    this.musicOrder.set(tileId, rec);
    if (this.doc && this.drivers.store) { try { await this.drivers.store.set(this.musicOrderKey(this.doc.id, tileId), JSON.stringify(rec)); } catch { /* best effort */ } }
  }
  private async clearMusicOrder(tileId: string): Promise<void> {
    if (!this.musicOrder.delete(tileId)) return;
    if (this.doc && this.drivers.store) { try { await this.drivers.store.set(this.musicOrderKey(this.doc.id, tileId), ""); } catch { /* best effort */ } }
  }
  private async loadMusicOrder(tileId: string): Promise<void> {
    if (!this.doc || !this.drivers.store) return;
    try {
      const raw = await this.drivers.store.get(this.musicOrderKey(this.doc.id, tileId));
      if (!raw) return;
      const p = JSON.parse(raw) as { kind?: unknown; id?: unknown; name?: unknown; order?: unknown; count?: unknown; ids?: unknown; index?: unknown; at?: unknown };
      if (typeof p.kind !== "string" || typeof p.id !== "string" || typeof p.name !== "string" || !isPlayOrder(p.order)) return;
      const ids = Array.isArray(p.ids) ? p.ids.filter((x): x is string => typeof x === "string") : undefined;
      const pass = (p as { pass?: unknown }).pass;
      this.musicOrder.set(tileId, { kind: p.kind, id: p.id, name: p.name, order: p.order, ...(typeof p.count === "number" ? { count: p.count } : {}), ...(ids?.length ? { ids, index: typeof p.index === "number" && p.index >= 0 && p.index < ids.length ? p.index : 0 } : {}), ...(typeof pass === "number" ? { pass } : {}), at: typeof p.at === "number" ? p.at : 0 });
    } catch { /* unreadable: no order */ }
  }
  /** The standing order for the block: the order's words and the collection, when a stage draws this tile. */
  musicOrderOf(tileId: string): { kind: string; id: string; name: string; order: PlayOrder; label: string; count?: number; spot?: number; pass?: number } | null {
    const o = this.musicOrder.get(tileId);
    return o ? { kind: o.kind, id: o.id, name: o.name, order: o.order, label: playOrderLabel(o.order), ...(o.count !== undefined ? { count: o.count } : {}), ...(o.ids?.length ? { spot: (o.index ?? 0) + 1 } : {}), ...(o.pass !== undefined && o.pass > 1 ? { pass: o.pass } : {}) } : null;
  }
  /**
   * The saved spot (2026-09-17, "are we able to save our spot in that playlist?"): the player names the track it is on
   * (the adapter's context trackId), and when that track is in a Prism-ordered play the spot moves to it and is kept.
   * A plain Play or a switch to the service carries on from there (resumeMusic); any order verb starts a fresh play.
   */
  private noteOrderSpot(tileId: string, trackId: string, ctx: NowPlaying["context"] | null = null): void {
    const o = this.musicOrder.get(tileId);
    if (!o?.ids?.length) return;
    // B-233 (2026-09-18): a track played from ANOTHER collection (the page names a station, an album, a different playlist)
    // is not the order moving on, even when the same song sits in the order - a station's Moonlight sent the spot from 38
    // to 1143. The wall's queue names no collection (its container is the song); only that, or the order's own id, counts.
    if (ctx?.kind && ctx.id && ctx.id !== o.id && (ctx.kind === o.kind || ctx.kind === "station")) return;   // Spotify names the track's ALBUM as its context while a playlist order runs: not another collection
    const from = o.index ?? 0;
    let i = -1;
    for (let k = from; k < o.ids.length && k < from + 3; k++) if (o.ids[k] === trackId) { i = k; break; }   // the next few first: a press of Next is the common move
    if (i < 0) i = o.ids.indexOf(trackId);
    if (i < 0 || i === o.index) return;
    o.index = i; o.at = Date.now();
    // repeat: once the spot is past a whole pass and another is there, the pass behind is dropped (the list stays two passes at most)
    if (o.count && o.index >= o.count && o.ids.length >= 2 * o.count) {
      o.ids = o.ids.slice(o.count); o.index -= o.count; o.pass = (o.pass ?? 1) + 1;
      const upTo = this.orderQueuedUpTo.get(tileId); if (upTo !== undefined) this.orderQueuedUpTo.set(tileId, Math.max(0, upTo - o.count));
    }
    if (this.doc && this.drivers.store) { try { void this.drivers.store.set(this.musicOrderKey(this.doc.id, tileId), JSON.stringify(o)); } catch { /* best effort */ } }
    void this.extendOrderWindow(tileId);   // 2026-09-18: the next window, before this one runs out
  }
  /**
   * The stall watchdog (2026-09-18): Apple's player sat at 31 s of BLAME THE MOON for minutes saying "playing" - its media
   * source had the current frame and nothing after it, the stream fetched the night before having expired across an
   * eleven-hour pause - and the wall, which had asked for that play, watched it loop. A face that says playing, from the
   * tile that owns the audio, outside a break, whose clock has not moved for STALL_MS while faces keep arriving, is a
   * stall. For a Prism-ordered play the remedy is the wall's own: the queue again from the saved spot; a second stall on
   * the same track skips it (the track itself is the fault); a third stands - the state says so and nothing more is tried
   * until the track changes. Other plays are only noted: their remedy is the service's, not the wall's.
   */
  private readonly stallWatch = new Map<string, { track: string; pos: number; since: number; strikes: number; recovering: boolean }>();
  static readonly STALL_MS = 10_000;
  private async watchStall(tileId: string, info: NowPlaying | null, ctx: NowPlaying["context"] | null): Promise<void> {
    const pos = typeof info?.position === "number" ? info.position : typeof ctx?.position === "number" ? ctx.position : null;
    const track = ctx?.trackId || info?.title || "";
    if (!info?.playing || pos === null || !track) { this.stallWatch.delete(tileId); return; }
    const now = Date.now();
    const w = this.stallWatch.get(tileId);
    if (!w || w.track !== track) { this.stallWatch.set(tileId, { track, pos, since: now, strikes: 0, recovering: false }); return; }
    if (Math.abs(pos - w.pos) > 0.05) { w.pos = pos; w.since = now; return; }
    if (w.recovering || now - w.since < Orchestrator.STALL_MS) return;
    if (this.audio.focusedMedia !== tileId || this.adActive.has(tileId) || this.intermission.isCovered(tileId) || this.musicPending.has(tileId)) return;
    const o = this.musicOrder.get(tileId);
    w.strikes++; w.since = now;
    if (!o?.ids?.length) { this.noteStall(tileId, w.strikes, null); return; }   // not the wall's queue: noted, not touched
    if (w.strikes >= 3) { this.noteStall(tileId, w.strikes, null); return; }
    if (w.strikes === 2) o.index = Math.min((o.index ?? 0) + 1, o.ids.length - 1);   // the track itself is the fault: past it
    w.recovering = true;
    try {
      const ok = await this.continueOrder(tileId);
      this.noteStall(tileId, w.strikes, ok ? (o.index ?? 0) + 1 : null);
    } finally { w.recovering = false; w.since = Date.now(); }
  }
  /** What the state says about the last stall on this tile: the strike, and the spot the queue was re-run from (null = not recovered). */
  private readonly stallNotes = new Map<string, { at: number; strikes: number; spot: number | null }>();
  private noteStall(tileId: string, strikes: number, spot: number | null): void {
    this.stallNotes.set(tileId, { at: Date.now(), strikes, spot });
  }
  /** Continue a Prism-ordered play from its saved spot: the rest of the order, in order, to the player's queue. False when there is no spot to continue. */
  private async continueOrder(tileId: string): Promise<boolean> {
    if (!this.musicOrder.has(tileId)) await this.loadMusicOrder(tileId);   // B-233: a boot's first Play can come before the priming finished
    const o = this.musicOrder.get(tileId);
    const tile = this.tile(tileId);
    const spec = tile?.adapter ? this.adapters.get(tile.adapter) : undefined;
    if (!o?.ids?.length || !spec?.musicQueue) return false;
    const from = Math.min(o.index ?? 0, o.ids.length - 1);
    this.arm(tileId);
    await this.claimAudio(tileId);
    const token = this.musicToken("qu");
    const r = await this.askMusic(tileId, token, `window.__prismMusicQueue && window.__prismMusicQueue(${JSON.stringify(token)}, ${JSON.stringify(o.ids.slice(from, from + this.orderWindow))}, ${JSON.stringify({ kind: o.kind, id: o.id })})`, Orchestrator.TRACKS_TIMEOUT_MS);
    this.musicWork.delete(tileId);
    if (!r?.ok) return false;
    this.musicPending.delete(tileId);
    this.orderQueuedUpTo.set(tileId, Math.min(from + this.orderWindow, o.ids.length));
    return true;
  }

  // ---------------------------------------------------------------- Quick play: the song playing now, on another service
  // 2026-09-16: "if I hear something on Spotify and am managing a playlist on Apple, I can add the song (if available
  // on the Apple service) to my Apple service." Opening a service's Quick play entry asks THAT service's page - its
  // adapter's musicLookup script, the service's own catalog API in the person's own session - for the song the wall
  // is playing now; core decides whether a candidate is the song (music-lookup.ts, strict on purpose), then offers
  // two verbs the page can carry out: add it to one of the account's playlists, or seed a station from it. Nothing
  // leaves the machine but the service's own requests (section 19); only ids the page itself returned or listed are
  // ever sent back to it (the same guard as playCollection).
  private readonly musicLookups = new Map<string, MusicLookupState>();
  /** Open questions to pages, by token: bound to the tile asked, so another tile's page cannot answer for it (review, 2026-09-16). */
  private readonly musicResultWaits = new Map<string, { tileId: string; resolve: (r: MusicResultEvent) => void; partial?: (r: MusicResultEvent) => void }>();
  private musicTokenSeq = 0;
  static readonly MUSIC_RESULT_TIMEOUT_MS = 8_000;

  /**
   * The song on the wall now: the audio owner's face, else the face a stage draws (paused counts), else the one face
   * that says playing. B-214 (2026-09-16): "The music is currently paused, and the menus to perform the cross-service
   * lookup of the song don't appear to work while paused ... the song is on the screen so the required information should
   * be there" - the stage keeps a paused track's title up (the 2026-09-06 ask), so the lookup reads the same face the wall shows.
   */
  currentSong(): { title: string; artist?: string; album?: string; artwork?: string; durationMs?: number; from: string } | null {
    const pick = (id: string) => {
      const np = this.nowPlaying.get(id);
      const secs = typeof np?.duration === "number" && np.duration > 0 ? np.duration : typeof np?.context?.duration === "number" && np.context.duration > 0 ? np.context.duration : 0;   // the face's clock, seconds - a confidence signal for the lookup
      return np?.title ? { title: np.title, ...(np.artist ? { artist: np.artist } : {}), ...(np.album ? { album: np.album } : {}), ...(np.artwork ? { artwork: np.artwork } : {}), ...(secs ? { durationMs: Math.round(secs * 1000) } : {}), from: id } : null;
    };
    const owner = this.audio.focusedMedia;
    let found: ReturnType<typeof pick> = null;
    if (owner) found = pick(owner);
    if (!found) for (const t of this.doc?.tiles ?? []) if (t.visualization?.source && (found = pick(t.visualization.source))) break;
    if (!found) for (const [id, np] of this.nowPlaying) if (np.playing && np.title) { found = pick(id); break; }
    // A face can blink empty between ticks (Amazon Music's Media Session drops its metadata for a beat, 2026-09-16, and
    // a person's pick among candidates was wiped by an open that landed on the blank tick): the song seen within the
    // last few seconds still counts.
    if (found) { this.lastSongSeen = { song: found, at: Date.now() }; return found; }
    if (this.lastSongSeen && Date.now() - this.lastSongSeen.at < Orchestrator.SONG_BLINK_MS) return this.lastSongSeen.song;
    // B-228 (2026-09-17): no face anywhere, but the stage draws what its source would resume (B-204's block - the song a
    // person sees "paused and sitting on the wall" after a restart, before the page has named anything): that is the song
    for (const t of this.doc?.tiles ?? []) {
      const src = t.visualization?.source;
      const r = src ? this.resumeCache.get(src) : undefined;
      if (src && r?.title) return { title: r.title, ...(r.artist ? { artist: r.artist } : {}), ...(r.album ? { album: r.album } : {}), from: src };
    }
    return null;
  }
  private lastSongSeen: { song: { title: string; artist?: string; album?: string; artwork?: string; from: string }; at: number } | null = null;
  static readonly SONG_BLINK_MS = 8_000;

  private lookupBlank(status: MusicLookupState["status"], song: MusicLookupState["song"], key: string, reason?: string, action: MusicLookupState["action"] = null): MusicLookupState {
    return { status, song, key, match: null, candidates: [], ...(reason ? { reason } : {}), action, at: Date.now() };
  }

  /** The lookup as it stands for this service, with the playlists it may add to (its library as the page reported it). */
  musicLookupState(tileId: string): MusicLookupState & { playlists: Array<{ id: string; name: string; edit?: boolean }> } {
    const st = this.musicLookups.get(tileId) ?? this.lookupBlank("idle", null, "");
    const playlists = this.musicLibraryNow(tileId).playlists.map((p) => ({ id: p.id, name: p.name, ...(p.edit === undefined ? {} : { edit: p.edit }) }));
    return { ...st, playlists };
  }

  /**
   * Ask this service's page for the song playing now. Idempotent per (service, song): a second open of the same
   * menu reads the answer already there; a new song asks again. Resolves when the state settles (found /
   * ambiguous / not-found / unavailable / error) and returns that status.
   */
  async musicLookup(tileId: string): Promise<MusicLookupState["status"]> {
    const tile = this.tile(tileId);
    if (!tile) return "unavailable";
    const song = this.currentSong();
    const prev = this.musicLookups.get(tileId);
    if (!song) {
      if (prev && prev.song && (prev.status === "found" || prev.status === "ambiguous" || prev.status === "not-found")) return prev.status;   // a settled answer outlives a blank beat
      this.musicLookups.set(tileId, { ...this.lookupBlank("unavailable", null, "", "nothing is playing on the wall"), why: "no-song" });
      return "unavailable";
    }
    const key = normalizeTrackText(song.title) + "|" + normalizeTrackText(song.artist);
    const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
    // B-227 (2026-09-17): the page's playlists as of NOW - a list made a minute ago (on the phone, or on the page itself)
    // reaches the wall's menu only through the page's next report, and an idle page reports rarely; opening the entry
    // asks for one, whether or not the song's answer is already there
    if (spec?.musicLookup) void this.drivers.surface.inject(tileId, null, "window.__prismReportNow && window.__prismReportNow()");
    if (prev && prev.key === key && (prev.status === "found" || prev.status === "ambiguous" || prev.status === "not-found" || prev.status === "searching")) return prev.status;
    const q = { title: song.title, artist: song.artist, album: song.album, artwork: song.artwork, durationMs: song.durationMs };
    if (!spec?.musicLookup) {
      this.musicLookups.set(tileId, { ...this.lookupBlank("unavailable", q, key, spec?.musicLookupNote || "this service cannot be searched from the wall yet"), why: "no-lookup" });   // the adapter's own why, when it has one
      return "unavailable";
    }
    const carried = prev && prev.key === key ? prev.action : null;
    this.musicLookups.set(tileId, this.lookupBlank("searching", q, key, undefined, carried));
    const token = this.musicToken("lk");
    const ask = { ...q, term: lookupTerm(song) };
    const result = await this.askMusic(tileId, token, `window.__prismMusicLookup && window.__prismMusicLookup(${JSON.stringify(token)}, ${JSON.stringify(ask)})`);
    const cur = this.musicLookups.get(tileId);
    if (!cur || cur.key !== key || cur.status !== "searching") return cur?.status ?? "idle";   // superseded by a newer song
    if (!result) { this.musicLookups.set(tileId, { ...cur, status: "error", reason: "the page did not answer", at: Date.now() }); return "error"; }
    if (!result.ok) { this.musicLookups.set(tileId, { ...cur, status: "error", reason: result.error || "the service's search failed", at: Date.now() }); return "error"; }
    const candidates: TrackCandidate[] = (result.candidates ?? [])
      .filter((c) => c && typeof c.id === "string" && c.id && typeof c.title === "string")
      .map((c) => ({ id: c.id, title: c.title, artist: typeof c.artist === "string" ? c.artist : "", ...(c.album ? { album: c.album } : {}), ...(c.url ? { url: c.url } : {}), ...(c.isrc ? { isrc: c.isrc } : {}), ...(typeof c.durationMs === "number" ? { durationMs: c.durationMs } : {}), ...(typeof c.artwork === "string" && c.artwork ? { artwork: c.artwork } : {}) }));
    const verdict = matchTrack(q, candidates);
    const next: MusicLookupState = { ...cur, status: verdict.status, match: verdict.status === "found" ? verdict.match : null, candidates: verdict.candidates.slice(0, LOOKUP_CHOICES), ...(spec?.musicLookupCannot ? { cannot: spec.musicLookupCannot } : {}), at: Date.now() };
    delete next.reason; delete next.confidence; delete next.picked;
    if (verdict.status === "found") next.confidence = verdict.confidence;
    this.musicLookups.set(tileId, next);
    return next.status;
  }

  /** An ambiguous lookup: the person names the candidate that is the song. False when the id is not one the service offered. */
  musicLookupPick(tileId: string, songId: string): boolean {
    const st = this.musicLookups.get(tileId);
    const c = st?.candidates.find((x) => x.id === songId);
    if (!st || !c) return false;
    const next: MusicLookupState = { ...st, status: "found", match: c, picked: true, at: Date.now() };
    delete next.confidence;   // a person's pick needs no percent
    this.musicLookups.set(tileId, next);
    return true;
  }

  private lookupSong(tileId: string, songId: string): TrackCandidate | null {
    const st = this.musicLookups.get(tileId);
    if (!st) return null;
    if (st.match?.id === songId) return st.match;
    return st.candidates.find((x) => x.id === songId) ?? null;
  }

  private setLookupAction(tileId: string, action: MusicLookupState["action"]): void {
    const st = this.musicLookups.get(tileId) ?? this.lookupBlank("idle", null, "");
    this.musicLookups.set(tileId, { ...st, action });
  }

  /** Add the found song to one of the service's own playlists. Both ids must be ones the page returned or listed. */
  async musicAddToPlaylist(tileId: string, playlistId: string, songId: string): Promise<"ok" | "error" | "unknown" | "unknown-tile"> {
    const tile = this.tile(tileId);
    if (!tile) return "unknown-tile";
    const song = this.lookupSong(tileId, songId);
    const playlist = (await this.musicLibrary(tileId)).playlists.find((p) => p.id === playlistId);
    const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
    if (!song || !playlist || !spec?.musicLookup) return "unknown";
    this.setLookupAction(tileId, { op: "add", status: "pending", playlist: playlist.name, song: song.title, at: Date.now() });
    const token = this.musicToken("ad");
    const r = await this.askMusic(tileId, token, `window.__prismMusicAddToPlaylist && window.__prismMusicAddToPlaylist(${JSON.stringify(token)}, ${JSON.stringify(playlistId)}, ${JSON.stringify(songId)})`);
    const ok = !!r?.ok;
    const error: string | undefined = r ? r.error || "the service refused" : "the page did not answer";
    this.setLookupAction(tileId, { op: "add", status: ok ? "ok" : "error", playlist: playlist.name, song: song.title, ...(ok ? {} : { error: error || "the service refused" }), at: Date.now() });
    return ok ? "ok" : "error";
  }

  /** Start the service's station seeded from the found song - a human's pick, so it takes the audio (section 3) and the stage follows. */
  async musicStationFromSong(tileId: string, songId: string): Promise<"ok" | "error" | "unknown" | "unknown-tile"> {
    const tile = this.tile(tileId);
    if (!tile) return "unknown-tile";
    const song = this.lookupSong(tileId, songId);
    const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
    if (!song || !spec?.musicLookup) return "unknown";
    const name = song.title + " station";
    this.arm(tileId);
    await this.claimAudio(tileId);
    this.setLookupAction(tileId, { op: "station", status: "pending", song: song.title, at: Date.now() });
    this.setMusicPending(tileId, { kind: "station", id: songId, name, title: song.title });   // B-218: Pandora names the station after the song, not after an id
    const token = this.musicToken("st");
    const r = await this.askMusic(tileId, token, `window.__prismMusicStationFromSong && window.__prismMusicStationFromSong(${JSON.stringify(token)}, ${JSON.stringify(songId)})`);
    const ok = !!r?.ok;
    this.setLookupAction(tileId, { op: "station", status: ok ? "ok" : "error", song: song.title, ...(ok ? {} : { error: r ? r.error || "the service refused" : "the page did not answer" }), at: Date.now() });
    return ok ? "ok" : "error";
  }

  /** A token another page cannot guess: the sequence plus random bits (the page echoes it back; the tile id is checked as well). */
  private musicToken(prefix: string): string {
    let rand = "";
    try { const b = new Uint8Array(8); (globalThis.crypto as Crypto | undefined)?.getRandomValues(b); rand = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); } catch { /* no crypto: the sequence alone */ }
    if (!rand) rand = Math.random().toString(36).slice(2, 12);
    return prefix + ++this.musicTokenSeq + "-" + rand;
  }

  /** Run a music script in the page and wait for its music-result with this token (null after the timeout or a failed inject). */
  private askMusic(tileId: string, token: string, js: string, timeoutMs: number = Orchestrator.MUSIC_RESULT_TIMEOUT_MS): Promise<MusicResultEvent | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.musicResultWaits.delete(token); resolve(null); }, timeoutMs);
      this.musicResultWaits.set(token, { tileId, resolve: (r) => { clearTimeout(timer); this.musicResultWaits.delete(token); resolve(r); } });
      Promise.resolve()
        .then(() => this.drivers.surface.inject(tileId, null, js))
        .catch(() => { clearTimeout(timer); this.musicResultWaits.delete(token); resolve(null); });
    });
  }

  /** The list as last read - a shell's synchronous menu builder reads this; a read is started so the next open is current. */
  recentMusicNow(tileId: string): RecentMusic[] {
    void this.recentMusic(tileId);
    return this.recentCache.get(tileId) ?? [];
  }
  private readonly recentCache = new Map<string, RecentMusic[]>();

  private async rememberRecent(tileId: string, point: { url: string; title: string; artist?: string; album?: string; label?: string; kind?: string; id?: string; at: number }): Promise<void> {
    if (!this.doc || !this.drivers.store) return;
    const said = point.kind && /^(album|playlist|station|artist|video)$/.test(point.kind) ? (point.kind as RecentMusic["kind"]) : null;
    const kind = said ?? collectionKind(point.url);
    if (kind === null) return;                                              // a home / search / library page is not a collection
    const label = point.label ?? (kind === "album" && point.album ? point.album : collectionSlug(point.url) ?? point.album ?? point.title);
    const entry: RecentMusic = { url: point.url, label, kind, ...(point.id ? { id: point.id } : {}), ...(point.artist ? { artist: point.artist } : {}), ...(point.album ? { album: point.album } : {}), title: point.title, at: point.at };
    const list = (await this.recentMusic(tileId)).filter((e) => e.url !== point.url);
    list.unshift(entry);
    try { await this.drivers.store.set(this.recentKey(this.doc.id, tileId), JSON.stringify(list.slice(0, Orchestrator.RECENT_MAX))); } catch { /* best effort */ }
  }

  /** Quick play: go to one of the remembered collections and press the page's Play (the resume path, at a chosen page). */
  async playRecent(tileId: string, url: string): Promise<"ok" | "unknown-tile" | "unknown"> {
    const tile = this.tile(tileId);
    if (!tile) return "unknown-tile";
    const entry = (await this.recentMusic(tileId)).find((e) => e.url === url);
    if (!entry) return "unknown";                                          // only pages Prism saw play: never an arbitrary navigation from a remote
    // B-124: with the service's own id and a musicPlay script, queue by id through the player - the page never
    // navigates, so no address (right or wrong) can strand the hidden player on an error page
    const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
    const byId = entry.id && /^(playlist|station|album)$/.test(entry.kind) ? { kind: entry.kind as "playlist" | "station" | "album", id: entry.id } : collectionIdFromUrl(url);   // B-125: older entries too
    this.arm(tileId);   // B-126: a quick-play pick is a human's press, whichever path plays it
    if (byId && spec?.musicPlay) {
      if (this.holdsCollection(tileId, byId.kind, byId.id)) { await this.resumeHeld(tileId); return "ok"; }   // B-140
      await this.claimAudio(tileId);   // B-137: the quick jump
      await this.drivers.surface.inject(tileId, null, `window.__prismMusicPlay && window.__prismMusicPlay(${JSON.stringify(byId.kind)}, ${JSON.stringify(byId.id)})`);
      this.setMusicPending(tileId, { kind: byId.kind, id: byId.id, name: entry.label });
      return "ok";
    }
    await this.playByAddress(tileId, url, entry.label, entry.kind);
    return "ok";
  }

  /**
   * ONE mute for the whole wall (B-150, settled 2026-09-08 - "1 mute transform for this entire scene"). Section 3's focus
   * machine keeps deciding WHICH source would sound (a pick, a Play, a tap move it, exactly as before); the wall mute is a
   * single switch above it that keeps the owner silent. Play, picks, switches and Start over never touch the switch; the
   * mute button and the MUTED pill show the switch itself, so they cannot drift. Kept across restarts (section 10).
   */
  private wallMuted = false;
  // Multiview: the sound is the big window's, whatever starts in a small one - a pick into a small window took it through here
  // (the video start path claims directly, past the playback signal's own check; "sound should always be on the main window", 2026-09-23)
  private async claimAudio(tileId: string): Promise<void> {
    if (this.mvKeepsAudio(tileId)) { await this.drivers.surface.setMuted(tileId, true); return; }
    await this.applyAudioCommands(this.audio.takeAudioFocus(tileId));
  }
  async setWallMuted(on: boolean): Promise<void> {
    this.wallMuted = on;
    void Promise.resolve(this.drivers.store?.set(Orchestrator.PERSON_MUTED_KEY, on ? "1" : "")).catch(() => {});
    const owner = this.audio.focusedMedia;
    // B-175 (2026-09-09): "the mute button should just simply mute" - on, every page with audio goes silent, whoever holds
    // the focus; off lifts only the owner (section 3 keeps the rest silent, as before)
    if (on) { for (const t of this.doc?.tiles ?? []) if (t.url && this.surfaces.has(t.id)) await this.drivers.surface.setMuted(t.id, true); }
    // 2026-09-14: an unmute mid-break lifted the OWNER - the ad under the intermission - along with the soundscape ("it
    // sounds like the ad and the sound are playing at the same time"). The cover holds the source silent for the
    // length of the break, whatever the wall's switch says; the soundscape (below) is what the unmute brings in.
    else if (owner) await this.drivers.surface.setMuted(owner, this.intermission.isCovered(owner));
    for (const [tile, amb] of this.ambient) if (amb.active && this.surfaces.has(amb.surface)) await this.drivers.surface.setMuted(amb.surface, on || this.audio.focusedMedia !== tile);
  }

  /** A human's music ask on the wall (play, a pick, Start over): arms the tile for audio focus and releases the boot hold for good (B-142). */
  private arm(tileId: string): void { this.lastInteract.set(tileId, Date.now()); this.humanPlayed.add(tileId); this.bootPaused.delete(tileId); this.bootHeld.delete(tileId); }
  /** B-142: tiles a human has played on this run - the boot hold never re-arms for them (lastInteract is one-shot, consumed by the playback it explains). */
  private readonly humanPlayed = new Set<string>();

  /** The collection the page says it holds right now (its context's kind + id), or null. */
  private heldCollection(tileId: string): { kind: string; id: string; label?: string; url?: string } | null {
    const cx = this.nowPlaying.get(tileId)?.context;
    return cx?.kind && cx.id ? { kind: cx.kind, id: cx.id, ...(cx.label ? { label: cx.label } : {}), ...(cx.url ? { url: cx.url } : {}) } : null;
  }
  private holdsCollection(tileId: string, kind: string, id: string): boolean {
    const held = this.heldCollection(tileId);
    return !!held && held.kind === kind && held.id === id;
  }
  /**
   * B-140 (2026-09-08): a pick of the collection the page already holds carries on where it left off - the audio
   * moves to it and, if it is paused, the player's own Play resumes it. Re-queuing restarted the song every time the
   * person switched back ("we might as well still be holding the last song"). The page keeps its place for as long as
   * the service lets it; when it has let go, its context names something else and the pick queues afresh.
   */
  /** Pause a music source through its own player (the adapter's musicCmd, else its declared pause control, else the bare element). Not a human press: no wake, no offer. */
  private async pauseSource(tileId: string): Promise<void> {
    const tile = this.tile(tileId);
    if (!tile || tile.launch) return;
    const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
    const control = spec?.controls?.pause;
    const fallback = control ? clickControlJs(control) : mediaFallbackJs("pause");
    const js = spec?.musicCmd ? `(function(){if(window.__prismMusicCmd&&window.__prismMusicCmd("pause"))return true;return ${fallback};})()` : fallback;
    await this.drivers.surface.inject(tileId, null, js);
    this.audio.onPlayback(tileId, false, false);   // commands nothing (B-139); the next playback signal re-adds it
  }
  private async resumeHeld(tileId: string): Promise<void> {
    await this.claimAudio(tileId);
    this.musicPending.delete(tileId);
    if (this.audio.isPlaying(tileId)) return;
    const tile = this.tile(tileId);
    const spec = tile?.adapter ? this.adapters.get(tile.adapter) : undefined;
    if (spec?.musicCmd) { await this.drivers.surface.inject(tileId, null, `window.__prismMusicCmd && window.__prismMusicCmd("play")`); return; }
    await this.pressPlayControl(tileId);
  }
  /**
   * B-141 (2026-09-08): Start over - the collection the page holds, queued again on purpose: a station tunes afresh, a
   * playlist or album starts from its first track. By id through the player where there is one, else the page's own
   * address loaded again and its Play pressed. "unavailable" when the page holds nothing Prism can name.
   */
  async restartMusic(tileId: string): Promise<"ok" | "unavailable" | "unknown-tile"> {
    const tile = this.tile(tileId);
    if (!tile) return "unknown-tile";
    // B-233 (2026-09-18): a Prism-ordered play starts over as ITSELF - the same order from its first track - not as whatever
    // the page happens to name (a Prism queue's container is the song, so the held collection was the remembered station)
    const o = this.musicOrder.get(tileId);
    if (o?.ids?.length) {
      o.index = 0;
      if (this.doc && this.drivers.store) { try { await this.drivers.store.set(this.musicOrderKey(this.doc.id, tileId), JSON.stringify(o)); } catch { /* best effort */ } }
      if (await this.continueOrder(tileId)) return "ok";
    }
    const held = this.heldCollection(tileId) ?? (() => { const r = this.recentCache.get(tileId)?.[0]; return r?.id ? { kind: r.kind, id: r.id, label: r.label, url: r.url } : r ? { kind: r.kind, id: r.url, label: r.label, url: r.url } : null; })();
    // B-207 (2026-09-15): the stage's service always carries the replay mark, so with nothing held (a wall fresh from a
    // restart) Start over falls back to what Prism remembers - the same collection, queued afresh
    if (!held) return (await this.resumeMusic(tileId)) === "ok" ? "ok" : "unavailable";
    const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
    this.arm(tileId);
    if (spec?.musicPlay && /^(playlist|station|album)$/.test(held.kind)) {
      await this.claimAudio(tileId);
      await this.drivers.surface.inject(tileId, null, `window.__prismMusicPlay && window.__prismMusicPlay(${JSON.stringify(held.kind)}, ${JSON.stringify(held.id)})`);
      this.setMusicPending(tileId, { kind: held.kind, id: held.id, name: held.label ?? held.id });
      return "ok";
    }
    if (!held.url || !/^https?:\/\//.test(held.url)) return "unavailable";
    await this.playByAddress(tileId, held.url, held.label ?? held.id, held.kind, true);
    return "ok";
  }

  /** Go to a collection page Prism was told about and press the page's own Play (the loading signal from the tap). `again` (B-141) loads it even when already there. */
  private async playByAddress(tileId: string, url: string, name: string, kind: string, again = false): Promise<void> {
    this.pendingResumePlay.set(tileId, Date.now() + 20_000);
    this.setMusicPending(tileId, { kind, id: url, name, url });
    if (this.currentUrl.get(tileId) === url) { if (again) this.refreshTile(tileId); else await this.pressPlayControl(tileId); return; }
    await this.drivers.surface.navigate(tileId, url);
  }

  /** What Play would resume for a music tile: the remembered page and track, or null when Prism never saw it play. */
  async resumePoint(tileId: string): Promise<{ url: string; title: string; artist?: string; album?: string; label?: string; kind?: string; id?: string; at: number } | null> {
    if (!this.doc || !this.drivers.store) return null;
    try {
      const raw = await this.drivers.store.get(this.resumeKey(this.doc.id, tileId));
      if (!raw) return null;
      const p = JSON.parse(raw) as { url?: unknown; title?: unknown; artist?: unknown; album?: unknown; label?: unknown; kind?: unknown; id?: unknown; at?: unknown };
      if (typeof p.url !== "string" || typeof p.title !== "string") return null;
      return { url: normalizeCollectionUrl(p.url), title: p.title, ...(typeof p.artist === "string" ? { artist: p.artist } : {}), ...(typeof p.album === "string" ? { album: p.album } : {}), ...(typeof p.label === "string" ? { label: p.label } : {}), ...(typeof p.kind === "string" ? { kind: p.kind } : {}), ...(typeof p.id === "string" ? { id: p.id } : {}), at: typeof p.at === "number" ? p.at : 0 };
    } catch { return null; }
  }

  /**
   * Play with nothing queued (the maintainer's ask, 2026-09-06): go back to the page the last thing
   * played from and press the page's OWN Play control - the adapter's `controls.play` (else its
   * the bare media element; never `presentation`, which is the §26 keeper's). A Media Session handler does not exist until
   * something has played, which is why the earlier onActivate never started anything. "none" when
   * Prism never saw this tile play; the first play still needs a person on the page.
   */
  /**
   * B-205 (2026-09-15): "make it so the user can just select the service - it switches to that service and starts the last
   * running station or playlist". The audio moves to the tile: a page already playing just takes the focus, a page holding a
   * paused track is played (the player's own play, else the page's control), a page holding nothing resumes what Prism
   * remembers. "none" when there is nothing to start; the runtime points the stage at the tile in every case.
   */
  async switchToService(tileId: string): Promise<"ok" | "none" | "unknown-tile"> {
    const tile = this.tile(tileId);
    if (!tile) return "unknown-tile";
    const np = this.nowPlaying.get(tileId);
    if (np?.title) {
      this.arm(tileId);
      if (np.playing) { await this.claimAudio(tileId); return "ok"; }
      await this.resumeHeld(tileId);
      this.setMusicPending(tileId, { kind: "play", id: "play", name: np.title });
      return "ok";
    }
    return this.resumeMusic(tileId);
  }

  async resumeMusic(tileId: string): Promise<"ok" | "none" | "unknown-tile"> {
    const tile = this.tile(tileId);
    if (!tile) return "unknown-tile";
    if (await this.continueOrder(tileId)) return "ok";   // 2026-09-17: a Prism-ordered play carries on from its saved spot
    const point = await this.resumePoint(tileId);
    if (!point) return "none";
    // B-205 (2026-09-15): by id through the service's own player where there is one - the same path as a Quick play pick.
    // Pressing the page's Play control on the station page found no header Play and hit the sidebar's "Play Vibes" card
    // instead (Apple, read live): a DOM guess on a page that has moved on is the wrong tool when the player takes an id.
    const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
    const byId = point.id && point.kind && /^(playlist|station|album)$/.test(point.kind) ? { kind: point.kind, id: point.id } : collectionIdFromUrl(point.url);
    if (byId && spec?.musicPlay) {
      this.arm(tileId);
      await this.claimAudio(tileId);
      await this.drivers.surface.inject(tileId, null, `window.__prismMusicPlay && window.__prismMusicPlay(${JSON.stringify(byId.kind)}, ${JSON.stringify(byId.id)})`);
      this.setMusicPending(tileId, { kind: byId.kind, id: byId.id, name: point.label ?? point.title });
      return "ok";
    }
    this.pendingResumePlay.set(tileId, Date.now() + 20_000);
    const here = this.currentUrl.get(tileId);
    if (here === point.url) { await this.pressPlayControl(tileId); return "ok"; }
    await this.drivers.surface.navigate(tileId, point.url);            // load-finished presses Play
    return "ok";
  }

  /**
   * B-139 (2026-09-08): a page's own "are you still listening?" prompt (Pandora's keep_listening_button over a disabled
   * Play, found after a night on the wall) is answered as PART of a human's press - the press is the answer - and the
   * asked-for control follows once the tuner is back. Never from a timer or an observation (section 26).
   */
  private withWake(spec: AdapterSpec | undefined, js: string): string {
    const wake = spec?.controls?.wake;
    if (!wake) return js;
    return `(function(){var w=document.querySelector(${JSON.stringify(wake)});if(w&&w.getBoundingClientRect().width>0&&typeof w.click==='function'){w.click();setTimeout(function(){${js}},900);return true;}return ${js};})()`;
  }

  /**
   * 2026-09-14: the service's own OFFER raised BY a human's Next press is accepted as part of that press - Pandora
   * answers a skip past the limit with "Get More Skips" (watch an ad for more), and the person's ask was to skip:
   * "when the user hits skip and the get skips comes up, just hit that too and we should head right into an ad". The
   * press runs, then for up to 2.5 s the page is watched for the adapter's declared offer control and it is pressed
   * ONCE; the ad that follows is a break like any other. Never from a timer of its own or an observation - only on the
   * heels of the press (section 26, the same doctrine as withWake).
   */
  private withOffer(spec: AdapterSpec | undefined, cmd: string, js: string): string {
    const offer = spec?.controls?.offer;
    if (!offer || cmd !== "next") return js;
    return `(function(){var r=${js};var n=0;var t=setInterval(function(){n++;var hit=false;try{hit=${clickControlJs(offer)};}catch(e){hit=false;}if(hit||n>=10)clearInterval(t);},250);return r;})()`;
  }

  private async pressPlayControl(tileId: string): Promise<void> {
    const deadline = this.pendingResumePlay.get(tileId) ?? 0;
    this.pendingResumePlay.delete(tileId);
    if (deadline && Date.now() > deadline) return;                       // a stale request from a page that never came back
    const tile = this.tile(tileId);
    if (!tile) return;
    const adapter = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
    // controls.playPage (the collection page's own Play - what starts it when nothing is loaded; Spotify's transport
    // toggle was inert on the album page, 2026-09-16) else controls.play; never `presentation`, which is the §26
    // keeper's alone (adapters-presentation.test asserts it is read in one place)
    const control = adapter?.controls?.playPage ?? adapter?.controls?.play;
    // B-137 (2026-09-07): a page already playing (muted, another source had the audio) needs no press - a press
    // toggled Pandora to pause, the retry pressed again, and the station rebuffered before the audio came back.
    // The audio just moves to it. And the retry only fires when nothing started.
    if (this.audio.isPlaying(tileId)) { await this.claimAudio(tileId); this.musicPending.delete(tileId); return; }
    const js = this.withWake(adapter, control ? clickControlJs(control) : mediaFallbackJs("play"));
    await this.drivers.surface.inject(tileId, null, js);
    // a single-page app draws its page after load-finished: press again shortly, once, in case the first found nothing
    setTimeout(() => { if (!this.audio.isPlaying(tileId)) void this.drivers.surface.inject(tileId, null, js); }, 1500);
  }

  private async pushFeed(t: TileSpec): Promise<void> {
    if (!t.visualization || !this.surfaces.has(t.id) || !this.drivers.surface.setVisualizationFeed) return;
    const feed = this.music.feed({ id: t.id, source: t.visualization.source, style: t.visualization.style, artwork: t.visualization.artwork }, this.audio.focusedMedia);
    await this.drivers.surface.setVisualizationFeed(t.id, JSON.stringify(feed));
  }

  /**
   * A shell declares the palettes of the style packs it loaded, so core can do
   * the §32 backdrop tint for every port (concept-scenes §2.5.2 point 2 — the
   * shell never re-derives a palette). Returns how many packs were accepted.
   */
  registerStylePalettes(map: Record<string, unknown>): number {
    return this.music.registerStylePalettes(map);
  }

  /**
   * The shell sampled the current artwork (RGBA bytes of a small decode) for a
   * hidden music facet; core derives the dominant colours and re-pushes the
   * feeds of every visualization sourced to it with the tinted palette.
   */
  async noteArtworkColors(facet: string, url: string, rgba: Uint8Array | number[]): Promise<"ok" | "unknown"> {
    if (!this.music.source(facet)) return "unknown";
    this.music.noteArtworkColors(facet, url, rgba);
    for (const t of this.doc?.tiles ?? []) if (t.visualization?.source === facet) await this.pushFeed(t);
    return "ok";
  }

  musicState(): MusicStateSnapshot {
    const sources: Record<string, MusicSourceState> = {};
    for (const t of this.doc?.tiles ?? []) { const src = this.music.source(t.id); if (src) sources[t.id] = src; }
    const viz = (this.doc?.tiles ?? []).filter((t) => t.visualization).map((t) => ({ id: t.id, source: t.visualization!.source, style: t.visualization!.style, artwork: t.visualization!.artwork }));
    return { sources, reveal: this.music.revealed(), feeds: this.music.feeds(viz, this.audio.focusedMedia) };
  }

  /** The hidden music facet behind an id (itself, or the source of a visualization). */
  private musicSourceFor(id: string): string | null {
    const t = this.tile(id);
    if (!t) return null;
    const src = t.visualization ? t.visualization.source : id;
    return this.music.source(src) ? src : null;
  }

  /**
   * §32 reveal: the hidden facet's native player as a transient overlay on the
   * §16 path - "panel" at its floating place, "hero" over the largest slot.
   * The surface is only resized and crossfaded, never recreated: audio never
   * stops. One reveal at a time; revealing another collapses the first.
   */
  async revealMusic(id: string, mode: RevealState["mode"] = "panel"): Promise<"ok" | "unknown" | "unsupported"> {
    const src = this.musicSourceFor(id);
    if (!src) return "unknown";
    if (!this.drivers.surface.setPresence) return "unsupported";
    if (this.lifecycle.status(src) === "warm") await this.lifecycle.touch(src);   // asleep under the live budget: woken before it is shown ("Open the full app" showed an empty frame)
    const prev = this.music.revealed().facet;
    if (prev && prev !== src) await this.collapseMusic();
    this.music.revealSource(src, mode);
    const rect = mode === "hero" ? this.heroRevealRect() : mode === "window" ? this.windowRevealRect() : this.panelRevealRect(src);
    await this.drivers.surface.setZ(src, 35);                                   // above floating (30), below a takeover (40) and the pill
    await this.drivers.surface.setChrome?.(src, "floating", "page", false);
    await this.drivers.surface.setPresence(src, mode, rect, 220);
    return "ok";
  }

  /**
   * §32 another look: swap a visualization's style (and optionally its artwork mode) IN PLACE.
   * Only that surface is rebuilt; the hidden source, its audio focus and its playback are not
   * touched. (A full scene apply re-runs the boot-silent rule - §3 rule 5 - and mutes the room,
   * which is what "Next visual" did before 2026-09-06.) The document is updated and persisted
   * so the wall boots into the same pack.
   */
  async restyleVisualization(tileId: string, style: string, artwork?: string): Promise<"ok" | "unknown" | "unsupported"> {
    const doc = this.doc;
    const tile = doc?.tiles.find((t) => t.id === tileId);
    if (!doc || !tile?.visualization) return "unknown";
    if (!this.drivers.surface.createVisualization) return "unsupported";
    const art = artwork === "off" || artwork === "backdrop" || artwork === "focal" ? artwork : tile.visualization.artwork;
    tile.visualization = { ...tile.visualization, style, artwork: art };
    if (this.surfaces.has(tileId)) { await this.drivers.surface.destroy(tileId); this.surfaces.delete(tileId); }
    await this.drivers.surface.createVisualization({ id: tileId, style, source: tile.visualization.source, artwork: art, spill: tile.visualization.spill === true });
    this.surfaces.add(tileId);
    await this.applyLayout();                                                   // its rect and z, as the apply would have set them
    await this.drivers.surface.reveal(tileId, 300);
    await this.persistDocument(doc);
    return "ok";
  }

  /**
   * Multi-service lounge (2026-09-07): a visualization draws ONE hidden music source; a pick on another
   * service's collection moves the stage to that source - the same rebuild restyle does, with the new
   * feed. The scene model's own record is the runtime's to update (it knows the scene); this is the wall.
   */
  async resourceVisualization(tileId: string, source: string): Promise<"ok" | "unknown" | "unsupported"> {
    const doc = this.doc;
    const tile = doc?.tiles.find((t) => t.id === tileId);
    if (!doc || !tile?.visualization || !this.music.source(source)) return "unknown";
    if (!this.drivers.surface.createVisualization) return "unsupported";
    if (tile.visualization.source === source) return "ok";
    tile.visualization = { ...tile.visualization, source };
    if (this.surfaces.has(tileId)) { await this.drivers.surface.destroy(tileId); this.surfaces.delete(tileId); }
    await this.drivers.surface.createVisualization({ id: tileId, style: tile.visualization.style, source, artwork: tile.visualization.artwork, spill: tile.visualization.spill === true });
    this.surfaces.add(tileId);
    await this.pushFeed(tile);
    await this.applyLayout();
    await this.drivers.surface.reveal(tileId, 300);
    await this.persistDocument(doc);
    return "ok";
  }

  /**
   * §26 ambient audio (opt-in, 2026-09-07): instead of silence during a service's ad break, a quiet
   * soundscape - synthesized on the device by the first-party page at tiles.prism/soundscape, nothing
   * downloaded - in a hidden surface of its own beside the music source. It fades in when the break
   * covers the source and is muted again when the break ends; the wall's mute covers it too (section 3).
   */
  private readonly ambient = new Map<string, { surface: string; sound: string; active: boolean }>();
  /** The twelve bundled recordings (Assets/tiles/soundscape/sounds/CREDITS.md, B-170) - what Random draws from. */
  static readonly SOUNDSCAPES = ["bayou", "midwest-forest", "wind-shutter", "heavy-storm", "river", "beach-cave", "park-meadow", "wind-chimes", "city", "bees", "arcade", "star-walk"] as const;
  /**
   * Random (2026-09-09): a different recording every break - never None, never the one that just played.
   * 2026-09-15 ("seems like I get the same ones often"): a shuffle bag, not a memoryless draw - each of the twelve plays
   * once, in a random order, before any plays again. One bag for the wall (Pandora's break and Spotify's draw from the
   * same one), kept in the store so a restart carries on where it was; a new bag is dealt so that it does not open with
   * the recording that just played.
   */
  static readonly SOUNDSCAPE_BAG_KEY = "soundscape:bag";
  private soundscapeBag: string[] | null = null;
  private lastSoundscape: string | null = null;
  private async randomSoundscape(): Promise<string> {
    const all = Orchestrator.SOUNDSCAPES as readonly string[];
    if (this.soundscapeBag === null) {
      this.soundscapeBag = [];
      try {
        const parsed = JSON.parse((await this.drivers.store?.get(Orchestrator.SOUNDSCAPE_BAG_KEY)) ?? "null") as unknown;
        if (Array.isArray(parsed)) this.soundscapeBag = parsed.filter((s): s is string => typeof s === "string" && all.includes(s));
      } catch { /* a fresh bag */ }
    }
    if (this.soundscapeBag.length === 0) {
      const bag = [...all];
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j]!, bag[i]!]; }
      const top = bag.length - 1;   // draws come off the end
      if (top > 0 && bag[top] === this.lastSoundscape) [bag[top], bag[0]] = [bag[0]!, bag[top]!];
      this.soundscapeBag = bag;
    }
    const pick = this.soundscapeBag.pop() ?? all[0]!;
    this.lastSoundscape = pick;
    try { await this.drivers.store?.set(Orchestrator.SOUNDSCAPE_BAG_KEY, JSON.stringify(this.soundscapeBag)); } catch { /* the bag lives on in memory */ }
    return pick;
  }
  private async ambientSound(musicTile: string, setting: string, on: boolean): Promise<void> {
    const sid = `ambient:${musicTile}`;
    const cur = this.ambient.get(musicTile);
    if (!on) {
      // B-199 (2026-09-14): the soundscape STOPS at the break's end (its own 1.2 s fade), not merely muted - every
      // soundscape page shares one browser process, so a mute that ducks the process's audio session is undone by the
      // next soundscape's unmute ("bees and a stream of water" playing together, Pandora's leftover under Spotify's)
      if (cur) { cur.active = false; if (this.surfaces.has(sid)) { void this.drivers.surface.inject(sid, null, "window.__prismSoundscape&&window.__prismSoundscape.stop()"); await this.drivers.surface.setMuted(sid, true); } }
      return;
    }
    const sound = setting === "random" ? await this.randomSoundscape() : setting;
    const url = `https://tiles.prism/soundscape/?sound=${encodeURIComponent(sound)}`;
    if (!cur || !this.surfaces.has(sid)) {
      await this.drivers.surface.create({ id: sid, kind: "hidden", profile: "prism-ambient", background: this.doc?.theme?.background ?? DEFAULT_BACKGROUND, blocking: false });
      this.surfaces.add(sid);
      await this.drivers.surface.navigate(sid, url);
    } else if (cur.sound !== sound) {
      await this.drivers.surface.navigate(sid, url);
    }
    this.ambient.set(musicTile, { surface: sid, sound, active: true });
    void this.drivers.surface.inject(sid, null, `window.__prismSoundscape&&window.__prismSoundscape.play(${JSON.stringify(sound)})`);   // B-152: a page already up starts now; a loading one starts at load-finished
    // B-147: the soundscape stands in for the MUSIC - it sounds only while the music's tile owns the audio. Muted music
    // (a person's mute, or another service holding the room) means a silent break; unmute brings it in mid-break.
    await this.drivers.surface.setMuted(sid, this.wallMuted || this.audio.focusedMedia !== musicTile);
  }

  /**
   * A hidden music source whose adapter declares `audio-intermission` (it can see the service's breaks) gets
   * audio intermission by default - the break muted, and the soundscape if one was chosen - without anyone
   * having to switch it on (2026-09-07: Pandora's tile carried no intermission config at all, so the engine
   * never knew it and no soundscape could start).
   */
  private defaultIntermission(t: TileSpec): boolean {
    // a hidden source has no scenery to speak of: its only intermission is the audio one, and that follows the
    // adapter's ability to see the break - not the App's scenery flag (which the catalog leaves false)
    if (!(t.kind === "floating" && t.float?.hidden && t.url && t.adapter)) return false;
    return (this.adapters.get(t.adapter)?.capabilities ?? []).includes("audio-intermission");
  }

  /** The lounge's choice for every music source's breaks: a soundscape name, or null for silence. Persisted in the document; the scene model is the runtime's to update. */
  async setIntermissionAmbient(sound: string | null): Promise<number> {
    if (!this.doc) return 0;
    let n = 0;
    for (const t of this.doc.tiles) {
      if (!this.music.source(t.id)) continue;
      const next = { ...(t.intermission ?? {}), enabled: this.defaultIntermission(t) || (t.intermission?.enabled ?? false) };
      if (sound) next.ambient = sound; else delete next.ambient;
      t.intermission = next;
      this.intermission.setAmbient(t.id, sound);
      n++;
    }
    await this.persistDocument(this.doc);
    return n;
  }

  /** The scene's hidden music sources (tile ids), with the stage(s) each one feeds. */
  /**
   * B-165 (2026-09-08): "it shows Pandora playing but the music muted, while the control says unmuted. These are supposed to
   * be in sync." A stage's source is the wall's CHOSEN music - when it plays and nobody owns the audio (a boot, a fresh
   * scene), it takes the audio, so the one switch decides whether it is heard. Section 3's boot silence still holds:
   * every surface starts muted and the switch is the person's last word; other tiles' autoplay still joins silently.
   */
  private stageSourceUnowned(tileId: string): boolean {
    return !this.audio.focusedMedia && this.musicSourceTiles().some((s) => s.tile === tileId && s.stages.length > 0);
  }

  /** Tiles the live budget put to sleep, woken (the Music player switched to: its sources, 2026-09-24). */
  async wakeTiles(ids: readonly string[]): Promise<void> { for (const id of ids) if (this.lifecycle.status(id) === "warm") await this.lifecycle.touch(id); }
  musicSourceTiles(): Array<{ tile: string; stages: string[] }> {
    const tiles = this.doc?.tiles ?? [];
    return tiles.filter((t) => this.music.source(t.id)).map((t) => ({ tile: t.id, stages: tiles.filter((v) => v.visualization?.source === t.id).map((v) => v.id) }));
  }

  async collapseMusic(): Promise<"ok" | "none"> {
    const facet = this.music.revealed().facet;
    if (!facet) return "none";
    this.music.collapse();
    if (this.drivers.surface.setPresence && this.surfaces.has(facet)) {
      await this.drivers.surface.setPresence(facet, "hidden", { x: 0, y: 0, w: 0, h: 0 }, 220);
      await this.drivers.surface.setChrome?.(facet, "floating", this.tile(facet)?.float?.face ?? "control", true);
      await this.drivers.surface.setZ(facet, 30);
    }
    return "ok";
  }

  private panelRevealRect(tileId: string): Rect {
    const f = clampFloat(this.tile(tileId)?.float);
    const w = Math.round(Math.max(0.28, f.w) * this.viewport.w), h = Math.round(Math.max(0.4, f.h * 2) * this.viewport.h);
    return { x: Math.min(Math.round(f.x * this.viewport.w), this.viewport.w - w), y: Math.min(Math.round(f.y * this.viewport.h), this.viewport.h - h), w, h };
  }

  /** B-146: the inline app window - centred, three quarters of the wall, a band above it for the shell's menu bar. */
  private windowRevealRect(): Rect {
    const w = Math.round(this.viewport.w * 0.74), h = Math.round(this.viewport.h * 0.76);
    return { x: Math.round((this.viewport.w - w) / 2), y: Math.round((this.viewport.h - h) / 2) + 20, w, h };
  }

  private heroRevealRect(): Rect {
    const solved = this.rects();
    let best: Rect | null = null;
    for (const r of Object.values(solved)) if (!best || r.w * r.h > best.w * best.h) best = r;
    const m = Math.round(Math.min(this.viewport.w, this.viewport.h) * 0.04);
    return best ?? { x: m, y: m, w: this.viewport.w - 2 * m, h: this.viewport.h - 2 * m };
  }

  /* ------------------------------ shortcuts (named places on an app) ----- */

  private shortcuts = new Map<string, Shortcut[]>();

  private appKeyOf(t: TileSpec): string {
    if (t.adapter) return t.adapter;
    const host = t.url ? hostnameOf(t.url) : "";
    return host ? hostSlug(host) : t.id;
  }

  private async loadShortcuts(doc: DashboardDocument): Promise<void> {
    // every app on this wall AND every app the registry knows (§34: a scene assigns views of apps not on the wall yet)
    const keys = [...doc.tiles.map((t) => this.appKeyOf(t)), ...(this.apps?.keys() ?? [])];
    for (const key of keys) {
      if (this.shortcuts.has(key)) continue;
      let list: Shortcut[] = [];
      try {
        const raw = await this.drivers.store?.get("shortcuts:" + key);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed.filter((s): s is Shortcut => !!s && typeof s.id === "string" && typeof s.label === "string" && typeof s.url === "string");
        }
      } catch { /* corrupt shortcuts never break rendering (§10 posture) */ }
      this.shortcuts.set(key, list);
    }
  }

  /** The shortcuts of a tile's app (empty when none). */
  shortcutsFor(tileId: string): Shortcut[] {
    const t = this.tile(tileId);
    return t ? this.shortcuts.get(this.appKeyOf(t)) ?? [] : [];
  }

  /**
   * Save a shortcut for a tile's app: the label, the page (default: the
   * tile's current page) and the view (`focus`: a region + viewport, `null`
   * for the whole page, absent = the tile's current framing). Persisted.
   */
  async saveShortcut(tileId: string, input: { label: string; url?: string; focus?: FocusSpec | null; aspectHint?: string | null }): Promise<"ok" | "unknown-tile" | "invalid"> {
    const t = this.tile(tileId);
    if (!t) return "unknown-tile";
    const label = (input.label ?? "").trim();
    if (!label) return "invalid";
    const url = input.url ?? t.url;
    try {
      const p = new URL(url ?? "");
      if (p.protocol !== "https:" && p.protocol !== "http:") return "invalid";
    } catch {
      return "invalid";
    }
    const focus = input.focus === undefined ? t.focus : input.focus ?? undefined;
    const key = this.appKeyOf(t);
    const list = this.shortcuts.get(key) ?? [];
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "shortcut";
    let id = base;
    for (let n = 2; list.some((s) => s.id === id); n++) id = base + "-" + n;
    const aspectHint = input.aspectHint && parseAspectHint(input.aspectHint) ? input.aspectHint : undefined;
    const shortcut: Shortcut = { id, label, url: url!, ...(focus ? { focus } : {}), ...(aspectHint ? { aspectHint } : {}) };
    this.shortcuts.set(key, [...list, shortcut]);
    await this.persistShortcuts(key);
    return "ok";
  }

  async removeShortcut(tileId: string, shortcutId: string): Promise<"ok" | "unknown-tile" | "unknown-shortcut"> {
    const t = this.tile(tileId);
    if (!t) return "unknown-tile";
    const key = this.appKeyOf(t);
    const list = this.shortcuts.get(key) ?? [];
    if (!list.some((s) => s.id === shortcutId)) return "unknown-shortcut";
    this.shortcuts.set(key, list.filter((s) => s.id !== shortcutId));
    await this.persistShortcuts(key);
    return "ok";
  }

  /** Go there: the shortcut's page and view become the tile's (persisted like any edit). */
  async applyShortcut(tileId: string, shortcutId: string): Promise<"ok" | "unknown-tile" | "unknown-shortcut" | "no-doc" | "bad-url"> {
    const s = this.shortcutsFor(tileId).find((x) => x.id === shortcutId);
    if (!s) return this.tile(tileId) ? "unknown-shortcut" : "unknown-tile";
    return this.updateTile(tileId, { url: s.url, focus: s.focus ?? null, ...(s.aspectHint ? { aspectHint: s.aspectHint } : {}) });
  }

  private async persistShortcuts(key: string): Promise<void> {
    try { await this.drivers.store?.set("shortcuts:" + key, JSON.stringify(this.shortcuts.get(key) ?? [])); } catch { /* non-fatal */ }
  }

  /**
   * Persist an edit to the CURRENT dashboard (§10): single-dashboard frames
   * boot from the store's "dashboard" key (the Windows host does); bundles
   * keep their own flow.
   */
  private async persistDocument(next: DashboardDocument): Promise<void> {
    if (this.docs.size === 1 && this.drivers.store) {
      try { await this.drivers.store.set("dashboard", JSON.stringify(next)); } catch { /* non-fatal */ }
    }
  }

  /**
   * Edit a tile's plain fields in place — url (reloads on the §16 path),
   * zoom (applied live, §31 bounds), focus (re-framed live; null clears).
   * Persisted.
   */
  async updateTile(tileId: string, patch: TilePatch): Promise<"ok" | "unknown-tile" | "no-doc" | "bad-url"> {
    if (!this.doc) return "no-doc";
    const original = this.docs.get(this.doc.id);
    if (!original) return "no-doc";
    const idx = original.tiles.findIndex((t) => t.id === tileId);
    if (idx < 0) return "unknown-tile";
    const next: TileSpec = { ...original.tiles[idx]! };
    let url: string | undefined;
    if (patch.url !== undefined) {
      try {
        const p = new URL(patch.url);
        if (p.protocol !== "https:" && p.protocol !== "http:") return "bad-url";
        url = p.toString();
      } catch {
        return "bad-url";
      }
      next.url = url;
    }
    if (patch.zoom !== undefined) {
      const z = patch.zoom === null ? 1 : clampZoom(patch.zoom);
      if (z === 1) delete next.zoom; else next.zoom = z;
    }
    if (patch.focus !== undefined) {
      if (patch.focus && (patch.focus.selector || validRegion(patch.focus.region))) next.focus = patch.focus;
      else delete next.focus;
    }
    let reflow = false;
    if (patch.aspectHint !== undefined) {
      const hint = patch.aspectHint && parseAspectHint(patch.aspectHint) ? patch.aspectHint : undefined;
      if (hint !== next.aspectHint) reflow = true;
      if (hint) next.aspectHint = hint; else delete next.aspectHint;
    }
    // §32 floating: kind flips move the tile out of / back into the wall
    // (a reflow either way); float patches merge into the place.
    if (patch.kind !== undefined) {
      const floating = patch.kind === "floating";
      if (floating !== (next.kind === "floating")) reflow = true;
      if (floating) { next.kind = "floating"; if (!next.float) next.float = { ...DEFAULT_FLOAT }; }
      else delete next.kind;
    }
    if (patch.float !== undefined) {
      next.float = clampFloat(patch.float === null ? undefined : { ...(next.float ?? DEFAULT_FLOAT), ...patch.float });
      reflow = true;
    }
    const tiles = original.tiles.slice();
    tiles[idx] = next;
    const nextDoc = { ...original, tiles };
    this.docs.set(nextDoc.id, nextDoc);
    await this.persistDocument(nextDoc);

    // live tile: apply without a rebuild
    const live = this.tile(tileId);
    if (live) {
      if (patch.zoom !== undefined) {
        if (next.zoom === undefined) delete live.zoom; else live.zoom = next.zoom;
        if (this.surfaces.has(tileId)) {
          await this.applyViewport(tileId);
          // the framing composes with the layout viewport: re-fit
          if (live.focus && patch.focus === undefined && !live.launch)
            await this.drivers.surface.inject(tileId, null, focusFramingJs(live.focus));
        }
      }
      if (patch.focus !== undefined) {
        if (next.focus) live.focus = next.focus; else delete live.focus;
      }
      if (reflow) {
        if (next.aspectHint) live.aspectHint = next.aspectHint; else delete live.aspectHint;
        if (next.kind === "floating") live.kind = "floating"; else delete live.kind;
        if (next.float) live.float = { ...next.float }; else delete live.float;
        await this.applyLayout();                                  // the slot takes the shape the view wants
      }
      if (url !== undefined) {
        live.url = url;
        if (patch.home) await this.setAppHome(live, url);   // §34.1 an app-level decision: the app's home page
        if (patch.reload !== false) {
          if (patch.focus !== undefined && this.surfaces.has(tileId)) await this.applyViewport(tileId);   // the new view's layout before the load
          await this.navigateTile(tileId, url);          // §16: freeze → load hidden → frame → reveal
        } else {
          this.rememberLocation(tileId, url);            // already showing: the resume position agrees with the saved page
        }
      } else if (patch.focus !== undefined && this.surfaces.has(tileId) && !live.launch) {
        await this.applyViewport(tileId);              // the region's layout first (the host awaits it), then the framing
        await this.drivers.surface.inject(tileId, null, live.focus ? focusFramingJs(live.focus) : CLEAR_FRAMING_JS);
      }
    }
    return "ok";
  }

  /**
   * The wall's layout, from the menu: hero (anchor + size), solo (one app at
   * a time), or a grid lattice — tiles auto-flow row-major, one cell each;
   * tiles beyond the lattice stay unplaced, so callers offer lattices that
   * fit. Persisted to the document; the §8 hero override follows.
   */
  async setLayout(req: LayoutRequest): Promise<"ok" | "no-doc" | "invalid"> {
    if (!this.doc) return "no-doc";
    const original = this.docs.get(this.doc.id);
    if (!original) return "no-doc";
    const ids = original.tiles.map((t) => t.id);
    let next: DashboardDocument;
    if (req.mode === "hero") {
      const prev = original.layout?.mode === "hero" ? original.layout : null;
      const pick = (id: string | undefined) => (id && ids.includes(id) ? id : undefined);
      const hero = pick(req.hero) ?? pick(this.override.hero) ?? pick(prev?.hero) ?? ids[0];
      if (!hero) return "invalid";
      const heroSize = clampHeroSize(req.heroSize ?? this.override.heroSize ?? prev?.heroSize ?? 0.62);
      next = {
        ...original,
        layout: { mode: "hero", hero, heroSize, satellites: prev?.satellites ?? "auto", gap: prev?.gap ?? original.grid?.gap ?? 8 },
      };
      this.override = { ...this.override, hero, heroSize };
    } else if (req.mode === "solo") {
      next = { ...original, layout: { mode: "solo" } };
    } else if (req.mode === "grid") {
      const cols = Math.floor(Number(req.cols)), rows = Math.floor(Number(req.rows));
      if (!(cols >= 1 && cols <= 8 && rows >= 1 && rows <= 8)) return "invalid";
      const tiles = original.tiles.map((t, i) => {
        const r = Math.floor(i / cols) + 1, c = (i % cols) + 1;
        if (r <= rows) return { ...t, area: `${r} / ${c} / ${r + 1} / ${c + 1}` };
        const { area: _drop, ...rest } = t;
        return rest as TileSpec;
      });
      next = { ...original, grid: { cols, rows, gap: original.grid?.gap ?? 8 }, layout: { mode: "grid" }, tiles };
    } else {
      return "invalid";
    }
    if (this.fullscreen && req.mode !== "solo") await this.exitFullscreen();
    this.docs.set(next.id, next);
    await this.persistLayout();
    await this.applyDocument(next);
    await this.persistDocument(next);
    return "ok";
  }

  /**
   * §31 step 3 viewfinder, part 1: the slot pops out to the whole window,
   * UNFRAMED and at its natural layout - the page really re-lays out at the
   * window's width, like a maximized browser. The shell draws the viewfinder
   * box and previews page zoom (a layout viewport of window ÷ zoom); the
   * region it picks is stored WITH that viewport, so the slot can reproduce
   * exactly the layout the human saw.
   */
  async startFraming(tileId: string): Promise<boolean> {
    const tile = this.tile(tileId);
    if (!tile || !this.surfaces.has(tileId) || tile.launch || tile.placeholder) return false;
    if (this.framing) await this.finishFraming(this.framing.id, null);
    this.framing = { id: tileId, prevFocus: tile.focus ? { ...tile.focus } : null, wasFullscreen: this.fullscreen };
    await this.drivers.surface.inject(tileId, null, CLEAR_FRAMING_JS);
    if (this.fullscreen !== tileId) await this.enterFullscreen(tileId);
    else await this.drivers.surface.setZ(tileId, 40);
    await this.drivers.surface.setViewport?.(tileId, 0, 0);      // natural layout at the window
    return true;
  }

  /**
   * Viewfinder, part 2: `{region, zoom?}` — the rectangle (document CSS px,
   * measured at that zoom's layout) becomes the tile's persisted
   * focus.region, the zoom its persisted page zoom, both applied in place;
   * null cancels and the previous framing returns (the shell restores the
   * zoom it previewed). Either way the slot drops back into the stack.
   */
  async finishFraming(tileId: string, result: unknown): Promise<"ok" | "not-framing" | "invalid"> {
    const f = this.framing;
    if (!f || f.id !== tileId) return "not-framing";
    this.framing = null;
    if (f.wasFullscreen !== tileId) await this.exitFullscreen();     // back to its slot (applyLayout re-applies its viewport)
    else if (this.surfaces.has(tileId)) await this.drivers.surface.setZ(tileId, 40);
    if (result !== null && result !== undefined) {
      const res0 = result as { region?: unknown; viewport?: { w?: unknown; h?: unknown }; clear?: unknown };
      if (res0.clear === true) {
        // "use the whole page": no framing at all - the page at the slot's own size
        const cleared = await this.updateTile(tileId, { focus: null });
        return cleared === "ok" ? "ok" : "invalid";
      }
      const region = res0.region;
      if (!validRegion(region)) {
        await this.applyViewport(tileId);
        await this.restoreFraming(tileId, f.prevFocus);
        return "invalid";
      }
      const r = { x: Math.round(region.x), y: Math.round(region.y), w: Math.round(region.w), h: Math.round(region.h) };
      const focus: FocusSpec = { region: r };
      const vw = res0.viewport?.w, vh = res0.viewport?.h;
      if (typeof vw === "number" && typeof vh === "number" && vw > 0 && vh > 0 && Number.isFinite(vw) && Number.isFinite(vh))
        focus.viewport = { w: Math.round(vw), h: Math.round(vh) };
      const res = await this.updateTile(tileId, { focus });
      return res === "ok" ? "ok" : "invalid";
    }
    await this.applyViewport(tileId);
    await this.restoreFraming(tileId, f.prevFocus);
    return "ok";
  }

  private async restoreFraming(tileId: string, prev: FocusSpec | null): Promise<void> {
    if (!this.surfaces.has(tileId)) return;
    await this.drivers.surface.inject(tileId, null, prev ? focusFramingJs(prev) : CLEAR_FRAMING_JS);
  }

  /**
   * The layout viewport a tile's page should have: its region's (§17
   * focus.viewport), else rect/zoom (§2), else none (0×0). Sent whenever it
   * can change - rects, edits - never while the viewfinder previews it.
   */
  private async applyViewport(tileId: string, rect?: Rect): Promise<void> {
    const tile = this.tile(tileId);
    const set = this.drivers.surface.setViewport;
    if (!tile || !set || !this.surfaces.has(tileId) || tile.launch || this.framing?.id === tileId) return;
    const vp = tile.focus?.viewport;
    if (vp && vp.w > 0 && vp.h > 0) { await set(tileId, Math.round(vp.w), Math.round(vp.h)); return; }
    const z = tile.zoom ?? 1;
    if (Math.abs(z - 1) > 0.001) {
      const r = rect ?? this.deviceRect(tileId);
      if (r) { await set(tileId, Math.round(r.w / z), Math.round(r.h / z)); return; }
    }
    await set(tileId, 0, 0);
  }

  /** A tile's current device rect (inset, fullscreen-aware) - what the shell was last told. */
  private deviceRect(tileId: string): Rect | undefined {
    if (!this.doc) return undefined;
    if (this.fullscreen === tileId) return { x: 0, y: 0, w: this.viewport.w, h: this.viewport.h };
    const gap = this.doc.layout?.mode === "hero" ? this.doc.layout.gap : this.doc.grid?.gap ?? 8;
    return insetRects(this.rects(), gap ?? 8)[tileId];
  }

  /** §31/§8 arrange: remove a tile from the CURRENT dashboard, persist, re-apply. */
  async removeTile(tileId: string): Promise<"ok" | "unknown-tile" | "no-doc"> {
    if (!this.doc) return "no-doc";
    const original = this.docs.get(this.doc.id);
    if (!original) return "no-doc";
    if (!original.tiles.some((t) => t.id === tileId)) return "unknown-tile";
    if (this.entered === tileId) await this.leaveTile();
    if (this.surfaces.has(tileId)) {
      this.refresh.stop(tileId);
      this.lifecycle.drop(tileId);
      await this.drivers.surface.destroy(tileId);
      this.surfaces.delete(tileId);
      this.dropKeeper(tileId);
    }
    const tiles = original.tiles.filter((t) => t.id !== tileId);
    let layout = original.layout;
    if (layout?.mode === "hero" && layout.hero === tileId && tiles.length) {
      layout = { ...layout, hero: tiles[0]!.id };            // hero removed: first survivor takes it
    }
    const next = { ...original, tiles, ...(layout ? { layout } : {}) };
    this.docs.set(next.id, next);
    await this.applyDocument(next);
    await this.persistDocument(next);
    return "ok";
  }

  rects(): SolvedRects {
    if (!this.doc) return {};
    return layoutDashboard(this.doc, this.viewport, this.override);
  }

  getViewport(): Viewport {
    return { ...this.viewport };
  }

  async resize(viewport: Viewport): Promise<void> {
    this.viewport = viewport;
    await this.applyLayout();
  }

  /** Promote a tile to hero (§8 — tap-hold or remote `{"cmd":"hero"}`). */
  async promoteHero(tileId: string): Promise<void> {
    if (!this.doc || this.doc.layout?.mode !== "hero") return;
    if (!this.doc.tiles.some((t) => t.id === tileId)) return;
    this.override = { ...this.override, hero: tileId };
    await this.persistLayout();
    await this.applyLayout();
  }

  /** Live hero resize; `commit` persists (drag-end per §8). */
  async setHeroSize(size: number, commit = true): Promise<void> {
    if (!this.doc || this.doc.layout?.mode !== "hero") return;
    this.override = { ...this.override, heroSize: clampHeroSize(size) };
    if (commit) await this.persistLayout();
    await this.applyLayout();
  }

  /** One-tap refresh from tile chrome or remote (§8) — §16 path, serialized. */
  refreshTile(tileId: string): void {
    this.refresh.refreshNow(tileId);
  }

  /* ----------------------- §24 day/night lifecycle ---------------------- */

  /** Night mode: dim to the floor and go low power. */
  async enterNight(brightnessFloor: number): Promise<void> {
    await this.drivers.display?.setBrightness(Math.min(1, Math.max(0.01, brightnessFloor)));
    await this.enterLowPower();
  }

  /** §24 low power: every tile to warm (sessions intact), refresh paused. */
  async enterLowPower(): Promise<void> {
    if (this.lowPower) return;
    this.lowPower = true;
    this.preview.pause(); // §25 peeks stop with everything else
    await this.lifecycle.demoteAll();
    void this.updates.onNightWindow(); // §28: silent install while the wall is dark
  }

  /* ------------------------------ §12 apps ------------------------------- */

  /** Installed launchable apps (Netflix, Plex…) — the remote offers them beside sites. */
  async listApps(): Promise<import("./drivers.js").AppInfo[]> {
    const apps = (await this.drivers.media?.listApps?.()) ?? [];
    return [...apps].sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Type into the native app in front — only a human's text, only via the observer. */
  async typeIntoApp(text: string): Promise<"ok" | "no-app" | "no-field" | "unsupported"> {
    if (!this.foregroundApp) return "no-app";
    if (!this.drivers.media?.appType) return "unsupported";
    return (await this.drivers.media.appType(this.foregroundApp, text)) ? "ok" : "no-field";
  }

  async backInApp(): Promise<"ok" | "no-app" | "unsupported"> {
    if (!this.foregroundApp) return "no-app";
    if (!this.drivers.media?.appBack) return "unsupported";
    await this.drivers.media.appBack(this.foregroundApp);
    return "ok";
  }

  /** Open an app fullscreen (§12); Back returns to the dashboard. */
  async launchApp(pkg: string, deepLink?: string): Promise<boolean> {
    if (!this.drivers.media) return false;
    await this.drivers.media.launch(pkg, deepLink);
    return true;
  }

  /* ---------------------------- §11 BT remotes --------------------------- */

  /** Edit mode → "Add remote": the shell runs its scan/pair UI. */
  async startRemotePairing(): Promise<boolean> {
    if (!this.drivers.input?.startPairing) return false;
    await this.drivers.input.startPairing();
    return true;
  }

  /** Paired remotes with the override slug each one answers to. */
  async listRemotes(): Promise<Array<import("./drivers.js").RemoteDeviceInfo & { overridden: boolean }>> {
    const devices = (await this.drivers.input?.listRemotes?.()) ?? [];
    const overridden = new Set(overriddenDevices(this.doc?.inputs));
    // One remote often bonds as several records (BLE + classic); the slug is
    // the identity users map, so merge: connected if any is, battery if any reports.
    const bySlug = new Map<string, import("./drivers.js").RemoteDeviceInfo>();
    for (const d of devices) {
      const prev = bySlug.get(d.device);
      bySlug.set(d.device, prev
        ? { ...prev, connected: prev.connected || d.connected, battery: prev.battery ?? d.battery }
        : { ...d });
    }
    return [...bySlug.values()].map((d) => ({ ...d, overridden: overridden.has(d.device) }));
  }

  /* ------------------------------ §5 blocking ---------------------------- */

  /** Boot: shell supplies the source set (with bundled baseline text where it has one). */
  startBlocking(sources: BlockSourceSpec[] = DEFAULT_BLOCK_SOURCES, opts?: { intervalMs?: number }): Promise<void> {
    return this.blocking.start(sources, opts);
  }

  /** What the settings UI shows per category (§5 transparency). */
  blockingStatus(): BlockSourceStatus[] {
    return this.blocking.status();
  }

  setBlockingEnabled(id: string, enabled: boolean): Promise<boolean> {
    return this.blocking.setEnabled(id, enabled);
  }

  syncBlockLists(): Promise<BlockSourceStatus[]> {
    return this.blocking.syncAll();
  }

  addBlockList(spec: Omit<BlockSourceSpec, "defaultOn">): Promise<boolean> {
    return this.blocking.addCustom(spec);
  }

  removeBlockList(id: string): Promise<void> {
    return this.blocking.remove(id);
  }

  /** Which enabled list would block this host — the "whose judgment" answer (§5). */
  blockedBy(host: string): string | null {
    return this.blocking.blockedBy(host);
  }

  /* ------------------------------ §28 updates ---------------------------- */

  /** Boot: shell supplies its version + the static manifest URL. */
  startUpdates(config: UpdateConfig): Promise<void> {
    return this.updates.start(config);
  }

  updateStatus(): UpdateStatus {
    return this.updates.status();
  }

  checkUpdates(): Promise<UpdateStatus> {
    return this.updates.check();
  }

  setUpdateChannel(channel: UpdateChannel): Promise<void> {
    return this.updates.setChannel(channel);
  }

  dismissReleaseNotes(): Promise<void> {
    return this.updates.dismissNotes();
  }

  /* -------------------------- §14 private listening ---------------------- */

  /**
   * Transports the shell can serve from one capture: capture is required;
   * without a serve hook the only honest answer is "none".
   */
  private resolveTransports(drivers: Drivers): ListenTransport[] {
    if (typeof drivers.surface.captureAudio !== "function" || !drivers.media?.serveAudio) return [];
    const declared = drivers.media.audioTransports?.();
    // Synchronous declaration only at construction; async shells answer via refreshTransports().
    return Array.isArray(declared) ? declared : ["webrtc"];
  }

  /** Late capability declaration (Android bridge learns it from init options). */
  setAudioTransports(transports: ListenTransport[]): void {
    this.listening.setTransports(transports);
  }

  listeningStatus(): ListeningStatus & { streamPath: string | null } {
    return { ...this.listening.status(), streamPath: this.drivers.media?.audioStreamPath?.() ?? null };
  }

  /**
   * The §14 chips for the wall (CS-10.2): who is listening privately, and the
   * slot they are hearing. Every listener hears the §3 audio owner — §14 is one
   * capture of the frame's own output, not a per-slot feed — so the chips all
   * name that slot; see `listeningChips`.
   *
   * `names` is supplied by the caller (the shell reads it from `RemoteApi`)
   * because pairing lives there; the tokens are dropped here and never reach a
   * chip, a log or the wire.
   */
  listeningChips(names: Readonly<Record<string, string>> = {}): ListeningChip[] {
    return listeningChips(this.listening.status(), names, this.audio.focusedMedia);
  }

  /** A paired phone toggles "Listen on this phone" (transport chosen by the remote client). */
  async setListening(
    listener: string,
    enable: boolean,
    mode?: SpeakerMode,
    transport?: ListenTransport,
  ): Promise<boolean> {
    const ok = await this.listening.setListening(listener, enable, mode, transport);
    if (ok && !enable) await this.drivers.media?.webrtcClose?.(listener); // explicit leave tears the peer down
    if (ok) await this.applyAvOffset();
    return ok;
  }

  /**
   * §14 WebRTC signaling relay. Only a listener admitted on the webrtc
   * transport may negotiate; the shell answers from its capture mix.
   */
  async webrtcOffer(listener: string, offerSdp: string): Promise<string | null> {
    const me = this.listening.status().listeners.find((l) => l.id === listener);
    if (!me || me.transport !== "webrtc" || !this.drivers.media?.webrtcOffer) return null;
    return this.drivers.media.webrtcOffer(listener, offerSdp);
  }

  async webrtcIce(listener: string, candidate: string): Promise<boolean> {
    const me = this.listening.status().listeners.find((l) => l.id === listener);
    if (!me || me.transport !== "webrtc" || !this.drivers.media?.webrtcIce) return false;
    await this.drivers.media.webrtcIce(listener, candidate);
    return true;
  }

  /** Remote client keepalive; missed beats become a peer drop (§14 grace). */
  listenerHeartbeat(listener: string): Promise<boolean> {
    return this.listening.heartbeat(listener);
  }

  /** Explicit "resume speakers" after a paused listener. */
  async resumeSpeakers(): Promise<void> {
    await this.listening.resumeSpeakers();
  }

  /** Per-transport measurement/nudge; re-applies to the playing video tiles. */
  async setAvOffset(ms: number, transport?: ListenTransport): Promise<number> {
    const applied = this.listening.setAvOffset(ms, transport);
    if (this.listening.status().active) await this.applyAvOffset();
    return applied;
  }

  private async applyAvOffset(): Promise<void> {
    const ms = this.listening.activeOffsetMs();
    if (!ms) return;
    for (const id of this.surfaces) {
      if (this.audio.isPlaying(id)) await this.drivers.surface.inject(id, null, avOffsetJs(ms));
    }
  }

  /* -------------------------------- §21 VPN ------------------------------ */

  /** Boot: bring a stored tunnel up before tiles load. */
  restoreVpn(): Promise<void> {
    return this.vpn.restore();
  }

  vpnStatus(): Promise<VpnStatus> {
    return this.vpn.status();
  }

  configureVpn(conf: string): Promise<"ok" | "invalid" | "unsupported"> {
    return this.vpn.configure(conf);
  }

  clearVpn(): Promise<void> {
    return this.vpn.clear();
  }

  /** Wake: full brightness, tiles revive behind the §16 crossfade. */
  async wakeUp(): Promise<void> {
    await this.drivers.display?.setPower("wake");
    await this.drivers.display?.setBrightness(1);
    if (this.lowPower) {
      this.lowPower = false;
      await this.lifecycle.reviveAll();
      this.preview.resume();
    }
  }

  /** §24 alarm: pre-empts low power, then sunrise → tone. */
  fireAlarm(): void {
    this.alarm.fire();
    void this.persistNextAlarm(); // re-arm bookkeeping for the next occurrence
  }

  /** Persist the next armed alarm time (§24 reboot survival + missed check). */
  private async persistNextAlarm(): Promise<void> {
    if (!this.drivers.store || !this.doc) return;
    const delays = (this.doc.schedule ?? [])
      .filter((e) => e.action === "alarm" && e.at)
      .map((e) => msUntil(e.at!, new Date()))
      .filter((n): n is number => n !== null);
    if (delays.length) {
      await this.drivers.store.set(
        "alarm:armed",
        new Date(Date.now() + Math.min(...delays)).toISOString(),
      );
    }
  }

  dismissAlarm(): void {
    this.missedAlarm = null;
    this.alarm.dismiss();
  }

  snoozeAlarm(): void {
    this.alarm.snooze();
  }

  alarmStatus(): { status: string; missed: string | null } {
    return { status: this.alarm.status, missed: this.missedAlarm };
  }

  /* ------------------- §19 compatibility reports ------------------- */

  setCompatContext(context: CompatContext): void {
    this.compat.setContext(context);
  }

  /** Offers past the threshold — the exact payloads, for edit-mode display. */
  pendingReports(): Promise<PendingOffer[]> {
    return this.compat.pending();
  }

  /** Per-incident decision; transmits via the Net driver only on send. */
  async decideReport(key: string, send: boolean): Promise<CompatReport | null> {
    const report = await this.compat.decide(key, send);
    if (report && this.drivers.net?.submitCompatReport) {
      await this.drivers.net.submitCompatReport(JSON.stringify(report));
    }
    return report;
  }

  private async recordCompat(kind: ReportKind, tileId: string): Promise<void> {
    const tile = this.tile(tileId);
    if (!tile?.url) return;
    const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
    const adapterRef = tile.adapter
      ? `${tile.adapter}@${spec?.version ?? "unknown"}`
      : null;
    await this.compat.record(kind, tile.url, adapterRef);
  }

  /** Snapshot of live state for the remote API (§6 GET /state). */
  getState(): RemoteStateSnapshot | null {
    if (!this.doc) return null;
    const heroMode = this.doc.layout?.mode === "hero";
    return {
      dashboard: this.doc.id,
      name: this.doc.name,
      layoutMode: heroMode ? "hero" : this.doc.layout?.mode === "solo" ? "solo" : this.doc.layout?.mode === "fixed" ? "fixed" : "grid",
      ...(!heroMode && this.doc.layout?.mode !== "solo" && this.doc.layout?.mode !== "fixed"
        ? { grid: { cols: this.doc.grid?.cols ?? 1, rows: this.doc.grid?.rows ?? 1 } }
        : {}),
      ...(this.framing ? { framing: this.framing.id } : {}),
      fullscreen: this.fullscreen,
      hero: heroMode ? this.override.hero ?? (this.doc.layout as { hero: string }).hero : null,
      heroSize: heroMode
        ? clampHeroSize(this.override.heroSize ?? (this.doc.layout as { heroSize: number }).heroSize)
        : null,
      tiles: this.doc.tiles.map((t) => ({
        id: t.id,
        audio: t.audio ?? "mute",
        playing: this.audio.isPlaying(t.id),
        state: this.lifecycle.status(t.id) ?? "live",
        ...(t.url ? { url: t.url } : {}),
        ...(t.focus ? { focus: t.focus } : {}),
        ...(t.zoom !== undefined && t.zoom !== 1 ? { zoom: t.zoom } : {}),
        app: this.appKeyOf(t),
        ...(this.shortcutsFor(t.id).length
          ? { userShortcuts: this.shortcutsFor(t.id).map((s) => ({ id: s.id, label: s.label, url: s.url, hasRegion: !!s.focus?.region, ...(s.aspectHint ? { aspectHint: s.aspectHint } : {}) })) }
          : {}),
        ...(t.launch ? { launch: t.launch.package } : {}),
        ...(t.kind === "floating" ? { kind: "floating" as const, float: clampFloat(t.float) } : {}),
        ...(t.placeholder ? { placeholder: true } : {}),
        ...(t.visualization ? { visualization: { ...t.visualization } } : {}),
        ...(this.music.revealed().facet === t.id ? { revealed: this.music.revealed().mode } : {}),
        ...(this.elementFullscreen.has(t.id) ? { elementFullscreen: true } : {}),
        ...(t.aspectHint ? { aspectHint: t.aspectHint } : {}),
        ...(this.nowPlaying.has(t.id) ? { nowPlaying: this.nowPlaying.get(t.id)! } : {}),
        ...(this.musicPending.has(t.id) ? { musicPending: { ...this.musicPending.get(t.id)! } } : {}),
        ...(this.musicOrder.has(t.id) ? { musicOrder: this.musicOrderOf(t.id)! } : {}),
        ...(this.musicRepeat.get(t.id) ? { musicRepeat: true } : {}),
        ...(this.musicWork.has(t.id) ? { musicWork: { ...this.musicWork.get(t.id)! } } : {}),
        ...(this.stallNotes.has(t.id) ? { stall: { ...this.stallNotes.get(t.id)! } } : {}),
        ...((() => { const r = this.resumeCache.get(t.id); return r && !this.nowPlaying.get(t.id)?.title && !this.musicPending.has(t.id) ? { resume: { title: r.title, ...(r.artist ? { artist: r.artist } : {}), ...(r.label ? { label: r.label } : {}), ...(r.kind ? { kind: r.kind } : {}) } } : {}; })()),   // B-204: what Play would resume
        ...((() => { const rs = t.adapter ? this.adapters.get(t.adapter) : undefined; const off = this.nowPlaying.get(t.id)?.context?.unavailable ?? []; return rs && (rs.controls?.thumbUp || (rs.musicCmd && rs.capabilities?.includes("rating"))) && !off.includes("thumbUp") ? { rate: true } : {}; })()),   // 2026-09-14: not while the page hides its thumbs (Pandora, during an ad)
        ...(this.sessionState.has(t.id) ? { session: this.sessionState.get(t.id)! } : {}),
        ...(t.url && t.adapter && this.adapters.get(t.adapter)?.login ? { loginUrl: this.adapters.get(t.adapter)!.login } : {}),
        ...(t.url && t.adapter && this.adapters.get(t.adapter)?.loginPress ? { loginPress: this.adapters.get(t.adapter)!.loginPress } : {}),
        ...(t.url && t.adapter && this.adapters.get(t.adapter)?.shortcuts?.length ? { shortcuts: this.adapters.get(t.adapter)!.shortcuts } : {}),
        ...(t.url && t.adapter && this.adapters.get(t.adapter)?.login && t.url.startsWith(this.adapters.get(t.adapter)!.login!.split("?")[0]!) ? { onLogin: true } : {}),
        ...this.modeFields(t.id),
        ...(this.lifecycle.isPeeking(t.id) ? { peeking: true } : {}),
        ...(t.tapAction ? { tapAction: t.tapAction } : {}),
        ...(this.veilMode(t) !== "off"
          ? {
              veil: {
                mode: this.veilMode(t),
                blocking: this.blockingFor(t),
                sources: t.url ? this.cosmetics.selectorsFor(hostnameOf(t.url)).sources : [],
              },
            }
          : {}),
        ...(this.intermission.isCovered(t.id) ? { intermission: true, ...(this.adInfo.get(t.id)?.count ? { adCount: this.adInfo.get(t.id)!.count } : {}) } : {}),
        ...(this.intermission.isSkipAvailable(t.id) ? { skipAvailable: true } : {}),
      })),
      masterLayouts: this.listMasterLayouts(),
      apps: this.knownApps().map((a) => ({ id: a.id, name: a.name, ...(a.tile.kind === "floating" ? { floating: true } : {}) })),
      appViews: Object.fromEntries(this.knownApps().map((a) => [a.id, this.shortcuts.get(a.id) ?? []])),
      scenes: this.listScenes(),
      currentScene: this.currentScene,
      ...(this.popups.size ? { popups: [...this.popups].map(([id, p]) => ({ id, ...p })) } : {}),
      music: this.musicState(),
      slotShapes: this.slotShapes(this.viewport),
      focused: this.focused,
      entered: this.entered,
      audioOwner: this.audio.focusedMedia,
      ...(this.wallMuted ? { muted: true } : {}),   // B-150/B-151: the wall's one mute switch
      foregroundApp: this.foregroundApp,
      dashboards: this.dashboards(),
      alarm: this.alarmStatus(),
    };
  }

  /** Execute a §6 tile command. */
  async tileCommand(
    tileId: string,
    cmd: string,
  ): Promise<"ok" | "unknown-tile" | "unknown-cmd" | "unavailable"> {
    if (!this.tile(tileId)) return "unknown-tile";
    // a tile the live budget put to sleep (warm) wakes before it is asked anything (2026-09-24: Apple Music's hidden source had been suspended
    // at boot and its Play reached a page with no engine)
    if (this.lifecycle.status(tileId) === "warm") await this.lifecycle.touch(tileId);
    switch (cmd) {
      case "skip": {
        // §26 pass-through: every caller of tileCommand("skip") is a human
        // action (remote request, mapped key, chip tap). Forward only to a
        // control the adapter DECLARED and currently OBSERVES as available.
        const tile = this.tile(tileId)!;
        if (tile.launch) {
          // Native app: click the observed node through the shell's accessibility
          // observer — still only because a human asked, still only while observed.
          const target = this.appSkipTargets.get(tileId);
          if (!target || !this.intermission.isSkipAvailable(tileId)) return "unavailable";
          if (!this.drivers.media?.appSkip) return "unknown-cmd";
          return (await this.drivers.media.appSkip(tile.launch.package, target)) ? "ok" : "unavailable";
        }
        const declared = tile.adapter ? this.adapters.get(tile.adapter)?.controls?.skip : undefined;
        const selector = this.intermission.skipTargetSelector(tileId) ?? declared;
        if (!selector) return "unknown-cmd";
        if (!this.intermission.isSkipAvailable(tileId)) return "unavailable";
        await this.drivers.surface.inject(tileId, null, clickControlJs(selector));
        return "ok";
      }
      case "close": {
        // §27 pass-through: a human wants the site's own close/dismiss
        // control (a dismissible overlay). Declared control only; never automatic.
        const tile = this.tile(tileId)!;
        const selector = tile.adapter ? this.adapters.get(tile.adapter)?.controls?.close : undefined;
        if (!selector) return "unknown-cmd";
        await this.drivers.surface.inject(tileId, null, clickControlJs(selector));
        return "ok";
      }
      case "offer": {
        // 2026-09-14: the service's own offer (Pandora's "Get more skips" at the skip limit), shown on the wall from the
        // page's context and pressed only by a human. Declared control only; the ad it starts is a break like any other.
        const tile = this.tile(tileId)!;
        const selector = tile.adapter ? this.adapters.get(tile.adapter)?.controls?.offer : undefined;
        if (!selector) return "unknown-cmd";
        await this.drivers.surface.inject(tileId, null, clickControlJs(selector));
        return "ok";
      }
      // B-155 (2026-09-08): a thumbs up / down goes to the SERVICE - its player API (Apple's ratings through MusicKit) or its own
      // control (Pandora's thumbs) - so the verdict reaches the algorithm that picks the next song. Never from a timer.
      case "thumbup":
      case "thumbdown": {
        const tile = this.tile(tileId)!;
        const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
        const like = cmd === "thumbup";
        const viaPlayer = spec?.musicCmd && spec.capabilities?.includes("rating") ? `(window.__prismMusicCmd&&window.__prismMusicCmd(${JSON.stringify(like ? "like" : "dislike")}))` : null;
        const declared = like ? spec?.controls?.thumbUp : spec?.controls?.thumbDown;
        // B-163 (2026-09-08): a dislike is "less of this, and not this one": the service gets the verdict, and if it has not
        // moved on by itself within a moment (Pandora does; Apple's rating only rates) the wall sends Next. A service with
        // no dislike at all (Spotify) gets the skip alone.
        if (!like && !viaPlayer && !declared) return this.tileCommand(tileId, "next");
        if (!viaPlayer && !declared) return "unavailable";
        const js = viaPlayer && declared ? `(function(){if(${viaPlayer})return true;return ${clickControlJs(declared)};})()` : viaPlayer ?? clickControlJs(declared!);
        await this.drivers.surface.inject(tileId, null, this.withWake(spec, js));
        void this.drivers.surface.inject(tileId, null, "setTimeout(function(){window.__prismReportNow&&window.__prismReportNow()},400)");   // the face shows the verdict
        if (!like) {
          const before = this.nowPlaying.get(tileId)?.title ?? null;
          setTimeout(() => { if (this.tile(tileId) && (this.nowPlaying.get(tileId)?.title ?? null) === before) void this.tileCommand(tileId, "next"); }, 2500);
        }
        return "ok";
      }
      case "reload":
        this.refreshTile(tileId);
        return "ok";
      case "restart": {   // B-141: Start over
        const r = await this.restartMusic(tileId);
        return r === "ok" ? "ok" : r === "unknown-tile" ? "unknown-tile" : "unavailable";
      }
      case "restart": {   // B-141: Start over
        const r = await this.restartMusic(tileId);
        return r === "ok" ? "ok" : r === "unknown-tile" ? "unknown-tile" : "unavailable";
      }
      case "launch": {
        // §12 via remote: open the tile's native app.
        const t = this.tile(tileId)!;
        if (!t.launch || !this.drivers.media) return "unknown-cmd";
        await this.drivers.media.launch(t.launch.package, t.launch.deepLink);
        return "ok";
      }
      case "hero":
        await this.promoteHero(tileId);
        return "ok";
      case "fullscreen": {
        // Same as OK on the TV remote: takeover AND the page gets the remote.
        if (!(await this.enterFullscreen(tileId))) return "unavailable";
        await this.enterTile(tileId);
        return "ok";
      }
      case "normal":
        await this.leaveTile();
        await this.exitFullscreen();
        return "ok";
      // B-122 (2026-09-07): a human's mute/unmute goes through §3's focus machine, never around it. Unmuting
      // TAKES the audio (the previous owner is muted, keeps playing silently) so core's audioOwner names this
      // tile and the transport's button reads "mute" next; muting gives the focus up. Before this the button
      // only flipped the surface flag, the owner never changed, and every press sent "unmute" again.
      // the wall's one mute switch (B-150): mute keeps the owner silent, unmute lets it sound; nothing about WHO owns changes -
      // except that an unmute while nobody owns the audio gives it to the source the button belongs to (a boot, a fresh scene)
      case "mute": {
        if (this.audio.focusedMedia !== tileId) await this.drivers.surface.setMuted(tileId, true);   // a remote's "mute this tile" still lands on the tile
        await this.setWallMuted(true);
        return "ok";
      }
      case "unmute": {
        await this.setWallMuted(false);
        await this.claimAudio(tileId);   // B-122: unmuting on a source is the ask to hear THAT source - it takes the audio
        return "ok";
      }
      case "play":
      case "pause":
      case "next":
      case "prev":
      // §32 pass-through, same path: the page's OWN seek handlers, when it
      // registered them. A wall player that can only play/pause sends people
      // back into the service's page for everything else, and reveal is meant
      // to be a visitor (§2.5.3) - login, not residence.
      case "seekforward":
      case "seekbackward": {
        // §5: adapters own site-specific media behavior; play/pause degrade
        // to direct media-element control when no adapter is bound.
        const tile = this.tile(tileId)!;
        // B-263 (2026-09-21): no seek while the page says an ad is running - Paramount+ stitches its ads into the title's own
        // stream, so the wall's Forward 10 s during the break moved past the ad (read live: the stream went 691 -> 706 under
        // the break counter). The ad is covered by the veil, never skipped (section 26); the verb answers unavailable
        if ((cmd === "seekforward" || cmd === "seekbackward") && this.video.inAd(tileId)) return "unavailable";
        // B-131 (2026-09-07): the wall's Play is a human's press - arm the tile so the playback it starts takes the
        // audio (section 3) instead of being read as the page playing itself and left muted (Pandora: "I press play,
        // nothing happens, it says Paused"). Quick play picks already armed; the transport did not.
        if (cmd === "pause" && this.elementFullscreen.has(tileId) && this.video.isVideoTile(tileId)) this.wallPausedAt.set(tileId, Date.now());
        if (cmd === "pause" && !this.rePausing && this.video.isVideoTile(tileId)) this.pauseHeld.set(tileId, Date.now()); else if (cmd === "play") this.pauseHeld.delete(tileId);
        if (cmd === "play") this.arm(tileId);   // B-150 (corrected 2026-09-08): Play keeps a person's mute - "I unpaused and it unmuted it erroneously"; only unmute lifts it
        // B-181 (2026-09-09): "Says paused, pressed play, no change ... it did start, slowly. Just didn't know it was loading" -
        // a Play on a page that holds a track is the same wait as a Quick play pick, so it carries the same signal: line 2
        // reads "loading <title>..." with the ring until the page reports playing, "couldn't start" after the pick timeout
        if (cmd === "play" && this.nowPlaying.get(tileId)?.title && !this.nowPlaying.get(tileId)?.playing && !this.musicPending.has(tileId)) {
          const np = this.nowPlaying.get(tileId)!;
          this.setMusicPending(tileId, { kind: "play", id: "play", name: np.title ?? "the music" });
        }
        if (cmd === "play" && !this.nowPlaying.get(tileId)?.title) {
          // nothing queued on the page: resume the last thing this tile played, if Prism ever saw one
          const r = await this.resumeMusic(tileId);
          if (r === "ok") return "ok";
        }
        const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
        const declared = spec?.controls?.[cmd as "next" | "prev"];
        // B-127 (2026-09-07): the service's own player first (the adapter's musicCmd - MusicKit's skip/seek/
        // play), the declared control only when the player did not take it: a DOM selector is the part that
        // rots (Apple's skip control moved into the video player and Next did nothing), the player API is not.
        const viaPlayer = spec?.musicCmd ? `(window.__prismMusicCmd&&window.__prismMusicCmd(${JSON.stringify(cmd)}))` : this.video.cmdJs(spec, cmd);   // VP-2: a video adapter's own player the same way
        if (declared) {
          // §26: a declared control, clicked only because a human asked.
          await this.drivers.surface.inject(tileId, null, this.withOffer(spec, cmd, this.withWake(spec, viaPlayer ? `(function(){if(${viaPlayer})return true;return ${clickControlJs(declared)};})()` : clickControlJs(declared))));
          return "ok";
        }
        if (viaPlayer && !tile.launch) {
          await this.drivers.surface.inject(tileId, null, `(function(){if(${viaPlayer})return true;return ${mediaFallbackJs(cmd)};})()`);
          return "ok";
        }
        // §32 page-side routing: the page's own Media Session handler (the
        // OS media keys' function, captured by the shell's bootstrap), then
        // the adapter's onMediaCommand, then the bare element (play/pause).
        // Next/prev thus work on any service that registers them.
        if (tile.launch) return "unknown-cmd";
        await this.drivers.surface.inject(tileId, null, mediaFallbackJs(cmd));
        return "ok";
      }
      case "retry": {
        // the person's second try after the page's own playback error (2026-09-21): the title's address again
        if (!this.video.isVideoTile(tileId)) return "unavailable";
        return this.video.retry(tileId);
      }
      case "nextepisode":
      case "skipintro":
      case "captions":
      case "fullscreen": {
        // the next episode shown at once, when the service's own list knows it (see videoExpectEpisode)
        if (cmd === "nextepisode") {
          const v = this.video.state([tileId])[0]?.video;
          const hit = v?.series && v.id ? this.listEpisodeById(v.series, String(v.id)) : null;
          if (v?.series && hit?.next) this.videoExpectEpisode(tileId, { series: v.series, season: hit.next.season, episode: hit.next.episode, title: hit.next.title, id: hit.next.id });
        }
        // VP-2 (2026-09-19): verbs only a video adapter's own script can take - Netflix's Skip Intro, the next episode, the
        // captions control - clicked only because a human asked (section 26 pass-through); no element fallback makes sense
        const tile = this.tile(tileId)!;
        const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
        const js = this.video.cmdJs(spec, cmd);
        if (!js || !VIDEO_ONLY_CMDS.includes(cmd)) return "unavailable";
        if (cmd !== "captions") this.arm(tileId);
        await this.drivers.surface.inject(tileId, null, js);
        return "ok";
      }
      default:
        return "unknown-cmd";
    }
  }

  // ---- VP-2 (2026-09-19): the video player's own calls, delegated to video.ts
  private readonly video: VideoController = new VideoController({
    adapterOf: (id) => { const t = this.tile(id); return t?.adapter ? this.adapters.get(t.adapter) : undefined; },
    adapterIdOf: (id) => this.tile(id)?.adapter ?? null,
    tileExists: (id) => !!this.tile(id),
    inject: (id, js) => Promise.resolve(this.drivers.surface.inject(id, null, js)),
    navigate: (id, url) => Promise.resolve(this.drivers.surface.navigate(id, url)),
    dashId: () => this.doc?.id ?? null,
    store: () => this.drivers.store,
    arm: (id) => this.arm(id),
    urlOf: (id) => this.currentUrl.get(id) ?? this.tile(id)?.url ?? null,
    onStage: (id) => this.elementFullscreen.has(id),
    claimAudio: (id) => this.claimAudio(id),
    enterStage: (id) => this.videoEnterStage(id),
    // the playback doctor (2026-09-23): its read of the page's error, and a person's pause or press, which it never heals over
    evaluate: async (id, js) => (this.drivers.surface.evaluate ? await this.drivers.surface.evaluate(id, js) : null),
    scrub: async (id, x, y) => { if (this.drivers.surface.scrub) await this.drivers.surface.scrub(id, x, y); },
    personActedSince: (id, since) => (this.pauseHeld.get(id) ?? 0) >= since || (this.pageTouchedAt.get(id) ?? 0) >= since,
  });
  // a removal the service did not keep is asked again (2026-09-23): the controller notices it in the next list read, core runs the job
  private readonly listReturnedHook = (this.video.onListReturned = (a: string, it: VideoItem, n: number) => this.retryRemoval(a, it, n));
  /** The title each sound-owning video tile last had its page's own mute lifted for (once per title). */
  private readonly unmutedFor = new Map<string, string>();
  /** A person's own press inside a page (the shell's interaction event), per tile. */
  private readonly pageTouchedAt = new Map<string, number>();
  /** Every video tile on the wall with its face, library, resume point and what it can do. */
  /** A series pick's own episode: the one left partway on this service, when the wall saw it (VideoController.seriesEpisodeUrl). */
  videoSeriesEpisodeUrl(adapterKey: string, series: string): string | null { return this.video.seriesEpisodeUrl(adapterKey, series); }
  videoState(): VideoTileState[] { return this.withListEpisodes(this.video.state((this.doc?.tiles ?? []).map((t) => t.id))); }
  /**
   * An episode the player names only by number (Netflix's face: "E2", "Episode 2", no season - 2026-09-25) is found in the service's own
   * episode list by its id: the list's season, number and title fill in what the face left out. A face that names its season is left alone.
   */
  /**
   * The episode a screen is on its way to (2026-09-25, "When I press the back button in the first five seconds of an episode to go to the previous
   * episode ... there is a long delay to update the episode title" - on the control bar): Prism knows where it sent the screen before the service
   * says so, so the screen shows that episode at once - until the page names it (or another), or EXPECT_MS passes.
   */
  private readonly expecting = new Map<string, { series: string; season: number; episode: number; title: string; id: string | null; at: number; from: string }>();
  static readonly EXPECT_MS = 25_000;
  /** Which episode a face names, for telling one from another: its id, season and number. */
  private static episodeMark(v: { id?: string | null; season?: number | null; episode?: number | null } | null): string {
    if (!v) return "";
    return [v.id ?? "", v.season ?? "", v.episode ?? ""].join("|").replace(/^\|+$/, "");
  }
  /** The person's Re-sync on a screen: pause and play, or - pressed again soon - the title opened again at its place (VideoController.resync). */
  videoResync(tileId: string): "nudged" | "reopened" | "unavailable" { return this.video.resync(tileId); }
  videoExpectEpisode(tileId: string, e: { series: string; season: number; episode: number; title: string; id?: string | null }): void {
    const now = this.video.state([tileId])[0]?.video ?? null;
    this.expecting.set(tileId, { series: e.series, season: e.season, episode: e.episode, title: e.title, id: e.id ?? null, at: Date.now(), from: Orchestrator.episodeMark(now) });
  }
  private withExpected(t: VideoTileState): VideoTileState {
    const x = this.expecting.get(t.id);
    if (!x) return t;
    const v = t.video;
    // the page names any episode but the one it left: its own word from there (the one expected, or another it chose)
    const mark = Orchestrator.episodeMark(v ?? null);
    const arrived = !!v && ((!!x.id && String(v.id ?? "") === x.id) || (mark !== "" && mark !== x.from));
    if (arrived || Date.now() - x.at > Orchestrator.EXPECT_MS) { this.expecting.delete(t.id); return t; }
    return { ...t, video: { ...(v ?? { kind: "episode", title: "" }), kind: "episode", series: x.series, season: x.season, episode: x.episode, title: x.title, position: 0 } };
  }
  private withListEpisodes(ts: VideoTileState[]): VideoTileState[] {
    return ts.map((t0) => {
      const t = this.withExpected(t0);
      const v = t.video;
      if (!v || v.kind !== "episode" || !v.series || !v.id || typeof v.season === "number") return t;
      const hit = this.listEpisodeById(v.series, String(v.id));
      if (!hit) return t;
      const plain = !v.title || /^episode\s*\d+$/i.test(v.title.trim());
      return { ...t, video: { ...v, season: hit.ep.season, episode: hit.ep.episode, title: plain && hit.ep.title ? hit.ep.title : v.title ?? "" } };
    });
  }
  /** The service's own list entry for an episode id of a series, and the episode after it (the next season's first after a season's last). */
  private listEpisodeById(series: string, id: string): { ep: EpisodeItem; next: EpisodeItem | null } | null {
    this.loadEpisodeLists();
    const tail = "|" + titleKey(series);
    for (const [key, e] of this.episodeLists) {
      if (!key.endsWith(tail) || e.source !== "service") continue;
      const flat = e.seasons.filter((sn) => sn.season > 0).flatMap((sn) => sn.episodes.map((ep) => ({ ...ep, season: sn.season })));
      const i = flat.findIndex((ep) => ep.id === id);
      if (i >= 0) return { ep: flat[i]!, next: flat[i + 1] ?? null };
    }
    return null;
  }
  videoLibrary(tileId: string) { return this.video.library(tileId); }
  /** VP-3: a service's kept library and resume point by its adapter's name, on the wall or not (sync; the first ask starts the read). */
  videoLibraryOf(appKey: string) { return this.video.libraryOf(appKey); }
  /** Phase 2: a report from an App's popped-out surface feeds that App's rows (keyed by its adapter's name). */
  videoObservePreview(adapterKey: string, info: NowPlaying | null): void { this.video.onPreviewObservation(adapterKey, info); }
  /** Phase 2: the universal menu's merged rows (video-menu-spec §2 / §4) over the named services. */
  /**
   * The Library tab (2026-09-22, "ratings on the owned items ... these could all be in a tab with rows separated by genre"): the
   * owned titles across services, one card per title (the runtime's dedupe), each rated and placed under its first TMDB genre -
   * rows in the household's genre order by count, alphabetical within; titles TMDB has no genre for yet under "Unsorted". The
   * ratings and genres are asked for as a TMDB-only read (no open source) and cached a day.
   */
  videoLibraryRows(cards: ReadonlyArray<{ app: string; service: string; facet: string; item: VideoItem; also?: unknown }>, sort: HubSort = "own", group: "genre" | "none" = "genre"): { rows: Array<{ genre: string; cards: Array<Record<string, unknown>> }>; pending: number; rated: number } {
    const hasKey = this.lenses.hasKey();
    // TMDB alone (withRatings false): the ratings ask had also pulled every title's Wikidata item, paced at one a second, so two thousand titles crawled at that pace (2026-09-22)
    if (hasKey) this.lenses.ensure(cards.slice(0, 2500).map((c) => ({ title: c.item.title, kind: c.item.kind, providers: providersOf(this.adapters.get(this.adapterKeyForApp(c.app) ?? c.app)) })), ["tmdb", "poster"], false);   // poster: the backdrop too, the Library cards in every tab's shape
    const facts = this.lenses.factsOf();
    const byGenre = new Map<string, Array<Record<string, unknown>>>();
    let rated = 0;
    for (const c of cards) {
      const f = factsFor(facts, c.item.title, c.item.kind);
      const rating = ratingLabel(f?.rating);
      if (rating) rated++;
      // a store's bonus material ("Dolphin Tale 2: Blooper Reel (featurette)", "... - The Making of ...") is owned, and is not a title: the Extras row, last
      const extra = /\(featurette\)|\bfeaturette\b|blooper reel|\bthe making of\b|behind the scenes|deleted scenes|\(bonus\b|bonus feature/i.test(c.item.title);
      const genre = extra ? "Extras" : f?.genres?.[0] ?? (f?.at.tmdb ? "Other" : "Unsorted");
      const card = { ...c, rating, genres: f?.genres ?? [], released: releaseOf(f) };
      (byGenre.get(genre) ?? byGenre.set(genre, []).get(genre)!).push(card);
    }
    // Group by None (2026-09-23, "Add an option for None (so we can just sort the whole library)"): every title in one group, in the sort chosen; the Extras stay apart
    if (group === "none") {
      const all = [...byGenre.entries()].filter(([g]) => g !== "Extras").flatMap(([, list]) => list);
      const rowsN = all.length ? [{ genre: "All titles", cards: sortCards(all as Array<{ item: VideoItem }>, sort, facts) as Array<Record<string, unknown>> }] : [];
      const extrasN = byGenre.get("Extras"); if (extrasN?.length) rowsN.push({ genre: "Extras", cards: extrasN });
      return { rows: rowsN, pending: this.lenses.pending, rated };
    }
    const rows = [...byGenre.entries()].filter(([g]) => g !== "Unsorted" && g !== "Extras").sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([genre, list]) => ({ genre, cards: sortCards(list as Array<{ item: VideoItem }>, sort, facts) as Array<Record<string, unknown>> }));
    const unsorted = byGenre.get("Unsorted"); if (unsorted?.length) rows.push({ genre: "Unsorted", cards: unsorted });
    const extras = byGenre.get("Extras"); if (extras?.length) rows.push({ genre: "Extras", cards: extras });
    return { rows, pending: this.lenses.pending, rated };
  }
  private adapterKeyForApp(app: string): string | null { const a = this.modelApps?.().find((x) => x.id === app); return a?.adapter ?? a?.catalogRef ?? null; }
  /** the runtime hands the App list over once, for the Library tab's adapter lookups */
  modelApps: (() => ReadonlyArray<{ id: string; adapter?: string; catalogRef?: string }>) | null = null;
  /** TMDB's poster for a title the service gave none for (the owned cards), when the resolver has it. */
  posterFor(title: string, kind?: string | null): string | null { return factsFor(this.lenses.factsOf(), title, kind)?.poster ?? null; }
  /** TMDB's landscape backdrop for a title (2026-09-23, "Library is showing the movie posters, instead of the landscape oriented images ... use the same image style we're using elsewhere"). */
  backdropFor(title: string, kind?: string | null): string | null { return factsFor(this.lenses.factsOf(), title, kind)?.backdrop ?? null; }
  videoMenuRows(services: readonly { app: string; name: string; facet: string; adapter: string }[]): { continue: LensedCard[]; list: LensedCard[]; log: number; lens: LensBlock; lensRows: LensRow[] } {
    // TMDB's new-episode banner on My List (2026-09-23): only under a key, only where the service gave none
    const now = Date.now();
    const listBadge = this.lenses.hasKey() ? (it: VideoItem, adapter: string) => newEpisodeBadge(this.lenses.lastAired(it.title, it.kind, providersOf(this.adapters.get(adapter))), now) : undefined;
    const rows = this.video.menu(services.map((s) => ({ ...s, listMerge: this.adapters.get(s.adapter)?.videoListMerge !== false })), now, listBadge);
    // §4a as rows (2026-09-21, "Continue Watching and My List do not retain their context when moving away from Your Own
    // Order ... make those rows of carousels to look through below"): the two rows keep their OWN order always; every lens
    // is a row of its own beneath them - the household's titles (both rows, each title once) in the lens's order, the
    // titles the lens has no number for left out - a pure order over the rows and the lens's own data. The facts every
    // lens needs are read in the background (the cache first, then the open sources; the TMDB lenses only under a key).
    const hasKey = this.lenses.hasKey();
    // Watch carries one lens row, Most read on Wikipedia (2026-09-22, option 2 of three): the others only re-sorted the household's own two
    // rows - "First released, on Wikidata" showed four titles, "TMDB community rating" mostly things already seen - and Browse already
    // reads the catalog on the household's services by rating, date and votes. The lenses stay defined (lensChoose, the remote).
    const shown = LENSES.filter((l) => l.id === WATCH_LENS && (!l.needsKey || hasKey));
    const titles = [...rows.continue, ...rows.list].map((c) => ({ title: c.item.title, kind: c.item.kind, providers: providersOf(this.adapters.get(services.find((s) => s.app === c.app)?.adapter ?? c.app)) }));   // the card's own service tells a same-name pair apart (B-269)
    const needs = [...new Set(shown.flatMap((l) => l.needs))];
    if (titles.length) this.lenses.ensure(titles, needs, hasKey);
    // a card the service gave no poster (Movies Anywhere's lazy images): TMDB's, under the key - asked for those cards alone (2026-09-22)
    const bare = services.flatMap((s) => (this.video.libraryOf(s.adapter).library.owned ?? []).filter((x) => !x.artwork).map((x) => ({ title: x.title, kind: x.kind, providers: providersOf(this.adapters.get(s.adapter)) })));
    // ... and a Continue Watching / My List card that came without one (Hulu's Adults, 2026-09-23: "Adults - Hulu on my list line is gray instead of showing the poster")
    const tall = (c: { app: string }, row: "continue" | "list") => !!this.adapters.get(services.find((s) => s.app === c.app)?.adapter ?? c.app)?.videoArtPortrait?.includes(row);
    for (const [row, list] of [["continue", rows.continue], ["list", rows.list]] as const) for (const c of list) if (!c.item.artwork || tall(c, row)) bare.push({ title: c.item.title, kind: c.item.kind, providers: providersOf(this.adapters.get(services.find((s) => s.app === c.app)?.adapter ?? c.app)) });
    if (hasKey && bare.length) this.lenses.ensure(bare.slice(0, 400), ["poster"], false);
    const facts = this.lenses.factsOf();
    // the Watch tab's rows keep their own order always (§4 for the two rows, each lens's own for its row): a global sort here made every
    // lens row look the same ("now a lot of the lensed rows look the same. Maybe we should only do that in the library", 2026-09-22) - the sort is the Library tab's
    // a title being removed from its service's Continue Watching is out of the row while the removal works; a failure brings it back (2026-09-22)
    const removing = (c: { app: string; item: { id: string } }) => this.removeJobs.get(c.app + "|" + c.item.id)?.status === "working";
    // a card with no picture takes TMDB's poster; a service whose row art is tall takes TMDB's landscape backdrop instead (2026-09-23)
    const withArt = (row: "continue" | "list") => <T extends { app: string; item: VideoItem }>(c: T): T => {
      const wide = tall(c, row) ? this.backdropFor(c.item.title, c.item.kind) : null;
      if (wide) return { ...c, item: { ...c.item, artwork: wide } };
      return c.item.artwork ? c : { ...c, item: { ...c.item, artwork: this.backdropFor(c.item.title, c.item.kind) ?? this.posterFor(c.item.title, c.item.kind) } };
    };
    const cont = orderByLens(rows.continue.filter((c) => !removing(c)), null, facts).map(withArt("continue")); const list = this.listRowWithJobs(orderByLens(rows.list, null, facts), services).map(withArt("list"));
    const seen = new Set<string>();
    const once = [...rows.continue, ...rows.list].filter((c) => { const k = titleKey(c.item.title); if (seen.has(k)) return false; seen.add(k); return true; });
    const lensRows: LensRow[] = shown.map((l) => {
      const cards = orderByLens(once, l, facts).filter((c) => c.lens !== null && c.lens !== undefined);
      return { id: l.id, name: l.name, counted: l.counted, who: l.who, decides: l.decides, source: l.source, sourceUrl: l.sourceUrl, formula: l.formula, attribution: l.attribution ?? null, dataDate: lensDataDate(cards), cards };
    });
    const lens = this.activeLens;
    const block: LensBlock = {
      active: lens, lenses: LENSES.map((l) => ({ id: l.id, name: l.name, needsKey: l.needsKey ?? null })),
      dataDate: null, pending: this.lenses.pending, tmdbKey: hasKey,
      attribution: hasKey ? TMDB_ATTRIBUTION : null,
    };
    return { continue: cont, list, log: rows.log, lens: block, lensRows };
  }
  // ---------------------------------------------------------------- lenses and ratings (video-menu-spec §4a, 2026-09-20)
  private activeLens: LensDef | null = null;
  private lensResolver: LensResolver | null = null;
  private get lenses(): LensResolver {
    return (this.lensResolver ??= new LensResolver({
      fetchStatic: async (url) => { if (!this.drivers.net?.fetchStatic) throw new Error("no static fetch"); return this.drivers.net.fetchStatic(url); },
      ...(this.drivers.net?.fetchKeyed ? { fetchKeyed: async (url: string, headers: Record<string, string>) => this.drivers.net!.fetchKeyed!(url, headers) } : {}),
      store: () => this.drivers.store, dashId: () => this.doc?.id ?? null, now: () => Date.now(),
    }));
  }
  /** The lens laid over the menu; null (the default, and every boot's start) shows the person's own order. Unknown ids are refused. */
  lensChoose(id: string | null): LensDef | null { this.activeLens = lensById(id); return this.activeLens; }
  lensSetTmdbKey(key: string | null): void { this.lenses.setKey(key); }
  lensHasKey(): boolean { return this.lenses.hasKey(); }
  lensDiag() { return this.lenses.diag(); }
  /** The stage bar's next-episode card: TMDB's word on the episode after the one the tile plays (the face's series, season and episode). */
  videoNextEpisode(tileId: string): { ready: boolean; next: import("./lenses.js").NextEpisode | null; series: string | null; from?: "service" | "tmdb" } {
    const t = this.videoState().find((x) => x.id === tileId);
    const v = t?.video;
    // the service's own list first (2026-09-25, "the next episode pops up at the bottom with no preview image or details"): its next episode,
    // with the service's own picture and words, and a face that names no season (Netflix) still has one
    if (v?.series && v.id) {
      const hit = this.listEpisodeById(v.series, String(v.id));
      if (hit?.next) return { ready: true, series: v.series, from: "service", next: { season: hit.next.season, episode: hit.next.episode, name: hit.next.title, still: hit.next.still, airDate: hit.next.airDate ?? null, overview: hit.next.synopsis } };
    }
    if (!v || !v.series || typeof v.season !== "number" || typeof v.episode !== "number") return { ready: true, next: null, series: null };
    const spec = t?.adapter ? this.adapters.get(t.adapter) : undefined;
    const r = this.lenses.nextEpisode(v.series, v.season, v.episode, providersOf(spec));
    return { ...r, series: v.series, from: "tmdb" };
  }
  /** The details card for a title: TMDB's facts, polled until ready (title-details.ts). */
  /** The TMDB providers an adapter claims (tmdbProviders): how a "Where to watch" offer finds the household's service. */
  providersOfAdapter(adapterKey: string): number[] { return providersOf(this.adapters.get(adapterKey)); }
  /** The service's own landscape picture for an owned title (videoOwnedArtWide), or null. */
  ownedWideArt(adapterKey: string, id: string): string | null {
    const t = this.adapters.get(adapterKey)?.videoOwnedArtWide;
    return t && /^[A-Za-z0-9_-]+$/.test(id) ? t.replace("{id}", id) : null;
  }
  titleDetailsById(kind: "movie" | "tv", id: number) { return this.lenses.titleDetailsById(kind, id); }
  personPage(id: number) { return this.lenses.personPage(id); }
  titleDetails(title: string, kind: string | null, app: string | null) { const key = app ? this.adapterKeyForApp(app) ?? app : null; return this.lenses.titleDetails(title, kind, key ? providersOf(this.adapters.get(key)) : []); }
  /** A card's rating disclosure and outbound links (navigation only). */
  lensDisclosure(title: string): { rating: string | null; links: Array<{ name: string; url: string }>; facts: unknown } {
    const f = factsFor(this.lenses.factsOf(), title);
    const r = f?.rating ?? null;
    return { rating: r ? `★ ${r.mean.toFixed(1)} · TMDB · ${r.votes} votes` : null, links: outboundLinks(f), facts: f ? { article: f.article ?? null, qid: f.qid ?? null, awards: f.awards ?? null, released: f.released ?? null, views7: f.views7 ?? null, rating: r, at: f.at } : null };
  }
  /** Boot: the key is read from the store so ratings can show before any press. */
  private lensBoot(): void { void this.lenses.key(); }
  /** The adapter's search address for a service, with the words in place (video-menu-spec §3 searchUrl). */
  videoSearchUrlFor(adapterKey: string, q: string): string | null {
    const t = this.adapters.get(adapterKey)?.videoSearchUrl;
    return t ? t.replace("{q}", encodeURIComponent(q)) : null;
  }
  /** An adapter's spec by name (the menu asks what a service can do). */
  adapterSpec(name: string): AdapterSpec | undefined { return this.adapters.get(name); }
  /** The adapter that claims this address's host, if any (the registry's `match`). */
  adapterNameForUrl(url: string | null | undefined): string | null { return this.adapters.forUrl(url); }
  /** Quick play of a title on a video tile (a human's tap). */
  videoPlay(tileId: string, kind: string, id: string, url: string | null, name?: string) { return this.video.play(tileId, kind, id, url, name); }
  private readonly videoPlayQueued = new Map<string, { kind: string; id: string; url: string | null; name?: string; at: number }>();
  /**
   * Call off a pick that has not played yet (2026-09-22, "If a video is 'Starting on...' give me a 'Cancel and Return to Watch' option"): the
   * plays, tunes and searches queued for a page still loading are dropped, every video tile's pending pick and stage ask go, and a screen
   * that had already begun is paused - a human asked, so the pause is theirs (section 26 pass-through). The catalog's own background
   * resolve is dropped by the runtime's pick counter.
   */
  videoCancelPick(): { ok: true; paused: string[] } {
    this.videoPlayQueued.clear(); this.videoTuneQueued.clear(); this.videoSearchQueued.clear();
    const paused: string[] = [];
    const hero = this.videoMultiviewHero();
    for (const t of this.videoState()) {
      // multiview: the small windows play on - only the big one (where the pick was going) and a tile with the pick pending stop
      if (hero && t.id !== hero && !t.pending) continue;
      this.video.cancelPick(t.id);
      if (t.playing) { void this.tileCommand(t.id, "pause"); paused.push(t.id); }
      else this.pickCancelledAt.set(t.id, Date.now());
    }
    return { ok: true, paused };
  }
  private readonly pickCancelledAt = new Map<string, number>();

  // ---- multiview (2026-09-23, "up to 3 PIPs, and a button to turn it on/off and one for swapping the video of focus to the next service
  // instantly"): the Video player's windows in order, the big one first. The runtime composes the order (it knows the scene); core places
  // the windows by it and gives the big one the sound. Kept across a restart (videoUpBoot).
  private mv: { on: boolean; slot: string | null; order: string[]; collapsed?: boolean } = { on: false, slot: null, order: [] };
  /** The small windows a hide paused (they play again when multiview is shown). */
  private readonly mvHidePaused = new Set<string>();
  /** The windows small at the last layout (their framing set aside). */
  private mvSmall = new Set<string>();
  /** The screen slot is out of multiview (parked, paused) at the last layout. */
  private mvParked = false;
  /** Multiview on (the scene's screen slot the first window) or off. */
  videoMultiviewSet(on: boolean, slot: string | null): void {
    this.mv = { on, slot: on ? slot : null, order: on && slot ? [slot] : [] };
    this.mvHidePaused.clear();
    this.persistMultiview();
    void this.applyLayout();
  }
  /** The windows, big first, as the runtime composes them; the layout and the sound follow at once. */
  async videoMultiviewOrder(order: readonly string[]): Promise<void> {
    if (!this.mv.on) return;
    const was = this.videoMultiviewHero();
    this.mv.order = [...new Set(order)].slice(0, MV_MAX);
    this.persistMultiview();
    await this.applyLayout();
    const hero = this.videoMultiviewHero();
    if (hero) await this.claimAudio(hero);
    // a new big window is the ask to hear it: its player muted ITSELF while it was small or restored (Peacock's sat at muted, volume 0,
    // after a Swap - "switched to Peacock - Mrs Davis, but there is no audio", 2026-09-23) - the page's own mute is lifted, once, here
    if (hero && hero !== was && this.video.isVideoTile(hero)) await this.drivers.surface.inject(hero, null, UNMUTE_PLAYER_JS);
  }
  videoMultiviewState(): { on: boolean; slot: string | null; order: string[]; collapsed: boolean } {
    return { on: this.mv.on, slot: this.mv.slot, order: this.mv.order.filter((id) => !!this.tile(id)), collapsed: !!this.mv.collapsed };
  }
  /**
   * Multiview hidden / shown (2026-09-23, "When I turn off multiview, it should just hide the 3 windows, but instead it stopped the episode I
   * was watching in the main screen ... it refreshed"): the small windows leave the wall and pause - their pages kept - and the big one is
   * not touched at all; shown again, they come back to their places and the ones the hide paused play on.
   */
  async videoMultiviewCollapse(collapse: boolean): Promise<void> {
    if (!this.mv.on || !!this.mv.collapsed === collapse) return;
    const small = this.mv.order.filter((id) => !!this.tile(id) && this.surfaces.has(id)).slice(1);
    this.mv.collapsed = collapse;
    this.persistMultiview();
    if (collapse) {
      for (const id of small) if (this.video.state([id])[0]?.playing) { this.mvHidePaused.add(id); await this.tileCommand(id, "pause"); }
      await this.applyLayout();
      return;
    }
    await this.applyLayout();
    for (const id of [...this.mvHidePaused]) if (small.includes(id)) await this.tileCommand(id, "play");
    this.mvHidePaused.clear();
  }
  /** The big window while multiview is on, else null. */
  videoMultiviewHero(): string | null { return this.mv.on ? this.mv.order.find((id) => !!this.tile(id)) ?? null : null; }
  /** A small window's play never takes the sound from the big one. */
  private mvKeepsAudio(tileId: string): boolean {
    if (!this.mv.on) return false;
    const hero = this.videoMultiviewHero();
    // a small window, or the screen slot parked out of multiview: neither takes the sound from the big window (or from nothing)
    return tileId !== hero && (this.mv.order.includes(tileId) || (tileId === this.mv.slot && !this.mv.order.includes(tileId)));
  }
  // ---- the TV off and on again (2026-09-23, "I'd like a restart to result in the same mode, # of videos, and specific videos playing as
  // when it closed. Like turning off a tv and on again"). What each video tile has up - the title's own address and its name - is kept
  // as it changes (an ad changes nothing; the page leaving the title for another address clears it), with multiview's arrangement. On
  // the boot each such tile loads straight at its title's address - the service's own player resumes it there, the adapter's play
  // script is not run (Netflix's would load the address a second time) - and the title counts as a pick on its way: its name on the
  // feed, the stage asked, the big window's sound. This replaces 2026-09-21's "a video service comes back on its home page" for a
  // title that was UP at close; a tile that was on the service's own pages still comes back home.
  private videoUp = new Map<string, { url: string; name: string }>();
  /** Titles this boot is bringing back: the tile's address to load, until its page is up. */
  private readonly bootTitles = new Map<string, { url: string; name: string }>();
  /** When each tile last loaded a page: a page still loading names no title yet, which is not the title closing. */
  private readonly navAt = new Map<string, number>();
  static readonly VIDEO_UP_SETTLE_MS = 30_000;
  private videoUpKey(dashId: string): string { return `video:up:${dashId}`; }
  private multiviewKey(dashId: string): string { return `video:multiview:${dashId}`; }
  private persistMultiview(): void {
    if (!this.doc || !this.drivers.store) return;
    try { void this.drivers.store.set(this.multiviewKey(this.doc.id), this.mv.on ? JSON.stringify(this.mv) : ""); } catch { /* best effort */ }
  }
  private persistVideoUp(): void {
    if (!this.doc || !this.drivers.store) return;
    try { void this.drivers.store.set(this.videoUpKey(this.doc.id), JSON.stringify(Object.fromEntries(this.videoUp))); } catch { /* best effort */ }
  }
  /** After each report from a video tile: what it has up now, kept when it changed. */
  private noteVideoUp(tileId: string): void {
    const tile = this.tile(tileId);
    if (!this.doc || !tile?.url || !tile.adapter || !isVideoAdapter(this.adapters.get(tile.adapter))) return;
    if (this.bootTitles.has(tileId)) return;   // still coming back: the page has not said anything yet
    const ctx = this.video.state([tileId])[0]?.video ?? null;
    const url = this.currentUrl.get(tileId) ?? null;
    const was = this.videoUp.get(tileId);
    const bare = (u: string) => u.split("?")[0]!.split("#")[0]!.replace(/[/]+$/, "");
    let next = was;
    // only a title that PLAYED is brought back after a restart (2026-09-23, "You also continue to open up the apple tv home page ... Watch shouldn't
    // keep closing and defaulting to a service's home page"): Apple TV's episode page names its title before anything plays, and Hijack - never
    // started - came back 'loading' at every boot, its page in Watch's corner
    if (ctx && !ctx.ad && (ctx.title || ctx.series) && (ctx.playing || (typeof ctx.position === "number" && ctx.position > 5)) && url && sameRegistrableDomain(url, tile.url) && bare(url) !== bare(tile.url)) next = { url, name: ctx.series || ctx.title || "" };
    // the title closed: its browse page, another address - but not in a page's first seconds (2026-09-24: each restart lost titles - a restored
    // page's first report named nothing while its player loaded, often at a moved address, and the kept title was dropped; three restarts
    // took The Rookie, DANG! and Georgie & Mandy, and their windows came back on home pages)
    else if ((!ctx || (!ctx.title && !ctx.series)) && was && url && bare(url) !== bare(was.url) && Date.now() - (this.navAt.get(tileId) ?? 0) > Orchestrator.VIDEO_UP_SETTLE_MS) next = undefined;
    if ((next?.url ?? null) === (was?.url ?? null) && (next?.name ?? null) === (was?.name ?? null)) return;
    if (next) this.videoUp.set(tileId, next); else this.videoUp.delete(tileId);
    this.persistVideoUp();
  }
  /** Each load: the document's kept record read back; on the boot, multiview's arrangement and the titles to bring back. */
  private async videoUpBoot(doc: DashboardDocument, boot: boolean): Promise<void> {
    this.videoUp = new Map();
    this.bootTitles.clear();
    if (!this.drivers.store) return;
    let mvRec: { on?: unknown; slot?: unknown; order?: unknown } | null = null;
    try {
      const raw = await this.drivers.store.get(this.videoUpKey(doc.id));
      const rec = raw ? JSON.parse(raw) as Record<string, { url?: unknown; name?: unknown }> : null;
      if (rec && typeof rec === "object") for (const [id, v] of Object.entries(rec)) if (v && typeof v.url === "string") this.videoUp.set(id, { url: v.url, name: typeof v.name === "string" ? v.name : "" });
      if (boot) { const m = await this.drivers.store.get(this.multiviewKey(doc.id)); mvRec = m ? JSON.parse(m) : null; }
    } catch { /* unreadable: the wall comes back as a fresh one */ }
    if (!boot) return;
    const has = (id: unknown): id is string => typeof id === "string" && doc.tiles.some((t) => t.id === id);
    if (mvRec?.on === true && has(mvRec.slot) && !this.mv.on) {
      const order = Array.isArray(mvRec.order) ? mvRec.order.filter(has) : [];
      this.mv = { on: true, slot: mvRec.slot, order: (order.length ? order : [mvRec.slot]).slice(0, MV_MAX), ...((mvRec as { collapsed?: unknown }).collapsed === true ? { collapsed: true } : {}) };
    }
    for (const [id, up] of this.videoUp) {
      const tile = doc.tiles.find((t) => t.id === id);
      if (!tile?.url || this.surfaces.has(id) || !sameRegistrableDomain(up.url, tile.url)) { this.videoUp.delete(id); continue; }
      this.bootTitles.set(id, up);
    }
  }
  /** The titles coming back, marked as picks on their way (the feed's name, the stage asked); the big window - or a lone title - takes the sound. */
  private async videoUpMark(stamp: boolean): Promise<void> {
    const hero = this.videoMultiviewHero();
    const lone = this.bootTitles.size === 1;
    for (const [id, up] of this.bootTitles) await this.video.restoreTitle(id, up.url, up.name, stamp && (hero ? id === hero : lone));
  }
  /** The address a tile's page is at now (to take a title into the screen slot when multiview closes). */
  currentUrlOf(tileId: string): string | null { return this.currentUrl.get(tileId) ?? null; }
  static readonly PICK_CANCEL_MS = 30_000;
  /** A title brought back by the boot that has not started this long after its page came up gets its address once more. */
  static readonly RESTORE_STALL_MS = 45_000;
  /** A title brought back that is not playing this long after its page came up has its service's Play pressed (an address that waits for one). */
  static readonly RESTORE_PRESS_MS = 8_000;
  /** A video on its stage the wall paused: the player's leaving fullscreen within this long was the pause's doing, and it goes back. */
  static readonly PAUSE_KEEPS_STAGE_MS = 5_000;
  private readonly wallPausedAt = new Map<string, number>();
  /** A video the wall paused, and when: a play the page starts by itself soon after is paused once more. */
  static readonly PAUSE_HOLD_MS = 60_000;
  private readonly pauseHeld = new Map<string, number>();
  private rePausing = false;
  /** VP-3: the title to play on this tile once its page is up (the screen is being switched to its service). */
  videoPlayWhenUp(tileId: string, pick: { kind: string; id: string; url: string | null; name?: string }): void { this.videoPlayQueued.set(tileId, { ...pick, at: Date.now() }); }
  private readonly videoTuneQueued = new Map<string, { channelId: string; at: number }>();
  /** The screen slot re-assigned to another service: what the last service left on the tile is cleared (a pick, a hint, a face, a queued play or tune). */
  videoClearTile(tileId: string): void { if (this.videoUp.delete(tileId)) this.persistVideoUp(); this.bootTitles.delete(tileId); this.video.clearTile(tileId); this.videoPlayQueued.delete(tileId); this.videoTuneQueued.delete(tileId); this.videoSearchQueued.delete(tileId); }
  private readonly videoSearchQueued = new Map<string, { q: string; open?: string | null; at: number }>();
  /** Phase 2: the words to enter into this tile's search once its page is up (and the result to press, for a cross-service pick). */
  videoSearchWhenUp(tileId: string, q: string, open?: string | null): void { this.videoSearchQueued.set(tileId, { q, ...(open ? { open } : {}), at: Date.now() }); }

  // ---------------------------------------------------------------- cross-service search (video-menu-spec §2 row 5, 2026-09-19)
  // "All the services get searched but the app returns the results straight to the screen." One query, every signed-in
  // service at once, each on its own HIDDEN surface (kind "hidden": parked off-canvas at full size, never revealed - the
  // wall shows nothing of it) in the App's own profile: its search address with the words when it has one, else its home
  // where the adapter's lookup script enters the words itself. The adapter's videoLookup script reads what the page
  // shows and posts it back with the token core handed it (the music-result channel, op "lookup"); core cleans and keeps
  // the answers per service, the menu draws them as one labeled row. Surfaces stay for a few minutes of repeat searches,
  // then go. Nothing leaves the machine but the service's own page requests.
  private readonly lookups = new Map<string, { app: string; adapter: string | null; up: boolean; upWaits: Array<() => void>; lastUsed: number; /** standing on the service's list page: its reports feed the My list row */ onList?: boolean; /** standing on the service's Who's watching page: its report is the household, read only */ onProfiles?: boolean; /** walk the app's own route to its list once the home is up (videoListRoute) */ routeOnUp?: boolean; listRead?: number; listNavAt?: number; lastListEmpty?: boolean; /** the profile page reported */ profilesAt?: number; /** an owned walk reached its end */ ownedDone?: number }>();
  private lookupNow: LookupState | null = null;
  private lookupSeq = 0;
  private lookupIdleTimer: ReturnType<typeof setTimeout> | null = null;
  static readonly LOOKUP_UP_TIMEOUT_MS = 25_000;
  static readonly LOOKUP_ANSWER_TIMEOUT_MS = 30_000;
  static readonly LOOKUP_IDLE_MS = 180_000;

  /** The search as it stands (a shell polls this while `done` is false). */
  videoLookupState(): LookupState | null { return this.lookupNow; }

  /** Start a cross-service search: the services as the runtime names them (signed-in ones searched, the rest listed with why). */
  videoLookupStart(q: string, services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; profile: string; home: string; status: string }>, only?: string): LookupState {
    const token = `vl${++this.lookupSeq}`;
    const at = Date.now();
    const state: LookupState = { q, token, startedAt: at, done: false, services: [] };
    this.lookupNow = state;
    // the catalog first (2026-09-21): with the household's own TMDB key the titles come from TMDB and each is matched to
    // the household's services by TMDB's providers data; the services' own search pages only when there is no key, TMDB
    // does not answer, or one service is asked for one title (a catalog card's press)
    if (!only && this.lenses.hasKey()) {
      state.source = "catalog"; state.attribution = CATALOG_ATTRIBUTION;
      void this.catalogLookup(state, services).then((ok) => {
        if (this.lookupNow !== state) return;
        if (ok && state.catalog?.length) { state.done = true; return; }
        if (ok && !state.services.length) { state.done = true; return; }
        // TMDB did not answer, or knows no title on the household's services (a live channel, a network's name): the
        // services' own pages answer too, the catalog's word kept on the status line (2026-09-22)
        if (!ok) { delete state.source; delete state.attribution; delete state.catalog; delete state.elsewhere; }
        state.services.length = 0;
        this.servicesLookup(state, services, q);
      });
      this.touchLookups();
      return state;
    }
    state.source = "services";
    this.servicesLookup(state, only ? services.filter((s) => s.app === only) : services, q);
    return state;
  }

  /** TMDB's titles for the words, each matched to the household's services through TMDB's providers (JustWatch's); false when TMDB did not answer. */
  private async catalogLookup(state: LookupState, services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; status: string }>): Promise<boolean> {
    const search = await this.lenses.tmdbGet("/search/multi", `query=${encodeURIComponent(state.q)}&include_adult=false`);
    if (!search || !Array.isArray(search.results)) return false;
    // the people the words matched, as TMDB names them (2026-09-23 search upgrade): a press lists their work on the household's services
    state.people = peopleFromSearch(search.results);
    // the words ARE a person's name: their whole filmography, not TMDB's three "known for" titles (2026-09-23, "it only found him in 3 series. Does
    // that sound right? I dont think so")
    const who = state.people[0];
    if (who && normSearch(who.name) === normSearch(state.q)) {
      const credits = await this.lenses.tmdbGet(`/person/${who.id}/combined_credits`);
      if (credits) {
        const theirs = titlesFromSearch(creditsAsResults(credits), 40).map((t) => ({ ...t, via: who.name }));
        const rest = titlesFromSearch(search.results, 16).filter((t) => !theirs.some((x) => x.kind === t.kind && x.id === t.id));
        return this.catalogFromTitles(state, [...theirs, ...rest], services);
      }
    }
    return this.catalogFromTitles(state, titlesFromSearch(search.results, 16), services);
  }
  /**
   * A person's work (2026-09-23): TMDB's combined credits - cast and crew, most popular first - through the same matching to the household's
   * services as a title search. The state's words are the person's name; `person` says whose work it is.
   */
  videoLookupPersonStart(id: number, name: string, services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; status: string }>): LookupState {
    const token = `vl${++this.lookupSeq}`;
    const state: LookupState = { q: name, token, startedAt: Date.now(), done: false, services: [], source: "catalog", attribution: CATALOG_ATTRIBUTION, person: { id, name } };
    this.lookupNow = state;
    void (async () => {
      const credits = this.lenses.hasKey() ? await this.lenses.tmdbGet(`/person/${id}/combined_credits`) : null;
      if (this.lookupNow !== state) return;
      if (credits) await this.catalogFromTitles(state, titlesFromSearch(creditsAsResults(credits), 24), services);
      state.done = true;
    })().catch(() => { state.done = true; });
    this.touchLookups();
    return state;
  }
  private async catalogFromTitles(state: LookupState, found: Array<Omit<CatalogTitle, "offers">>, services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; status: string }>): Promise<boolean> {
    const region = "US";
    const titles: CatalogTitle[] = [];
    const elsewhere = new Set<string>();
    const unmapped: Record<string, number> = {};   // the providers no adapter claims, by TMDB's id - how an adapter's tmdbProviders is checked (never shown)
    const svc = services.map((s) => ({ ...s, providers: providersOf(this.adapters.get(s.adapter)) }));
    const mine = new Set(svc.flatMap((s) => s.providers));
    await Promise.all(found.map(async (t) => {
      const cacheKey = `${t.kind}:${t.id}`;
      const cached = this.providersCache.get(cacheKey);
      let region_: unknown = cached?.value;
      if (!cached || Date.now() - cached.at > Orchestrator.PROVIDERS_TTL_MS) {
        const p = await this.lenses.tmdbGet(`/${t.kind}/${t.id}/watch/providers`);
        region_ = (p?.results as Record<string, unknown> | undefined)?.[region] ?? null;
        this.providersCache.set(cacheKey, { at: Date.now(), value: region_ });
      }
      titles.push({ ...t, offers: offersFromProviders(region_) });
      const r = region_ && typeof region_ === "object" ? (region_ as Record<string, unknown>) : {};
      for (const k of ["flatrate", "free", "ads", "rent", "buy"]) for (const pv of (Array.isArray(r[k]) ? r[k] : []) as Array<{ provider_id?: number; provider_name?: string }>) if (typeof pv.provider_id === "number" && !mine.has(pv.provider_id) && typeof pv.provider_name === "string") { elsewhere.add(pv.provider_name); unmapped[pv.provider_name] = pv.provider_id; }
    }));
    if (this.lookupNow !== state) return true;
    // TMDB's order again (the reads finished in any order)
    const byKey = new Map(titles.map((t) => [`${t.kind}:${t.id}`, t]));
    const ordered = found.map((t) => byKey.get(`${t.kind}:${t.id}`)).filter((t): t is CatalogTitle => !!t);
    const rows = catalogRows(state.q, ordered, svc);
    // a title the person owns on the service says so (Fandango's library, 2026-09-22): 'Owned' in place of Rent / Buy, and first among that title's cards
    await Promise.all(ordered.map((t) => this.ensureHome(t, svc.map((s) => s.adapter))));
    const byId = new Map(ordered.map((t) => [`tmdb:${t.kind}:${t.id}`, t]));
    for (const r of rows) {
      const t = byId.get(r.candidate.id);
      if (t && this.ownsWork(svc.find((x) => x.app === r.app)?.adapter ?? r.app, t)) { r.offer = "Owned"; r.offers = []; }
    }
    // ... and a title the person owns on a service JustWatch lists no provider for (Movies Anywhere) is a card on that service too
    const want = normalizeTrackText(state.q);
    for (const t of ordered) for (const s of svc) {
      if (s.status !== "signed-in" || rows.some((r) => r.app === s.app && r.candidate.id === `tmdb:${t.kind}:${t.id}`)) continue;
      if (!this.ownsWork(s.adapter, t)) continue;
      rows.push({ app: s.app, name: s.name, facet: s.facet, exact: !!want && normalizeTrackText(t.title) === want, offer: "Owned", offers: [], candidate: { id: `tmdb:${t.kind}:${t.id}`, title: t.title, kind: t.kind === "tv" ? "series" : "movie", ...(t.year !== undefined ? { year: t.year } : {}), ...(t.poster ? { poster: t.poster } : {}), ...(t.backdrop ? { backdrop: t.backdrop } : {}), ...(t.overview ? { overview: t.overview } : {}), ...(t.genres?.length ? { genres: t.genres } : {}) } });
    }
    rows.sort((a, b) => Number(b.exact) - Number(a.exact) || (a.candidate.id === b.candidate.id ? Number(b.offer === "Owned") - Number(a.offer === "Owned") : 0));
    state.catalog = rows;
    state.elsewhere = rows.length ? [] : [...elsewhere].slice(0, 8);
    state.unmapped = unmapped;
    // the services row, for the status line: who carries something, who is not signed in
    for (const s of svc) {
      const row: LookupServiceState = { app: s.app, name: s.name, facet: s.facet, status: "ok", candidates: rows.filter((r) => r.app === s.app).map((r) => r.candidate), at: Date.now() };
      if (s.status !== "signed-in") { row.status = "unavailable"; row.reason = s.status === "needs-attention" ? "sign in first" : "not set up"; }
      else if (!s.providers.length) { row.status = "unavailable"; row.reason = "not among TMDB's providers"; }
      else if (!row.candidates.length) row.status = "empty";
      state.services.push(row);
    }
    return true;
  }
  private readonly providersCache = new Map<string, { at: number; value: unknown }>();
  static readonly PROVIDERS_TTL_MS = 24 * 3_600_000;

  // ---- Browse by genre (2026-09-22, "let people browse by genre ... only transparent algorithms"): browse.ts is the rule, here the reads.
  // A genre's three discover rows are read under the household's key when first opened and kept a day, keyed by the providers the
  // signed-in services claim (a service added is a new read); the services that carry each title come from its watch providers.
  private readonly browseCache = new Map<string, { at: number; done: boolean; rows: Record<DiscoverRowId, BrowseCard[]> }>();
  private readonly browseCounts = new Map<string, { at: number; n: number | null }>();
  private readonly browseCountsBusy = new Set<string>();
  static readonly BROWSE_TTL_MS = 24 * 3_600_000;
  static readonly BROWSE_RETRY_MS = 10 * 60_000;
  private browseServices(services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; status: string }>): { svc: Array<{ app: string; name: string; facet: string; adapter: string; status: string; providers: number[] }>; providers: number[] } {
    const svc = services.filter((s) => s.status === "signed-in").map((s) => ({ ...s, providers: providersOf(this.adapters.get(s.adapter)) }));
    return { svc, providers: [...new Set(svc.flatMap((s) => s.providers))].sort((a, b) => a - b) };
  }
  private async watchProvidersOf(kind: "movie" | "tv", id: number): Promise<unknown> {
    const cacheKey = `${kind}:${id}`;
    const cached = this.providersCache.get(cacheKey);
    if (cached && Date.now() - cached.at <= Orchestrator.PROVIDERS_TTL_MS) return cached.value;
    const p = await this.lenses.tmdbGet(`/${kind}/${id}/watch/providers`);
    const value = (p?.results as Record<string, unknown> | undefined)?.[BROWSE_REGION] ?? null;
    if (p) this.providersCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }
  /** The genre's discover rows as they stand - read in the background when missing or a day old; null without a key. */
  videoBrowseStart(genreId: string, services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; status: string }>, offer: BrowseOffer = "included"): { at: number; done: boolean; rows: Record<DiscoverRowId, BrowseCard[]> } | null {
    const genre = browseGenre(genreId);
    if (!genre || !this.lenses.hasKey()) return null;
    const { svc, providers } = this.browseServices(services);
    const key = genre.id + "|" + offer + "|" + providers.join(",");
    const have = this.browseCache.get(key);
    if (have && (!have.done || Date.now() - have.at <= Orchestrator.BROWSE_TTL_MS)) return have;
    const entry = { at: Date.now(), done: false, rows: have?.rows ?? { top: [], newest: [], voted: [] } };
    this.browseCache.set(key, entry);
    void this.browseRead(genre, entry, svc, providers, offer).then(
      (ok) => { entry.done = true; entry.at = ok ? Date.now() : Date.now() - Orchestrator.BROWSE_TTL_MS + Orchestrator.BROWSE_RETRY_MS; },
      () => { entry.done = true; entry.at = Date.now() - Orchestrator.BROWSE_TTL_MS + Orchestrator.BROWSE_RETRY_MS; });
    return entry;
  }
  private async browseRead(genre: BrowseGenre, entry: { rows: Record<DiscoverRowId, BrowseCard[]> }, svc: Array<{ app: string; name: string; facet: string; adapter: string; status: string; providers: number[] }>, providers: number[], offer: BrowseOffer): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    let answered = 0;
    const cardOf = (row: DiscoverRowId, t: BrowseTitle, titleOffers: CatalogTitle["offers"]): BrowseCard | null => this.catalogCard(t, titleOffers, svc, offer, browseValue(row, t));
    // a row fills itself: page one of each kind, the merged order, the cards in that order; when the household's own services leave the row
    // short (TMDB's offer filter passes a title ANY provider streams), the next page is read and the order rebuilt - the titles already read
    // cost nothing the second time (their providers are kept a day). At most BROWSE_MAX_PAGES pages per kind (2026-09-22).
    for (const row of ["top", "newest", "voted"] as const) {
      const got = await this.browseFillRow(genre, row, svc, providers, offer, cardOf, BROWSE_ROW_SIZE, BROWSE_MAX_PAGES);
      answered += got.answered;
      entry.rows[row] = got.cards;
    }
    return answered > 0;
  }
  /**
   * A catalog title as a card on the household's services (Browse's rows and the most-read row): each service that carries it under the
   * offer filter (Included: a subscription, free, free with ads, or owned - a service that only rents it is dropped), and a service
   * JustWatch lists no provider for where the household owns it (Movies Anywhere); null when no service is left - out, never guessed.
   */
  /** The household owns THIS work on the service - the same name, released, the years agreeing, the same TMDB work when the wall knows it (ownedIsThis). */
  private ownsWork(adapter: string, t: { kind: "movie" | "tv"; id: number; title: string; year?: number | undefined; released?: string | undefined; date?: string | null }): boolean {
    const owned = this.video.libraryOf(adapter).library.owned ?? [];
    if (!owned.length) return false;
    const today = new Date().toISOString().slice(0, 10);
    const facts = this.lenses.factsOf();
    const work = { kind: t.kind, id: t.id, title: t.title, year: t.year, released: t.released ?? t.date ?? undefined };
    const home = this.homeCache.get(`${t.kind}:${t.id}`)?.atHome;
    return owned.some((o) => ownedIsThis(o, work, factsFor(facts, o.title, o.kind)?.tmdb, today, home ?? undefined));
  }
  /** TMDB's US release dates for a film whose name the household owns on some service (atHomeFrom): read before its card is made, kept a day. */
  private readonly homeCache = new Map<string, { at: number; atHome: boolean | null }>();
  private async ensureHome(t: { kind: "movie" | "tv"; id: number; title: string }, adapters: readonly string[]): Promise<void> {
    if (t.kind !== "movie") return;
    const key = `movie:${t.id}`;
    const c = this.homeCache.get(key);
    if (c && Date.now() - c.at <= Orchestrator.PROVIDERS_TTL_MS) return;
    const want = normalizeTrackText(t.title);
    if (!adapters.some((a) => (this.video.libraryOf(a).library.owned ?? []).some((o) => normalizeTrackText(o.title) === want))) return;   // no owned namesake: nothing to decide
    const j = await this.lenses.tmdbGet(`/movie/${t.id}/release_dates`);
    if (j) this.homeCache.set(key, { at: Date.now(), atHome: atHomeFrom(j, new Date().toISOString().slice(0, 10)) });
  }
  private catalogCard(t: BrowseTitle, titleOffers: CatalogTitle["offers"], svc: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; status: string; providers: number[] }>, offer: BrowseOffer, value: string): BrowseCard | null {
    const ownedOn = (adapter: string) => this.ownsWork(adapter, t);
    const services = catalogRows("", [{ ...t, offers: titleOffers }], svc)
      .map((r) => ({ r, owned: ownedOn(svc.find((s) => s.app === r.app)?.adapter ?? r.app) }))
      .filter(({ r, owned }) => offerCounts(offer, r.offers, owned))
      .map(({ r, owned }) => ({ app: r.app, name: r.name, facet: r.facet, offer: owned ? "Owned" : r.offer }));
    for (const s of svc) if (!services.some((x) => x.app === s.app) && ownedOn(s.adapter)) services.push({ app: s.app, name: s.name, facet: s.facet, offer: "Owned" });
    if (!services.length) return null;
    services.sort((a, b) => Number(b.offer === "Owned") - Number(a.offer === "Owned"));
    const rating = t.mean !== null && t.votes !== null ? ratingLabel({ mean: t.mean, votes: t.votes }) : null;
    return { ...(rating ? { rating } : {}), id: `tmdb:${t.kind}:${t.id}`, kind: t.kind === "tv" ? "series" : "movie", title: t.title, ...(t.year !== undefined ? { year: t.year } : {}), ...(t.poster ? { poster: t.poster } : {}), ...(t.backdrop ? { backdrop: t.backdrop } : {}), ...(t.overview ? { overview: t.overview } : {}), ...(t.genres?.length ? { genres: t.genres } : {}), value, services };
  }

  // ---- Most read on Wikipedia across the household's services (most-read.ts is the rule, here the reads; 2026-09-22). Read in the background
  // under the key, a day at a time, keyed by the offer and the services; the row fills as the titles are read.
  private readonly mostReadCache = new Map<string, MostReadEntry>();
  // ---- New episodes this week / Released this month (fresh-rows.ts, 2026-09-23): TMDB's dates on the household's services, read six-hourly
  private readonly freshCache = new Map<string, FreshEntry>();
  static readonly FRESH_TTL_MS = 6 * 3_600_000;
  // the Most read / New episodes / Released rows kept on the device (2026-09-24, "It seems like it doesnt retain any history on close and
  // relaunch"): a relaunch opens with the last rows, and a read that is due refreshes them in place underneath
  static readonly ROWS_CACHE_KEY = "video:rows-cache";
  private rowsCacheState: "no" | "loading" | "yes" = "no";
  private rowsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The kept rows are still being read at boot (the services' own rows, the lens rows): Watch waits rather than drawing empty rows. */
  videoWarming(): boolean { if (this.lenses.hasKey()) this.rowsCacheReady(); return this.video.warming() || (this.lenses.hasKey() && this.rowsCacheState !== "yes"); }
  /** True once the kept rows are in; the first ask starts the read of the store (a moment). */
  private rowsCacheReady(): boolean {
    if (this.rowsCacheState === "yes") return true;
    if (this.rowsCacheState === "loading") return false;
    this.rowsCacheState = "loading";
    void (async () => {
      try {
        const raw = await this.drivers.store?.get(Orchestrator.ROWS_CACHE_KEY);
        const j = raw ? JSON.parse(raw) as { mr?: Record<string, MostReadEntry>; fr?: Record<string, FreshEntry>; bg?: Record<string, BingeEntry> } : {};
        // a row kept while its read was still going (a restart mid-read) comes back as due: shown at once, read again - it had counted as a
        // finished read for a day (2026-09-24)
        for (const [k, v] of Object.entries(j.mr ?? {})) if (v && Array.isArray(v.cards) && !this.mostReadCache.has(k)) this.mostReadCache.set(k, { ...v, done: true, at: v.done === false ? 0 : v.at });
        for (const [k, v] of Object.entries(j.fr ?? {})) if (v && Array.isArray(v.cards) && !this.freshCache.has(k)) this.freshCache.set(k, { ...v, done: true, at: v.done === false ? 0 : v.at });
        for (const [k, v] of Object.entries(j.bg ?? {})) if (k.startsWith(Orchestrator.BINGE_READ + "|") && v && Array.isArray(v.cands) && !this.bingeCache.has(k)) this.bingeCache.set(k, { ...v, done: true, at: v.done === false ? 0 : v.at });
      } catch { /* a fresh start */ } finally { this.rowsCacheState = "yes"; this.rowsCacheReadyAt = Date.now(); }
    })();
    return false;
  }
  /** The rows written to the device a few seconds after they change (a read in progress is kept as it stands). */
  private saveRowsSoon(): void {
    if (this.rowsSaveTimer || !this.drivers.store) return;
    this.rowsSaveTimer = setTimeout(() => {
      this.rowsSaveTimer = null;
      try {
        void this.drivers.store?.set(Orchestrator.ROWS_CACHE_KEY, JSON.stringify({ mr: Object.fromEntries(this.mostReadCache), fr: Object.fromEntries(this.freshCache), bg: Object.fromEntries(this.bingeCache) }));
      } catch { /* best effort */ }
    }, 5000);
  }
  videoFresh(services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; status: string }>, offer: BrowseOffer, which: "episodes" | "movies"): FreshEntry | null {
    if (!this.lenses.hasKey() || !this.rowsCacheReady()) return null;
    const { svc, providers } = this.browseServices(services);
    if (!svc.length || !providers.length) return null;
    const key = which + "|" + offer + "|" + providers.join(",") + "|" + svc.map((s) => s.app).join(",");
    const have = this.freshCache.get(key);
    if (have && (!have.done || Date.now() - have.at <= Orchestrator.FRESH_TTL_MS)) return have;
    const entry: FreshEntry = { at: Date.now(), done: false, cards: have?.cards ?? [], through: have?.through ?? null };
    this.freshCache.set(key, entry);
    void this.freshRead(entry, svc, providers, offer, which).then(
      (ok) => { entry.done = true; entry.at = ok ? Date.now() : Date.now() - Orchestrator.FRESH_TTL_MS + Orchestrator.BROWSE_RETRY_MS; this.saveRowsSoon(); },
      () => { entry.done = true; entry.at = Date.now() - Orchestrator.FRESH_TTL_MS + Orchestrator.BROWSE_RETRY_MS; });
    return entry;
  }
  private async freshRead(entry: FreshEntry, svc: Array<{ app: string; name: string; facet: string; adapter: string; status: string; providers: number[] }>, providers: number[], offer: BrowseOffer, which: "episodes" | "movies"): Promise<boolean> {
    const now = Date.now();
    const today = dayBefore(now, 0);
    const since = dayBefore(now, which === "episodes" ? FRESH_EPISODE_DAYS : FRESH_MOVIE_DAYS);
    const common = `with_watch_providers=${providers.join("|")}&watch_region=US&with_watch_monetization_types=${encodeURIComponent("flatrate|free|ads")}`;
    const q = which === "episodes"
      ? `air_date.gte=${since}&air_date.lte=${today}&${common}&sort_by=popularity.desc`
      : `primary_release_date.gte=${since}&primary_release_date.lte=${today}&${common}&sort_by=popularity.desc`;   // the film's first release - not a re-release or a TV airing (The Godfather came in by its TV date)
    const kind = which === "episodes" ? "tv" : "movie";
    const found: BrowseTitle[] = [];
    let answered = false;
    for (let page = 1; page <= 3; page++) {
      const j = await this.lenses.tmdbGet(`/discover/${kind}`, q + `&page=${page}`);
      if (!j) break;
      answered = true;
      found.push(...discoverTitles(kind, j.results));
      if (typeof j.total_pages === "number" && page >= j.total_pages) break;
    }
    if (!answered) return false;
    const cards: Array<BrowseCard & { date: string }> = [];
    for (const t of found.slice(0, 60)) {
      let date = t.date;
      if (which === "episodes") {
        // the discover filter says an episode aired in the window; the row's date is the series' latest aired episode
        const d = await this.lenses.tmdbGet(`/tv/${t.id}`);
        const l = d?.last_episode_to_air as Record<string, unknown> | undefined;
        date = typeof l?.air_date === "string" ? l.air_date : null;
        if (!date || date < since || date > today) continue;
      } else if (!date || date < since || date > today) continue;
      await this.ensureHome(t, svc.map((s) => s.adapter));
      const card = this.catalogCard(t, offersFromProviders(await this.watchProvidersOf(t.kind, t.id)), svc, offer, freshValue(which === "episodes" ? "New ep" : "Released", date));
      if (!card) continue;   // on none of the household's services under the offer
      cards.push({ ...card, date });
      const found = new Set(cards.map((c) => c.id));
      entry.cards = orderFresh([...cards, ...entry.cards.filter((c) => !found.has(c.id))]);
      this.saveRowsSoon();
    }
    entry.cards = orderFresh(cards);
    entry.through = today;
    return true;
  }
  // ---- The Binge (binge.ts is the rule, here the read; docs/features/the-binge.md, 2026-09-24): TMDB discover for well-rated short series
  // on the household's services, then each one's details (episode count, runtime, type, keywords, US rating), read daily. The cache keeps
  // the candidates, not the row, so kids mode, a genre and the day's shuffle are applied at once without a read.
  private readonly bingeCache = new Map<string, BingeEntry>();
  // the pool (2026-09-24, "The binge is almost all animations"): TMDB's discover sorted by rating was read 100 deep, which stopped at ~8.5 -
  // anime rates high on TMDB, and the sitcoms below (Seinfeld, Parks, Brooklyn 99) were never read; now read until the rating floor
  // 500 stopped at 7.7 on this household's services (2026-09-24, "only 80 that fit the criteria, is that true?"): read to the floor
  static readonly BINGE_DETAILS_MAX = 2000;
  static readonly BINGE_PAGES_MAX = 100;
  /** the read's version in its cache key: a pool kept by an older read is read again (v2: season 1's median runtime, the deeper pool) */
  static readonly BINGE_READ = "v3";
  videoBinge(services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; status: string }>, offer: BrowseOffer, t: BingeThresholds): BingeEntry | null {
    if (!this.lenses.hasKey() || !this.rowsCacheReady()) return null;
    const { svc, providers } = this.browseServices(services);
    if (!svc.length || !providers.length) return null;
    // the discover's own bounds are the thresholds it can ask; a changed threshold is a new read
    const key = [Orchestrator.BINGE_READ, offer, providers.join(","), svc.map((s) => s.app).join(","), t.maxRuntime, t.minRating, t.minVotes].join("|");
    const have = this.bingeCache.get(key);
    if (have && (!have.done || Date.now() - have.at <= Orchestrator.BROWSE_TTL_MS)) return have;
    const entry: BingeEntry = { at: Date.now(), done: false, cands: have?.cands ?? [], through: have?.through ?? null };
    this.bingeCache.set(key, entry);
    void this.bingeRead(entry, svc, providers, offer, t).then(
      (ok) => { entry.done = true; entry.at = ok ? Date.now() : Date.now() - Orchestrator.BROWSE_TTL_MS + Orchestrator.BROWSE_RETRY_MS; this.saveRowsSoon(); },
      () => { entry.done = true; entry.at = Date.now() - Orchestrator.BROWSE_TTL_MS + Orchestrator.BROWSE_RETRY_MS; });
    return entry;
  }
  private async bingeRead(entry: BingeEntry, svc: Array<{ app: string; name: string; facet: string; adapter: string; status: string; providers: number[] }>, providers: number[], offer: BrowseOffer, t: BingeThresholds): Promise<boolean> {
    const q = `with_watch_providers=${providers.join("|")}&watch_region=US&with_watch_monetization_types=${encodeURIComponent("flatrate|free|ads")}`
      + `&vote_average.gte=${t.minRating}&vote_count.gte=${t.minVotes}&with_runtime.lte=${t.maxRuntime}&sort_by=vote_average.desc`;
    const found: BrowseTitle[] = [];
    let answered = false;
    for (let page = 1; page <= Orchestrator.BINGE_PAGES_MAX; page++) {
      const j = await this.lenses.tmdbGet("/discover/tv", q + `&page=${page}`);
      if (!j) break;
      answered = true;
      found.push(...discoverTitles("tv", j.results));
      if (typeof j.total_pages === "number" && page >= j.total_pages) break;
    }
    if (!answered) return false;
    const cands: BingeCandidate[] = [];
    for (const title of found.slice(0, Orchestrator.BINGE_DETAILS_MAX)) {
      const d = await this.lenses.tmdbGet(`/tv/${title.id}`, "append_to_response=keywords,content_ratings," + encodeURIComponent("season/1"));
      if (!d) continue;
      await this.ensureHome(title, svc.map((s) => s.adapter));
      const card = this.catalogCard(title, offersFromProviders(await this.watchProvidersOf("tv", title.id)), svc, offer, "");
      if (!card) continue;   // on none of the household's services under the offer
      const cand = bingeCandidateOf(card, title, d);
      cands.push(cand);
      const ids = new Set(cands.map((c) => c.card.id));
      entry.cands = [...cands, ...entry.cands.filter((c) => !ids.has(c.card.id))];
      this.saveRowsSoon();
    }
    entry.cands = cands;
    entry.through = dayBefore(Date.now(), 0);
    return true;
  }
  videoMostRead(services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; status: string }>, offer: BrowseOffer, own: ReadonlyArray<{ title: string; kind?: string | null }>): MostReadEntry | null {
    if (!this.lenses.hasKey() || !this.rowsCacheReady()) return null;
    const { svc, providers } = this.browseServices(services);
    if (!svc.length) return null;
    const key = offer + "|" + providers.join(",") + "|" + svc.map((s) => s.app).join(",");
    const have = this.mostReadCache.get(key);
    if (have && (!have.done || Date.now() - have.at <= Orchestrator.BROWSE_TTL_MS)) return have;
    const entry: MostReadEntry = { at: Date.now(), done: false, cards: have?.cards ?? [], through: have?.through ?? null, read: 0 };
    this.mostReadCache.set(key, entry);
    void this.mostReadRead(entry, svc, offer, own).then(
      (ok) => { entry.done = true; entry.at = ok ? Date.now() : Date.now() - Orchestrator.BROWSE_TTL_MS + Orchestrator.BROWSE_RETRY_MS; this.saveRowsSoon(); },
      () => { entry.done = true; entry.at = Date.now() - Orchestrator.BROWSE_TTL_MS + Orchestrator.BROWSE_RETRY_MS; });
    return entry;
  }
  private async mostReadRead(entry: MostReadEntry, svc: Array<{ app: string; name: string; facet: string; adapter: string; status: string; providers: number[] }>, offer: BrowseOffer, own: ReadonlyArray<{ title: string; kind?: string | null }>): Promise<boolean> {
    const days = mostReadDays(Date.now());
    const FOREVER = 3650 * 24 * 3_600_000;   // a past day's list never changes
    let answered = 0;
    // the pool: the top lists' articles whose names say film or series, then the untagged ones near the top (weighed by their description),
    // and the household's own titles (the featured feed's Most read would have carried descriptions, but it refuses an anonymous client, 2026-09-22)
    const tagged: string[] = []; const untagged: string[] = [];
    for (const d of days) {
      const t = await this.lenses.openJson("mrtop2", d, `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${d}`, FOREVER, topListCandidates);
      if (t) { answered++; for (const a of t.tagged) if (!tagged.includes(a)) tagged.push(a); for (const a of t.untagged) if (!untagged.includes(a)) untagged.push(a); }
    }
    const facts = this.lenses.factsOf();
    const ownRefs: Array<{ article: string; ref: { kind: "movie" | "tv"; id: number } }> = [];
    for (const o of own) { const f = factsFor(facts, o.title, o.kind); if (f?.article && f.tmdb) ownRefs.push({ article: f.article, ref: f.tmdb }); }
    const seen = new Set<string>();   // TMDB kind:id already weighed
    const placed = new Set<string>();   // the cards this read put in the row
    const place = async (article: string, t: BrowseTitle | null): Promise<void> => {
      entry.read++;
      if (!t) return;
      const k = `${t.kind}:${t.id}`;
      if (seen.has(k)) return;
      seen.add(k);
      await this.ensureHome(t, svc.map((s) => s.adapter));
      const card = this.catalogCard(t, offersFromProviders(await this.watchProvidersOf(t.kind, t.id)), svc, offer, "");
      if (!card) return;   // on none of the household's services under the offer filter
      const r = await this.lenses.articleReads(article);
      if (!r) return;
      entry.through = r.through;
      placed.add(card.id);
      entry.cards = orderMostRead([...entry.cards.filter((c) => c.id !== card.id), { ...card, value: readsValue(r.views), reads: r.views }]);
      this.saveRowsSoon();
    };
    // TMDB's find by the Wikidata item: a film or a series, or nothing (a person, a book, a season)
    const byItem = async (qid: string): Promise<BrowseTitle | null> => {
      const j = await this.lenses.tmdbGet(`/find/${encodeURIComponent(qid)}`, "external_source=wikidata_id");
      if (!j) return null;
      return discoverTitles("movie", j.movie_results)[0] ?? discoverTitles("tv", j.tv_results)[0] ?? null;
    };
    const byRef = async (ref: { kind: "movie" | "tv"; id: number }): Promise<BrowseTitle | null> => {
      const d = await this.lenses.tmdbGet(`/${ref.kind}/${ref.id}`);
      if (!d) return null;
      return discoverTitles(ref.kind, [{ ...d, genre_ids: Array.isArray(d.genres) ? (d.genres as Array<{ id?: number }>).map((g) => g.id) : [] }])[0] ?? null;
    };
    for (const o of ownRefs) await place(o.article, await byRef(o.ref));
    const named = [...tagged, ...untagged.filter((a) => !tagged.includes(a))].slice(0, MOST_READ_NAMED_MAX);
    for (const article of named) {
      const it = await this.lenses.articleItem(article);
      const screen = tagged.includes(article) || isScreenDescription(it?.description);
      await place(article, it?.qid && screen ? await byItem(it.qid) : null);
    }
    if (answered > 0) entry.cards = entry.cards.filter((c) => placed.has(c.id));   // the last read's titles the lists no longer carry
    return answered > 0;
  }

  /** One row, filled to `want` cards: pages of TMDB's catalog in the row's order, each title matched to the household's own services. */
  private async browseFillRow(genre: BrowseGenre, row: DiscoverRowId, svc: Array<{ app: string; name: string; facet: string; adapter: string; status: string; providers: number[] }>, providers: number[], offer: BrowseOffer, cardOf: (row: DiscoverRowId, t: BrowseTitle, offers: CatalogTitle["offers"]) => BrowseCard | null, want: number, maxPages: number): Promise<{ cards: BrowseCard[]; answered: number; more: boolean }> {
    const today = new Date().toISOString().slice(0, 10);
    const pools: Record<"movie" | "tv", BrowseTitle[]> = { movie: [], tv: [] };
    const seen = new Set<string>();
    let page = 0; let morePages = true; let answered = 0; let cards: BrowseCard[] = [];
    while (cards.length < want && morePages && page < maxPages) {
      page++;
      const answers = await Promise.all((["movie", "tv"] as const).map(async (kind) => {
        const q = discoverQuery(kind, genre, row, providers, today, offer);
        if (!q) return null;
        const j = await this.lenses.tmdbGet(`/discover/${kind}`, `${q}&page=${page}`);
        if (!j) return null;
        answered++;
        return { kind, titles: discoverTitles(kind, j.results), pages: typeof j.total_pages === "number" ? j.total_pages : page };
      }));
      morePages = false;
      for (const a of answers) {
        if (!a) continue;
        if (page < a.pages) morePages = true;
        for (const t of a.titles) { const k = `${t.kind}:${t.id}`; if (seen.has(k)) continue; seen.add(k); pools[a.kind].push(t); }
      }
      const ordered = mergeDiscover(row, pools.movie, pools.tv, want * BROWSE_LOOKAHEAD);
      cards = [];
      for (let i = 0; i < ordered.length && cards.length < want; i += 8) {
        const got = await Promise.all(ordered.slice(i, i + 8).map(async (t) => { await this.ensureHome(t, svc.map((s) => s.adapter)); return cardOf(row, t, offersFromProviders(await this.watchProvidersOf(t.kind, t.id))); }));
        for (const c of got) if (c && cards.length < want) cards.push(c);
      }
    }
    return { cards, answered, more: morePages && page >= maxPages };
  }
  /**
   * A discover row opened in full (2026-09-22, "I should be able to click one of the lenses ... and see other items"): the same row, read
   * deeper - up to BROWSE_FULL_SIZE cards over BROWSE_FULL_PAGES pages per kind. Kept beside the row's own reads, a day, per genre + offer.
   */
  videoBrowseFull(genreId: string, row: DiscoverRowId, services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; status: string }>, offer: BrowseOffer = "included", want = BROWSE_FULL_SIZE): { at: number; done: boolean; cards: BrowseCard[]; more: boolean } | null {
    const genre = browseGenre(genreId);
    if (!genre || !this.lenses.hasKey()) return null;
    const { svc, providers } = this.browseServices(services);
    const size = Math.min(Math.max(want, BROWSE_ROW_SIZE), BROWSE_FULL_SIZE);
    const key = genre.id + "|" + offer + "|" + row + "|" + size + "|" + providers.join(",");
    const have = this.browseFullCache.get(key);
    if (have && (!have.done || Date.now() - have.at <= Orchestrator.BROWSE_TTL_MS)) return have;
    const entry = { at: Date.now(), done: false, cards: have?.cards ?? [], more: false };
    this.browseFullCache.set(key, entry);
    const cardOf = (r: DiscoverRowId, t: BrowseTitle, titleOffers: CatalogTitle["offers"]): BrowseCard | null => this.catalogCard(t, titleOffers, svc, offer, browseValue(r, t));
    void this.browseFillRow(genre, row, svc, providers, offer, cardOf, size, BROWSE_FULL_PAGES).then(
      (got) => { entry.cards = got.cards; entry.more = got.more; entry.done = true; entry.at = got.answered > 0 ? Date.now() : Date.now() - Orchestrator.BROWSE_TTL_MS + Orchestrator.BROWSE_RETRY_MS; },
      () => { entry.done = true; entry.at = Date.now() - Orchestrator.BROWSE_TTL_MS + Orchestrator.BROWSE_RETRY_MS; });
    return entry;
  }
  private readonly browseFullCache = new Map<string, { at: number; done: boolean; cards: BrowseCard[]; more: boolean }>();
  /** A card Browse listed on that service (the press guard: only a title the rows named goes to the service's own search). */
  videoBrowseCard(cardId: string, app: string): BrowseCard | null {
    const hit = (list: readonly BrowseCard[]) => list.find((x) => x.id === cardId && x.services.some((s) => s.app === app));
    for (const entry of this.browseCache.values()) for (const row of Object.values(entry.rows)) { const c = hit(row); if (c) return c; }
    for (const entry of this.browseFullCache.values()) { const c = hit(entry.cards); if (c) return c; }
    for (const entry of this.mostReadCache.values()) { const c = hit(entry.cards); if (c) return c; }
    return null;
  }
  /** A Binge title's name by its card id, from any read kept (the hidden list names its titles). */
  videoBingeTitle(cardId: string): string | null {
    for (const entry of this.bingeCache.values()) { const c = entry.cands.find((x) => x.card.id === cardId); if (c) return c.card.title; }
    return null;
  }
  /** A card The Binge listed on that service (its play guard, as videoBrowseCard is Browse's). */
  videoBingeCard(cardId: string, app: string): BrowseCard | null {
    for (const entry of this.bingeCache.values()) { const c = entry.cands.find((x) => x.card.id === cardId && x.card.services.some((s) => s.app === app)); if (c) return c.card; }
    return null;
  }
  /** How many titles each genre has on the household's services (TMDB's total_results, films and series) - read once a day in the
   *  background; a genre with none is a chip that cannot act. Null until read. */
  videoBrowseCounts(services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; status: string }>, offer: BrowseOffer = "included"): Record<string, number | null> {
    if (!this.lenses.hasKey()) return {};
    const { providers } = this.browseServices(services);
    const pk = offer + "|" + providers.join(",");
    const stale = BROWSE_GENRES.some((g) => { const c = this.browseCounts.get(g.id + "|" + pk); return !c || Date.now() - c.at > Orchestrator.BROWSE_TTL_MS; });
    if (stale && !this.browseCountsBusy.has(pk) && providers.length) {
      this.browseCountsBusy.add(pk);
      const today = new Date().toISOString().slice(0, 10);
      void (async () => {
        for (const g of BROWSE_GENRES) {
          let n = 0; let read = false;
          for (const kind of ["movie", "tv"] as const) {
            const q = discoverQuery(kind, g, "voted", providers, today, offer);
            if (!q) continue;
            const j = await this.lenses.tmdbGet(`/discover/${kind}`, q);
            if (j && typeof j.total_results === "number") { n += j.total_results; read = true; }
          }
          this.browseCounts.set(g.id + "|" + pk, { at: read ? Date.now() : Date.now() - Orchestrator.BROWSE_TTL_MS + Orchestrator.BROWSE_RETRY_MS, n: read ? n : null });
        }
      })().finally(() => { this.browseCountsBusy.delete(pk); });
    }
    return Object.fromEntries(BROWSE_GENRES.map((g) => [g.id, this.browseCounts.get(g.id + "|" + pk)?.n ?? null]));
  }
  /** The Yours row: the household's titles TMDB files under the genre (a TMDB-only ask, no open source), A to Z; how many are unread. */
  videoBrowseYours(cards: ReadonlyArray<{ app: string; service: string; facet: string; item: VideoItem }>, genreId: string): { cards: Array<Record<string, unknown>>; unread: number } {
    const genre = browseGenre(genreId);
    if (!genre) return { cards: [], unread: 0 };
    if (this.lenses.hasKey()) this.lenses.ensure(cards.slice(0, 2500).map((c) => ({ title: c.item.title, kind: c.item.kind, providers: providersOf(this.adapters.get(this.adapterKeyForApp(c.app) ?? c.app)) })), ["tmdb"], false);
    const facts = this.lenses.factsOf();
    let unread = 0;
    const out: Array<{ card: Record<string, unknown>; key: string }> = [];
    for (const c of cards) {
      const f = factsFor(facts, c.item.title, c.item.kind);
      if (!f?.at.tmdb) unread++;
      if (inGenre(f?.genres, genre)) out.push({ card: { ...c, rating: ratingLabel(f?.rating) }, key: titleKey(c.item.title) });
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return { cards: out.map((x) => x.card), unread };
  }

  private servicesLookup(state: LookupState, services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; profile: string; home: string; status: string }>, q: string): void {
    const at = Date.now();
    const work: Array<Promise<void>> = [];
    for (const s of services) {
      const spec = this.adapters.get(s.adapter);
      const row: LookupServiceState = { app: s.app, name: s.name, facet: s.facet, status: "searching", candidates: [], at };
      state.services.push(row);
      if (s.status !== "signed-in") { row.status = "unavailable"; row.reason = s.status === "needs-attention" ? "sign in first" : "not set up"; continue; }
      if (!spec?.videoLookup) { row.status = "unavailable"; row.reason = spec?.videoLookupNote || "no search reader for this service yet"; continue; }
      const url = this.videoSearchUrlFor(s.adapter, q) ?? s.home;
      work.push(this.lookupOne(state, row, s.app, s.profile, s.adapter, url, q));
    }
    void Promise.allSettled(work).then(() => { if (this.lookupNow === state) state.done = true; });
    if (work.length === 0) state.done = true;
    this.touchLookups();
  }

  /**
   * A catalog card pressed (2026-09-21): the one service's own search asked for the title in the background, and the
   * exact match the service itself answers with is what plays (the same guard as any result). When the service does not
   * name it, null - the runtime then opens the service's own search on the screen, so the person sees what it has.
   */
  async videoCatalogResolve(app: string, title: string, services: ReadonlyArray<{ app: string; name: string; facet: string; adapter: string; profile: string; home: string; status: string }>): Promise<{ id: string; title: string; kind: string; url?: string | undefined; play?: boolean | undefined } | null> {
    const state = this.videoLookupStart(title, services, app);
    const row = state.services.find((s) => s.app === app);
    if (!row) return null;
    const t0 = Date.now();
    while (!state.done && Date.now() - t0 < Orchestrator.LOOKUP_UP_TIMEOUT_MS + Orchestrator.LOOKUP_ANSWER_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 250));
      if (this.lookupNow !== state) return null;
    }
    const want = normalizeTrackText(title);
    const hit = row.candidates.find((c) => normalizeTrackText(c.title) === want) ?? row.candidates.find((c) => normalizeTrackText(c.series ?? "") === want);
    return hit ? { id: hit.id, title: hit.title, kind: hit.kind, url: hit.url, play: hit.play } : null;
  }
  isCatalogCandidate(id: string): boolean { return isCatalogId(id); }
  /**
   * Does this service carry the title? (2026-09-25, Hulu's shows in the Disney+ app - "Without just watch, how would you know"; "only when a
   * title details is opened, updates in the background"): the service's own search on its hidden WORK page - never the lookup page, so a
   * person's Search everywhere results are untouched - and its answer matched by the title's name. True / false, or null when it did not answer.
   */
  async serviceCarries(s: { app: string; adapter: string; profile: string; home: string }, title: string): Promise<boolean | null> {
    const spec = this.adapters.get(s.adapter);
    if (!spec?.videoLookup) return null;
    const lk = await this.askHiddenPage(s, this.videoSearchUrlFor(s.adapter, title) ?? s.home, spec.videoLookup, "also", (token) => `window.__prismVideoLookup && window.__prismVideoLookup(${JSON.stringify(token)}, ${JSON.stringify(title)})`, Orchestrator.LOOKUP_ANSWER_TIMEOUT_MS);
    if (!lk.r) return null;
    const want = normalizeTrackText(title);
    const hit = cleanCandidates(lk.r.candidates, 40).find((c) => normalizeTrackText(c.title) === want || normalizeTrackText(c.series ?? "") === want);
    if (!hit) return false;
    // found by search - but a search lists what the account cannot play too (a Hulu title without the bundle): the title's own page decides,
    // by the Play it offers (2026-09-25; Disney+'s videoCanPlay)
    if (!spec.videoCanPlay || !hit.url) return true;
    const cp = await this.askHiddenPage(s, hit.url, spec.videoCanPlay, "canplay", (token) => `window.__prismVideoCanPlay && window.__prismVideoCanPlay(${JSON.stringify(token)})`, Orchestrator.LOOKUP_ANSWER_TIMEOUT_MS);
    if (!cp.r) return null;
    const first = Array.isArray(cp.r.candidates) ? (cp.r.candidates[0] as { play?: unknown } | undefined) : undefined;
    return first?.play === true;
  }

  private async lookupOne(state: LookupState, row: LookupServiceState, app: string, profile: string, adapter: string, url: string, q: string): Promise<void> {
    const id = `app:${app}:lookup`;
    const fail = (status: LookupServiceState["status"], reason: string) => { if (this.lookupNow === state) { row.status = status; row.reason = reason; row.at = Date.now(); } };
    try {
      let entry = this.lookups.get(id);
      if (!entry || !this.surfaces.has(id)) {
        entry = { app, adapter, up: false, upWaits: [], lastUsed: Date.now() };
        this.lookups.set(id, entry);
        await this.drivers.surface.create({ id, profile, background: this.doc?.theme?.background ?? DEFAULT_BACKGROUND, kind: "hidden", blocking: true });
        this.surfaces.add(id);
        await this.drivers.surface.setRect(id, { x: 0, y: 0, w: this.viewport.w || 1920, h: this.viewport.h || 1080 });
        await this.drivers.surface.setMuted(id, true);   // a search page that autoplays a trailer is heard by nobody
      }
      entry.up = false; entry.lastUsed = Date.now(); entry.onList = false; entry.routeOnUp = false;
      await this.drivers.surface.navigate(id, url);
      const up = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), Orchestrator.LOOKUP_UP_TIMEOUT_MS);
        entry!.upWaits.push(() => { clearTimeout(timer); resolve(true); });
      });
      if (this.lookupNow !== state) return;   // a newer search took over
      if (!up) { fail("error", "the page did not load"); return; }
      const token = state.token + ":" + app;
      const r = await this.askLookup(id, token, `window.__prismVideoLookup && window.__prismVideoLookup(${JSON.stringify(token)}, ${JSON.stringify(q)})`);
      if (this.lookupNow !== state) return;
      if (!r) { fail("error", "the page did not answer"); return; }
      if (!r.ok) { fail(r.error === "needs-profile" ? "needs-profile" : "error", r.error === "needs-profile" ? "choose a profile on the screen first" : r.error || "the service's search failed"); return; }
      const candidates = cleanCandidates(r.candidates);
      row.candidates = candidates; row.status = candidates.length ? "ok" : "empty"; row.at = Date.now(); delete row.reason;
    } catch (e) {
      fail("error", e instanceof Error ? e.message : String(e));
    }
  }

  // ---- remove from the service's own Continue Watching (2026-09-22): the adapter's script on a hidden surface in the App's profile
  private readonly removeJobs = new Map<string, { status: "working" | "done" | "failed"; error?: string; at: number; reported?: boolean }>();
  /** What the wall can offer for an App's Continue Watching cards: whether the service has a remove script, and what to warn. */
  /** Hide a title from the wall's Continue Watching (a service whose site cannot remove it). */
  videoHideContinue(adapterKey: string, id: string): void { this.video.hideContinue(adapterKey, id); }
  videoRemoveInfo(adapterKey: string): { can: boolean; warning: string | null } {
    const spec = this.adapters.get(adapterKey);
    return { can: !!spec?.videoRemoveContinue, warning: spec?.videoRemoveContinueWarning ?? null };
  }
  /** Start (or report) the removal of one title from one service's Continue Watching. A job is kept a minute after it ends, for the host's poll. */
  videoRemoveContinue(s: { app: string; adapter: string; profile: string; home: string; status: string }, id: string, title: string): { status: "working" | "done" | "failed"; error?: string } {
    const key = s.app + "|" + id;
    const have = this.removeJobs.get(key);
    // a job in hand answers its polls; a finished one answers once more (the poll that reads its outcome) - after that a new ask is a new
    // job (1923's retry had been answered by the failure of a minute before, instantly, without trying, 2026-09-22)
    if (have && (have.status === "working" || (!have.reported && Date.now() - have.at < 60_000))) { if (have.status !== "working") have.reported = true; return have; }
    const spec = this.adapters.get(s.adapter);
    if (!spec?.videoRemoveContinue) return { status: "failed", error: "this service's adapter cannot remove titles yet" };
    if (s.status !== "signed-in") return { status: "failed", error: "sign in to the service first" };
    const job: { status: "working" | "done" | "failed"; error?: string; at: number; reported?: boolean } = { status: "working", at: Date.now() };
    this.removeJobs.set(key, job);
    this.touchLookups();
    void (async () => {
      // the address from the card when the adapter's templates name it (Apple TV: the show's page from an Up Next episode's ?showId=)
      const card = (this.video.libraryOf(s.adapter).library.continue ?? []).find((x) => x.id === id) ?? null;
      const templates = Array.isArray(spec.videoRemoveContinueUrl) ? spec.videoRemoveContinueUrl : [spec.videoRemoveContinueUrl ?? s.home];
      let a: { r: MusicResultEvent | null; error?: string } = { r: null, error: "the service's page for it could not be named" };
      for (const t of templates) {
        const addr = fillItemAddress(t, id, card?.url ?? null);
        if (!addr) continue;
        a = await this.askHiddenPage(s, addr, spec.videoRemoveContinue!, "rm",
          (token) => `window.__prismVideoRemoveContinue && window.__prismVideoRemoveContinue(${JSON.stringify(token)}, ${JSON.stringify(id)}, ${JSON.stringify(title)})`, Orchestrator.REMOVE_ANSWER_TIMEOUT_MS);
        // a press the service took but its open page did not redraw (Disney+ kept Zootopia 2's card, 2026-09-23): once more on a fresh load - the
        // script answers 'already-gone' when the title has left the row, and presses again when it has not
        if (a.r && !a.r.ok && a.r.error === "unconfirmed") {
          a = await this.askHiddenPage(s, addr, spec.videoRemoveContinue!, "rm",
            (token) => `window.__prismVideoRemoveContinue && window.__prismVideoRemoveContinue(${JSON.stringify(token)}, ${JSON.stringify(id)}, ${JSON.stringify(title)})`, Orchestrator.REMOVE_ANSWER_TIMEOUT_MS);
          if (a.r && !a.r.ok && a.r.error === "unconfirmed") a = { r: { ...a.r, error: "the service did not show it gone" } };
        }
        if (!(a.r && !a.r.ok && a.r.error === "not-found")) break;
      }
      if (!a.r) { Object.assign(job, { status: "failed", error: a.error, at: Date.now() }); return; }
      const r = a.r;
      if (!r.ok) { Object.assign(job, { status: "failed", error: r.error === "needs-profile" ? "the service is asking who's watching, so choose a profile for it first" : r.error || "the service did not remove it", at: Date.now() }); return; }
      this.video.dropFromContinue(s.adapter, id);
      Object.assign(job, { status: "done", at: Date.now() });
    })();
    return job;
  }
  static readonly REMOVE_ANSWER_TIMEOUT_MS = 40_000;

  // ---- My List on the service itself (2026-09-23, "lets do My List exactly the same way for adding/removing items including queuing and
  // multi-hidden sessions"): the adapter's videoListSet on the App's hidden work page - the same chain, the same idle rule, the same job
  // shape and polling as a Continue Watching removal. The row shows the outcome at once: a title being taken off is out of My List while
  // the job works (back on a failure), a title being added is in it (gone again on a failure).
  private readonly listJobs = new Map<string, { status: "working" | "done" | "failed"; error?: string; at: number; reported?: boolean; want: boolean; appId: string; item: VideoItem }>();
  /** The runtime's hidden-service record for an adapter (set by the runtime): what a retried removal runs on. */
  hiddenServiceOf: ((adapterKey: string) => { app: string; adapter: string; profile: string; home: string; status: string } | undefined) | null = null;
  /** A removal the service did not keep, asked again (VideoController.onListReturned, 2026-09-23): the same job as the person's, logged. */
  private retryRemoval(adapterKey: string, item: VideoItem, attempt: number): void {
    const s = this.hiddenServiceOf?.(adapterKey);
    if (!s) { this.video.removalRetried(adapterKey, item.id); return; }
    this.noteRetry(`${item.title} is back in ${s.app}'s list after its removal - taking it off again (${attempt} of ${VideoController.REMOVED_RETRIES})`);
    this.listJobs.delete("rm|" + s.app + "|" + item.id);   // a finished ask answers once more: a retry is a new job
    const job = this.videoListSet(s, false, item);
    const t0 = Date.now();
    const poll = setInterval(() => {
      if (job.status === "working" && Date.now() - t0 < 120_000) return;
      clearInterval(poll);
      this.video.removalRetried(adapterKey, item.id);
      this.noteRetry(`${item.title} on ${s.app} - the retry ${job.status === "done" ? "was taken" : "failed: " + (job.error ?? "no answer")}`);
    }, 1000);
  }
  /** What the retries did, newest last (dev: listRetries) - a removal that needed asking twice is not the person's concern, but it is on record. */
  readonly listRetries: string[] = [];
  private noteRetry(line: string): void { this.listRetries.push(new Date().toISOString().slice(11, 19) + " " + line); if (this.listRetries.length > 40) this.listRetries.shift(); }
  /** Whether an App's service can add to / take off its own list from the wall. */
  videoListInfo(adapterKey: string): { can: boolean; name: string } { const spec = this.adapters.get(adapterKey); return { can: !!spec?.videoListSet, name: spec?.videoListName ?? "My List" }; }
  /**
   * Start (or report) one My List change on one service. `resolve`, when given, finds the service's own copy of a catalog title first (the
   * same resolve a catalog card's play uses); `item` is then the card as the wall knows it (its id is the job's key).
   */
  videoListSet(s: { app: string; adapter: string; profile: string; home: string; status: string }, want: boolean, item: VideoItem, resolve?: () => Promise<{ id: string; url?: string | undefined; title: string; kind: string } | null>): { status: "working" | "done" | "failed"; error?: string } {
    const key = (want ? "add|" : "rm|") + s.app + "|" + item.id;
    const have = this.listJobs.get(key);
    if (have && (have.status === "working" || (!have.reported && Date.now() - have.at < 60_000))) { if (have.status !== "working") have.reported = true; return have; }
    const spec = this.adapters.get(s.adapter);
    if (!spec?.videoListSet) return { status: "failed", error: "this service's adapter cannot change its list yet" };
    if (s.status !== "signed-in") return { status: "failed", error: "sign in to the service first" };
    const job: { status: "working" | "done" | "failed"; error?: string; at: number; reported?: boolean; want: boolean; appId: string; item: VideoItem } = { status: "working", at: Date.now(), want, appId: s.app, item };
    this.listJobs.delete((want ? "rm|" : "add|") + s.app + "|" + item.id);   // the opposite ask is superseded
    this.listJobs.set(key, job);
    this.touchLookups();
    void (async () => {
      let id = item.id, url = item.url ?? null;
      if (resolve) {
        const hit = await resolve().catch(() => null);
        if (!hit) { Object.assign(job, { status: "failed", error: "the service's own search did not find it", at: Date.now() }); return; }
        id = hit.id; url = hit.url ?? null;
      }
      const templates = Array.isArray(spec.videoListSetUrl) ? spec.videoListSetUrl : [spec.videoListSetUrl ?? "{url}"];
      let last: string | undefined = "the service's page gave no list control for it";
      for (const t of templates) {
        const addr = fillItemAddress(t, id, url);
        if (!addr) continue;
        const a = await this.askHiddenPage(s, addr, spec.videoListSet!, "ls",
          (token) => `window.__prismVideoListSet && window.__prismVideoListSet(${JSON.stringify(token)}, ${want}, ${JSON.stringify(id)}, ${JSON.stringify(item.title)})`, Orchestrator.REMOVE_ANSWER_TIMEOUT_MS);
        if (!a.r) { last = a.error; continue; }
        if (a.r.ok) {
          if (want) { this.video.addToList(s.adapter, { ...item, id, ...(url ? { url } : {}) }); this.video.noteAdded(s.adapter, item.id); }
          else { this.video.dropFromList(s.adapter, item.id); this.video.noteRemoved(s.adapter, item); }
          Object.assign(job, { status: "done", at: Date.now() });
          // the service's list read again a moment later (2026-09-24, "If you are given a command to add/remove a netflix list item, then go update
          // that list to prism ... that seems like a good time to update that list"): the row then matches the service, its own item ids included
          setTimeout(() => { if (this.refreshChain(s, { asked: true })) this.touchLookups(); }, Orchestrator.LIST_CHANGE_READ_MS);
          return;
        }
        last = a.r.error === "needs-profile" ? "the service is asking who's watching, so choose a profile for it first" : a.r.error || "the service did not change its list";
        if (a.r.error !== "not-found") break;
      }
      Object.assign(job, { status: "failed", error: last === "not-found" ? "the service's page gave no list control for it" : last, at: Date.now() });
    })();
    return job;
  }
  /** The My List row as the jobs in hand leave it: titles being taken off are out, titles being added are in (first). */
  private listRowWithJobs(list: LensedCard[], services: readonly { app: string; name: string; facet: string }[]): LensedCard[] {
    const off = new Set<string>(), on: LensedCard[] = [];
    for (const j of this.listJobs.values()) {
      if (j.status !== "working") continue;
      if (!j.want) { off.add(j.appId + "|" + j.item.id); continue; }
      const s = services.find((x) => x.app === j.appId);
      if (!s || list.some((c) => c.app === j.appId && titleKey(c.item.title) === titleKey(j.item.title))) continue;
      on.push({ app: s.app, service: s.name, facet: s.facet, item: j.item, recency: { kind: "inferred" }, lens: null } as LensedCard);
    }
    return [...on, ...list.filter((c) => !off.has(c.app + "|" + c.item.id))];
  }


  /** Hidden-surface work in hand (a removal, an episode list): the idle sweep keeps the pages while any is running. */
  private hiddenWork = 0;
  /**
   * A script on the service's own page, in the App's profile, never shown (2026-09-22): the App's hidden surface (made if missing) goes to
   * `url`, `script` is injected once the page is up, and `call(token)` is asked; the page's answer on that token is returned.
   */
  private async askHiddenPage(s: { app: string; adapter: string; profile: string }, url: string, script: string, tag: string, call: (token: string) => string, timeoutMs: number, partial?: (r: MusicResultEvent) => void): Promise<{ r: MusicResultEvent | null; error?: string }> {
    // background work has a hidden page of its own, apart from the one searches and a catalog pick's resolve use: a person's play is never
    // queued behind a removal, and never takes the page out from under one (2026-09-22, "kick off 2 removals but then play a title")
    const surfaceId = `app:${s.app}:work`;
    // never a title's own player in the background (adapter videoPlaysAt): it would play, and the service would count it as watched
    const plays = this.adapters.get(s.adapter)?.videoPlaysAt ?? [];
    let path = ""; try { path = new URL(url).pathname; } catch { path = url; }
    if (plays.some((p) => path.includes(p))) return { r: null, error: "Prism won't open that page in the background because it would start the title playing" };
    this.hiddenWork++;
    this.touchLookups();
    // one job at a time on a service's page: The Bear's job had taken the page Breeders' was still working on (2026-09-22)
    const before = this.hiddenChains.get(surfaceId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => { release = r; });
    this.hiddenChains.set(surfaceId, before.then(() => mine));
    await before;
    try {
      let entry = this.lookups.get(surfaceId);
      if (!entry || !this.surfaces.has(surfaceId)) {
        entry = { app: s.app, adapter: s.adapter, up: false, upWaits: [], lastUsed: Date.now() };
        this.lookups.set(surfaceId, entry);
        await this.drivers.surface.create({ id: surfaceId, profile: s.profile, background: this.doc?.theme?.background ?? DEFAULT_BACKGROUND, kind: "hidden", blocking: true });
        this.surfaces.add(surfaceId);
        await this.drivers.surface.setRect(surfaceId, { x: 0, y: 0, w: this.viewport.w || 1920, h: this.viewport.h || 1080 });
        await this.drivers.surface.setMuted(surfaceId, true);
      }
      entry.up = false; entry.lastUsed = Date.now(); entry.onList = false; entry.routeOnUp = false;
      await this.drivers.surface.navigate(surfaceId, url);
      const up = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), Orchestrator.LOOKUP_UP_TIMEOUT_MS);
        entry!.upWaits.push(() => { clearTimeout(timer); resolve(true); });
      });
      if (!up) return { r: null, error: "the service's page did not load" };
      await this.drivers.surface.inject(surfaceId, null, script);
      const token = tag + ":" + s.app + ":" + Date.now().toString(36);
      const r = await this.askLookup(surfaceId, token, call(token), timeoutMs, partial);
      return r ? { r } : { r: null, error: "the service's page did not answer" };
    } catch (e) { return { r: null, error: e instanceof Error ? e.message : String(e) }; }
    finally { release(); this.hiddenWork--; this.touchLookups(); }
  }
  private readonly hiddenChains = new Map<string, Promise<void>>();
  /** Dev (a person reading a service's pages to write its adapter): the App's work page opened at `url` and kept - the idle sweep waits - until released with a null url. */
  private readonly devHeld = new Set<string>();
  async devHoldPage(s: { app: string; adapter: string; profile: string }, url: string | null, height?: number): Promise<string> {
    const surfaceId = `app:${s.app}:work`;
    if (url === null) { if (this.devHeld.delete(surfaceId)) { this.hiddenWork--; this.touchLookups(); } return "released " + surfaceId; }
    if (!this.devHeld.has(surfaceId)) { this.devHeld.add(surfaceId); this.hiddenWork++; }
    let entry = this.lookups.get(surfaceId);
    if (!entry || !this.surfaces.has(surfaceId)) {
      entry = { app: s.app, adapter: s.adapter, up: false, upWaits: [], lastUsed: Date.now() };
      this.lookups.set(surfaceId, entry);
      await this.drivers.surface.create({ id: surfaceId, profile: s.profile, background: this.doc?.theme?.background ?? DEFAULT_BACKGROUND, kind: "hidden", blocking: true });
      this.surfaces.add(surfaceId);
      await this.drivers.surface.setRect(surfaceId, { x: 0, y: 0, w: this.viewport.w || 1920, h: this.viewport.h || 1080 });
      await this.drivers.surface.setMuted(surfaceId, true);
    }
    await this.drivers.surface.setRect(surfaceId, { x: 0, y: 0, w: this.viewport.w || 1920, h: height && height > 0 ? height : this.viewport.h || 1080 });
    await this.drivers.surface.navigate(surfaceId, url);
    return "holding " + surfaceId + " at " + url;
  }

  // ---- the Episodes menu (2026-09-22): every season and episode of the series on the screen
  private readonly episodeLists = new Map<string, EpisodesEntry>();
  /**
   * Which episode a Continue watching entry is (2026-09-24, "season and episode on Continue watching"): matched by the entry's id in the
   * service's own episode list (Hulu's watch id, Netflix's video id are episode ids there), kept on the device as "app|id" -> season,
   * episode, title - a restart keeps the cards' "S5 E7" without reading the lists again.
   */
  private cwEpisodes: Record<string, { s: number; e: number; t: string }> | null = null;
  static readonly CW_EPISODES_KEY = "video:cw-episodes";
  private cwEpisodesLoad(): Record<string, { s: number; e: number; t: string }> {
    if (this.cwEpisodes) return this.cwEpisodes;
    this.cwEpisodes = {};
    try {
      const raw = this.drivers.store?.get(Orchestrator.CW_EPISODES_KEY);
      if (typeof raw === "string" && raw) { const j = JSON.parse(raw); if (j && typeof j === "object") this.cwEpisodes = j; }
    } catch { /* a fresh map */ }
    return this.cwEpisodes!;
  }
  /** The episode a Continue watching entry is, from the kept map or a list already read (then kept); null when not known. */
  cwEpisodeOf(app: string, series: string, id: string): { season: number; episode: number; title: string; fromResume?: boolean } | null {
    if (!id) return null;
    const map = this.cwEpisodesLoad();
    const k = app + "|" + id;
    const kept = map[k];
    if (kept) return { season: kept.s, episode: kept.e, title: kept.t };
    this.loadEpisodeLists();
    const e = this.episodeLists.get(app + "|" + titleKey(series));
    if (!e || e.source !== "service") return null;
    for (const sn of e.seasons) for (const ep of sn.episodes) if (ep.id === id) {
      map[k] = { s: sn.season, e: ep.episode, t: ep.title };
      try { void this.drivers.store?.set(Orchestrator.CW_EPISODES_KEY, JSON.stringify(map)); } catch { /* best effort */ }
      return { season: sn.season, episode: ep.episode, title: ep.title };
    }
    // the entry names the show, not an episode (Netflix's Continue Watching gives the show's id, 2026-09-25): the episode the show page
    // marks as the one the account is on - never kept in the map, since it moves on as they watch; the list is read again daily
    for (const sn of e.seasons) for (const ep of sn.episodes) if (ep.resume) return { season: sn.season, episode: ep.episode, title: ep.title, fromResume: true };
    return null;
  }
  /** A service's list for a series is being read now, or was read (or tried) within `withinMs`. */
  episodeListRecent(app: string, series: string, withinMs: number): boolean {
    const e = this.episodeLists.get(app + "|" + titleKey(series));
    return !!e && (e.status === "working" || Date.now() - e.at < withinMs);
  }
  /** Any episode list being read now (the background read-ahead waits for it). */
  episodeListWorking(): boolean { for (const e of this.episodeLists.values()) if (e.status === "working") return true; return false; }
  static readonly EPISODES_TTL_MS = 30 * 60_000;
  // the episode lists kept on the device (2026-09-24): a restart had forgotten every list, so a Details page or the Episodes menu read the
  // series again (Only Murders in the Building: some 40 s). The 30 lists last used are kept, their episode descriptions shortened; a kept
  // list shows at once and, when older than EPISODES_TTL_MS, is read again underneath as before
  static readonly EPISODE_LISTS_KEY = "video:episode-lists";
  static readonly EPISODE_LISTS_KEPT = 30;
  private episodeListsLoaded = false;
  private episodeListsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private loadEpisodeLists(): void {
    if (this.episodeListsLoaded) return;
    this.episodeListsLoaded = true;
    try {
      const raw = this.drivers.store?.get(Orchestrator.EPISODE_LISTS_KEY);
      if (typeof raw !== "string" || !raw) return;
      const j = JSON.parse(raw) as Record<string, { at?: unknown; source?: unknown; seasons?: unknown }>;
      for (const [k, v] of Object.entries(j ?? {})) {
        if (this.episodeLists.has(k) || !v || typeof v.at !== "number" || !Array.isArray(v.seasons) || (v.source !== "service" && v.source !== "tmdb")) continue;
        this.episodeLists.set(k, { at: v.at, status: "done", source: v.source, seasons: v.seasons as EpisodesSeason[], ...(typeof (v as { series?: unknown }).series === "string" ? { series: (v as { series: string }).series } : {}) });
      }
    } catch { /* a fresh start */ }
  }
  private saveEpisodeListsSoon(): void {
    if (this.episodeListsSaveTimer || !this.drivers.store) return;
    this.episodeListsSaveTimer = setTimeout(() => {
      this.episodeListsSaveTimer = null;
      try {
        const keep = [...this.episodeLists.entries()].filter(([, e]) => e.status === "done" && e.seasons.length > 0).sort((a, b) => b[1].at - a[1].at).slice(0, Orchestrator.EPISODE_LISTS_KEPT);
        const out: Record<string, { at: number; source: string; series?: string; seasons: EpisodesSeason[] }> = {};
        for (const [k, e] of keep) out[k] = { at: e.at, source: e.source, ...(e.series ? { series: e.series } : {}), seasons: e.seasons.map((sn) => ({ ...sn, episodes: sn.episodes.map((ep) => ({ ...ep, synopsis: ep.synopsis ? ep.synopsis.slice(0, 240) : null })) })) };
        void this.drivers.store?.set(Orchestrator.EPISODE_LISTS_KEY, JSON.stringify(out));
      } catch { /* best effort */ }
    }, 5000);
  }
  /**
   * The series playing on this tile, all its seasons and episodes, and which one plays now: from the service's own show page when its
   * adapter can list them (the ids it gives are what a pick plays), else TMDB's list under the household's key, which cannot be played
   * from here. Read in the background; kept half an hour per series.
   */
  videoEpisodes(tileId: string, s: { app: string; name: string; adapter: string; profile: string; home: string; status: string } | null): EpisodesView {
    const t = this.videoState().find((x) => x.id === tileId);
    const v = t?.video ?? null;
    const series = v?.series ?? null;
    if (!v || !series || !s) return { ready: true, series, service: s?.name ?? null, current: null, seasons: [], canPlay: false, source: null, error: "nothing on the screen is an episode of a series" };
    return this.episodesOf(s, series, v);
  }
  /**
   * Any series' episodes on a service (2026-09-24, "We need access to the episode selection from the details page as well"): the same list and
   * read as the screen's Episodes menu - `v` is what is known of the series there (a Continue watching entry's id, its season and episode).
   */
  episodesOf(s: { app: string; name: string; adapter: string; profile: string; home: string; status: string }, series: string, v: VideoContext): EpisodesView {
    this.loadEpisodeLists();
    const spec = this.adapters.get(s.adapter);
    const key = s.app + "|" + titleKey(series);
    let e = this.episodeLists.get(key);
    const stale = !e || (e.status !== "working" && Date.now() - e.at > (e.status === "failed" ? 60_000 : Orchestrator.EPISODES_TTL_MS));
    if (stale) {
      // a stale list stays up (and playable, when it is the service's own) while the new one is read, whole
      const keep = e?.status === "done" && e.seasons.length ? e : null;
      const entry: EpisodesEntry = { at: Date.now(), status: "working", source: keep?.source ?? (spec?.videoEpisodes ? "service" : "tmdb"), seasons: keep?.seasons ?? [], partial: keep?.source === "service", series };
      this.episodeLists.set(key, entry);
      e = entry;
      void this.readEpisodes(entry, s, spec, series, v);
    }
    const cur = currentEpisode(e!.seasons, v);
    const byId = e!.source === "service" && (e!.status === "done" || (e!.status === "working" && !!e!.partial));
    const byNumber = !byId && e!.source === "tmdb" && e!.status === "done" && !!spec?.videoEpisodeNumber;   // Peacock: its own rail, by number
    return { ready: e!.status !== "working", series, service: s.name, current: cur, seasons: e!.seasons, canPlay: byId || byNumber, playBy: byId ? "id" : byNumber ? "number" : null, source: e!.source, error: e!.status === "failed" ? e!.error ?? null : null };
  }
  private async readEpisodes(entry: EpisodesEntry, s: { app: string; adapter: string; profile: string; home: string }, spec: AdapterSpec | undefined, series: string, v: VideoContext): Promise<void> {
    try {
      const via = spec?.videoEpisodesVia ?? "id";
      let url: string | null = null;
      if (spec?.videoEpisodes && via === "id" && v.id) url = (spec.videoEpisodesUrl ?? s.home).replace("{id}", encodeURIComponent(v.id));
      if (spec?.videoEpisodes && via === "lookup" && spec.videoLookup && spec.videoEpisodesUrl) {
        // the series' own page through the service's own search: its result named as the series, a series (never a movie of the name)
        const q = series;
        const lk = await this.askHiddenPage(s, this.videoSearchUrlFor(s.adapter, q) ?? s.home, spec.videoLookup, "eplk", (token) => `window.__prismVideoLookup && window.__prismVideoLookup(${JSON.stringify(token)}, ${JSON.stringify(q)})`, Orchestrator.LOOKUP_ANSWER_TIMEOUT_MS);
        const want = seriesKey(series);
        const cands = cleanCandidates(lk.r?.candidates, 40).filter((c) => c.kind === "series" || (c.kind === "title" && c.play === false));   // Disney+'s search calls a series a "title" (a details page, not a play)
        // a leading "The" on either side is the same series (2026-09-25, the health check: "Madison" never matched Paramount+'s "The Madison")
        const bare = (k: string) => k.replace(/^the /, "");
        const hit = cands.find((c) => seriesKey(c.title) === want) ?? cands.find((c) => bare(seriesKey(c.title)) === bare(want)) ?? cands.find((c) => seriesKey(c.title).startsWith(want + " "));
        if (hit) url = spec.videoEpisodesUrl === "{url}" ? hit.url ?? null : spec.videoEpisodesUrl.replace("{id}", encodeURIComponent(hit.id));   // "{url}": the result's own address (Paramount+: /shows/<slug>/)
        else entry.error = lk.r ? "the service's own search did not find the series" : lk.error ?? null;
      }
      if (spec?.videoEpisodes && url) {
        // each season as the page finishes it (2026-09-23, "load each season starting with #1 onto the screen as they become available"):
        // the menu draws what is read, and what is read can be played - its ids are the service's own
        const fresh = entry.seasons.length === 0;
        let parts = false;
        const part = (r: MusicResultEvent) => { const got = seasonsFrom(r.candidates as unknown); if (fresh && entry.status === "working" && got.length) { entry.seasons = got; entry.source = "service"; entry.partial = true; parts = true; } };
        const a = await this.askHiddenPage(s, url, spec.videoEpisodes, "ep", (token) => `window.__prismVideoEpisodes && window.__prismVideoEpisodes(${JSON.stringify(token)})`, Orchestrator.EPISODES_ANSWER_TIMEOUT_MS, part);
        entry.partial = false;
        // the page stopped part way (a timeout, an error after some seasons): the seasons it did read are the service's own and stay
        if (!a.r?.ok && parts && entry.seasons.length) { entry.status = "done"; entry.at = Date.now(); await this.checkEpisodes(entry, s, spec, series, url); return; }
        if (a.r?.ok) {
          entry.seasons = seasonsFrom(a.r.candidates as unknown); entry.status = entry.seasons.length ? "done" : "failed"; if (!entry.seasons.length) entry.error = "the service listed no episodes"; entry.at = Date.now();
          if (entry.seasons.length) await this.checkEpisodes(entry, s, spec, series, url);
          return;
        }
        entry.error = a.r ? (a.r.error === "needs-profile" ? "the service is asking who's watching, so choose a profile for it first" : a.r.error || "the service did not list its episodes") : a.error ?? null;
      }
      // TMDB's list: the episodes as TMDB knows them, with no service ids - shown, not playable
      const tm = await this.lenses.tvSeasons(series, providersOf(spec));
      if (tm && tm.length) {
        entry.seasons = tm.map((x) => ({ season: x.season, label: x.label, episodes: x.episodes.map((ep) => ({ season: x.season, episode: ep.episode, title: ep.title, id: null, url: null, synopsis: ep.synopsis, still: ep.still, duration: ep.runtime ? ep.runtime + "m" : null, airDate: ep.airDate })) }));
        entry.source = "tmdb"; entry.status = "done";
        if (spec?.videoEpisodes) entry.error = entry.error ?? null; else entry.error = null;
      } else { entry.status = "failed"; entry.error = entry.error ?? (this.lenses.hasKey() ? "TMDB does not know this series" : "this service's adapter cannot list episodes yet, and there is no TMDB key"); }
    } catch (err) { entry.status = "failed"; entry.error = err instanceof Error ? err.message : String(err); }
    finally { entry.at = Date.now(); if (entry.status === "done") this.saveEpisodeListsSoon(); }
  }
  static readonly EPISODES_ANSWER_TIMEOUT_MS = 240_000;
  /**
   * A service's list measured against TMDB's (2026-09-25, "Check the health of all episode lists and remember if we have TMDB connected, we
   * have another resource to improve the process"): with a key, a list that came back short of the episodes TMDB says have aired - a season
   * short, or one missing between the service's own - is read once more and the fuller read kept; what is still missing is filled from TMDB
   * (shown, no service id), and the service's episodes take TMDB's picture, description and air date where they had none. The measure is kept
   * with the list (videoEpisodeHealth).
   */
  private async checkEpisodes(entry: EpisodesEntry, s: { app: string; adapter: string; profile: string; home: string }, spec: AdapterSpec | undefined, series: string, url: string): Promise<void> {
    if (!this.lenses.hasKey()) return;
    try {
      const tm = await this.lenses.tvSeasons(series, providersOf(spec));
      if (!tm || !tm.length) return;
      const today = new Date().toISOString().slice(0, 10);
      let h = episodeHealth(entry.seasons, tm, today);
      if (!h.ok && spec?.videoEpisodes) {
        const again = await this.askHiddenPage(s, url, spec.videoEpisodes, "ep", (token) => `window.__prismVideoEpisodes && window.__prismVideoEpisodes(${JSON.stringify(token)})`, Orchestrator.EPISODES_ANSWER_TIMEOUT_MS);
        const got = again.r?.ok ? seasonsFrom(again.r.candidates as unknown) : [];
        if (episodeCount(got) > episodeCount(entry.seasons)) { entry.seasons = got; h = episodeHealth(got, tm, today); }
      }
      entry.health = h;
      entry.seasons = fillFromTmdb(entry.seasons, tm, today);
    } catch { /* the service's list stands as read */ }
  }
  /** Dev: a kept list forgotten, so the next ask reads the service again (a list saved from a read that went wrong). */
  forgetEpisodeList(app: string, series: string): boolean { this.loadEpisodeLists(); const ok = this.episodeLists.delete(app + "|" + titleKey(series)); if (ok) this.saveEpisodeListsSoon(); return ok; }
  /** Every kept list measured against TMDB now (dev and the health view): the service's episodes, TMDB's aired, and what is short or missing. */
  async episodeHealthReport(): Promise<Array<{ key: string; source: string; health: EpisodeHealth | null; filled: number; error?: string }>> {
    this.loadEpisodeLists();
    const out: Array<{ key: string; source: string; health: EpisodeHealth | null; filled: number; error?: string }> = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const [key, e] of this.episodeLists) {
      if (e.status !== "done") continue;
      const filled = e.seasons.reduce((n, sn) => n + sn.episodes.filter((x) => x.fromTmdb).length, 0);
      if (e.source !== "service") { out.push({ key, source: e.source, health: null, filled }); continue; }
      const app = key.split("|")[0]!;
      const name = e.series ?? key.slice(app.length + 1);
      try {
        const tm = this.lenses.hasKey() ? await this.lenses.tvSeasons(name, providersOf(this.adapters.get(app))) : null;
        const own = e.seasons.map((sn) => ({ ...sn, episodes: sn.episodes.filter((x) => !x.fromTmdb) }));
        out.push({ key, source: e.source, health: tm && tm.length ? episodeHealth(own, tm, today) : null, filled, ...(tm && tm.length ? {} : { error: "TMDB did not find it" }) });
      } catch (err) { out.push({ key, source: e.source, health: null, filled, error: String(err) }); }
    }
    return out;
  }
  /**
   * The list read before anyone asks (2026-09-23, "it takes quite a while 'Reading every season from Hulu...' when it could've been handling
   * this in the background"): a series up on a tile for a few seconds is announced to the runtime, which reads its list for the Video
   * player's screen on the service's hidden work page - the menu opens on it finished, or on the seasons read so far.
   */
  onSeriesUp: ((tileId: string) => void) | null = null;
  static readonly EPISODES_PREFETCH_MS = 8_000;
  private readonly seriesSeen = new Map<string, { key: string; timer: ReturnType<typeof setTimeout> | null }>();
  private noteSeriesUp(tileId: string): void {
    if (!this.onSeriesUp) return;
    const tile = this.tile(tileId);
    if (!tile?.adapter || !isVideoAdapter(this.adapters.get(tile.adapter))) return;
    const ctx = this.video.state([tileId])[0]?.video ?? null;
    const key = ctx && !ctx.ad && ctx.series ? titleKey(ctx.series) : "";
    const was = this.seriesSeen.get(tileId);
    if (was?.key === key) return;
    if (was?.timer) clearTimeout(was.timer);
    if (!key) { this.seriesSeen.delete(tileId); return; }
    const timer = setTimeout(() => {
      const now = this.seriesSeen.get(tileId);
      if (now?.key !== key) return;
      now.timer = null;
      try { this.onSeriesUp?.(tileId); } catch { /* the menu reads it when opened */ }
    }, Orchestrator.EPISODES_PREFETCH_MS);
    this.seriesSeen.set(tileId, { key, timer });
  }   // a long series is read season by season (Grey's Anatomy: 22 seasons, 466 episodes, 17 s)
  /**
   * The picture of what plays on a tile, from the service's own pages (2026-09-23, the wall shot: a protected frame is black to any
   * capture - by design - and the shot shows the title's own art there instead): the playing episode's still from its Episodes list,
   * else the title's card in the service's own rows (Continue Watching, My List, owned, its shelves).
   */
  videoArtOf(tileId: string): { title: string | null; art: string | null } {
    const t = this.videoState().find((x) => x.id === tileId);
    const v = t?.video ?? null;
    if (!t || !v) return { title: null, art: null };
    const name = v.series || v.title || null;
    if (v.series) {
      const suffix = "|" + titleKey(v.series);
      for (const [key, e] of this.episodeLists) {
        if (!key.endsWith(suffix)) continue;
        const cur = currentEpisode(e.seasons, v);
        const ep = cur ? e.seasons.find((sn) => sn.season === cur.season)?.episodes.find((x) => x.episode === cur.episode) : undefined;
        if (ep?.still) return { title: name, art: ep.still };
      }
    }
    const lib = t.library;
    const pool = [...(lib.continue ?? []), ...(lib.list ?? []), ...(lib.owned ?? []), ...(lib.shelves ?? []).flatMap((sh) => sh.items)];
    const want = [v.series, v.title].filter((x): x is string => !!x).map(titleKey);
    const hit = pool.find((i) => !!i.artwork && want.includes(titleKey(i.title)));
    return { title: name, art: hit?.artwork ?? null };
  }
  /** An episode the service itself listed for the series on this tile (the play guard: only its own ids are ever played). */
  /** An episode of a series' kept list by season and number (the Details page's pick). */
  episodeByNumber(appId: string, series: string, season: number, episode: number): EpisodeItem | null {
    this.loadEpisodeLists();
    const e = this.episodeLists.get(appId + "|" + titleKey(series));
    return e?.seasons.find((x) => x.season === season)?.episodes.find((x) => x.episode === episode) ?? null;
  }
  videoEpisodeById(tileId: string, appId: string, id: string): EpisodeItem | null {
    const t = this.videoState().find((x) => x.id === tileId);
    const series = t?.video?.series;
    if (!series) return null;
    const e = this.episodeLists.get(appId + "|" + titleKey(series));
    if (!e || e.source !== "service") return null;
    for (const sn of e.seasons) for (const ep of sn.episodes) if (ep.id === id) return ep;
    return null;
  }

  private askLookup(surfaceId: string, token: string, js: string, timeoutMs = Orchestrator.LOOKUP_ANSWER_TIMEOUT_MS, partial?: (r: MusicResultEvent) => void): Promise<MusicResultEvent | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.musicResultWaits.delete(token); resolve(null); }, timeoutMs);
      this.musicResultWaits.set(token, { tileId: surfaceId, resolve: (r) => { clearTimeout(timer); this.musicResultWaits.delete(token); resolve(r); }, ...(partial ? { partial } : {}) });
      Promise.resolve().then(() => this.drivers.surface.inject(surfaceId, null, js)).catch(() => { clearTimeout(timer); this.musicResultWaits.delete(token); resolve(null); });
    });
  }

  private async onLookupEvent(event: SurfaceEvent): Promise<void> {
    const entry = this.lookups.get(event.id)!;
    if (event.type === "load-finished" && event.ok) {
      await this.drivers.surface.inject(event.id, null, FRAME_PRELUDE_JS);
      const spec = entry.adapter ? this.adapters.get(entry.adapter) : undefined;
      if (spec) await this.drivers.surface.inject(event.id, spec.css ?? null, adapterScript(spec));
      if (entry.routeOnUp && spec?.videoListRoute) { entry.routeOnUp = false; await this.drivers.surface.inject(event.id, null, "window.__prismVideoListRoute && window.__prismVideoListRoute()"); }
      entry.up = true;
      const waits = entry.upWaits.splice(0);
      for (const w of waits) w();
      return;
    }
    // never revealed, never in audio focus, nothing else to orchestrate
  }

  /**
   * The observer's report from a hidden surface: the profile gate (the standing choice is applied there), and - while the
   * surface stands on the service's own list page - the list it shows (the combined My list, 2026-09-20). A search page's
   * rows are never kept.
   */
  videoObserveLookup(surfaceId: string, adapterKey: string, info: NowPlaying | null): void {
    const entry = this.lookups.get(surfaceId);
    if (!entry) return;
    this.lookupReportAt.set(entry.app, Date.now());   // the page answered (the polite client counts a chain with no answer at all)
    if (entry.onProfiles) { this.video.noteProfiles(adapterKey, info); this.video.pressWantedProfile(surfaceId, adapterKey, info); if (info?.videoProfiles) entry.profilesAt = Date.now(); }   // the household as the gate names it; pressed only for a switch the person asked for
    else if (!this.video.pressWantedProfile(surfaceId, adapterKey, info)) this.video.applyStandingProfile(surfaceId, adapterKey, info);
    // a switch still to be pressed: this page is the last person's - nothing of it is kept (2026-09-24, the chains move on at the first read)
    if (this.video.switchPending(adapterKey)) return;
    // pressed, and the page not yet loaded again since (2026-09-25, "Switching profile presets, I still see my stuff leave, come back, mix with
    // holly's, disappear again"): the list page's first report after the press still showed the last person's list, and it was kept as the new
    // person's - the settle wait was checked for the other pages, never for this one. Its list counts once the page has loaded since the press
    if (this.video.rowsFrozen(adapterKey)) return;
    if (entry.onList && (entry.listNavAt ?? 0) < this.video.pressedSince(adapterKey)) return;
    if ((info?.videoLibrary as { ownedComplete?: boolean } | null | undefined)?.ownedComplete) entry.ownedDone = Date.now();
    // an empty list is believed only once the page has had its time to render (a grid that follows a Keep Watching row)
    if (entry.onList && this.video.keepListFrom(adapterKey, info, Date.now() - (entry.listNavAt ?? 0) > Orchestrator.LIST_SETTLE_MS)) { entry.listRead = Date.now(); this.lastListRead.set(entry.app, entry.listRead); if (!this.firstListRead.has(entry.app)) this.firstListRead.set(entry.app, entry.listRead); }
    // a page reports once and then only on change (the shell's observer): an empty list seen before the page settled is
    // believed at the settle, unless a fuller report came in between
    if (entry.onList) {
      const lib = info?.videoLibrary && typeof info.videoLibrary === "object" ? cleanLibrary(info.videoLibrary) : null;
      entry.lastListEmpty = !!lib && lib.list.length === 0 && lib.continue.length > 0;
    }
  }

  // ---------------------------------------------------------------- the combined My list (2026-09-20)
  // "What about a combined my list. Or watch list. Or equivalent. All services let you manage one." Each service's own
  // list page (videoListUrl, or videoListRoute walked from a mounted home) is opened on the same hidden surfaces the
  // search uses; the adapter's library reader reports the list from there; the menu's My list row merges them (the §4
  // order). Read at boot and again when the menu opens after LISTS_STALE_MS; never while a search is running.
  private listsRefreshedAt = 0;
  static readonly LISTS_STALE_MS = 30 * 60_000;
  static readonly LIST_SETTLE_MS = 20_000;
  /** an owned page is a grid the reader walks to its end: the surface stays this long on each. */
  // a complete walk of Fandango's 1,917 titles takes ~93 s (2026-09-24; a tall page was tried and draws no more: Fandango's grid draws one
  // 75-title batch whatever the height, Movies Anywhere's infinite list stops loading when the page is taller than what it has drawn)
  static readonly OWNED_STAY_MS = 120_000;

  private ownedRefreshedAt = 0;
  static readonly OWNED_STALE_MS = 6 * 3_600_000;
  // ---- keeping itself current (2026-09-23, "I think Prism should be doing some lazy background refreshes, not impeding end user interaction with the
  // app but definitely need to keep data updating. Very likely this will be an always on app for a mini windows computer someday so the app needs to
  // maintain itself"): the runtime ticks this every few minutes; the lists are read again when they are BG_LISTS_MS old and the wall is quiet - no
  // search running, no background job on a service's page, no person's input on a window for BG_QUIET_MS. Hidden pages only; nothing on the screen moves.
  static readonly BG_LISTS_MS = 20 * 60_000;
  static readonly BG_QUIET_MS = 90_000;
  private bgLast = "";
  backgroundTick(services: ReadonlyArray<{ app: string; adapter: string; profile: string; home: string; status: string }>): string {
    const now = Date.now();
    let why = "";
    this.knowServices(services);
    if (this.inBgPause(now)) why = "paused (quiet hours " + this.bgPause.from + "-" + this.bgPause.to + ")";
    else if (this.lookupNow && !this.lookupNow.done) why = "a search is running";
    else if (this.hiddenWork > 0) why = "a job is running on a service's page";
    else if (now - Math.max(0, ...this.lastInteract.values()) < Orchestrator.BG_QUIET_MS) why = "a person is using the wall";
    else if (this.politeIdle(now)) why = "resting (nobody about for hours)";
    else if (now - this.listsRefreshedAt < Orchestrator.BG_LISTS_MS) why = "fresh";
    if (why) { this.bgLast = why; return why; }
    const asked = this.videoRefreshLists(services, true);
    this.bgLast = "refreshed " + asked.length + " services at " + new Date(now).toISOString().slice(11, 16);
    return this.bgLast;
  }
  backgroundState(): { last: string; listsAt: number; ownedAt: number } { return { last: this.bgLast, listsAt: this.listsRefreshedAt, ownedAt: this.ownedRefreshedAt }; }
  /** Refresh every signed-in service's list from its own page; `force` ignores the staleness guard. Returns the Apps asked. */
  videoRefreshLists(services: ReadonlyArray<{ app: string; adapter: string; profile: string; home: string; status: string }>, force = false): string[] {
    if (this.lookupNow && !this.lookupNow.done) return [];
    if (!force && Date.now() - this.listsRefreshedAt < Orchestrator.LISTS_STALE_MS) return [];
    // the owned libraries are long walks (Fandango: some two thousand titles, minutes on each page): read at most every OWNED_STALE_MS
    const withOwned = Date.now() - this.ownedRefreshedAt > Orchestrator.OWNED_STALE_MS;
    if (withOwned) this.ownedRefreshedAt = Date.now();
    this.knowServices(services);
    const asked: string[] = [];
    for (const s of services) {
      // the list, the household, Continue Watching, the owned pages - one chain per service, each page as soon as the last one is read (2026-09-24)
      if (this.refreshChain(s, { profiles: true, owned: withOwned })) asked.push(s.app);
    }
    if (asked.length) this.listsRefreshedAt = Date.now();
    this.touchLookups();
    return asked;
  }

  // ---- each service's hidden pages as a chain (2026-09-24, "make all the data loading and refreshing more current and seamless to the users"):
  // a page is left as soon as it has been read, the old fixed wait its limit; a newer chain for the same App replaces one still running
  private readonly chains = new Map<string, number>();
  private readonly chainRunning = new Set<string>();
  private readonly lastListRead = new Map<string, number>();
  /** Startup timings (2026-09-24, measuring launch before changing it): when each service's lists were first read this run. */
  readonly firstListRead = new Map<string, number>();
  /** When the kept rows were in, this run. */
  rowsCacheReadyAt: number | null = null;
  /**
   * A title starting on a service holds that service's background reading back (2026-09-25, Paramount+'s slow starts: its list page was being
   * read while a pick loaded): the chains wait before their next page for PICK_QUIET_MS after a pick, and a read already under way finishes.
   */
  private readonly pickStartAt = new Map<string, number>();
  static readonly PICK_QUIET_MS = 20_000;
  notePickStarting(app: string): void { this.pickStartAt.set(app, Date.now()); }
  private pickQuiet(app: string): boolean { return Date.now() - (this.pickStartAt.get(app) ?? 0) < Orchestrator.PICK_QUIET_MS; }
  private async runChain(app: string, steps: Array<{ go: () => Promise<void>; done: (since: number) => boolean; max: number }>): Promise<void> {
    const token = (this.chains.get(app) ?? 0) + 1;
    this.chains.set(app, token);
    this.chainRunning.add(app);
    const nap = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    let answered = 0, whole = true;
    const began = Date.now();
    try {
      for (const st of steps) {
        if (this.chains.get(app) !== token) { whole = false; return; }
        while (this.pickQuiet(app)) { await nap(1000); if (this.chains.get(app) !== token) { whole = false; return; } }   // a title starting on this service goes first
        const t0 = Date.now();
        await st.go();
        while (Date.now() - t0 < st.max) {
          await nap(500);
          if (this.chains.get(app) !== token) { whole = false; return; }
          if (st.done(t0)) { answered++; await nap(1200); break; }   // a moment for a second report (a grid that follows a row)
        }
      }
    } finally {
      if (this.chains.get(app) === token) this.chainRunning.delete(app);
      // an answer is any report from the service's page: an empty list is still an answer (it only never counts as a step "done")
      if (whole) this.noteChainResult(app, answered > 0 || (this.lookupReportAt.get(app) ?? 0) > began);
    }
  }
  // ---- a light, polite client (2026-09-25, "I don't want to negatively impact the client's performances noticeably to the end user. If avoidable,
  // proceed"): the automatic reads of a service's pages - the timed refresh, the after-watch and after-list-change reads, Watch's stale read - back
  // off from a service whose pages keep not answering, stop at a daily ceiling no household reaches, and rest while nobody has used the wall for
  // hours with nothing playing. What a person asks for (a play, Details, an episode list, a refresh pressed) is never held.
  static readonly POLITE_FAILS_BEFORE_BACKOFF = 3;
  static readonly POLITE_BACKOFF_MS = 30 * 60_000;
  static readonly POLITE_BACKOFF_MAX_MS = 4 * 3_600_000;
  static readonly POLITE_DAILY_CHAINS = 200;
  static readonly POLITE_IDLE_MS = 3 * 3_600_000;
  private readonly politeFails = new Map<string, number>();
  private readonly lookupReportAt = new Map<string, number>();
  private readonly politeUntil = new Map<string, number>();
  private readonly politeDay = new Map<string, { day: string; n: number }>();
  private personSeenAt = Date.now();
  /** A person is about (Watch open or read, a title picked): the automatic reads may run. */
  notePersonAbout(): void { this.personSeenAt = Date.now(); }
  /** Nobody has used the wall for POLITE_IDLE_MS and nothing is playing: the automatic reads rest. */
  politeIdle(now = Date.now()): boolean {
    const lastTouch = Math.max(this.personSeenAt, 0, ...this.lastInteract.values());
    return now - lastTouch > Orchestrator.POLITE_IDLE_MS && !this.video.state((this.doc?.tiles ?? []).map((t) => t.id)).some((t) => t.playing);
  }
  private politeMayRead(app: string, now = Date.now()): boolean {
    if ((this.politeUntil.get(app) ?? 0) > now) return false;
    const day = new Date(now).toISOString().slice(0, 10);
    const d = this.politeDay.get(app);
    if (d && d.day === day && d.n >= Orchestrator.POLITE_DAILY_CHAINS) return false;
    this.politeDay.set(app, { day, n: d && d.day === day ? d.n + 1 : 1 });
    return true;
  }
  private noteChainResult(app: string, ok: boolean): void {
    if (ok) { this.politeFails.delete(app); this.politeUntil.delete(app); return; }
    const n = (this.politeFails.get(app) ?? 0) + 1;
    this.politeFails.set(app, n);
    if (n >= Orchestrator.POLITE_FAILS_BEFORE_BACKOFF) {
      const wait = Math.min(Orchestrator.POLITE_BACKOFF_MAX_MS, Orchestrator.POLITE_BACKOFF_MS * 2 ** (n - Orchestrator.POLITE_FAILS_BEFORE_BACKOFF));
      this.politeUntil.set(app, Date.now() + wait);
    }
  }
  /** The polite client's state per service (dev and the freshness view). */
  politeState(): Record<string, { fails: number; until: number; today: number }> {
    const out: Record<string, { fails: number; until: number; today: number }> = {};
    const day = new Date().toISOString().slice(0, 10);
    for (const app of new Set([...this.politeFails.keys(), ...this.politeUntil.keys(), ...this.politeDay.keys()]))
      out[app] = { fails: this.politeFails.get(app) ?? 0, until: this.politeUntil.get(app) ?? 0, today: this.politeDay.get(app)?.day === day ? this.politeDay.get(app)!.n : 0 };
    return out;
  }
  /** One service's pages read in turn: its list, its household (profiles), its Continue Watching page, its owned library. False when there is nothing to read. */
  private refreshChain(s: { app: string; adapter: string; profile: string; home: string; status: string }, o: { profiles?: boolean; owned?: boolean; list?: boolean; asked?: boolean }): boolean {
    const spec = this.adapters.get(s.adapter);
    if (s.status !== "signed-in" || !spec) return false;
    if (!o.asked && !this.politeMayRead(s.app)) return false;   // a read a person asked for always goes
    const entry = () => this.lookups.get(`app:${s.app}:lookup`);
    // read: a report kept since the step began - but an empty list beside a Continue row waits for the settle, when it is believed
    const read = (t0: number) => (entry()?.listRead ?? 0) > t0 && !entry()?.lastListEmpty && !this.video.switchPending(s.adapter);
    const steps: Array<{ go: () => Promise<void>; done: (since: number) => boolean; max: number }> = [];
    if (o.list !== false && spec.videoLibrary && (spec.videoListUrl || spec.videoListRoute))
      steps.push({ go: () => this.listOne(s.app, s.profile, s.adapter, spec.videoListUrl ?? s.home, !!spec.videoListRoute && !spec.videoListUrl), done: read, max: Orchestrator.LIST_SETTLE_MS + 4000 });
    if (o.profiles && spec.videoProfiles && isPageUrl(spec.videoProfilesUrl))
      steps.push({ go: () => this.profilesOne(s.app, s.profile, s.adapter, spec.videoProfilesUrl!), done: (t0) => (entry()?.profilesAt ?? 0) > t0, max: 12_000 });
    if (spec.videoLibrary && spec.videoContinueUrl) { const cu = spec.videoContinueUrl; steps.push({ go: () => this.ownedOne(s.app, s.profile, s.adapter, cu), done: read, max: Orchestrator.LIST_SETTLE_MS + 4000 }); }
    if (o.owned && spec.videoLibrary) for (const u of spec.videoOwnedUrls ?? []) steps.push({ go: () => this.ownedOne(s.app, s.profile, s.adapter, u), done: (t0) => (entry()?.ownedDone ?? 0) > t0, max: Orchestrator.OWNED_STAY_MS });
    if (!steps.length) return false;
    void this.runChain(s.app, steps);
    return true;
  }
  /** The services as the runtime last named them (the after-watch read needs a service's profile and home). */
  private knownServices: Array<{ app: string; adapter: string; profile: string; home: string; status: string }> = [];
  private knowServices(services: ReadonlyArray<{ app: string; adapter: string; profile: string; home: string; status: string }>): void { if (services.length) this.knownServices = [...services]; }
  /**
   * The services whose lists were read longest ago, read again now (Watch opened, 2026-09-24): what is kept shows at once, what changed follows.
   * A service read within `maxAgeMs`, or with a chain running, is left alone. Returns the Apps asked.
   */
  videoRefreshStale(services: ReadonlyArray<{ app: string; adapter: string; profile: string; home: string; status: string }>, maxAgeMs = 10 * 60_000): string[] {
    this.notePersonAbout();   // Watch is open
    this.knowServices(services);
    if (this.lookupNow && !this.lookupNow.done) return [];
    const now = Date.now();
    const asked: string[] = [];
    for (const s of services) {
      if (this.chainRunning.has(s.app) || now - (this.lastListRead.get(s.app) ?? 0) < maxAgeMs) continue;
      if (this.refreshChain(s, {})) asked.push(s.app);
    }
    if (asked.length) this.touchLookups();
    return asked;
  }
  /** Library opened (2026-09-24): the owned libraries read again when they are more than OWNED_OPEN_STALE_MS old - the walks are long, so not every open. */
  videoRefreshOwnedIfStale(services: ReadonlyArray<{ app: string; adapter: string; profile: string; home: string; status: string }>): string[] {
    this.knowServices(services);
    if (Date.now() - this.ownedRefreshedAt < Orchestrator.OWNED_OPEN_STALE_MS || (this.lookupNow && !this.lookupNow.done)) return [];
    const asked: string[] = [];
    for (const s of services) {
      if (!(this.adapters.get(s.adapter)?.videoOwnedUrls?.length) || this.chainRunning.has(s.app)) continue;
      if (this.refreshChain(s, { list: false, owned: true })) asked.push(s.app);
    }
    if (asked.length) { this.ownedRefreshedAt = Date.now(); this.touchLookups(); }
    return asked;
  }
  static readonly OWNED_OPEN_STALE_MS = 3 * 3_600_000;
  /** A title stopped on a window of the wall: that service's Continue Watching changed - read again half a minute later (debounced per App). */
  private readonly watchEndTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly titledPlaying = new Map<string, boolean>();
  private noteWatchState(tileId: string): void {
    const tile = (this.doc?.tiles ?? []).find((t) => t.id === tileId);
    if (!tile?.adapter) return;
    const st = this.video.state([tileId])[0];
    const titled = !!st?.playing && !!st.video && !!(st.video.title || st.video.series) && st.video.kind !== "title";
    const was = this.titledPlaying.get(tileId) ?? false;
    this.titledPlaying.set(tileId, titled);
    if (!was || titled) return;
    const svc = this.knownServices.find((s) => s.adapter === tile.adapter);
    if (!svc) return;
    const t = this.watchEndTimers.get(svc.app);
    if (t) clearTimeout(t);
    this.watchEndTimers.set(svc.app, setTimeout(() => { this.watchEndTimers.delete(svc.app); if (!this.titledPlaying.get(tileId)) { this.refreshChain(svc, {}); this.touchLookups(); } }, Orchestrator.WATCH_END_READ_MS));
  }
  static readonly WATCH_END_READ_MS = 30_000;
  static readonly LIST_CHANGE_READ_MS = 4000;
  /**
   * Watch settings' Content updates tab (2026-09-24, "Background updates should show a grid of items being updated and their statuses"): each
   * service's parts - its lists (Continue Watching and My List), its owned library, its profiles page - with when each was last read and
   * whether it is being read now; the catalog rows and the ratings; and the schedule.
   */
  videoUpdatesStatus(services: ReadonlyArray<{ app: string; name: string; adapter: string; status: string }>): Record<string, unknown> {
    const svc = services.map((s) => {
      const spec = this.adapters.get(s.adapter);
      const e = this.lookups.get(`app:${s.app}:lookup`);
      const lists = !!spec?.videoLibrary && (!!spec.videoListUrl || !!spec.videoListRoute || !!spec.videoContinueUrl);
      return {
        app: s.app, name: s.name, status: s.status, working: this.chainRunning.has(s.app),
        lists: lists ? { at: this.lastListRead.get(s.app) ?? null } : null,
        owned: spec?.videoLibrary && spec.videoOwnedUrls?.length ? { at: e?.ownedDone ?? null, since: this.ownedRefreshedAt || null } : null,
        profiles: spec?.videoProfiles ? { at: e?.profilesAt ?? null, page: isPageUrl(spec.videoProfilesUrl) } : null,
      };
    });
    const newest = <T extends { at: number; done: boolean; cards: unknown[] }>(m: Map<string, T>, pick?: (k: string) => boolean) => {
      let best: T | null = null;
      for (const [k, v] of m) if ((!pick || pick(k)) && (!best || v.at > best.at)) best = v;
      return best ? { at: best.at, done: best.done, count: best.cards.length } : null;
    };
    return {
      services: svc,
      feeds: [
        { id: "wiki-reads", name: "Most read about this week", source: "Wikipedia + TMDB", every: "a day", ...(newest(this.mostReadCache) ?? { at: null, done: true, count: 0 }) },
        { id: "fresh-episodes", name: "New episodes, last 10 days", source: "TMDB", every: "6 hours", ...(newest(this.freshCache, (k) => k.startsWith("episodes|")) ?? { at: null, done: true, count: 0 }) },
        { id: "fresh-movies", name: "New movies, last 30 days", source: "TMDB", every: "6 hours", ...(newest(this.freshCache, (k) => k.startsWith("movies|")) ?? { at: null, done: true, count: 0 }) },
      ],
      ratings: { key: this.lenses.hasKey(), pending: this.lenses.pending },
      schedule: { last: this.bgLast, listsAt: this.listsRefreshedAt || null, everyMs: Orchestrator.BG_LISTS_MS, ownedAt: this.ownedRefreshedAt || null, ownedEveryMs: Orchestrator.OWNED_STALE_MS, pause: this.bgPause, paused: this.inBgPause(Date.now()) },
    };
  }
  /** One service's pages read again now (the Content updates tab's Refresh on its row). */
  videoRefreshApp(services: ReadonlyArray<{ app: string; adapter: string; profile: string; home: string; status: string }>, app: string): boolean {
    this.knowServices(services);
    const s = services.find((x) => x.app === app);
    if (!s || (this.lookupNow && !this.lookupNow.done)) return false;
    const ok = this.refreshChain(s, { profiles: true, asked: true });
    if (ok) this.touchLookups();
    return ok;
  }
  /** Per App: when its list was last read, and whether its pages are being read now (the Services row's dot, 2026-09-24). */
  videoFreshness(): Record<string, { readAt: number | null; working: boolean }> {
    const out: Record<string, { readAt: number | null; working: boolean }> = {};
    for (const s of this.knownServices) out[s.app] = { readAt: this.lastListRead.get(s.app) ?? null, working: this.chainRunning.has(s.app) };
    return out;
  }
  /** The household's optional quiet hours for the timed refresh (Watch settings, off by default - people watch at all hours). */
  bgPause: { on: boolean; from: string; to: string } = { on: false, from: "23:00", to: "07:00" };
  private inBgPause(now: number): boolean {
    if (!this.bgPause.on) return false;
    const min = (hm: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
    const a = min(this.bgPause.from), b = min(this.bgPause.to);
    if (a === null || b === null || a === b) return false;
    const d = new Date(now); const t = d.getHours() * 60 + d.getMinutes();
    return a < b ? t >= a && t < b : t >= a || t < b;   // a window across midnight
  }

  private async listOne(app: string, profile: string, adapter: string, url: string, route: boolean): Promise<void> {
    const id = `app:${app}:lookup`;
    try {
      let entry = this.lookups.get(id);
      if (!entry || !this.surfaces.has(id)) {
        entry = { app, adapter, up: false, upWaits: [], lastUsed: Date.now() };
        this.lookups.set(id, entry);
        await this.drivers.surface.create({ id, profile, background: this.doc?.theme?.background ?? DEFAULT_BACKGROUND, kind: "hidden", blocking: true });
        this.surfaces.add(id);
        await this.drivers.surface.setRect(id, { x: 0, y: 0, w: this.viewport.w || 1920, h: this.viewport.h || 1080 });
        await this.drivers.surface.setMuted(id, true);
      }
      entry.up = false; entry.lastUsed = Date.now(); entry.onList = true; entry.onProfiles = false; entry.routeOnUp = route; entry.listNavAt = Date.now(); entry.lastListEmpty = false;
      await this.drivers.surface.navigate(id, url);
      const nav = entry.listNavAt;
      setTimeout(() => { const e = this.lookups.get(id); if (e && e.onList && e.listNavAt === nav && e.lastListEmpty) this.video.clearList(adapter); }, Orchestrator.LIST_SETTLE_MS + 1000);
    } catch { /* the row keeps what it had */ }
  }

  /** The service's Who's watching page on the hidden surface: its report names the whole household (video.ts keeps it; a profile the service no longer lists leaves the wall's menu). */
  private async profilesOne(app: string, profile: string, adapter: string, url: string): Promise<void> {
    const id = `app:${app}:lookup`;
    if (this.lookupNow && !this.lookupNow.done) return;   // never over a running search
    try {
      let entry = this.lookups.get(id);
      if (!entry || !this.surfaces.has(id)) {
        entry = { app, adapter, up: false, upWaits: [], lastUsed: Date.now() };
        this.lookups.set(id, entry);
        await this.drivers.surface.create({ id, profile, background: this.doc?.theme?.background ?? DEFAULT_BACKGROUND, kind: "hidden", blocking: true });
        this.surfaces.add(id);
        await this.drivers.surface.setRect(id, { x: 0, y: 0, w: this.viewport.w || 1920, h: this.viewport.h || 1080 });
        await this.drivers.surface.setMuted(id, true);
      }
      entry.up = false; entry.lastUsed = Date.now(); entry.onList = false; entry.onProfiles = true; entry.routeOnUp = false;
      await this.drivers.surface.navigate(id, url);
      this.touchLookups();
    } catch { /* the list keeps what it had */ }
  }

  /** A page of what the person owns on the service (Fandango's My Movies / My TV Shows), on the hidden surface: the library reader reports it as `owned`. */
  private async ownedOne(app: string, profile: string, adapter: string, url: string): Promise<void> {
    const id = `app:${app}:lookup`;
    if (this.lookupNow && !this.lookupNow.done) return;
    try {
      let entry = this.lookups.get(id);
      if (!entry || !this.surfaces.has(id)) {
        entry = { app, adapter, up: false, upWaits: [], lastUsed: Date.now() };
        this.lookups.set(id, entry);
        await this.drivers.surface.create({ id, profile, background: this.doc?.theme?.background ?? DEFAULT_BACKGROUND, kind: "hidden", blocking: true });
        this.surfaces.add(id);
        await this.drivers.surface.setRect(id, { x: 0, y: 0, w: this.viewport.w || 1920, h: this.viewport.h || 1080 });
        await this.drivers.surface.setMuted(id, true);
      }
      entry.up = false; entry.lastUsed = Date.now(); entry.onList = true; entry.onProfiles = false; entry.routeOnUp = false; entry.listNavAt = Date.now(); entry.lastListEmpty = false;
      await this.drivers.surface.navigate(id, url);
      this.touchLookups();
    } catch { /* the library keeps what it had */ }
  }

  /** Ids of the hidden search surfaces (state / debugging). */
  lookupSurfaces(): string[] { return [...this.lookups.keys()]; }

  private touchLookups(): void {
    if (this.lookupIdleTimer) clearTimeout(this.lookupIdleTimer);
    this.lookupIdleTimer = setTimeout(() => {
      this.lookupIdleTimer = null;
      if (this.lookupNow && !this.lookupNow.done) { this.touchLookups(); return; }
      if (this.hiddenWork > 0) { this.touchLookups(); return; }   // a removal or an episode list mid-way keeps its page (Ladies First's was closed 9 s in, 2026-09-22)
      for (const [id] of this.lookups) {
        this.lookups.delete(id);
        if (this.surfaces.has(id)) { this.surfaces.delete(id); void this.drivers.surface.destroy(id); }
        this.nowPlaying.delete(id); this.currentUrl.delete(id);
      }
    }, Orchestrator.LOOKUP_IDLE_MS);
  }
  /** Phase 2: the person's words entered into the service's own search on this tile (the adapter's videoSearch script); `open` = the result to press once shown. */
  videoSearchIn(tileId: string, q: string, open?: string | null) { return this.video.search(tileId, q, open); }
  /** Phase 2: the channel to tune on this tile once its guide page is up. */
  videoTuneWhenUp(tileId: string, channelId: string): void { this.videoTuneQueued.set(tileId, { channelId, at: Date.now() }); }
  /** Phase 2: a human's press on a Live now card - the channel's guide item pressed in the service's own page. */
  videoTune(tileId: string, channelId: string) { return this.video.tune(tileId, channelId); }
  /** VP-3: a human's pick on a service's profile gate; `always` makes it the household's standing choice. */
  videoProfile(tileId: string, id: string, always: boolean) { return this.video.pickProfile(tileId, id, always); }
  videoTrack(tileId: string, kind: "subtitles" | "audio", id: string) { return this.video.pickTrack(tileId, kind, id); }
  /** The slider (2026-09-23): the person's seek - it counts as their action on the tile (the playback doctor stands back). */
  /** Play an episode by its number on the page's own control (adapter videoEpisodeNumber): a person's pick from the Episodes list. */
  videoPlayEpisodeNumber(tileId: string, season: number, episode: number): "ok" | "unavailable" | "unknown-tile" {
    if (!this.surfaces.has(tileId)) return "unknown-tile";
    const spec = this.tile(tileId)?.adapter ? this.adapters.get(this.tile(tileId)!.adapter!) : undefined;
    if (!spec?.videoEpisodeNumber || !Number.isInteger(season) || !Number.isInteger(episode)) return "unavailable";
    this.arm(tileId);   // the person's pick: the play it starts is theirs (the sound, the stage)
    this.pageTouchedAt.set(tileId, Date.now());
    void this.drivers.surface.inject(tileId, null, `window.__prismVideoEpisodeNumber && window.__prismVideoEpisodeNumber(${season}, ${episode})`);
    return "ok";
  }
  videoSeek(tileId: string, seconds: number) { this.pageTouchedAt.set(tileId, Date.now()); return this.video.seekTo(tileId, seconds); }
  videoForgetProfile(tileId: string): void { this.video.forgetProfile(tileId); }
  /**
   * The stage (2026-09-20): the player's own fullscreen control, pressed once because a human's play has begun - the
   * adapter's videoCmd fullscreen (VP-2's verb, a human's ask). The keeper's own presentation controls are the keeper's
   * alone (presentation-wiring.test): it holds what this establishes. Already in element fullscreen: nothing. No
   * videoCmd: nothing (never a hunt).
   */
  videoEnterStage(tileId: string): void {
    if (!this.surfaces.has(tileId) || this.elementFullscreen.has(tileId)) return;
    const tile = this.tile(tileId);
    const spec = tile?.adapter ? this.adapters.get(tile.adapter) : undefined;
    const js = this.video.cmdJs(spec, "fullscreen");
    if (!js) return;
    this.arm(tileId);
    // the player's control may not be drawn at the very moment the play begins (Hulu's appear a beat later and hide again
    // soon after): the ask is repeated every 700 ms for twelve seconds, until the page reports a fullscreen element
    void this.drivers.surface.inject(tileId, null, `(function(){if(document.fullscreenElement)return;if(window.__prismStageTry&&Date.now()-window.__prismStageTry<12000)return;window.__prismStageTry=Date.now();var t0=Date.now();(function tryIt(){if(document.fullscreenElement)return;try{${js};}catch(e){}if(!document.fullscreenElement&&Date.now()-t0<12000)setTimeout(tryIt,700);})();})()`);
  }
  /** The profiles a service has shown (by adapter key), the household's standing choice, and the plain choose / ask verbs (2026-09-19). */
  videoKnownProfiles(appKey: string) { return this.video.knownProfiles(appKey); }
  videoStandingProfile(appKey: string) { return this.video.standingProfile(appKey); }
  videoChooseProfile(appKey: string, id: string) { return this.video.chooseProfile(appKey, id); }
  videoSwitchPending(appKey: string) { return this.video.switchPending(appKey); }
  /**
   * The person switched these services to other profiles (a preset, the Profiles window - 2026-09-24): each service's hidden page opens its
   * profile page (or its list page, where the switcher is) so the wanted profile is pressed, then reads that person's My List and Continue
   * Watching. Services one after another on their own pages; a search running holds them back as ever.
   */
  videoSwitchProfiles(services: ReadonlyArray<{ app: string; adapter: string; profile: string; home: string; status: string }>, picks: Record<string, string>): string[] {
    this.knowServices(services);
    const asked: string[] = [];
    for (const s of services) {
      const id = picks[s.app];
      if (!id || s.status !== "signed-in") continue;
      const r = this.video.switchProfile(s.adapter, id);
      if (r === "unknown-profile" || r === "same") continue;   // already on that profile: no switch, no "switching"
      asked.push(s.app);
      this.switchAt.set(s.app, Date.now());
      const spec = this.adapters.get(s.adapter);
      // the switch first - the service's own switch address, else its profile page (a gate), else the list page's switcher - each step on
      // as soon as it is done: the press made and the page read (2026-09-24)
      const entry = () => this.lookups.get(`app:${s.app}:lookup`);
      const steps: Array<{ go: () => Promise<void>; done: (since: number) => boolean; max: number }> = [];
      if (spec?.videoProfileSwitchUrl && isPageUrl(spec.videoProfileSwitchUrl)) {
        // the service's own switch address: opening it IS the switch
        this.video.switchedByAddress(s.adapter, id);
        const su = spec.videoProfileSwitchUrl.replace("{id}", encodeURIComponent(id));
        steps.push({ go: () => this.profilesOne(s.app, s.profile, s.adapter, su), done: (t0) => (entry()?.profilesAt ?? 0) > t0, max: Orchestrator.PROFILE_SWITCH_MS });
      } else if (isPageUrl(spec?.videoProfilesUrl)) {
        const pu = spec!.videoProfilesUrl!;
        steps.push({ go: () => this.profilesOne(s.app, s.profile, s.adapter, pu), done: () => !this.video.switchPending(s.adapter), max: Orchestrator.PROFILE_SWITCH_MS });
      }
      void (async () => {
        await this.runChain(s.app, steps);
        // (the service's windows on the wall are no longer reloaded after a switch - four multiview windows reloading flashed through Watch,
        // 2026-09-24; their rows are held until they load a page themselves, and a pick there loads the new person's page anyway)
        this.refreshChain(s, { asked: true });
      })();
    }
    if (asked.length) this.touchLookups();
    return asked;
  }
  private reloadIdleTilesOf(adapterKey: string): void {
    for (const t of this.doc?.tiles ?? []) {
      if (t.adapter !== adapterKey || !this.surfaces.has(t.id) || !t.url) continue;
      const st = this.video.state([t.id])[0];
      if (st?.pending || (st?.video && (st.video.title || st.video.series) && st.video.kind !== "title")) continue;   // a title up (a nameless 'title' is a billboard)
      void this.drivers.surface.navigate(t.id, t.url);
    }
  }
  /** When each App was last switched to another profile: its switch is still being read until its list page has been read since. */
  private readonly switchAt = new Map<string, number>();
  /**
   * The person's switch is still in progress for this App (2026-09-24, "if we're still working on profile changes, lets keep the status at the
   * top center until completed"): the profile not yet pressed, or the new person's My List not yet read. Three minutes at most.
   */
  videoSwitchWorking(app: string, adapterKey: string): boolean {
    const at = this.switchAt.get(app);
    if (!at) return false;
    if (Date.now() - at > 3 * 60_000) { this.switchAt.delete(app); return false; }
    const spec = this.adapters.get(adapterKey);
    if (this.video.switchPending(adapterKey)) return true;
    if (!spec?.videoLibrary) { this.switchAt.delete(app); return false; }
    const read = this.lookups.get(`app:${app}:lookup`)?.listRead ?? 0;
    if (read > at) { this.switchAt.delete(app); return false; }
    return true;
  }
  /** a profile page's press and the service's reload after it */
  static readonly PROFILE_SWITCH_MS = 12_000;
  videoAskProfile(appKey: string): void { this.video.askProfile(appKey); }
  videoForgetWatch(appKey: string, what: string): number { return this.video.forgetWatch(appKey, what); }

  /** What a single tap on this item means (the placement's standing instruction; absent === "promote"). */
  tapActionOf(tileId: string): TapAction {
    return this.tile(tileId)?.tapAction ?? "promote";
  }

  /**
   * A single tap on an on-scene item (§6a + docs/concept-scenes.md §5,
   * normative). The placement's `tapAction` decides:
   *
   *   promote (default) — today's §6a behavior, unchanged: the full-page
   *                       native experience; Back returns to the scene.
   *   audio             — the sound moves here. §3 does the switching
   *                       (previous owner muted, this one unmuted); the
   *                       layout is untouched and nothing is promoted.
   *                       Tapping the current owner is a no-op, never a mute.
   *   both              — the audio moves AND the item is promoted.
   *
   * §25 × §5: an item mid-peek is never a tap target for the audio switch —
   * a peek is a muted transient revival, not the household's choice of what
   * to listen to.
   */
  async tapItem(tileId: string): Promise<TapResult> {
    if (!this.tile(tileId)) return this.reportTap(tileId, { ok: false, action: "promote", did: "none", error: "unknown-tile" });
    const action = this.tapActionOf(tileId);
    let audio: TapResult["audio"];
    if (action === "audio" || action === "both") {
      if (this.preview.peeking === tileId) {
        audio = "peeking";
      } else {
        const cmds = this.mvKeepsAudio(tileId) ? [] : this.audio.takeAudioFocus(tileId);   // multiview: a small window never takes the sound
        if (cmds.length) { await this.applyAudioCommands(cmds); audio = "moved"; }
        else audio = "already-owner";
      }
    }
    let promoted = false;
    let error: TapResult["error"];
    if (action === "promote" || action === "both") {
      if (await this.enterFullscreen(tileId)) { await this.enterTile(tileId); promoted = true; }
      else error = "unavailable";
    }
    const moved = audio === "moved";
    const did: TapResult["did"] = moved && promoted ? "audio+promote" : promoted ? "promote" : moved ? "audio" : "none";
    return this.reportTap(tileId, { ok: !error, action, did, ...(audio ? { audio } : {}), ...(error ? { error } : {}) });
  }

  /**
   * One verdict, one place: the shell learns what a tap resolved to whether
   * the hand was on the wall or on the phone (§6 parity). Reporting is
   * fire-and-forget — the tap has already happened.
   */
  private reportTap(tileId: string, result: TapResult): TapResult {
    const { action, did, audio, error } = result;
    void Promise.resolve(this.drivers.ui?.tapResult?.(tileId, { action, did, ...(audio ? { audio } : {}), ...(error ? { error } : {}) })).catch(() => {});
    return result;
  }

  /** Execute §3's verdict on the surfaces (the one place audio commands are applied). */
  private async applyAudioCommands(cmds: readonly AudioCommand[]): Promise<void> {
    for (const cmd of cmds) {
      if (cmd.op === "mute") {
        await this.drivers.surface.setMuted(cmd.tile, true);
        // 2026-09-17 (section 3, amended): a MUSIC source that loses the audio is paused through its own player, not left
        // streaming in silence - "We shouldn't mute and continue streaming services that aren't actively playing. They should
        // be paused." A silent music player spends skips and ad breaks for no one and walks a Prism-ordered play forward
        // behind the person's back. Everything else keeps the mute-only rule (a muted live stream keeps moving).
        if (this.music.source(cmd.tile) && this.audio.isPlaying(cmd.tile)) await this.pauseSource(cmd.tile);
      }
      else if (cmd.op === "unmute") await this.drivers.surface.setMuted(cmd.tile, this.wallMuted || this.intermission.isCovered(cmd.tile));   // the owner, heard only while the wall is not muted - and never under its own break (2026-09-14)
      else if (cmd.op === "pause") {
        // Adapter-mediated pause (§3.4); harmless no-op where no adapter.
        await this.drivers.surface.inject(
          cmd.tile,
          null,
          "document.querySelectorAll('video,audio').forEach(m=>m.pause())",
        );
      }
    }
  }

  /**
   * §17 pre-reveal gate: inject the framing transform into the hidden buffer
   * and wait for its verdict. Missing selector ⇒ false (load treated as
   * failed; stale pixels stay). A silent bridge fails open after 2s so a
   * broken host object can never wedge every refresh.
   */
  private applyFocus(tileId: string): Promise<boolean> {
    const focus = this.tile(tileId)?.focus;
    if (!focus || this.mvSmall.has(tileId)) return Promise.resolve(true);   // a small multiview window shows its whole page - a fresh load had framed Hulu's again (2026-09-23)
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.focusWaits.delete(tileId);
        resolve(true); // fail-open: unframed page beats a wedged tile
      }, 2000);
      this.focusWaits.set(tileId, (found) => {
        clearTimeout(timer);
        this.focusWaits.delete(tileId);
        resolve(found);
      });
      void this.drivers.surface.inject(tileId, null, focusFramingJs(focus));
    });
  }

  /**
   * §25 virtual playhead: before a preview tile's fresh pixels are revealed
   * (peek capture or promotion), seek to where the video would be now. Live
   * streams and unknown positions seek nowhere — the still is simply now.
   */
  private async seekToVirtualPlayhead(tileId: string): Promise<void> {
    if (this.tile(tileId)?.preview?.mode !== "peek") return;
    const pos = this.playhead.virtualPosition(tileId);
    if (pos === null) return;
    await this.drivers.surface.inject(tileId, null, seekJs(pos));
  }

  /**
   * §25 decode budget: video tiles (those declaring a preview) playing at
   * once are capped per device. The newest player wins; the oldest beyond
   * the cap is paused and its still keeps advancing via peeks.
   */
  private async enforceDecodeCap(started: string): Promise<void> {
    if (!this.tile(started)?.preview) return;
    this.playingVideo = [...this.playingVideo.filter((id) => id !== started), started];
    const cap = Math.max(1, Math.floor(this.previewBudget.maxPlayingVideo));
    while (this.playingVideo.length > cap) {
      const victim = this.playingVideo.shift()!;
      await this.drivers.surface.inject(
        victim,
        null,
        "document.querySelectorAll('video,audio').forEach(m=>m.pause())",
      );
    }
  }

  /**
   * §6 POST /navigate: send a tile somewhere (a watch page, a stream, a
   * search). Rides the §16 load path — snapshot stays up until the new page
   * is ready — and becomes the tile's URL for reloads/revives until the
   * dashboard is reloaded. Launch tiles have no page to navigate.
   */
  async navigateTile(tileId: string, url: string): Promise<"ok" | "unknown-tile" | "bad-url" | "not-web"> {
    const tile = this.tile(tileId);
    if (!tile) return "unknown-tile";
    if (tile.launch || !this.surfaces.has(tileId)) return "not-web";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return "bad-url";
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "bad-url";
    tile.url = parsed.toString();
    // "Login tile" (§17 × adapter.login): on the service's sign-in page, frame
    // the form; anywhere else, the tile's own focus (if any) applies again.
    const spec = tile.adapter ? this.adapters.get(tile.adapter) : undefined;
    const original = this.docs.get(this.doc!.id)?.tiles.find((t) => t.id === tileId);
    const onLogin = !!spec?.login && tile.url.startsWith(spec.login.split("?")[0]!);
    if (onLogin && spec?.loginFocus) tile.focus = { selector: spec.loginFocus, pad: 24, fit: "contain" };
    else if (original?.focus) tile.focus = original.focus;
    else delete tile.focus;
    if (this.lifecycle.status(tileId) === "warm") await this.lifecycle.touch(tileId); // revive first
    this.refresh.load(tileId, tile.url, tile.refresh ?? null);
    this.lifecycle.track(
      this.doc!.tiles.map((t) => ({ id: t.id, url: t.url ?? null, persist: t.persist ?? false, refreshSec: t.refresh ?? null })),
    );
    return "ok";
  }

  /* ----------------------------- §27 veil ------------------------------ */

  private veilMode(tile: TileSpec): VeilMode {
    return tile.veil?.mode ?? "off";
  }

  /** §5 blocking flag as the shell should apply it; `veil-only` turns it off. */
  private blockingFor(tile: TileSpec): boolean {
    if (this.veilMode(tile) === "veil-only") return false;
    return tile.blocking !== false;
  }

  /**
   * Install (or clear) the veil on a tile's current document. Selectors come
   * from attributed lists matched to the page hostname; imagery from the
   * shell's local store. No selectors ⇒ nothing is injected at all.
   */
  private async applyVeil(tileId: string): Promise<void> {
    const tile = this.tile(tileId);
    if (!tile?.url) return;
    if (this.veilMode(tile) === "off") {
      if (tile.veil) await this.drivers.surface.inject(tileId, null, CLEAR_VEIL_JS);
      return;
    }
    const { selectors } = this.cosmetics.selectorsFor(hostnameOf(tile.url));
    const hasOverlays = (tile.adapter ? this.adapters.get(tile.adapter)?.overlays?.length ?? 0 : 0) > 0;
    if (selectors.length === 0 && !hasOverlays) return; // degrade to nothing (§27 safety)
    const source = tile.veil?.source ?? "pack:cosmos";
    let images: string[] = [];
    try {
      images = (await this.drivers.surface.veilImagery?.(source)) ?? [];
    } catch {
      images = []; // textured fallback — never a broken page
    }
    // §27 partial veil: adapter-identified in-player overlays, element-scoped.
    const overlays = (tile.adapter ? this.adapters.get(tile.adapter)?.overlays : undefined) ?? [];
    await this.drivers.surface.inject(tileId, null, veilJs({ selectors, images, overlays }));
  }

  /** §5 injection: the window.frame prelude, then adapter CSS (fresh docs only), then JS. */
  private async injectAdapter(tileId: string, opts: { includeCss: boolean }): Promise<void> {
    const tile = this.tile(tileId);
    const spec = tile?.adapter ? this.adapters.get(tile.adapter) : undefined;
    await this.drivers.surface.inject(tileId, null, FRAME_PRELUDE_JS);
    if (!spec) return;
    // a video service's page draws no browser controls (2026-09-25, Apple TV: its fullscreen is the bare <video>, and Chromium drew its own media
    // controls over it on every pause - "I see their chrome when I pause"): the wall's controls are the only ones, on every video service
    const css = opts.includeCss ? [spec.css, isVideoAdapter(spec) ? NO_NATIVE_VIDEO_CONTROLS_CSS : null].filter(Boolean).join(" ") || null : null;
    await this.drivers.surface.inject(
      tileId,
      css,
      adapterScript(spec),
    );
  }

  /** Execute a §6 display command; false when no display driver exists. */
  async displayCommand(body: { brightness?: number; power?: "sleep" | "wake" }): Promise<boolean> {
    if (!this.drivers.display) return false;
    if (typeof body.brightness === "number") {
      await this.drivers.display.setBrightness(Math.min(1, Math.max(0, body.brightness)));
    }
    if (body.power === "sleep" || body.power === "wake") {
      await this.drivers.display.setPower(body.power);
    }
    return true;
  }

  /** Shell pushes surface events here; core answers with driver commands. */
  async onSurfaceEvent(event: SurfaceEvent): Promise<void> {
    this.refresh.handleEvent(event); // readiness signals (§16)
    if (event.type === "load-finished" && event.ok) {
      // a window's rows count again after a switch once it has loaded a whole page (2026-09-25): a move inside the page kept the last
      // person's page in memory, and its rows came back. First, before anything awaits: the page's first report follows at once
      this.video.tileNavigated(event.id);
      // a fresh document is never in element fullscreen: the mark the last one left would keep the stage from entering
      // (Paramount+ after a Hulu play, 2026-09-21 - the shell reports no "left" for a document that navigated away)
      if (this.elementFullscreen.delete(event.id)) await this.feedKeeper(event.id, { type: "presentation", at: Date.now(), state: "none" });
      await this.injectAdapter(event.id, { includeCss: true }); // fresh document
      // VP-3 (2026-09-19): a Quick play on a service that was not on the screen - the screen became it, and now that its page
      // is up the title is asked for (the adapter's videoPlay), once, within a minute of the ask
      const queued = this.videoPlayQueued.get(event.id);
      if (queued) { this.videoPlayQueued.delete(event.id); if (Date.now() - queued.at < 60_000) void this.videoPlay(event.id, queued.kind, queued.id, queued.url, queued.name); }
      const back = this.bootTitles.get(event.id);
      if (back) {   // a title coming back: its page is up - the pick's clock starts now (a cold load outran the 20 s it has)
        const hero = this.videoMultiviewHero();
        const claim = hero ? event.id === hero : this.bootTitles.size === 1 || [...this.bootTitles.keys()][0] === event.id;
        this.bootTitles.delete(event.id);
        await this.video.restoreTitle(event.id, back.url, back.name, claim);
        // a title that came back and never started - Paramount+'s ad loader sat on "Advertisement is loading..." for good after a restart
        // (2026-09-23, "The bottom right video in multiview is gray"): once, the title's own address again, unless a person has acted there
        const id = event.id, at = Date.now();
        // a title whose address waits for a Play press (2026-09-25, "Foundation started but I lost it and am back on the home page again": a
        // restart brought Apple TV's episode page back and it sat there, Play unpressed): not playing a few seconds after its page is up, the
        // service's own play is asked for - the press its adapter makes for a pick; an address that plays by itself is playing by then
        setTimeout(() => {
          if (!this.surfaces.has(id) || this.video.state([id])[0]?.playing || (this.lastInteract.get(id) ?? 0) > at) return;
          const spec = this.tile(id)?.adapter ? this.adapters.get(this.tile(id)!.adapter!) : undefined;
          if (!spec?.videoPlay) return;
          void this.drivers.surface.inject(id, null, `window.__prismVideoPlay && window.__prismVideoPlay("title", ${JSON.stringify(back.url)}, ${JSON.stringify(back.url)})`);
        }, Orchestrator.RESTORE_PRESS_MS);
        setTimeout(() => {
          if (!this.surfaces.has(id) || this.video.state([id])[0]?.playing || (this.lastInteract.get(id) ?? 0) > at) return;
          const bare = (u: string) => u.split("?")[0]!.split("#")[0]!.replace(/[/]+$/, "");
          if (bare(this.currentUrl.get(id) ?? back.url) !== bare(back.url)) return;
          void this.drivers.surface.navigate(id, back.url);
        }, Orchestrator.RESTORE_STALL_MS);
        // ... and still nothing after the second try: the pick is over (2026-09-23, "keeps closing watch back to apple's home page" - Apple TV's
        // episode address waits for a Play press, so a restored Hijack stayed 'loading' for good: the wall counted it as a title up and put
        // Apple's page in Watch's corner, where a press closed Watch onto it)
        setTimeout(() => {
          if (!this.surfaces.has(id) || this.video.state([id])[0]?.playing || (this.lastInteract.get(id) ?? 0) > at) return;
          this.video.failPick(id, "did not start again after the restart");
          // ... and it is forgotten: the next boot does not try it again
          if (this.videoUp.get(id)?.url === back.url) { this.videoUp.delete(id); this.persistVideoUp(); }
        }, 2 * Orchestrator.RESTORE_STALL_MS);
      }
      // the stage asked page-side from the moment the pick's page is up: the loop no-ops until the feature has frames, so the
      // player fills the screen as soon as it plays rather than a report or two later (2026-09-21)
      if (queued && Date.now() - queued.at < 60_000) setTimeout(() => this.videoEnterStage(event.id), 1500);
      const tune = this.videoTuneQueued.get(event.id);
      if (tune) { this.videoTuneQueued.delete(event.id); if (Date.now() - tune.at < 60_000) void this.videoTune(event.id, tune.channelId); }
      const search = this.videoSearchQueued.get(event.id);
      if (search) { this.videoSearchQueued.delete(event.id); if (Date.now() - search.at < 60_000) void this.videoSearchIn(event.id, search.q, search.open); }
      if (this.tile(event.id)?.preview?.mode === "peek") {
        await this.drivers.surface.inject(event.id, null, REPORT_POSITION_JS); // §25 playhead feed
      }
      await this.applyVeil(event.id); // §27 — fresh document
      if (this.pendingResumePlay.has(event.id)) await this.pressPlayControl(event.id);
      else await this.runOnActivate(event.id);
    }
    if (event.type === "navigated") {
      if (event.url) { this.currentUrl.set(event.id, event.url); this.navAt.set(event.id, Date.now()); }
      await this.applyVeil(event.id); // §27 — SPA moved; the installer updates in place
      this.rememberLocation(event.id, event.url);
    }
    if (event.type === "media-position") {
      this.playhead.report(event.id, event.position, event.duration);
      return;
    }
    if (event.type === "music-result") {
      // Quick play cross-service lookup (2026-09-16): the page's answer to a question core asked with this token
      // ... and only from the tile that was asked: a token alone is not a credential, the origin is part of the match
      const wait = this.musicResultWaits.get(event.token);
      if (wait && wait.tileId === event.id) {
        // a page mid-job asks for a real hover at a point on itself (Hulu's X draws only for one, 2026-09-22): only on the wall's own hidden
        // lookup surfaces, only while a job a person confirmed is waiting on it - the question stays open
        if (event.op === "hover") {
          if (this.lookups.has(event.id) && this.hiddenWork > 0 && typeof event.count === "number" && typeof event.total === "number") void this.drivers.surface.hover?.(event.id, event.count, event.total);
          return;
        }
        if (event.op === "episodes-part") { wait.partial?.(event); return; }   // the seasons read so far (2026-09-23) - the question stays open
        if (event.op === "progress") {   // 2026-09-18: how far the page has got - the question stays open
          const o = this.musicOrder.get(event.id);
          if (!this.musicWork.has(event.id) && o) this.noteQueueWork(event.id, o.kind, o.id, event.count, event.total); else this.noteWork(event.id, event.count, event.total);
          return;
        }
        wait.resolve(event);
      }
      return;
    }
    if (event.type === "session") {
      // B-123: the adapter's watch saw the account, or the Sign In control. Kept per tile for the wall's
      // chrome; the runtime turns it into the App's setup status (evidence "probe").
      if (event.state === "signed-in" || event.state === "signed-out") {
        if (this.trustSessionReport(event.id, event.state)) this.sessionState.set(event.id, event.state);
      }
      return;
    }
    if ((event.type === "playback" || event.type === "now-playing") && event.id.startsWith("ambient:")) {
      // 2026-09-17: a soundscape's own media reports are not a tile playing. Since the bootstrap wraps play() (3346b4f,
      // 2026-09-16) the ambient page reports playback and a face like any page, and section 3's arbiter muted it as a
      // source without the audio - every Spotify break played a silent Space Walk ("none of them played a sound"). The
      // soundscape sounds exactly while its music tile owns the audio (ambientSound, wallMute); nothing else decides it.
      return;
    }
    if (event.type === "now-playing") {
      if (!event.id.startsWith("app:") && this.tile(event.id)?.adapter) queueMicrotask(() => this.noteWatchState(event.id));   // a title that stopped: its service read again soon
      // a pick called off before it played (videoCancelPick): the page it had already loaded may begin anyway - paused once, within the window
      const off = this.pickCancelledAt.get(event.id);
      if (off !== undefined) {
        if (Date.now() - off > Orchestrator.PICK_CANCEL_MS) this.pickCancelledAt.delete(event.id);
        else if (event.info?.playing === true || event.info?.video?.playing === true) { this.pickCancelledAt.delete(event.id); void this.tileCommand(event.id, "pause"); }
      }
      // §32: observation of the page's Media Session, kept per tile and
      // pushed to the shell's player control. Content stays on the device.
      // a library-only report (nothing playing, no track) is the page handing over its lists while idle: no face
      // a service with no Media Session (Pandora) names the track through its context instead: that is the track
      if (event.info && !event.info.title && event.info.context?.title) event = { ...event, info: { ...event.info, title: event.info.context.title, ...(event.info.artist ? {} : event.info.context.artist ? { artist: event.info.context.artist } : {}) } };
      if (event.info && !event.info.playing && event.info.context?.playing === true) event = { ...event, info: { ...event.info, playing: true } };   // B-132: the page's transport is a fact too
      // B-226 (2026-09-17): and the other way round - an element playing with no track named while the player's own
      // transport says stopped is not the service playing (Apple Music's page restarts a nameless element every few
      // seconds while idle - 806 ended+playing pairs in two hours - and the face read "playing" with an empty title)
      if (event.info && event.info.playing && !event.info.title && event.info.context?.playing === false) event = { ...event, info: { ...event.info, playing: false } };
      // ... and the other way (2026-09-14): Pandora's tuner showed Play (paused) while a pre-buffered element read as playing
      // (B-148), so the wall said playing and its clock ran 0:26 -> 0:29 and started over on every poll. The page's own
      // transport saying paused wins over an element; the clock then holds at the page's position.
      if (event.info && event.info.playing && event.info.context?.playing === false) event = { ...event, info: { ...event.info, playing: false } };
      // ... and its artwork: Pandora sets no Media Session, so the poster is the tuner's own image (2026-09-13); the Media Session's wins when it has one
      if (event.info && !event.info.artwork && event.info.context?.artwork) event = { ...event, info: { ...event.info, artwork: event.info.context.artwork } };
      // The transport a control may offer: the page's registered Media Session actions AND the adapter's declared
      // controls (section 26 pass-through - a Next press is forwarded to the page's own control). Pandora registers no
      // Media Session at all, so its Next sat grey on the wall while the adapter's skip_button was there (2026-09-14).
      // Here, on the record the wall state carries, not only on the music model's copy (the first cut merged too late).
      if (event.info && !(!event.info.title && !event.info.playing && !!event.info.library)) {
        const tileA = (this.doc?.tiles ?? []).find((t) => t.id === event.id);
        const specA = tileA?.adapter ? this.adapters.get(tileA.adapter) : undefined;
        const c = specA?.controls ?? {};
        const declared: string[] = [];
        if (c.play) declared.push("play"); if (c.pause) declared.push("pause"); if (c.next) declared.push("nexttrack"); if (c.prev) declared.push("previoustrack");
        // ... minus what the page has hidden or disabled right now (2026-09-14: Pandora hides Skip while an ad plays;
        // the wall's Next greys for exactly as long) - the page's own word, through the adapter's context
        const off = event.info.context?.unavailable ?? [];
        if (declared.length) event = { ...event, info: { ...event.info, actions: Array.from(new Set([...(event.info.actions ?? []), ...declared])) } };
        if (off.length && event.type === "now-playing" && event.info) {
          const drop = new Set(off.map((n) => (n === "next" ? "nexttrack" : n === "prev" ? "previoustrack" : n)));
          event = { ...event, info: { ...event.info, actions: (event.info.actions ?? []).filter((a) => !drop.has(a)) } };
        }
      }
      const face = event.info && !event.info.title && !event.info.playing && event.info.library ? null : event.info;
      if (face) this.nowPlaying.set(event.id, face); else this.nowPlaying.delete(event.id);
      // B-139: a fresh face that says paused corrects section 3's machine - Pandora paused itself behind its prompt
      // overnight while the machine still said playing, so a Play press was "already playing" and pressed nothing.
      // Dropping a tile from the playing set commands nothing (no mute, no focus change); the next playback signal re-adds it.
      if (face && face.playing === false && face.title && this.audio.isPlaying(event.id)) this.audio.onPlayback(event.id, false, false);
      if (!face && this.audio.isPlaying(event.id)) this.audio.onPlayback(event.id, false, false);   // nothing queued at all: not playing either
      // B-158 (2026-09-08): and the other way - a page that says PLAYING with no media element in its document (Spotify) never
      // sends a playback signal, so a human's Play took no audio: the block said muted, the button said sound on, and only a
      // mute + unmute made it the owner. The face's word is the playback signal, with the same human attribution.
      if (face && face.playing === true && !this.audio.isPlaying(event.id)) {
        const armedAt = this.lastInteract.get(event.id) ?? 0;
        let human = armedAt > 0 && Date.now() - armedAt < HUMAN_INTENT_MS;
        if (human) this.lastInteract.delete(event.id);
        if (!human && this.stageSourceUnowned(event.id)) human = true;   // B-165
        if (human && this.mvKeepsAudio(event.id)) human = false;   // multiview: only the big window takes the sound
        await this.applyAudioCommands(this.audio.onPlayback(event.id, true, human));
      }
      // the tile with the sound, playing a title: its page's own player is not left self-muted - Peacock muted itself again as the big
      // window a restart brought back (B-292, 2026-09-23). Once per title (a mute the person makes later on the page stands).
      if (face?.playing === true && this.audio.focusedMedia === event.id && this.video.isVideoTile(event.id)) {
        const key = (face.video && typeof face.video === "object" ? (face.video as { url?: string }).url : undefined) ?? this.currentUrl.get(event.id) ?? "";
        if (this.unmutedFor.get(event.id) !== key) { this.unmutedFor.set(event.id, key); await this.drivers.surface.inject(event.id, null, UNMUTE_PLAYER_JS); }
      }
      await this.drivers.surface.setNowPlaying?.(event.id, face);
      await this.onMusicObservation(event.id, event.info);
      this.video.onObservation(event.id, event.info);   // VP-2: a video tile's face (video.ts) - nothing here touches the music model
      this.noteVideoUp(event.id);
      this.noteSeriesUp(event.id);
      return;
    }
    if (event.type === "fullscreen-element") {
      // §26: the shell auto-granted element fullscreen; presentation keeping reads the state from here
      if (event.contains) this.elementFullscreen.add(event.id); else this.elementFullscreen.delete(event.id);
      await this.feedKeeper(event.id, { type: "presentation", at: Date.now(), state: event.contains ? "fullscreen" : "none" });
      // a pause from the wall must not take the picture out of its window: Paramount+ leaves its player's fullscreen for its own pause
      // screen (2026-09-23, "When I did the global pause it lost its fullscreen focus") - the player goes back, once, while it stays paused
      const pausedAt = this.wallPausedAt.get(event.id) ?? 0;
      if (!event.contains && Date.now() - pausedAt < Orchestrator.PAUSE_KEEPS_STAGE_MS) {
        this.wallPausedAt.delete(event.id);
        const id = event.id;
        setTimeout(() => { if (!this.elementFullscreen.has(id)) this.videoEnterStage(id); }, 600);
      }
      return;
    }
    if (event.type === "popup") {
      // §30 a child surface under an opener: tracked so the Control Center / remote see it; it runs the full engine
      if (event.open) this.popups.set(event.id, { opener: event.opener, ...(event.url ? { url: event.url } : {}) });
      else this.popups.delete(event.id);
      return;
    }
    if (!this.tile(event.id) && event.id.includes("#popup-")) return;   // a popup surface's own events: engine-covered, nothing to orchestrate
    if (this.previews.has(event.id)) { await this.onPreviewEvent(event); return; }   // B-41 preview surfaces live outside the wall
    if (this.lookups.has(event.id)) { await this.onLookupEvent(event); return; }     // cross-service search surfaces: hidden, never revealed
    if (event.type === "playback" && this.lifecycle.isPeeking(event.id)) {
      // §25: a peeking tile is muted and transient — it never enters the
      // audio-focus machinery, never counts as recency, never holds a
      // decode slot.
      return;
    }
    if (event.type === "navigated") {
      await this.injectAdapter(event.id, { includeCss: false }); // SPA — CSS survives
      const focus = this.tile(event.id)?.focus;
      if (focus && !this.mvSmall.has(event.id)) {
        // Re-frame after SPA moves; result is informational here (§17 —
        // repeated misses surface in edit mode, a later milestone).
        await this.drivers.surface.inject(event.id, null, focusFramingJs(focus));
      }
    }
    if (event.type === "focus-result") {
      this.focusWaits.get(event.id)?.(event.found);
      if (!event.found) await this.recordCompat("adapter-selector-missing", event.id);
    }
    if (event.type === "load-finished" && event.ok && event.id.startsWith("ambient:")) {
      // B-152: the soundscape starts from an injected call (gesture-privileged) - the page's own start at load was left suspended
      for (const amb of this.ambient.values()) if (amb.surface === event.id && amb.active) void this.drivers.surface.inject(event.id, null, `window.__prismSoundscape&&window.__prismSoundscape.play(${JSON.stringify(amb.sound)})`);
    }
    if (event.type === "load-finished" && !event.ok) {
      await this.recordCompat("tile-render-failure", event.id);
    }
    if (event.type === "ad-break") {
      // The boot-hold protects CONTENT ("start paused" - nothing missed).
      // A break is not content: release OUR OWN pause so the veiled break
      // passes on its own, and re-arm at break end so content pauses right
      // where it truly starts. Resuming a pause WE injected is restoring
      // page state under the human's standing start-paused instruction -
      // never synthetic engagement with the page's own controls.
      if (event.active && this.bootHeld.has(event.id)) {
        await this.drivers.surface.inject(event.id, null,
          "document.querySelectorAll('video,audio').forEach(function(m){try{m.play()}catch(e){}})");
      }
      // B-142 (2026-09-08): the re-arm is for a tile still under the hold - one a human has played (Pandora, on the wall
      // all morning) must not have its first song after every break paused ("it immediately paused the song when it started")
      if (!event.active && this.bootHeld.has(event.id) && !this.humanPlayed.has(event.id)) {
        this.bootPaused.add(event.id);      // next playing = content -> hold again
      }
      if (event.active) this.adActive.add(event.id); else { this.adActive.delete(event.id); this.adInfo.delete(event.id); }
      const adSpec = this.tile(event.id)?.adapter ? this.adapters.get(this.tile(event.id)!.adapter!) : undefined;
      this.intermission.onAdBreak(event.id, event.active, adSpec?.adSignalSustainedMs ?? 0); // §26; the adapter's own sustain counts toward the window
      await this.feedKeeper(event.id, { type: "ad-break", at: Date.now(), active: event.active }); // §26 keeping: the boundary signal
    }
    if (event.type === "skip-available") {
      this.intermission.onSkipAvailable(event.id, event.available, event.target); // §26 observation only
    }
    if (event.type === "ad-info") {
      // presentation only: the card mirrors the page's own break clock (§26). The count ("2 of 3" - Spotify's ad subtitle,
      // 2026-09-15) sticks for the break through a tick that lost it, so the wall can say why its clock starts over
      // (three 30 s ads read as one stuck clock); it clears with the break (ad-break false)
      const count = event.count || this.adInfo.get(event.id)?.count || "";
      const remaining = event.remaining ?? -1;
      if (count || remaining >= 0) this.adInfo.set(event.id, { count, remaining }); else this.adInfo.delete(event.id);
      await this.drivers.surface.setAdInfo?.(event.id, count, remaining);
      await this.watchAdClock(event.id, remaining);
    }
    // §26 for native apps: package → launch tile, then the same controller.
    if (event.type === "app-foreground") {
      this.foregroundApp = event.package || null;
    }
    if (event.type === "app-ad-break") {
      const tileId = this.launchTileFor(event.package);
      if (tileId) this.intermission.onAdBreak(tileId, event.active);
    }
    if (event.type === "app-skip-available") {
      const tileId = this.launchTileFor(event.package);
      if (!tileId) return;
      if (event.available && event.target) this.appSkipTargets.set(tileId, event.target);
      else this.appSkipTargets.delete(tileId);
      this.intermission.onSkipAvailable(tileId, event.available, event.target);
    }
    if (event.type === "listener-lost") {
      await this.listening.onListenerLost(event.listener); // §14 peer-drop grace
    }
    if (event.type === "intermission-skip") {
      await this.tileCommand(event.id, "skip"); // §26 a human tapped the chip
    }
    if (event.type === "interaction") {
      await this.lifecycle.touch(event.id); // recency; revives warm tiles
      // §12: tapping a launch tile opens the native app fullscreen.
      const tile = this.tile(event.id);
      if (tile?.launch && this.drivers.media) {
        await this.drivers.media.launch(tile.launch.package, tile.launch.deepLink);
      }
    }
    if (event.type === "playback") this.video.notePlayback(event.id, !!event.playing);   // the wall's play / pause toggle reads it at once
    if (event.type === "playback" && event.playing) {
      await this.lifecycle.touch(event.id);
      await this.enforceDecodeCap(event.id);
    }
    if (event.type === "playback" && !event.playing) {
      this.playingVideo = this.playingVideo.filter((id) => id !== event.id);
    }
    if (event.type === "playback" && event.playing && this.bootPaused.has(event.id) && this.adActive.has(event.id)) {
      // The first thing to play was an AD (the break began before the hold
      // could land). Holding it would freeze the ad under the veil until the
      // veil's safety cap dropped and left a paused ad on the wall (YouTube,
      // reported 2026-09-01). Let the break run; the hold stays armed for the
      // content that follows it.
      return;
    }
    // B-126: a play a human just asked for (the Play button, a quick-play pick) is not the page auto-playing its
    // watch page - the boot hold does not apply; the arm below makes it the audio owner as any tap would
    if (event.type === "playback" && event.playing && this.bootPaused.has(event.id) && this.lastInteract.has(event.id)) this.bootPaused.delete(event.id);
    if (event.type === "playback" && event.playing && this.bootPaused.delete(event.id)) {
      this.bootHeld.add(event.id);
      // Resume-last-location boots PAUSED: the service auto-plays its watch
      // page; the slot holds it until the human plays it themselves (their
      // first interaction in the tile clears the hold below). One shot, and
      // this synthetic autoplay never grabs audio focus.
      // The hold must announce itself: a frozen first frame (often an ad's
      // opening seconds) read as breakage (reported twice, 2026-08-31). The
      // chip removes itself on the first play or after 20s.
      await this.drivers.surface.inject(event.id, null, "document.querySelectorAll('video,audio').forEach(function(m){m.pause()});(function(){if(document.getElementById('__prism-hold'))return;var b=document.createElement('div');b.id='__prism-hold';b.textContent='⏸ Held paused by Prism '+String.fromCharCode(183)+' press play when ready';b.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:rgba(18,19,26,.92);color:#F2F4F7;font:600 13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:10px;border:1px solid rgba(240,168,60,.5);pointer-events:none';document.documentElement.appendChild(b);var done=function(){try{b.remove()}catch(e){}};window.addEventListener('playing',done,true);setTimeout(done,20000);})();");
      return;
    }
    if (event.type === "interaction") {
      this.bootPaused.delete(event.id);
      this.bootHeld.delete(event.id);
      this.humanPlayed.add(event.id);
      this.lastInteract.set(event.id, Date.now());
      this.pageTouchedAt.set(event.id, Date.now());
      await this.feedKeeper(event.id, { type: "user-input", at: Date.now() }); // §26 keeping: a drop after this is the human's
    }
    if (event.type === "playback" && event.ended === true) {
      await this.feedKeeper(event.id, { type: "ended", at: Date.now() }); // §26 onEnd / a drop at video end is site-initiated
    }
    if (event.type === "playback") {
      // a pause the wall was asked for holds: Hulu's player opened a new stream and played again ten seconds into a pause (2026-09-23,
      // "the middle mini window paused and then unpaused") - once, within a minute, never in an ad, never after a Play from the wall
      const held = this.pauseHeld.get(event.id);
      if (event.playing && held !== undefined) {
        this.pauseHeld.delete(event.id);
        if (Date.now() - held < Orchestrator.PAUSE_HOLD_MS && !this.video.inAd(event.id)) { this.rePausing = true; try { await this.tileCommand(event.id, "pause"); } finally { this.rePausing = false; } this.pauseHeld.delete(event.id); }
      }
      // §3 rule 5 human attribution. An interaction ARMS this tile; the next
      // playback report CONSUMES the arm. Anything with no arm is autoplay and
      // stays muted, which is the rule's whole point.
      //
      // This was a 7-second window, which is far too short for a music service:
      // click play -> account check -> DRM licence -> buffer, and the playback
      // report lands ten seconds later. Observed on the wall 2026-09-04 - a
      // deliberate press at 10:48:18, playback at 10:48:27.884, 9.7s later, so
      // the press was read as autoplay and an exclusive source played MUTED with
      // no way to notice except that the wall was silent. Arming until consumed
      // keeps a human's press a human's press while the service does its work;
      // HUMAN_INTENT_MS bounds a stale arm so walking away still means silence.
      // B-132: every playback signal asks the page for a fresh report - the face must not wait on a reporter that went quiet
      if (this.music.source(event.id)) void this.drivers.surface.inject(event.id, null, "window.__prismReportNow && window.__prismReportNow()");
      const armedAt = this.lastInteract.get(event.id) ?? 0;
      let human = armedAt > 0 && Date.now() - armedAt < HUMAN_INTENT_MS;
      if (human && event.playing) this.lastInteract.delete(event.id);   // consumed
      if (!human && event.playing && this.stageSourceUnowned(event.id)) human = true;   // B-165: the stage's music takes the audio when nobody has it
      if (human && this.mvKeepsAudio(event.id)) human = false;   // multiview: only the big window takes the sound
      await this.applyAudioCommands(this.audio.onPlayback(event.id, event.playing, human));
    }
  }

  /** Raw key events from the shell (§7 input mapping; §11 per-device). */
  async onInput(event: InputEvent): Promise<void> {
    // §7/§11: per-device override → dashboard map → shipped default.
    const binding = resolveBinding(this.doc?.inputs, event.key, event.device);
    // §24: any key snoozes an active alarm (dismiss goes via remote/binding).
    if (this.alarm.status !== "idle") {
      if (binding && "action" in binding && binding.action === "alarm-dismiss") {
        this.dismissAlarm();
      } else {
        this.snoozeAlarm();
      }
      return;
    }
    // §24/§11: a remote's first keypress wakes a low-power frame, then acts normally.
    if (this.lowPower) await this.wakeUp();
    // §7 page input mode: the entered tile's page receives the remote.
    // Back leaves; a HUMAN's keys are forwarded as real platform events.
    if (this.entered) {
      if (event.key === "KEYCODE_BACK" || event.key === "BACK" || event.key === "ESCAPE") {
        // Back inside a page is the page's own Back first (the wrong show → the
        // row you came from). With nothing left to go back to: out of the page,
        // and on the wall layout back to the wall.
        if (this.drivers.surface.goBack && (await this.drivers.surface.goBack(this.entered))) return;
        await this.leaveTile();
        await this.exitFullscreen();
        return;
      }
      // Media keys still act on the frame's own policy (play/pause of the tile).
      if (binding && "tile" in binding && binding.tile === "focusedMedia" && this.audio.focusedMedia !== this.entered) {
        // fall through to normal handling
      } else {
        await this.pageKey(this.entered, event.key);
        return;
      }
    }
    if (this.fullscreen && (event.key === "KEYCODE_BACK" || event.key === "BACK" || event.key === "ESCAPE")) {
      await this.exitFullscreen();
      return;
    }
    if (this.isSolo() && !this.entered) {
      const k = pageKeyName(event.key);
      if (k === "DPAD_LEFT") { await this.soloStep(-1); return; }
      if (k === "DPAD_RIGHT") { await this.soloStep(1); return; }
      if (k === "DPAD_UP" || k === "DPAD_DOWN") return; // nothing above or below one app
    }
    if (!binding) return;
    if ("tile" in binding) {
      const target =
        binding.tile === "focusedMedia" ? this.audio.focusedMedia : binding.tile;
      if (!target) return;
      const cmd =
        binding.cmd === "play-pause"
          ? this.audio.isPlaying(target)
            ? "pause"
            : "play"
          : binding.cmd;
      await this.tileCommand(target, cmd); // same path as the §6 remote
    } else if (binding.action === "layout" && typeof binding.value === "string") {
      await this.switchTo(binding.value);
    } else if (binding.action === "carousel-next") {
      await this.carouselStep(1);
    } else if (binding.action === "carousel-prev") {
      await this.carouselStep(-1);
    } else if (binding.action === "intermission-skip") {
      // §26: the human pressed ✓ — forward to the covered player's own skip.
      const target = this.intermission.skipTarget();
      if (target) await this.tileCommand(target, "skip");
    } else if (binding.action === "focus" && typeof binding.value === "string") {
      await this.moveFocus(binding.value as FocusDirection);
    } else if (binding.action === "activate") {
      await this.activateFocused();
    } else if (binding.action === "context-sheet") {
      // §6a remote-hold: the focused item's context sheet (a deep link the shell's router opens)
      if (this.focused) await this.drivers.ui?.route(routes.itemSheet(this.focused), "remote-hold", this.focused);
    } else if (binding.action === "wake") {
      await this.wakeUp();
    } else if (binding.action === "sleep") {
      await this.drivers.display?.setPower("sleep");
    } else if (binding.action === "dim" && typeof binding.value === "number") {
      await this.drivers.display?.setBrightness(Math.min(1, Math.max(0, binding.value)));
    }
  }

  tile(id: string): TileSpec | undefined {
    return this.doc?.tiles.find((t) => t.id === id);
  }

  /** The launch tile that opens `pkg`, if this dashboard has one (§12 × §26). */
  private launchTileFor(pkg: string): string | null {
    return this.doc?.tiles.find((t) => t.launch?.package === pkg)?.id ?? null;
  }

  /* ---------------------------- §12 d-pad focus --------------------------- */

  /** Move the focus ring spatially over the solved layout. */
  async moveFocus(direction: FocusDirection): Promise<string | null> {
    const next = nextTileInDirection(this.rects(), this.focused, direction);
    await this.setFocus(next);
    return next;
  }

  async setFocus(id: string | null): Promise<void> {
    if (id !== null && !this.tile(id)) return;
    if (this.focused === id) return;
    if (this.focused) await this.drivers.surface.setFocused?.(this.focused, false);
    this.focused = id;
    if (id) await this.drivers.surface.setFocused?.(id, true);
  }

  /**
   * §7 enter a tile: its page receives the remote (d-pad, OK, text) until
   * Back. This is how a TV remote signs in, picks a title, or plays a video
   * inside a web tile — every key forwarded is a human's.
   */
  async enterTile(id: string): Promise<boolean> {
    const tile = this.tile(id);
    if (!tile || tile.launch || !this.surfaces.has(id)) return false;
    if (this.entered && this.entered !== id) await this.drivers.surface.setPageInput?.(this.entered, false);
    this.entered = id;
    await this.setFocus(id);
    await this.lifecycle.touch(id); // interacting: revive if warm, refresh recency
    await this.drivers.surface.setPageInput?.(id, true);
    return true;
  }

  async leaveTile(): Promise<void> {
    if (!this.entered) return;
    const id = this.entered;
    this.entered = null;
    await this.drivers.surface.setPageInput?.(id, false);
  }

  /** Forward a human's key into a tile's page (phone d-pad / TV remote in page mode). */
  async sendKeyToTile(id: string, key: string): Promise<boolean> {
    if (!this.tile(id) || !this.surfaces.has(id) || !this.drivers.surface.sendKey) return false;
    await this.pageKey(id, key);
    return true;
  }

  /**
   * One human key into a page. Arrows are spatial navigation (a page does not
   * move focus on arrows by itself); OK activates the outlined element; when a
   * text field holds focus, arrows and OK go to it as real key events so
   * typing and caret movement work. Everything else is the real key event.
   */
  private async pageKey(id: string, key: string): Promise<void> {
    const k = pageKeyName(key);
    const ev = this.drivers.surface.evaluate;
    const dir = k === "DPAD_LEFT" ? "left" : k === "DPAD_RIGHT" ? "right" : k === "DPAD_UP" ? "up" : k === "DPAD_DOWN" ? "down" : null;
    if (ev && (dir || k === "DPAD_CENTER" || k === "ENTER")) {
      const inField = await ev(id, `(function(){var a=document.activeElement;return !!a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.isContentEditable);})()`);
      const typing = (inField as unknown) === true || inField === "true";
      if (!typing) {
        if (dir) {
          const r = await ev(id, spatialNavJs(dir));
          if ((r as unknown) === "edge" || r === "\"edge\"") await this.drivers.surface.sendKey?.(id, k); // let the page scroll
          return;
        }
        const r = await ev(id, activateFocusedElementJs());
        if ((r as unknown) === "none" || r === "\"none\"") await this.drivers.surface.sendKey?.(id, k);
        return;
      }
    }
    await this.drivers.surface.sendKey?.(id, k);
  }

  /**
   * Forward human-typed text into a tile's page. `field` names which input
   * the human means (email/text, password, or whatever is focused); core
   * gives that input focus first — the human chose the field by choosing
   * the button — then the shell delivers the keystrokes.
   */
  /** Which sign-in fields the page shows right now — the phone walks the same step the TV is on. */
  async visibleFields(id: string): Promise<{ email: number; password: number; code: number }> {
    const none = { email: 0, password: 0, code: 0 };
    const ev = this.drivers.surface.evaluate;
    if (!ev || !this.surfaces.has(id)) return none;
    try {
      const r = await ev(id, probeFieldsJs());
      const parsed: unknown = typeof r === "string" ? JSON.parse(r) : r;
      const obj = (typeof parsed === "string" ? JSON.parse(parsed) : parsed) as Record<string, unknown>;
      const n = (v: unknown): number => (typeof v === "number" ? v : 0);
      return { email: n(obj["email"]), password: n(obj["password"]), code: n(obj["code"]) };
    } catch {
      return none;
    }
  }

  async typeIntoTile(
    id: string,
    text: string,
    field: FieldKind = "any",
    submit = false,
  ): Promise<"ok" | "no-field" | "unsupported"> {
    if (!this.tile(id) || !this.surfaces.has(id) || !this.drivers.surface.typeText) return "unsupported";
    if (this.entered !== id) await this.enterTile(id);
    {
      // The page may still be loading (first visit, slow site): wait for the
      // field to exist and take focus before typing — up to ~12s — rather
      // than typing into nothing. Free text ("any") waits briefly: it keeps
      // whatever the page already has focused, else the first text field.
      // No evaluate hook ⇒ best effort, as before.
      const ev = this.drivers.surface.evaluate;
      if (ev) {
        // Consent first: a visible Agree/Accept means the page is asking the
        // human something before any typing — hand it back, type nothing.
        if ((await this.parseList(await ev(id, consentGateJs()))).length) return "no-field";
        let ok = false;
        const attempts = Math.max(1, Math.ceil(Math.min(this.fieldWaitMs, field === "any" ? 3_000 : this.fieldWaitMs) / 500));
        for (let i = 0; i < attempts && !ok; i += 1) {
          const r = await ev(id, focusFieldJs(field));
          // The shell hands back the JS result already JSON-parsed (boolean) on
          // Android; other shells may return the raw string. Accept both.
          ok = (r as unknown) === true || r === "true" || r === "\"true\"";
          if (!ok) await new Promise((res) => setTimeout(res, 500));
        }
        if (!ok) return "no-field";
      } else {
        await this.drivers.surface.inject(id, null, focusFieldJs(field));
      }
    }
    if (text === "" && field !== "any") {
      // "Start over" on the phone: the human asked for the field emptied
      // (sites pre-fill the last address from their own cookie). Nothing is
      // typed or submitted.
      await this.drivers.surface.inject(id, null, clearFieldJs());
      return "ok";
    }
    await this.drivers.surface.typeText(id, text);
    // Key events are asynchronous and some characters take a different path:
    // verify the field holds the human's text and repair it before submitting.
    await new Promise((r) => setTimeout(r, 350));
    await this.drivers.surface.inject(id, null, ensureValueJs(text));
    if (submit) {
      // The human pressed "Send": press the page's own Continue/Next/Sign-in
      // for them (forwarded human input, §26 boundary) — Enter first, then the
      // step's button when the site does not submit on Enter.
      await this.drivers.surface.sendKey?.(id, "ENTER");
      await this.drivers.surface.inject(id, null, submitStepJs());
    }
    return "ok";
  }

  /**
   * What the page is offering instead of a field — consent gates ("Agree"),
   * a "Sign In" that opens the form, a "Continue" between steps. Read-only;
   * the phone shows them so the human can choose.
   */
  async visibleButtons(id: string): Promise<string[]> {
    const ev = this.drivers.surface.evaluate;
    if (!ev || !this.surfaces.has(id)) return [];
    // Consent buttons lead so the phone shows them first.
    const gate = await this.parseList(await ev(id, consentGateJs()));
    const rest = (await this.parseList(await ev(id, visibleButtonsJs()))).filter((b) => !gate.includes(b));
    return gate.concat(rest);
  }

  /** A JSON array of strings as the shell hands it back (raw, or already parsed once). */
  private async parseList(r: string | null): Promise<string[]> {
    try {
      const parsed: unknown = typeof r === "string" ? JSON.parse(r) : r;
      const arr: unknown = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  /**
   * The human tapped a page button on their phone: press exactly that one.
   * §26 boundary — a forwarded human gesture, never something core decides.
   */
  async pressButton(id: string, label: string): Promise<"ok" | "none" | "unsupported"> {
    const ev = this.drivers.surface.evaluate;
    if (!ev || !this.tile(id) || !this.surfaces.has(id)) return "unsupported";
    if (this.entered !== id) await this.enterTile(id);
    const r = await ev(id, pressButtonJs(label));
    return (r as unknown) === true || r === "true" || r === "\"true\"" ? "ok" : "none";
  }

  /**
   * Select on the TV remote. Priority: a HUMAN pass-through skip while an
   * ad's affordance is observed (§26); otherwise activate the focused tile —
   * a launch tile opens its app fullscreen (§12), a web tile is ENTERED so
   * its page gets the remote (Back leaves). Hero promotion is a phone
   * action. Nothing here is ever triggered without a keypress.
   */
  async activateFocused(): Promise<"skip" | "launch" | "enter" | "none"> {
    const skipTarget = this.intermission.skipTarget();
    if (skipTarget && (await this.tileCommand(skipTarget, "skip")) === "ok") return "skip";
    if (!this.focused) {
      const first = Object.keys(this.rects())[0] ?? null;
      await this.setFocus(first);
      return "none";
    }
    const tile = this.tile(this.focused);
    if (!tile) return "none";
    if (tile.launch) {
      await this.tileCommand(tile.id, "launch");
      return "launch";
    }
    // OK on a web tile: it takes the screen (§2 fullscreen) and its page gets
    // the remote; one Back returns to the wall.
    const full = await this.enterFullscreen(tile.id);
    if (await this.enterTile(tile.id)) return "enter";
    return full ? "enter" : "none";
  }

  /** §2 fullscreen: the tile covers the viewport above the others, which keep their rects (and playback per policy) beneath. */
  async enterFullscreen(id: string): Promise<boolean> {
    if (!this.tile(id) || !this.surfaces.has(id) || this.tile(id)!.launch) return false;
    if (this.fullscreen && this.fullscreen !== id) await this.drivers.surface.setZ(this.fullscreen, 0);
    this.fullscreen = id;
    await this.drivers.surface.setZ(id, 40);
    await this.applyLayout();
    if (this.isSolo()) {
      // ONE live app: every other tile is released (§18 warm — renderer gone,
      // session kept, no refresh cadence, nothing updating in the background)
      // and hidden; the shown one revives behind its last pixels if it was warm.
      const show = this.drivers.surface.setVisible;
      if (show) {
        await show(id, true);
        for (const t of this.doc!.tiles) if (t.id !== id && this.surfaces.has(t.id)) await show(t.id, false);
      }
      await this.lifecycle.soloKeep(id);
      await this.setFocus(id);
      if (this.override.solo !== id) {
        this.override = { ...this.override, solo: id };
        await this.persistLayout();
      }
    }
    return true;
  }

  private isSolo(): boolean {
    return this.doc?.layout?.mode === "solo";
  }

  /** Solo layout: ◀ ▶ picks the previous/next app (wraps). Nothing else moves. */
  async soloStep(direction: 1 | -1): Promise<string | null> {
    if (!this.doc || !this.isSolo()) return null;
    const ids = this.doc.tiles.filter((t) => !t.launch).map((t) => t.id);
    if (!ids.length) return null;
    const at = Math.max(0, ids.indexOf(this.fullscreen ?? ""));
    const next = ids[(at + direction + ids.length) % ids.length]!;
    await this.leaveTile();
    await this.enterFullscreen(next);
    return next;
  }

  async exitFullscreen(): Promise<void> {
    if (this.isSolo()) return; // one app is always on screen here; Back leaves the page, not the app
    const id = this.fullscreen;
    if (!id) return;
    this.fullscreen = null;
    if (this.surfaces.has(id)) await this.drivers.surface.setZ(id, 0);
    await this.applyLayout(); // the solved layout, unchanged
  }

  private async applyLayout(): Promise<void> {
    if (!this.doc) return;
    const gap = this.doc.layout?.mode === "hero" ? this.doc.layout.gap : this.doc.grid?.gap ?? 8;
    const rects = insetRects(this.rects(), gap ?? 8);
    // §32 floating facets: placed from their own fractions, above the wall,
    // below a fullscreen takeover; the shell is told which chrome to wear.
    // rects() itself stays the wall partition (conformance).
    for (const t of this.doc.tiles) {
      if (t.kind !== "floating" || !this.surfaces.has(t.id)) continue;
      const f = clampFloat(t.float);
      // B-173 (2026-09-08): a HIDDEN page is laid out at the size its window reveal shows it - a desktop layout, so the
      // service renders the player it renders for anyone. At the float panel's fractions (36% x 20% of the wall) Spotify
      // drew its phone layout: no sidebar, so no Your Library, so Quick play had nothing to list. Parked off-canvas either
      // way (win-host-spec section 5); the window reveal is then a move and a fade with no reflow (section 16).
      // B-196 (2026-09-09): a REVEALED player stays revealed through a re-apply (a window resize re-runs this) - at its
      // reveal rect for the new viewport, above floating, chrome as a page, not parked. Before, the resize parked the page
      // off-canvas as hidden again and left the shell's window bar pointing at nothing ("the config window is lost").
      const reveal = this.music.revealed();
      const revealedHere = f.hidden && reveal.facet === t.id;
      rects[t.id] = revealedHere
        ? (reveal.mode === "hero" ? this.heroRevealRect() : reveal.mode === "window" ? this.windowRevealRect() : this.panelRevealRect(t.id))
        : f.hidden ? this.windowRevealRect() : {
        x: Math.round(f.x * this.viewport.w),
        y: Math.round(f.y * this.viewport.h),
        w: Math.round(f.w * this.viewport.w),
        h: Math.round(f.h * this.viewport.h),
      };
      this.floating.add(t.id);
      // Popped out - fullscreen or the configure viewfinder (§31 step 3): the page,
      // bare and on top. No bar, no control face over it, hidden or not; the
      // floating chrome and place return when it comes back down.
      const popped = this.fullscreen === t.id || this.framing?.id === t.id;
      await this.drivers.surface.setZ(t.id, popped ? 40 : revealedHere ? 35 : 30);
      await this.drivers.surface.setChrome?.(t.id, popped ? "slot" : "floating", popped || revealedHere ? "page" : f.face ?? "control", popped || revealedHere ? false : !!f.hidden);
    }
    for (const id of [...this.floating]) {
      if (this.tile(id)?.kind === "floating" && this.surfaces.has(id)) continue;
      this.floating.delete(id);                                    // docked back (or gone): a wall slot again
      if (this.surfaces.has(id)) { await this.drivers.surface.setZ(id, 0); await this.drivers.surface.setChrome?.(id, "slot", "page", false); }
    }
    // multiview (2026-09-23): the Video player's windows by role - the big one in the screen slot's place, the rest stacked down its right
    // edge above it. Only places and layers change: a swap moves live pages, it never reloads one.
    const smallNow = new Set<string>();
    if (this.mv.on && this.mv.slot && rects[this.mv.slot]) {
      const base = rects[this.mv.slot]!;
      const live = this.mv.order.filter((id) => this.tile(id) && this.surfaces.has(id));
      for (const id of live.slice(1)) smallNow.add(id);
      const places = mvLayout(base, this.mv.collapsed ? 0 : live.length - 1);   // hidden small windows: the big one has the whole slot
      for (let i = 0; i < live.length; i++) {
        const id = live[i]!;
        if (i === 0) {
          rects[id] = { ...places.hero };
          await this.drivers.surface.setZ(id, 0);
          await this.drivers.surface.setChrome?.(id, "slot", "page", false);
        } else {
          const pip = places.smalls[i - 1] ?? mvPipRect(base, i - 1);
          rects[id] = this.mv.collapsed ? { x: -(pip.w + 64), y: 0, w: pip.w, h: pip.h } : pip;   // hidden: parked off the wall's left edge, page kept
          await this.drivers.surface.setZ(id, 30 + i);
          await this.drivers.surface.setChrome?.(id, "floating", "page", false);
        }
      }
      // the screen slot dragged out of multiview (2026-09-23): parked off the wall's left edge, paused once as it leaves; its page is kept
      const slot = this.mv.slot;
      if (!live.includes(slot) && this.surfaces.has(slot)) {
        rects[slot] = { x: -(base.w + 64), y: 0, w: base.w, h: base.h };
        if (!this.mvParked) { this.mvParked = true; if (this.video.state([slot])[0]?.playing) await this.tileCommand(slot, "pause"); }
      } else this.mvParked = false;
    } else this.mvParked = false;
    // a small window shows its WHOLE page, scaled: its facet's framing (a crop and a fixed page size cut for the big screen) is set aside
    // while it is small - Hulu's showed a zoomed-in corner of its page (2026-09-23) - and put back when it is big again
    for (const id of smallNow) if (!this.mvSmall.has(id)) await this.drivers.surface.inject(id, null, CLEAR_FRAMING_JS);
    for (const id of this.mvSmall) if (!smallNow.has(id) && this.surfaces.has(id)) { const t = this.tile(id); if (t?.focus) await this.drivers.surface.inject(id, null, focusFramingJs(t.focus)); }
    this.mvSmall = smallNow;
    for (const [id, rect] of Object.entries(rects)) {
      if (!this.surfaces.has(id)) continue;
      const device = id === this.fullscreen ? { x: 0, y: 0, w: this.viewport.w, h: this.viewport.h } : rect;
      await this.drivers.surface.setRect(id, device);
      if (smallNow.has(id)) { await this.drivers.surface.setViewport?.(id, 0, 0); continue; }   // the page at the window's own size
      // a zoomed page's layout viewport follows its rect (rect/zoom)
      const t = this.tile(id);
      if (t && (t.focus?.viewport || (t.zoom !== undefined && t.zoom !== 1))) await this.applyViewport(id, device);
    }
  }

  private layoutKey(dashId: string): string {
    return `layout:${dashId}`;
  }

  // ---- resume last location: the frame is furniture — closing it is a TV
  // turning off, not the streaming box resetting. The shell reports each
  // navigation's URL; it persists per tile (same registrable domain only, so
  // a stray navigation never redefines the tile) and boot loads it instead
  // of the tile's home URL. Local store only (§22).
  /** Tiles booted onto a RESUMED url: held paused until the human engages. */
  private bootPaused = new Set<string>();
  /** §32 tiles currently placed as floating facets (z raised, floating chrome). */
  private floating = new Set<string>();
  /** §32 what each tile's page says is playing; absent = nothing / unknown. */
  /**
   * Placement setting `onActivate: "play"` (docs/concept-scenes.md §2.5): once
   * this tile has loaded under the CURRENT document, run the page's own
   * registered play handler - the same function the OS media keys call and the
   * same one §32 transport pass-through uses. It is what makes "pick the scene
   * and it plays" true for a Music Lounge.
   *
   * Fires at most ONCE per tile per document. `activatedOnce` is cleared when a
   * new document is applied, so re-applying a scene plays again but a reload,
   * an SPA navigation or a second load-finished for the same document does not
   * - a wall that pressed play every time a page settled would fight the human
   * who just paused it.
   *
   * Absent on every existing scene, so this changes no wall until it is set.
   */
  private async runOnActivate(tileId: string): Promise<void> {
    const tile = this.tile(tileId);
    if (tile?.onActivate !== "play") return;
    if (this.activatedOnce.has(tileId)) return;
    // 2026-09-16: a music source the scene does not draw does not play itself. With the stage on Spotify, Apple's hidden
    // placement carried onActivate and resumed Vibes on every boot, armed as if a person had pressed it; it took the audio
    // and the stage followed it ("eventually it auto switched to Vibes"). The stage's own source may start; for any other
    // service a person's Play is the way in (B-204's face names what that Play resumes).
    // (a hidden floating placement is a music source whether or not its page has reported yet - the music state registers a
    // source on its first face, which is after load-finished, so the doc's own shape is what this reads)
    const hiddenPlacement = tile.kind === "floating" && tile.float?.hidden === true;
    const drawn = (this.doc?.tiles ?? []).some((v) => v.visualization?.source === tileId);
    if ((hiddenPlacement || this.music.source(tileId)) && !drawn) return;
    this.activatedOnce.add(tileId);
    try { await this.tileCommand(tileId, "play"); } catch { /* a page that will not play is not an error */ }
  }

  /** Tiles whose onActivate has already run for the current document. */
  private activatedOnce = new Set<string>();

  private nowPlaying = new Map<string, NowPlaying>();
  /** §26 the page's break progress (frame.adInfo) per covered tile - the count sticks for the break, cleared with it. */
  private adInfo = new Map<string, { count: string; remaining: number }>();
  /** Each surface's current page, from its navigated events - what a resume point records. */
  private currentUrl = new Map<string, string>();
  /** Tiles that should press their page's Play control once the page they were sent to has loaded (resumeMusic). */
  private pendingResumePlay = new Map<string, number>();
  private resumeKey(dashId: string, tileId: string): string { return `music:resume:${dashId}:${tileId}`; }
  /** B-204 (2026-09-15): each music tile's resume point, in memory - the wall row says what Play would resume while nothing is loaded. */
  private resumeCache = new Map<string, { url: string; title: string; artist?: string; album?: string; label?: string; kind?: string; id?: string; at: number }>();
  private async primeResumePoints(doc: DashboardDocument): Promise<void> {
    this.resumeCache.clear();
    if (!this.drivers.store) return;
    this.musicOrder.clear();
    this.musicRepeat.clear();
    for (const t of doc.tiles) {
      if (!t.adapter) continue;
      await this.loadMusicOrder(t.id);
      await this.loadMusicRepeat(t.id);
      const p = await this.resumePoint(t.id);
      if (p) this.resumeCache.set(t.id, p);
    }
  }
  private recentKey(dashId: string, tileId: string): string { return `music:recent:${dashId}:${tileId}`; }
  private libraryKey(dashId: string, tileId: string): string { return `music:library:${dashId}:${tileId}`; }
  private readonly libraryCache = new Map<string, { playlists: LibraryItem[]; stations: LibraryItem[] }>();
  /**
   * A quick-play pick between the tap and the page playing it. A big playlist takes MusicKit ten seconds
   * and more to queue, and a wall that shows nothing for ten seconds reads as broken (2026-09-07). Cleared
   * when the page reports that collection playing; marked failed when the page's musicPlay says so or
   * MUSIC_PICK_TIMEOUT_MS pass, and dropped a while after that so the note does not stay forever.
   */
  private readonly musicPending = new Map<string, { kind: string; id: string; name: string; at: number; url?: string; failed?: string; title?: string }>();
  /**
   * B-124 boot self-heal (2026-09-07): the very first engine a fresh browser process creates at boot came
   * up signed out on Apple Music every time, on any page, while the same surface recreated a minute
   * later signed in within seconds (same profile, cookies, storage). The cause is below Prism; the cure
   * is a fresh engine. So a tile whose session watch says signed-out inside the boot window is recycled
   * ONCE, and that first word is not trusted for the App's status - the recreated page speaks next.
   * A truly signed-out account costs one extra load and is then reported as it is.
   */
  private bootAt = 0;
  static readonly BOOT_SESSION_WINDOW_MS = 90_000;
  /** B-150: the wall's one mute switch, kept across restarts (section 10: never wiped). */
  static readonly PERSON_MUTED_KEY = "audio:wall-muted";
  private readonly bootRecycled = new Set<string>();
  /** Whether a session report is to be believed: false exactly when it is the boot-window signed-out that triggers the one recycle. */
  trustSessionReport(tileId: string, state: "signed-in" | "signed-out"): boolean {
    if (state !== "signed-out") return true;
    if (Date.now() - this.bootAt > Orchestrator.BOOT_SESSION_WINDOW_MS) return true;
    if (this.bootRecycled.has(tileId)) return true;
    const tile = this.tile(tileId);
    if (!tile || tile.visualization || tile.placeholder) return true;
    this.bootRecycled.add(tileId);
    void this.recycleAppSurfaces(tile.profile ?? tile.id);
    return false;
  }

  /** B-123: the session watch's last word per tile (cleared when the surface goes). */
  private readonly sessionState = new Map<string, "signed-in" | "signed-out">();
  sessionOf(tileId: string): "signed-in" | "signed-out" | undefined { return this.sessionState.get(tileId); }
  private setMusicPending(tileId: string, p: { kind: string; id: string; name: string; url?: string; title?: string }): void {
    const at = Date.now();
    this.musicPending.set(tileId, { ...p, at });
    setTimeout(() => { const q = this.musicPending.get(tileId); if (q && q.at === at && !q.failed) q.failed = "timeout"; }, Orchestrator.MUSIC_PICK_TIMEOUT_MS);
    setTimeout(() => { const q = this.musicPending.get(tileId); if (q && q.at === at) this.musicPending.delete(tileId); }, Orchestrator.MUSIC_PICK_TIMEOUT_MS + Orchestrator.MUSIC_PICK_FAILED_LINGER_MS);
  }
  /** How many collections quick play remembers per music tile (the maintainer's ask: five). */
  static readonly RECENT_MAX = 5;
  /** A quick-play pick the page has not started within this is shown as failed; the note lingers a while after. */
  static readonly MUSIC_PICK_TIMEOUT_MS = 30_000;
  static readonly MUSIC_PICK_FAILED_LINGER_MS = 15_000;
  /** Tiles whose adapter currently reports an ad break (known the instant it starts, before the veil rises). */
  private adActive = new Set<string>();

  /**
   * B-175 (2026-09-09): a break whose own clock has stopped is a stalled player - Spotify sat at 0:19 of 0:19 of
   * "Advertisement 1 of 3", "59s left in the break", for four hours. The page's own pause and then play, pressed once as a
   * person would, gets it moving; a second stall gets one more press; after that the wall leaves it alone. Never a skip:
   * the ad plays out. Only a clock the page shows counts (a service without one is never nudged).
   */
  private readonly adClock = new Map<string, { remaining: number; since: number; nudges: number }>();
  static readonly AD_STALL_MS = 45_000;
  private async watchAdClock(tileId: string, remaining: number): Promise<void> {
    if (!this.adActive.has(tileId) || remaining < 0) { this.adClock.delete(tileId); return; }
    const now = Date.now();
    const c = this.adClock.get(tileId);
    if (!c || c.remaining !== remaining) { this.adClock.set(tileId, { remaining, since: now, nudges: c?.nudges ?? 0 }); return; }
    if (now - c.since < Orchestrator.AD_STALL_MS) return;
    const tile = this.tile(tileId);
    const spec = tile?.adapter ? this.adapters.get(tile.adapter) : undefined;
    // a video service's break too (2026-09-25, South Park's pre-roll on Paramount+ stood at "36" for minutes after a restart, and the nudge
    // did nothing: it pressed only a music adapter's controls). Its own player's pause and play, the same once-as-a-person press; and when two
    // nudges have not moved it, the title is opened again, as the playback doctor heals ("lets make sure when we identify fixes we're
    // building auto-fixes" - the person's restart was the fix)
    const video = isVideoAdapter(spec);
    if (c.nudges >= 2) {
      if (video && c.nudges === 2 && this.video.healStall(tileId, "the ad stopped")) { c.nudges++; await this.drivers.surface.setAdInfo?.(tileId, "stalled, opening the title again", remaining); }
      return;
    }
    c.nudges++; c.since = now;
    const pause = spec?.controls?.pause, play = spec?.controls?.play;
    let js: string | null = null;
    if (pause && play) js = `(function(){var a=${clickControlJs(pause)};setTimeout(function(){${clickControlJs(play)}},600);return a;})()`;
    else if (video) {
      const p = this.video.cmdJs(spec, "pause"), q = this.video.cmdJs(spec, "play");
      if (p && q) js = `(function(){try{${p}}catch(e){}setTimeout(function(){try{${q}}catch(e){}},600);return true;})()`;
    }
    if (!js) return;
    await this.drivers.surface.setAdInfo?.(tileId, `stalled, nudged (${c.nudges})`, remaining);   // the card, and host.log, say so
    await this.drivers.surface.inject(tileId, null, js);
  }
  /** Last human interaction per tile - the audible-intent attribution window. */
  private lastInteract = new Map<string, number>();
  /** Tiles the boot-hold has paused and not yet released by the human. */
  private bootHeld = new Set<string>();

  private lastUrlKey(dashId: string, tileId: string): string {
    return `tile:lasturl:${dashId}:${tileId}`;
  }

  private rememberLocation(tileId: string, url: string | undefined): void {
    if (!url || !this.doc || !this.drivers.store) return;
    const tile = this.tile(tileId);
    if (!tile?.url || !sameRegistrableDomain(url, tile.url)) return;
    try { void this.drivers.store.set(this.lastUrlKey(this.doc.id, tileId), url); } catch { /* best effort */ }
  }

  private async resumeUrlFor(dashId: string, tile: TileSpec): Promise<string> {
    const home = tile.url!;
    if (!this.drivers.store) return home;
    // a video service comes back on its home page, never on a title's own watch address (2026-09-21): the page's player
    // autoplays there and the one-shot boot hold does not keep Hulu's paused - The Rookie ran silently, muted, on the
    // person's account after a restart. The wall's own Watch page is the way back to a title (Continue watching).
    if (tile.adapter && isVideoAdapter(this.adapters.get(tile.adapter))) return home;
    try {
      const last = await this.drivers.store.get(this.lastUrlKey(dashId, tile.id));
      if (last && sameRegistrableDomain(last, home)) {
        this.bootPaused.add(tile.id);   // TV off, box holds: come back PAUSED
        return normalizeCollectionUrl(last);   // B-124: a stored bad address heals on read
      }
    } catch { /* unreadable state never blocks boot */ }
    return home;
  }

  private async readPersistedLayout(dashId: string): Promise<HeroOverride> {
    if (!this.drivers.store) return {};
    try {
      const raw = await this.drivers.store.get(this.layoutKey(dashId));
      if (!raw) return {};
      const parsed = JSON.parse(raw) as PersistedLayoutState;
      const out: HeroOverride = {};
      if (typeof parsed.hero === "string") out.hero = parsed.hero;
      if (typeof parsed.heroSize === "number") out.heroSize = clampHeroSize(parsed.heroSize);
      if (typeof parsed.solo === "string") out.solo = parsed.solo; // solo: the app shown last
      return out;
    } catch {
      return {}; // §10 posture: never let corrupt state break rendering
    }
  }

  private async persistLayout(): Promise<void> {
    if (!this.drivers.store || !this.doc) return;
    await this.drivers.store.set(this.layoutKey(this.doc.id), JSON.stringify(this.override));
  }
}


/**
 * Same registrable domain — the resume-last-location guard. Cheap eTLD+1
 * (last two labels; three for co.uk-style ccTLD seconds and for known
 * multi-tenant hosting suffixes, where two different tenants must NEVER
 * count as the same site). Not a full Public Suffix List: if this guard ever
 * protects more than a tile's own resume point, replace it with `tldts`.
 */
const MULTI_TENANT_SUFFIXES = new Set([
  "github.io", "gitlab.io", "pages.dev", "netlify.app", "vercel.app",
  "herokuapp.com", "azurewebsites.net", "amazonaws.com", "cloudfront.net",
  "firebaseapp.com", "web.app", "workers.dev", "glitch.me", "repl.co",
  "blogspot.com", "wordpress.com", "tumblr.com", "neocities.org",
]);

export function sameRegistrableDomain(a: string, b: string): boolean {
  const reg = (u: string): string | null => {
    try {
      const url = new URL(u);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      const parts = url.hostname.toLowerCase().split(".").filter(Boolean);
      if (parts.length < 2) return null;
      const last2 = parts.slice(-2).join(".");
      const ccSecond = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);
      let n = 2;
      if (MULTI_TENANT_SUFFIXES.has(last2)) n = 3;                 // tenant.github.io != other.github.io
      else if (parts.length >= 3 && ccSecond.has(parts[parts.length - 2]!) && parts[parts.length - 1]!.length <= 3) n = 3;
      if (parts.length < n) return null;
      return parts.slice(-n).join(".");
    } catch {
      return null;
    }
  };
  const ra = reg(a), rb = reg(b);
  return ra !== null && rb !== null && ra === rb;
}

/** One series' TMDB details reduced to what The Binge's rule reads. The runtime: the median of season 1's episodes (TMDB no longer fills
 *  episode_run_time for most series, and the latest episode is often a double-length finale - The Office read 45 min), else
 *  episode_run_time's first, else the latest episode's. */
export function bingeCandidateOf(card: import("./browse.js").BrowseCard, t: { genres?: string[] | undefined; mean: number | null; votes: number | null }, d: Record<string, unknown>): BingeCandidate {
  const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
  const ert = Array.isArray(d.episode_run_time) ? num(d.episode_run_time[0]) : null;
  const s1 = d["season/1"] as { episodes?: Array<{ runtime?: unknown }> } | undefined;
  const runs = (s1?.episodes ?? []).map((e) => num(e.runtime)).filter((n): n is number => n !== null && n > 0).sort((a, b) => a - b);
  const median = runs.length ? runs[Math.floor(runs.length / 2)]! : null;
  const last = d.last_episode_to_air && typeof d.last_episode_to_air === "object" ? num((d.last_episode_to_air as Record<string, unknown>).runtime) : null;
  const kw = (d.keywords as { results?: Array<{ name?: unknown }> } | undefined)?.results ?? [];
  const cr = (d.content_ratings as { results?: Array<{ iso_3166_1?: unknown; rating?: unknown }> } | undefined)?.results ?? [];
  const us = cr.find((r) => r.iso_3166_1 === "US");
  const genres = Array.isArray(d.genres) ? (d.genres as Array<{ name?: unknown }>).map((g) => g.name).filter((n): n is string => typeof n === "string") : (t.genres ?? []);
  return {
    card, genres, mean: num(d.vote_average) ?? t.mean, votes: num(d.vote_count) ?? t.votes,
    runtime: median ?? ert ?? last, episodes: num(d.number_of_episodes), type: typeof d.type === "string" ? d.type : null,
    keywords: kw.map((k) => k.name).filter((n): n is string => typeof n === "string"),
    certification: typeof us?.rating === "string" && us.rating ? us.rating : null,
  };
}
