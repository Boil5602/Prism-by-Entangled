using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Stand-ins for pictures of Prism (2026-10-10, the tutorial's pictures: "yes, use placeholders"): a dev switch, off at every start,
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
    };
    private static bool StandInFor(string fn) => s_standIn && (StandInCalls.Contains(fn) || fn.StartsWith("titleDetails", StringComparison.Ordinal) || fn.StartsWith("videoSearch", StringComparison.Ordinal) || fn.StartsWith("videoLookup", StringComparison.Ordinal));

    private static uint StandInHash(string s) { unchecked { uint h = 2166136261; foreach (var c in s) { h ^= c; h *= 16777619; } return h; } }
    private static string StandInTitle(string real) => StandInTitles[StandInHash(real) % (uint)StandInTitles.Length];
    private static string StandInPerson(string real) => StandInPeople[StandInHash(real) % (uint)StandInPeople.Length];

    private static readonly string[] ItemMarks = { "artwork", "poster", "backdrop", "kind", "url", "tmdbId", "rating", "released", "year", "still" };
    private static readonly string[] ProseKeys = { "overview", "description", "tagline", "plot", "summary", "biography", "bio" };
    private static readonly string[] SeriesKeys = { "showTitle", "seriesTitle", "series", "collection", "show" };
    private static readonly string[] AccountKeys = { "username", "signedInAs", "account", "email", "user", "profileName", "as" };
    private static readonly Regex EpisodeMark = new(@"^S\d+\s*E\d+", RegexOptions.CultureInvariant);

    /// <summary>The answer of a call that feeds a page, with its titles, people and account names replaced. Anything unparseable passes through.</summary>
    private static string? StandInScrub(string? json)
    {
        if (json is null) return null;
        try { var node = JsonNode.Parse(json); if (node is null) return json; StandInWalk(node, "", false); return node.ToJsonString(); }
        catch { return json; }
    }

    private static void StandInWalk(JsonNode node, string key, bool personal)
    {
        if (node is JsonArray arr) { foreach (var x in arr) if (x is not null) StandInWalk(x, key, personal); return; }
        if (node is not JsonObject o) return;
        static bool Str(JsonObject j, string k, out string v) { v = ""; if (j[k] is JsonValue jv && jv.TryGetValue<string>(out var s) && s.Length > 0) { v = s; return true; } return false; }
        var isRow = o["items"] is JsonArray || o["cards"] is JsonArray || o["rows"] is JsonArray;
        if (!isRow && Str(o, "title", out var title) && ItemMarks.Any(m => o.ContainsKey(m)))
        {
            o["title"] = StandInTitle(title);
            if (Str(o, "subtitle", out var sub)) { var m = EpisodeMark.Match(sub); o["subtitle"] = m.Success ? m.Value : ""; }
            foreach (var k in SeriesKeys) if (Str(o, k, out var sv)) o[k] = StandInTitle(sv);
            if (Str(o, "role", out _)) o["role"] = "";   // the part a person played in it
        }
        foreach (var k in ProseKeys) if (Str(o, k, out _)) o[k] = "A stand-in description, written for the pictures in Prism's tutorial. The real page shows the title's own.";
        // a person: a cast member, or a search result that is a person
        if (Str(o, "name", out var name) && (o.ContainsKey("character") || o.ContainsKey("profile") || o.ContainsKey("face") || o.ContainsKey("knownFor") || o.ContainsKey("department") || o.ContainsKey("born") || o.ContainsKey("bio") || o.ContainsKey("known")))
        {
            o["name"] = StandInPerson(name);
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
            StandInWalk(kv.Value, kv.Key, deeper && kv.Key != "services");
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
        LogLine("stand-in: " + (s_standIn ? "on" + (Services.ArtCache.StandInDir is null ? " (no picture folder)" : "") : "off"));
    }
}
