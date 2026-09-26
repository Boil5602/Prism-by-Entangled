using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace PrismHost;

/// <summary>
/// My List on the service itself (2026-09-23, "These are basically 'Watch Later' lists in each application. Ideally we could add any items to
/// My List through Prism, and it does it in the source application as well. Just like Continue Watching. So lets do My List exactly the same
/// way for adding/removing items including queuing and multi-hidden sessions"). A My List card's menu offers Remove (asked first, as a
/// Continue Watching removal is); any other title card's menu offers Add to the service's list. Core runs the adapter's script on the App's
/// hidden work page, one job at a time per service; the card leaves (or the title joins) the row at once, the status feed holds the work and
/// says how it went, and a failure puts the row back.
/// </summary>
public sealed partial class MainWindow
{
    private async Task<(bool can, string name)> ListInfoAsync(string app)
    {
        try
        {
            var j = JsonNode.Parse(await ModelCallAsync("videoListInfo", app) ?? "null") as JsonObject;
            return (j?["can"]?.GetValue<bool>() == true, j?["name"]?.GetValue<string>() ?? "My List");
        }
        catch { return (false, "My List"); }
    }

    /// <summary>A My List card's menu: take it off the service's own list (asks first).</summary>
    private async Task AddListRemoveItemAsync(MenuFlyout fly, string app, string service, string id, string title, string? url, string kind, Button? card, Action<bool>? done = null)
    {
        var (can, name) = await ListInfoAsync(app);
        if (!can) return;
        var it = new MenuFlyoutItem { Text = "Remove from " + service + "'s " + name + "\u2026", Icon = new FontIcon { Glyph = "\uE738" } };
        ToolTipService.SetToolTip(it, "Asks first. Takes " + title + " off " + name + " on " + service + " itself, not only on the wall.");
        it.Click += (_, __) => ShowAskPanel("Remove from " + service + "'s " + name + "?",
            "\u201C" + title + "\u201D leaves " + name + " on " + service + " itself: everywhere you use this " + service + " profile, not only on the wall.", null, "Remove",
            () =>
            {
                if (card is not null) HideCardForRemoval(card);
                done?.Invoke(false);   // off the list, as far as the page shows it
                SetPill("Prism \u00B7 removing " + Shorten(title, 40) + " from " + service + "'s " + name + "\u2026", hold: true);
                _ = FollowListAsync(app, service, name, false, id, title, url, kind, null, card);
            });
        fly.Items.Add(it);
    }

    /// <summary>Any title card's menu: put it on the service's own list. `catalog` "1" (a Browse card) or "auto" (a search result) lets core find
    /// the service's own copy of a catalog title first.</summary>
    private async Task AddListAddItemAsync(MenuFlyout fly, string app, string service, string id, string title, string? url, string kind, string? catalog, Action<bool>? done = null)
    {
        var (can, name) = await ListInfoAsync(app);
        if (!can) return;
        // already on the service's list (2026-09-25, "It's always sunny is already in my hulu my list ... right now it offers to add it"): any
        // card for it, on any row, offers Remove instead, with the list entry's own id
        if (await ServiceListCardAsync(app, title) is JsonObject on && on["item"] is JsonObject li && (li["id"]?.GetValue<string>() ?? "").Length > 0)
        {
            await AddListRemoveItemAsync(fly, app, service, li["id"]!.GetValue<string>(), title, li["url"]?.GetValue<string>() ?? url, li["kind"]?.GetValue<string>() ?? kind, null, done);
            return;
        }
        var it = new MenuFlyoutItem { Text = "Add to " + service + "'s " + name, Icon = new FontIcon { Glyph = "\uE710" } };
        ToolTipService.SetToolTip(it, "Puts " + title + " on " + name + " on " + service + " itself, so it shows in My list here and in " + service + "'s own apps.");
        it.Click += (_, __) =>
        {
            SetPill("Prism \u00B7 adding " + Shorten(title, 40) + " to " + service + "'s " + name + "\u2026", hold: true);
            _ = FollowListAsync(app, service, name, true, id, title, url, kind, catalog, null);
            done?.Invoke(true);   // on the list at once, as far as the page shows it
        };
        fly.Items.Add(it);
    }

    /// <summary>The list change in the background: core's job polled; done - the feed says so; failed - a removed card comes back and the feed says why.</summary>
    private async Task FollowListAsync(string app, string service, string name, bool add, string id, string title, string? url, string kind, string? catalog, Button? card)
    {
        var want = add ? "add" : "remove";
        LogLine("my list: " + want + " " + app + " " + id + " " + title);
        JsonObject? r = null;
        var t0 = DateTime.UtcNow;
        while ((DateTime.UtcNow - t0).TotalSeconds < 180)   // a change may wait behind others on the same service (one job at a time on its page)
        {
            try { r = JsonNode.Parse(await ModelCallAsync("videoListSet", app, want, id, title, url, kind, catalog) ?? "null") as JsonObject; } catch { r = null; }
            var st = r?["status"]?.GetValue<string>();
            if (st is "done" or "failed") break;
            await Task.Delay(700);
        }
        if (r?["status"]?.GetValue<string>() == "done")
        {
            LogLine("my list: done " + want + " " + title);
            if (!add && card?.Parent is Panel p) p.Children.Remove(card);
            ReleasePill("Prism \u00B7 " + (add ? "added " + Shorten(title, 40) + " to " : "removed " + Shorten(title, 40) + " from ") + service + "'s " + name);
            return;
        }
        var err = r?["error"]?.GetValue<string>() ?? "the service did not answer in time";
        LogLine("my list: failed " + want + " " + title + ": " + err);
        if (card is not null) card.Visibility = Visibility.Visible;   // back in the row where it was
        ReleasePill("Prism \u00B7 could not " + (add ? "add " + Shorten(title, 40) + " to " : "remove " + Shorten(title, 40) + " from ") + service + "'s " + name + ": " + err);
    }
}
