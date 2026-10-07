using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace PrismHost;

/// <summary>
/// The player toggle (2026-10-03, "Maybe we should add a simple toggle to swap between music and video on a corner that is common to both
/// the music and watch screens"): Music | Video at the top-right of the window, hanging from the edge like the Prism menu grip at the
/// top-centre, present on both players and above every page. The wall's player is lit in amber; a press on the other switches through the
/// same path as the Prism menu (core switchPlayer; a player that does not exist opens Set up services). Refilled whenever the Watch grip is.
/// </summary>
public sealed partial class MainWindow
{
    private string? _playerGripActive;

    private void FillPlayerGrip(string? active, string? musicName, string? videoName)
    {
        _playerGripActive = active;
        PlayerGripBody.Children.Clear();
        foreach (var (kind, label, glyph, name) in new[] { ("music", "Music", "\uE8D6", musicName), ("video", "Video", "\uE714", videoName) })
        {
            var on = active == kind;
            // icons alone, the words in the tooltips (2026-10-03, "Make the toggle icons only, text in tooltips")
            var face = new FontIcon { Glyph = glyph, FontSize = 13, Foreground = on ? HubAmber : HubInk, VerticalAlignment = VerticalAlignment.Center };
            var b = new Button { Content = face, Background = on ? HubChipOn : HubClear, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(0, 0, 8, 8), Padding = new Thickness(10, 4, 10, 5), MinHeight = 0 };
            OwnHover(b);
            ToolTipService.SetPlacement(b, Microsoft.UI.Xaml.Controls.Primitives.PlacementMode.Bottom);
            ToolTipService.SetToolTip(b, label + " player" + (on ? ": the wall now." : name is null ? ": none yet. This opens Set up services to make one." : ": switch the wall to " + name + "."));
            var k = kind;
            b.Click += (_, __) => { if (_playerGripActive != k) _ = SwitchPlayerAsync(k); };
            PlayerGripBody.Children.Add(b);
        }
        PlayerGrip.Visibility = Visibility.Visible;
    }

    /// <summary>The grip from core's players (which exist, which is the wall).</summary>
    private async Task UpdatePlayerGripAsync()
    {
        try
        {
            var raw = await ModelCallAsync("players");
            if (raw is null || System.Text.Json.Nodes.JsonNode.Parse(raw) is not System.Text.Json.Nodes.JsonObject p) return;
            var active = p["active"]?.GetValue<string>();
            var musicName = (p["music"] as System.Text.Json.Nodes.JsonObject)?["name"]?.GetValue<string>();
            var videoName = (p["video"] as System.Text.Json.Nodes.JsonObject)?["name"]?.GetValue<string>();
            // nothing to toggle until a player exists; the welcome page is the way there
            if (musicName is null && videoName is null) { PlayerGrip.Visibility = Visibility.Collapsed; return; }
            FillPlayerGrip(active, musicName, videoName);
        }
        catch (Exception e) { LogLine("player grip: " + e.Message); }
    }
}
