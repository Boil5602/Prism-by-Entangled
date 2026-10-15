using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The new-release rows' order (2026-10-15, "the new episodes last 10 days, new movies last 30 days, lets add the sort 'Release Date' and go by
/// latest first, and add the reverse button we have in the other lists. Just making this change for consistency"): a Release Date chip, lit as
/// the row's one order, and the round reverse switch My Watchlist and Continue watching have. Core keeps the choice; a press redraws the row in
/// place from core's answer, at its start.
/// </summary>
public sealed partial class MainWindow
{
    private FrameworkElement FreshOrderSwitch(JsonObject lr, StackPanel rowHost)
    {
        var id = S(lr, "id");
        var reverse = lr["reverse"]?.GetValue<bool>() == true;
        var box = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        foreach (var o in (lr["orders"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var b = Chip(new TextBlock { Text = S(o, "label"), FontSize = 12, Foreground = HubInk }, true);
            b.Padding = new Thickness(10, 3, 10, 3);
            if (S(o, "hint").Length > 0) ToolTipService.SetToolTip(b, S(o, "hint"));
            box.Children.Add(b);
        }
        var rev = Chip(new FontIcon { Glyph = "\uE8CB", FontSize = 13, Foreground = HubInk }, false);
        rev.Width = 28; rev.Height = 28; rev.Padding = new Thickness(0); rev.CornerRadius = new CornerRadius(14);
        rev.BorderThickness = new Thickness(1.5); rev.Margin = new Thickness(6, 0, 0, 0);
        void Paint()
        {
            rev.Background = reverse ? HubChipOn : RevOff;
            rev.BorderBrush = reverse ? HubAmber : HubDim;
            ((FontIcon)rev.Content).Foreground = reverse ? HubAmber : HubInk;
            ToolTipService.SetToolTip(rev, (reverse ? "Reverse is on: the oldest first. " : "Reverse is off: the newest first. ") + "Flips the order, so the title about to leave the row can come first.");
        }
        rev.Click += async (_, __) =>
        {
            reverse = !reverse; Paint();
            try { await ModelCallAsync("videoFreshOrder", id, reverse ? "1" : "0"); } catch { }
            JsonObject? menu = null;
            try { menu = JsonNode.Parse(await ModelCallAsync("videoMenuRows", true) ?? "null") as JsonObject; } catch { }
            var row = (menu?["lensRows"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(r => S(r, "id") == id);
            var cards = (row?["cards"] as JsonArray)?.OfType<JsonObject>().ToList();
            if (cards is null) return;
            var line = FindChild<ScrollViewer>(rowHost)?.Content as StackPanel;
            if (line is not null) UpdateRowInPlace(line, cards, true);
            else if (cards.Count > 0) { Button? none = null; rowHost.Children.Clear(); rowHost.Children.Add(BrowseRow(cards, ref none, true)); }
            rowHost.Tag = string.Join("|", cards.Select(c => S(c, "id")));
            FindChild<ScrollViewer>(rowHost)?.ChangeView(0, null, null, false);
        };
        box.Children.Add(rev);
        Paint();
        return box;
    }
}
