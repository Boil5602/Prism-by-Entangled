namespace PrismHost.Surfaces;

/// <summary>
/// The look under a cover (B-486, 2026-11-10): the pointer resting on the cover's corner symbol opens a small box under the symbol
/// with the page as it plays behind the cover. The host draws the page's own view small into an opening of the cover, so the box, the
/// opening and the view's scale are one set of numbers; they are worked out here, with no XAML, so PrismHost.Tests can pin them.
/// All values are in the window's own units, from its top-left corner.
/// </summary>
public static class PeepGeometry
{
    /// <summary>The corner symbol's left and top, the gap under it, and the frame around the picture.</summary>
    public const double Left = 14, Top = 12, Gap = 8, Edge = 8;
    /// <summary>A window smaller than this has no look: the box would hide most of it.</summary>
    public const double MinWindowW = 480, MinWindowH = 270;

    /// <summary>
    /// Where the picture goes: a quarter of the window's width (240 to 420), at the window's own shape, since the page fills the
    /// window and the small page must fill the box; no taller than 300, a tall window's picture narrowed to keep the shape.
    /// Null for a window too small, or one not yet laid out (NaN compares false with everything).
    /// </summary>
    public static (double X, double Y, double W, double H)? Picture(double windowW, double windowH, double symbolH)
    {
        if (!double.IsFinite(windowW) || !double.IsFinite(windowH) || !(windowW >= MinWindowW) || !(windowH >= MinWindowH)) return null;
        if (!double.IsFinite(symbolH) || !(symbolH > 0)) symbolH = 32;
        var w = Math.Round(Math.Max(240, Math.Min(420, windowW * 0.24)));
        var h = Math.Round(w * windowH / windowW);
        if (h > 300) { h = 300; w = Math.Round(h * windowW / windowH); }
        var top = Math.Round(Top + symbolH + Gap);
        return (Left + Edge, top + Edge, w, h);
    }

    /// <summary>The page's scale inside the box, on top of any fit the view already has.</summary>
    public static double Scale(double pictureW, double windowW) => pictureW / Math.Max(1, windowW);

    /// <summary>The cover around the picture, as the four pieces its ground is made of: above, below, left, right. Together with
    /// the picture they are the whole window, and none overlaps another.</summary>
    public static (double X, double Y, double W, double H)[] Around((double X, double Y, double W, double H) p, double windowW, double windowH) => new[]
    {
        (0d, 0d, windowW, p.Y),
        (0d, p.Y + p.H, windowW, Math.Max(0, windowH - p.Y - p.H)),
        (0d, p.Y, p.X, p.H),
        (p.X + p.W, p.Y, Math.Max(0, windowW - p.X - p.W), p.H),
    };
}
