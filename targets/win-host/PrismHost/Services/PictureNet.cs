using System;
using System.IO;
using System.Text.Json;

namespace PrismHost.Services;

/// <summary>The small picture network trained on the bench (2026-11-06, scripts/breakwatch/cnn.py; exported as picture-net.json with each
/// batch norm folded into its convolution). Its input is the frame the break watch already reads (320 x 180 grey) in 3 x 3 blocks
/// (60 x 106, the last two columns left out), beside its change from the frame before (zero with no frame in the last three seconds),
/// both over 255 and rounded to half precision as training stored them. Four 3 x 3 convolutions at stride 2 (each with its ReLU), a
/// layer of 64 with its ReLU, one output; the chance is its sigmoid. The extension's picture-net.js is the same, line for line.</summary>
public sealed class PictureNet
{
    private const int W = 106, H = 60;
    private sealed record Layer(bool Conv, int In, int Out, float[] Wt, float[] B, bool Relu);
    private readonly Layer[] _layers;

    private PictureNet(Layer[] layers) => _layers = layers;

    public static PictureNet? Load(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            if (root.GetProperty("kind").GetString() != "picture-net" || root.GetProperty("version").GetInt32() != 1) return null;
            var list = new System.Collections.Generic.List<Layer>();
            foreach (var l in root.GetProperty("layers").EnumerateArray())
            {
                var conv = l.GetProperty("type").GetString() == "conv";
                list.Add(new Layer(conv, l.GetProperty("in").GetInt32(), l.GetProperty("out").GetInt32(), F32(l.GetProperty("w").GetString()!), F32(l.GetProperty("b").GetString()!),
                    conv || (l.TryGetProperty("relu", out var r) && r.GetBoolean())));
            }
            return new PictureNet(list.ToArray());
        }
        catch { return null; }
    }

    private static float[] F32(string b64)
    {
        var bytes = Convert.FromBase64String(b64);
        var f = new float[bytes.Length / 4];
        Buffer.BlockCopy(bytes, 0, f, 0, f.Length * 4);   // little-endian, as every PC PRISM runs on
        return f;
    }

    private static float[] Blocks(byte[] g)
    {
        var o = new float[H * W];
        for (var y = 0; y < H; y++)
            for (var x = 0; x < W; x++)
            {
                var s = 0;
                for (var dy = 0; dy < 3; dy++) { var row = (y * 3 + dy) * 320 + x * 3; s += g[row] + g[row + 1] + g[row + 2]; }
                o[y * W + x] = (float)(s / 9.0);
            }
        return o;
    }

    /// <summary>The chance of an ad for one frame; prev is null when there was no frame in the last three seconds.</summary>
    public double Chance(byte[] grey, byte[]? prev)
    {
        if (InChannels != 2) throw new InvalidOperationException("this picture network wants " + InChannels + " channels: call Chance(grey, prev, back)");
        var c = Blocks(grey); var p = prev is null ? null : Blocks(prev);
        var x = new float[2 * H * W];
        for (var k = 0; k < H * W; k++) { x[k] = (float)(Half)(c[k] / 255.0); x[H * W + k] = p is null ? 0f : (float)(Half)((c[k] - p[k]) / 255.0); }
        return Run(x, 2);
    }

    /// <summary>The channels the network was trained on: 2 (the frame and its change), or 4 with the ten seconds behind it.</summary>
    public int InChannels => _layers[0].In;

    /// <summary>The temporal network's chance (2026-11-07, cnn.py TEMPORAL=1): beside the frame and its change from the frame before,
    /// the mean absolute change between successive frames two seconds apart over the last ten seconds, and the change from the frame six
    /// seconds before. back[k] is the frame nearest 2(k+1) seconds back (within 0.7 s), null where the recording has none; a missing frame
    /// leaves its stride out, and with none the channels are zero - as the training built them.</summary>
    public double Chance(byte[] grey, byte[]? prev, byte[]?[] back)
    {
        if (InChannels != 4) throw new InvalidOperationException("this picture network wants " + InChannels + " channels");
        if (back.Length != 5) throw new ArgumentException("five frames back, two seconds apart", nameof(back));
        var c = Blocks(grey); var p = prev is null ? null : Blocks(prev);
        var greys = new float[]?[6]; greys[0] = c; for (var k = 0; k < 5; k++) greys[k + 1] = back[k] is null ? null : Blocks(back[k]!);
        var n = H * W; var energy = new float[n]; var pairs = 0;
        for (var k = 0; k < 5; k++)
            if (greys[k] is { } a && greys[k + 1] is { } b) { pairs++; for (var i = 0; i < n; i++) energy[i] += Math.Abs(a[i] - b[i]); }
        var six = greys[3];
        var x = new float[4 * n];
        for (var k = 0; k < n; k++)
        {
            x[k] = (float)(Half)(c[k] / 255.0);
            x[n + k] = p is null ? 0f : (float)(Half)((c[k] - p[k]) / 255.0);
            x[2 * n + k] = pairs == 0 ? 0f : (float)(Half)(energy[k] / pairs / 255.0);
            x[3 * n + k] = six is null ? 0f : (float)(Half)((c[k] - six[k]) / 255.0);
        }
        return Run(x, 4);
    }

    private double Run(float[] x, int ch)
    {
        int h = H, w = W;
        foreach (var L in _layers)
        {
            if (L.Conv)
            {
                int oh = (h + 1) / 2, ow = (w + 1) / 2; var o = new float[L.Out * oh * ow];
                for (var oc = 0; oc < L.Out; oc++)
                    for (var y = 0; y < oh; y++)
                        for (var xx = 0; xx < ow; xx++)
                        {
                            double s = L.B[oc];
                            for (var i = 0; i < ch; i++)
                            {
                                int wb = (oc * ch + i) * 9, xb = i * h * w;
                                for (var ky = 0; ky < 3; ky++)
                                {
                                    var iy = y * 2 - 1 + ky; if (iy < 0 || iy >= h) continue;
                                    for (var kx = 0; kx < 3; kx++)
                                    {
                                        var ix = xx * 2 - 1 + kx; if (ix < 0 || ix >= w) continue;
                                        s += L.Wt[wb + ky * 3 + kx] * x[xb + iy * w + ix];
                                    }
                                }
                            }
                            o[(oc * oh + y) * ow + xx] = s > 0 ? (float)s : 0f;
                        }
                x = o; ch = L.Out; h = oh; w = ow;
            }
            else
            {
                var o = new float[L.Out];
                for (var oc = 0; oc < L.Out; oc++)
                {
                    double s = L.B[oc]; var wb = oc * L.In;
                    for (var i = 0; i < L.In; i++) s += L.Wt[wb + i] * x[i];
                    o[oc] = L.Relu && s < 0 ? 0f : (float)s;
                }
                x = o;
            }
        }
        return 1 / (1 + Math.Exp(-x[0]));
    }
}
