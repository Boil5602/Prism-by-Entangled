using System;
using System.Collections.Generic;
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
    private readonly List<(ulong[] Bits, long SeenAt, int Count)> _prints = new();
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

    /// <summary>A picture of a break the watch is sure of: kept (or its twin counted again).</summary>
    public void Learn(ulong[] fp)
    {
        for (var i = 0; i < _prints.Count; i++)
            if (Distance(_prints[i].Bits, fp) <= MatchBits / 2) { var p = _prints[i]; _prints[i] = (p.Bits, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), p.Count + 1); _dirty = true; return; }
        _prints.Add((fp, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), 1));
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
            w.Write(1); w.Write(_prints.Count);
            foreach (var p in _prints) { foreach (var x in p.Bits) w.Write(x); w.Write(p.SeenAt); w.Write(p.Count); }
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
            if (r.ReadInt32() != 1) return;
            var n = r.ReadInt32();
            for (var i = 0; i < n; i++)
            {
                var b = new ulong[Words]; for (var k = 0; k < Words; k++) b[k] = r.ReadUInt64();
                _prints.Add((b, r.ReadInt64(), r.ReadInt32()));
            }
        }
        catch { _prints.Clear(); }
    }
}
