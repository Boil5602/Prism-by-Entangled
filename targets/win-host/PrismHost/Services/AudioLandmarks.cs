// Audio landmarks (2026-11-08, the break-watch redesign's E3): fingerprint.py's scheme, line for line, so a pack's library of landmarks reads the
// same in the app, the extension (audio-landmarks.js) and the trainer. 16 kHz mono; frames of 1024 every 512 with a Hann window; |FFT|^2 in dB;
// a peak is a bin that is the maximum over +-7 frames and +-9 bins, 10 dB above its frame's median and above -70 dB, at most the loudest 6 a
// frame, in bins 4 to 300; a landmark pairs a peak with the next 8 peaks 1 to 48 frames on within +-48 bins: hash = f1 << 20 | f2 << 10 | dt,
// kept with the anchor's frame. Nothing about the sound leaves the device.
using System;
using System.Collections.Generic;

namespace PrismHost.Services;

internal static class AudioLandmarks
{
    public const int SampleRate = 16000, N = 1024, Hop = 512;
    public const double DbFloor = -70, MinAboveMedian = 10; public const int MaxPerFrame = 6, BinLo = 4, BinHi = 300, TRad = 7, FRad = 9, Fan = 8, DtMin = 1, DtMax = 48, DfMax = 48;
    private static readonly double[] s_hann = Hann();
    private static double[] Hann() { var w = new double[N]; for (var i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (N - 1)); return w; }   // numpy.hanning: symmetric

    /// <summary>The spectrogram in dB: [frame][bin], bins 0..512.</summary>
    public static float[][] Spectrogram(float[] x)
    {
        if (x.Length < N) return Array.Empty<float[]>();
        var frames = (x.Length - N) / Hop + 1; var S = new float[frames][];
        var re = new double[N]; var im = new double[N];
        for (var f = 0; f < frames; f++)
        {
            for (var i = 0; i < N; i++) { re[i] = x[f * Hop + i] * s_hann[i]; im[i] = 0; }
            Fft(re, im);
            var row = new float[N / 2 + 1];
            for (var k = 0; k <= N / 2; k++) { var p = re[k] * re[k] + im[k] * im[k]; row[k] = (float)(10 * Math.Log10(Math.Max(p, 1e-10))); }
            S[f] = row;
        }
        return S;
    }

    private static void Fft(double[] re, double[] im)
    {
        var n = re.Length;
        for (int i = 1, j = 0; i < n; i++)
        {
            var bit = n >> 1; for (; (j & bit) != 0; bit >>= 1) j ^= bit; j ^= bit;
            if (i < j) { (re[i], re[j]) = (re[j], re[i]); (im[i], im[j]) = (im[j], im[i]); }
        }
        for (var len = 2; len <= n; len <<= 1)
        {
            var ang = -2 * Math.PI / len; var wr = Math.Cos(ang); var wi = Math.Sin(ang);
            for (var i = 0; i < n; i += len)
            {
                double cr = 1, ci = 0;
                for (var k = 0; k < len / 2; k++)
                {
                    var ur = re[i + k]; var ui = im[i + k];
                    var vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci; var vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
                    re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
                    var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
                }
            }
        }
    }

    /// <summary>(frame, bin) of the peaks, in frame order then bin order, as the prototype lists them.</summary>
    public static List<(int T, int F)> Peaks(float[][] S)
    {
        var out_ = new List<(int, int)>(); var T = S.Length; if (T == 0) return out_;
        var W = BinHi - BinLo;
        // the maximum over +-TRad frames (per bin), then over +-FRad bins
        var mt = new float[T][];
        for (var t = 0; t < T; t++)
        {
            mt[t] = new float[W];
            for (var b = 0; b < W; b++) { var m = float.NegativeInfinity; for (var d = -TRad; d <= TRad; d++) { var tt = t + d; if (tt >= 0 && tt < T && S[tt][b + BinLo] > m) m = S[tt][b + BinLo]; } mt[t][b] = m; }
        }
        var med = new float[W];
        for (var t = 0; t < T; t++)
        {
            Array.Copy(S[t], BinLo, med, 0, W); Array.Sort(med); var median = W % 2 == 1 ? med[W / 2] : (med[W / 2 - 1] + med[W / 2]) / 2;
            var cands = new List<(int B, float V)>();
            for (var b = 0; b < W; b++)
            {
                var v = S[t][b + BinLo]; if (!(v > median + MinAboveMedian) || !(v > DbFloor)) continue;
                var m = float.NegativeInfinity; for (var d = -FRad; d <= FRad; d++) { var bb = b + d; if (bb >= 0 && bb < W && mt[t][bb] > m) m = mt[t][bb]; }
                if (v >= m) cands.Add((b, v));
            }
            if (cands.Count > MaxPerFrame) { cands.Sort((a, b2) => b2.V.CompareTo(a.V)); cands = cands.GetRange(0, MaxPerFrame); }
            cands.Sort((a, b2) => a.B.CompareTo(b2.B));
            foreach (var c in cands) out_.Add((t, c.B + BinLo));
        }
        return out_;
    }

    /// <summary>(hash, anchor frame) from the peaks.</summary>
    public static List<(uint Hash, int T)> Landmarks(List<(int T, int F)> pk)
    {
        var out_ = new List<(uint, int)>();
        for (var i = 0; i < pk.Count; i++)
        {
            var (t1, f1) = pk[i]; var n = 0;
            for (var j = i + 1; j < pk.Count; j++)
            {
                var (t2, f2) = pk[j]; var dt = t2 - t1;
                if (dt < DtMin) continue;
                if (dt > DtMax) break;
                if (Math.Abs(f2 - f1) > DfMax) continue;
                out_.Add((((uint)f1 << 20) | ((uint)f2 << 10) | (uint)dt, t1)); if (++n >= Fan) break;
            }
        }
        return out_;
    }

    public static List<(uint Hash, int T)> Of(float[] pcm16k) => Landmarks(Peaks(Spectrogram(pcm16k)));

    /// <summary>An in-memory index of tracks' landmarks; a query's hashes vote for (track, offset), pooled over +-1 frame.</summary>
    public sealed class Index
    {
        private readonly Dictionary<uint, List<(int Track, int T)>> _table = new(); public readonly List<string> Tracks = new();
        public void Add(string name, List<(uint Hash, int T)> lm)
        {
            var id = Tracks.Count; Tracks.Add(name);
            foreach (var (h, t) in lm) { if (!_table.TryGetValue(h, out var l)) _table[h] = l = new(); l.Add((id, t)); }
        }
        public List<(string Track, int Offset, int Votes)> Query(List<(uint Hash, int T)> lm, int minVotes = 12)
        {
            var votes = new Dictionary<(int, int), int>();
            foreach (var (h, tq) in lm) if (_table.TryGetValue(h, out var l)) foreach (var (tr, tl) in l) { var k = (tr, tl - tq); votes[k] = votes.TryGetValue(k, out var v) ? v + 1 : 1; }
            var pooled = new Dictionary<(int, int), int>();
            foreach (var ((tr, off), v) in votes) for (var d = -1; d <= 1; d++) { var k = (tr, off + d); pooled[k] = pooled.TryGetValue(k, out var pv) ? pv + v : v; }
            var best = new List<(string, int, int)>();
            foreach (var ((tr, off), v) in pooled) if (v >= minVotes) best.Add((Tracks[tr], off, v));
            best.Sort((a, b) => b.Item3.CompareTo(a.Item3));
            return best;
        }
    }
}
