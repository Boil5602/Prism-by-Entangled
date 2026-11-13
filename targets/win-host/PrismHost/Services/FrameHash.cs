// Repetition as a reading (2026-11-08, the break-watch redesign's E1). FrameHash is phash.py's hash, line for line: the 320x180 grey frame
// averaged to 18x32 blocks of 10x10, a 2-D DCT, the 8x8 lowest frequencies less the DC term, each bit = coefficient above the median of
// the 63. RepLibrary holds a sorted list of such hashes (a pack's library of frames that recur across days, or this PC's own) with four
// 16-bit band indexes, and answers whether any hash within N bits of a query exists. RepFeatures keeps a window's last 15 s of answers
// and gives the two readings the trees take: rep_near (a near frame exists) and rep_count15 (how many of the last 15 s had one).
// A missing library gives zeros, which is what a model naming the readings sees on a host without one.
using System;
using System.Collections.Generic;
using System.IO;

namespace PrismHost.Services;

internal static class FrameHash
{
    private static readonly double[] D18 = Dct(18), D32 = Dct(32);

    private static double[] Dct(int n)
    {
        var m = new double[n * n]; var s = Math.Sqrt(2.0 / n);
        for (var k = 0; k < n; k++) for (var x = 0; x < n; x++) m[k * n + x] = Math.Cos(Math.PI * (2 * x + 1) * k / (2.0 * n)) * s * (k == 0 ? 1 / Math.Sqrt(2) : 1);
        return m;
    }

    /// <summary>The hash of a 320x180 grey frame; 0 for a frame of the wrong size.</summary>
    public static ulong Of(byte[] g)
    {
        if (g.Length != 320 * 180) return 0;
        // 18 x 32 blocks of 10 x 10 (phash.py: reshape(18, 10, 32, 10).mean), in float32 as numpy keeps them
        var a = new float[18 * 32];
        for (var by = 0; by < 18; by++)
            for (var bx = 0; bx < 32; bx++)
            {
                var sum = 0; for (var y = 0; y < 10; y++) { var row = (by * 10 + y) * 320 + bx * 10; for (var x = 0; x < 10; x++) sum += g[row + x]; }
                a[by * 32 + bx] = sum / 100f;
            }
        // c = D18 @ a @ D32^T, the 8 x 8 corner only
        var tmp = new double[18 * 8];   // a @ D32^T for the 8 lowest column frequencies
        for (var r = 0; r < 18; r++) for (var k = 0; k < 8; k++) { double s = 0; for (var x = 0; x < 32; x++) s += a[r * 32 + x] * D32[k * 32 + x]; tmp[r * 8 + k] = s; }
        var low = new double[63]; var n = 0;
        for (var k = 0; k < 8; k++)
            for (var kk = 0; kk < 8; kk++)
            {
                if (k == 0 && kk == 0) continue;
                double s = 0; for (var r = 0; r < 18; r++) s += D18[k * 18 + r] * tmp[r * 8 + kk];
                low[n++] = s;
            }
        var sorted = (double[])low.Clone(); Array.Sort(sorted); var median = sorted[31];   // numpy's median of 63 values: the 32nd in order
        ulong h = 0; for (var i = 0; i < 63; i++) if (low[i] > median) h |= 1UL << i;
        return h;
    }

    public static int Bits(ulong x) => System.Numerics.BitOperations.PopCount(x);
}

internal sealed class RepLibrary
{
    private readonly ulong[] _hashes;                 // sorted
    private readonly int[][] _bandOrder = new int[4][];   // for each 16-bit band, the hash indexes sorted by that band's value
    private readonly ushort[][] _bandKey = new ushort[4][];
    public int Count => _hashes.Length;
    public const int MaxBucket = 4000;

    private RepLibrary(ulong[] hashes)
    {
        Array.Sort(hashes); _hashes = hashes;
        for (var b = 0; b < 4; b++)
        {
            var keys = new ushort[hashes.Length]; var order = new int[hashes.Length];
            for (var i = 0; i < hashes.Length; i++) { keys[i] = (ushort)((hashes[i] >> (16 * b)) & 0xFFFF); order[i] = i; }
            Array.Sort((ushort[])keys.Clone(), order);
            var sortedKeys = new ushort[hashes.Length]; for (var i = 0; i < order.Length; i++) sortedKeys[i] = keys[order[i]];
            _bandOrder[b] = order; _bandKey[b] = sortedKeys;
        }
    }

    /// <summary>The file: "PRL1" then an int32 count then the hashes as little-endian uint64 (repfeat.py export).</summary>
    public static RepLibrary? Load(string path)
    {
        try
        {
            using var f = File.OpenRead(path); using var r = new BinaryReader(f);
            var magic = r.ReadBytes(4); if (magic.Length < 4 || magic[0] != (byte)'P' || magic[1] != (byte)'R' || magic[2] != (byte)'L') return null;
            var n = r.ReadInt32(); var h = new ulong[n]; for (var i = 0; i < n; i++) h[i] = r.ReadUInt64();
            return new RepLibrary(h);
        }
        catch (Exception) { return null; }
    }

    public static RepLibrary FromHashes(IEnumerable<ulong> hashes) => new(new List<ulong>(hashes).ToArray());

    /// <summary>Whether a library hash lies within maxBits of q (by the four bands: two hashes within 12 bits share a band almost always; within 6, always but for a 1-in-a-million case).</summary>
    public bool NearAny(ulong q, int maxBits)
    {
        for (var b = 0; b < 4; b++)
        {
            var key = (ushort)((q >> (16 * b)) & 0xFFFF); var keys = _bandKey[b];
            var lo = Array.BinarySearch(keys, key); if (lo < 0) continue;
            while (lo > 0 && keys[lo - 1] == key) lo--;
            var hi = lo; while (hi + 1 < keys.Length && keys[hi + 1] == key) hi++;
            if (hi - lo + 1 > MaxBucket) continue;   // a blank-like band: skipped, as the audit skips it
            for (var i = lo; i <= hi; i++) if (FrameHash.Bits(_hashes[_bandOrder[b][i]] ^ q) <= maxBits) return true;
        }
        return false;
    }
}

/// <summary>One window's repetition readings over time: rep_near for the frame, rep_count15 over the last 15 s.</summary>
internal sealed class RepFeatures
{
    private readonly RepLibrary? _lib; private readonly int _bits; private readonly KnownShow? _known;
    private readonly List<(double T, bool Near)> _ring = new();
    public RepFeatures(RepLibrary? lib, int bits = 6, KnownShow? known = null) { _lib = lib; _bits = bits; _known = known; }
    public double Near { get; private set; }
    public double Count15 { get; private set; }

    public void Step(byte[] g, double t)
    {
        var near = false;
        if (_lib is not null)
        {
            var h = FrameHash.Of(g); var pc = FrameHash.Bits(h);
            if (pc >= 8 && pc <= 55) near = _lib.NearAny(h, _bits);   // flat frames are not looked up, as in training
            if (near && _known is not null && _known.Near(h, _bits)) near = false;   // E4: what the person said was the show never reads as a repeat
        }
        _ring.Add((t, near)); _ring.RemoveAll(e => t - e.T > 15);
        Near = near ? 1 : 0; var c = 0; foreach (var e in _ring) if (e.Near) c++; Count15 = c;
    }

    public Dictionary<string, double> Readings() => new() { ["rep_near"] = Near, ["rep_count15"] = Count15 };
}

/// <summary>What the person said was not an ad (E4, 2026-11-08): the hashes of the looks around a Not-an-ad press, kept on this PC in
/// breakwatch/known-show.json (at most 5,000), a local negative for anything identification-driven; nothing of it leaves the device.</summary>
internal sealed class KnownShow
{
    private readonly object _gate = new(); private readonly List<ulong> _hashes = new(); private RepLibrary? _lib;

    public void Load(string path, Action<string> log)
    {
        try
        {
            if (!File.Exists(path)) return;
            var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(path));
            lock (_gate)
            {
                _hashes.Clear();
                foreach (var e in doc.RootElement.GetProperty("entries").EnumerateArray()) foreach (var h in e.GetProperty("hashes").EnumerateArray()) _hashes.Add(Convert.ToUInt64(h.GetString()!, 16));
                _lib = _hashes.Count > 0 ? RepLibrary.FromHashes(_hashes) : null;
            }
            log("break watch: known-show list of " + _hashes.Count + " frames (" + Path.GetFileName(path) + ")");
        }
        catch (Exception ex) { log("break watch: known-show list unread (" + ex.Message + ")"); }
    }

    public bool Near(ulong h, int bits) { lock (_gate) return _lib is not null && _lib.NearAny(h, bits); }

    public void Add(string channel, IEnumerable<ulong> hashes, string path)
    {
        var list = new List<ulong>(hashes); if (list.Count == 0) return;
        lock (_gate)
        {
            _hashes.AddRange(list); if (_hashes.Count > 5000) _hashes.RemoveRange(0, _hashes.Count - 5000);
            _lib = RepLibrary.FromHashes(_hashes);
        }
        try
        {
            var entries = new List<object>();
            if (File.Exists(path))
                foreach (var e in System.Text.Json.JsonDocument.Parse(File.ReadAllText(path)).RootElement.GetProperty("entries").EnumerateArray())
                    entries.Add(System.Text.Json.JsonSerializer.Deserialize<object>(e.GetRawText())!);
            entries.Add(new { at = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), channel, hashes = list.ConvertAll(x => x.ToString("x16")) });
            while (entries.Count > 500) entries.RemoveAt(0);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, System.Text.Json.JsonSerializer.Serialize(new { entries }));
        }
        catch { }
    }
}
