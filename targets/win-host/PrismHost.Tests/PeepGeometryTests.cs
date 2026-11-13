using PrismHost.Surfaces;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// The look under a cover (B-486): the box under the corner symbol, the opening in the cover and the page's scale are one set of
/// numbers. A wrong one shows as the cover's picture inside the box, or the page beside it.
/// </summary>
public sealed class PeepGeometryTests
{
    [Fact]
    public void AFullScreenWindowGetsAPictureOfItsOwnShapeUnderTheSymbol()
    {
        var p = PeepGeometry.Picture(1920, 1080, 34)!.Value;
        Assert.Equal(420, p.W);
        Assert.Equal(236, p.H);
        Assert.Equal(PeepGeometry.Left + PeepGeometry.Edge, p.X);
        Assert.Equal(12 + 34 + 8 + PeepGeometry.Edge, p.Y);
        Assert.Equal(1920d / 1080, p.W / p.H, 2);
    }

    [Fact]
    public void ThePageDrawnAtTheScaleFillsThePicture()
    {
        foreach (var (w, h) in new[] { (1920d, 1080d), (1280d, 720d), (960d, 540d), (2560d, 1080d), (800d, 1000d) })
        {
            var p = PeepGeometry.Picture(w, h, 34)!.Value;
            var s = PeepGeometry.Scale(p.W, w);
            Assert.InRange(w * s - p.W, -0.001, 0.001);
            Assert.InRange(h * s - p.H, -1, 1);      // the height is rounded to a whole unit
            Assert.True(p.X + p.W < w && p.Y + p.H < h, $"the picture stays inside a {w}x{h} window");
        }
    }

    [Fact]
    public void ATallWindowsPictureIsNoTallerThanThreeHundred()
    {
        var p = PeepGeometry.Picture(800, 1000, 34)!.Value;
        Assert.Equal(300, p.H);
        Assert.Equal(240, p.W);
    }

    [Fact]
    public void ASmallWindowOrOneNotLaidOutHasNoLook()
    {
        Assert.Null(PeepGeometry.Picture(400, 225, 34));
        Assert.Null(PeepGeometry.Picture(1920, 200, 34));
        Assert.Null(PeepGeometry.Picture(double.NaN, 1080, 34));
        Assert.Null(PeepGeometry.Picture(1920, double.PositiveInfinity, 34));
    }

    [Fact]
    public void ASymbolNotYetMeasuredStillPutsTheBoxUnderIt()
    {
        var p = PeepGeometry.Picture(1920, 1080, double.NaN)!.Value;
        Assert.Equal(12 + 32 + 8 + PeepGeometry.Edge, p.Y);
    }

    [Fact]
    public void TheCoverAroundThePictureLeavesOnlyThePictureOpen()
    {
        const double w = 1920, h = 1080;
        var p = PeepGeometry.Picture(w, h, 34)!.Value;
        var around = PeepGeometry.Around(p, w, h);
        Assert.Equal(4, around.Length);
        double area = 0;
        foreach (var r in around) { Assert.True(r.W >= 0 && r.H >= 0); area += r.W * r.H; }
        Assert.Equal(w * h - p.W * p.H, area, 3);
        // no piece reaches into the picture
        foreach (var r in around)
            Assert.False(r.X < p.X + p.W && r.X + r.W > p.X && r.Y < p.Y + p.H && r.Y + r.H > p.Y, "a piece of the cover lies over the picture");
    }
}
