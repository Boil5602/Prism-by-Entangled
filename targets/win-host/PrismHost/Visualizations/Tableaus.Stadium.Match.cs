using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== Stadium Wave: the match on the pitch
// This file is pure ASCII.

/// <summary>
/// The match on the pitch: the players, the goals and the ball as drawn. The game itself is StadiumSim (Tableaus.Stadium.Sim.cs,
/// written again 2026-11-17): this file only draws where it says everyone is. A goal is the only thing that starts the wave.
/// The music does not drive the play. Now and then a strong beat lets a player close to the goal strike at once (StadiumSim.BigBeat).
/// </summary>
public sealed partial class StadiumWave
{
    private const int Side = StadiumSim.Side, Men = StadiumSim.Men;
    private const double PitchL = StadiumSim.L, PitchW = StadiumSim.W, MidY = StadiumSim.MidY, Mouth = StadiumSim.Mouth;
    private StadiumSim _sim = null!;
    private readonly Canvas[] _manG = new Canvas[Men];
    private readonly CompositeTransform[] _manT = new CompositeTransform[Men];
    private readonly Line[] _legA = new Line[Men], _legB = new Line[Men], _sLegA = new Line[Men], _sLegB = new Line[Men], _sArmA = new Line[Men], _sArmB = new Line[Men];
    private readonly Canvas[] _vSide = new Canvas[Men], _vFB = new Canvas[Men], _fHead = new Canvas[Men], _bHead = new Canvas[Men], _armDn = new Canvas[Men], _armUp = new Canvas[Men];
    private readonly int[] _face = new int[Men];   // 0 side, to the right; 1 side, to the left; 2 toward the camera; 3 away from it; 4 toward the camera with the arms up
    private readonly int[] _manZ = new int[Men];
    private Ellipse _ball = null!, _ballShade = null!;
    private double _manH, _pyf, _pyn, _pwf, _pwn;
    /// <summary>What the game did in the last frame, for the lights: a shot, a save, a shot just wide, and how near a goal the ball is (0 to 1).</summary>
    private bool _evShot, _evSave, _evClose;
    private double _threat;
    private readonly int[] _score = new int[2];

    /// <summary>Dev: start in the cheer after a goal, to draw it.</summary>
    public static bool DevCheer;
    /// <summary>Dev: the goals scored since the app started.</summary>
    public static int DevGoals;

    private double GX(double x, double y) { var v = y / PitchW; return _cx + (2 * x / PitchL - 1) * (_pwf + (_pwn - _pwf) * v); }
    private double GY(double y) => _pyf + (_pyn - _pyf) * (y / PitchW);
    private double Depth(double y) => (_pwf + (_pwn - _pwf) * (y / PitchW)) / _pwn;
    private static int TeamOf(int i) => StadiumSim.Team(i);

    /// <summary>The goals, the players and the ball, drawn over the pitch. yf / yn: the far and near touchlines on the stage; wf / wn: half the pitch's width there.</summary>
    private void BuildMatch(double yf, double yn, double wf, double wn)
    {
        _pyf = yf; _pyn = yn; _pwf = wf; _pwn = wn; _manH = S(0.05);
        var white = B(White); var net = B(A(White, 0.32)); var thick = Math.Max(1.6, S(0.0036));
        void Goal(double gx, int outward)
        {
            // a goal seen from the side: the frame on the goal line, the net falling back from the bar to the ground behind it
            double y0 = MidY - Mouth, y1 = MidY + Mouth, back = gx + outward * 2.4;
            double fx0 = GX(gx, y0), fy0 = GY(y0), fx1 = GX(gx, y1), fy1 = GY(y1), h0 = S(0.05) * Depth(y0), h1 = S(0.05) * Depth(y1);
            double bx0 = GX(back, y0), bx1 = GX(back, y1);
            GB(B(A(White, 0.1)), 1, fx0, fy0 - h0, fx1, fy1 - h1, bx1, fy1, bx0, fy0);
            GB(B(A(White, 0.07)), 1, fx1, fy1 - h1, fx1, fy1, bx1, fy1);
            for (var k = 1; k < 6; k++) { var t = k / 6.0; L(fx0 + (fx1 - fx0) * t, fy0 - h0 + (fy1 - h1 - fy0 + h0) * t, bx0 + (bx1 - bx0) * t, fy0 + (fy1 - fy0) * t, White, Math.Max(1, thick * 0.4), 0.3); }
            for (var k = 1; k < 4; k++) { var t = k / 4.0; L(fx0 + (bx0 - fx0) * t, fy0 - h0 * (1 - t), fx1 + (bx1 - fx1) * t, fy1 - h1 * (1 - t), White, Math.Max(1, thick * 0.4), 0.3); }
            var rear = PL(net, Math.Max(1, thick * 0.6)); rear.Points.Add(new Pt(fx0, fy0 - h0)); rear.Points.Add(new Pt(bx0, fy0)); rear.Points.Add(new Pt(bx1, fy1)); rear.Points.Add(new Pt(fx1, fy1 - h1));
            var frame = PL(white, thick, 0.95); frame.Points.Add(new Pt(fx0, fy0)); frame.Points.Add(new Pt(fx0, fy0 - h0)); frame.Points.Add(new Pt(fx1, fy1 - h1)); frame.Points.Add(new Pt(fx1, fy1));
        }
        Goal(0, -1); Goal(PitchL, 1);

        var field = new Canvas(); C.Children.Add(field); var root = C; C = field;
        _ballShade = E(0, 0, S(0.012), Rgb(0x061008), 0.45); _ballShade.Height = S(0.004);
        // a player has three looks (2026-11-11, asked for players that are less flat): from the side when running along the pitch,
        // from the front when coming toward the camera, from the back when going away. The side look is drawn facing right and
        // mirrored for the left
        var h = _manH; var skins = new[] { Rgb(0xE8C8A4), Rgb(0xC99A6E), Rgb(0x8A5A3A), Rgb(0xF0D4B4) }; var hairs = new[] { Rgb(0x1A1410), Rgb(0x3A2616), Rgb(0x6A4A22), Rgb(0x0C0C10) };
        Canvas Part(Canvas into) { var c = new Canvas(); into.Children.Add(c); C = c; return c; }
        for (var i = 0; i < Men; i++)
        {
            var team = TeamOf(i); var keeper = i % Side == 0; var skin = skins[Rng.Next(skins.Length)]; var hair = hairs[Rng.Next(hairs.Length)];
            var shirt = keeper ? (team == 0 ? Rgb(0xF2E26B) : Rgb(0x7CE8A0)) : Mix(P(team == 0 ? 1 : 3), White, 0.18); var shorts = team == 0 ? Rgb(0x101828) : Rgb(0xF0F0F4);
            var shade = Mix(shirt, Rgb(0x000000), 0.28); var far = Mix(skin, Rgb(0x000000), 0.3);
            var g = new Canvas(); C.Children.Add(g); _manT[i] = new CompositeTransform(); g.RenderTransform = _manT[i]; _manG[i] = g; C = g;
            var sh = E(0, 0, h * 0.5, Rgb(0x061008), 0.4); sh.Height = h * 0.12; At(sh, -h * 0.25, -h * 0.06);

            // ---- from the side: the far leg and arm darker, the body narrow and leaning into the run, the face ahead of the hair
            _vSide[i] = Part(g);
            _sArmB[i] = L(0, -h * 0.76, 0, -h * 0.52, shade, h * 0.07); _sLegB[i] = L(0, -h * 0.45, 0, 0, far, h * 0.09);
            _sLegA[i] = L(0, -h * 0.45, 0, 0, skin, h * 0.09);
            var sHips = RB(-h * 0.085, -h * 0.52, h * 0.17, h * 0.17, B(shorts)); sHips.RadiusX = sHips.RadiusY = h * 0.04;
            G(shirt, 1, -h * 0.1, -h * 0.47, -h * 0.07, -h * 0.82, h * 0.03, -h * 0.86, h * 0.13, -h * 0.8, h * 0.09, -h * 0.47);
            _sArmA[i] = L(h * 0.02, -h * 0.78, 0, -h * 0.52, shirt, h * 0.07);
            E(h * 0.045, -h * 0.94, h * 0.19, skin); var sHair = E(0, 0, h * 0.18, hair); sHair.Height = h * 0.15; At(sHair, -h * 0.085, -h * 1.05);

            // ---- from the front and from the back: one body, two heads, and the arms down or up
            _vFB[i] = Part(g);
            _legA[i] = L(-h * 0.06, -h * 0.42, -h * 0.07, 0, skin, h * 0.09); _legB[i] = L(h * 0.06, -h * 0.42, h * 0.07, 0, skin, h * 0.09);
            var hips = RB(-h * 0.13, -h * 0.5, h * 0.26, h * 0.16, B(shorts)); hips.RadiusX = hips.RadiusY = h * 0.04;
            var body = RB(-h * 0.14, -h * 0.82, h * 0.28, h * 0.36, Vertical((shirt, 0), (shade, 1))); body.RadiusX = body.RadiusY = h * 0.08;
            _armDn[i] = Part(_vFB[i]); L(-h * 0.15, -h * 0.76, -h * 0.2, -h * 0.52, shirt, h * 0.07); L(h * 0.15, -h * 0.76, h * 0.2, -h * 0.52, shirt, h * 0.07);
            _armUp[i] = Part(_vFB[i]); L(-h * 0.14, -h * 0.78, -h * 0.26, -h * 1.08, shirt, h * 0.07); L(h * 0.14, -h * 0.78, h * 0.26, -h * 1.08, shirt, h * 0.07); E(-h * 0.27, -h * 1.1, h * 0.08, skin); E(h * 0.27, -h * 1.1, h * 0.08, skin);
            _fHead[i] = Part(_vFB[i]); E(0, -h * 0.92, h * 0.2, skin); var fringe = E(0, 0, h * 0.2, hair); fringe.Height = h * 0.09; At(fringe, -h * 0.1, -h * 1.03);
            _bHead[i] = Part(_vFB[i]); RB(-h * 0.035, -h * 0.86, h * 0.07, h * 0.06, B(skin)); E(0, -h * 0.93, h * 0.2, hair); RB(-h * 0.04, -h * 0.74, h * 0.08, h * 0.13, B(A(White, 0.75)));
            _vFB[i].Visibility = Visibility.Collapsed; _armUp[i].Visibility = Visibility.Collapsed; _bHead[i].Visibility = Visibility.Collapsed; _face[i] = team == 0 ? 0 : 1;
            C = field; _manZ[i] = -1;
        }
        _ball = E(0, 0, S(0.011), White);
        C = root;

        _sim = new StadiumSim(new Random());   // its own chance, seeded from the clock: no two matches are the same (the scene's Rng starts the same each time) _score[0] = _score[1] = 0; if (DevCheer) _sim.Cheer(0);
    }

    /// <summary>One frame of the match. Returns true in the frame a goal is scored. strong: a strong beat fell in this frame.</summary>
    private bool PlayMatch(TableauFrame f, double dt, bool strong)
    {
        var sim = _sim; var g = dt * f.Speed * 1.25; var scored = false; _evShot = _evSave = _evClose = false;
        if (strong && sim.BigBeat()) _evShot = true;
        var n = Math.Max(1, (int)Math.Ceiling(g / 0.02));
        for (var k = 0; k < n; k++)
        {
            sim.Step(g / n);
            if (sim.EvGoal) { scored = true; DevGoals++; _score[sim.Scorers]++; }
            _evShot |= sim.EvShot; _evSave |= sim.EvSave; _evClose |= sim.EvClose;
        }
        _threat = sim.Celebrate > 0 ? 0 : Math.Clamp(1 - Math.Min(sim.BX, PitchL - sim.BX) / 34, 0, 1);

        // ---- draw: a player and the ball at their places on the pitch, smaller toward the far side
        for (var i = 0; i < Men; i++)
        {
            // which way the player looks: the scorers at the near stand, a keeper along the pitch, the rest where they run
            // (or at the ball when they stand). A look is kept until the run turns well past the diagonal, so it does not flicker
            double vx = sim.VX[i], vy = sim.VY[i], sp = Math.Sqrt(vx * vx + vy * vy), mx = sim.X[i], my = sim.Y[i];
            var face = _face[i]; var moving = sp > 1.2 && g > 0; double ax = Math.Abs(vx), ay = Math.Abs(vy); var keeper = i % Side == 0;
            if (sim.Hop[i] > 0) face = 4;
            else if (keeper || !moving) face = (keeper ? StadiumSim.Dir(TeamOf(i)) > 0 : sim.BX >= mx) ? 0 : 1;
            else if (face < 2 ? ay > 1.7 * ax : ay > 0.9 * ax) face = vy > 0 ? 2 : 3;
            else face = vx >= 0 ? 0 : 1;
            if (face != _face[i])
            {
                _face[i] = face; var side = face < 2;
                _vSide[i].Visibility = side ? Visibility.Visible : Visibility.Collapsed; _vFB[i].Visibility = side ? Visibility.Collapsed : Visibility.Visible;
                _bHead[i].Visibility = face == 3 ? Visibility.Visible : Visibility.Collapsed; _fHead[i].Visibility = face == 3 ? Visibility.Collapsed : Visibility.Visible;
                _armUp[i].Visibility = face == 4 ? Visibility.Visible : Visibility.Collapsed; _armDn[i].Visibility = face == 4 ? Visibility.Collapsed : Visibility.Visible;
            }
            var sc = Depth(my); var t = _manT[i]; var hgt = _manH; t.TranslateX = GX(mx, my); t.TranslateY = GY(my) - sim.Hop[i] * hgt * 0.4 * sc; t.ScaleY = sc; t.ScaleX = face == 1 ? -sc : sc;
            // a keeper going down for a shot leans over, toward the near side or the far one
            var dive = sim.Dive[i]; t.Rotation = dive * 62; if (dive != 0) t.TranslateY -= Math.Abs(dive) * hgt * 0.12 * sc;
            double sw = moving ? Math.Sin(sim.Stride[i]) : 0, cw = moving ? Math.Cos(sim.Stride[i]) : 1;
            if (face < 2)
            {   // the legs scissor and the arms swing against them; the back foot lifts
                _sLegA[i].X2 = sw * hgt * 0.24; _sLegA[i].Y2 = -Math.Max(0, -cw) * hgt * 0.1 * (moving ? 1 : 0); _sLegB[i].X2 = -sw * hgt * 0.24; _sLegB[i].Y2 = -Math.Max(0, cw) * hgt * 0.1 * (moving ? 1 : 0);
                _sArmA[i].X2 = hgt * 0.02 - sw * hgt * 0.17; _sArmB[i].X2 = sw * hgt * 0.17;
            }
            else { _legA[i].Y2 = -Math.Max(0, sw) * hgt * 0.13; _legB[i].Y2 = -Math.Max(0, -sw) * hgt * 0.13; }
            var z = (int)(my * 4); if (z != _manZ[i]) { _manZ[i] = z; Canvas.SetZIndex(_manG[i], z); }
        }
        // the ball: its shade stays on the grass, the ball itself rises over it
        double by = Math.Clamp(sim.BY, 0, PitchW), bx = Math.Clamp(sim.BX, -1.5, PitchL + 1.5);
        var bs = Depth(by); var bd = S(0.011) * bs; double sx = GX(bx, by), sy = GY(by), up = sim.BZ * _manH / 1.8 * bs;
        Size(_ball, sx, sy - bd * 0.6 - up, bd); Size(_ballShade, sx, sy, bd * 1.3 * (1 + Math.Min(1, sim.BZ / 8)), bd * 0.4); Op(_ballShade, 0.45 / (1 + sim.BZ * 0.25)); Canvas.SetZIndex(_ball, (int)(by * 4) + 1);
        return scored;
    }
}
