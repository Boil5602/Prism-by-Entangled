using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Every tooltip stays inside PRISM's window (2026-11-16, a tooltip of a button at the right edge ran off the screen). The app's one
/// ToolTip style (App.xaml) opens every tooltip centred under its button, and a button at an edge put half of its tooltip outside.
/// The style turns this on for every tooltip: when one opens, the popup that holds it is found among the window's open popups, measured
/// against the window, and moved in by what hangs over, with a margin of 8. The tooltip's own place inside its popup says nothing (a
/// first cut measured that and moved nothing), so the popup's offset is what is read and what is changed.
/// </summary>
public static class TipClamp
{
    public static readonly DependencyProperty OnProperty = DependencyProperty.RegisterAttached(
        "On", typeof(bool), typeof(TipClamp), new PropertyMetadata(false, Changed));

    public static bool GetOn(DependencyObject o) => (bool)o.GetValue(OnProperty);
    public static void SetOn(DependencyObject o, bool value) => o.SetValue(OnProperty, value);

    /// <summary>The window's log, for one line each time a tooltip is moved.</summary>
    public static Action<string>? Log;

    private const double Margin = 8;

    private static void Changed(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not ToolTip tip) return;
        tip.Opened -= Opened;
        if (e.NewValue is true) tip.Opened += Opened;
    }

    private static void Opened(object sender, RoutedEventArgs e)
    {
        if (sender is not ToolTip tip) return;
        // one turn later, so the tooltip has its size and its place
        tip.DispatcherQueue.TryEnqueue(() =>
        {
            try
            {
                if (!tip.IsOpen || tip.XamlRoot is null || tip.ActualWidth <= 0) return;
                Popup? popup = tip.Parent as Popup;
                if (popup is null)
                    foreach (var p in VisualTreeHelper.GetOpenPopupsForXamlRoot(tip.XamlRoot))
                        if (ReferenceEquals(p.Child, tip)) { popup = p; break; }
                if (popup is null) { Log?.Invoke("tooltip: no popup found for it"); return; }
                var room = tip.XamlRoot.Size.Width;
                var left = popup.HorizontalOffset;
                var right = left + tip.ActualWidth;
                double move = 0;
                if (right > room - Margin) move = room - Margin - right;
                if (left + move < Margin) move = Margin - left;   // a tooltip wider than the window keeps its left edge in view
                if (Math.Abs(move) < 1) return;
                popup.HorizontalOffset = left + move;
                Log?.Invoke("tooltip: moved " + (int)move + " (left " + (int)left + ", width " + (int)tip.ActualWidth + ", window " + (int)room + ")");
            }
            catch (Exception ex) { Log?.Invoke("tooltip: " + ex.GetType().Name); /* a tooltip that cannot be measured stays where it opened */ }
        });
    }
}
