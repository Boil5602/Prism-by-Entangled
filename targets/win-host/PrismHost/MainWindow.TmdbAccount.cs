using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// The person's TMDB account on the wall (core tmdb-account.ts, 2026-10-03, "Let's build ratings writes to TMDB for individual accounts, if
/// linked"): the link under the key in Watch settings (a QR for the phone and an Open here for the wall, then "I approved it"), and the
/// stars on a title's details page that write the rating under that account. The host asks core and asks again a moment later; core does
/// the calls (the same ask-then-look pattern as the details themselves).
/// </summary>
public sealed partial class MainWindow
{
    private async Task<JsonObject?> TmdbLinkStateAsync()
    {
        try { return JsonNode.Parse(await ModelCallAsync("tmdbLinkState") ?? "null") as JsonObject; } catch { return null; }
    }

    /// <summary>The account line of the General tab: linked as whom, or how to link.</summary>
    private async Task BuildTmdbAccountAsync(StackPanel body, bool hasKey)
    {
        var state = await TmdbLinkStateAsync();
        if (state?["loading"]?.GetValue<bool>() == true) { await Task.Delay(400); state = await TmdbLinkStateAsync(); }
        var head = new TextBlock { Text = "TMDB account", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 14, 0, 0) };
        ToolTipService.SetToolTip(head, "Optional: the same TMDB account your key came from, approved once on TMDB's own site. With it, a star pressed on a title's details page is a rating on TMDB under your name, and your own ratings show on the wall. Prism keeps the session on this device and sends it to TMDB alone, only when you rate.");
        body.Children.Add(head);
        var linked = state?["linked"]?.GetValue<bool>() == true;
        var user = S(state, "username");
        var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        if (linked)
        {
            line.Children.Add(new TextBlock { Text = "Linked as " + user + ". Your stars on a title's page go to TMDB.", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
            var unlink = Chip(new TextBlock { Text = "Unlink", FontSize = 13, Foreground = HubInk }, false);
            ToolTipService.SetToolTip(unlink, "Ends the session on TMDB's side and forgets it here. The ratings you gave stay on your TMDB account.");
            unlink.Click += async (_, __) => { await ModelCallAsync("tmdbUnlink"); await Task.Delay(800); SetPill("Prism" + Dot + "TMDB account unlinked"); await ShowWatchSettingsAsync(); };
            line.Children.Add(unlink);
        }
        else if (!hasKey)
        {
            line.Children.Add(new TextBlock { Text = "Set the key first. The account is the one the key came from.", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
        }
        else
        {
            // the note a person needs when the key is in but the approval is not (2026-10-03, "add a note in options to indicate where ratings
            // approval hasn't been granted"): amber, the thing to notice
            line.Children.Add(new TextBlock { Text = "Ratings approval not granted yet. You see TMDB's ratings, but can't rate from the wall until you approve Prism on your TMDB account.", FontSize = 13, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap, MaxWidth = 520 });
            var link = Chip(new TextBlock { Text = "Approve now", FontSize = 13, Foreground = HubInk }, true);
            ToolTipService.SetToolTip(link, "TMDB shows an approval page: scan it with your phone or open it here, sign in to TMDB, press Approve, then come back and press I approved it.");
            link.Click += async (_, __) => { await ModelCallAsync("tmdbLinkStart"); await ShowTmdbApprovalAsync(); };
            line.Children.Add(link);
        }
        body.Children.Add(line);
        if (S(state, "error") is { Length: > 0 } err) body.Children.Add(new TextBlock { Text = err, FontSize = 12, Foreground = HubAmber });
    }

    /// <summary>The approval step over the settings: a QR for the phone, Open here for the wall, and I approved it.</summary>
    private async Task ShowTmdbApprovalAsync()
    {
        JsonObject? state = null;
        for (var i = 0; i < 25 && (state is null || S(state, "url").Length == 0); i++) { await Task.Delay(300); state = await TmdbLinkStateAsync(); if (S(state, "error").Length > 0) break; }
        var url = S(state, "url");
        if (url.Length == 0) { SetPill("Prism" + Dot + (S(state, "error") is { Length: > 0 } e ? e : "TMDB gave no approval page")); return; }
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE0, 0x05, 0x06, 0x09)) };
        Canvas.SetZIndex(scrim, 985);
        var card = new StackPanel { Spacing = 14, Padding = new Thickness(28), Background = HubCard, CornerRadius = new CornerRadius(12), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, MaxWidth = 560 };
        card.Children.Add(new TextBlock { Text = "Approve Prism on TMDB", FontSize = 20, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        card.Children.Add(new TextBlock { Text = "Your key is in. One more step lets you rate titles from the wall: scan this with the phone you're signed in to TMDB on and press Approve, or press Open here to do it on the wall. Then come back and press I approved it. Not now is fine; the link waits under the key in Watch settings.", FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        try
        {
            card.Children.Add(await QrWithMarkAsync(url, 250));   // the code with the Prism mark in its middle (MainWindow.Qr.cs)
        }
        catch (Exception ex) { LogLine("tmdb link: qr " + ex.Message); }
        card.Children.Add(new TextBlock { Text = "themoviedb.org " + (char)0x2192 + " approve", FontSize = 12, Foreground = HubInk, HorizontalAlignment = HorizontalAlignment.Center });
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center };
        var open = Chip(new TextBlock { Text = "Open here", FontSize = 14, Foreground = HubInk }, false);
        open.Click += (_, __) => ShowLinkModal(url, "TMDB");
        var done = Chip(new TextBlock { Text = "I approved it", FontSize = 14, Foreground = HubInk }, true);
        var cancel = Chip(new TextBlock { Text = "Not now", FontSize = 14, Foreground = HubInk }, false);
        void Close() { RootGrid.Children.Remove(scrim); }
        cancel.Click += (_, __) => Close();
        scrim.PointerPressed += (_, __) => Close();   // a press beside the card, or Esc, closes it (the token stands until TMDB expires it)
        card.PointerPressed += (_, e) => e.Handled = true;
        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; Close(); };
        scrim.KeyboardAccelerators.Add(esc);

        done.Click += async (_, __) =>
        {
            done.IsEnabled = false;
            await ModelCallAsync("tmdbLinkFinish");
            JsonObject? st = null;
            for (var i = 0; i < 20; i++) { await Task.Delay(400); st = await TmdbLinkStateAsync(); if (st?["busy"]?.GetValue<bool>() != true) break; }
            if (st?["linked"]?.GetValue<bool>() == true) { Close(); CloseLinkModal(); SetPill("Prism" + Dot + "TMDB account linked as " + S(st, "username")); await ShowWatchSettingsAsync(); }
            else { done.IsEnabled = true; SetPill("Prism" + Dot + (S(st, "error") is { Length: > 0 } e2 ? e2 : "not approved yet")); }
        };
        row.Children.Add(open); row.Children.Add(done); row.Children.Add(cancel);
        card.Children.Add(row);
        scrim.Children.Add(card);
        RootGrid.Children.Add(scrim);
    }

    /// <summary>
    /// The stars on a title's details page: the person's own rating lit, a press writes it to TMDB, a second press on the same star takes it
    /// back; not linked, a line that opens the settings. Every number is the person's; the public mean beside it is TMDB's.
    /// </summary>
    private async Task AddOwnRatingAsync(StackPanel into, string kind, int id, RatingLineUi? factLine)
    {
        var state = await TmdbLinkStateAsync();
        if (state?["loading"]?.GetValue<bool>() == true) { await Task.Delay(400); state = await TmdbLinkStateAsync(); }
        var linked = state?["linked"]?.GetValue<bool>() == true;
        var box = new StackPanel { Spacing = 6 };
        into.Children.Add(box);
        if (!linked)
        {
            if (state?["hasKey"]?.GetValue<bool>() != true) return;   // no key: no account to link, nothing to say
            var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            line.Children.Add(new TextBlock { Text = "Your rating", FontSize = 12, Foreground = DetDim, VerticalAlignment = VerticalAlignment.Center });
            var link = new HyperlinkButton { Content = new TextBlock { Text = "Link your TMDB account to rate", FontSize = 13, Foreground = HubAmber }, Padding = new Thickness(4, 0, 4, 0) };
            link.Click += (_, __) => { _settingsTab = "general"; _ = ShowWatchSettingsAsync(); };
            line.Children.Add(link);
            box.Children.Add(line);
            return;
        }
        var head = new TextBlock { Text = "Your rating", FontSize = 12, Foreground = DetDim };
        box.Children.Add(head);
        var stars = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2 };
        box.Children.Add(stars);
        var buttons = new List<(Button b, FontIcon icon)>();
        double? current = null;
        var working = true;
        void Draw()
        {
            if (factLine is not null) SetRatingLine(factLine, factLine.Text, current);   // the fact's star takes the share too
            foreach (var (b, icon) in buttons) { var n = buttons.FindIndex(x => ReferenceEquals(x.b, b)) + 1; icon.Glyph = current is { } c && n <= Math.Round(c) ? "\uE735" : "\uE734"; icon.Foreground = current is { } c2 && n <= Math.Round(c2) ? HubAmber : DetDim; }
            head.Text = working ? "Your rating" + (char)0x2026 : current is { } cv ? "Your rating" + DetDot + cv.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + " / 10" + DetDot + "on TMDB as " + S(state, "username") : "Your rating" + DetDot + "press a star";
        }
        for (var n = 1; n <= 10; n++)
        {
            var icon = new FontIcon { Glyph = "\uE734", FontSize = 20, Foreground = DetDim };
            var b = new Button { Content = icon, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(2), MinWidth = 0 };
            OwnHover(b);
            var value = n;
            ToolTipService.SetToolTip(b, value + " of 10 on TMDB. Press the lit star again to take your rating back.");
            b.Click += async (_, __) =>
            {
                if (working) return;
                var take = current is { } c && Math.Round(c) == value;
                working = true; Draw();
                await ModelCallAsync("tmdbRate", kind, id, take ? null : (object)value);
                for (var i = 0; i < 20; i++)
                {
                    await Task.Delay(400);
                    var r = JsonNode.Parse(await ModelCallAsync("tmdbRated", kind, id) ?? "null") as JsonObject;
                    if (r?["working"]?.GetValue<bool>() == true) continue;
                    current = r?["value"] is JsonValue v && v.TryGetValue<double>(out var d) ? d : null;
                    break;
                }
                working = false; Draw();
                var st = await TmdbLinkStateAsync();
                SetPill("Prism" + Dot + (S(st, "error") is { Length: > 0 } e ? e : take ? "rating taken back on TMDB" : "rated " + value + " of 10 on TMDB"));
            };
            buttons.Add((b, icon));
            stars.Children.Add(b);
        }
        Draw();
        for (var i = 0; i < 25; i++)
        {
            var r = JsonNode.Parse(await ModelCallAsync("tmdbRated", kind, id) ?? "null") as JsonObject;
            if (r?["working"]?.GetValue<bool>() != true) { current = r?["value"] is JsonValue v && v.TryGetValue<double>(out var d) ? d : null; break; }
            await Task.Delay(400);
        }
        working = false; Draw();
    }
}
