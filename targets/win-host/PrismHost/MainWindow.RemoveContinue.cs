using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Remove from the service's own Continue Watching (2026-09-22, "right click on a continue watching item and tell it to remove it from the
/// keep watching list of the source service ... Hulu actually resets your progress in the show, so a warning would make sense"). A
/// Continue watching card's menu offers it when the service's adapter can press its own remove control; a press asks first - what
/// happens, where, and the service's own warning when it does more than hide the title - and then core runs the adapter's script on a
/// hidden page in the App's profile. The card leaves the row only once the service has removed it.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _removePanel;

    /// <summary>Added to a Continue watching card's menu when its service can remove titles (asked of core as the menu opens).</summary>
    private async Task AddRemoveItemAsync(MenuFlyout fly, string app, string service, string id, string title, Button card)
    {
        JsonObject? info = null;
        try { info = JsonNode.Parse(await ModelCallAsync("videoRemoveInfo", app) ?? "null") as JsonObject; } catch { }
        if (info?["can"]?.GetValue<bool>() != true)
        {
            // a service whose site cannot remove it (Fandango - only its phone app can): the card can be hidden on the wall (2026-09-23, "I dont have the
            // option to remove coraline from continue watching")
            var hide = new MenuFlyoutItem { Text = "Hide from Continue Watching", Icon = new FontIcon { Glyph = "\uED1A" } };
            ToolTipService.SetToolTip(hide, service + "'s website cannot remove a title from its Continue Watching (its phone app can). This hides " + title + " on the wall only; " + service + " still lists it, and it comes back here if you watch more of it.");
            hide.Click += async (_, __) =>
            {
                HideCardForRemoval(card);
                await ModelCallAsync("videoHideContinue", app, id);
                SetPill("Prism \u00B7 " + title + " hidden from Continue Watching (still listed on " + service + ")");
            };
            fly.Items.Add(hide);
            return;
        }
        var warning = info["warning"]?.GetValue<string>();
        var it = new MenuFlyoutItem { Text = "Remove from " + service + "'s Continue Watching\u2026", Icon = new FontIcon { Glyph = "\uE738" } };
        ToolTipService.SetToolTip(it, "Asks first. Removes " + title + " on " + service + " itself, not only on the wall.");
        it.Click += (_, __) => ShowRemoveConfirm(app, service, id, title, warning, card);
        fly.Items.Add(it);
    }

    /// <summary>The card leaves the row while its removal works; the focus moves to its neighbour so the arrows keep walking the row.</summary>
    private void HideCardForRemoval(Button card)
    {
        if (card.Parent is Panel p)
        {
            var i = p.Children.IndexOf(card);
            var next = p.Children.Skip(i + 1).Concat(p.Children.Take(i).Reverse()).OfType<Button>().FirstOrDefault(b => b.Visibility == Visibility.Visible && !ReferenceEquals(b, card));
            if (next is not null) { _hubCur = next; try { next.Focus(FocusState.Keyboard); } catch { } }
        }
        card.Visibility = Visibility.Collapsed;
    }

    /// <summary>The removal in the background: core's job polled; done - the card goes for good and the feed says so; failed - the card comes back and the feed says why.</summary>
    private async Task FollowRemovalAsync(string app, string service, string id, string title, Button card)
    {
        LogLine("remove continue: " + app + " " + id + " " + title);
        JsonObject? r = null;
        var t0 = DateTime.UtcNow;
        while ((DateTime.UtcNow - t0).TotalSeconds < 150)   // a removal may wait behind another on the same service (one job at a time on its page)
        {
            try { r = JsonNode.Parse(await ModelCallAsync("videoRemoveContinue", app, id, title) ?? "null") as JsonObject; } catch { r = null; }
            var st = r?["status"]?.GetValue<string>();
            if (st is "done" or "failed") break;
            await Task.Delay(700);
        }
        if (r?["status"]?.GetValue<string>() == "done")
        {
            LogLine("remove continue: done " + title);
            if (card.Parent is Panel p) p.Children.Remove(card);
            ReleasePill("Prism \u00B7 removed " + Shorten(title, 40) + " from " + service + "'s Continue Watching");
            return;
        }
        var err = r?["error"]?.GetValue<string>() ?? "the service did not answer in time";
        LogLine("remove continue: failed " + title + ": " + err);
        card.Visibility = Visibility.Visible;   // back in the row where it was
        ReleasePill("Prism \u00B7 could not remove " + Shorten(title, 40) + " from " + service + ": " + err);
    }

    private void CloseRemovePanel()
    {
        if (_removePanel is null) return;
        RootGrid.Children.Remove(_removePanel);
        _removePanel = null;
        if (_hubCur is not null) { try { _hubCur.Focus(FocusState.Keyboard); } catch { } }
    }

    private void ShowRemoveConfirm(string app, string service, string id, string title, string? warning, Button card) =>
        ShowAskPanel("Remove from " + service + "'s Continue Watching?",
            "\u201C" + title + "\u201D leaves Continue Watching on " + service + " itself: everywhere you use this " + service + " profile, not only on the wall.", warning, "Remove",
            () =>
            {
                // the music player's way (2026-09-22, "immediately temp hide it ... throw it up to a disappearing status field ... unhide if the
                // action fails"): the question closes, the card leaves the row now, the feed holds the work in hand and then says how it went
                HideCardForRemoval(card);
                SetPill("Prism \u00B7 removing " + Shorten(title, 40) + " from " + service + "'s Continue Watching\u2026", hold: true);
                _ = FollowRemovalAsync(app, service, id, title, card);
            });

    /// <summary>The wall's question before a change on a service itself (Continue Watching, My List): what happens and where, the service's own
    /// warning when there is one, the verb and Cancel - Cancel has the focus.</summary>
    private void ShowAskPanel(string head, string text, string? warning, string verb, Action yes)
    {
        CloseRemovePanel();
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xC8, 0x05, 0x07, 0x0A)) };
        Canvas.SetZIndex(scrim, 1100);
        Grid.SetRowSpan(scrim, 99); Grid.SetColumnSpan(scrim, 99);
        scrim.PointerPressed += (_, e) => { if (ReferenceEquals(e.OriginalSource, scrim)) CloseRemovePanel(); };
        scrim.PreviewKeyDown += (_, e) => { if (e.Key is Windows.System.VirtualKey.Escape or Windows.System.VirtualKey.GoBack) { e.Handled = true; CloseRemovePanel(); } };
        var box = new Border { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x16, 0x1A, 0x21)), CornerRadius = new CornerRadius(10), Padding = new Thickness(36, 28, 36, 28), MaxWidth = 760, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(40) };
        var body = new StackPanel { Spacing = 14 };
        body.Children.Add(new TextBlock { Text = head, FontSize = 26, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        body.Children.Add(new TextBlock { Text = text, FontSize = 16, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        if (warning is { Length: > 0 })
            body.Children.Add(new TextBlock { Text = warning, FontSize = 16, Foreground = HubAmber, TextWrapping = TextWrapping.Wrap });
        var verbs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Margin = new Thickness(0, 8, 0, 0) };
        var go = Chip(new TextBlock { Text = verb, FontSize = 15, Foreground = HubAmber }, true);
        var cancel = Chip(new TextBlock { Text = "Cancel", FontSize = 15, Foreground = HubInk }, false);
        cancel.Click += (_, __) => CloseRemovePanel();
        go.Click += (_, __) => { CloseRemovePanel(); yes(); };
        verbs.Children.Add(go); verbs.Children.Add(cancel);
        body.Children.Add(verbs);
        box.Child = body;
        scrim.Children.Add(box);
        RootGrid.Children.Add(scrim);
        _removePanel = scrim;
        try { cancel.Focus(FocusState.Keyboard); } catch { }   // the safe answer has the focus
    }
}
