using System;

namespace PrismHost.Visualizations;

// =============================================================== Stadium Wave: the game itself, with nothing drawn
// This file is pure ASCII and names nothing of the UI, so a console test can run hours of play (scripts/viz/stadium-sim).

/// <summary>
/// The game (written again 2026-11-17, asked for a game worth watching: the players had moved as one, ran into each other and
/// followed the music's loudness).
///
/// Two sides of six on a pitch in metres. A player has a speed and turns with it, so nobody changes place in a frame. Nobody
/// stands inside another: players push apart, team-mates further than opponents, and more along the pitch than across it, since
/// the pitch is seen from the side and two players at one place along it read as one. Each side keeps a shape that moves with the
/// ball. With the ball: one team-mate comes near to be played to, the forwards make runs into open ground, the player on the ball
/// weighs a shot, each pass (along the ground, lifted over a player in the way, into the run of a forward, a cross from the wing)
/// and running on, and one is drawn by chance in proportion. Without it: one presses the ball, one stands between the ball and the
/// goal, the rest stand goal-side of the nearest opponent. Who presses is kept for a while, so the side does not change its mind
/// each frame. A tackle wins the ball, knocks it loose, or is beaten. A keeper moves to the shot after a moment and catches it,
/// pushes it away (a second chance, or a corner), or is beaten. The ball leaves the ground and bounces. Out of play gives a
/// throw, a corner or a goal kick. The music does not move the game: the one tie is BigBeat, which now and then lets a shot from
/// close in start on a strong beat, so that a goal can land with the music.
/// </summary>
internal sealed class StadiumSim
{
    public const int Side = 6, Men = Side * 2;
    public const double L = 105, W = 68, MidY = 34, Mouth = 3.66, Bar = 2.44;
    // A player is drawn some eight metres tall on this pitch, so two within about three metres along it are drawn as one whatever
    // lies between them across it: the push counts a metre across the pitch as a fifth of one along it.
    private const double Squash = 0.2, Floor = 2.3, Grav = 9.8;

    public readonly double[] X = new double[Men], Y = new double[Men], VX = new double[Men], VY = new double[Men];
    /// <summary>Hop: a cheer's jump, 0 to 1. Dive: a keeper going down, -1 to 1 (the sign is the way). Went: metres moved this step. Stride: for the legs.</summary>
    public readonly double[] Hop = new double[Men], Dive = new double[Men], Went = new double[Men], Stride = new double[Men];
    public double BX, BY, BZ, BVX, BVY, BVZ;
    public int Owner = -1, Scorers = -1;
    public double Celebrate;
    /// <summary>What happened in the last Step, for the lights.</summary>
    public bool EvGoal, EvShot, EvSave, EvClose;
    /// <summary>Dev: shots, saves, off target, tackles won, passes, passes cut out, goals, goals on a beat, corners, throws.</summary>
    public readonly int[] Tally = new int[10];
    /// <summary>Dev: the nearest two players came this step, in the measure the push uses.</summary>
    public double MinGap = 99;

    private readonly Random _r;
    private readonly double[] _tx = new double[Men], _ty = new double[Men], _cap = new double[Men], _think = new double[Men], _runX = new double[Men], _runY = new double[Men], _stun = new double[Men];
    private readonly double[] _worth = new double[Side + 2], _ptX = new double[Side], _ptY = new double[Side];
    private readonly bool[] _loft = new bool[Side], _taken = new bool[Men];
    private readonly int[] _press = { -1, -1 }, _cover = { -1, -1 };
    private static readonly double[] BaseX = { 5, 24, 24, 44, 62, 62 }, BaseY = { 34, 19, 49, 34, 21, 47 };
    private int _kicker = -1, _passTo = -1, _last = -1, _tried, _prevHas = -2, _kickTeam, _swerve = 1, _blocker = -1;
    private double _hold, _decide, _tackleCool, _keeperHolds, _drought, _sinceBeatGoal = 99, _shotT, _burst, _pX, _pY, _still, _stillX = -99, _stillY, _hx = 1, _hy;
    private bool _shot, _destined, _firstTime;
    private int _re, _reTeam, _reTaker = -1, _set;   // a restart: 1 throw, 2 corner, 3 goal kick, 4 kick-off; _set: the restart the player on the ball has just taken
    private double _reX, _reY, _reT;

    /// <summary>How long since the last goal: a long wait makes a shot likelier and a save less likely, so a goal comes about once in a minute or two.</summary>
    private double Due => Math.Clamp((_drought - 25) / 55, 0, 1);

    public StadiumSim(Random r) { _r = r; Reset(); }

    public static int Team(int i) => i / Side;
    public static int Dir(int team) => team == 0 ? 1 : -1;
    public static double GoalX(int team) => team == 0 ? L : 0;   // the goal a side shoots at
    private static bool Keeper(int i) => i % Side == 0;
    private static double Dist(double ax, double ay, double bx, double by) => Math.Sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
    private static double ToSegment(double px, double py, double ax, double ay, double bx, double by)
    {
        double dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; var t = l2 < 1e-6 ? 0 : Math.Clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
        return Dist(px, py, ax + dx * t, ay + dy * t);
    }
    private double Rnd() => _r.NextDouble();
    private int Has => Owner >= 0 ? Team(Owner) : _passTo >= 0 ? Team(_passTo) : -1;

    public void Reset()
    {
        for (var i = 0; i < Men; i++) { var k = i % Side; X[i] = Team(i) == 0 ? BaseX[k] : L - BaseX[k]; Y[i] = BaseY[k]; VX[i] = VY[i] = Hop[i] = Dive[i] = _stun[i] = _runX[i] = _runY[i] = 0; _think[i] = Rnd() * 2; }
        BX = L / 2; BY = MidY; BZ = BVX = BVY = BVZ = 0; Owner = -1; _kicker = _passTo = -1; _shot = false; Celebrate = 0; Scorers = -1; _drought = 0;
        StartRestart(4, _r.Next(2), L / 2, MidY);
    }

    /// <summary>Dev: the cheer after a goal, to draw it.</summary>
    public void Cheer(int team) { Scorers = team; Celebrate = 7.5; _kickTeam = 1 - team; _re = 0; Owner = -1; BX = GoalX(team) + Dir(team) * 1.2; BY = MidY; BZ = BVX = BVY = BVZ = 0; }

    // ------------------------------------------------------------------ one step

    public void Step(double dt)
    {
        EvGoal = EvShot = EvSave = EvClose = false; MinGap = 99;
        if (dt <= 0) { Array.Clear(Went); return; }
        _drought += dt; _sinceBeatGoal += dt; _tackleCool -= dt; _hold -= dt; _burst -= dt;
        if (Celebrate > 0) CelebrateStep(dt);
        else if (_re != 0) RestartStep(dt);
        else { Play(dt); }
        Move(dt);
        if (Celebrate <= 0 && _re == 0) Ball(dt);
    }

    /// <summary>A strong beat: now and then a player close to the goal strikes at once, and that one goes in. True when it did.</summary>
    public bool BigBeat()
    {
        if (Celebrate > 0 || _re != 0 || _shot || _sinceBeatGoal < 120 || _drought < 30 || Rnd() > 0.1) return false;
        var s = -1;
        if (Owner >= 0) { if (!Keeper(Owner) && Dist(BX, BY, GoalX(Team(Owner)), MidY) < 24) s = Owner; }
        else if (BZ < 1.5)
        {
            var best = 3.0;
            for (var i = 0; i < Men; i++) { if (Keeper(i)) continue; var d = Dist(X[i], Y[i], BX, BY); if (d < best && Dist(BX, BY, GoalX(Team(i)), MidY) < 20) { best = d; s = i; } }
        }
        if (s < 0) return false;
        var team = Team(s); var kp = (1 - team) * Side;
        Shoot(s, MidY + (Y[kp] >= MidY ? -1 : 1) * (Mouth - 0.8), 38, 0.9); _destined = true; _sinceBeatGoal = 0; Tally[7]++;
        return true;
    }

    // ------------------------------------------------------------------ where each player wants to be

    private void Anchor(int i, int has, out double ax, out double ay)
    {
        int t = Team(i), k = i % Side; var u = t == 0 ? BX : L - BX;
        if (k == 0) { ax = L - GoalX(t) + Dir(t) * (2.2 + Math.Clamp(u - 30, 0, 40) * 0.18); ay = MidY + Math.Clamp((BY - MidY) * 0.3, -2.8, 2.8); return; }
        var x = BaseX[k] + (u - 52.5) * 0.5 + (has == t ? 7 : has >= 0 ? -6 : 0);
        x = k <= 2 ? Math.Clamp(x, 12, 58) : k == 3 ? Math.Clamp(x, 20, 76) : Math.Clamp(x, 34, 90);
        var y = BaseY[k] + (BY - MidY) * 0.3;
        if (has == t && k >= 4) y += BaseY[k] < MidY ? -5 : 5;
        if (has >= 0 && has != t) y = MidY + (y - MidY) * 0.8;
        ax = t == 0 ? x : L - x; ay = Math.Clamp(y, 4, W - 4);
    }

    private double NearestOpponent(int team, double x, double y, out int who, bool outfield = false)
    {
        var best = 1e9; who = -1;
        for (var j = 0; j < Men; j++) { if (Team(j) == team || (outfield && Keeper(j))) continue; var d = Dist(x, y, X[j], Y[j]); if (d < best) { best = d; who = j; } }
        return best;
    }

    private void Go(int i, double x, double y, double cap) { _tx[i] = Math.Clamp(x, 0.6, L - 0.6); _ty[i] = Math.Clamp(y, 0.6, W - 0.6); _cap[i] = cap; }

    private int Chaser(int team, double ax, double ay, bool keeperToo)
    {
        var best = -1; var bd = 1e9;
        for (var i = team * Side; i < team * Side + Side; i++)
        {
            if (i == Owner || _stun[i] > 0 || (Keeper(i) && !keeperToo)) continue;
            var d = Dist(X[i], Y[i], ax, ay); if (d < bd) { bd = d; best = i; }
        }
        var prev = _press[team];
        if (prev >= 0 && prev != Owner && _stun[prev] <= 0 && (!Keeper(prev) || keeperToo) && Dist(X[prev], Y[prev], ax, ay) < bd + 2.5) best = prev;
        return _press[team] = best;
    }

    private void Play(double dt)
    {
        var has = Has;
        if (has != _prevHas) { _prevHas = has; for (var i = 0; i < Men; i++) { _runX[i] = _runY[i] = 0; _think[i] = Rnd() * 0.8; } _cover[0] = _cover[1] = -1; }
        if (Dist(BX, BY, _stillX, _stillY) > 3) { _stillX = BX; _stillY = BY; _still = 0; } else _still += dt;
        if (_still > 7)
        {   // the play has stood still: the ball is cleared up the pitch, or given to whoever is nearest
            _still = 0; _stillX = -99;
            if (Owner >= 0) { var o = Owner; Kick(o, Math.Clamp(BX + Dir(Team(o)) * 30, 4, L - 4), 10 + Rnd() * 48, 22, -1, true); }
            else { var n = -1; var nd = 1e9; for (var i = 0; i < Men; i++) { var d = Dist(X[i], Y[i], BX, BY); if (d < nd) { nd = d; n = i; } } BVX = BVY = BVZ = 0; BZ = 0; Take(n); }
            has = Has;
        }
        var lead = Owner >= 0 ? 0.2 : 0.45; double ax = Math.Clamp(BX + BVX * lead, 0, L), ay = Math.Clamp(BY + BVY * lead, 0, W);
        for (var i = 0; i < Men; i++) { Anchor(i, has, out var hx, out var hy); Go(i, hx, hy, Keeper(i) ? 4.5 : 4.6); _taken[i] = false; }

        // ---- the side with the ball: runs off it
        if (has >= 0)
        {
            var dir = Dir(has); var support = -1; var sd = 1e9;
            for (var i = has * Side + 1; i < has * Side + Side; i++) { if (i == Owner || i == _passTo || i % Side >= 4) continue; var d = Dist(X[i], Y[i], BX, BY); if (d < sd) { sd = d; support = i; } }
            for (var i = has * Side + 1; i < has * Side + Side; i++)
            {
                if (i == Owner || i == _passTo) continue;
                if (i == support)
                {   // near the ball and behind it, on the side with more room
                    var up = NearestOpponent(has, BX - dir * 6, BY - 9, out _); var dn = NearestOpponent(has, BX - dir * 6, BY + 9, out _);
                    var sy = BY + (BY < 12 ? 9 : BY > W - 12 ? -9 : up > dn + 2 ? -9 : dn > up + 2 ? 9 : Y[i] < BY ? -9 : 9);
                    Go(i, BX - dir * 6, sy, 6.0); continue;
                }
                if (i % Side < 4) continue;
                _think[i] -= dt;
                if (_think[i] <= 0)
                {   // a forward's run: in behind, short toward the ball, or wide; the one into the most open ground, with some chance in it
                    _think[i] = 1.6 + 2.4 * Rnd(); double hx = _tx[i], hy = _ty[i], bestW = -1e9, gx = GoalX(has);
                    for (var c = 0; c < 4; c++)
                    {
                        double cx, cy;
                        if (c == 0) { cx = Math.Max(hx * dir, (BX + dir * 15) * dir) * dir; cx = dir > 0 ? Math.Min(cx, gx - 7) : Math.Max(cx, gx + 7); cy = hy + (MidY - hy) * 0.45; }
                        else if (c == 1) { cx = hx + (BX - hx) * 0.4; cy = hy + (BY - hy) * 0.4; }
                        else if (c == 2) { cx = hx + dir * 5; cy = hy < MidY ? 7 : W - 7; }
                        else { cx = hx; cy = hy; }
                        var w = Math.Min(12, NearestOpponent(has, cx, cy, out _, true)) + 0.12 * (cx - hx) * dir + 4 * Rnd();
                        if (w > bestW) { bestW = w; _runX[i] = cx - hx; _runY[i] = cy - hy; }
                    }
                }
                Go(i, _tx[i] + _runX[i], _ty[i] + _runY[i], 6.6);
            }
        }

        // ---- who goes to the ball
        if (_shot && Owner < 0)
        {   // a shot: the keeper moves to where it will cross the line, after a moment
            var def = BVX > 0 ? 1 : 0; var kp = def * Side; _shotT += dt;
            var tl = Math.Abs(BVX) > 1 ? ((def == 1 ? L : 0) - BX) / BVX : 9; var yc = BY + BVY * Math.Max(0, tl);
            if (_shotT > 0.14 + 0.3 * Due + (_destined ? 0.25 : 0) && Math.Abs(yc - MidY) < Mouth + 1.5)
            {
                Go(kp, X[kp], Math.Clamp(yc, MidY - Mouth, MidY + Mouth), 8.2);
                if (Math.Abs(yc - Y[kp]) > 1.1) Dive[kp] = Math.Sign(yc - Y[kp]) * Math.Min(1, Math.Abs(yc - Y[kp]) / 1.6);
            }
        }
        else
        {
            for (var team = 0; team < 2; team++)
            {
                if (has == team && Owner >= 0) { _press[team] = -1; continue; }
                var own = L - GoalX(team);
                if (_passTo >= 0 && Owner < 0)
                {
                    if (Team(_passTo) == team)
                    {   // the receiver comes to the ball, or to where the pass is going
                        var far = Dist(BX, BY, _pX, _pY) > 5 && BZ > 0.3;
                        Go(_passTo, far ? _pX : ax, far ? _pY : ay, 7.4); _press[team] = _passTo;
                    }
                    else
                    {   // the other side's nearest goes to the receiver, goal-side
                        var m = Chaser(team, _pX, _pY, false); if (m >= 0) { Go(m, _pX + (own - _pX) * 0.06, _pY + (MidY - _pY) * 0.06, 7.0); _taken[m] = true; }
                    }
                    continue;
                }
                var c = Chaser(team, ax, ay, Math.Abs(ax - own) < 13 && has != team);
                if (c < 0) continue;
                _taken[c] = true;
                if (Owner >= 0) { var d = Math.Max(0.1, Dist(BX, BY, own, MidY)); Go(c, BX + Math.Sign(own - BX) * 1.6, BY + (MidY - BY) / d * 0.7, Keeper(c) ? 6.5 : 7.3); }
                else Go(c, ax, ay, 7.5);
            }
            // ---- the side without the ball: one between the ball and the goal, the rest goal-side of an opponent
            if (has >= 0)
            {
                var team = 1 - has; var own = L - GoalX(team); var cv = -1; var cd = 1e9;
                for (var i = team * Side + 1; i < team * Side + Side; i++) { if (_taken[i]) continue; var d = Dist(X[i], Y[i], BX, BY); if (d < cd) { cd = d; cv = i; } }
                var pc = _cover[team]; if (pc > 0 && !_taken[pc] && Dist(X[pc], Y[pc], BX, BY) < cd + 3) cv = pc;
                _cover[team] = cv;
                if (cv >= 0) { var d = Math.Max(0.1, Dist(BX, BY, own, MidY)); var back = Math.Min(8, d * 0.5); Go(cv, BX + (own - BX) / d * back, BY + (MidY - BY) / d * back, 6.2); _taken[cv] = true; }
                for (var i = team * Side + 1; i < team * Side + Side; i++)
                {
                    if (_taken[i]) continue; var best = -1; var bd = 15.0;
                    for (var a = has * Side + 1; a < has * Side + Side; a++) { if (a == Owner || _taken[a]) continue; var d = Dist(_tx[i], _ty[i], X[a], Y[a]); if (d < bd) { bd = d; best = a; } }
                    if (best < 0) continue;
                    _taken[best] = true; var g = Math.Max(0.1, Dist(X[best], Y[best], own, MidY));
                    double mx = X[best] + Math.Sign(own - X[best]) * 3.6, my = Y[best] + (MidY - Y[best]) / g * 1.5;
                    Go(i, mx * 0.7 + _tx[i] * 0.3, my * 0.7 + _ty[i] * 0.3, 5.8);
                }
            }
        }

        // ---- the player on the ball
        if (Owner >= 0)
        {
            var i = Owner; var team = Team(i); var dir = Dir(team); var gx = GoalX(team);
            _decide -= dt;
            if (Keeper(i)) { _keeperHolds -= dt; Go(i, X[i], Y[i], 0); if (_keeperHolds <= 0) Decide(i); return; }
            var press = NearestOpponent(team, X[i], Y[i], out _);
            if (press < 4.2 && _decide > 0.3) _decide = 0.3;
            if (_decide <= 0) { Decide(i); if (Owner != i) return; }
            // on with the ball: at the goal, round whoever stands in the way, and in from the wing near the line
            NearestOpponent(team, X[i] + dir * 4, Y[i], out var b, true); var away = 0.0;
            if (b >= 0 && Dist(X[i], Y[i], X[b], Y[b]) < 8 && (X[b] - X[i]) * dir > -1)
            {
                if (b != _blocker) { _blocker = b; _swerve = Y[i] >= Y[b] ? 1 : -1; if (Y[i] > W - 8) _swerve = -1; if (Y[i] < 8) _swerve = 1; }
                away = 8 * _swerve;
            }
            else _blocker = -1;
            double ty = MidY + (Y[i] - MidY) * 0.55 + away, tx = gx;
            if (Math.Abs(X[i] - gx) < 11 && Math.Abs(Y[i] - MidY) > 9) { tx = gx - dir * 7; ty = MidY + Math.Sign(Y[i] - MidY) * 5; }
            Go(i, tx, ty, _burst > 0 ? 7.3 : 6.1);
        }
    }

    // ------------------------------------------------------------------ the choice on the ball

    private void Kick(int from, double tx, double ty, double speed, int to, bool loft)
    {
        tx = Math.Clamp(tx, -2, L + 2);
        double dx = tx - BX, dy = ty - BY, d = Math.Max(0.1, Math.Sqrt(dx * dx + dy * dy));
        BVX = dx / d * speed; BVY = dy / d * speed; BVZ = 0; BZ = 0;
        if (loft) { var t = d / speed; BVZ = Grav * t / 2; BZ = 0.05; }
        Owner = -1; _kicker = from; _hold = 0.35; _passTo = to; _pX = tx; _pY = ty; _shot = false; _destined = false; _tried = 0; _last = Team(from); _set = 0; _firstTime = false;
        if (to >= 0) Tally[4]++;
    }

    private void Shoot(int from, double aimY, double speed, double height)
    {
        var team = Team(from); var gx = GoalX(team);
        Kick(from, gx, aimY, speed, -1, false);
        var t = Math.Max(0.05, Math.Abs(gx - BX) / Math.Max(1, Math.Abs(BVX))); BVZ = (height + Grav * t * t / 2) / t; BZ = 0.05;
        _shot = true; _shotT = 0; EvShot = true; Tally[0]++;
    }

    private void Decide(int i)
    {
        var team = Team(i); var dir = Dir(team); double x = X[i], y = Y[i], gx = GoalX(team);
        var press = NearestOpponent(team, x, y, out _); var toGoal = Dist(x, y, gx, MidY); var set = _set;
        const int ShootK = Side, CarryK = Side + 1;
        var wing = Math.Abs(x - gx) < 20 && Math.Abs(y - MidY) > 13;
        for (var k = 0; k < Side; k++)
        {
            var j = team * Side + k; _worth[k] = -9; _loft[k] = false;
            if (j == i || (k == 0 && (press > 4 || Keeper(i)))) continue;
            var far = Dist(x, y, X[j], Y[j]); var v0 = Math.Min(26, 11 + 0.33 * far); var t = far / (v0 * 0.85);
            double px = X[j] + VX[j] * t * 0.8 + dir * 1.2, py = Y[j] + VY[j] * t * 0.8;
            var adv = (X[j] - x) * dir; var through = false;
            if (k >= 4 && VX[j] * dir > 3 && adv > 4 && NearestOpponent(team, px + dir * 8, py, out _, true) > 9) { px += dir * 5; through = true; }
            px = Math.Clamp(px, 2, L - 2); py = Math.Clamp(py, 2, W - 2); _ptX[k] = px; _ptY[k] = py;
            // the lane is judged short of the receiver: whoever marks them stands there, and is not in the way of the pass
            var cut = Math.Max(0.3, 1 - 3.5 / Math.Max(4, far)); double lx = BX + (px - BX) * cut, ly = BY + (py - BY) * cut;
            var head = Math.Min(0.4, 2.5 / Math.Max(4, far)); double sx0 = BX + (px - BX) * head, sy0 = BY + (py - BY) * head;   // nor is the one pressing the ball: the pass leaves past them
            var lane = 1e9; for (var o = 0; o < Men; o++) if (Team(o) != team) lane = Math.Min(lane, ToSegment(X[o], Y[o], sx0, sy0, lx, ly));
            var open = Math.Min(1, NearestOpponent(team, px, py, out _) / 9);
            var w = 0.1 + 0.02 * adv * (adv > 0 ? 1 : 0.4) + 0.5 * open + (press < 3.5 ? 0.3 : 0) - (far < 7 ? 0.4 : 0) - (far > 50 ? 0.4 : 0) + (lane > 5 ? 0.15 : 0) + (through ? 0.5 : 0);
            if (lane < 2.2) { if (far < 16) continue; _loft[k] = true; w -= 0.3; }
            if (wing && k != 0 && Math.Abs(X[j] - gx) < 18 && Math.Abs(Y[j] - MidY) < 11) { _loft[k] = true; w = Math.Max(w, 1.3); }   // a cross
            if (set == 2 && k != 0) { _loft[k] = true; w = Math.Abs(X[j] - gx) < 20 ? 1.5 - 0.05 * Math.Abs(Y[j] - MidY) : 0.2; }   // a corner goes into the box
            if (set == 4) w = k == 3 ? 3 : k <= 2 ? 0.5 : -9;                                                                          // a kick-off goes back
            _worth[k] = w;
        }
        var range = 34 + 14 * Due;
        _worth[ShootK] = toGoal < range ? (1.5 + 1.6 * Due) * (1 - toGoal / range) * (1 - 0.8 * Math.Min(1, Math.Abs(y - MidY) / (toGoal + 1))) + (_firstTime ? 1.2 : 0) + (press < 2 ? 0.2 : 0) - 0.2 : -9;
        var room = 10.0;
        for (var o = 0; o < Men; o++) if (Team(o) != team && (X[o] - x) * dir > 0 && Math.Abs(Y[o] - y) < 8) room = Math.Min(room, Dist(x, y, X[o], Y[o]));
        _worth[CarryK] = 0.85 + 0.05 * room - (press < 2.5 ? 0.6 : 0) - (toGoal < 12 ? 0.3 : 0);
        if (Keeper(i) || set != 0) { _worth[CarryK] = -9; _worth[ShootK] = -9; }
        double sum = 0; for (var k = 0; k < _worth.Length; k++) { _worth[k] = _worth[k] < -5 ? 0 : Math.Exp(_worth[k] / 0.3); sum += _worth[k]; }
        if (sum <= 0)
        {   // nothing on: a long ball up the pitch toward the furthest team-mate
            var far = -1; for (var k = 1; k < Side; k++) { var j = team * Side + k; if (j != i && (far < 0 || (X[j] - X[far]) * dir > 0)) far = j; }
            Kick(i, X[far] + dir * 4, Y[far], 22, far, true); return;
        }
        var pick = Rnd() * sum; var choice = CarryK;
        for (var k = 0; k < _worth.Length; k++) { pick -= _worth[k]; if (pick <= 0) { choice = k; break; } }
        if (choice == ShootK)
        {   // at the corner away from the keeper, and the further out and the more hurried, the wider it may go
            var kp = (1 - team) * Side; var aim = MidY + (Y[kp] >= MidY ? -1 : 1) * (Mouth - 0.9);
            var sd = (0.7 + 0.075 * toGoal + (press < 2 ? 0.8 : 0)) * (1 - 0.5 * Due);
            aim += sd * (Rnd() + Rnd() + Rnd() - 1.5) * 1.4;
            Shoot(i, aim, 30 + 5 * Rnd(), 0.2 + 1.9 * Rnd() + (Rnd() < 0.12 ? 1.2 : 0));
        }
        else if (choice < Side)
        {
            var j = team * Side + choice; var far = Dist(BX, BY, _ptX[choice], _ptY[choice]);
            if (_loft[choice]) Kick(i, _ptX[choice], _ptY[choice], Math.Clamp(far / 1.5, 14, 24), j, true);
            else Kick(i, _ptX[choice], _ptY[choice], Math.Min(26, 11 + 0.33 * far), j, false);
        }
        else _decide = 0.6 + 0.7 * Rnd();
    }

    private void Take(int i)
    {
        Owner = i; _passTo = -1; _shot = false; _destined = false; _last = Team(i); _decide = 0.7 + 0.8 * Rnd(); _keeperHolds = 0.9 + 0.5 * Rnd(); BZ = 0; BVX = BVY = BVZ = 0; _blocker = -1;
        _firstTime = !Keeper(i) && Dist(X[i], Y[i], GoalX(Team(i)), MidY) < 15 && Rnd() < 0.6; if (_firstTime) _decide = 0.06;
        var s = Math.Sqrt(VX[i] * VX[i] + VY[i] * VY[i]); if (s > 0.8) { _hx = VX[i] / s; _hy = VY[i] / s; } else { _hx = Dir(Team(i)); _hy = 0; }
    }

    // ------------------------------------------------------------------ the ball

    private void Ball(double dt)
    {
        if (Owner >= 0)
        {
            var o = Owner; var team = Team(o); var s = Math.Sqrt(VX[o] * VX[o] + VY[o] * VY[o]);
            double wx = s > 0.8 ? VX[o] / s : Dir(team), wy = s > 0.8 ? VY[o] / s : 0, k = Math.Min(1, dt * 9);
            _hx += (wx - _hx) * k; _hy += (wy - _hy) * k; var hn = Math.Max(0.2, Math.Sqrt(_hx * _hx + _hy * _hy));
            BX = Math.Clamp(X[o] + _hx / hn * 1.5, 0.2, L - 0.2); BY = Math.Clamp(Y[o] + _hy / hn * 0.7, 0.2, W - 0.2); BZ = 0; BVX = BVY = BVZ = 0;
            if (Keeper(o)) return;
            // the tackle: won, knocked loose, or beaten
            var near = NearestOpponent(team, BX, BY, out var thief);
            if (near < 3.6 && _tackleCool <= 0 && thief >= 0 && _stun[thief] <= 0 && Rnd() < 0.9 * dt * (1 - 0.6 * Due))
            {
                var r = Rnd();
                if (r < 0.5) { Tally[3]++; Take(thief); _decide = 0.6; _tackleCool = 1.2; }
                else if (r < 0.75) { var a = Rnd() * Math.PI * 2; _kicker = o; Owner = -1; _hold = 0.3; BVX = Math.Cos(a) * 6; BVY = Math.Sin(a) * 6; _last = Team(thief); _passTo = -1; _tackleCool = 0.8; }
                else { _stun[thief] = 0.8; _burst = 1.2; _tackleCool = 1.0; }
            }
            return;
        }
        double ox = BX, oy = BY;
        BX += BVX * dt; BY += BVY * dt;
        if (BZ > 0 || BVZ > 0)
        {
            BVZ -= Grav * dt; BZ += BVZ * dt;
            if (BZ <= 0) { BZ = 0; BVZ = -BVZ * 0.45; if (BVZ < 1.3) BVZ = 0; BVX *= 0.78; BVY *= 0.78; }
        }
        if (BZ <= 0.02) { var slow = Math.Exp(-0.5 * dt); BVX *= slow; BVY *= slow; }
        var speed = Math.Sqrt(BVX * BVX + BVY * BVY);

        // ---- over a goal line
        if (BX <= 0 || BX >= L)
        {
            var def = BX <= 0 ? 0 : 1; var kp = def * Side; var line = def == 0 ? 0.0 : L;
            var f = Math.Abs(BX - ox) > 1e-6 ? (line - ox) / (BX - ox) : 1; var yc = oy + (BY - oy) * f;
            if (Math.Abs(yc - MidY) < Mouth && BZ < Bar)
            {
                var reach = Math.Abs(Y[kp] - yc); var p = (reach < 0.9 ? 0.93 : reach < 1.9 ? 0.7 : reach < 2.8 ? 0.25 : 0.03) * (1 - 0.75 * Due);
                if (!_destined && Rnd() < p)
                {
                    EvSave = true; Tally[1]++;
                    if (speed < 18 || Rnd() < 0.5) { BX = line + (def == 0 ? 0.6 : -0.6); BY = yc; Take(kp); }
                    else if (Rnd() < 0.4) { Tally[8]++; StartRestart(2, 1 - def, line + (def == 0 ? 0.4 : -0.4), yc < MidY ? 0.4 : W - 0.4); }   // pushed round the post: a corner
                    else
                    {   // pushed away: back into play, loose
                        BX = line + (def == 0 ? 0.8 : -0.8); BY = yc; BVX = (def == 0 ? 1 : -1) * (6 + 6 * Rnd()); BVY = (Rnd() - 0.5) * 16; BVZ = 3 + 3 * Rnd(); BZ = 0.3;
                        _shot = false; _passTo = -1; _kicker = kp; _hold = 0.5; _last = def;
                    }
                }
                else
                {
                    EvGoal = true; Tally[6]++; _drought = 0; Scorers = 1 - def; _kickTeam = def; Celebrate = 7.5; Owner = -1; _shot = false; _passTo = -1;
                    BX = line + (def == 0 ? -1.2 : 1.2); BY = yc; BZ = 0; BVX = BVY = BVZ = 0;
                }
            }
            else
            {
                if (_shot) { Tally[2]++; EvClose = Math.Abs(yc - MidY) < Mouth + 3; }
                if (_last == def) { Tally[8]++; StartRestart(2, 1 - def, line + (def == 0 ? 0.4 : -0.4), yc < MidY ? 0.4 : W - 0.4); }
                else StartRestart(3, def, line + (def == 0 ? 5.5 : -5.5), MidY + (yc < MidY ? -4 : 4));
            }
            return;
        }
        // ---- over a touchline
        if (BY < 0 || BY > W) { Tally[9]++; StartRestart(1, _last < 0 ? _r.Next(2) : 1 - _last, Math.Clamp(BX, 2, L - 2), BY < 0 ? 0.4 : W - 0.4); return; }

        // ---- who gets to it
        for (var i = 0; i < Men && Owner < 0; i++)
        {
            if (i == _kicker && _hold > 0) continue;
            if (_stun[i] > 0 || BZ > (Keeper(i) ? 2.5 : 1.9)) continue;
            var d = Dist(X[i], Y[i], BX, BY); var bit = 1 << i;
            if (_shot && speed > 10)
            {
                if (Keeper(i)) { if (d < 1.2 && Team(i) != _last && !_destined) { EvSave = true; Tally[1]++; Take(i); } continue; }
                if (_destined || d > 0.9 || Team(i) == _last || (_tried & bit) != 0) continue;
                _tried |= bit;
                if (Rnd() < 0.4) { var a = Rnd() * Math.PI * 2; BVX = -BVX * 0.25 + Math.Cos(a) * 4; BVY = BVY * 0.3 + Math.Sin(a) * 4; BVZ = 2 + 3 * Rnd(); _shot = false; _last = Team(i); _kicker = i; _hold = 0.3; }
                continue;
            }
            if (_passTo >= 0 && Team(i) != Team(_passTo))
            {   // a pass is cut out by a player who is at it
                if (d > 1.3 || (_tried & bit) != 0) continue;
                _tried |= bit; if (Rnd() < (speed < 14 ? 0.9 : 0.4)) { Tally[5]++; Take(i); }
                continue;
            }
            if (d < 1.5 && (speed < 22 || (_tried & bit) == 0)) { _tried |= bit; if (speed < 22 || Rnd() < 0.8) Take(i); }
        }
    }

    // ------------------------------------------------------------------ restarts and the cheer

    private void StartRestart(int kind, int team, double x, double y)
    {
        _re = kind; _reTeam = team; _reX = x; _reY = y; _reT = 0; Owner = -1; _passTo = -1; _shot = false; _destined = false; _kicker = -1;
        BX = x; BY = y; BZ = BVX = BVY = BVZ = 0; _press[0] = _press[1] = -1; _still = 0; _stillX = -99;
        var best = -1; var bd = 1e9;
        if (kind == 3) best = team * Side;
        else if (kind == 4) best = team * Side + 4;
        else for (var i = team * Side + 1; i < team * Side + Side; i++) { if (kind == 2 && i % Side < 3) continue; var d = Dist(X[i], Y[i], x, y); if (d < bd) { bd = d; best = i; } }
        _reTaker = best;
    }

    private void RestartStep(double dt)
    {
        _reT += dt; BX = _reX; BY = _reY; BZ = BVX = BVY = BVZ = 0; var t = _reTaker; var team = _reTeam; var dir = Dir(team); var gx = GoalX(team);
        var box = 0;
        for (var i = 0; i < Men; i++)
        {
            Anchor(i, team, out var hx, out var hy); var cap = 5.2;
            if (_re == 4) { if (Team(i) == 0) hx = Math.Min(hx, L / 2 - 2); else hx = Math.Max(hx, L / 2 + 2); if (Team(i) != team && Dist(hx, hy, L / 2, MidY) < 9.5) hx = L / 2 - Dir(Team(i)) * 10; }
            if (_re == 2 && !Keeper(i) && i != t)
            {   // a corner: the side taking it goes into the box, the other side with them
                if (Team(i) == team && i % Side >= 3) { hx = gx - dir * (7 + 3 * (box % 2)); hy = MidY + (box - 1) * 4.5; box++; cap = 6; }
                else if (Team(i) != team) { var k = i % Side; hx = gx - dir * (4 + 2.5 * (k % 3)); hy = MidY + (k - 3) * 3.2; cap = 6; }
            }
            if (Team(i) != team && Dist(hx, hy, _reX, _reY) < 7 && _re != 2) { var d = Math.Max(0.1, Dist(hx, hy, _reX, _reY)); hx = _reX + (hx - _reX) / d * 7; hy = _reY + (hy - _reY) / d * 7; }
            Go(i, hx, hy, cap);
        }
        Go(t, _reX - (_re == 4 ? 0 : dir * 0.2), _reY, 6.6);
        var there = Dist(X[t], Y[t], _tx[t], _ty[t]) < 1.1;
        if ((there && _reT > (_re == 4 ? 1.6 : 1.1)) || _reT > 6)
        {
            if (!there) { BX = X[t]; BY = Y[t]; }
            var kind = _re; _re = 0; Take(t); _set = kind; _firstTime = false; _decide = 0.25; _keeperHolds = 0.3; _tackleCool = 1.5; _last = team; _prevHas = -2;
        }
    }

    private void CelebrateStep(double dt)
    {
        Celebrate -= dt; var dir = Dir(Scorers); double px = GoalX(Scorers) - dir * 14, py = W - 8;
        if (Celebrate < 3.4) { BX = L / 2; BY = MidY; BZ = 0; }
        for (var i = 0; i < Men; i++)
        {
            var party = Team(i) == Scorers && Celebrate > 3.4;
            if (party && !Keeper(i)) { Go(i, px, py, 6.6); Hop[i] = Dist(X[i], Y[i], px, py) < 8 ? Math.Abs(Math.Sin(Celebrate * 8 + i * 1.3)) : 0; }
            else if (party) { Go(i, X[i], Y[i], 0); Hop[i] = Math.Abs(Math.Sin(Celebrate * 8)); }
            else
            {
                Hop[i] = 0; var k = i % Side; var hx = Team(i) == 0 ? Math.Min(BaseX[k], L / 2 - 3) : L - Math.Min(BaseX[k], L / 2 - 3);
                Go(i, hx, BaseY[k], Celebrate > 3.4 ? 3.2 : 5.5);
            }
        }
        if (Celebrate <= 0) { Celebrate = 0; for (var i = 0; i < Men; i++) Hop[i] = 0; StartRestart(4, _kickTeam, L / 2, MidY); }
    }

    // ------------------------------------------------------------------ how the players move

    private void Move(double dt)
    {
        var carrier = Celebrate <= 0 && _re == 0 ? Owner : -1;
        for (var i = 0; i < Men; i++)
        {
            double dx = _tx[i] - X[i], dy = _ty[i] - Y[i], d = Math.Sqrt(dx * dx + dy * dy); var cap = _cap[i];
            if (_stun[i] > 0) { _stun[i] -= dt; cap = Math.Min(cap, 1.5); }
            var ws = d < 0.12 ? 0 : Math.Min(cap, d * 3); double wx = d > 1e-6 ? dx / d * ws : 0, wy = d > 1e-6 ? dy / d * ws : 0;
            // nobody inside another: a push apart, wider between team-mates, and wider along the pitch than across it
            for (var j = 0; j < Men; j++)
            {
                if (j == i) continue;
                double ex = X[i] - X[j], ey = (Y[i] - Y[j]) * Squash, m = Math.Sqrt(ex * ex + ey * ey);
                var r = i == carrier || j == carrier ? 2.6 : Team(i) == Team(j) ? (Celebrate > 0 ? 3.0 : 4.6) : 3.1;
                if (_shot && (Keeper(i) || Keeper(j))) r = Floor;
                if (m >= r) continue;
                if (m < 1e-3) { ex = (i < j ? 1 : -1); ey = 0; m = 1; }
                var push = (r - m) / r * 6.5; wx += ex / m * push; wy += ey / m * push * Squash;
            }
            var wn = Math.Sqrt(wx * wx + wy * wy); if (wn > cap + 2.5 && wn > 0) { wx *= (cap + 2.5) / wn; wy *= (cap + 2.5) / wn; }
            double ax = wx - VX[i], ay = wy - VY[i], an = Math.Sqrt(ax * ax + ay * ay), amax = (Keeper(i) && _shot ? 34 : 15) * dt;
            if (an > amax) { ax *= amax / an; ay *= amax / an; }
            VX[i] += ax; VY[i] += ay;
        }
        for (var i = 0; i < Men; i++)
        {
            X[i] = Math.Clamp(X[i] + VX[i] * dt, 0.5, L - 0.5); Y[i] = Math.Clamp(Y[i] + VY[i] * dt, 0.5, W - 0.5);
            var go = Math.Sqrt(VX[i] * VX[i] + VY[i] * VY[i]) * dt; Went[i] = go; Stride[i] += go * 1.5;
            if (!(_shot && Keeper(i))) Dive[i] *= Math.Exp(-dt * 2.2); if (Math.Abs(Dive[i]) < 0.02) Dive[i] = 0;
        }
        // the floor under the push: no two players inside one box of the drawn size, moved apart the shorter way (twice over, so a
        // player moved off one neighbour and onto another is moved again)
        for (var pass = 0; pass < 2; pass++)
            for (var i = 0; i < Men; i++)
                for (var j = i + 1; j < Men; j++)
                {
                    double ex = X[i] - X[j], ey = Y[i] - Y[j], nx = Floor - Math.Abs(ex), ny = Floor / Squash - Math.Abs(ey);
                    if (nx > 0 && ny > 0)
                    {
                        if (nx <= ny || Y[i] < 2 || Y[j] < 2 || Y[i] > W - 2 || Y[j] > W - 2) { var h = nx / 2 * (ex >= 0 ? 1 : -1); X[i] = Math.Clamp(X[i] + h, 0.5, L - 0.5); X[j] = Math.Clamp(X[j] - h, 0.5, L - 0.5); }
                        else { var h = ny / 2 * (ey >= 0 ? 1 : -1); Y[i] = Math.Clamp(Y[i] + h, 0.5, W - 0.5); Y[j] = Math.Clamp(Y[j] - h, 0.5, W - 0.5); }
                    }
                    if (pass == 1) { var m = Math.Max(Math.Abs(X[i] - X[j]), Math.Abs(Y[i] - Y[j]) * Squash); if (m < MinGap) MinGap = m; }
                }
    }
}
