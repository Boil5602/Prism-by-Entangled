using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// A channel's card (2026-10-11, YouTube: "Maybe details could show the channel profile desc" - "That way you can search for content by
/// the user"): a channel card on Watch (a service's own row, kind "channel") opens this instead of a title's Details. Core reads the
/// channel's own page on the service's hidden page (adapter videoChannelInfo): its name, description, counts, picture and latest videos.
/// The card offers Open channel (its page in the big window), Search this channel (the channel's own search page in the big window,
/// where the phone's keyboard types), and the latest videos, each a press to play. Nothing here is TMDB's: a channel is the service's
/// own thing.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _channelCard;
    private int _channelRun;

    private void CloseChannelCard() { _channelRun++; if (_channelCard is { } c) { RootGrid.Children.Remove(c); _channelCard = null; } }

    private async Task ShowChannelCardAsync(string app, string service, string id, string title, string? url)
    {
        CloseChannelCard();
        var run = _channelRun;
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE0, 0x05, 0x06, 0x09)) };
        Canvas.SetZIndex(scrim, 975);
        var card = new StackPanel { Spacing = 14, Padding = new Thickness(28), Background = HubCard, CornerRadius = new CornerRadius(12), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Width = 900 };
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
        var pic = new Border { Width = 96, Height = 96, CornerRadius = new CornerRadius(48), Background = HubClear };
        var words = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        words.Children.Add(new TextBlock { Text = title, FontSize = 26, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap });
        var facts = new TextBlock { Text = service, FontSize = 15, Foreground = HubInk };
        words.Children.Add(facts);
        head.Children.Add(pic); head.Children.Add(words);
        card.Children.Add(head);
        var desc = new TextBlock { Text = "Reading the channel's page" + (char)0x2026, FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxLines = 8, TextTrimming = TextTrimming.CharacterEllipsis };
        card.Children.Add(desc);
        var latestHead = new TextBlock { Text = "Latest videos", FontSize = 17, Foreground = HubInk, Visibility = Visibility.Collapsed };
        var latest = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        var latestScroll = new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = latest, Visibility = Visibility.Collapsed };
        card.Children.Add(latestHead); card.Children.Add(latestScroll);
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 4, 0, 0) };
        Button Verb(string text, bool main, Action press)
        {
            var b = Chip(new TextBlock { Text = text, FontSize = 16, Foreground = HubInk }, main);
            b.Click += (_, __) => press();
            return b;
        }
        var baseUrl = url ?? "";
        var searchUrl = "";
        void OpenOnScreen(string to, string what)
        {
            if (!to.StartsWith("https://", StringComparison.Ordinal)) return;
            CloseChannelCard(); CloseVideoHub();
            var cand = new JsonObject { ["id"] = to, ["title"] = what, ["kind"] = "video", ["url"] = to };
            _ = PlayResultAsync(app, cand.ToJsonString(), what, service);
        }
        var open = Verb("Open channel", true, () => OpenOnScreen(baseUrl, title));
        ToolTipService.SetToolTip(open, "The channel's own page on " + service + ", in the big window.");
        row.Children.Add(open);
        var search = Verb("Search this channel", false, () => OpenOnScreen(searchUrl, title + ": search"));
        ToolTipService.SetToolTip(search, "The channel's own search page, in the big window. Your phone's Keyboard tab types into it.");
        search.IsEnabled = false;
        row.Children.Add(search);
        row.Children.Add(Verb("Close", false, CloseChannelCard));
        card.Children.Add(row);
        scrim.PointerPressed += (_, __) => CloseChannelCard();
        card.PointerPressed += (_, e) => e.Handled = true;
        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; CloseChannelCard(); };
        scrim.KeyboardAccelerators.Add(esc);
        scrim.Children.Add(card);
        RootGrid.Children.Add(scrim);
        _channelCard = scrim;
        LogLine("channel card: " + service + " " + id);

        JsonObject? ch = null;
        // the channel's Videos tab, where its latest videos are listed (its home tab is shelves): a bare channel address gets /videos
        var readAt = System.Text.RegularExpressions.Regex.IsMatch(baseUrl, @"^https://www\.youtube\.com/(@[^/?#]+|channel/[^/?#]+)/?$") ? baseUrl.TrimEnd('/') + "/videos" : baseUrl;
        try { ch = (JsonNode.Parse(await ModelCallAwaitAsync("videoChannelInfo", 50000, app, readAt) ?? "null") as JsonObject)?["channel"] as JsonObject; } catch { }
        if (run != _channelRun) return;
        if (ch is null) { desc.Text = "The channel's page could not be read just now. Open channel still works."; return; }
        var name = S(ch, "name"); if (name.Length > 0) ((TextBlock)words.Children[0]).Text = name;
        var bits = new List<string> { service };
        if (S(ch, "handle").Length > 0) bits.Add(S(ch, "handle"));
        if (S(ch, "subscribers").Length > 0) bits.Add(S(ch, "subscribers"));
        if (S(ch, "videos").Length > 0) bits.Add(S(ch, "videos"));
        facts.Text = string.Join("  " + (char)0x00B7 + "  ", bits);
        var d = S(ch, "description");
        desc.Text = d.Length > 0 ? d : "This channel gives no description.";
        if (S(ch, "avatar") is { Length: > 0 } av) { try { pic.Child = new Image { Source = new BitmapImage(Services.ArtCache.UriFor(av)), Stretch = Stretch.UniformToFill }; } catch { } }
        if (S(ch, "url").StartsWith("https://", StringComparison.Ordinal)) baseUrl = S(ch, "url");
        if (S(ch, "searchUrl").StartsWith("https://", StringComparison.Ordinal)) { searchUrl = S(ch, "searchUrl"); search.IsEnabled = true; }
        if (ch["latest"] is JsonArray lat && lat.Count > 0)
        {
            foreach (var v in lat.OfType<JsonObject>().Take(12))
            {
                var vt = S(v, "title"); var vu = S(v, "url"); var va = S(v, "artwork");
                var cell = new StackPanel { Spacing = 4, Width = 150 };
                var art = new Border { Width = 150, Height = 84, CornerRadius = new CornerRadius(6), Background = HubClear };
                if (va.Length > 0) { try { art.Child = new Image { Source = new BitmapImage(Services.ArtCache.UriFor(va)), Stretch = Stretch.UniformToFill }; } catch { } }
                cell.Children.Add(art);
                cell.Children.Add(new TextBlock { Text = vt, FontSize = 12, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxLines = 2, TextTrimming = TextTrimming.CharacterEllipsis });
                if (S(v, "subtitle").Length > 0) cell.Children.Add(new TextBlock { Text = S(v, "subtitle"), FontSize = 11, Foreground = HubDim });
                var b = new Button { Content = cell, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(4) };
                ToolTipService.SetToolTip(b, "Plays " + vt + " on " + service + " in the big window.");
                b.Click += (_, __) => OpenOnScreen(vu, vt);
                latest.Children.Add(b);
            }
            latestHead.Visibility = Visibility.Visible; latestScroll.Visibility = Visibility.Visible;
        }
    }
}
