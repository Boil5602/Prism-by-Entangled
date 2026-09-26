using PrismHost.Layouts;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// The scene builder crashed the first time it was opened in a session:
///
///   System.ArgumentException: Value does not fall within the expected range.
///     at ABI.Microsoft.UI.Xaml.Controls.ITextBlockMethods.set_FontSize(...)
///     at PrismHost.MainWindow.RenderBuilderPreview() ... SceneBuilder.cs:507
///
/// A WinUI element's Width/Height are double.NaN until it has been laid out,
/// and the builder renders its preview once synchronously before the first
/// SizeChanged fires. Two things then went wrong together:
///
///   1. the guard `if (W &lt;= 0 || H &lt;= 0) return;` does not stop NaN,
///      because every comparison with NaN is false;
///   2. `Math.Max(11, Math.Min(22, NaN))` is NaN, because Math.Min and
///      Math.Max both PROPAGATE NaN rather than clamping it.
///
/// So NaN reached TextBlock.FontSize and WinRT threw. The layout editor had
/// the identical pattern and would have thrown the same way.
///
/// These tests are written against the values that actually occurred.
/// </summary>
public sealed class PreviewGeometryTests
{
    [Fact]
    public void AnUnmeasuredSurfaceIsNotRenderable_TheCaseThatCrashed()
    {
        // This is the exact state RenderBuilderPreview saw on first open.
        Assert.False(PreviewGeometry.IsRenderable(double.NaN, double.NaN));
        Assert.False(PreviewGeometry.IsRenderable(600, double.NaN));
        Assert.False(PreviewGeometry.IsRenderable(double.NaN, 400));

        // and the old guard's blind spot, stated as a fact so nobody restores it
        Assert.False(double.NaN <= 0);
        Assert.False(double.NaN > 0);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(-10, 100)]
    [InlineData(100, -10)]
    [InlineData(double.PositiveInfinity, 100)]
    [InlineData(100, double.NegativeInfinity)]
    public void AnUnusableSurfaceIsNotRenderable(double w, double h)
        => Assert.False(PreviewGeometry.IsRenderable(w, h));

    [Fact]
    public void AMeasuredSurfaceIsRenderable()
    {
        Assert.True(PreviewGeometry.IsRenderable(640, 360));
        Assert.True(PreviewGeometry.IsRenderable(1, 1));
    }

    [Fact]
    public void ClampFontNeverReturnsNaN_WhereMathMinMaxDid()
    {
        // The old expression, kept here as the thing being fixed:
        Assert.True(double.IsNaN(Math.Max(11, Math.Min(22, double.NaN))));

        // The replacement answers the floor instead, so the preview draws small
        // rather than throwing.
        Assert.Equal(11, PreviewGeometry.ClampFont(double.NaN, 11, 22));
        Assert.Equal(12, PreviewGeometry.ClampFont(double.NaN, 12, 28));
        Assert.Equal(11, PreviewGeometry.ClampFont(double.PositiveInfinity, 11, 22));
        Assert.Equal(11, PreviewGeometry.ClampFont(double.NegativeInfinity, 11, 22));
    }

    [Fact]
    public void ClampFontKeepsEachCallersOwnRange()
    {
        // the scene builder's 11..22 and the layout editor's 12..28 are
        // different on purpose; the fix must not quietly unify them
        Assert.Equal(22, PreviewGeometry.ClampFont(400, 11, 22));
        Assert.Equal(28, PreviewGeometry.ClampFont(400, 12, 28));
        Assert.Equal(11, PreviewGeometry.ClampFont(2, 11, 22));
        Assert.Equal(17, PreviewGeometry.ClampFont(17, 11, 22));      // in range: untouched
    }

    [Fact]
    public void LabelFontSizeMatchesWhatTheBuilderAlwaysDrew()
    {
        // a sixth of the slot's drawn height, clamped to 11..22
        Assert.Equal(20, PreviewGeometry.LabelFontSize(0.5, 240));     // 120/6
        Assert.Equal(22, PreviewGeometry.LabelFontSize(1.0, 600));     // 100 -> clamped high
        Assert.Equal(11, PreviewGeometry.LabelFontSize(0.05, 240));    // 2 -> clamped low
        Assert.Equal(11, PreviewGeometry.LabelFontSize(0.5, double.NaN));
        Assert.Equal(11, PreviewGeometry.LabelFontSize(double.NaN, 240));
    }

    [Fact]
    public void ExtentNeverGoesBelowItsFloorAndNeverReturnsNaN()
    {
        Assert.Equal(296, PreviewGeometry.Extent(0.5, 600, 4, 2));     // 300 - 4
        Assert.Equal(2, PreviewGeometry.Extent(0.001, 600, 4, 2));     // would be negative
        Assert.Equal(2, PreviewGeometry.Extent(0.5, double.NaN, 4, 2));
        Assert.Equal(20, PreviewGeometry.Extent(double.NaN, 600, 12, 20));
        Assert.False(double.IsNaN(PreviewGeometry.Extent(double.NaN, double.NaN, 4, 2)));
    }
}
