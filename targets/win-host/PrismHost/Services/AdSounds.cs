using System;
using System.Collections.Generic;
using System.IO;
using System.Numerics;

namespace PrismHost.Services;

/// <summary>
/// The ads Prism has heard (2026-10-07, "Proceed" - audio fingerprints): an ad's soundtrack is the same every time it airs, and far more its
/// own than a small grey picture, so the sound of a break the watch is sure of is kept, and a window playing a stretch of it again is playing
/// that ad. The page's meter gives one 32-bit word per 50 ms (Haitsma-Kalker: which way the energy steps between 33 bands from 300 to 2000 Hz
/// changed since the last frame); a match is 64 words (about 3 s) found again with no more than a quarter of their bits differing. Words are
/// looked up exactly, then the block around each hit is compared, so a match costs little however large the library grows. Kept on this PC
/// (breakwatch\sounds.bin); never sent anywhere.
/// </summary>
internal sealed class AdSounds
{
    private const int Block = 64;
    private const double MaxBer = 0.25;
    private const int MaxClips = 600, MaxClipWords = 1600;   // 600 stretches of up to 80 s
    private readonly List<uint[]> _clips = new();
    private readonly Dictionary<uint, List<(int Clip, int At)>> _index = new();
    private readonly string _path;
    private bool _dirty;

    public AdSounds(string path) { _path = path; Load(); }
    public int Count => _clips.Count;

    /// <summary>Whether the last Block words of this window's sound were heard in a break before.</summary>
    public bool Heard(IReadOnlyList<uint> recent)
    {
        if (recent.Count < Block) return false;
        var start = recent.Count - Block;
        for (var i = start; i < recent.Count; i += 4)
        {
            if (!_index.TryGetValue(recent[i], out var hits)) continue;
            foreach (var (clip, at) in hits)
            {
                var c = _clips[clip];
                var c0 = at - (i - start);
                if (c0 < 0 || c0 + Block > c.Length) continue;
                var bits = 0;
                for (var k = 0; k < Block && bits <= Block * 32 * MaxBer; k++) bits += BitOperations.PopCount(c[c0 + k] ^ recent[start + k]);
                if (bits <= Block * 32 * MaxBer) return true;
            }
        }
        return false;
    }

    /// <summary>A stretch of a break the watch is sure of: kept as one clip (its words indexed).</summary>
    public void Learn(IReadOnlyList<uint> words)
    {
        if (words.Count < Block || Heard(words)) return;   // a stretch already known is not kept twice
        var clip = new uint[Math.Min(words.Count, MaxClipWords)];
        for (var i = 0; i < clip.Length; i++) clip[i] = words[words.Count - clip.Length + i];
        if (_clips.Count >= MaxClips) { _clips.RemoveAt(0); Reindex(); }
        _clips.Add(clip); IndexClip(_clips.Count - 1);
        _dirty = true;
    }

    private void IndexClip(int c)
    {
        var clip = _clips[c];
        for (var i = 0; i < clip.Length; i++)
        {
            var w = clip[i];
            if (w == 0 || w == uint.MaxValue) continue;   // silence and noise words match everything
            if (!_index.TryGetValue(w, out var l)) _index[w] = l = new List<(int, int)>();
            if (l.Count < 64) l.Add((c, i));
        }
    }
    private void Reindex() { _index.Clear(); for (var c = 0; c < _clips.Count; c++) IndexClip(c); }

    public void Save()
    {
        if (!_dirty) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            using var w = new BinaryWriter(File.Create(_path));
            w.Write(1); w.Write(_clips.Count);
            foreach (var c in _clips) { w.Write(c.Length); foreach (var x in c) w.Write(x); }
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
            for (var i = 0; i < n; i++) { var len = r.ReadInt32(); var c = new uint[len]; for (var k = 0; k < len; k++) c[k] = r.ReadUInt32(); _clips.Add(c); }
            Reindex();
        }
        catch { _clips.Clear(); _index.Clear(); }
    }
}
