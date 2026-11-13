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
/// The match (2026-11-11, asked for players on the pitch, goals that come as if by chance, and no wave until one is scored).
///
/// Two sides of six play on the pitch in metres (105 by 68). Whoever has the ball weighs three things each half second or so: a
/// shot (worth more the nearer the goal), a pass to each team-mate (worth more the further on and the more open that player is, less
/// when an opponent stands in the lane), and running on with the ball (worth more with room ahead). The choice is drawn by chance in
/// proportion to those worths, so the play is never the same twice and the better option is only the likelier one. The other side
/// answers: the nearest one presses the ball, the next one stands between the ball and the goal, the rest keep their shape. A beat
/// makes the player on the ball decide at once and lifts the worth of a shot, and the game runs faster as the music gets louder.
/// A goal is the only thing that starts the wave.
/// </summary>
public sealed partial class StadiumWave
{
    private const int Side = 6, Men = Side * 2;
    private const double PitchL = 105, PitchW = 68, MidY = 34, Mouth = 3.66;
    private readonly double[] _mx = new double[Men], _my = new double[Men], _hx = new double[Men], _hy = new double[Men], _step = new double[Men], _hop = new double[Men];
    private readonly Canvas[] _manG = new Canvas[Men];
    private readonly CompositeTransform[] _manT = new CompositeTransform[Men];
    private readonly Line[] _legA = new Line[Men], _legB = new Line[Men], _sLegA = new Line[Men], _sLegB = new Line[Men], _sArmA = new Line[Men], _sArmB = new Line[Men];
    private readonly Canvas[] _vSide = new Canvas[Men], _vFB = new Canvas[Men], _fHead = new Canvas[Men], _bHead = new Canvas[Men], _armDn = new Canvas[Men], _armUp = new Canvas[Men];
    private readonly int[] _face = new int[Men];   // 0 side, to the right; 1 side, to the left; 2 toward the camera; 3 away from it; 4 toward the camera with the arms up
    private readonly double[] _dirX = new double[Men], _dirY = new double[Men], _went = new double[Men];
    private readonly int[] _manZ = new int[Men];
    private readonly double[] _worth = new double[Side + 2];
    private Ellipse _ball = null!, _ballShade = null!;
    private double _bx, _by, _bvx, _bvy, _decide, _hold, _celebrate, _keeperHolds, _manH, _pyf, _pyn, _pwf, _pwn;
    private double _tackleCool;
    private bool _shot;
    private double _still, _stillX = -99, _stillY;
    private int _passTo = -1, _owner = -1, _kicker = -1, _kickOff = -1, _scorers = -1;
    /// <summary>How long since the last goal, as a share of a minute and a half: a long wait makes a shot likelier and a save less likely,
    /// so a goal comes about once in a minute or two whatever the music does.</summary>
    private double _drought;
    private double Due => Math.Clamp((_drought - 45) / 60, 0, 1);

    /// <summary>Dev: the goals scored since the app started (a redraw of a logged stretch reports it).</summary>
    /// <summary>Dev: start in the cheer after a goal, to draw it.</summary>
    public static bool DevCheer;
    public static int DevGoals;
    /// <summary>Dev: shots, saves, shots wide, tackles won, passes, passes cut out.</summary>
    public static readonly int[] DevTally = new int[6];

    private double GX(double x, double y) { var v = y / PitchW; return _cx + (2 * x / PitchL - 1) * (_pwf + (_pwn - _pwf) * v); }
    private double GY(double y) => _pyf + (_pyn - _pyf) * (y / PitchW);
    private double Depth(double y) => (_pwf + (_pwn - _pwf) * (y / PitchW)) / _pwn;
    private static int TeamOf(int i) => i / Side;
    private static int Dir(int team) => team == 0 ? 1 : -1;
    private static double GoalX(int team) => team == 0 ? PitchL : 0;   // the goal a side shoots at
    private static double Dist(double ax, double ay, double bx, double by) => Math.Sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
    private static double ToSegment(double px, double py, double ax, double ay, double bx, double by)
    {
        double dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; var t = l2 < 1e-6 ? 0 : Math.Clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
        return Dist(px, py, ax + dx * t, ay + dy * t);
    }

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

        // the shape each side keeps: the keeper, two at the back, one in the middle, two up front
        var home = new[] { 5.0, 34, 26, 19, 26, 49, 46, 34, 66, 22, 66, 46 };
        for (var i = 0; i < Men; i++) { var k = i % Side; _hx[i] = TeamOf(i) == 0 ? home[k * 2] : PitchL - home[k * 2]; _hy[i] = home[k * 2 + 1]; _mx[i] = _hx[i]; _my[i] = _hy[i]; }
        _bx = PitchL / 2; _by = MidY; _bvx = _bvy = 0; _owner = -1; _kicker = -1; _kickOff = Rng.Next(2); _celebrate = 0; _scorers = -1; _decide = 0.5;
        if (DevCheer) { _celebrate = 6.5; _scorers = 0; for (var i = 0; i < Men; i++) { _mx[i] += (Rng.NextDouble() - 0.3) * 30 * Dir(TeamOf(i)); _my[i] += (Rng.NextDouble() - 0.5) * 16; } }
    }

    private void Run(int i, double tx, double ty, double speed, double g)
    {
        tx = Math.Clamp(tx, 0.5, PitchL - 0.5); ty = Math.Clamp(ty, 0.5, PitchW - 0.5);
        double dx = tx - _mx[i], dy = ty - _my[i], d = Math.Sqrt(dx * dx + dy * dy); if (d < 0.05) return;
        var go = Math.Min(d, speed * g); _mx[i] += dx / d * go; _my[i] += dy / d * go; _step[i] += go * 1.5; _dirX[i] = dx / d; _dirY[i] = dy / d; _went[i] = go;
    }

    private double NearestOpponent(int team, double x, double y, out int who)
    {
        var best = 1e9; who = -1;
        for (var j = 0; j < Men; j++) { if (TeamOf(j) == team) continue; var d = Dist(x, y, _mx[j], _my[j]); if (d < best) { best = d; who = j; } }
        return best;
    }

    private void Kick(int from, double tx, double ty, double speed, int to = -1)
    {
        double dx = tx - _bx, dy = ty - _by, d = Math.Max(0.1, Math.Sqrt(dx * dx + dy * dy));
        _bvx = dx / d * speed; _bvy = dy / d * speed; _owner = -1; _kicker = from; _hold = 0.4; _passTo = to; _shot = to < 0 && speed > 30;
    }

    /// <summary>The player on the ball chooses: each option gets a worth, and one is drawn by chance in proportion (a mixed strategy).</summary>
    private void Decide(int i, bool onBeat)
    {
        var team = TeamOf(i); var dir = Dir(team); double x = _mx[i], y = _my[i], gx = GoalX(team);
        var press = NearestOpponent(team, x, y, out _); var toGoal = Dist(x, y, gx, MidY);
        const int Shoot = Side, Carry = Side + 1;
        for (var k = 0; k < Side; k++)
        {
            var j = team * Side + k; _worth[k] = -9; if (j == i || (k == 0 && press > 4)) continue;
            var adv = (_mx[j] - x) * dir; var far = Dist(x, y, _mx[j], _my[j]); var open = Math.Min(1, NearestOpponent(team, _mx[j], _my[j], out _) / 10);
            var lane = 1e9; for (var o = 0; o < Men; o++) if (TeamOf(o) != team) lane = Math.Min(lane, ToSegment(_mx[o], _my[o], x, y, _mx[j], _my[j]));
            _worth[k] = 0.15 + 0.022 * adv * (adv > 0 ? 1 : 0.5) + 0.45 * open - (lane < 3 ? 9 : lane < 5.5 ? 0.6 : 0) + (press < 4 ? 0.35 : 0) - (far > 45 ? 0.3 : 0) - (far < 6 ? 0.3 : 0);
        }
        _worth[Shoot] = toGoal < 32 + 20 * Due ? (1.7 + 1.6 * Due) * (1 - toGoal / (32 + 20 * Due)) + (onBeat ? 0.35 : 0) - 0.1 : -9;
        var room = 10.0;
        for (var o = 0; o < Men; o++) if (TeamOf(o) != team && (_mx[o] - x) * dir > 0 && Math.Abs(_my[o] - y) < 8) room = Math.Min(room, Dist(x, y, _mx[o], _my[o]));
        _worth[Carry] = 0.5 + 0.04 * room - (press < 3 ? 0.5 : 0);
        if (i % Side == 0) { _worth[Carry] = -9; _worth[Shoot] = -9; }   // a keeper only gives the ball out
        double sum = 0; for (var k = 0; k < _worth.Length; k++) { _worth[k] = _worth[k] < -5 ? 0 : Math.Exp(_worth[k] / 0.3); sum += _worth[k]; }
        if (sum <= 0)
        {   // no open pass (a keeper has no other choice): a long ball up the field to the furthest team-mate
            var far = -1; for (var k = 1; k < Side; k++) { var j = team * Side + k; if (j != i && (far < 0 || (_mx[j] - _mx[far]) * dir > 0)) far = j; }
            Kick(i, _mx[far] + dir * 4, _my[far], 24, far); _decide = 0.6; return;
        }
        var pick = Rng.NextDouble() * sum; var choice = Carry;
        for (var k = 0; k < _worth.Length; k++) { pick -= _worth[k]; if (pick <= 0) { choice = k; break; } }
        if (choice == Shoot) DevTally[0]++; else if (choice < Side) DevTally[4]++;
        if (choice == Shoot) Kick(i, gx, MidY + (Rng.NextDouble() - 0.5) * 2 * (4.7 - 1.5 * Due), 36);
        else if (choice < Side) { var j = team * Side + choice; var far = Dist(x, y, _mx[j], _my[j]); Kick(i, _mx[j] + dir * 2.5, _my[j], Math.Min(25, 13 + 0.28 * far), j); }
        _decide = 0.45 + 0.5 * Rng.NextDouble();
    }

    /// <summary>One frame of the match. Returns true in the frame a goal is scored.</summary>
    private bool PlayMatch(TableauFrame f, double dt, bool onBeat)
    {
        var g = dt * f.Speed * (0.8 + 0.7 * f.Loud); var scored = false; _drought += dt; Array.Clear(_went);
        if (_celebrate > 0)
        {
            // after a goal: the scorers jump, everyone walks back, and the side that let it in kicks off
            _celebrate -= dt;
            for (var i = 0; i < Men; i++) { var cheer = TeamOf(i) == _scorers && _celebrate > 3; if (!cheer) Run(i, _hx[i], _hy[i], 7.5, Math.Max(g, dt * 0.8)); _hop[i] = cheer ? Math.Abs(Math.Sin(_celebrate * 8 + i * 1.3)) * Math.Min(1, (_celebrate - 3) * 2) : 0; }
            _bx = PitchL / 2; _by = MidY; _bvx = _bvy = 0; _owner = -1; _kicker = -1;
            if (_celebrate <= 0) { for (var i = 0; i < Men; i++) _hop[i] = 0; }
        }
        else
        {
            if (Dist(_bx, _by, _stillX, _stillY) > 3) { _stillX = _bx; _stillY = _by; _still = 0; } else _still += dt;
            if (_still > 6)
            {
                _still = 0; _stillX = -99;
                if (_owner >= 0) { var o = _owner; var a = Rng.NextDouble() * Math.PI * 2; Kick(o, _bx + Dir(TeamOf(o)) * 25 + Math.Cos(a) * 8, MidY + Math.Sin(a) * 20, 22); _shot = false; }
                else { _passTo = -1; _kickOff = -1; _hold = 0; _kicker = -1; }
            }
            _hold -= g; _decide -= g; _tackleCool -= g; if (_owner >= 0) { _passTo = -1; _shot = false; } if (onBeat) _decide = Math.Min(_decide, 0.05);
            var has = _owner >= 0 ? TeamOf(_owner) : -1;
            // who goes to the ball from each side: the nearest to where it will be (a keeper only near the own goal)
            int chase0 = -1, chase1 = -1, cover = -1; double d0 = 1e9, d1 = 1e9, dc = 1e9; double ax = _bx + _bvx * 0.4, ay = _by + _bvy * 0.4;
            for (var i = 0; i < Men; i++)
            {
                if (i == _owner) continue; var team = TeamOf(i);
                if (i % Side == 0 && Math.Abs(ax - (PitchL - GoalX(team))) > 14) continue;
                var d = Dist(_mx[i], _my[i], ax, ay); if (team == 0) { if (d < d0) { d0 = d; chase0 = i; } } else if (d < d1) { d1 = d; chase1 = i; }
            }
            // a pass has a receiver: that player comes to the ball, and the other side's nearest goes to mark them, not to cut the pass
            if (_owner < 0 && _passTo >= 0) { if (TeamOf(_passTo) == 0) chase0 = _passTo; else chase1 = _passTo; }
            if (has >= 0) { if (has == 0) chase0 = -1; else chase1 = -1; var presser = has == 0 ? chase1 : chase0; for (var i = 0; i < Men; i++) { if (TeamOf(i) == has || i == presser || i % Side == 0) continue; var d = Dist(_mx[i], _my[i], _bx, _by); if (d < dc) { dc = d; cover = i; } } }
            else if (_kickOff >= 0) { if (_kickOff == 0) chase1 = -1; else chase0 = -1; }   // the kick-off belongs to one side
            for (var i = 0; i < Men; i++)
            {
                var team = TeamOf(i); var dir = Dir(team); var own = PitchL - GoalX(team);
                if (i == _owner)
                {
                    if (i % Side == 0) { _keeperHolds -= g; if (_keeperHolds <= 0 && _decide <= 0) Decide(i, false); continue; }
                    if (_decide <= 0) { Decide(i, onBeat); if (_owner != i) continue; }
                    // run on with the ball toward the goal, and away from whoever stands in the way
                    var away = 0.0; NearestOpponent(team, _mx[i] + dir * 4, _my[i], out var blocker); if (blocker >= 0 && Dist(_mx[i], _my[i], _mx[blocker], _my[blocker]) < 9) away = _my[i] >= _my[blocker] ? 9 : -9;
                    Run(i, GoalX(team), MidY + (_my[i] - MidY) * 0.6 + away, 6.0, g);
                }
                else if ((i == chase0 || i == chase1) && _owner < 0 && _passTo >= 0 && team != TeamOf(_passTo)) Run(i, _mx[_passTo] - Dir(TeamOf(_passTo)) * 2.5, _my[_passTo], 6.4, g);
                else if (i == chase0 || i == chase1) Run(i, ax, ay, has >= 0 ? 6.7 : 7.4, g);
                else if (i == cover) Run(i, _bx + (own - _bx) * 0.35, _by + (MidY - _by) * 0.35, 6.2, g);
                else if (i % Side == 0) Run(i, _hx[i], MidY + Math.Clamp((_by - MidY) * 0.45, -3.4, 3.4), 5, g);
                else Run(i, _hx[i] + (_bx - PitchL / 2) * 0.4 + (has == team ? 9 * dir : has >= 0 ? -5 * dir : 0), _hy[i] + (_by - MidY) * 0.3, 5.2, g);
            }
            if (_owner >= 0)
            {
                var team = TeamOf(_owner); _bx = _mx[_owner] + Dir(team) * 0.9; _by = _my[_owner]; _bvx = _bvy = 0;
                // the tackle: an opponent at the ball takes it, or knocks it loose
                var near = NearestOpponent(team, _bx, _by, out var thief);
                if (near < 1.6 && _owner % Side != 0 && _tackleCool <= 0 && Rng.NextDouble() < 0.6 * (1 - 0.7 * Due) * g)
                {
                    if (Rng.NextDouble() < 0.88) { DevTally[3]++; _owner = thief; _decide = 0.8; _tackleCool = 1.6; }
                    else { var a = Rng.NextDouble() * Math.PI * 2; _kicker = _owner; _owner = -1; _hold = 0.3; _bvx = Math.Cos(a) * 7; _bvy = Math.Sin(a) * 7; }
                }
            }
            else
            {
                _bx += _bvx * g; _by += _bvy * g; var slow = Math.Exp(-0.55 * g); _bvx *= slow; _bvy *= slow;
                var speed = Math.Sqrt(_bvx * _bvx + _bvy * _bvy);
                for (var i = 0; i < Men && _owner < 0; i++)
                {
                    if (i == _kicker && _hold > 0) continue;
                    // a shot is the keeper's to stop on the line; an outfield player in its way blocks it only now and then
                    if (_shot && speed > 10 && (i % Side == 0 || Dist(_mx[i], _my[i], _bx, _by) > 1.1 || Rng.NextDouble() > 0.8 * g)) continue;
                    if (_passTo >= 0 && speed > 4 && TeamOf(i) != TeamOf(_passTo) && Rng.NextDouble() > 0.4 * g) continue;   // a pass in flight is seldom cut out
                    if (Dist(_mx[i], _my[i], _bx, _by) < 1.6 && (speed < 17 || Rng.NextDouble() < 0.12)) { if (_passTo >= 0 && TeamOf(i) != TeamOf(_passTo)) DevTally[5]++; _owner = i; _kickOff = -1; _decide = 0.3 + 0.4 * Rng.NextDouble(); _keeperHolds = 0.9; }
                }
                if (_owner < 0 && (_bx <= 0 || _bx >= PitchL))
                {
                    var defending = _bx <= 0 ? 0 : 1; var keeper = defending * Side;
                    if (Math.Abs(_by - MidY) < Mouth)
                    {
                        var reach = Math.Abs(_my[keeper] - _by); var saved = Rng.NextDouble() < (reach < 1.6 ? 0.88 : reach < 3.2 ? 0.6 : 0.15) * (1 - 0.8 * Due);
                        if (saved) { DevTally[1]++; _owner = keeper; _keeperHolds = 1.0; _decide = 0; }
                        else { scored = true; DevGoals++; _drought = 0; _scorers = 1 - defending; _kickOff = defending; _celebrate = 7.5; }
                    }
                    else { DevTally[2]++; _owner = keeper; _keeperHolds = 1.2; _decide = 0; }   // wide: the keeper's ball
                    _mx[keeper] = Math.Clamp(_mx[keeper], 1, PitchL - 1); if (_owner == keeper) { _bx = _mx[keeper]; _by = _my[keeper]; }
                }
                if (_owner < 0 && !scored && (_by < 0 || _by > PitchW)) { _by = Math.Clamp(_by, 0.3, PitchW - 0.3); _bvx *= 0.2; _bvy = 0; }
            }
        }

        // ---- draw: a player and the ball at their places on the pitch, smaller toward the far side
        for (var i = 0; i < Men; i++)
        {
            // which way the player looks: the scorers at the near stand, a keeper along the pitch, the rest where they run
            // (or at the ball when they stand). A look is kept until the run turns well past the diagonal, so it does not flicker
            var face = _face[i]; var moving = _went[i] > 1.2 * Math.Max(g, 1e-4) && g > 0; double ax = Math.Abs(_dirX[i]), ay = Math.Abs(_dirY[i]);
            if (_hop[i] > 0) face = 4;
            else if (i % Side == 0 || !moving) face = (i % Side == 0 ? Dir(TeamOf(i)) > 0 : _bx >= _mx[i]) ? 0 : 1;
            else if (face < 2 ? ay > 1.7 * ax : ay > 0.9 * ax) face = _dirY[i] > 0 ? 2 : 3;
            else face = _dirX[i] >= 0 ? 0 : 1;
            if (face != _face[i])
            {
                _face[i] = face; var side = face < 2;
                _vSide[i].Visibility = side ? Visibility.Visible : Visibility.Collapsed; _vFB[i].Visibility = side ? Visibility.Collapsed : Visibility.Visible;
                _bHead[i].Visibility = face == 3 ? Visibility.Visible : Visibility.Collapsed; _fHead[i].Visibility = face == 3 ? Visibility.Collapsed : Visibility.Visible;
                _armUp[i].Visibility = face == 4 ? Visibility.Visible : Visibility.Collapsed; _armDn[i].Visibility = face == 4 ? Visibility.Collapsed : Visibility.Visible;
            }
            var sc = Depth(_my[i]); var t = _manT[i]; var hgt = _manH; t.TranslateX = GX(_mx[i], _my[i]); t.TranslateY = GY(_my[i]) - _hop[i] * hgt * 0.4 * sc; t.ScaleY = sc; t.ScaleX = face == 1 ? -sc : sc;
            double sw = moving ? Math.Sin(_step[i]) : 0, cw = moving ? Math.Cos(_step[i]) : 1;
            if (face < 2)
            {   // the legs scissor and the arms swing against them; the back foot lifts
                _sLegA[i].X2 = sw * hgt * 0.24; _sLegA[i].Y2 = -Math.Max(0, -cw) * hgt * 0.1 * (moving ? 1 : 0); _sLegB[i].X2 = -sw * hgt * 0.24; _sLegB[i].Y2 = -Math.Max(0, cw) * hgt * 0.1 * (moving ? 1 : 0);
                _sArmA[i].X2 = hgt * 0.02 - sw * hgt * 0.17; _sArmB[i].X2 = sw * hgt * 0.17;
            }
            else { _legA[i].Y2 = -Math.Max(0, sw) * hgt * 0.13; _legB[i].Y2 = -Math.Max(0, -sw) * hgt * 0.13; }
            var z = (int)(_my[i] * 4); if (z != _manZ[i]) { _manZ[i] = z; Canvas.SetZIndex(_manG[i], z); }
        }
        var bs = Depth(_by); var bd = S(0.011) * bs; double sx = GX(_bx, _by), sy = GY(_by);
        Size(_ball, sx, sy - bd * 0.6, bd); Size(_ballShade, sx, sy, bd * 1.3, bd * 0.4); Canvas.SetZIndex(_ball, (int)(_by * 4) + 1);
        return scored;
    }
}
