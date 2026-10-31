using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The wall's own Skip button (2026-09-29, "Is it possible to allow the skip intro buttons to be pressable even though we replace controls with our
/// own? Or maybe display our own clickable one and hide theirs, while theirs shows"): core says when the service's page offers a skip (Skip Intro,
/// Skip Recap, Skip Credits) and hides the page's own; the wall shows this button over the big window for as long as the offer stands. An ad's
/// Skip too (2026-10-29, "can we make all the skip buttons behave this way, hide the streaming chrome and put it top and center?"): the break's
/// cover used to open a cutout over the service's own button where the service drew it; now this button stands in the same place for every
/// skip and the cover stays whole (a small window in multiview keeps its card's own chip). A press is the person's: it goes to the page's own
/// control through core (tileCommand skipintro; skip for an ad's, a trusted press at the control's place).
/// </summary>
public sealed partial class MainWindow
{
    private Button? _skipChip;
    private TextBlock? _skipText;
    private string? _skipSlot;
    private string? _skipHeld;   // the offer seen while the stage bar is up, kept until the bar goes
    private bool _skipIsAd;      // the button shows an ad's Skip: its press is core's skip verb

    /// <summary>Show, rename or hide the button from the screen tile's state (null: hide).</summary>
    private void SyncSkipOffer(string? slot, JsonObject? tile)
    {
        var offer = tile?["skip"]?.GetValue<string>();
        // an ad's Skip the break's cover knows of (the adapter's declared control, YouTube's) is an offer too
        if (offer is not { Length: > 0 } && tile?["skipAvailable"]?.GetValue<bool>() == true) offer = "Skip Ad";
        // the page's Skip Intro comes and goes with its own controls, which hide again after a few seconds; the wall's stays for as long as
        // the wall's bar is up (2026-10-23, "it usually appears with the chrome controls when you open them. But in Prism, it just disappears
        // super quick"). A press while the page's button is away goes by the adapter's own way to it (Netflix wakes its controls first)
        var barUp = StageBar.Visibility == Visibility.Visible;
        if (offer is { Length: > 0 } && offer != "Skip Ad") { if (barUp) _skipHeld = offer; }
        else if (offer is not { Length: > 0 } && barUp && _skipHeld is { Length: > 0 } && slot is not null && slot == _skipSlot) offer = _skipHeld;
        // multiview too (2026-09-29, "make sure I can hit skip with any service"): the button stands in the big window's own corner
        var show = slot is not null && offer is { Length: > 0 } && !VideoHubOpen && StageCurtain.Visibility != Visibility.Visible;
        // the break's cover keeps its card's own Skip chip only for a window this button does not serve: one button, not two
        _surfaces.SkipOnWall(show && offer == "Skip Ad" ? slot : null);
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
                if (_skipSlot is { } s) _brain.Call(PrismHost.Channel.HostCalls.TileCommand, s, _skipIsAd ? "skip" : "skipintro");
                _skipHeld = null;
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
            // ... and to the left of the Prism grip, not under it (2026-10-12, "Skip recap appeared with the Big Door Prize but was immediately
            // hidden under the prism controls": the menu drops from the grip over the very spot)
            _skipChip.HorizontalAlignment = HorizontalAlignment.Center;
            _skipChip.VerticalAlignment = VerticalAlignment.Top;
            _skipChip.Margin = new Thickness(0, below + 44, 0, 0);   // top and centre, clear of the grip and of the window's own title strip above it
        }
        else if (_surfaces.RectOf(slot!) is { } r && r.W > 0 && r.H > 0 && RootGrid.ActualWidth > 0)
        {
            _skipChip.HorizontalAlignment = HorizontalAlignment.Right;
            _skipChip.VerticalAlignment = VerticalAlignment.Bottom;
            _skipChip.Margin = new Thickness(0, 0, Math.Max(16, RootGrid.ActualWidth - (r.X + r.W) + 56), Math.Max(16, RootGrid.ActualHeight - (r.Y + r.H) + 48));
        }
        _skipIsAd = offer == "Skip Ad";
        _skipText!.Text = offer!;
        ToolTipService.SetToolTip(_skipChip, offer + ". This presses the service's own button.");
        _skipChip.Visibility = Visibility.Visible;
    }
}
