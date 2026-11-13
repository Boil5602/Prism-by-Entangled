using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;

namespace PrismHost.Visualizations;

// =============================================================== SEASONS: textures
// This file is pure ASCII.

/// <summary>
/// The surfaces of the town (2026-11-12, asked for textures: the walls, roofs and ground were flat colour with a gradient for
/// shade). Each surface gets a small picture made here, on the PC, when the town is built: courses of brick, blocks of stone,
/// planks, rough plaster, rows of roof tiles, thatch, cobbles, the grain of the ground. Nothing is loaded from a file and
/// nothing is drawn again in a frame: a picture is made once, at the size of the thing it covers.
///
/// A pattern answers, for a point, how much darker (below 0) or lighter (above 0) the surface is there, from -1 to 1.
/// </summary>
public sealed partial class SeasonsTown
{
    private bool _shadow = true;

    private static double Hash(int x, int y) { var v = Math.Sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.Floor(v); }
    /// <summary>Soft noise: the hash on a lattice, blended between its points.</summary>
    private static double Soft(double x, double y)
    {
        int x0 = (int)Math.Floor(x), y0 = (int)Math.Floor(y); double fx = x - x0, fy = y - y0; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        double a = Hash(x0, y0), b = Hash(x0 + 1, y0), c = Hash(x0, y0 + 1), d = Hash(x0 + 1, y0 + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }

    /// <summary>A picture of a pattern. With a ground colour it is solid; with none it is clear where the pattern is 0, to lay over a fill.</summary>
    private static WriteableBitmap Tex(double width, double height, Func<int, int, double> shade, Color? ground = null, double strength = 0.34)
    {
        int w = (int)Math.Clamp(width, 4, 720), h = (int)Math.Clamp(height, 4, 720); var px = new byte[w * h * 4]; var i = 0;
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                var s = Math.Clamp(shade(x, y), -1, 1); var k = Math.Abs(s) * strength; double to = s < 0 ? 0 : 255;
                if (ground is { } c) { px[i++] = (byte)(c.B + (to - c.B) * k); px[i++] = (byte)(c.G + (to - c.G) * k); px[i++] = (byte)(c.R + (to - c.R) * k); px[i++] = 255; }
                else { var a = k * 255; var v = (byte)(to * a / 255); px[i++] = v; px[i++] = v; px[i++] = v; px[i++] = (byte)a; }   // premultiplied
            }
        var wb = new WriteableBitmap(w, h);
        using (var st = System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsStream(wb.PixelBuffer)) st.Write(px, 0, px.Length);
        wb.Invalidate(); return wb;
    }

    // ---- the patterns
    private static Func<int, int, double> Brick(double ch) => (x, y) =>
    {
        var row = (int)(y / ch); var off = (row % 2) * ch * 1.1; var len = ch * 2.2; var u = (x + off) % len; var v = y % ch;
        if (v < 1.2 || u < 1.2) return -0.75;
        return (Hash((int)((x + off) / len), row) - 0.5) * 1.1 + (Hash(x, y) - 0.5) * 0.3;
    };
    private static Func<int, int, double> Stone(double ch) => (x, y) =>
    {
        var row = (int)(y / ch); var bw = ch * (1.4 + 1.6 * Hash(row, 7)); var off = Hash(row, 3) * bw; var u = (x + off) % bw; var v = y % ch;
        if (v < 1.5 || u < 1.5) return -0.85;
        return (Hash((int)((x + off) / bw) * 31 + row, row) - 0.5) * 1.3 + (Hash(x, y) - 0.5) * 0.3;
    };
    private static Func<int, int, double> Planks(double ph) => (x, y) =>
    {
        var v = y % ph; if (v < 1.2) return -0.8; if (v < 2.6) return 0.5;
        return (Soft(x / 40.0, (int)(y / ph) * 3.7) - 0.5) * 0.7 + (Hash(x / 3, (int)(y / ph)) - 0.5) * 0.35 + (Hash(x, y) - 0.5) * 0.2;
    };
    private static double Plaster(int x, int y) => (Soft(x / 18.0, y / 18.0) - 0.5) * 1.0 + (Soft(x / 5.0, y / 5.0) - 0.5) * 0.4 + (Hash(x, y) - 0.5) * 0.4;
    private static Func<int, int, double> Tiles(double rh) => (x, y) =>
    {
        var row = (int)(y / rh); var tw = rh * 1.3; var off = (row % 2) * tw / 2; var u = (x + off) % tw; var v = (y % rh) / rh;
        if (u < 1.3) return -0.7;
        return -0.9 * v * v + 0.35 * (1 - v) + (Hash((int)((x + off) / tw), row) - 0.5) * 0.5;
    };
    private static double Thatch(int x, int y) => (Hash(x / 2, y / 9) - 0.5) * 1.2 + (Soft(x / 12.0, y / 30.0) - 0.5) * 0.6 + (Hash(x, y) - 0.5) * 0.3;
    private static double Cobble(int x, int y)
    {
        const double cw = 15, chh = 7; var row = (int)(y / chh); var off = (row % 2) * cw / 2;
        double cx = ((x + off) % cw) / cw - 0.5, cy = (y % chh) / chh - 0.5;
        var d = Math.Pow(Math.Pow(Math.Abs(cx * 2), 3) + Math.Pow(Math.Abs(cy * 2), 3), 1 / 3.0);
        if (d > 0.88) return -0.8;
        return (Hash((int)((x + off) / cw), row) - 0.5) * 0.9 + 0.3 * (0.5 - d);
    }
    private static double Grain(int x, int y) => (Soft(x / 30.0, y / 10.0) - 0.5) * 1.0 + (Soft(x / 7.0, y / 3.0) - 0.5) * 0.6 + (Hash(x, y) - 0.5) * 0.5;

    private static double Rock(int x, int y) => (Soft((x + y * 0.6) / 9.0, (y - x * 0.4) / 34.0) - 0.5) * 1.5 + (Soft(x / 4.0, y / 4.0) - 0.5) * 0.5 + (Hash(x, y) - 0.5) * 0.4;
    private static double Ripple(int x, int y) => Math.Sin(y * 0.8 + Soft(x / 28.0, y / 28.0) * 7) * 0.6 + (Hash(x, y) - 0.5) * 0.35;
    private static double Tuft(int x, int y) => (Soft(x / 5.0, y / 3.0) - 0.5) * 1.1 + (Soft(x / 22.0, y / 14.0) - 0.5) * 0.7 + (Hash(x, y) - 0.5) * 0.6;

    /// <summary>A pattern laid over a shape of the land: the same outline again, filled with the pattern's picture.</summary>
    private void Over(Func<int, int, double> pattern, double strength, double[] pts)
    {
        double x0 = double.MaxValue, y0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue;
        for (var i = 0; i + 1 < pts.Length; i += 2) { x0 = Math.Min(x0, pts[i]); x1 = Math.Max(x1, pts[i]); y0 = Math.Min(y0, pts[i + 1]); y1 = Math.Max(y1, pts[i + 1]); }
        GB(new ImageBrush { ImageSource = Tex((x1 - x0) / 2, (y1 - y0) / 2, pattern, null, strength), Stretch = Stretch.Fill }, 1, pts);
    }

    /// <summary>
    /// A cloud (2026-11-12, asked for clouds more like clouds; they were two flat ovals): billows from soft noise at three
    /// sizes inside a long low shape, a flat foot, white above and shade beneath.
    /// </summary>
    private static WriteableBitmap CloudTex(int seed, Color top, Color under)
    {
        const int w = 420, h = 140; var px = new byte[w * h * 4]; var i = 0;
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                double nx = (double)x / w, ny = (double)y / h, sx = nx * 5 + seed * 7.3, sy = ny * 2.2 + seed * 3.1;
                var n = (Soft(sx, sy) + 0.5 * Soft(sx * 2.3, sy * 2.3) + 0.25 * Soft(sx * 5.1, sy * 5.1)) / 1.75;
                var side = 1 - Math.Pow(Math.Abs(nx - 0.5) * 2, 2.2);
                var vert = ny < 0.74 ? (0.74 - ny) * 1.15 : (ny - 0.74) * 5;
                var a = Math.Clamp((n * 0.95 + side * 0.6 - 0.78 - vert) * 6, 0, 1); a = a * a * (3 - 2 * a);
                var sh = Math.Clamp((ny - 0.3) * 1.5 + (0.5 - n) * 0.9, 0, 1);
                px[i++] = (byte)((top.B + (under.B - top.B) * sh) * a); px[i++] = (byte)((top.G + (under.G - top.G) * sh) * a); px[i++] = (byte)((top.R + (under.R - top.R) * sh) * a); px[i++] = (byte)(255 * a);
            }
        var wb = new WriteableBitmap(w, h);
        using (var st = System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsStream(wb.PixelBuffer)) st.Write(px, 0, px.Length);
        wb.Invalidate(); return wb;
    }

    private static readonly WriteableBitmap?[] _smoke = new WriteableBitmap?[4];
    /// <summary>A wisp of smoke: a soft round of grey, broken by noise at two sizes, lighter at its top.</summary>
    private static WriteableBitmap SmokeTex(int seed)
    {
        if (_smoke[seed] is { } have) return have;
        const int n = 96; var px = new byte[n * n * 4]; var i = 0;
        for (var y = 0; y < n; y++)
            for (var x = 0; x < n; x++)
            {
                double nx = (x - n / 2.0) / (n / 2.0), ny = (y - n / 2.0) / (n / 2.0), r = Math.Sqrt(nx * nx + ny * ny);
                var f = (Soft(x / 13.0 + seed * 9.7, y / 13.0 + seed * 4.1) + 0.5 * Soft(x / 5.0 + seed * 3.3, y / 5.0)) / 1.5;
                var a = Math.Clamp((1 - Math.Pow(r, 1.6)) * (0.55 + 1.3 * f) - 0.16, 0, 1); a = a * a * (3 - 2 * a);
                var v = 205 + 40 * (0.5 - ny * 0.5) * f;
                px[i++] = (byte)(Math.Min(255, v + 6) * a); px[i++] = (byte)(v * a); px[i++] = (byte)(v * a); px[i++] = (byte)(255 * a);
            }
        var wb = new WriteableBitmap(n, n);
        using (var st = System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsStream(wb.PixelBuffer)) st.Write(px, 0, px.Length);
        wb.Invalidate(); return _smoke[seed] = wb;
    }

    // ---- where they go
    private void Img(WriteableBitmap wb, double x, double y, double w, double h, double op = 1)
    {
        var im = new Image { Source = wb, Width = w, Height = h, Stretch = Stretch.Fill, Opacity = op, IsHitTestVisible = false }; At(im, x, y); C.Children.Add(im);
    }

    /// <summary>The face of a home's wall: brick, plaster, stone or planks by its build, and shade toward one side.</summary>
    private void WallFace(int build, double x, double top, double w, double h)
    {
        var ch = Math.Max(5, h / 15);
        var shade = (build % 4) switch { 0 => Brick(ch), 1 => (Func<int, int, double>)Plaster, 2 => Stone(ch * 1.5), _ => Planks(ch * 1.4) };
        Img(Tex(w, h, shade), x, top, w, h);
        var side = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(1, 0) };
        side.GradientStops.Add(new GradientStop { Color = A(White, 0.1), Offset = 0 }); side.GradientStops.Add(new GradientStop { Color = A(White, 0), Offset = 0.35 }); side.GradientStops.Add(new GradientStop { Color = A(Dark, 0.24), Offset = 1 });
        RB(x, top, w, h, side);
        RB(x - w * 0.04, top + h, w * 1.08, h * 0.07, Vertical((A(Dark, 0.32), 0), (A(Dark, 0), 1)));   // the home's shadow on the ground
    }

    /// <summary>A brush for a roof: rows of tiles, thatch on the round roof, plaster on the dome.</summary>
    private Brush RoofBrush(int build, Color roof, double w, double h)
    {
        var kind = build % 7; var rh = Math.Max(6, h * 0.075);
        var wb = kind == 6 ? Tex(w * 1.2, h * 0.8, Thatch, roof, 0.3) : kind == 3 ? Tex(w * 0.6, h * 0.62, Plaster, roof, 0.22) : Tex(w * 1.3, h * 0.6, Tiles(rh), roof, 0.4);
        return new ImageBrush { ImageSource = wb, Stretch = Stretch.Fill };
    }

    /// <summary>Cobbles on the square.</summary>
    private void Cobbles()
    {
        double w = W * 0.62, h = S(0.2);
        var e = new Ellipse { Width = w, Height = h, Fill = new ImageBrush { ImageSource = Tex(w / 1.6, h / 1.6, Cobble, null, 0.3), Stretch = Stretch.Fill }, IsHitTestVisible = false };
        At(e, X(0.5) - w / 2, Y(0.8)); C.Children.Add(e);
    }

    /// <summary>The grain of the ground, from the rise to the foot of the picture.</summary>
    private void GroundGrain() => Img(Tex(W / 3, H * 0.31 / 3, Grain, null, 0.26), 0, Y(0.69), W, H * 0.31);
}
