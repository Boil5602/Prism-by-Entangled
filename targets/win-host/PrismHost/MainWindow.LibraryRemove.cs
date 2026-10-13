using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace PrismHost;

/// <summary>
/// Remove from the service's own library (2026-10-12, YouTube TV: "I should be able to remove them from my library AND remove them from DVR"):
/// a library card's menu (New in your library, a service's own library rows) offers it when the service's adapter can press its own control
/// for the title; a press asks first and says what the service does (YouTube TV takes the show off the library, which ends its recordings),
/// and core runs the adapter's script on a hidden page in the App's profile. The card leaves the row at once and comes back if the service
/// refused.
/// </summary>
public sealed partial class MainWindow
{
    private async Task AddLibraryRemoveItemAsync(MenuFlyout fly, string app, string service, string id, string title, Button card)
    {
        JsonObject? info = null;
        try { info = JsonNode.Parse(await ModelCallAsync("videoLibraryRemoveInfo", app, id) ?? "null") as JsonObject; } catch { }
        if (info?["can"]?.GetValue<bool>() != true) return;
        var warning = info["warning"]?.GetValue<string>();
        var it = new MenuFlyoutItem { Text = "Remove from " + service + "'s library…", Icon = new FontIcon { Glyph = "" } };
        ToolTipService.SetToolTip(it, "Asks first. Takes " + title + " out of your library on " + service + " itself, not only on the wall.");
        it.Click += (_, __) => ShowAskPanel("Remove from " + service + "'s library?",
            "“" + title + "” leaves your library on " + service + " itself: everywhere you use this " + service + " account, not only on the wall." + (warning is { Length: > 0 } ? " " + warning : ""), null, "Remove",
            () =>
            {
                HideCardForRemoval(card);
                SetPill("Prism · removing " + Shorten(title, 40) + " from " + service + "'s library…", hold: true);
                _ = FollowLibraryRemovalAsync(app, service, id, title, card);
            });
        fly.Items.Add(it);
    }

    /// <summary>The removal in the background: core's job polled; done - the card is gone and the feed says so; failed - the card comes back and the feed says why.</summary>
    private async Task FollowLibraryRemovalAsync(string app, string service, string id, string title, Button card)
    {
        LogLine("remove library: " + app + " " + id + " " + title);
        JsonObject? r = null;
        var t0 = DateTime.UtcNow;
        while ((DateTime.UtcNow - t0).TotalSeconds < 150)
        {
            try { r = JsonNode.Parse(await ModelCallAsync("videoLibraryRemove", app, id, title) ?? "null") as JsonObject; } catch { r = null; }
            var st = r?["status"]?.GetValue<string>();
            if (st is "done" or "failed") break;
            await Task.Delay(700);
        }
        if (r?["status"]?.GetValue<string>() == "done")
        {
            LogLine("remove library: done " + title);
            if (card.Parent is Panel p) p.Children.Remove(card);
            ReleasePill("Prism · removed " + Shorten(title, 40) + " from " + service + "'s library");
            return;
        }
        var why = r?["error"]?.GetValue<string>() ?? "no answer from the service";
        LogLine("remove library: failed " + title + ": " + why);
        card.Visibility = Visibility.Visible; card.IsHitTestVisible = true; card.Opacity = 1;
        ReleasePill("Prism · " + service + " did not remove " + Shorten(title, 40) + ": " + why);
    }
}
