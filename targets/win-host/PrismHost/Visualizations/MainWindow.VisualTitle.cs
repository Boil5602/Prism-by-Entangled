using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;

namespace PrismHost;

public sealed partial class MainWindow
{
    private Grid? _visualTitle;

    /// <summary>
    /// The visual's name as a film title (2026-11-11, asked for a title that fades out in place of the long status line the change of
    /// visual had put in the pill): the name alone, large and widely spaced over a thin rule, near the top of the screen and clear of a
    /// cover in the middle. It fades in, holds, fades out and is taken away; presses pass through it. A new title replaces one that is
    /// still showing.
    /// </summary>
    private void ShowVisualTitle(string name)
    {
        if (_visualTitle is not null) { RootGrid.Children.Remove(_visualTitle); _visualTitle = null; }
        var h = RootGrid.ActualHeight > 0 ? RootGrid.ActualHeight : 1080; var size = Math.Clamp(h * 0.052, 30, 84);
        TextBlock Line(Brush ink) => new()
        {
            Text = name.ToUpperInvariant(), FontSize = size, FontWeight = Microsoft.UI.Text.FontWeights.Light, CharacterSpacing = 260, Foreground = ink,
            FontFamily = new FontFamily("Segoe UI Variable Display"), HorizontalAlignment = HorizontalAlignment.Center, TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.NoWrap,
        };
        // the name twice: a dark copy a little lower, so the light one reads over a bright scene
        var shade = Line(Tokens.Ground); shade.Opacity = 0.7; shade.RenderTransform = new TranslateTransform { X = 0, Y = Math.Max(2, size * 0.05) };
        var words = new Grid(); words.Children.Add(shade); words.Children.Add(Line(Tokens.Ink));
        var rule = new Border { Height = Math.Max(1, size * 0.03), Width = size * 3.2, Background = Tokens.Ink, Opacity = 0.7, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, size * 0.28, 0, 0) };
        var col = new StackPanel { Orientation = Orientation.Vertical, HorizontalAlignment = HorizontalAlignment.Center }; col.Children.Add(words); col.Children.Add(rule);
        var slide = new TranslateTransform { Y = size * 0.25 };
        var title = new Grid { IsHitTestVisible = false, Opacity = 0, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, h * 0.09, 0, 0), RenderTransform = slide };
        title.Children.Add(col);
        Grid.SetRowSpan(title, 99); Grid.SetColumnSpan(title, 99); Canvas.SetZIndex(title, 900);
        RootGrid.Children.Add(title); _visualTitle = title;

        var sb = new Storyboard();
        var fade = new DoubleAnimationUsingKeyFrames();
        fade.KeyFrames.Add(new LinearDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.Zero), Value = 0 });
        fade.KeyFrames.Add(new EasingDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(900)), Value = 1, EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
        fade.KeyFrames.Add(new LinearDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(3200)), Value = 1 });
        fade.KeyFrames.Add(new EasingDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(4800)), Value = 0, EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn } });
        Storyboard.SetTarget(fade, title); Storyboard.SetTargetProperty(fade, "Opacity"); sb.Children.Add(fade);
        var rise = new DoubleAnimation { To = 0, Duration = new Duration(TimeSpan.FromMilliseconds(1400)), EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
        Storyboard.SetTarget(rise, slide); Storyboard.SetTargetProperty(rise, "Y"); sb.Children.Add(rise);
        sb.Completed += (_, __) => { RootGrid.Children.Remove(title); if (ReferenceEquals(_visualTitle, title)) _visualTitle = null; };
        sb.Begin();
    }
}
