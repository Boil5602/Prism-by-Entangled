// The stadium's game run with nothing drawn (2026-11-17): hours of play in seconds, to see that it is a game.
//   dotnet run --project scripts/viz/stadium-sim -c Release -- [minutes=120] [seed=11] [beats]
// Prints goals a minute, how the ball is shared, how near players come to each other, and how long the ball stands still.
using PrismHost.Visualizations;

var minutes = args.Length > 0 ? double.Parse(args[0]) : 120; var seed = args.Length > 1 ? int.Parse(args[1]) : 11; var beats = args.Length > 2;
var s = new StadiumSim(new Random(seed)); const double dt = 1 / 60.0; var steps = (int)(minutes * 60 / dt);
double minGap = 99, near = 0, pairs = 0, spread = 0, stillMax = 0, still = 0, lx = 0, ly = 0, inPlay = 0, air = 0, owned = 0, speedSum = 0, beatT = 0;
var gaps = new List<double>(); double lastGoal = 0; var poss = new double[2]; var third = new double[3]; var goals = new int[2]; var maxSpeed = 0.0; var bad = 0;
for (var n = 0; n < steps; n++)
{
    s.Step(dt); var t = n * dt;
    if (beats) { beatT += dt; if (beatT >= 0.5) { beatT = 0; s.BigBeat(); } }
    if (s.EvGoal) { gaps.Add(t - lastGoal); lastGoal = t; goals[s.Scorers]++; }
    if (s.MinGap < minGap) minGap = s.MinGap;
    if (s.Celebrate <= 0)
    {
        inPlay += dt; if (s.BZ > 0.3) air += dt; if (s.Owner >= 0) { owned += dt; poss[StadiumSim.Team(s.Owner)] += dt; }
        third[s.BX < 35 ? 0 : s.BX < 70 ? 1 : 2] += dt;
        for (var i = 0; i < StadiumSim.Men; i++)
            for (var j = i + 1; j < StadiumSim.Men; j++) { pairs++; var d = Math.Sqrt(Math.Pow(s.X[i] - s.X[j], 2) + Math.Pow(s.Y[i] - s.Y[j], 2)); if (Math.Abs(s.X[i] - s.X[j]) < 2.2 && Math.Abs(s.Y[i] - s.Y[j]) < 11) near++; }
        double mx = 0, my = 0; for (var i = 0; i < StadiumSim.Men; i++) { mx += s.X[i]; my += s.Y[i]; var v = Math.Sqrt(s.VX[i] * s.VX[i] + s.VY[i] * s.VY[i]); speedSum += v; if (v > maxSpeed) maxSpeed = v; }
        mx /= StadiumSim.Men; my /= StadiumSim.Men; double sp = 0; for (var i = 0; i < StadiumSim.Men; i++) sp += Math.Sqrt(Math.Pow(s.X[i] - mx, 2) + Math.Pow(s.Y[i] - my, 2)); spread += sp / StadiumSim.Men * dt;
        if (Math.Abs(s.BX - lx) + Math.Abs(s.BY - ly) < 1e-4) { still += dt; if (still > stillMax) stillMax = still; } else still = 0;
        lx = s.BX; ly = s.BY;
    }
    for (var i = 0; i < StadiumSim.Men; i++) if (double.IsNaN(s.X[i]) || double.IsNaN(s.Y[i])) bad++;
    if (double.IsNaN(s.BX) || double.IsNaN(s.BY) || double.IsNaN(s.BZ)) bad++;
}
gaps.Sort(); var T = s.Tally;
Console.WriteLine($"{minutes:0} min, seed {seed}{(beats ? ", a beat each half second" : "")}");
Console.WriteLine($"goals {T[6]} ({goals[0]} and {goals[1]}), one in {(gaps.Count > 0 ? minutes * 60 / gaps.Count : 0):0} s; between goals median {(gaps.Count > 0 ? gaps[gaps.Count / 2] : 0):0} s, shortest {(gaps.Count > 0 ? gaps[0] : 0):0}, longest {(gaps.Count > 0 ? gaps[^1] : 0):0}; on a beat {T[7]}");
Console.WriteLine($"shots {T[0]}, saved {T[1]}, off target {T[2]}; passes {T[4]}, cut out {T[5]} ({100.0 * T[5] / Math.Max(1, T[4]):0}%); tackles won {T[3]}; corners {T[8]}, throws {T[9]}");
Console.WriteLine($"the ball: with a player {100 * owned / inPlay:0}% (side one {100 * poss[0] / Math.Max(1e-9, owned):0}%), in the air {100 * air / inPlay:0}%; thirds {100 * third[0] / inPlay:0} / {100 * third[1] / inPlay:0} / {100 * third[2] / inPlay:0}%; longest stand {stillMax:0.0} s");
Console.WriteLine($"players: nearest two ever {minGap:0.00} (the push's measure), pairs drawn over each other (under 2.2 m along the pitch and 11 m across) {100 * near / Math.Max(1, pairs):0.000}% of pair time, mean distance from the middle of all twelve {spread / inPlay:0.0} m, mean speed {speedSum / (inPlay / dt) / StadiumSim.Men:0.0} m/s, top {maxSpeed:0.0}; bad numbers {bad}");
