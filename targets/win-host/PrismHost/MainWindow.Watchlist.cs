using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The person's TMDB watchlist as Watch's My list (core lenses/orchestrator watchlist, 2026-10-03, "disable the existing My List items from
/// different services and replace it with TMDB My Watchlist ... Offering to add all titles from individual services watch lists"): while an
/// account is linked the row is the watchlist (Browse's cards: the household's services that carry each title), with the offer to copy the
/// services' own lists onto it; a card's menu and a title's page put a title on or take it off. Unlinked, the services' own lists are back.
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>My list is the watchlist now (as the last menu said).</summary>
    private bool _watchActive;
    private int _watchFollow;

    /// <summary>The row in place of My list: its head, the offer, the cards; followed while the cards are built or the copy runs.</summary>
    private void DrawWatchlistRow(StackPanel rows, Grid overlay, JsonObject w)
    {
        var panel = new StackPanel { Spacing = 8 };
        rows.Children.Add(panel);
        FillWatchlistRow(panel, w);
        var my = ++_watchFollow;
        string last = "";
        // the row refilled now, in place, after a card's menu put a title on or took one off (2026-10-14, "it causes the whole screen to refresh
        // and as I move on to the next item, it causes disruption and I have to go find it again": the whole hub had been redrawn 1.5 s after
        // the press, and the row the person was working down went back to its start)
        _watchRowRefresh = async () =>
        {
            if (my != _watchFollow || !ReferenceEquals(_videoHub, overlay) || _hubTab != "watch") return;
            try { if (JsonNode.Parse(await ModelCallAsync("watchlistView", false) ?? "null") is JsonObject nw) { w = nw; var sig = nw.ToJsonString(); if (sig != last) { last = sig; FillWatchlistRow(panel, nw); } } } catch { }
        };
        _ = Task.Run(async () =>
        {
            var quiet = 0;
            while (true)
            {
                var busy = w["reading"]?.GetValue<bool>() == true || (w["importing"] as JsonObject)?["running"]?.GetValue<bool>() == true;
                await Task.Delay(busy ? 2500 : 20_000);
                if (my != _watchFollow) return;
                var ok = false;
                RootGrid.DispatcherQueue.TryEnqueue(async () =>
                {
                    if (my != _watchFollow || !ReferenceEquals(_videoHub, overlay) || _hubTab != "watch") { _watchFollow++; return; }
                    try { if (JsonNode.Parse(await ModelCallAsync("watchlistView", false) ?? "null") is JsonObject nw) { w = nw; var sig = nw.ToJsonString(); if (sig != last) { last = sig; FillWatchlistRow(panel, nw); } } } catch { }
                    ok = true;
                });
                if (!busy && ++quiet > 30) return;   // ten minutes idle: the next open follows again
                _ = ok;
            }
        });
    }

    private Func<Task>? _watchRowRefresh;

    private void FillWatchlistRow(StackPanel panel, JsonObject w)
    {
        var keep = FindChild<ScrollViewer>(panel)?.HorizontalOffset ?? 0;   // a refill keeps the row where the person had scrolled it
        panel.Children.Clear();
        var cards = (w["cards"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var count = w["count"]?.GetValue<int>() ?? cards.Count;
        var reading = w["reading"]?.GetValue<bool>() == true;
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        var title = RowHead("My Watchlist", HubInk);
        ToolTipService.SetToolTip(title, "Your TMDB watchlist, from the TMDB account linked in Watch settings: the same list on any device signed in to it. Each card shows the services here that carry the title. Your services' own My Lists are not read while this is on; unlink the account and they come back.");
        head.Children.Add(title);
        // the row's own order (2026-10-14, "Let the user sort my watch list by (latest) release date or alphabetical or by TMDB score"): core orders and
        // keeps the choice on the device; TMDB score only with a key
        if (w["orders"] is JsonArray wOrders && wOrders.Count > 0)
        {
            var cur = w["order"]?.GetValue<string>() ?? "latest";
            var box = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            foreach (var o in wOrders.OfType<JsonObject>())
            {
                var id = S(o, "id"); if (id.Length == 0 || (id == "rating" && !_hubTmdbKey)) continue;
                var b = Chip(new TextBlock { Text = S(o, "label"), FontSize = 12, Foreground = HubInk }, id == cur);
                b.Padding = new Thickness(10, 3, 10, 3);
                if (S(o, "hint").Length > 0) ToolTipService.SetToolTip(b, S(o, "hint"));
                var id2 = id;
                b.Click += async (_, __) => { if (id2 == cur) return; await ModelCallAsync("videoWatchlistOrder", id2, ""); if (_watchRowRefresh is { } rf) await rf(); };
                box.Children.Add(b);
            }
            // the reverse switch, as Continue watching's (2026-10-14, "lets add a reverse button to the my watch list row"): the sort symbol in a round
            // outlined button, lit amber while on
            var reverse = w["reverse"]?.GetValue<bool>() == true;
            var rev = Chip(new FontIcon { Glyph = "\uE8CB", FontSize = 13, Foreground = reverse ? HubAmber : HubInk }, false);
            rev.Width = 28; rev.Height = 28; rev.Padding = new Thickness(0); rev.CornerRadius = new CornerRadius(14);
            rev.BorderThickness = new Thickness(1.5); rev.Margin = new Thickness(6, 0, 0, 0);
            rev.Background = reverse ? HubChipOn : RevOff; rev.BorderBrush = reverse ? HubAmber : HubDim;
            ToolTipService.SetToolTip(rev, (reverse ? "Reverse is on. " : "Reverse is off. ") + "Flips the order: oldest release first, Z to A, or the lowest score first.");
            rev.Click += async (_, __) => { await ModelCallAsync("videoWatchlistOrder", "", reverse ? "0" : "1"); if (_watchRowRefresh is { } rf) await rf(); };
            box.Children.Add(rev);
            head.Children.Add(box);
        }
        if (reading && cards.Count == 0) head.Children.Add(new TextBlock { Text = "Reading your watchlist" + (char)0x2026, FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
        // the copy of the services' own lists: offered while some of their titles are not on the watchlist; its progress while it runs
        var imp = w["importing"] as JsonObject;
        var offer = w["offer"]?.GetValue<int>() ?? 0;
        if (imp?["running"]?.GetValue<bool>() == true)
            head.Children.Add(new TextBlock { Text = "Adding your services' My List titles: " + imp["done"] + " of " + imp["total"] + (char)0x2026, FontSize = 13, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center });
        else if (offer > 0 && !reading)   // never while the watchlist is still being read: every list title looked missing then (2026-10-14, "offers to add 24 titles")
        {
            var add = Chip(new TextBlock { Text = "Add " + offer + " title" + (offer == 1 ? "" : "s") + " from your services' My Lists", FontSize = 13, Foreground = HubInk }, true);
            // which ones, and on which service (2026-10-09, "gives no indicator which titles or which service(s)")
            var which = (w["offerTitles"] as JsonArray)?.OfType<JsonObject>().Select(o => S(o, "title") + (S(o, "service").Length > 0 ? " (" + S(o, "service") + ")" : "")).Where(x => x.Length > 0).ToList() ?? new List<string>();
            ToolTipService.SetToolTip(add, (which.Count > 0 ? "Not on your watchlist yet: " + string.Join(", ", which.Take(20)) + (offer > 20 ? ", and " + (offer - 20) + " more" : "") + ".\n" : "") + "Copies the titles on your services' own My Lists onto your TMDB watchlist, each matched to its TMDB title. A title TMDB can't match is listed after, never guessed. Your services' lists are left as they are.");
            // a question before the copy (2026-10-14, "We dont want to accidentally let them make that choice right?"): what happens, then Add or Not now
            add.Click += (_, __) =>
            {
                var ask = new MenuFlyout();
                ask.Items.Add(new MenuFlyoutItem { Text = "Put " + offer + " title" + (offer == 1 ? "" : "s") + " from your services' My Lists on your TMDB watchlist?", Foreground = HubInk, IsHitTestVisible = false });
                ask.Items.Add(new MenuFlyoutItem { Text = "Each is matched to its TMDB title; one TMDB can't match is listed after, never guessed. Your services' own lists stay as they are.", Foreground = HubInk, IsHitTestVisible = false });
                ask.Items.Add(new MenuFlyoutSeparator());
                var yes = new MenuFlyoutItem { Text = "Add them", Icon = new FontIcon { Glyph = "\uE710" } };
                yes.Click += async (_, ___) => { add.IsEnabled = false; await ModelCallAsync("watchlistImport"); SetPill("Prism" + Dot + "adding your services' My List titles to your TMDB watchlist"); };
                ask.Items.Add(yes);
                ask.Items.Add(new MenuFlyoutItem { Text = "Not now" });
                ask.ShowAt(add);
            };
            head.Children.Add(add);
        }
        if (imp is not null && imp["running"]?.GetValue<bool>() != true && (imp["total"]?.GetValue<int>() ?? 0) > 0)
        {
            var unmatched = (imp["unmatched"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0).ToList() ?? new List<string>();
            var note = new TextBlock { Text = "Added " + imp["added"] + ", already there " + imp["already"] + (unmatched.Count > 0 ? ", " + unmatched.Count + " TMDB couldn't match" : ""), FontSize = 12, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center };
            if (unmatched.Count > 0) ToolTipService.SetToolTip(note, "Not matched: " + string.Join(", ", unmatched.Take(30)) + (unmatched.Count > 30 ? ", and more" : "") + ".");
            head.Children.Add(note);
        }
        panel.Children.Add(head);
        if (cards.Count == 0)
        {
            if (!reading) panel.Children.Add(new TextBlock { Text = count == 0 ? "Your TMDB watchlist is empty. Add titles from a card's menu or a title's page." : "Matching your watchlist to your services" + (char)0x2026, FontSize = 13, Foreground = HubInk });
            return;
        }
        Button? first = null;
        var row = BrowseRow(cards, ref first, true);
        panel.Children.Add(row);
        if (keep > 0) row.Loaded += (_, __) => row.ChangeView(Math.Min(keep, row.ScrollableWidth), null, null, true);
    }

    /// <summary>A card's menu item: on or off the watchlist - by the card's TMDB id when it carries one ("kind:id", exact), else by its title
    /// (the watchlist's own entry by name, then the facts' TMDB match), when an account is linked. By id since 2026-10-14: the watchlist
    /// row's own cards had been looked up by name and found nothing ("several items have a right click menu that don't allow me to remove
    /// from watchlist ... carrie and key & peele").</summary>
    private async Task AddWatchlistItemAsync(MenuFlyout fly, string title, string? kind, string? tmdb = null)
    {
        if (!_watchActive) return;
        var byId = tmdb is { Length: > 0 } && tmdb.Split(':') is { Length: 2 } parts && long.TryParse(parts[1], out var tid) ? (kind: parts[0], id: tid) : ((string kind, long id)?)null;
        JsonObject? st = null;
        try { st = JsonNode.Parse(await (byId is { } b0 ? ModelCallAsync("watchlistHas", b0.kind, b0.id) : ModelCallAsync("watchlistHasTitle", title, kind)) ?? "null") as JsonObject; } catch { }
        var on = st?["on"]?.GetValue<bool>() == true;
        var it = new MenuFlyoutItem { Text = on ? "Remove from My Watchlist" : "Add to My Watchlist", Icon = new FontIcon { Glyph = on ? "\uE74D" : "\uE710" } };
        ToolTipService.SetToolTip(it, on ? "Takes " + title + " off your TMDB watchlist." : "Puts " + title + " on your TMDB watchlist, the same list on any device signed in to your TMDB account.");
        it.Click += async (_, __) =>
        {
            if (byId is { } b1) await ModelCallAsync("watchlistSet", b1.kind, b1.id, !on); else await ModelCallAsync("watchlistSetTitle", title, kind, !on);
            await Task.Delay(1500);
            var r = JsonNode.Parse(await (byId is { } b2 ? ModelCallAsync("watchlistHas", b2.kind, b2.id) : ModelCallAsync("watchlistHasTitle", title, kind)) ?? "null") as JsonObject;
            SetPill("Prism" + Dot + (S(r, "error") is { Length: > 0 } e ? e : on ? title + " taken off your watchlist" : title + " added to your watchlist"));
            if (VideoHubOpen && _hubTab == "watch" && _watchRowRefresh is { } rf) _ = rf();   // the My Watchlist row alone, in place; the rest of the page stays put
        };
        fly.Items.Add(it);
    }

    /// <summary>The title page's toggle in place of the services' My List button, by the page's own TMDB id.</summary>
    private Button WatchlistToggle(string kind, long id, string title)
    {
        var icon = new FontIcon { Glyph = "\uE710", FontSize = 13 };
        var text = new TextBlock { Text = "My Watchlist", FontSize = 14, Foreground = DetInk };
        var b = new Button { Background = DetChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(18), Padding = new Thickness(12, 6, 14, 6), Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { icon, text } } };
        OwnHover(b);
        var on = false;
        void Draw() { icon.Glyph = on ? "\uE73E" : "\uE710"; text.Text = on ? "On My Watchlist" : "My Watchlist"; ToolTipService.SetToolTip(b, on ? "On your TMDB watchlist. Press to take it off." : "Put " + title + " on your TMDB watchlist."); }
        async Task Read() { try { var r = JsonNode.Parse(await ModelCallAsync("watchlistHas", kind, id) ?? "null") as JsonObject; on = r?["on"]?.GetValue<bool>() == true; } catch { } Draw(); }
        b.Click += async (_, __) =>
        {
            b.IsEnabled = false;
            await ModelCallAsync("watchlistSet", kind, id, !on);
            await Task.Delay(1200);
            var r = JsonNode.Parse(await ModelCallAsync("watchlistHas", kind, id) ?? "null") as JsonObject;
            if (S(r, "error") is { Length: > 0 } e) SetPill("Prism" + Dot + e);
            on = r?["on"]?.GetValue<bool>() == true; Draw(); b.IsEnabled = true;
        };
        Draw(); _ = Read();
        return b;
    }
}
