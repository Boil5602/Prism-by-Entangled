using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace PrismHost;

/// <summary>
/// What remains of the v0 scene screen (spec 34): the shape row the
/// pre-scene-model viewfinder offers, and the aspect helper the scene builder
/// shares. The scene screen itself is superseded by the rail's Scenes section
/// and the scene builder (MainWindow.Rail.cs / MainWindow.SceneBuilder.cs,
/// scene-model-spec §5/§6); <see cref="OpenSceneEditor"/> routes there so
/// any old caller lands on the new screen.
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>Superseded: the Scenes rail is the scene screen now.</summary>
    private void OpenSceneEditor() => OpenRoute("prism://scenes");

    // ------------------------------------------------ §34.3 the viewfinder's shape row: the slot shapes the saved layouts define
    private async Task FillShapeRowAsync(StackPanel row)
    {
        var wall = await ReadWallStateAsync();
        if (wall.Shapes is null || !row.IsLoaded && row.Parent is null) return;
        foreach (var s in wall.Shapes)
        {
            var aspect = s.Aspect;
            var b = new Button { Content = aspect + (s.Floating ? "  ⤴" : ""), Padding = new Thickness(6, 2, 6, 2), FontSize = 11 };
            ToolTipService.SetToolTip(b, (s.Floating ? "Floating slots of " : "Slots of ") + aspect + " in " + s.Layouts + " saved layout" + (s.Layouts == 1 ? "" : "s")
                + (s.W > 0 ? $" - largest {s.W:0}×{s.H:0} px on this wall. The box takes this shape; the view is saved for it." : ". The box takes this shape; the view is saved for it."));
            b.Click += (_, __) => SetViewfinderShape(aspect);
            row.Children.Add(b);
        }
    }

    private static double? Ratio(string? aspect)
    {
        if (aspect is null) return null;
        var parts = aspect.Split(':');
        if (parts.Length != 2 || !double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var w) || !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var h) || w <= 0 || h <= 0) return null;
        return w / h;
    }
}
