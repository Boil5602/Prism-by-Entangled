using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost.Surfaces;

/// <summary>
/// Ad debug (2026-10-07, "how do I say something IS an ad that is playing. I can't even tell something is not an ad without hiding the ad
/// itself"): while it is on, no cover is drawn - every window shows what it plays - and each visible window carries a strip at its foot:
/// "Intermission: ON" (green) or "OFF" (red), the cover Prism would draw right now, and two reports, Not an ad and This is an ad, for any
/// service. A cover that comes up is kept as state (Covered) but not shown; switched off, the covers that are up are drawn again.
/// </summary>
public sealed partial class SurfaceManager
{
    private bool _adDebug;
    private readonly Dictionary<string, (Border Strip, Border State, TextBlock StateText)> _debugStrips = new();
    /// <summary>A debug report from a window's strip: the window, and whether the person says an ad is playing.</summary>
    public event Action<string, bool>? AdDebugReport;
    /// <summary>How far above the big window's foot its strip sits: clear of the Prism controls (set by the window as the bar sizes).</summary>
    public double BigWindowFoot { get; set; } = 120;

    public bool AdDebug
    {
        get => _adDebug;
        set
        {
            if (_adDebug == value) return;
            _adDebug = value;
            foreach (var t in _tiles.Values)
            {
                if (t.Intermission is { } g && t.Covered && !t.Peeked)
                {
                    Fade(g, g.Opacity, value || t.Look != "veil" ? 0 : 1, 150);
                    g.IsHitTestVisible = !value && t.Look == "veil";
                }
            }
            SyncAdDebug();
        }
    }

    /// <summary>The strips on every visible window (made for new windows, removed from gone ones, the state kept current).</summary>
    public void SyncAdDebug()
    {
        foreach (var id in _debugStrips.Keys.ToList())
        {
            var t = Get(id);
            var keep = _adDebug && t is not null && DebugWindow(t);
            if (keep) continue;
            if (t is not null) t.Container.Children.Remove(_debugStrips[id].Strip);
            _debugStrips.Remove(id);
        }
        if (!_adDebug) return;
        // at each window's foot (2026-10-07, "New buttons are overlapping with prism menu. How about at the bottom above the controls"): the big
        // window's strip sits above the Prism controls that come up over its foot
        var big = _tiles.Values.Where(DebugWindow).OrderByDescending(x => x.Container.ActualWidth * x.Container.ActualHeight).FirstOrDefault();
        foreach (var (sid, ds) in _debugStrips)
        {
            var want = new Thickness(0, 0, 0, big is not null && sid == big.Id ? BigWindowFoot : 10);
            if (!ds.Strip.Margin.Equals(want)) ds.Strip.Margin = want;
        }
        foreach (var t in _tiles.Values)
        {
            if (!DebugWindow(t)) continue;
            if (!_debugStrips.TryGetValue(t.Id, out var s)) { s = MakeStrip(t); _debugStrips[t.Id] = s; }
            var on = t.Covered;
            s.State.Background = new SolidColorBrush(on ? Windows.UI.Color.FromArgb(0xFF, 0x2E, 0x7D, 0x32) : Windows.UI.Color.FromArgb(0xFF, 0xB7, 0x1C, 0x1C));
            s.StateText.Text = "Intermission: " + (on ? "ON" : "OFF");
        }
    }

    /// <summary>A window a person watches: on the wall, not a hidden page, not a work or lookup page, not a soundscape.</summary>
    private static bool DebugWindow(Tile t) =>
        t.Kind != SurfaceKind.Hidden && !t.HiddenPresence && t.View is not null
        && !t.Id.StartsWith("app:", StringComparison.Ordinal) && !t.Id.StartsWith("ambient:", StringComparison.Ordinal);

    private (Border Strip, Border State, TextBlock StateText) MakeStrip(Tile t)
    {
        var ink = Windows.UI.Color.FromArgb(0xFF, 0xE8, 0xEC, 0xF2);
        var stateText = new TextBlock { FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(ink) };
        var state = new Border { Child = stateText, Padding = new Thickness(8, 3, 8, 3), CornerRadius = new CornerRadius(6), VerticalAlignment = VerticalAlignment.Center };
        Button Report(string label, bool isAd, string tip)
        {
            var b = new Button
            {
                Content = new TextBlock { Text = label, FontSize = 12, Foreground = new SolidColorBrush(ink) },
                Padding = new Thickness(8, 3, 8, 3), CornerRadius = new CornerRadius(6),
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE6, 0x1C, 0x21, 0x29)), BorderThickness = new Thickness(0),
            };
            MainWindow.OwnHover(b);
            ToolTipService.SetToolTip(b, tip);
            var id = t.Id;
            b.Click += (_, __) => AdDebugReport?.Invoke(id, isAd);
            return b;
        }
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        row.Children.Add(state);
        row.Children.Add(Report("Not an ad", false, "The show is playing here: report it if Intermission says ON"));
        row.Children.Add(Report("This is an ad", true, "An ad is playing here: report it if Intermission says OFF"));
        var strip = new Border
        {
            Child = row, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 10),
            Padding = new Thickness(4), CornerRadius = new CornerRadius(8), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xB0, 0x0A, 0x0C, 0x0F)),
        };
        Canvas.SetZIndex(strip, 60);   // above the (undrawn) cover and the page
        t.Container.Children.Add(strip);
        return (strip, state, stateText);
    }
}
