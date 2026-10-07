using System;
using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Where the pointer really is (2026-10-06, "When I mouse off of the prism window, the controls should fade after a moment, but they seem to be
/// stuck on the screen right now"). A control's PointerEntered / PointerExited are not to be trusted for "still over it": leaving the window, or
/// crossing onto a service's page (a WebView2 has its own window), can deliver no PointerExited, and a hold that waited for one never let go.
/// The screen position of the cursor is asked instead, against the element's place in this window.
/// </summary>
public sealed partial class MainWindow
{
    [StructLayout(LayoutKind.Sequential)] private struct CursorPoint { public int X, Y; }
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out CursorPoint p);
    [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr hwnd, ref CursorPoint p);

    /// <summary>Is the pointer over this element now (in this window, inside its bounds)?</summary>
    private bool PointerIsOver(FrameworkElement el)
    {
        try
        {
            if (el.Visibility != Visibility.Visible || el.ActualWidth <= 0 || el.XamlRoot is null) return false;
            if (!GetCursorPos(out var p)) return false;
            var hwnd = Microsoft.UI.Win32Interop.GetWindowFromWindowId(AppWindow.Id);
            if (!ScreenToClient(hwnd, ref p)) return false;
            var scale = el.XamlRoot.RasterizationScale > 0 ? el.XamlRoot.RasterizationScale : 1;
            var at = new Windows.Foundation.Point(p.X / scale, p.Y / scale);
            var r = el.TransformToVisual(null).TransformBounds(new Windows.Foundation.Rect(0, 0, el.ActualWidth, el.ActualHeight));
            return r.Contains(at);
        }
        catch { return false; }
    }
}
