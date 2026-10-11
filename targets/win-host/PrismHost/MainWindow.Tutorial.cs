using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// How Prism works (2026-10-10, "Let's build a tutorial with screenshots into Prism"): a menu of subjects, each a short run of pages
/// with a picture, a few plain lines and, where there is one, a button that opens the real thing ("Lets make tutorial a menu of
/// subjects they can select from, so if they want they can continue on when a topic is ended or stop right there"). A subject's last
/// page offers the next subject, the list, or Done. It opens once after the services are set up and from the Prism menu at any time,
/// where it comes back to where it was left. The subjects and their words are in MainWindow.TutorialText.cs.
///
/// The pictures are files beside the app (Assets/tutorial/NAME.png), one a page, each optional: a page with no picture shows its words
/// alone. They are made with stand-in posters and made-up titles, never a studio's artwork (the user, 2026-10-10: "yes, use
/// placeholders"); a service's own name and logo may show, to say which service it is (docs/third-party-services-policy.md).
/// </summary>
public sealed partial class MainWindow
{
    private sealed record TutorialPage(string Picture, string Title, string Body, string[] Points, string? Verb = null, Action<MainWindow>? Do = null);
    private sealed record TutorialTopic(string Id, string Title, string About, TutorialPage[] Pages);

    private Grid? _tutorial;
    private int _tutorialTopic = -1;   // -1: the list of subjects
    private int _tutorialPage;

    private void CloseTutorial() { if (_tutorial is { } t) { RootGrid.Children.Remove(t); _tutorial = null; } }

    /// <summary>The tour was entered from the Watch page: leaving it goes back there (2026-10-11, "When the tutorial closes, it goes to the video
    /// screens but i entered from watch so should immediately return to watch": a page of the tour had opened Set up services, which
    /// puts the Watch page away).</summary>
    private bool _tourFromWatch;

    /// <summary>The person leaves the tour (Close, Done, Escape): back to the Watch page if that is where they came in from.</summary>
    private void LeaveTutorial()
    {
        CloseTutorial();
        var back = _tourFromWatch; _tourFromWatch = false;
        if (back && !VideoHubOpen && WatchGrip.Visibility == Visibility.Visible) { LogLine("tutorial: left, back to the Watch page"); _ = ShowVideoHubAsync(); }
    }

    /// <summary>The subjects a person has been through to the end (their ids), kept so the list can tick them.</summary>
    private static HashSet<string> TutorialDone() => new(HostPrefs.GetString("tutorial.done", "").Split(',', StringSplitOptions.RemoveEmptyEntries));

    private void ShowTutorial()
    {
        if (VideoHubOpen) _tourFromWatch = true;
        CloseTutorial();
        HostPrefs.Set("tutorial.seen", true);
        var topics = TutorialTopics();
        if (_tutorialTopic >= topics.Length) _tutorialTopic = -1;
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE0, 0x05, 0x06, 0x09)) };
        Canvas.SetZIndex(scrim, 984);   // under a pairing code, the TMDB approval and the TMDB guide, which a page can open
        var card = new StackPanel { Spacing = 12, Padding = new Thickness(28), Background = HubCard, CornerRadius = new CornerRadius(12), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Width = 760 };
        scrim.PointerPressed += (_, e) => e.Handled = true;
        scrim.Children.Add(new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = card });
        RootGrid.Children.Add(scrim);
        _tutorial = scrim;
        LogLine("tutorial: opened");

        Button Verb(string text, bool main, Action press)
        {
            var b = Chip(new TextBlock { Text = text, FontSize = 14, Foreground = HubInk }, main);
            b.Click += (_, __) => press();
            return b;
        }
        StackPanel Row() => new() { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 6, 0, 0) };

        void Draw()
        {
            card.Children.Clear();
            if (_tutorialTopic < 0) DrawList(); else DrawPage();
        }

        void Open(int topic) { _tutorialTopic = topic; _tutorialPage = 0; LogLine("tutorial: " + (topic < 0 ? "the list" : topics[topic].Id)); Draw(); }

        void DrawList()
        {
            var done = TutorialDone();
            card.Children.Add(new TextBlock { Text = "How Prism works", FontSize = 22, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
            card.Children.Add(new TextBlock { Text = "Pick a subject. Each takes a minute or two, and you can stop after any of them.", FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
            for (var i = 0; i < topics.Length; i++)
            {
                var t = topics[i]; var at = i;
                var line = new StackPanel { Spacing = 2 };
                line.Children.Add(new TextBlock { Text = (done.Contains(t.Id) ? (char)0x2713 + "  " : "") + t.Title, FontSize = 16, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
                line.Children.Add(new TextBlock { Text = t.About, FontSize = 13, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });   // the secondary line under its primary
                var b = Chip(line, false);
                b.HorizontalAlignment = HorizontalAlignment.Stretch; b.HorizontalContentAlignment = HorizontalAlignment.Left;
                b.Click += (_, __) => Open(at);
                card.Children.Add(b);
            }
            var row = Row();
            row.Children.Add(Verb("Close", false, LeaveTutorial));
            // the notice and its short introduction, again for whoever wants them (2026-10-11, "an option to re-enable the tutorial notification ... because it's both useful and interesting")
            var again = Verb("Show the notice again", false, TourNoticeAgain);
            ToolTipService.SetToolTip(again, "Puts the notice about this tour back at the top of the screen. Its Show me plays the short introduction, then opens the tour.");
            row.Children.Add(again);
            card.Children.Add(row);
        }

        void DrawPage()
        {
            var t = topics[_tutorialTopic];
            _tutorialPage = Math.Clamp(_tutorialPage, 0, t.Pages.Length - 1);
            var p = t.Pages[_tutorialPage];
            var last = _tutorialPage == t.Pages.Length - 1;
            card.Children.Add(new TextBlock { Text = t.Title + Dot + (_tutorialPage + 1) + " of " + t.Pages.Length, FontSize = 13, Foreground = HubAmber });
            card.Children.Add(new TextBlock { Text = p.Title, FontSize = 22, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap });
            try
            {
                var file = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "tutorial", p.Picture + ".png");
                if (System.IO.File.Exists(file))
                    card.Children.Add(new Border { CornerRadius = new CornerRadius(8), HorizontalAlignment = HorizontalAlignment.Center, Child = new Image { Source = new BitmapImage(new Uri(file)), MaxHeight = 420, Stretch = Stretch.Uniform } });
            }
            catch (Exception ex) { LogLine("tutorial: picture " + ex.Message); }
            card.Children.Add(new TextBlock { Text = p.Body, FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
            if (p.Points.Length > 0)
            {
                var points = new StackPanel { Spacing = 4, Margin = new Thickness(4, 0, 0, 0) };
                foreach (var line in p.Points) points.Children.Add(new TextBlock { Text = (char)0x2022 + "  " + line, FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
                card.Children.Add(points);
            }
            // the real thing, opened with the tour out of its way: the Prism menu's How Prism works comes back to this page
            if (p.Verb is { } verb && p.Do is { } act)
            {
                var tryRow = Row();
                var go = Verb(verb, false, () => { CloseTutorial(); LogLine("tutorial: " + verb); TourLaunched(); act(this); });   // the way back goes up with it (MainWindow.TutorialReturn.cs)
                ToolTipService.SetToolTip(go, "This opens the real thing. Back to How Prism works, at the top of the screen, brings you back to this page.");
                tryRow.Children.Add(go);
                card.Children.Add(tryRow);
            }
            var row = Row();
            if (_tutorialPage > 0) row.Children.Add(Verb("Back", false, () => { _tutorialPage--; Draw(); }));
            if (!last) row.Children.Add(Verb("Next", true, () => { _tutorialPage++; Draw(); }));
            else
            {
                // the subject is ended: on to the next one, back to the list, or stop right here
                var done = TutorialDone();
                if (done.Add(t.Id)) HostPrefs.Set("tutorial.done", string.Join(",", done));
                var next = _tutorialTopic + 1;
                if (next < topics.Length) row.Children.Add(Verb("Next: " + topics[next].Title, true, () => Open(next)));
                row.Children.Add(Verb("Done", next >= topics.Length, () => { _tutorialTopic = -1; LeaveTutorial(); }));
            }
            row.Children.Add(Verb("All subjects", false, () => Open(-1)));
            card.Children.Add(row);
        }

        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; LeaveTutorial(); };
        scrim.KeyboardAccelerators.Add(esc);
        Draw();
        scrim.Focus(FocusState.Programmatic);
    }
}
