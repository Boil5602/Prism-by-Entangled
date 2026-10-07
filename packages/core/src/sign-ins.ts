/**
 * Sign-ins (2026-09-29): "Apple is also a little strange in that profiles are separate by login ... if my wife wants to see her own movies
 * and queues in Apple TV, she will need to login as herself, same with Apple Music. How do we reduce logins where possible but grant this
 * flexibility" - and: "we don't yet have the concept of profiles in the music player. But I want to. Ideally it uses the same profiles set
 * on the video side."
 *
 * A sign-in is one login kept on the device: a name a person gave it and the browser profile its session lives in. An ACCOUNT has one or
 * more - the account is the one the catalog names for services that share a login (`signInWith`: apple, amazon), else the service's own.
 * So a sign-in made for Apple TV is there for Apple Music, and a second person adds theirs once for both.
 *
 * Each service uses one sign-in at a time (its App's profile). A profile set - the same sets the Video player's services pick their
 * profiles in - names a sign-in for any service, music or video; applying the set moves each service to it. Nothing is ever signed out or
 * deleted by a switch (section 10): the other sign-in stays on the device, signed in, for the next switch back.
 *
 * Pure: the state in, the state out. The runtime keeps it under SIGN_INS_KEY and moves the Apps.
 */

export interface SignIn {
  id: string;
  /** what a person called it ("Maya") */
  name: string;
  /** the browser profile its session lives in */
  profile: string;
  /**
   * Who named it: "person" (typed, or renamed - never changed by Prism again), "page" (read from the service's own account page),
   * absent for the name it began with (Household, New sign-in).
   */
  by?: "person" | "page";
  /** when its account page was last read for a label (epoch ms): read once, and again only after a long while */
  readAt?: number;
  /** what each service last knew of its session while it used this sign-in: app id -> signed-in | needs-attention | unknown */
  status?: Record<string, string>;
  /**
   * Taken off the list by a person (2026-09-30, "we could hide it as long as it's recoverable in case they need it later"): its login stays
   * on the device, untouched (section 10); it is not offered, and comes back by name. Never the one a service is on.
   */
  hidden?: boolean;
  /** the browser profile it lived in before the move onto a shared one (2026-10-03): its folder stays on the device, untouched */
  wasProfile?: string;
}
export interface SignInState {
  /** account key -> its sign-ins, the first the one the device began with */
  accounts: Record<string, SignIn[]>;
  /** app id -> the account the catalog names for it (kept, so a set can be applied without the catalog at hand) */
  accountOf: Record<string, string>;
}

export const SIGN_INS_KEY = "sign-ins";
export const FIRST_SIGN_IN_NAME = "Household";
/** A sign-in added with no name given: named from its account page once the person has signed in, else renamed by them. */
export const NEW_SIGN_IN_NAME = "New sign-in";

export function emptySignIns(): SignInState { return { accounts: {}, accountOf: {} }; }

export function parseSignIns(raw: string | null | undefined): SignInState {
  try {
    const j = JSON.parse(raw || "null") as { accounts?: unknown; accountOf?: unknown } | null;
    const out = emptySignIns();
    if (j && j.accounts && typeof j.accounts === "object") {
      for (const [key, list] of Object.entries(j.accounts as Record<string, unknown>)) {
        if (!Array.isArray(list)) continue;
        const seen = new Set<string>();
        const clean: SignIn[] = [];
        for (const s of list as Array<Record<string, unknown>>) {
          if (!s || typeof s.id !== "string" || typeof s.name !== "string" || typeof s.profile !== "string" || !s.id || !s.profile || seen.has(s.id)) continue;
          seen.add(s.id);
          const status = s.status && typeof s.status === "object" ? Object.fromEntries(Object.entries(s.status as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string> : undefined;
          clean.push({ id: s.id, name: s.name, profile: s.profile, ...(s.by === "person" || s.by === "page" ? { by: s.by } : {}), ...(typeof s.readAt === "number" ? { readAt: s.readAt } : {}), ...(status && Object.keys(status).length ? { status } : {}), ...(s.hidden === true ? { hidden: true } : {}), ...(typeof s.wasProfile === "string" && s.wasProfile ? { wasProfile: s.wasProfile } : {}) });
        }
        if (clean.length) out.accounts[key] = clean;
      }
    }
    if (j && j.accountOf && typeof j.accountOf === "object") for (const [a, k] of Object.entries(j.accountOf as Record<string, unknown>)) if (typeof k === "string" && k) out.accountOf[a] = k;
    return out;
  } catch { return emptySignIns(); }
}

/** The account a service's sign-ins belong to: the one the catalog names for it, else its own. */
export function accountKey(appId: string, signInWith?: string | null): string {
  const shared = signInWith?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return shared ? "account:" + shared : "app:" + appId;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

/**
 * One browser, many sign-ins (2026-10-03, "Why do we need so many profiles? Seems like one per profile set would generally cover it"):
 * a browser profile is one session a site, the way a person's own browser holds every service at once. So the first sign-in of every
 * account lives in ONE shared browser profile, the second sign-in of any account in a second, and so on - a slot a sign-in, not a
 * browser a service. A wall with one login a service runs one Chromium instead of nine; a second person's Apple sign-in brings one more,
 * for Apple alone. Legacy profiles (a service's own id) are moved by `sharedPlan` once, their folders kept (section 10).
 */
export const SHARED_PROFILE = "shared";
export function sharedProfile(slot: number): string { return slot <= 0 ? SHARED_PROFILE : SHARED_PROFILE + "-" + (slot + 1); }
export function isSharedProfile(profile: string): boolean { return profile === SHARED_PROFILE || /^shared-\d+$/.test(profile); }
/** The first shared slot no sign-in of the account holds. */
export function freeSharedSlot(list: readonly SignIn[]): number {
  for (let n = 0; ; n++) if (!list.some((s) => s.profile === sharedProfile(n))) return n;
}
/**
 * The move of every legacy profile onto a shared slot: each account's sign-ins in order take slots 0, 1, 2 ... (the ones already shared
 * keep theirs); the pairs are what the host copies (cookies, storage), app by app, and the state is the sign-ins as they will read after.
 * Nothing when every sign-in is shared already.
 */
export function sharedPlan(state: SignInState): { state: SignInState; moves: Array<{ from: string; to: string }> } {
  const moves: Array<{ from: string; to: string }> = [];
  const accounts: Record<string, SignIn[]> = {};
  for (const [key, list] of Object.entries(state.accounts)) {
    const next: SignIn[] = [];
    const taken = new Set(list.filter((s) => isSharedProfile(s.profile)).map((s) => s.profile));
    // the household's own legacy sign-ins of one account - Prism-named, one a service's folder ("Household", "Household (Apple TV)") - are
    // one login on two folders: all into the first slot, the extra records hidden (kept, the sets that name them still land there)
    let householdSlot: string | null = null;
    for (const s of list) {
      if (isSharedProfile(s.profile)) { next.push(s); continue; }
      const household = s.by !== "person" && /^household(-|$)/.test(s.id);   // Prism's own ids for the wall's first login, labelled from a page or not
      let to: string;
      if (household && householdSlot) { to = householdSlot; }
      else {
        let slot = 0;
        while (taken.has(sharedProfile(slot))) slot++;
        to = sharedProfile(slot);
        taken.add(to);
        if (household) householdSlot = to;
      }
      if (!moves.some((m) => m.from === s.profile)) moves.push({ from: s.profile, to });
      next.push({ ...s, profile: to, wasProfile: s.profile, ...(household && next.some((x) => x.profile === to && x.by !== "person" && /^household(-|$)/.test(x.id) && !x.hidden) ? { hidden: true } : {}) });
    }
    accounts[key] = next;
  }
  return { state: { ...state, accounts }, moves };
}

/**
 * The account's sign-ins with the profile a service uses now among them: a profile no sign-in names yet (every device before this, and
 * every first sign-in) becomes one, named FIRST_SIGN_IN_NAME - the first - or "Household (Apple TV)" when the account has others already.
 */
export function withProfile(state: SignInState, key: string, profile: string, fallbackName: string): SignInState {
  const list = state.accounts[key] ?? [];
  if (list.some((s) => s.profile === profile)) return state;
  // a wall from before accounts were shared has a login a service: each is the household's, told apart by the service that made it
  const name = list.length === 0 ? FIRST_SIGN_IN_NAME : uniqueName(list, FIRST_SIGN_IN_NAME + " (" + fallbackName + ")");
  const id = uniqueId(list, slug(name));
  return { ...state, accounts: { ...state.accounts, [key]: [...list, { id, name, profile }] } };
}

function uniqueId(list: readonly SignIn[], base: string): string {
  let id = base;
  for (let n = 2; list.some((s) => s.id === id); n++) id = base + "-" + n;
  return id;
}
function uniqueName(list: readonly SignIn[], base: string): string {
  let name = base;
  for (let n = 2; list.some((s) => s.name.toLowerCase() === name.toLowerCase()); n++) name = base + " " + n;
  return name;
}

/**
 * A new sign-in for the account, under the name a person gave it. Its profile is new and empty: nobody is signed in there until the
 * person signs in. A name the account already has is that sign-in (nothing is made twice).
 */
export function addSignIn(state: SignInState, key: string, name: string, profilesTaken: ReadonlySet<string>): { state: SignInState; signIn: SignIn; made: boolean } | { error: string } {
  const typed = name.trim().replace(/\s+/g, " ").slice(0, 40);
  const list = state.accounts[key] ?? [];
  // no name given: one to begin with, until its account page names it or a person does
  const clean = typed || uniqueName(list, NEW_SIGN_IN_NAME);
  const same = typed ? list.find((s) => s.name.toLowerCase() === clean.toLowerCase()) : undefined;
  if (same?.hidden) { const back: SignIn = { ...same }; delete back.hidden; return { state: { ...state, accounts: { ...state.accounts, [key]: list.map((s) => (s.id === same.id ? back : s)) } }, signIn: back, made: false }; }
  if (same) return { state, signIn: same, made: false };
  // a shared slot the account does not hold yet (one browser, many sign-ins): shared with other accounts' sign-ins of the same slot
  void profilesTaken;
  const profile = sharedProfile(freeSharedSlot(list));
  const signIn: SignIn = { id: uniqueId(list, slug(clean)), name: clean, profile, ...(typed ? { by: "person" as const } : {}) };
  return { state: { ...state, accounts: { ...state.accounts, [key]: [...list, signIn] } }, signIn, made: true };
}

/**
 * A sign-in taken off the list: kept, its login untouched, not offered until shown again. Refused for the one a service is on (the
 * caller names the profiles in use) and for the last one the account has on the list.
 */
export function hideSignIn(state: SignInState, key: string, id: string, profilesInUse: ReadonlySet<string>): SignInState | { error: string } {
  const list = state.accounts[key] ?? [];
  const s = list.find((x) => x.id === id);
  if (!s) return { error: "no such sign-in" };
  if (s.hidden) return state;
  if (profilesInUse.has(s.profile)) return { error: s.name + " is in use. Choose another sign-in for the service first" };
  if (!list.some((x) => x.id !== id && !x.hidden)) return { error: s.name + " is the only sign-in left" };
  return { ...state, accounts: { ...state.accounts, [key]: list.map((x) => (x.id === id ? { ...x, hidden: true } : x)) } };
}
/** A hidden sign-in back on the list. */
export function showSignIn(state: SignInState, key: string, id: string): SignInState | { error: string } {
  const list = state.accounts[key] ?? [];
  if (!list.some((x) => x.id === id)) return { error: "no such sign-in" };
  return { ...state, accounts: { ...state.accounts, [key]: list.map((x) => { if (x.id !== id) return x; const back: SignIn = { ...x }; delete back.hidden; return back; }) } };
}

export function renameSignIn(state: SignInState, key: string, id: string, name: string): SignInState | { error: string } {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) return { error: "a sign-in needs a name" };
  const list = state.accounts[key] ?? [];
  if (!list.some((s) => s.id === id)) return { error: "no such sign-in" };
  if (list.some((s) => s.id !== id && s.name.toLowerCase() === clean.toLowerCase())) return { error: "another sign-in has that name" };
  return { ...state, accounts: { ...state.accounts, [key]: list.map((s) => (s.id === id ? { ...s, name: clean, by: "person" as const } : s)) } };
}

/**
 * The label its account page gave: taken unless a person named the sign-in (theirs stands). A label another sign-in of the account
 * carries is that person too - the name is kept apart with a number. The read is noted either way.
 */
export function labelFromPage(state: SignInState, key: string, profile: string, label: string | null, now: number): SignInState {
  const list = state.accounts[key] ?? [];
  const at = list.findIndex((s) => s.profile === profile);
  if (at < 0) return state;
  const cur = list[at]!;
  let name = cur.name, by = cur.by;
  const clean = (label ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (clean && cur.by !== "person" && cur.name !== clean) { name = uniqueName(list.filter((s) => s.id !== cur.id), clean); by = "page"; }
  const next = [...list];
  next[at] = { ...cur, name, ...(by ? { by } : {}), readAt: now };
  return { ...state, accounts: { ...state.accounts, [key]: next } };
}

/** Whether a sign-in's account page is worth reading now: never named by a person, and not read in the last week. */
export function wantsLabel(s: SignIn, now: number): boolean {
  return s.by !== "person" && (s.readAt === undefined || now - s.readAt > 7 * 24 * 3_600_000);
}

/** What a service knew of its session under a sign-in, kept as the service leaves it and given back when it returns. */
export function noteStatus(state: SignInState, key: string, profile: string, appId: string, status: string): SignInState {
  const list = state.accounts[key] ?? [];
  const at = list.findIndex((s) => s.profile === profile);
  if (at < 0 || list[at]!.status?.[appId] === status) return state;
  const next = [...list];
  next[at] = { ...list[at]!, status: { ...(list[at]!.status ?? {}), [appId]: status } };
  return { ...state, accounts: { ...state.accounts, [key]: next } };
}

export function signInByProfile(state: SignInState, key: string, profile: string): SignIn | null { return (state.accounts[key] ?? []).find((s) => s.profile === profile) ?? null; }
export function signInById(state: SignInState, key: string, id: string): SignIn | null { return (state.accounts[key] ?? []).find((s) => s.id === id) ?? null; }
