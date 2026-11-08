using System.Text.Json;
using System.Text.RegularExpressions;
using Windows.UI;

namespace PrismHost.Visualizations;

/// <summary>A style pack as the renderer reads it (packages/core/data/visualization-styles/*.json, shipped under Assets).</summary>
public sealed record StylePack(
    string Id, string Name, string Blurb, string Program, int Bands, Color[] Palette, string Background,
    double Speed, double Attack, double Release, double Beat, double ReducedSpeed, double ReducedBeat, IReadOnlyDictionary<string, double> Params)
{
    public double Param(string key, double fallback) => Params.TryGetValue(key, out var v) ? v : fallback;
}

/// <summary>
/// The four shipped packs - Prism Beams · Spectrum · Ribbon · Bloom - as data
/// (core validates the same files in tests; this loader mirrors
/// <c>normalizeStylePack</c>'s clamps so a malformed community pack is
/// refused or repaired the same way, never guessed at).
/// </summary>
public static class StylePacks
{
    /// <summary>The brand's four bands: the default palette when no art tints it (core's PRISM_BANDS).</summary>
    public static readonly Color[] PrismBands = { Hex("#F0A83C"), Hex("#5CC8C0"), Hex("#C86CF0"), Hex("#F05C7A") };

    private static List<StylePack>? _all;
    private static readonly string[] Order = { "prism-beams", "spectrum", "ribbon", "bloom", "aurora-ridge", "ocean-moon", "forest-fireflies", "rain-window", "snow-village", "desert-stars", "storm-front", "sunrise-meadow", "campfire-circle", "city-skyline", "lantern-festival", "fireworks-night", "harbor-lights", "night-train", "street-fair", "stadium-wave" };

    public static IReadOnlyList<StylePack> All()
    {
        if (_all is not null) return _all;
        var list = new List<StylePack>();
        try
        {
            var dir = Path.Combine(AppContext.BaseDirectory, "Assets", "visualization-styles");
            if (Directory.Exists(dir))
                foreach (var f in Directory.GetFiles(dir, "*.json"))
                    if (Parse(File.ReadAllText(f)) is { } p) list.Add(p);
        }
        catch { }
        if (list.Count == 0) list.Add(Fallback());
        _all = list.OrderBy(p => { var i = Array.IndexOf(Order, p.Id); return i < 0 ? 99 : i; }).ThenBy(p => p.Name).ToList();
        return _all;
    }

    public static StylePack Get(string? id) => All().FirstOrDefault(p => p.Id == id) ?? All()[0];

    public static StylePack? Parse(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            if (r.ValueKind != JsonValueKind.Object) return null;
            var id = Str(r, "id"); var program = Str(r, "program");
            if (id is null || !Regex.IsMatch(id, "^[a-z0-9-]+$") || program is null || !(program is "beams" or "bars" or "ribbon" or "particles" || Tableaus.Known(program))) return null;
            var palette = new List<Color>();
            if (r.TryGetProperty("palette", out var pal) && pal.ValueKind == JsonValueKind.Array)
                foreach (var c in pal.EnumerateArray()) if (c.ValueKind == JsonValueKind.String && Regex.IsMatch(c.GetString()!, "^#[0-9a-fA-F]{6}$")) palette.Add(Hex(c.GetString()!));
            var motion = r.TryGetProperty("motion", out var m) && m.ValueKind == JsonValueKind.Object ? m : default;
            var rm = r.TryGetProperty("reducedMotion", out var rmo) && rmo.ValueKind == JsonValueKind.Object ? rmo : default;
            var prm = new Dictionary<string, double>();
            if (r.TryGetProperty("params", out var pe) && pe.ValueKind == JsonValueKind.Object)
                foreach (var p in pe.EnumerateObject()) if (p.Value.ValueKind == JsonValueKind.Number) prm[p.Name] = p.Value.GetDouble();
            var bg = Str(r, "background");
            return new StylePack(id, Str(r, "name") ?? id, Str(r, "blurb") ?? "", program,
                (int)Math.Round(Num(r, "bands", 4, 128, 32)), palette.Count > 0 ? palette.ToArray() : (Color[])PrismBands.Clone(),
                bg is not null && (bg == "transparent" || Regex.IsMatch(bg, "^#[0-9a-fA-F]{6}$")) ? bg : "transparent",
                Num(motion, "speed", 0.1, 4, 1), Num(motion, "attack", 0.01, 1, 0.55), Num(motion, "release", 0.01, 1, 0.12), Num(motion, "beat", 0, 2, 0.6),
                Num(rm, "speed", 0, 1, 0.25), Num(rm, "beat", 0, 1, 0), prm);
        }
        catch { return null; }
    }

    private static StylePack Fallback() => new("prism-beams", "Prism Beams", "The signature.", "beams", 32, (Color[])PrismBands.Clone(), "transparent", 1, 0.5, 0.1, 0.7, 0.2, 0, new Dictionary<string, double>());

    private static string? Str(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String && v.GetString()!.Trim().Length > 0 ? v.GetString()!.Trim() : null;
    private static double Num(JsonElement e, string k, double lo, double hi, double d) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? Math.Min(hi, Math.Max(lo, v.GetDouble())) : d;

    public static Color Hex(string hex) => Color.FromArgb(255, Convert.ToByte(hex.Substring(1, 2), 16), Convert.ToByte(hex.Substring(3, 2), 16), Convert.ToByte(hex.Substring(5, 2), 16));

    /// <summary>
    /// The palettes of the loaded packs as core wants them declared:
    /// {"prism-beams": ["#RRGGBB", …], …}. The host hands this to
    /// `registerStylePalettes` at startup and CORE does the §32 backdrop tint
    /// from there (concept-scenes §2.5.2 point 2) - there is deliberately no
    /// tint or dominant-color routine on this side any more.
    /// </summary>
    public static string PalettesJson()
    {
        // {id: {palette, artTint}}: how far core's §32 backdrop tint may pull this pack toward the artwork (params.artTint, default 0.6)
        var map = new Dictionary<string, object>();
        foreach (var p in All()) map[p.Id] = new { palette = p.Palette.Select(HexOf).ToArray(), artTint = p.Param("artTint", 0.6) };
        return JsonSerializer.Serialize(map);
    }

    public static string HexOf(Color c) => $"#{c.R:X2}{c.G:X2}{c.B:X2}";
}
