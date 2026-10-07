using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Swap by choosing (2026-10-06, "When swapping windows on the control bar using the swap button, the swap button moves. Let's let users press
/// the swap button and cycle through all of the available windows by clicking multiple times, and then when they stop, after 3 seconds elapse
/// perform the swap action. Lets show numbers over each of the windows and the corresponding number by the swap button while we're selecting
/// which video will be moved to the big window"). Each press steps the choice through windows 2, 3 ... and back to 1 (no change); every window
/// carries its number meanwhile, the chosen one in amber, and the button says the number. Three seconds after the last press the chosen
/// window becomes the big one (core's focus); nothing moves before that, so the button stays under the finger.
/// </summary>
public sealed partial class MainWindow
{
    private const double SwapSettleSeconds = 3;
    /// <summary>The window chosen (its place in the order: 0 is the big one, "no change"); -1 while not choosing.</summary>
    private int _swapPick = -1;
    private DispatcherTimer? _swapTimer;
    private readonly List<UIElement> _swapBadges = new();
    private readonly List<TextBlock> _swapLabels = new();
    private bool SwapChoosing => _swapPick >= 0;

    /// <summary>A Swap press: the next window chosen, the numbers drawn, the swap three seconds after the last press.</summary>
    private void SwapPress(TextBlock? label)
    {
        if (!_mvOn || _mvWindows.Count < 2) return;
        var n = _mvWindows.Count;
        _swapPick = _swapPick < 0 ? 1 : (_swapPick + 1) % n;   // 2, 3 ... n, then 1 (the big one: no change), then 2 again
        if (label is not null && !_swapLabels.Contains(label)) _swapLabels.Add(label);
        foreach (var l in _swapLabels) l.Text = SwapLabelText();
        DrawSwapBadges();
        _swapTimer ??= new DispatcherTimer { Interval = TimeSpan.FromSeconds(SwapSettleSeconds) };
        _swapTimer.Stop();
        _swapTimer.Tick -= SwapSettled; _swapTimer.Tick += SwapSettled;
        _swapTimer.Start();
        RestartStageBarTimer();
    }

    private string SwapLabelText() => !SwapChoosing ? "Swap" : _swapPick == 0 ? "Swap " + (char)0x2192 + " 1, no change" : "Swap " + (char)0x2192 + " " + (_swapPick + 1);

    private async void SwapSettled(object? sender, object e)
    {
        _swapTimer?.Stop();
        var pick = _swapPick;
        EndSwapChoice();
        if (pick <= 0 || pick >= _mvWindows.Count) return;
        var tile = (_mvWindows[pick] as JsonObject)?["tile"]?.GetValue<string>();
        if (tile is null) return;
        LogLine("swap: window " + (pick + 1) + " (" + tile + ") to the big screen");
        await MvCallAsync("focus", tile);
        SetPill("Prism" + Mid + Shorten(MvWindowName(tile), 40) + " on the big screen");
        if (StageBar.Visibility == Visibility.Visible) await ShowStageBarAsync(true);
        DrawMvStrip();
    }

    /// <summary>The choice dropped: the numbers go, the buttons say Swap again.</summary>
    private void EndSwapChoice()
    {
        _swapTimer?.Stop();
        _swapPick = -1;
        foreach (var l in _swapLabels) l.Text = "Swap";
        _swapLabels.Clear();
        foreach (var b in _swapBadges) TileCanvas.Children.Remove(b);
        _swapBadges.Clear();
    }

    /// <summary>Each window's number, large and centered over it (2026-10-07, "Lets make the swap number large and centered in each window. I
    /// imagine it takes up 1/3 of the screen area"); the chosen one in amber.</summary>
    private void DrawSwapBadges()
    {
        foreach (var b in _swapBadges) TileCanvas.Children.Remove(b);
        _swapBadges.Clear();
        for (var i = 0; i < _mvWindows.Count; i++)
        {
            var tile = (_mvWindows[i] as JsonObject)?["tile"]?.GetValue<string>();
            if (tile is null || _surfaces.RectOf(tile) is not { } r || r.W < 40 || r.H < 30) continue;
            var on = i == _swapPick;
            // the digit about half the window's height (so its card covers about a third of the window), never wider than the window allows
            var size = Math.Max(30, Math.Min(r.H * 0.5, r.W * 0.4));
            var card = new Border
            {
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xD0, 0x0B, 0x0E, 0x12)),
                BorderBrush = on ? HubAmber : new SolidColorBrush(Windows.UI.Color.FromArgb(0x60, 0xE8, 0xEC, 0xF2)),
                BorderThickness = new Thickness(on ? Math.Max(3, size / 30) : 1),
                CornerRadius = new CornerRadius(size / 5),
                Padding = new Thickness(size / 3, size / 5, size / 3, size / 5),   // even above and below: the digit's own box is trimmed to its ink (below)
                HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
                // trimmed to the cap height and the baseline: a digit has no descender, and the room a text box keeps under the baseline put it at
                // the top of its card (2026-10-07, "Swap numbers are all at the top of their borders, please center vertically")
                Child = new TextBlock { Text = (i + 1).ToString(), FontSize = size, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = on ? HubAmber : HubInk, TextLineBounds = TextLineBounds.Tight, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center },
            };
            var badge = new Grid { Width = r.W, Height = r.H, IsHitTestVisible = false, Children = { card } };   // the window's own box: the card sits in its middle
            Canvas.SetLeft(badge, r.X);
            Canvas.SetTop(badge, r.Y);
            Canvas.SetZIndex(badge, 2000);
            TileCanvas.Children.Add(badge);
            _swapBadges.Add(badge);
        }
    }
}
