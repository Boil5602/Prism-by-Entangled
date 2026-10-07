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

    /// <summary>Each window's number over its top-left corner, above the pages; the chosen one in amber.</summary>
    private void DrawSwapBadges()
    {
        foreach (var b in _swapBadges) TileCanvas.Children.Remove(b);
        _swapBadges.Clear();
        for (var i = 0; i < _mvWindows.Count; i++)
        {
            var tile = (_mvWindows[i] as JsonObject)?["tile"]?.GetValue<string>();
            if (tile is null || _surfaces.RectOf(tile) is not { } r || r.W < 40 || r.H < 30) continue;
            var on = i == _swapPick;
            var size = r.W >= 600 ? 44 : 30;
            var badge = new Border
            {
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE0, 0x0B, 0x0E, 0x12)),
                BorderBrush = on ? HubAmber : new SolidColorBrush(Windows.UI.Color.FromArgb(0x60, 0xE8, 0xEC, 0xF2)),
                BorderThickness = new Thickness(on ? 3 : 1),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(size / 2.2, 2, size / 2.2, 4),
                IsHitTestVisible = false,
                Child = new TextBlock { Text = (i + 1).ToString(), FontSize = size, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = on ? HubAmber : HubInk },
            };
            Canvas.SetLeft(badge, r.X + 14);
            Canvas.SetTop(badge, r.Y + 14);
            Canvas.SetZIndex(badge, 2000);
            TileCanvas.Children.Add(badge);
            _swapBadges.Add(badge);
        }
    }
}
