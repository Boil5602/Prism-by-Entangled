/**
 * The players, set up from a list of services (2026-09-29): "When I go to a new computer and install Prism, I go to
 * the menu and it has the music player and the video player. But both indicate neither scene is setup ... I'd love to
 * be able to just start opening and logging into services on a new computer. Ideally they just get a wizard that has
 * them choose from all (and can select all or some) of the adapters and start doing logins."
 *
 * One call makes what a person otherwise builds by hand, role by role: an App and a full-screen facet for each service
 * chosen, the Music player (a Music Lounge: the stage over every music service, hidden) and the Video player (a Movie
 * Night: a video service on the screen, the rest a switch away). The two are separate: the Video player's scene holds
 * no music service (the wall keeps the music warm beside it while it is up, players.ts withWarmMusic). What is already there is kept: an App, a facet, a player the household owns - the services chosen join it.
 * Nothing is removed, and nothing here signs anybody in: the sign-in is the person's, on the service's own page.
 */
import type { App, Facet, Scene, CanvasSize } from "./scene-model.js";
import type { SceneModelStore } from "./scene-model-store.js";
import { playerScenes, withoutMusic } from "./players.js";
import { SCENE_TEMPLATES } from "./scene-model.js";
import { SHARED_PROFILE } from "./sign-ins.js";

export type SetupKind = "music" | "video";
/** A catalog entry as the shell hands it over: what the catalog says, nothing the person typed. */
export interface SetupEntry {
  id: string; name: string; url: string; adapter?: string | null; audio?: string | null;
  /**
   * The account the service signs in with, when it shares one with another service (the catalog's `signInWith`: "apple" for Apple Music
   * and Apple TV, "amazon" for Amazon Music and Prime Video - 2026-09-29, "Apple Music and tv use the same auth. Amazon Music and prime
   * video using the same auth"). Services of one account are given one profile, so one sign-in serves them all.
   */
  signInWith?: string | null;
}
export interface SetupService {
  id: string; name: string; kind: SetupKind; added: boolean; status: string;
  /** taken off the players by a person; its App and sign-in stand */
  removed: boolean;
  /** the other services set up here that use the same profile, by name: one sign-in serves them all */
  sharesWith: string[];
}

/** The profile a service's account lives in when the catalog names the account: one for every service of it. */
export function accountProfile(account: string): string { return "account-" + account.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

/**
 * The profile a NEW App of this entry gets. An App that exists keeps the profile it has, always: its sign-in lives there (section 10), and
 * a wall set up before accounts were shared keeps one profile a service. A new App joins the profile of a service of the same account that
 * is already here (so the sign-in already made serves it), else the account's own profile, else its own.
 */
export function profileFor(model: SceneModelStore, entry: SetupEntry, entries: readonly SetupEntry[]): string {
  const account = entry.signInWith?.trim();
  if (!account) return SHARED_PROFILE;   // one browser, many sign-ins (sign-ins.ts, 2026-10-03)
  for (const other of entries) {
    if (other.id === entry.id || other.signInWith?.trim() !== account) continue;
    const app = model.app(other.id);
    if (app) return app.profileId;
  }
  return SHARED_PROFILE;
}

/** The services a person took off the players (App ids), kept under this key. The Apps, their facets and their sign-ins stay. */
export const REMOVED_KEY = "players:removed";
export function parseRemoved(raw: string | null | undefined): string[] {
  try { const v = JSON.parse(raw || "[]") as unknown; return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))] : []; } catch { return []; }
}

export const SETUP_CLASS = "16:9·XL";
/** The Music player's look on a new device: the stage's style and artwork mode, and what stands in for an ad break. */
export const SETUP_MUSIC_STYLE = { style: "sunrise-meadow", artwork: "focal" } as const;
export const SETUP_MUSIC_BREAK = { ambient: "star-walk" } as const;

/** What an entry is to the players: a music service speaks the media session; a video service is any other that owns the sound. */
export function setupKindOf(entry: SetupEntry, speaksMediaSession: (entry: SetupEntry) => boolean): SetupKind | null {
  if (!entry.id || !/^https:\/\//i.test(entry.url)) return null;
  if (speaksMediaSession(entry)) return "music";
  return entry.audio === "exclusive" ? "video" : null;
}

/** The services the first-run page lists, music first, each by name; with what the device already knows of them. */
export function setupServices(model: SceneModelStore, entries: readonly SetupEntry[], speaks: (e: SetupEntry) => boolean, removed: readonly string[] = []): SetupService[] {
  const out: SetupService[] = [];
  for (const e of entries) {
    const kind = setupKindOf(e, speaks);
    if (!kind) continue;
    const app = model.app(e.id);
    const off = removed.includes(e.id);
    // the services that sign in with the same account (the catalog's signInWith) - not the same browser profile, which every service shares now (2026-10-03)
    const account = e.signInWith?.trim();
    const sharesWith = app && account ? entries.filter((o) => o.id !== e.id && o.signInWith?.trim() === account && model.app(o.id)).map((o) => model.app(o.id)!.name) : [];
    out.push({ id: e.id, name: e.name, kind, added: !off && !!app && homeFacet(model, e.id, kind) !== null, status: app?.setup.status ?? "unknown", removed: off, sharesWith });
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "music" ? -1 : 1));
}

function homeFacet(model: SceneModelStore, app: string, kind: SetupKind): Facet | null {
  const all = model.snapshot().facets.filter((f) => f.app === app && f.slotClass === SETUP_CLASS && !!f.music === (kind === "music"));
  return all.find((f) => f.id === app + "-home-16x9-XL") ?? all.find((f) => !f.focus) ?? null;
}

/**
 * A player is the household's own unless it is a seeded demo still standing on placeholders: a demo scene whose every facet is a saved one
 * is a player the household uses (a wall set up from the demo household, its Movie Night given a real service).
 */
export function ownPlayer(model: SceneModelStore, s: Scene | null): boolean {
  if (!s) return false;
  if (!s.id.startsWith("demo-")) return true;
  const refs = [...Object.values(s.assign).filter((r) => !(s.visualizations ?? []).some((v) => v.id === r)), ...s.hidden.map((h) => h.facet), ...(s.visualizations ?? []).map((v) => v.source)];
  return refs.length > 0 && refs.every((r) => !!model.facet(r));
}

export interface RemoveResult { ok: boolean; error?: string; kind: SetupKind | null; /** scenes saved */ changed: string[]; /** the services still off the players */ removed: string[] }

/**
 * A service leaves the players (2026-09-29, "Can people add/remove adapters to the list? ... some people won't need"): a music service's
 * facets leave the players' hidden sources, a stage that drew it draws the next one; a video service leaves the Video player's list, and
 * the screen goes to another service when it was on it. The App, its facets and its sign-in stand - nothing of the person's is deleted
 * (section 10), and choosing the service again on the setup page brings it back as it was.
 */
export function removeFromPlayers(model: SceneModelStore, appId: string, removed: readonly string[]): RemoveResult {
  const app = model.app(appId);
  const next = [...new Set([...removed, appId])];
  if (!app) return { ok: false, error: "no such service", kind: null, changed: [], removed: [...removed] };
  const snap = model.snapshot();
  const mine = new Set(snap.facets.filter((f) => f.app === appId).map((f) => f.id));
  const isMusic = snap.facets.some((f) => f.app === appId && f.music);
  const players = playerScenes(snap.scenes, (id) => model.layout(id), (id) => model.facet(id), model.activeScene());
  const changed: string[] = [];
  const isVideo = (id: string): boolean => { const f = model.facet(id); if (!f || f.music) return false; const a = model.app(f.app); return f.audio === "exclusive" || a?.render?.audio === "exclusive"; };
  for (const s of [players.music, players.video]) {
    if (!s) continue;
    let scene: Scene = s, touched = false;
    if (scene.hidden.some((h) => mine.has(h.facet))) { scene = { ...scene, hidden: scene.hidden.filter((h) => !mine.has(h.facet)) }; touched = true; }
    if (scene.visualizations?.some((v) => mine.has(v.source))) {
      const fallback = scene.hidden.find((h) => model.facet(h.facet)?.music)?.facet;
      if (fallback) { scene = { ...scene, visualizations: scene.visualizations.map((v) => (mine.has(v.source) ? { ...v, source: fallback } : v)) }; touched = true; }
    }
    if (s === players.video) {
      const other = snap.facets.find((f) => isVideo(f.id) && !mine.has(f.id) && !next.includes(f.app) && /XL$/.test(f.slotClass)) ?? snap.facets.find((f) => isVideo(f.id) && !mine.has(f.id) && !next.includes(f.app));
      for (const [slot, ref] of Object.entries(scene.assign)) if (mine.has(ref) && other) { scene = { ...scene, assign: { ...scene.assign, [slot]: other.id } }; touched = true; }
      if ((scene.floating ?? []).some((p) => !!p.facet && mine.has(p.facet))) { scene = { ...scene, floating: (scene.floating ?? []).filter((p) => !p.facet || !mine.has(p.facet)) }; touched = true; }
    }
    if (!touched) continue;
    const r = model.saveScene(scene);
    if (!r.ok) return { ok: false, error: r.error, kind: isMusic ? "music" : "video", changed, removed: [...removed] };
    changed.push(scene.id);
  }
  return { ok: true, kind: isMusic ? "music" : "video", changed, removed: next };
}

export interface SetupResult {
  ok: boolean; error?: string;
  music: string | null; video: string | null;
  /** what was made now (ids), for the log */
  made: { apps: string[]; facets: string[]; scenes: string[] };
  services: Array<{ id: string; name: string; kind: SetupKind; facet: string }>;
}

/**
 * @param catalog every entry the device knows, for the accounts services share (a service chosen later joins the profile of one of its
 *   account that is here); absent, the entries chosen.
 */
export function setupPlayers(model: SceneModelStore, entries: readonly SetupEntry[], speaks: (e: SetupEntry) => boolean, canvas: CanvasSize, catalog?: readonly SetupEntry[]): SetupResult {
  const made = { apps: [] as string[], facets: [] as string[], scenes: [] as string[] };
  const services: SetupResult["services"] = [];
  const fail = (error: string): SetupResult => ({ ok: false, error, music: null, video: null, made, services });
  for (const e of entries) {
    const kind = setupKindOf(e, speaks);
    if (!kind) continue;
    if (!model.app(e.id)) {
      const app: Partial<App> & { id: string } = {
        id: e.id, name: e.name, baseUrl: e.url, profileId: profileFor(model, e, catalog ?? entries), catalogRef: e.id, setup: { status: "unknown" },
        render: kind === "video" ? { intermission: { enabled: true }, veil: { mode: "veil-only" }, persist: true, audio: "exclusive" } : { audio: "exclusive" },
        ...(e.adapter ? { adapter: e.adapter } : {}),
      };
      const r = model.saveApp(app);
      if (!r.ok) return fail(e.name + ": " + r.error);
      made.apps.push(e.id);
    }
    let facet = homeFacet(model, e.id, kind);
    if (!facet) {
      const r = model.saveFacet({ id: e.id + "-home-16x9-XL", app: e.id, url: e.url, slotClass: SETUP_CLASS, label: "Home", audio: "exclusive", touch: "full", ...(kind === "music" ? { music: true } : {}) });
      if (!r.ok) return fail(e.name + ": " + r.error);
      facet = r.value; made.facets.push(facet.id);
    }
    services.push({ id: e.id, name: e.name, kind, facet: facet.id });
  }
  // which service a new player opens on: the first one chosen that its template suggests, in the template's order (Movie Night's screen,
  // the Music Lounge's source); none of those chosen, the first chosen
  const lead = (kind: SetupKind, template: string): string[] => {
    const mine = services.filter((s) => s.kind === kind);
    const t = SCENE_TEMPLATES.find((x) => x.id === template);
    const wanted = [...(t?.roles ?? []), ...(t?.hidden ?? [])].flatMap((r) => r.suggestions ?? []);
    const rank = (id: string) => { const i = wanted.indexOf(id); return i < 0 ? wanted.length : i; };
    return [...mine].sort((a, b) => rank(a.id) - rank(b.id)).map((s) => s.facet);
  };
  const now = () => playerScenes(model.snapshot().scenes, (id) => model.layout(id), (id) => model.facet(id), model.activeScene());
  const own = (s: Scene | null): Scene | null => (ownPlayer(model, s) ? s : null);

  // ---- the Music player: the stage over every music service chosen
  const musicFacets = lead("music", "music-lounge");
  let music = own(now().music);
  if (!music && musicFacets.length) {
    const r = model.instantiateTemplate("music-lounge", canvas, { source: musicFacets[0] });
    if (!r.ok) return fail("the Music player: " + r.error);
    music = { ...r.value.scene, visualizations: (r.value.scene.visualizations ?? []).map((v) => ({ ...v, ...SETUP_MUSIC_STYLE })) };
    made.scenes.push(music.id);
  }
  if (music && musicFacets.length) {
    const hidden = [...music.hidden];
    const settings = { ...music.settings };
    for (const f of musicFacets) {
      if (!hidden.some((h) => h.facet === f)) hidden.push({ facet: f, audio: "exclusive" });
      if (!settings[f]) settings[f] = { keepPresentation: false, onEnd: "none", intermission: { ...SETUP_MUSIC_BREAK } };
    }
    const r = model.saveScene({ ...music, hidden, settings });
    if (!r.ok) return fail("the Music player: " + r.error);
    music = r.value;
  }

  // ---- the Video player: the first video service on the screen; every other is a facet the player switches to
  const videoFacets = lead("video", "movie-night");
  let video = own(now().video);
  if (!video && videoFacets.length) {
    const r = model.instantiateTemplate("movie-night", canvas, { screen: videoFacets[0] });
    if (!r.ok) return fail("the Video player: " + r.error);
    video = r.value.scene; made.scenes.push(video.id);
  }
  if (video) {
    const clean = withoutMusic(video, (id) => model.facet(id));   // music an earlier build wrote into it
    if (clean) { const r = model.saveScene(clean); if (!r.ok) return fail("the Video player: " + r.error); video = r.value; }
  }
  return { ok: true, music: music?.id ?? null, video: video?.id ?? null, made, services };
}
