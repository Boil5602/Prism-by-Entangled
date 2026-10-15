using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// A service's library row whose series open in place (2026-10-14, "when they click that image, it shows the items in their library that they
/// can play under this show ... I want to see the 'Good Morning America' text replace the 'New in your Library' text, and then replace the row of
/// shows with the row of episodes from GMA. And then give us a way to go back"): YouTube TV's show page is a dialog with no Play of its own, so a
/// press there had started whatever its home page previewed. The row's head takes the series' name, the row its recordings oldest to newest, each
/// with the day it aired on its ribbon (core's titleEpisodes, the adapter's own list); Back puts the shows back. The adapter says which service
/// works this way (videoSeriesPicks); core passes it as the row's seriesPicks.
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>What a series card's press does, by its row (set by SeriesPickRow, read by MenuCardButton).</summary>
    private readonly Dictionary<string, Action<JsonObject>> _rowPicks = new();
    private int _seriesRowRun;

    private void SeriesPickRow(StackPanel rows, string app, string service, string facet, string rowTitle, List<JsonObject> cards, double now, ref Button? first)
    {
        _seriesRowRun++;   // a row drawn again: an older read stops drawing into a row that is gone
        var rowKey = app + "|" + rowTitle;
        var headText = service + "  " + Mid.Trim() + "  " + rowTitle;
        var head = RowHead(headText, HubInk);
        // the way back stands out (2026-10-14, "make the New In Your Library button more prominent so the users know its an option"): the amber chip, larger
        var back = Chip(new TextBlock { Text = (char)0x2190 + "  Back to " + rowTitle, FontSize = 15, Foreground = HubInk }, true);
        ToolTipService.SetToolTip(back, "Back to " + rowTitle + ".");
        back.Visibility = Visibility.Collapsed;
        var headRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 };
        headRow.Children.Add(head); headRow.Children.Add(back);
        var host = new StackPanel { Background = HubClear };
        var band = new Border { CornerRadius = new CornerRadius(10), Padding = new Thickness(12, 8, 12, 10), Margin = new Thickness(-12, 0, -12, 0), BorderThickness = new Thickness(3, 0, 0, 0), BorderBrush = HubClear, Background = HubClear };   // the drill-down band (below), made before the press handler that tints it
        foreach (var c in cards) c["__pickRow"] = rowKey;
        _rowPicks[rowKey] = card => _ = ShowSeriesAsync(card);   // before the cards are built: a card looks its row up as it is pressed
        Button? f = null;
        host.Children.Add(CardRow(cards, false, now, ref f));
        first ??= f;
        // the row on a band that tints while a show is open (2026-10-15, "When I click a show in my youtube tv library, can you highlight the row a
        // different color so it's a little more obviously it's drilled down? Just when the user drills into a show"): amber at a tenth with an
        // amber edge, clear otherwise; the padding is the same either way so nothing moves when it changes
        band.Child = new StackPanel { Spacing = rows.Spacing, Children = { headRow, host } };
        void Drilled(bool on) { band.Background = on ? new SolidColorBrush(Windows.UI.Color.FromArgb(0x24, 0xF2, 0xB1, 0x4C)) : HubClear; band.BorderBrush = on ? HubAmber : HubClear; }
        rows.Children.Add(band);
        void ShowShows()
        {
            _seriesRowRun++;
            head.Text = headText; back.Visibility = Visibility.Collapsed; Drilled(false);
            host.Children.Clear(); Button? f2 = null; host.Children.Add(CardRow(cards, false, now, ref f2));
        }
        back.Click += (_, __) => ShowShows();

        async Task ShowSeriesAsync(JsonObject card)
        {
            var item = card["item"] as JsonObject; if (item is null) return;
            var title = item["title"]?.GetValue<string>() ?? ""; var id = item["id"]?.GetValue<string>() ?? ""; var showArt = item["artwork"]?.GetValue<string>();
            if (title.Length == 0) return;
            var run = ++_seriesRowRun;
            head.Text = service + "  " + Mid.Trim() + "  " + title; back.Visibility = Visibility.Visible; Drilled(true);
            var status = new TextBlock { Text = "Reading the recordings of " + title + " from " + service + (char)0x2026, FontSize = 14, Foreground = HubInk, Margin = new Thickness(0, 8, 0, 8) };
            host.Children.Clear(); host.Children.Add(status);
            var shown = -1;
            for (var i = 0; i < 100 && run == _seriesRowRun; i++)
            {
                JsonObject? v = null;
                try { v = JsonNode.Parse(await ModelCallAsync("titleEpisodes", app, title, id.Length > 0 ? id : null, null, null) ?? "null") as JsonObject; } catch { }
                if (run != _seriesRowRun) return;
                var ready = v?["ready"]?.GetValue<bool>() != false;
                // TMDB's whole list stands in while the service's own read is still to come (a read that failed, or one asked without the show's id):
                // never a recordings row - the service's list is waited for (2026-10-14, 20/20 had shown TMDB's 1978 seasons)
                if (v?["source"]?.GetValue<string>() == "tmdb") { await Task.Delay(1200); continue; }
                var eps = new List<JsonObject>();
                if (v?["seasons"] is JsonArray ss) foreach (var so in ss.OfType<JsonObject>()) if (so["episodes"] is JsonArray ea) eps.AddRange(ea.OfType<JsonObject>());
                // oldest first ("show the episodes in oldest to newest order"): the adapter numbers its recordings by date, oldest 1. TMDB's fill-in for a
                // list that looked short stays out of a recordings row (2026-10-14: a 1975 air date on a ribbon beside this week's)
                var ordered = eps.Where(e => e["fromTmdb"]?.GetValue<bool>() != true).OrderBy(e => e["episode"]?.GetValue<int>() ?? 0).ToList();
                if (ordered.Count != shown)
                {
                    shown = ordered.Count;
                    var epCards = ordered.Select(e =>
                    {
                        var air = e["airDate"]?.GetValue<string>() ?? ""; var mark = e["badge"]?.GetValue<string>() ?? "";
                        var ribbon = air.Length > 0 ? (mark.Length > 0 ? mark + " " + air : air) : mark;
                        var epItem = new JsonObject
                        {
                            ["id"] = e["id"]?.GetValue<string>() ?? "", ["title"] = e["title"]?.GetValue<string>() is { Length: > 0 } et ? et : title, ["kind"] = "title",
                            // a recording without its own still (the page loads them lazily) shows the show's picture (2026-10-14, "some of the GMA episodes have no picture")
                            ["url"] = e["url"]?.GetValue<string>(), ["artwork"] = e["still"]?.GetValue<string>() is { Length: > 0 } st ? st : showArt, ["subtitle"] = e["duration"]?.GetValue<string>(),
                            ["badge"] = ribbon.Length > 0 ? ribbon : null, ["badgeFrom"] = ribbon.Length > 0 ? "date" : null,
                        };
                        return new JsonObject { ["app"] = app, ["service"] = service, ["facet"] = facet, ["item"] = epItem, ["recency"] = new JsonObject { ["kind"] = "rank" } };
                    }).ToList();
                    host.Children.Clear();
                    if (epCards.Count > 0) { Button? f3 = null; host.Children.Add(CardRow(epCards, false, now, ref f3)); }
                    else host.Children.Add(status);
                }
                if (ready)
                {
                    if (shown <= 0)
                    {
                        var err = v?["error"]?.GetValue<string>() ?? "";
                        status.Text = err.Length > 0 ? "No recordings listed: " + err + "." : "No recordings of " + title + " on " + service + ".";
                        host.Children.Clear(); host.Children.Add(status);
                    }
                    return;
                }
                await Task.Delay(1200);
            }
        }
    }
}
