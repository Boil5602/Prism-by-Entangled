using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;

namespace PrismHost;

/// <summary>
/// A card title that does not fit scrolls (2026-09-25, "if title text is cutoff, let's make it scroll to the left so the right can be read, but
/// stall a little longer on the left side since that's the biggest clue"). At rest the line is cut with an ellipsis as before; while its card is
/// pointed at or focused, the whole title holds at its start, slides left until its end shows, holds a moment, and starts over. A title that
/// fits never moves, and nothing moves on a card nobody is on.
/// </summary>
public sealed partial class MainWindow
{
    private const double MarqueeHoldStartS = 2.2;   // the start is the biggest clue: held longest
    private const double MarqueeHoldEndS = 1.2;
    private const double MarqueePxPerS = 45;

    private static FrameworkElement MarqueeTitle(string rest, string full, double fontSize, Brush ink)
    {
        var restTb = new TextBlock { Text = rest, FontSize = fontSize, Foreground = ink, TextTrimming = TextTrimming.CharacterEllipsis };
        var move = new TextBlock { Text = full, FontSize = fontSize, Foreground = ink, TextWrapping = TextWrapping.NoWrap, Visibility = Visibility.Collapsed };
        var shift = new TranslateTransform();
        move.RenderTransform = shift;
        var lane = new Canvas { IsHitTestVisible = false };   // a canvas lets the full title keep its own width
        lane.Children.Add(move);
        var box = new Grid();
        box.Children.Add(restTb);
        box.Children.Add(lane);
        box.SizeChanged += (_, e) => box.Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, e.NewSize.Width, e.NewSize.Height) };

        Storyboard? sb = null;
        void Start()
        {
            if (sb is not null || box.ActualWidth <= 0) return;
            move.Visibility = Visibility.Visible;
            move.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            var over = move.DesiredSize.Width - box.ActualWidth;
            if (over <= 1) { move.Visibility = Visibility.Collapsed; return; }   // it fits: nothing moves
            restTb.Opacity = 0;
            var slide = over / MarqueePxPerS;
            var a = new DoubleAnimationUsingKeyFrames { RepeatBehavior = RepeatBehavior.Forever };
            a.KeyFrames.Add(new DiscreteDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.Zero), Value = 0 });
            a.KeyFrames.Add(new LinearDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromSeconds(MarqueeHoldStartS)), Value = 0 });
            a.KeyFrames.Add(new EasingDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromSeconds(MarqueeHoldStartS + slide)), Value = -over, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } });
            a.KeyFrames.Add(new LinearDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromSeconds(MarqueeHoldStartS + slide + MarqueeHoldEndS)), Value = -over });
            Storyboard.SetTarget(a, shift);
            Storyboard.SetTargetProperty(a, "X");
            sb = new Storyboard();
            sb.Children.Add(a);
            sb.Begin();
        }
        void Stop()
        {
            sb?.Stop();
            sb = null;
            shift.X = 0;
            move.Visibility = Visibility.Collapsed;
            restTb.Opacity = 1;
        }

        // the card this title is on: pointed at or focused starts it, leaving stops it
        box.Loaded += (_, __) =>
        {
            DependencyObject? d = box;
            while (d is not null && d is not Button) d = VisualTreeHelper.GetParent(d);
            if (d is not Button card || box.Tag is "wired") return;
            box.Tag = "wired";
            card.PointerEntered += (_, __) => Start();
            card.PointerExited += (_, __) => { if (card.FocusState == FocusState.Unfocused || card.FocusState == FocusState.Pointer) Stop(); };
            card.GotFocus += (_, __) => Start();
            card.LostFocus += (_, __) => Stop();
        };
        box.Unloaded += (_, __) => Stop();
        return box;
    }
}
