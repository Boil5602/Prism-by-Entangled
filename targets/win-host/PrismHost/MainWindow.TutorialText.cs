using System.Text.Json;

namespace PrismHost;

/// <summary>
/// The subjects of How Prism works and their words (the frame is MainWindow.Tutorial.cs), read from Assets/tutorial/tutorial.json:
/// the one source, which the website's tour page reads a copy of (2026-10-11, "make the tutorial available on the website ... Is
/// there any way to keep them in sync?"; scripts/release/sync-tutorial.py copies it there at every release and checks the two agree).
/// Every label the file names was read from the code: a label that changes there changes in the file in the same commit. A page's
/// picture is Assets/tutorial/NAME.png. What a page can open is named in the file by an action, and the actions are here.
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>The real things a page of the tour can open, by the name the file gives them.</summary>
    private static readonly Dictionary<string, Action<MainWindow>> TutorialActions = new(StringComparer.Ordinal)
    {
        ["setup-services"] = w => _ = w.ShowWelcomeAsync(),
        ["tmdb-guide"] = w => _ = w.ShowTmdbGuideAsync(),
        ["watch-settings"] = w => _ = w.ShowWatchSettingsAsync(),
        ["pair-phone"] = w => w.PairPhone(),
        ["profiles"] = w => _ = w.ShowProfilesWindowAsync(),
        ["updates"] = w => _ = w.ShowUpdatesAsync(),
    };

    private static TutorialTopic[]? s_tutorialTopics;

    private static TutorialTopic[] TutorialTopics()
    {
        if (s_tutorialTopics is not null) return s_tutorialTopics;
        var topics = new List<TutorialTopic>();
        try
        {
            var file = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "tutorial", "tutorial.json");
            using var doc = JsonDocument.Parse(System.IO.File.ReadAllText(file));
            static string S(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
            foreach (var s in doc.RootElement.GetProperty("subjects").EnumerateArray())
            {
                var pages = new List<TutorialPage>();
                foreach (var p in s.GetProperty("pages").EnumerateArray())
                {
                    var points = p.TryGetProperty("points", out var pts) && pts.ValueKind == JsonValueKind.Array ? pts.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0).ToArray() : Array.Empty<string>();
                    string? verb = null; Action<MainWindow>? act = null;
                    // a page offers the real thing only when this build knows how to open it
                    if (p.TryGetProperty("open", out var open) && open.ValueKind == JsonValueKind.Object && TutorialActions.TryGetValue(S(open, "action"), out var known) && S(open, "label").Length > 0) { verb = S(open, "label"); act = known; }
                    pages.Add(new TutorialPage(S(p, "picture"), S(p, "title"), S(p, "body"), points, verb, act));
                }
                if (pages.Count > 0) topics.Add(new TutorialTopic(S(s, "id"), S(s, "title"), S(s, "about"), pages.ToArray()));
            }
        }
        catch (Exception ex) { s_devLog?.Invoke("tutorial: its pages could not be read: " + ex.GetType().Name + ": " + ex.Message); }
        // a copy of Prism without the file still says where the tour is, and never an empty list
        if (topics.Count == 0)
            topics.Add(new TutorialTopic("missing", "How Prism works", "The tour's pages are missing from this copy of Prism.", new[]
            {
                new TutorialPage("", "The tour's pages are missing", "This copy of Prism came without the tour's pages. The same tour is on Prism's website, under Tour.", Array.Empty<string>()),
            }));
        return s_tutorialTopics = topics.ToArray();
    }
}
