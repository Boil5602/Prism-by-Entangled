using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The wall's own Skip button (2026-09-29, "Is it possible to allow the skip intro buttons to be pressable even though we replace controls with our
/// own? Or maybe display our own clickable one and hide theirs, while theirs shows"): core says when the service's page offers a skip (Skip Intro,
/// Skip Recap, Skip Credits - never an ad's) and hides the page's own; the wall shows this button over the big window for as long as the offer
/// stands. A press is the person's: it goes to the page's own control through core (tileCommand skipintro).
/// </summary>
public sealed partial class MainWindow
{
    private Button? _skipChip;
    private TextBlock? _skipText;
    private string? _skipSlot;

    /// <summary>Show, rename or hide the button from the screen tile's state (null: hide).</summary>
    private void SyncSkipOffer(string? slot, JsonObject? tile)
    {
        var offer = tile?["skip"]?.GetValue<string>();
        // multiview too (2026-09-29, "make sure I can hit skip with any service"): the button stands in the big window's own corner
        var show = slot is not null && offer is { Length: > 0 } && !VideoHubOpen && StageCurtain.Visibility != Visibility.Visible;
        // an ad's Skip under a break's cover is on the cover itself (its own Skip chip): one button, not two
        if (show && offer == "Skip Ad" && _surfaces.VeilStates().Any(c => c.Id == slot && c.Covered)) show = false;
        if (!show)
        {
            if (_skipChip is not null) _skipChip.Visibility = Visibility.Collapsed;
            return;
        }
        if (_skipChip is null)
        {
            _skipText = new TextBlock { FontSize = 18, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold };
            _skipChip = Chip(_skipText, false);
            _skipChip.Padding = new Thickness(22, 12, 22, 12);
            _skipChip.HorizontalAlignment = HorizontalAlignment.Right;
            _skipChip.VerticalAlignment = VerticalAlignment.Bottom;
            _skipChip.Margin = new Thickness(0, 0, 56, 150);
            Canvas.SetZIndex(_skipChip, 923);   // over the screen, under the empty stage (924), the curtain (925) and Watch (930)
            _skipChip.Click += (_, __) =>
            {
                if (_skipSlot is { } s) _brain.Call(PrismHost.Channel.HostCalls.TileCommand, s, "skipintro");
                if (_skipChip is not null) _skipChip.Visibility = Visibility.Collapsed;   // pressed: gone until the page offers one again
            };
            RootGrid.Children.Add(_skipChip);
        }
        _skipSlot = slot;
        // the big window alone on the wall: top and centre, under the Prism menu (2026-10-06, "Can we show the skip intro button top and center (not
        // overlapping prism menu) when the skip button is available when fullscreen with the big window"); multiview keeps it in the big window's
        // lower right, where the small windows leave it room
        if (!_mvOn)
        {
            var below = 24.0;
            try { if (MenuGrip.ActualHeight > 0) below = MenuGrip.TransformToVisual(RootGrid).TransformPoint(new Windows.Foundation.Point(0, MenuGrip.ActualHeight)).Y + 14; } catch { }
            _skipChip.HorizontalAlignment = HorizontalAlignment.Center;
            _skipChip.VerticalAlignment = VerticalAlignment.Top;
            _skipChip.Margin = new Thickness(0, below, 0, 0);
        }
        else if (_surfaces.RectOf(slot!) is { } r && r.W > 0 && r.H > 0 && RootGrid.ActualWidth > 0)
        {
            _skipChip.HorizontalAlignment = HorizontalAlignment.Right;
            _skipChip.VerticalAlignment = VerticalAlignment.Bottom;
            _skipChip.Margin = new Thickness(0, 0, Math.Max(16, RootGrid.ActualWidth - (r.X + r.W) + 56), Math.Max(16, RootGrid.ActualHeight - (r.Y + r.H) + 48));
        }
        _skipText!.Text = offer!;
        ToolTipService.SetToolTip(_skipChip, offer + ". This presses the service's own button.");
        _skipChip.Visibility = Visibility.Visible;
    }
}
