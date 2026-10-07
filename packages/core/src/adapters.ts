/**
 * Adapters runtime (spec §5): per-site polish as data, not code.
 *
 * An adapter is cleanup CSS + behavior JS fetched independently of shell
 * releases (community repo; shells ship a bundled set as assets). The shell
 * contract implemented here: inject CSS then JS at readiness, re-inject JS
 * on SPA navigation (CSS survives in-document), and expose the page-side
 * `frame` API so adapters can signal readiness (§16) and implement media
 * commands (play/pause/next/prev) for remotes and media keys.
 *
 * Adapters may fail silently — core grid/audio/touch never depends on them.
 */

/**
 * Player controls an adapter may declare (§26 pass-through, §32 transport).
 * `play` / `pause` are separate names on purpose: a site whose button is a
 * toggle declares state-conditioned selectors (`[aria-label="Play"]` /
 * `[aria-label="Pause"]`) so a human's "play" never pauses. A missing
 * play/pause falls through to the page's own Media Session handler in core.
 * `wake` (B-139, 2026-09-08): the page's OWN "are you still listening?" prompt (Pandora parks the tuner behind one
 * after hours of play and disables Play under it). Core answers it only as PART of a human's play/next/prev press -
 * the press is the answer - never from a timer or an observation (section 26).
 */
/** `thumbUp` / `thumbDown` (B-155): the service's own rating controls - a human's verdict passed to the service's algorithm. */
/** `offer` (2026-09-14): the service's own OFFER to the person - Pandora's "Get more skips" at the skip limit (watch an ad for more) - as a control the wall may show and a human may press; the ad that follows is a break like any other. */
/**
 * playPage (2026-09-16): the page's OWN Play for the collection it shows - pressed only when nothing is loaded (a resume
 * that navigated to the collection's page). Spotify's transport toggle is inert with nothing queued; its album page's
 * action-bar Play is what starts the album. Falls back to `play` when absent.
 */
export type ControlName = "play" | "playPage" | "pause" | "next" | "prev" | "skip" | "fullscreen" | "normal" | "close" | "wake" | "thumbUp" | "thumbDown" | "offer";

/** §26 presentation actions — the keeper's vocabulary, nothing more. */
export type PresentationName = "enterFullscreen" | "enterTheater" | "play";

export const CONTROL_NAMES: readonly ControlName[] = ["play", "playPage", "pause", "next", "prev", "skip", "fullscreen", "normal", "close", "wake", "thumbUp", "thumbDown", "offer"];
export const PRESENTATION_NAMES: readonly PresentationName[] = ["enterFullscreen", "enterTheater", "play"];

/**
 * A job's address from a card (2026-09-23): {id} the service's id, {url} the card's own address, {param:NAME} one query parameter of that
 * address. null when the template names something the card does not have - the caller tries its next template.
 */
export function fillItemAddress(template: string, id: string, url: string | null): string | null {
  let missing = false;
  const out = template.replace(/\{(id|url|param:([A-Za-z0-9_]+))\}/g, (_m, what: string, name?: string) => {
    if (what === "id") return encodeURIComponent(id);
    if (what === "url") { if (!url) missing = true; return url ?? ""; }
    let v: string | null = null;
    try { v = url ? new URL(url).searchParams.get(name!) : null; } catch { v = null; }
    if (!v) missing = true;
    return encodeURIComponent(v ?? "");
  });
  return missing ? null : out;
}

export interface AdapterSpec {
  /** Domains the adapter targets (informational in v0; tiles bind by name). */
  match?: string[];
  capabilities?: string[];
  /** v0 injects at readiness regardless; kept for the on-disk format. */
  injectAt?: string;
  version?: string;
  css?: string | null;
  js?: string | null;
  /**
   * Declared player controls (§26 pass-through): command → CSS selector of
   * the site's OWN control. Core clicks a declared control only when a
   * human issued the command (remote key, phone button, intermission chip).
   * Adapters never click anything themselves — see `lintAdapter`.
   */
  controls?: Partial<Record<ControlName, string>>;
  /**
   * §26 presentation keeping: the player's OWN fullscreen / theater / play
   * controls, by name. Invocable ONLY under a standing human instruction —
   * the presentation keeper's action handler (`adapters-presentation.ts`)
   * is the single call site; nothing else reads this block. Same value
   * grammar as `controls` (a selector, a `>>>` deep selector, or `key:`).
   */
  presentation?: Partial<Record<PresentationName, string>>;
  /**
   * Per-selector provenance for review: `false` (or a note) = not verified
   * against the live page. Informational; lint never fails on it.
   */
  verified?: Record<string, boolean | string>;
  /**
   * §27 partial veil: in-player overlay ads the adapter can identify.
   * `hide` (preferred where the site's overlay is dismissible) applies a
   * plain element-hide; `patch` covers exactly that element's rect with art,
   * tracked through resizes and fullscreen. Neither ever clicks a close button.
   */
  overlays?: Array<{ selector: string; mode: "hide" | "patch" }>;
  /**
   * §31 named selector table: stable NAMES the catalog's focus presets
   * reference (presets never carry raw CSS — drift lives here, with the
   * adapter). Resolution happens at pick time (`pickerTile`).
   */
  selectors?: Record<string, string>;
  /** The service's sign-in page — the remote's "Go to sign-in" jumps a tile straight there. */
  login?: string;
  /**
   * "Login tile": selector of the sign-in form on that page. While the tile
   * is on its login page, §17 region focus frames this element so the form
   * fills the tile and Prism's chrome is the decor around it — the site's
   * own page, never a copy of it.
   */
  loginFocus?: string;
  /**
   * Some sites open their sign-in form from a button rather than a URL
   * (Apple TV: "Sign In" on the home page opens the commerce sheet). The
   * phone's "Go to sign-in page" presses this label AFTER the human tapped —
   * still a forwarded human gesture, never pressed on core's own initiative.
   * Since 2026-09-29 it is a CSS selector, and the wall's own Sign in presses it (signInPressJs) in place of the signed-out marker when
   * that marker cannot be pressed as it stands (Apple Music's is guarded by a mark the adapter's script sets on the wall's own tile).
   */
  loginPress?: string;
  /**
   * How many of the service's streams one account may play at once (2026-09-29: a fourth Paramount+ live window sat on an empty player with
   * no word from the service - its accounts play three). The wall refuses a window past it, in words, instead of opening one that will not
   * play. Absent: no cap the wall knows of.
   */
  maxStreams?: number;
  /**
   * False: the service's live channels cannot be paused (2026-10-06, "if I cant pause live tv on paramount plus, it should be disabled as an
   * option. I can press pause/play repeatedly on the paramount live content and nothing happens"). The tile's can.pause is false while a
   * channel plays; the shell draws Pause as unavailable and offers Mute instead. Absent: live pauses like anything else.
   */
  livePause?: boolean;
  /**
   * Where the service's own page SHOWS whose account it is (2026-09-29, "Instead of even naming the sign ins, can you just capture the
   * username or likely email address that is used?"): its account page, and optionally the part of that page to look in. Core reads a
   * sign-in's label from it once - the email the page shows (the wall shows the part before the @), else the name in `name`. Only what
   * the page shows to the person signed in: never a sign-in form's fields, never a page's script data (third-party policy, rules 1 and 3).
   */
  account?: { url: string; within?: string; name?: string };
  /**
   * The page Sign in opens, when `login` is not one (2026-09-29): `login` is first the address the redirect check knows a sign-in page by,
   * and for some services that is a host or the service's home (Amazon Music: its home; the sign-in is /forceSignIn). Absent, `login` is
   * opened when it names a page, else the service's own Sign In control is pressed (adapters-facets signInPage / signInPressJs).
   */
  signIn?: string;
  /**
   * §32 music (2026-09-06): page-side scripts a MUSIC adapter may declare, each defining one window
   * function, injected after `js` at readiness. They read the service's own player object (Apple
   * Music: MusicKit) because the Media Session never says which playlist or station a track came from.
   *  - musicContext: window.__prismMusicContext() -> {url, label, kind} | null - the collection playing now
   *  - musicLibrary: fills window.__prismMusicLibrary.cache = {playlists:[{id,name,kind,url}], stations:[...]}
   *  - musicPlay:    window.__prismMusicPlay(kind, id) - queue that collection and play (a human's tap on the wall)
   */
  musicContext?: string;
  musicLibrary?: string;
  musicPlay?: string;
  /**
   * musicLookup (Quick play cross-service lookup, 2026-09-16): window.__prismMusicLookup(token, {title, artist, album, term}) searches the
   * service's catalog and answers through PrismTile.notifyMusicResult({token, op:"lookup", ok, candidates}); the same script defines
   * window.__prismMusicAddToPlaylist(token, playlistId, songId) and window.__prismMusicStationFromSong(token, songId), answering op "add" / "station".
   */
  musicLookup?: string;
  /**
   * musicLookupNote (2026-09-16): why this service cannot be searched from the wall, in a sentence or two for the person
   * (the Quick play entry reads "Unavailable" with a ? that carries it). For a service with no musicLookup script.
   */
  musicLookupNote?: string;
  /** The page that lists the person's playlists, when the service's home does not (Amazon Music's /my/playlists): core opens it on the service's
   *  own window while that window is idle, takes the library the musicLibrary script reports there, and goes back to the window's home. */
  musicLibraryUrl?: string;
  /** musicLookupCannot (B-218): a verb the service's page cannot do from the wall, with the reason - the row stays grey with it. */
  musicLookupCannot?: { add?: string; station?: string };
  /**
   * Play orders (2026-09-17, spec 32 layer 5): musicShuffle defines window.__prismMusicShuffle(on) - the service's OWN shuffle
   * switch (MusicKit's shuffleMode; a page's shuffle button). musicTracks defines window.__prismMusicTracks(token, kind, id):
   * the collection's tracks, in the service's order, answered through PrismTile.notifyMusicResult({token, op:"tracks", ok,
   * candidates:[{id,title,artist,durationMs}]}) - ids the player's queue takes. musicQueue defines
   * window.__prismMusicQueue(token, ids): the service's own shuffle off, the queue set to exactly these ids in this order,
   * playing; answers op "queue". With both, core plays a collection in ITS order (true shuffle, reverse).
   */
  musicShuffle?: string;
  musicTracks?: string;
  musicQueue?: string;
  /** musicQueueAppend (2026-09-18): window.__prismMusicQueueAppend(token, ids) - these ids after what is queued, without touching what plays (MusicKit's playLater); answers op "queue". Core hands a long order to the player in windows through it. */
  musicQueueAppend?: string;
  /** musicRemove (2026-10-06): window.__prismMusicRemove(token, title, artist, dry) on the playlist's own page (musicPlaylistUrl) - the row of that
   *  track found and the page's own Remove from Playlist pressed (dry: found, not pressed); answers op "remove" ok | error. Page actions only. */
  musicRemove?: string;
  /** The address of one of the person's playlists, {id} for its id (the page musicRemove works on). */
  musicPlaylistUrl?: string;
  /** musicRepeat (2026-09-18): window.__prismMusicRepeat(on) - the service's OWN repeat-all switch, for a play in the service's order. Prism's orders repeat by Prism's hand (the next pass appended), never the player's. */
  musicRepeat?: string;
  /** musicStartOver (2026-09-19): window.__prismMusicStartOver(kind, id, shuffle) - a page-route service starts the collection it already holds over in the service's own order (in order: its first track; shuffle: a random one, the switch on), and stands down any Prism order driver. */
  musicStartOver?: string;
  /** musicCmd: window.__prismMusicCmd(cmd) -> true when the player itself took play|pause|next|prev|seekforward|seekbackward (B-127) */
  musicCmd?: string;
  /**
   * VP-2 video (2026-09-19, "the config much like what we've done for music"): page-side scripts a VIDEO adapter may declare,
   * each defining one window function, injected after `js` at readiness (video.ts):
   *  - videoContext: window.__prismVideoContext() -> {kind, title, series, season, episode, id, url, playing, position, duration, ad} | null
   *  - videoLibrary: fills window.__prismVideoLibrary.cache = {continue:[{id,title,kind,url,artwork,subtitle,progress}], list:[...]}
   *  - videoPlay:    window.__prismVideoPlay(kind, id, url) - play that title (a human's tap on the wall); window.__prismVideoPlayState = {kind,id,status}
   *  - videoCmd:     window.__prismVideoCmd(cmd) -> true when the player took play|pause|seekforward|seekbackward|next|nextepisode|skipintro|captions|fullscreen
   *  - videoLookup: cross-service search (video-menu-spec §2 row 5, 2026-09-19) - window.__prismVideoLookup(token, q) runs
   *    the service's OWN search from the page core put on a hidden surface (its search address with the words, else its
   *    home: the script types the words into the service's own control) and posts what the page shows through
   *    PrismTile.notifyMusicResult({token, op: 'lookup', ok, candidates: [{id, title, kind, year, url, poster, play}]});
   *    ok:false with error 'needs-profile' when a profile gate stands in the way. Read page-side, never a private endpoint.
   *  - videoLookupNote: why this service cannot be searched from the wall, for the person
   */
  videoContext?: string;
  videoLibrary?: string;
  videoPlay?: string;
  videoCmd?: string;
  videoLookup?: string;
  videoLookupNote?: string;
  /** On a title's own page: whether this account can play it (2026-09-25, Disney+ - a Hulu title in the Disney+ app only with the bundle).
   *  window.__prismVideoCanPlay(token) posts op "canplay" with one candidate {play: true|false, title: the page's own reason}. */
  videoCanPlay?: string;
  /**
   * The combined My list (2026-09-20): the address of the service's own list page (My List / My Stuff), read in the
   * background on a hidden surface by the videoLibrary script (which reports `list` from that page) - or, for an app that
   * mounts only through its own navigation (Peacock), videoListRoute: window.__prismVideoListRoute() walks there from a
   * mounted home. A service with neither contributes to the row only what its home page shows.
   */
  videoListUrl?: string;
  videoListRoute?: string;
  /**
   * Remove a title from the service's own Continue Watching (2026-09-22, "right click on a continue watching item and tell it to remove
   * it from the keep watching list of the source service"): the script defines window.__prismVideoRemoveContinue(token, id, title), which
   * presses the service's OWN remove control for that title - a human asked, on the wall, and confirmed (section 26 pass-through) - and
   * answers through the result channel (op "remove") once the title has left the row. Run on a hidden surface in the App's profile at
   * videoRemoveContinueUrl (else the App's home). videoRemoveContinueWarning is said in the confirmation when the service does more than
   * hide the title (Hulu resets the progress). A service without the script offers no remove.
   */
  videoRemoveContinue?: string;
  /**
   * Every season and episode of the series on the screen, as the service lists them (2026-09-22, the stage bar's Episodes menu): the script
   * defines window.__prismVideoEpisodes(token) and answers through the result channel (op "episodes") with `candidates` = one entry per
   * episode {season (number or "Season 3"), episode, title, id, url?, synopsis?, still?, duration?}. It runs on a hidden surface in the App's
   * profile at videoEpisodesUrl, whose {id} is the playing title's own id (Netflix: /title/<episode id> opens the show). The ids it gives
   * are what a pick plays; a service without the script lists TMDB's episodes and cannot play one.
   */
  videoEpisodes?: string;
  videoEpisodesUrl?: string;
  /**
   * How the series' own page is found: "id" (the default) fills videoEpisodesUrl's {id} with the playing title's id (Netflix: /title/<episode>
   * opens the show); "lookup" asks the service's own search for the series by name (its videoLookup, on its videoSearchUrl) and fills {id}
   * with the series result's id (Hulu: /series/<id> - its watch page names no series id); a videoEpisodesUrl of "{url}" takes the result's own
   * address (Paramount+: /shows/<slug>/).
   */
  videoEpisodesVia?: "id" | "lookup";
  /** One address or several tried in order (as videoListSetUrl), filled by fillItemAddress from the card; a template it cannot fill is skipped. */
  videoRemoveContinueUrl?: string | string[];
  videoRemoveContinueWarning?: string;
  /**
   * Add a title to the service's own My List / My Stuff / Watchlist, or take it off (2026-09-23, "Ideally we could add any items to My List
   * through Prism, and it does it in the source application as well. Just like Continue Watching"): the script defines
   * window.__prismVideoListSet(token, want, id, title) - want true adds, false removes - which finds the TITLE'S OWN list toggle on its
   * details page, presses it only when its state is not already `want` (a human asked, on the wall - section 26 pass-through), and answers
   * through the result channel (op "list") once the toggle reads `want`; error "not-found" when the page shows no toggle for the title (the
   * wall then tries the next address). Run on the App's hidden work page at videoListSetUrl: one template or several tried in order, with
   * {id} the service's id for the title and {url} its own address (Hulu: /series/{id}, then /movie/{id}), {param:NAME} one query parameter of
   * that address (Apple TV: an Up Next episode's ?showId= names its show's page - the episode's own page is never opened). A service without it offers neither.
   */
  videoListSet?: string;
  videoListSetUrl?: string | string[];
  /**
   * Address paths at which the service starts playback on load (2026-09-23: Tubi's /movies/<id> is its player - a hidden list job opened one and
   * played the film for six minutes, which put it back in Continue Watching each time it was removed; Apple TV's /episode/). Core never opens
   * such an address for background work (lists, removals, episodes, lookups) - the job fails with a plain reason instead.
   */
  videoPlaysAt?: string[];
  /** The service's own name for its list, as the wall says it (Hulu "My Stuff", Disney+ "Watchlist"); "My List" when absent. */
  videoListName?: string;
  /**
   * The service's own "Who's watching?" page (Hulu /profiles, Paramount+ /user-profile/whos-watching/), the one page that
   * names the WHOLE household - read in the background on the hidden surface after the list, so the wall's list of
   * profiles follows the service's: a profile deleted there leaves the wall's menu too ("use that to maintain your list
   * and get rid of old orphaned profiles", 2026-09-21). A read only: the standing choice is never pressed from there.
   */
  videoProfilesUrl?: string;
  /**
   * The service's own address that switches the session to a profile, with {id} for the profile's id (Netflix's account menu links,
   * /SwitchProfile?tkn={id}, 2026-09-24): a preset's switch opens it on the hidden page - no gate to press.
   */
  videoProfileSwitchUrl?: string;
  /**
   * The pages that list what the person OWNS on the service (Fandango at Home: /mymovies and /mytv, 2026-09-22), read in the
   * background on the hidden surface after the list and the household, one after another; the adapter's videoLibrary script
   * reports them as `owned`, and core keeps the union. Their own row on the menu, and 'Owned' on a search card.
   */
  videoOwnedUrls?: string[];
  /**
   * A page that lists the service's Continue Watching apart from its home (Fandango's /content/browse/continuewatching, 2026-09-23), read with the
   * list at every refresh (the owned pages come far less often); the reader reports it continueOnly.
   */
  videoContinueUrl?: string;
  /**
   * Which of the service's rows carry tall poster art rather than the landscape the Watch cards use (Paramount+'s My List, 2026-09-23: "Many
   * paramount items are using the portrait style tall images instead of the landscape style wide images"): those cards take TMDB's backdrop when known.
   */
  videoArtPortrait?: Array<"continue" | "list">;
  /**
   * The service's own landscape picture for an owned title, as an address with {id} for the card's id (Fandango's
   * images2.vudu.com/background/{id}-1280, 2026-09-24): the Library card's picture when TMDB has no backdrop for the title.
   */
  videoOwnedArtWide?: string;
  /**
   * The service's ids in TMDB's watch-providers data (JustWatch's; a service may have several - Peacock's two tiers), for
   * the catalog search (catalog-search.ts, 2026-09-21): a title TMDB lists under one of these is offered on this service.
   * A service without ids never appears in a catalog row (its own search page still answers a services search).
   */
  tmdbProviders?: number[];
  /**
   * videoTracks (2026-09-21, "if you can pull those options into our own chrome, that would be better"): the service's
   * own subtitle and audio tracks, offered on Prism's stage bar instead of the service's panel (which the stage shield keeps
   * the pointer from). window.__prismVideoTracks() -> {subtitles:[{id, name, selected}], audio:[{id, name, selected}]} | null
   * as the player itself lists them; window.__prismVideoTrack(kind, id) -> true when the player took the choice (kind =
   * "subtitles" | "audio"). Read from the service's own player object, or from the service's own panel opened under the
   * adapter's stylesheet (Paramount+) - then window.__prismVideoTracksDone() closes it when the wall's menu closes.
   * A human's pick from the wall, never a timer's.
   */
  videoTracks?: string;
  /**
   * Seek to a spot (2026-09-23, "I should be able to drag the slider on all of the video streams to find my spot and have the video
   * immediately changed"): window.__prismVideoSeek(seconds) -> true when the player took it, through the service's OWN player - its
   * player object or its own scrubber - never a bare video.currentTime where the service forbids it (Netflix errors, Disney+ desyncs).
   * A person's drag, never a timer's; refused during an ad (B-263).
   */
  videoSeek?: string;
  /**
   * The seek through the service's OWN scrubber, for a player that follows nothing else (Peacock, 2026-09-23): window.__prismVideoSeekPoint(seconds)
   * opens the scrubber to a press (it may be held down by the adapter's stylesheet) and answers "x,y" - the page point on it for that spot -
   * or ""; core sends one trusted press there (surface.scrub) and then calls window.__prismVideoSeekDone(). Preferred over videoSeek when both.
   */
  videoSeekPoint?: string;
  /**
   * The picture at a spot, for the slider's preview while dragging (2026-09-23, "Ideally we even pop up with a preview image of the video at that
   * point in time, if the service offers it"): window.__prismVideoPreview(seconds) answers "url:<address>" (the service's own preview frame -
   * Netflix's getTrickPlayFrame) or "hover:x,y" (a scrubber that draws its thumbnail only under a real pointer - Peacock); after that move the
   * host reads window.__prismVideoPreviewRead() -> the thumbnail's address; window.__prismVideoPreviewDone() when the drag ends.
   */
  videoPreview?: string;
  /**
   * Play an episode by its number where the service gives its episodes no id or address (2026-09-23, Peacock: "Peacock's episode selector is
   * working, so why is it currently unable to play an episode?"): window.__prismVideoEpisodeNumber(season, episode) -> true when the page's
   * OWN episode control for it was pressed (Peacock's player rail - the service's own navigation). The Episodes list's Play uses it when the
   * list is TMDB's. A person's pick, never a timer's.
   */
  videoEpisodeNumber?: string;
  /**
   * false keeps this service's list OUT of the menu's merged My list row (2026-09-20, Fandango at Home: a purchase-first
   * service's saved titles are not the same kind of thing as a streaming list - "maybe only the continue watching stuff
   * should"); the list is still read and kept per App, and its Continue Watching merges as any other. Default true.
   */
  videoListMerge?: boolean;
  /** The service's own move to its next title inside the page is followed by a fresh load of that title's page (2026-09-28: Netflix's
   *  hardware-protected video went black when it rolled into the next episode in place; a fresh page played it). */
  videoFreshPageEachTitle?: boolean;
  /** The Live tab (docs/features/live.md): the page that lists the service's live channels. Read only while a person has the Live tab open -
   *  such pages play a channel as they open. The videoLive script may define `__prismVideoLiveRead(token)`, answering op "live" with the
   *  channels (and their category / nowEnds / schedule) when it has walked the page. */
  videoLiveUrl?: string;
  /**
   * Live events (2026-09-30, "Does Apple have live tv we can incorporate? What about their formula one stuff"): pages that list the service's
   * sporting events - Apple TV's Formula 1 and MLS channel pages. The videoEvents script defines `window.__prismVideoEvents()` answering
   * [{id, title, url, start (epoch ms | null), live, badge, artwork, group}] for the events the page lists: an upcoming one by its start, one
   * on by its live mark. Read on the service's hidden work page, muted, every half hour; the Live tab lists them below the channel grid.
   */
  videoEventsUrls?: string[];
  videoEvents?: string;
  /**
   * What a live news show reported (2026-10-01, docs/features/live.md): the network's own feed of the segments a show aired, paired with
   * the channel that carries it - {channel, show?, feed, only?, name?} (news-feeds.ts). Read every ten minutes while the Live tab is in
   * News mode, through the host's static fetch, one fixed address each.
   */
  newsFeeds?: Array<{ channel: string; show?: string; feed: string; only?: string; name?: string; local?: boolean }>;
  /** The networks the service carries live, as ESPN's scoreboard names them (2026-10-02): a live game one of them shows gets a Watch chip on its score card. */
  broadcasters?: string[];
  /**
   * videoProfiles (VP-3, 2026-09-19, "add profile selection to the supported capabilities of all the video services"):
   * window.__prismVideoProfiles() -> {gate, profiles:[{id, name, avatar}], current} | null - the service's "Who's watching?"
   * gate as the page shows it; window.__prismVideoProfile(id) -> true when the page took the pick. A pick is a human's press
   * from the wall; "always watch as" is a standing instruction core applies when the gate shows again (section 26's
   * presentation-keeper precedent: a standing human instruction, never a timer's guess).
   */
  videoProfiles?: string;
  /**
   * The universal video menu (docs/video-menu-spec.md §3, Phase 2, 2026-09-19) - OPTIONAL extensions; a service without
   * them contributes no rows and behaves exactly as before. continueWatching / myList are the videoLibrary script above
   * (the implementation stands, spec §3 Decision); needsAttention is the session probe.
   *  - videoSearchUrl: the service's own search page with {q} where the words go (a plain address: the menu's Search chips)
   *  - videoLive: fills window.__prismVideoLive.cache = [{id, name, url, now, logo, favorite}] - the live channels a
   *    live-capable service lists; tune = play the channel's address in the service's own player
   */
  videoSearchUrl?: string;
  videoLive?: string;
  /**
   *  - videoTune: window.__prismVideoTune(channelId) -> true once the page took the press on that channel's guide item
   *    (waits up to ten seconds for the guide to draw it); a human's press from the wall on a Live now card (§26)
   */
  videoTune?: string;
  /**
   *  - videoSearch: window.__prismVideoSearch(q, openId?) -> true once the page took the words - the app's own search control
   *    from a mounted page, the person's words entered for them (Hulu's search ignores the address; Peacock's is a deep
   *    link); a service with only videoSearchUrl is sent to the address instead. openId (2026-09-19): once the results
   *    show, the result with this id (as the lookup script named it) is pressed - how a cross-service result plays on a
   *    service whose titles have no address of their own (Peacock)
   */
  videoSearch?: string;
  /**
   * How long the adapter's OWN ad-break signal is already sustained page-side before it fires (ms). Core's cover-slow
   * window (section 26, 1 s) then shortens by that much, never below 200 ms: Pandora's tick held its two signs for 1 s and
   * core held another 1 s, and the person heard three seconds of the ad before the intermission (2026-09-14).
   */
  adSignalSustainedMs?: number;
  /**
   * The cover's backstop for this service (ms), past the two-minute default - for breaks no page counts. A live channel's
   * break runs three to four minutes and YouTube TV's is read off the picture (the host's break watch, 2026-10-06); the signal's
   * end still uncovers at once, this only keeps a held signal from being dropped mid-break.
   */
  adBackstopMs?: number;
  /**
   * The account's presence on the page (adapters-facets sessionProbeJs): signedIn matches the account
   * menu, signedOut the Sign In control. The sign-in wizard probes with these; B-123 (2026-09-07) also
   * watches with them on the wall, so a session the service dropped is named before a pick fails.
   */
  session?: { signedIn?: string | null; signedOut?: string | null };
  /**
   * Places on the service a human reaches for that its own UI buries (a
   * profile switcher behind a hover menu). Plain navigations, shown as
   * buttons on the phone; nothing is pressed until tapped.
   */
  shortcuts?: Array<{ label: string; url: string }>;
}

/**
 * §26 SYNTHETIC INTERACTION IS PROHIBITED — hard rule, enforced here as
 * well as in adapter review. Adapter JS may observe the page and drive
 * media-element APIs (play/pause/seek), but never simulate user input:
 *
 * The boundary, stated once so reviewers apply it consistently: calling a
 * HTMLMediaElement API (`play()`, `pause()`, `currentTime=`) is driving
 * playback, which the spec sanctions where policy requires it — §3.4 audio
 * focus, §25 preview capture, §14 lip-sync. Dispatching or simulating a
 * user gesture (`click()`, `dispatchEvent`, synthetic events, form submit,
 * dialog close) is interaction, and it is never autonomous: the only
 * gestures that reach a page are a human's, forwarded through `controls`.
 *
 * autonomous clicks manufacture false engagement signals and leave a
 * zero-latency mechanical fingerprint that observation alone can never
 * produce. Intermission's entire safety and legal position rests on
 * "observe, never interact" — the only interactions that reach a page are
 * ones a human actually performed (forwarded via `controls`).
 */
export const SYNTHETIC_INTERACTION_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "click", re: /\.click\s*\(/ },
  { id: "dispatchEvent", re: /\.dispatchEvent\s*\(/ },
  { id: "synthetic-event", re: /new\s+(Mouse|Pointer|Keyboard|Touch|Input|Focus|UI|Wheel)Event\s*\(/ },
  { id: "initEvent", re: /\.init(Mouse|Keyboard|UI)?Event\s*\(/ },
  { id: "form-submit", re: /\.submit\s*\(/ },
  { id: "requestSubmit", re: /\.requestSubmit\s*\(/ },
  { id: "showModal-close", re: /\.close\s*\(\s*\)/ },
];

/** Violations of the §26 prohibition in an adapter's JS; empty = clean. */
export function lintAdapter(spec: Pick<AdapterSpec, "js">): string[] {
  const js = spec.js ?? "";
  return SYNTHETIC_INTERACTION_PATTERNS.filter((p) => p.re.test(js)).map((p) => p.id);
}

/**
 * A control value's grammar: a CSS selector; a DEEP selector whose `>>>`
 * segments descend through open shadow roots (Apple Music's player is
 * custom elements — `amp-playback-controls-play >>> button`); or a key
 * binding the page handles itself (`key:Space`, `key:f`, `key:Shift+N`).
 */
export type ControlBinding =
  | { kind: "selector"; selector: string }
  | { kind: "deep"; path: string[] }
  | { kind: "key"; key: string; modifiers: string[] };

export function parseControl(value: string): ControlBinding {
  const v = value.trim();
  if (/^key:/i.test(v)) {
    const parts = v.slice(4).split("+").map((p) => p.trim()).filter(Boolean);
    const key = parts.pop() ?? "";
    return { kind: "key", key, modifiers: parts.map((m) => m.toLowerCase()) };
  }
  if (v.includes(">>>")) return { kind: "deep", path: v.split(">>>").map((p) => p.trim()).filter(Boolean) };
  return { kind: "selector", selector: v };
}

/**
 * Page-side deep query: each `>>>` segment is resolved inside the previous match's shadow root - or, when the match is
 * an <iframe> the page can read (same origin), inside that frame's document (2026-09-14: Pandora's "Get More Skips"
 * modal is a same-origin iframe#coachmark…, its button#reward reachable only through it).
 */
const DEEP_QUERY_JS =
  "function dq(p){var r=document,e=null;for(var i=0;i<p.length;i++){if(!r)return null;e=r.querySelector(p[i]);if(!e)return null;var fd=null;try{fd=e.tagName==='IFRAME'?e.contentDocument:null;}catch(x){fd=null;}r=fd||e.shadowRoot||e;}return e;}";

/**
 * Forward a HUMAN command to the site's own control (§26 pass-through).
 * Callers must only reach this from an input event, a remote request, or
 * the intermission chip — never from a timer or an observation. Accepts
 * the whole `ControlBinding` grammar; a key binding is delivered as the
 * keydown/keyup pair the page's own shortcut handler listens for.
 */
export function clickControlJs(control: string): string {
  const b = parseControl(control);
  if (b.kind === "key") {
    const init = JSON.stringify({
      key: b.key === "Space" ? " " : b.key, code: keyCode(b.key), bubbles: true, cancelable: true,
      ctrlKey: b.modifiers.includes("ctrl"), shiftKey: b.modifiers.includes("shift"), altKey: b.modifiers.includes("alt"), metaKey: b.modifiers.includes("meta"),
    });
    return (
      `(function(i){var t=document.activeElement||document.body;if(!t)return false;` +
      `t.dispatchEvent(new KeyboardEvent('keydown',i));t.dispatchEvent(new KeyboardEvent('keyup',i));return true;})(${init})`
    );
  }
  const finder = b.kind === "deep"
    ? `${DEEP_QUERY_JS}var e=dq(${JSON.stringify(b.path)});`
    : `var e=document.querySelector(${JSON.stringify(b.selector)});`;
  return `(function(){${finder}if(e&&typeof e.click==='function'){e.click();return true;}return false;})()`;
}

function keyCode(key: string): string {
  if (key === " " || /^space$/i.test(key)) return "Space";
  if (key.length === 1 && /[a-z]/i.test(key)) return "Key" + key.toUpperCase();
  if (key.length === 1 && /[0-9]/.test(key)) return "Digit" + key;
  return key;
}

/**
 * Data-block lint for an adapter's declared maps (a review aid the repo's
 * tests run): unknown control / presentation names, empty values, and a
 * catalog preset naming a selector the adapter does not have. `js` is
 * linted separately by `lintAdapter` (the §26 prohibition).
 */
export function lintAdapterData(spec: AdapterSpec, presetSelectorNames: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(spec.controls ?? {})) {
    if (!(CONTROL_NAMES as readonly string[]).includes(k)) out.push(`controls.${k}: unknown control name`);
    if (typeof v !== "string" || !v.trim()) out.push(`controls.${k}: empty`);
  }
  for (const [k, v] of Object.entries(spec.presentation ?? {})) {
    if (!(PRESENTATION_NAMES as readonly string[]).includes(k)) out.push(`presentation.${k}: unknown presentation action`);
    if (typeof v !== "string" || !v.trim()) out.push(`presentation.${k}: empty`);
  }
  for (const [k, v] of Object.entries(spec.selectors ?? {})) if (typeof v !== "string" || !v.trim()) out.push(`selectors.${k}: empty`);
  const names = new Set(Object.keys(spec.selectors ?? {}));
  for (const n of presetSelectorNames) if (!names.has(n)) out.push(`preset selector "${n}" is not in the adapter's selectors table`);
  return out;
}

/**
 * Page-side prelude, injected before any adapter JS. Idempotent. Relies on
 * the shell's per-tile `PrismTile` host object where present; degrades to
 * no-ops so adapter code never throws over a missing bridge.
 */
export const FRAME_PRELUDE_JS = `
(function () {
  if (window.frame && window.frame.__prism) return;
  var tile = typeof PrismTile !== "undefined" ? PrismTile : null;
  window.frame = {
    __prism: true,
    ready: function () { try { tile && tile.notifyReady(); } catch (e) {} },
    adBreak: function (active) { try { tile && tile.notifyAdBreak(!!active); } catch (e) {} },
    skipAvailable: function (available, target) {
      try { tile && tile.notifySkipAvailable(!!available, typeof target === "string" ? target : ""); } catch (e) {}
    },
    adInfo: function (count, remaining) {
      try { tile && tile.notifyAdInfo(typeof count === "string" ? count : "", remaining == null || !isFinite(remaining) ? -1 : +remaining); } catch (e) {}
    },
    position: function (pos, dur) {
      try { tile && tile.notifyPosition(+pos || 0, dur == null || !isFinite(dur) ? -1 : +dur); } catch (e) {}
    },
    onMediaCommand: null,
  };
  window.__prismMediaCmd = function (cmd) {
    try { window.frame.onMediaCommand && window.frame.onMediaCommand(cmd); } catch (e) {}
  };
})();
`.trim();

/** JS expression that routes one media command into the page (§5 contract). */
export function mediaCommandJs(cmd: string): string {
  return `window.__prismMediaCmd && window.__prismMediaCmd(${JSON.stringify(cmd)})`;
}

/**
 * §32 page-side routing for a HUMAN's play / pause / next / prev when no
 * adapter control is declared - in order: the page's own Media Session
 * handler (captured by the shell's bootstrap when the page registered it;
 * the same function the OS media keys run), the adapter's onMediaCommand,
 * the bare media element (play/pause only). Evaluates to who took it, or "".
 */
export function mediaFallbackJs(cmd: string): string {
  const action = cmd === "next" ? "nexttrack" : cmd === "prev" ? "previoustrack" : cmd;
  return (
    `(function(c,a){` +
    `if(window.__prismMediaAction&&window.__prismMediaAction(a))return 'session';` +
    `if(window.__prismMediaCmd&&window.frame&&window.frame.onMediaCommand){window.__prismMediaCmd(c);return 'adapter';}` +
    `if(c==='play'){var m=document.querySelector('video,audio');if(m){m.play();return 'element';}}` +
    `if(c==='pause'){document.querySelectorAll('video,audio').forEach(function(x){x.pause()});return 'element';}` +
    `return '';})(${JSON.stringify(cmd)},${JSON.stringify(action)})`
  );
}

export class AdapterRegistry {
  private adapters = new Map<string, AdapterSpec>();

  private rejectedAdapters = new Map<string, string[]>();

  /** Register adapters; any that synthesize interaction are rejected outright (§26). */
  registerAll(adapters: Record<string, AdapterSpec>): void {
    for (const [name, spec] of Object.entries(adapters)) {
      const violations = lintAdapter(spec);
      if (violations.length > 0) {
        this.rejectedAdapters.set(name, violations);
        this.adapters.delete(name);
        continue;
      }
      this.rejectedAdapters.delete(name);
      this.adapters.set(name, spec);
    }
  }

  /** Adapters refused by the §26 lint, with the patterns that tripped — for edit mode. */
  rejected(): Record<string, string[]> {
    return Object.fromEntries(this.rejectedAdapters);
  }

  get(name: string): AdapterSpec | undefined {
    return this.adapters.get(name);
  }

  /**
   * The adapter whose `match` names this address's host (exact, or a parent domain), with its name - for a tile whose
   * App names no adapter and no catalog entry (VP-2, 2026-09-19: the Netflix App added by address bound nothing, so its
   * page had no session probe and no video scripts). Null when no adapter claims the host.
   */
  forUrl(url: string | undefined | null): string | null {
    if (!url) return null;
    let host: string;
    try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
    for (const [name, spec] of this.adapters) {
      for (const m of spec.match ?? []) {
        const h = m.toLowerCase();
        if (host === h || host.endsWith("." + h)) return name;
      }
    }
    return null;
  }
}
