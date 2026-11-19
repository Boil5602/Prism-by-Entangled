using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Stand-ins for pictures of PRISM (2026-10-10, the tutorial's pictures): a dev switch, off at every start,
/// under which the pages draw made-up titles on plain coloured cards. A studio's artwork is not ours to put in a public repository
/// and the download, and what a household watches and what its people are called is nobody's business. Three parts:
///   - every picture drawn from an address (posters, stills, faces, album art, avatars) comes from a folder of plain cards instead
///     (Services.ArtCache.StandInDir, one place, since every such picture is asked for there)
///   - the answers of the calls that feed the pages have their titles, people and account names replaced, by the name of the field
///   - words given by hand are replaced in whatever text is on screen when a dev shot is taken (the last net, for a name the fields
///     did not carry)
/// Only the drawing is changed: ids and addresses pass through, and nothing here is written back to core or to a service. The break
/// watch's own reads do not come through these calls.
/// </summary>
public sealed partial class MainWindow
{
    private static bool s_standIn;
    private static readonly Dictionary<string, string> s_standInWords = new(StringComparer.Ordinal);

    private static readonly string[] StandInTitles =
    {
        "The Lantern Coast", "Paper Satellites", "Northbound", "A Quiet Orchard", "Harbor Lights", "Midnight Cartography", "The Glass Season",
        "Second Summer", "Low Tide Radio", "Copper Sky", "The Ninth Bridge", "Winter Almanac", "Field Notes", "Salt and Ember",
        "The Long Way Round", "Small Hours", "Tin Star Diner", "Blue Hour", "Kite Weather", "Open Water", "Marigold Street", "Static Bloom",
        "Hollow Pines", "Last Train to Vesper", "Orbit Nine", "Sundown County", "The Paper Fox", "Driftwood", "Echo Valley High", "Honeycomb",
        "Night Market", "The Quiet Mile", "Juniper and Rye", "Signal Fire", "The Understudy", "Cloud Atlas Road", "Ferry to Nowhere",
        "The Seventh Lamp", "Riverside Nine", "A Year of Tuesdays", "Glasshouse", "The Mapmaker's Dog", "Half Past Maple", "Starling Avenue",
        "The Borrowed Boat", "Tall Ships", "Lemon Tree Lane", "After the Fair",
    };
    private static readonly string[] StandInPeople =
    {
        "Avery Collins", "Jordan Reyes", "Morgan Hale", "Riley Okafor", "Casey Lindqvist", "Taylor Brandt", "Quinn Maddox", "Rowan Ferreira",
        "Emery Tanaka", "Skyler Novak", "Harper Dunne", "Devon Achterberg", "Reese Whitlock", "Sasha Marlowe", "Jules Carraway", "Blake Osei",
    };
    private static readonly string[] StandInNames = { "Alex", "Sam", "Jo", "Robin" };
    private static readonly string[] StandInPresets = { "Evenings", "Weekend", "Kids" };
    private static readonly HashSet<string> StandInCalls = new(StringComparer.Ordinal)
    {
        "videoServices", "videoBrowse", "videoBrowseRow", "videoLibraryTab", "videoProfilesView", "signInsView", "videoSettings", "tmdbLinkState",
        "personPage", "titleAlsoOn", "videoMenu", "videoState",
        "videoBingeView", "videoBingeHidden", "titleEpisodes", "videoEpisodes", "playlistsView",   // 2026-11-17: The Binge's page, the episode lists, the playlists
    };
    // the music panel's calls (2026-11-17): its playlists, stations, songs and history are the household's own, and get made-up names and covers
    private static readonly HashSet<string> StandInMusicCalls = new(StringComparer.Ordinal)
    {
        "musicPanelHome", "musicPanelLibrary", "musicPanelPlay", "musicPanelNav", "musicSearchState", "musicUpNextState", "musicPlayNext",
    };
    private static readonly string[] StandInPlaylists =
    {
        "Evening Beats", "Road Mix", "Sunday Morning", "Kitchen Radio", "Slow Lanterns", "Porch Songs", "Late Drive", "Rainy Day Mix",
        "Garden Party", "Quiet Hours", "Summer Rewind", "Night Shift", "First Coffee", "Long Weekend", "Open Windows", "Campfire Set",
        "Back Roads", "Dinner at Eight", "Paper Boats", "Tall Grass", "Blue Hour", "Harbor Walk", "Saturday Chores", "Lantern Light",
        "Slow Train", "Window Seat", "Maple Street", "After the Rain", "Low Tide", "Morning Pages", "Front Porch", "Northbound",
    };
    private static readonly Dictionary<string, int> s_standInLists = new(StringComparer.Ordinal);   // real name -> its made-up name's place, so two lists never share one while one is free
    private static int StandInListIndex(string real)
    {
        if (s_standInLists.TryGetValue(real, out var kept)) return kept;
        if (s_standInLists.Count >= StandInPlaylists.Length) s_standInLists.Clear();
        var at = (int)(StandInHash(real) % (uint)StandInPlaylists.Length);
        while (s_standInLists.ContainsValue(at)) at = (at + 1) % StandInPlaylists.Length;
        s_standInLists[real] = at;
        return at;
    }
    private static readonly string[] StandInHouses = { "Northlight Pictures", "Kestrel Filmworks", "Tidewater Studio", "Lanternhouse", "Elm Ridge Pictures" };
    private static readonly Dictionary<string, string> StandInGenres = new(StringComparer.Ordinal)
    {
        ["thriller"] = "Thriller", ["mystery"] = "Mystery", ["comedy"] = "Comedy", ["romance"] = "Romance", ["drama"] = "Drama",
        ["western"] = "Western", ["scifi"] = "Science Fiction", ["kids"] = "Family", ["documentary"] = "Documentary",
    };
    private static bool StandInFor(string fn) => s_standIn && (StandInCalls.Contains(fn) || StandInMusicCalls.Contains(fn) || fn.StartsWith("titleDetails", StringComparison.Ordinal) || fn.StartsWith("videoSearch", StringComparison.Ordinal) || fn.StartsWith("videoLookup", StringComparison.Ordinal));

    /// <summary>The made-up title that stands for a real one (2026-11-17): its place in standin.json's titles, a show for a show and a film for a
    /// film when the kind is known, by the real title's hash, so one title keeps one stand-in and its poster carries the same words. -1 with no words file.</summary>
    private static int StandInIndex(string real, bool? show)
    {
        if (s_standInData?["titles"] is not JsonArray ts || ts.Count == 0) return -1;
        var pick = new List<int>();
        for (var i = 0; i < ts.Count; i++) { var isShow = (ts[i]?["kind"]?.GetValue<string>() ?? "") == "show"; if (show is null || isShow == show) pick.Add(i); }
        if (pick.Count == 0) return -1;
        // two real titles in one answer never share a stand-in while one is free: the next free place after the hash's
        if (s_standInTaken.TryGetValue(real, out var kept)) return kept;
        var at = (int)(StandInHash(real) % (uint)pick.Count);
        // a set of the places in use, so the look costs the same on a page of thousands (2026-11-17: a search of the map's values for
        // each title froze the window on The Binge's page); once every place is in use the hash's own place stands
        if (s_standInUsed.Count < ts.Count) for (var k = 0; k < pick.Count && s_standInUsed.Contains(pick[at]); k++) at = (at + 1) % pick.Count;
        if (s_standInTaken.Count < 4000) s_standInTaken[real] = pick[at];
        s_standInUsed.Add(pick[at]);
        return pick[at];
    }
    private static readonly HashSet<int> s_standInUsed = new();
    private static readonly Dictionary<string, int> s_standInTaken = new(StringComparer.Ordinal);   // real title -> its place, for the answer being scrubbed
    private static string StandInWord(int n, string key, string fallback)
    {
        try { return (s_standInData?["titles"] as JsonArray)?[n]?[key]?.GetValue<string>() is { Length: > 0 } s ? s : fallback; } catch { return fallback; }
    }
    /// <summary>An episode's made-up name: one of the stand-in show's own, by the real name's hash.</summary>
    private static string StandInEpisode(int n, string real)
    {
        try
        {
            var names = new List<string>();
            if ((s_standInData?["titles"] as JsonArray)?[n]?["episodes"] is JsonArray seasons)
                foreach (var season in seasons.OfType<JsonArray>()) foreach (var e in season) if (e?["name"]?.GetValue<string>() is { Length: > 0 } nm) names.Add(nm);
            if (names.Count > 0) return names[(int)(StandInHash(real) % (uint)names.Count)];
        }
        catch { }
        return "The Long Crossing";
    }

    /// <summary>The music panel's answers (2026-11-17): a song gets a made-up title, artist, album and that album's cover; a playlist, station or
    /// album gets a made-up name and a cover. A service's own name stays. Ids pass through, so a row still opens what it is.</summary>
    /// <param name="lists">the node sits under a key that holds the person's own lists (playlists, stations): a name there is replaced whatever else the entry carries</param>
    internal static void StandInMusicWalk(JsonNode? node, bool lists = false)
    {
        if (node is JsonArray arr) { foreach (var x in arr) StandInMusicWalk(x, lists); return; }
        if (node is not JsonObject o) return;
        static bool Str(JsonObject j, string k, out string v) { v = ""; if (j[k] is JsonValue jv && jv.TryGetValue<string>(out var s) && s.Length > 0) { v = s; return true; } return false; }
        if (Str(o, "title", out var title) && (o.ContainsKey("artist") || o.ContainsKey("album") || o.ContainsKey("artwork")))
        {
            var song = StandInSong(title);
            o["title"] = song?.Title ?? "Stand-in song";
            if (Str(o, "artist", out _)) o["artist"] = song?.Artist ?? "";
            if (Str(o, "album", out _)) o["album"] = song?.Album ?? "";
            if (Str(o, "artwork", out _)) o["artwork"] = song?.Art ?? "";
        }
        else if (Str(o, "name", out var name) && !o.ContainsKey("status") && (lists || o.ContainsKey("artwork") || (Str(o, "kind", out var kind) && kind is "playlist" or "station" or "album" or "artist" or "collection")))
        {
            var h = StandInHash(name);
            o["name"] = StandInPlaylists[StandInListIndex(name)];
            if (Str(o, "artwork", out _)) o["artwork"] = "standin:album-" + ((h >> 8) % 16).ToString("00");
            if (Str(o, "owner", out _)) o["owner"] = "Alex";
        }
        foreach (var kv in o.ToList()) if (kv.Value is JsonObject or JsonArray) StandInMusicWalk(kv.Value, kv.Key is "playlists" or "stations" or "collections" or "recents");
    }

    private static uint StandInHash(string s) { unchecked { uint h = 2166136261; foreach (var c in s) { h ^= c; h *= 16777619; } return h; } }
    private static string StandInTitle(string real) => StandInTitles[StandInHash(real) % (uint)StandInTitles.Length];
    private static string StandInPerson(string real) => StandInPeople[StandInHash(real) % (uint)StandInPeople.Length];

    private static readonly string[] ItemMarks = { "artwork", "poster", "backdrop", "kind", "url", "tmdbId", "rating", "released", "year", "still" };
    private static readonly string[] ProseKeys = { "overview", "description", "tagline", "plot", "summary", "biography", "bio" };
    private static readonly string[] SeriesKeys = { "showTitle", "seriesTitle", "series", "collection", "show" };
    private static readonly string[] AccountKeys = { "username", "signedInAs", "account", "email", "user", "profileName", "as" };
    private static readonly Regex EpisodeMark = new(@"^S\d+\s*E\d+", RegexOptions.CultureInvariant);

    private static JsonNode? s_standInData;   // standin.json of the picture folder (scripts/standin/make-standins.py): the made-up words that go with its pictures

    /// <summary>What a music stage shows for a track under stand-ins (2026-11-11): a made-up song, artist and album and that album's generated
    /// cover, picked by the real title so one track keeps one stand-in. Null when the folder has no words; the caller then shows nothing of the track.</summary>
    private static (string Title, string Artist, string Album, string Art)? StandInSong(string real)
    {
        try
        {
            if (s_standInData?["songs"] is not JsonArray songs || s_standInData["albums"] is not JsonArray albums || songs.Count == 0 || albums.Count == 0) return null;
            var h = StandInHash(real); var a = (int)(h % (uint)albums.Count);
            return (songs[(int)((h >> 8) % (uint)songs.Count)]!.GetValue<string>(), albums[a]!["artist"]!.GetValue<string>(), albums[a]!["album"]!.GetValue<string>(), "standin:album-" + a.ToString("00"));
        }
        catch { return null; }
    }

    /// <summary>The answer of a call that feeds a page, with its titles, people and account names replaced. Anything unparseable passes through.</summary>
    private static string? StandInScrub(string? json, string fn = "")
    {
        if (json is null) return null;
        try
        {
            var node = JsonNode.Parse(json); if (node is null) return json;
            if (s_standInTaken.Count > 400) { s_standInTaken.Clear(); s_standInUsed.Clear(); }   // kept across answers so a card and its Details agree, bounded
            // an episode list arrives without its series: its episodes take one stand-in show's names and stills
            if (StandInMusicCalls.Contains(fn)) StandInMusicWalk(node); else StandInWalk(node, "", false, fn.EndsWith("pisodes", StringComparison.Ordinal) ? StandInIndex("the episodes' series", true) : -1);
            return node.ToJsonString();
        }
        catch { return json; }
    }

    /// <param name="ctx">the stand-in title this node sits inside (its place in standin.json), -1 for none: an episode takes its name and still from it</param>
    private static void StandInWalk(JsonNode node, string key, bool personal, int ctx = -1)
    {
        if (node is JsonArray arr) { foreach (var x in arr) if (x is not null) StandInWalk(x, key, personal, ctx); return; }
        if (node is not JsonObject o) return;
        static bool Str(JsonObject j, string k, out string v) { v = ""; if (j[k] is JsonValue jv && jv.TryGetValue<string>(out var s) && s.Length > 0) { v = s; return true; } return false; }
        var isRow = o["items"] is JsonArray || o["cards"] is JsonArray || o["rows"] is JsonArray;
        if (!isRow && Str(o, "title", out var title) && ItemMarks.Any(m => o.ContainsKey(m)))
        {
            var episode = ctx >= 0 && o.ContainsKey("still") && !o.ContainsKey("poster") && !o.ContainsKey("backdrop") && !o.ContainsKey("artwork");
            if (episode)
            {
                // an episode inside a title: one of the stand-in show's own episode names, and one of that title's six stills
                o["title"] = StandInEpisode(ctx, title);
                if (Str(o, "still", out _)) o["still"] = "standin:still-" + ctx.ToString("00") + "-" + (StandInHash(title) % 6);
            }
            else
            {
                bool? show = Str(o, "kind", out var kd) ? (kd is "show" or "series" or "tv" ? true : kd is "movie" or "film" ? false : null) : null;
                if (show is null && Str(o, "subtitle", out var sub0) && EpisodeMark.IsMatch(sub0)) show = true;
                var n = StandInIndex(title, show);
                o["title"] = n >= 0 ? StandInWord(n, "title", StandInTitle(title)) : StandInTitle(title);
                if (n >= 0)
                {
                    // the title's own generated pictures, so the words on a card and on its picture agree
                    var nn = n.ToString("00");
                    if (Str(o, "poster", out _)) o["poster"] = "standin:poster-" + nn;
                    // a Details page (it has a poster and its facts) takes the wide picture with the title on it; a card writes the name itself
                    if (Str(o, "backdrop", out _)) o["backdrop"] = o.ContainsKey("poster") && (o.ContainsKey("cast") || o.ContainsKey("makers")) ? "standin:backdrop-" + nn : "standin:still-" + nn + "-0";
                    if (Str(o, "artwork", out _)) o["artwork"] = "standin:still-" + nn + "-0";   // a card writes the name itself, so its picture carries no words
                    if (Str(o, "still", out _)) o["still"] = "standin:still-" + nn + "-" + (StandInHash(title) % 6);
                    if (o["year"] is JsonValue yv && (s_standInData?["titles"] as JsonArray)?[n]?["year"] is JsonValue sy && sy.TryGetValue<int>(out var year))
                        o["year"] = yv.TryGetValue<string>(out _) ? JsonValue.Create(year.ToString()) : JsonValue.Create(year);
                    // a Details page's facts (2026-11-17): the crew are made-up people, the makers made-up houses, the genre the stand-in's own,
                    // and the dates keep their day in the stand-in's year
                    void Names(JsonNode? a)
                    {
                        if (a is not JsonArray ja) return;
                        for (var i = 0; i < ja.Count; i++) if (ja[i] is JsonValue pv && pv.TryGetValue<string>(out var real) && real.Length > 0)
                            ja[i] = JsonValue.Create(s_standInData?["people"] is JsonArray ppl && ppl.Count > 0 ? ppl[(int)(StandInHash(real) % (uint)ppl.Count)]?.GetValue<string>() ?? StandInPerson(real) : StandInPerson(real));
                    }
                    Names(o["writers"]); if (o["by"] is JsonObject by) Names(by["names"]);
                    if (o["makers"] is JsonArray mk) for (var i = 0; i < mk.Count; i++) if (mk[i] is JsonValue mv && mv.TryGetValue<string>(out var mreal)) mk[i] = JsonValue.Create(StandInHouses[StandInHash(mreal) % (uint)StandInHouses.Length]);
                    if (o["genres"] is JsonArray gs && gs.Count > 0 && gs[0] is JsonValue && StandInGenres.TryGetValue(StandInWord(n, "genre", ""), out var gname)) { gs.Clear(); gs.Add(JsonValue.Create(gname)); }
                    var syear = (s_standInData?["titles"] as JsonArray)?[n]?["year"]?.ToString() ?? "";
                    foreach (var dk in new[] { "first", "last" }) if (syear.Length == 4 && Str(o, dk, out var dv) && dv.Length >= 10) o[dk] = syear + dv.Substring(4);
                    ctx = n;
                }
            }
            if (Str(o, "subtitle", out var sub)) { var m = EpisodeMark.Match(sub); o["subtitle"] = m.Success ? m.Value : ""; }
            foreach (var k in SeriesKeys) if (Str(o, k, out var sv)) { var sn = StandInIndex(sv, true); o[k] = sn >= 0 ? StandInWord(sn, "title", StandInTitle(sv)) : StandInTitle(sv); }
            if (Str(o, "role", out _)) o["role"] = "";   // the part a person played in it
        }
        foreach (var k in ProseKeys) if (Str(o, k, out _)) o[k] = k == "tagline" && ctx >= 0 ? StandInWord(ctx, "tagline", "") : k is "biography" or "bio" || ctx < 0 ? "A stand-in description, written for the pictures in PRISM's tutorial. The real page shows the title's own." : StandInWord(ctx, "overview", "A stand-in description.");
        // a person: a cast member, or a search result that is a person
        if (Str(o, "name", out var name) && (o.ContainsKey("character") || o.ContainsKey("profile") || o.ContainsKey("face") || o.ContainsKey("photo") || o.ContainsKey("knownFor") || o.ContainsKey("department") || o.ContainsKey("born") || o.ContainsKey("bio") || o.ContainsKey("known")))
        {
            // a made-up person and that person's generated silhouette (never a face)
            if (s_standInData?["people"] is JsonArray people && people.Count > 0)
            {
                var pi = (int)(StandInHash(name) % (uint)people.Count);
                o["name"] = people[pi]?.GetValue<string>() ?? StandInPerson(name);
                foreach (var pk in new[] { "photo", "face", "profile" }) if (Str(o, pk, out _)) o[pk] = "standin:face-" + pi.ToString("00");
            }
            else o["name"] = StandInPerson(name);
            if (Str(o, "character", out _)) o["character"] = "";
            if (Str(o, "born", out _)) o["born"] = "1980-04-12";
        }
        // a profile on a service, a named sign-in, a preset: the household's own names
        if (Str(o, "name", out var pname) && (personal || o.ContainsKey("avatar"))) o["name"] = key == "presets" ? StandInPresets[StandInHash(pname) % (uint)StandInPresets.Length] : StandInNames[StandInHash(pname) % (uint)StandInNames.Length];
        foreach (var k in AccountKeys) if (Str(o, k, out _)) o[k] = "Alex";
        foreach (var kv in o.ToList())
        {
            if (kv.Value is null || kv.Key == "video") continue;   // what is playing now passes through untouched
            var deeper = personal || kv.Key is "signIns" or "presets" or "profiles" or "people";
            if (kv.Key == "signIns" && kv.Value is JsonObject si) { foreach (var e in si.ToList()) if (e.Value is JsonValue) si[e.Key] = "Alex"; continue; }
            StandInWalk(kv.Value, kv.Key, deeper && kv.Key != "services", ctx);
        }
    }

    /// <summary>Before a dev shot: the words given by hand replaced in every text on screen (whole words). The page's next draw puts its own back.</summary>
    private void StandInTexts()
    {
        if (!s_standIn || s_standInWords.Count == 0) return;
        void Walk(DependencyObject d)
        {
            if (d is TextBlock tb && tb.Text is { Length: > 0 } t)
            {
                var n = t;
                foreach (var kv in s_standInWords) n = Regex.Replace(n, @"\b" + Regex.Escape(kv.Key) + @"\b", kv.Value);
                if (!ReferenceEquals(n, t) && n != t) tb.Text = n;
            }
            for (int i = 0, c = VisualTreeHelper.GetChildrenCount(d); i < c; i++) Walk(VisualTreeHelper.GetChild(d, i));
        }
        Walk(RootGrid);
        foreach (var popup in VisualTreeHelper.GetOpenPopupsForXamlRoot(RootGrid.XamlRoot)) if (popup.Child is { } child) Walk(child);
    }

    /// <summary>"standin on|off" and "standin word REAL=SHOWN" (dev): the switch, and a word to replace in a shot.</summary>
    private void DevStandIn(string arg)
    {
        if (arg.StartsWith("word ", StringComparison.Ordinal))
        {
            var p = arg.Substring(5).Split('=', 2);
            if (p.Length == 2 && p[0].Trim().Length > 0) s_standInWords[p[0].Trim()] = p[1].Trim();
            LogLine("stand-in: " + s_standInWords.Count + " word(s) replaced in shots");
            return;
        }
        s_standIn = arg == "on";
        var dir = System.IO.Path.Combine(HostPaths.Diagnostics, "standin");
        Services.ArtCache.StandInDir = s_standIn && System.IO.Directory.Exists(dir) ? dir : null;
        s_standInData = null;
        if (s_standIn) { try { s_standInData = JsonNode.Parse(System.IO.File.ReadAllText(System.IO.Path.Combine(dir, "standin.json"))); } catch { } }
        LogLine("stand-in: " + (s_standIn ? "on" + (Services.ArtCache.StandInDir is null ? " (no picture folder)" : "") : "off"));
    }
}
