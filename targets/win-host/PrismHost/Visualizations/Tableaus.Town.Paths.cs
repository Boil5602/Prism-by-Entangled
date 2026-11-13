using System.Globalization;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== SEASONS: curved shapes
// This file is pure ASCII.

/// <summary>
/// Curved shapes for the town (2026-11-12, asked for the detail a drawn picture has): an outline written the way a vector
/// picture writes it (M move, L line, C curve, Q curve, Z close; absolute numbers), read here into a geometry. A shape is written
/// in units of the thing it belongs to (a person's unit, a hundredth of the height) and set to size once, when it is made.
/// </summary>
public sealed partial class SeasonsTown
{
    private static Geometry Geo(string d)
    {
        var g = new PathGeometry(); PathFigure? f = null; var i = 0; var cmd = ' ';
        double Num()
        {
            while (i < d.Length && (d[i] == ' ' || d[i] == ',')) i++;
            var s = i; if (i < d.Length && d[i] == '-') i++;
            while (i < d.Length && (char.IsDigit(d[i]) || d[i] == '.')) i++;
            return double.Parse(d.AsSpan(s, i - s), CultureInfo.InvariantCulture);
        }
        Pt P() { var x = Num(); var y = Num(); return new Pt(x, y); }
        while (true)
        {
            while (i < d.Length && (d[i] == ' ' || d[i] == ',')) i++;
            if (i >= d.Length) break;
            if (char.IsLetter(d[i])) { cmd = d[i++]; if (cmd == 'Z') { if (f is not null) f.IsClosed = true; continue; } }
            switch (cmd)
            {
                case 'M': f = new PathFigure { StartPoint = P(), IsFilled = true }; g.Figures.Add(f); cmd = 'L'; break;
                case 'L': f!.Segments.Add(new LineSegment { Point = P() }); break;
                case 'C': { var a = P(); var b = P(); var c = P(); f!.Segments.Add(new BezierSegment { Point1 = a, Point2 = b, Point3 = c }); break; }
                case 'Q': { var a = P(); var b = P(); f!.Segments.Add(new QuadraticBezierSegment { Point1 = a, Point2 = b }); break; }
                default: throw new FormatException("outline: " + cmd);
            }
        }
        return g;
    }

    /// <summary>A filled curved shape: the outline <paramref name="d"/> in its own units, <paramref name="k"/> canvas units to one of them, set at x, y.</summary>
    private Microsoft.UI.Xaml.Shapes.Path Sv(string d, Color c, double k, double op = 1, double x = 0, double y = 0)
    {
        var p = new Microsoft.UI.Xaml.Shapes.Path { Data = Geo(d), Fill = B(c), Opacity = Clamp01(op), RenderTransform = new ScaleTransform { ScaleX = k, ScaleY = k } };
        At(p, x, y); C.Children.Add(p); return p;
    }

    // ---- a person, in units of the person (feet at 0, the head's middle at -4.5)
    private const string Torso = "M -0.95 -3.2 C -0.95 -3.75 -0.5 -3.8 0 -3.8 C 0.5 -3.8 0.95 -3.75 0.95 -3.2 L 0.8 -1.75 C 0.8 -1.55 -0.8 -1.55 -0.8 -1.75 Z";
    private const string Robe = "M -0.95 -3.2 C -0.95 -3.75 -0.5 -3.8 0 -3.8 C 0.5 -3.8 0.95 -3.75 0.95 -3.2 L 1.0 -2.2 C 1.1 -1.4 1.25 -0.8 1.3 -0.25 C 0.6 0 -0.6 0 -1.3 -0.25 C -1.25 -0.8 -1.1 -1.4 -1.0 -2.2 Z";
    private const string Hem = "M -1.24 -0.75 C -0.5 -0.5 0.5 -0.5 1.24 -0.75 L 1.3 -0.25 C 0.6 0 -0.6 0 -1.3 -0.25 Z";
    private const string Leg = "M -0.32 0 L 0.32 0 L 0.25 1.5 L -0.25 1.5 Z";
    private const string Shoe = "M -0.28 1.45 L 0.3 1.45 C 0.7 1.5 0.8 1.75 0.72 1.75 L -0.28 1.75 Z";
    private const string Smile = "M -0.22 -4.26 Q 0 -4.05 0.22 -4.26 Q 0 -4.16 -0.22 -4.26 Z";
    private const string HairCap = "M -0.72 -4.5 C -0.75 -5.4 0.75 -5.4 0.72 -4.5 C 0.5 -4.95 -0.3 -5.0 -0.72 -4.5 Z";
    private const string HairLong = "M -0.8 -4.6 C -0.85 -5.5 0.85 -5.5 0.8 -4.6 L 0.9 -3.3 C 0.5 -3.1 -0.5 -3.1 -0.9 -3.3 Z";
    private const string ScarfBack = "M -0.9 -4.5 C -0.95 -5.55 0.95 -5.55 0.9 -4.5 C 0.95 -3.9 0.8 -3.4 0.6 -3.3 L -0.6 -3.3 C -0.8 -3.4 -0.95 -3.9 -0.9 -4.5 Z";
    private const string ScarfFront = "M -0.72 -4.6 C -0.7 -5.3 0.7 -5.3 0.72 -4.6 C 0.4 -5.0 -0.4 -5.0 -0.72 -4.6 Z";
    private const string HatCrown = "M -0.6 -5.05 C -0.6 -5.8 0.6 -5.8 0.6 -5.05 Z";
    private const string HatBand = "M -0.6 -5.2 L 0.6 -5.2 L 0.6 -5.05 L -0.6 -5.05 Z";
    private const string Wrap = "M -0.8 -4.75 C -0.9 -5.6 0.9 -5.6 0.8 -4.75 C 0.4 -5.0 -0.4 -5.0 -0.8 -4.75 Z";
    private const string WrapFold = "M -0.6 -5.2 C -0.2 -5.0 0.3 -5.3 0.65 -5.1 L 0.6 -5.0 C 0.3 -5.2 -0.2 -4.9 -0.6 -5.1 Z";
    private const string Cap = "M -0.5 -5.05 C -0.45 -5.4 0.45 -5.4 0.5 -5.05 Z";
    private const string Beard = "M -0.6 -4.4 C -0.6 -3.6 0.6 -3.6 0.6 -4.4 C 0.3 -4.15 -0.3 -4.15 -0.6 -4.4 Z";
    private const string Sash = "M -0.5 -3.8 C -0.3 -3.4 0.3 -3.4 0.5 -3.8 L 0.45 -3.55 C 0.2 -3.2 -0.2 -3.2 -0.45 -3.55 Z";
    private const string Neck = "M -0.28 -3.8 L 0 -3.35 L 0.28 -3.8 Z";
    private const string Belt = "M -0.84 -2.6 L 0.84 -2.6 L 0.82 -2.35 L -0.82 -2.35 Z";
    // ---- the great tree, in hundredths of the height (the foot of the trunk at 0)
    private const string Trunk = "M -1.8 0 C -1.2 -4 -1.0 -10 -1.1 -16 C -2.5 -19 -4.5 -22 -5 -24 C -3 -22.5 -1.5 -21 -1 -20 C -0.6 -24 -0.2 -27 0 -30 C 0.3 -27 0.8 -24 1.2 -20 C 2 -21.5 3.8 -23 5.5 -25 C 4.5 -22 2.6 -19 1.1 -16 C 1.0 -10 1.2 -4 2.2 0 C 1 0.6 -1 0.6 -1.8 0 Z";
    private const string Bark = "M -0.6 -1 C -0.3 -6 -0.3 -11 -0.4 -15 L 0.1 -15 C 0.1 -11 0 -6 0.2 -1 Z";
}
