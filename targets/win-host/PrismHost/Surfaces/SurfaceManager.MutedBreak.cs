using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost.Surfaces;

/// <summary>
/// A muted-only break (Watch settings' Video ads, 2026-10-07, "If an ad is muted only, I should have the option to unmute it"): the ad's
/// picture stays up with its sound off, and the window carries a small strip at its lower left - Unmute (Mute again once pressed) and,
/// while the break watch put the break up, Not an ad. Core keeps the person's word for the rest of the break (intermissionUnmute).
/// </summary>
public sealed partial class SurfaceManager
{
    private readonly Dictionary<string, (Border Strip, Button Sound, Button NotAd)> _mutedStrips = new();
    private readonly HashSet<string> _breakUnmuted = new();
    /// <summary>Unmute (true) or Mute again (false) pressed on a muted break.</summary>
    public event Action<string, bool>? BreakUnmutePressed;

    private void SyncMutedStrip(Tile t)
    {
        var want = t.Covered && t.Look == "mute" && t.Kind != SurfaceKind.Hidden;
        if (!want)
        {
            _breakUnmuted.Remove(t.Id);
            if (_mutedStrips.TryGetValue(t.Id, out var gone)) { t.Container.Children.Remove(gone.Strip); _mutedStrips.Remove(t.Id); }
            return;
        }
        if (!_mutedStrips.TryGetValue(t.Id, out var s)) { s = MakeMutedStrip(t); _mutedStrips[t.Id] = s; }
        SetSoundLabel(s.Sound, _breakUnmuted.Contains(t.Id));
        s.NotAd.Visibility = _notAdWanted.Contains(t.Id) ? Visibility.Visible : Visibility.Collapsed;
    }

    private static void SetSoundLabel(Button b, bool unmuted)
    {
        if (b.Content is StackPanel p && p.Children.Count == 2 && p.Children[0] is FontIcon i && p.Children[1] is TextBlock tx)
        {
            i.Glyph = unmuted ? "\uE767" : "\uE74F";
            tx.Text = unmuted ? "Mute ad" : "Unmute ad";
        }
        ToolTipService.SetToolTip(b, unmuted ? "Turn this ad's sound off again" : "Hear this ad. Its sound goes off again at the next break");
    }

    private (Border Strip, Button Sound, Button NotAd) MakeMutedStrip(Tile t)
    {
        var amber = Windows.UI.Color.FromArgb(0xFF, 0xF2, 0xB1, 0x4C);
        var dark = Windows.UI.Color.FromArgb(0xFF, 0x0A, 0x0C, 0x0F);
        var ink = Windows.UI.Color.FromArgb(0xFF, 0xE8, 0xEC, 0xF2);
        var id = t.Id;
        var sound = new Button
        {
            Content = new StackPanel
            {
                Orientation = Orientation.Horizontal, Spacing = 8,
                Children =
                {
                    new FontIcon { Glyph = "\uE74F", FontSize = 14, Foreground = new SolidColorBrush(dark) },
                    new TextBlock { FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(dark) },
                },
            },
            Padding = new Thickness(12, 6, 12, 6), CornerRadius = new CornerRadius(8), Background = new SolidColorBrush(amber), BorderThickness = new Thickness(0),
        };
        MainWindow.OwnHover(sound);
        sound.Click += (_, __) =>
        {
            var on = !_breakUnmuted.Contains(id);
            if (on) _breakUnmuted.Add(id); else _breakUnmuted.Remove(id);
            SetSoundLabel(sound, on);
            BreakUnmutePressed?.Invoke(id, on);
        };
        var notAd = new Button
        {
            Content = new TextBlock { Text = "Not an ad", FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(ink) },
            Padding = new Thickness(12, 6, 12, 6), CornerRadius = new CornerRadius(8),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE6, 0x1C, 0x21, 0x29)), BorderThickness = new Thickness(0),
            Visibility = Visibility.Collapsed,
        };
        MainWindow.OwnHover(notAd);
        ToolTipService.SetToolTip(notAd, "This is the show, not an ad: give its sound back, and tell Prism it got this wrong");
        notAd.Click += (_, __) => NotAnAdPressed?.Invoke(id);
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        row.Children.Add(sound);
        row.Children.Add(notAd);
        var strip = new Border
        {
            Child = row, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(12, 0, 0, 12),
            Padding = new Thickness(4), CornerRadius = new CornerRadius(10), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xB0, 0x0A, 0x0C, 0x0F)),
        };
        Canvas.SetZIndex(strip, 55);   // above the page and the (undrawn) cover, under Ad debug's strip
        t.Container.Children.Add(strip);
        return (strip, sound, notAd);
    }
}
