using System;
using System.Linq;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;

namespace PrismHost;

/// <summary>
/// The controls on the big window (2026-10-06, "Can the controls mount to the bottom of the big window video? When I have my window narrowed,
/// it puts them below the 4 multiview windows"): with multiview's small windows up, the stage bar sits at the bottom of the big window's own
/// place, centred under it - in a tall window the big one is across the top and the small ones below, so the window's bottom was theirs.
/// Without multiview the bar keeps the window's bottom.
/// </summary>
public sealed partial class MainWindow
{
    private void PlaceStageBar()
    {
        var home = new Thickness(16, 0, 16, 18);
        var big = _mvOn && _mvWindows.Count > 1 ? (_mvWindows.OfType<JsonObject>().FirstOrDefault()?["tile"]?.GetValue<string>()) : null;
        if (big is null || _surfaces.RectOf(big) is not { } r || r.W < 200 || RootGrid.ActualHeight <= 0)
        {
            if (!StageBar.Margin.Equals(home)) StageBar.Margin = home;
            return;
        }
        var bottom = Math.Max(18, RootGrid.ActualHeight - (r.Y + r.H) + 18);
        var left = Math.Max(16, r.X + 16);
        var right = Math.Max(16, RootGrid.ActualWidth - (r.X + r.W) + 16);
        var want = new Thickness(left, 0, right, bottom);
        if (!StageBar.Margin.Equals(want)) StageBar.Margin = want;
    }
}
