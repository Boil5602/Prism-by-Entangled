using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Numerics;

namespace PrismHost.Services;

/// <summary>
/// The ads Prism has seen (2026-10-06, "fingerprints sound fine. Let's optimize"): commercials repeat - the same spots ran on FX, AMC,
/// BBC America and FOX 8 within the hour - so each picture of a break the watch is sure of is kept as a fingerprint, and a window
/// showing a picture it has seen in a break before is showing an ad. A fingerprint is the frame's shape at a glance: a 16 x 17 grid of
/// the 320 x 180 grey frame's averages, 496 bits for which way the brightness steps between neighbours. Matched on today's labelled
/// recordings (5,650 frames, 27 breaks): within 60 bits, a repeated ad was seen in 10 of 27 breaks, and no show frame ever matched twice
/// in eight seconds. Kept on this PC in the data folder (breakwatch\prints.bin); never sent anywhere.
/// </summary>
internal sealed class AdPrints
{
    public const int Words = 8;   // 496 bits in eight 64-bit words
    public const int MatchBits = 60;
    private const int Max = 30000;
    // each picture with the break it was taught from (Clip; 0 for a picture kept before clips) and its place in that break in seconds (Offset):
    // an ad plays its pictures in order, so a run of them in order is told from one look-alike frame (2026-10-07, "lets proceed with #1")
    private readonly List<(ulong[] Bits, long SeenAt, int Count, int Clip, float Offset)> _prints = new();
    private int _lastClip;
    private readonly string _path;
    private bool _dirty;

    public AdPrints(string path) { _path = path; Load(); }
    public int Count => _prints.Count;

    /// <summary>The frame's fingerprint, or null for a flat frame (black, a plain card) that would match too much.</summary>
    public static ulong[]? Of(byte[] g, int w, int h)
    {
        double sum = 0, sq = 0;
        foreach (var v in g) { sum += v; sq += v * v; }
        var mean = sum / g.Length; var sd = Math.Sqrt(Math.Max(0, sq / g.Length - mean * mean));
        if (sd < 20) return null;
        const int gh = 16, gw = 17;
        var cell = new double[gh, gw];
        for (var i = 0; i < gh; i++)
        {
            int y0 = i * h / gh, y1 = (i + 1) * h / gh;
            for (var j = 0; j < gw; j++)
            {
                int x0 = j * w / gw, x1 = (j + 1) * w / gw; double s = 0;
                for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) s += g[y * w + x];
                cell[i, j] = s / ((y1 - y0) * (x1 - x0));
            }
        }
        var bits = new ulong[Words]; var k = 0;
        void Put(bool b) { if (b) bits[k >> 6] |= 1UL << (k & 63); k++; }
        for (var i = 0; i < gh; i++) for (var j = 0; j < gw - 1; j++) Put(cell[i, j + 1] > cell[i, j]);
        for (var i = 0; i < gh - 1; i++) for (var j = 0; j < gw - 1; j++) Put(cell[i + 1, j] > cell[i, j]);
        return bits;
    }

    public static int Distance(ulong[] a, ulong[] b)
    {
        var d = 0; for (var i = 0; i < Words; i++) d += BitOperations.PopCount(a[i] ^ b[i]); return d;
    }

    /// <summary>Whether this picture was seen in a break before.</summary>
    public bool Seen(ulong[] fp)
    {
        foreach (var p in _prints) if (Distance(p.Bits, fp) <= MatchBits) return true;
        return false;
    }

    /// <summary>The pictures within `within` bits that know their place in a break: the nearest per break (its clip, its offset).</summary>
    public List<(int Clip, float Offset, int Dist)> Places(ulong[] fp, int within)
    {
        var best = new Dictionary<int, (float Offset, int Dist)>();
        foreach (var p in _prints)
        {
            if (p.Clip == 0) continue;
            var d = Distance(p.Bits, fp);
            if (d > within) continue;
            if (!best.TryGetValue(p.Clip, out var b) || d < b.Dist) best[p.Clip] = (p.Offset, d);
        }
        return best.Select(x => (x.Key, x.Value.Offset, x.Value.Dist)).ToList();
    }

    /// <summary>A new break to teach: its clip number.</summary>
    public int NextClip() { _lastClip++; _dirty = true; return _lastClip; }

    /// <summary>A picture of a break the watch is sure of: kept (or its twin counted again). With a clip, its place in that break is kept too;
    /// a twin kept before clips takes the place it is given now.</summary>
    public void Learn(ulong[] fp, int clip = 0, float offset = 0)
    {
        for (var i = 0; i < _prints.Count; i++)
            if (Distance(_prints[i].Bits, fp) <= MatchBits / 2)
            {
                var p = _prints[i];
                var (c, o) = p.Clip == 0 && clip != 0 ? (clip, offset) : (p.Clip, p.Offset);
                _prints[i] = (p.Bits, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), p.Count + 1, c, o);
                _dirty = true; return;
            }
        _prints.Add((fp, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), 1, clip, offset));
        if (_prints.Count > Max) { _prints.Sort((x, y) => x.SeenAt.CompareTo(y.SeenAt)); _prints.RemoveRange(0, _prints.Count - Max); }
        _dirty = true;
    }

    public void Save()
    {
        if (!_dirty) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            using var w = new BinaryWriter(File.Create(_path));
            w.Write(2); w.Write(_prints.Count); w.Write(_lastClip);
            foreach (var p in _prints) { foreach (var x in p.Bits) w.Write(x); w.Write(p.SeenAt); w.Write(p.Count); w.Write(p.Clip); w.Write(p.Offset); }
            _dirty = false;
        }
        catch { }
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_path)) return;
            using var r = new BinaryReader(File.OpenRead(_path));
            var ver = r.ReadInt32();
            if (ver != 1 && ver != 2) return;
            var n = r.ReadInt32();
            if (ver == 2) _lastClip = r.ReadInt32();
            for (var i = 0; i < n; i++)
            {
                var b = new ulong[Words]; for (var k = 0; k < Words; k++) b[k] = r.ReadUInt64();
                var seen = r.ReadInt64(); var count = r.ReadInt32();
                var (clip, off) = ver == 2 ? (r.ReadInt32(), r.ReadSingle()) : (0, 0f);   // a file from before clips: no places
                _prints.Add((b, seen, count, clip, off));
            }
        }
        catch { _prints.Clear(); }
    }
}

/// <summary>
/// Runs of an ad's pictures in order (2026-10-07): each window's looks that matched a known break's pictures (loosely, by place), and
/// whether the last few line up - the same break, its places moving on as the clock does. Three in order within ten seconds is a run: an
/// ad playing, where one look-alike frame of a show is not.
/// </summary>
internal sealed class PrintRuns
{
    public const int Loose = 80;   // a looser match than a single frame's (60): the run's order is the proof
    public const int Need = 3;
    private readonly List<(double T, int Clip, float Offset)> _hits = new();

    /// <summary>This look's places (AdPrints.Places at Loose) at time t: true when they complete a run.</summary>
    public bool Look(double t, List<(int Clip, float Offset, int Dist)> places)
    {
        _hits.RemoveAll(h => t - h.T > 10);
        var run = false;
        foreach (var (clip, off, _) in places)
        {
            var inOrder = 1;
            var times = new HashSet<double> { t };
            foreach (var h in _hits)
                if (h.Clip == clip && Math.Abs((off - h.Offset) - (t - h.T)) <= 2.5 && times.Add(h.T)) inOrder++;
            if (inOrder >= Need) run = true;
            _hits.Add((t, clip, off));
        }
        return run;
    }
}
