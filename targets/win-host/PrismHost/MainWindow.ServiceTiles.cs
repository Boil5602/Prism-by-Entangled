using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Watch's Services row as drawn tiles (2026-09-25, "is there not a rectangular logo item for each service?" - the posters the sites give
/// are square icons or wide social pictures, cut off or lost on a wide card): every service the same shape - its own icon, its name, its
/// colour. Nothing downloaded beyond the icon the poster cache already keeps, nothing to license, and the row always lines up.
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>Each service's colour, from its own branding. A service not listed takes the colour its site declares (the poster cache's), else Prism's amber.</summary>
    private static readonly Dictionary<string, string> BrandColors = new(StringComparer.OrdinalIgnoreCase)
    {
        ["netflix"] = "#E50914", ["hulu"] = "#1CE783", ["disneyplus"] = "#113CCF", ["paramountplus"] = "#0064FF",
        ["peacock"] = "#6E55DC", ["appletv"] = "#A2AAAD", ["hbomax"] = "#002BE7", ["primevideo"] = "#00A8E1",
        ["tubi"] = "#7408FF", ["fandango"] = "#FF7300", ["moviesanywhere"] = "#3AA0FF", ["youtube"] = "#FF0000", ["twitch"] = "#9146FF",
    };

    private static Windows.UI.Color? ParseHex(string? hex)
    {
        if (hex is not { Length: 7 } || hex[0] != '#') return null;
        try { return Windows.UI.Color.FromArgb(255, Convert.ToByte(hex.Substring(1, 2), 16), Convert.ToByte(hex.Substring(3, 2), 16), Convert.ToByte(hex.Substring(5, 2), 16)); }
        catch { return null; }
    }

    /// <summary>The colour a card is drawn in: the brand's own hue taken down toward the dark card, so light ink reads on every one of them
    /// (Hulu's green and Apple's silver included); the pure colour is kept for the edge along the bottom.</summary>
    private static Windows.UI.Color Toward(Windows.UI.Color c, Windows.UI.Color dark, double keep) =>
        Windows.UI.Color.FromArgb(255, (byte)(c.R * keep + dark.R * (1 - keep)), (byte)(c.G * keep + dark.G * (1 - keep)), (byte)(c.B * keep + dark.B * (1 - keep)));

    /// <summary>One service's tile: icon and name on its colour. `on` marks the one on the screen (amber edge and name).</summary>
    private Grid ServiceTile(string app, string name, bool on, double width = 210, double height = 118)
    {
        var entry = _catalog.FirstOrDefault(c => c.Id == (_model.App(app)?.CatalogRef ?? app)) ?? _catalog.FirstOrDefault(c => c.Adapter == app);
        var adapter = entry?.Adapter ?? app;
        var dark = Windows.UI.Color.FromArgb(255, 0x16, 0x1A, 0x20);
        var brand = ParseHex(BrandColors.TryGetValue(adapter, out var hx) ? hx : BrandColors.TryGetValue(app, out var hx2) ? hx2 : null) ?? Windows.UI.Color.FromArgb(255, 0xF2, 0xB1, 0x4C);
        var fill = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(1, 1) };
        fill.GradientStops.Add(new GradientStop { Color = Toward(brand, dark, 0.55), Offset = 0 });
        fill.GradientStops.Add(new GradientStop { Color = Toward(brand, dark, 0.22), Offset = 1 });
        var card = new Border
        {
            Width = width, Height = height, CornerRadius = new CornerRadius(8), Background = fill,
            BorderBrush = on ? HubAmber : new SolidColorBrush(Windows.UI.Color.FromArgb(0x30, 0xFF, 0xFF, 0xFF)), BorderThickness = new Thickness(on ? 2 : 1),
        };
        var inner = new Grid();
        // the pure colour along the bottom edge: the brand as the service shows it
        inner.Children.Add(new Border { Height = 4, VerticalAlignment = VerticalAlignment.Bottom, Background = new SolidColorBrush(brand), CornerRadius = new CornerRadius(0, 0, 7, 7) });
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(12, 0, 12, 4) };
        row.Children.Add(ServiceMark(app, name, 52));
        row.Children.Add(new TextBlock
        {
            Text = name, FontSize = 19, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = on ? HubAmber : HubInk,
            VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.WrapWholeWords, MaxWidth = width - 52 - 12 - 30, MaxLines = 2, TextTrimming = TextTrimming.CharacterEllipsis,
        });
        inner.Children.Add(row);
        card.Child = inner;
        // a service not in the list: the colour its own site declares, once the poster cache has it
        if (!BrandColors.ContainsKey(adapter) && !BrandColors.ContainsKey(app) && entry is not null)
            _ = _posters.GetMarkAsync(entry.Id, entry.Name, entry.Url).ContinueWith(t =>
            {
                if (t.IsCompletedSuccessfully && ParseHex(t.Result.BackgroundColor) is { } site) RootGrid.DispatcherQueue.TryEnqueue(() =>
                {
                    fill.GradientStops[0].Color = Toward(site, dark, 0.55); fill.GradientStops[1].Color = Toward(site, dark, 0.22);
                    if (inner.Children[0] is Border edge) edge.Background = new SolidColorBrush(site);
                });
            });
        var g = new Grid { Width = width, Height = height };
        g.Children.Add(card);
        return g;
    }
}
