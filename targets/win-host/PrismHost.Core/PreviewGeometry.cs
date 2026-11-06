namespace PrismHost.Layouts;

/// <summary>
/// The scene builder's preview arithmetic, kept pure so it can be asserted
/// headless (the builder itself is WinUI and cannot be).
///
/// This exists because of a crash: a WinUI element's Width/Height are
/// <c>double.NaN</c> until it has been laid out, and the builder renders its
/// preview once synchronously before the first SizeChanged fires. The old
/// guard was <c>if (W &lt;= 0 || H &lt;= 0) return;</c>, which lets NaN straight
/// through — <c>NaN &lt;= 0</c> is FALSE — and <c>Math.Min</c>/<c>Math.Max</c>
/// propagate NaN rather than clamping it, so
/// <c>Math.Max(11, Math.Min(22, NaN))</c> is NaN and setting TextBlock.FontSize
/// to it throws "Value does not fall within the expected range". The builder
/// therefore threw the FIRST time it was opened in a session.
///
/// The lesson generalizes: comparing an unmeasured size with &lt;= or &gt;=
/// silently accepts NaN. Ask whether a number IS in range
/// (<see cref="IsRenderable"/>), never whether it is not out of range.
/// </summary>
public static class PreviewGeometry
{
    /// <summary>Smallest and largest slot-label type the preview will draw.</summary>
    public const double MinLabelFont = 11, MaxLabelFont = 22;

    /// <summary>
    /// True only for a preview surface that can actually be drawn on: both
    /// dimensions finite and positive. Written as `> 0` rather than `!(<= 0)`
    /// so NaN answers false, which is the whole point.
    /// </summary>
    public static bool IsRenderable(double w, double h)
        => double.IsFinite(w) && double.IsFinite(h) && w > 0 && h > 0;

    /// <summary>
    /// Clamp a computed type size into [<paramref name="min"/>,
    /// <paramref name="max"/>], answering <paramref name="min"/> for anything
    /// non-finite. This is the NaN-safe replacement for
    /// <c>Math.Max(min, Math.Min(max, x))</c>, which returns NaN when x is NaN
    /// because both Math.Min and Math.Max propagate it — the actual cause of
    /// the crash. Each caller passes its OWN range so the preview keeps the
    /// size it always drew.
    /// </summary>
    public static double ClampFont(double drawn, double min, double max)
        => double.IsFinite(drawn) ? Math.Clamp(drawn, min, max) : min;

    /// <summary>
    /// The scene builder's slot label: a sixth of the slot's drawn height,
    /// clamped to [<see cref="MinLabelFont"/>, <see cref="MaxLabelFont"/>].
    /// </summary>
    public static double LabelFontSize(double slotHeightFraction, double previewHeight)
        => ClampFont(slotHeightFraction * previewHeight / 6, MinLabelFont, MaxLabelFont);

    /// <summary>
    /// A length for a preview box: never negative, never NaN. Mirrors the
    /// `Math.Max(2, …)` the builder already used, with the NaN case closed.
    /// </summary>
    public static double Extent(double fraction, double total, double inset, double floor)
    {
        var v = fraction * total - inset;
        return double.IsFinite(v) ? Math.Max(floor, v) : floor;
    }
}
