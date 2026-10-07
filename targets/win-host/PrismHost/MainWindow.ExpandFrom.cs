using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// A window opening out of a card (2026-10-03, "can we make the window open in the foreground, expanding (effect) out of the service
/// card"): a picture of the card is laid over the wall at the card's own place and grows to the whole window in a third of a second,
/// then fades as the real window arrives beneath it. The picture is above every page and takes no pointer. Drawn with the XAML tree
/// (RenderTargetBitmap), so a card drawn by the host expands as it looks; nothing waits on it.
/// </summary>
public sealed partial class MainWindow
{
    private async void ExpandFrom(FrameworkElement from)
    {
        try
        {
            if (from.ActualWidth <= 0 || from.ActualHeight <= 0) return;
            var rtb = new RenderTargetBitmap();
            await rtb.RenderAsync(from);
            var pos = from.TransformToVisual(RootGrid).TransformPoint(new Windows.Foundation.Point(0, 0));
            double w = from.ActualWidth, h = from.ActualHeight, W = RootGrid.ActualWidth, H = RootGrid.ActualHeight;
            if (W <= 0 || H <= 0) return;
            var tf = new CompositeTransform();
            var img = new Image
            {
                Source = rtb, Stretch = Stretch.Fill, Width = w, Height = h, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(pos.X, pos.Y, 0, 0), IsHitTestVisible = false, RenderTransform = tf, RenderTransformOrigin = new Windows.Foundation.Point(0, 0),
            };
            Canvas.SetZIndex(img, 1500);
            RootGrid.Children.Add(img);
            var sb = new Storyboard();
            var grow = TimeSpan.FromMilliseconds(320);
            DoubleAnimation Anim(DependencyObject target, string path, double to, TimeSpan dur, TimeSpan? begin = null)
            {
                var a = new DoubleAnimation { To = to, Duration = dur, EasingFunction = new ExponentialEase { EasingMode = EasingMode.EaseOut, Exponent = 5 }, BeginTime = begin };
                Storyboard.SetTarget(a, target); Storyboard.SetTargetProperty(a, path);
                sb.Children.Add(a);
                return a;
            }
            Anim(tf, "ScaleX", W / w, grow); Anim(tf, "ScaleY", H / h, grow);
            Anim(tf, "TranslateX", -pos.X, grow); Anim(tf, "TranslateY", -pos.Y, grow);
            var fade = Anim(img, "Opacity", 0, TimeSpan.FromMilliseconds(260), TimeSpan.FromMilliseconds(380));
            fade.EasingFunction = new ExponentialEase { EasingMode = EasingMode.EaseIn, Exponent = 3 };
            sb.Completed += (_, __) => RootGrid.Children.Remove(img);
            sb.Begin();
        }
        catch (Exception e) { LogLine("expand from card: " + e.Message); }
    }
}
