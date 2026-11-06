using System.Text.Json;

namespace PrismHost.Surfaces.Visualization;

/// <summary>
/// The feed core pushes per visualization (music-state.ts VisualizationFeed,
/// serialized over surface.setVisualizationFeed). Pure parsing, no WinUI, so
/// what the renderer and the chrome are handed is asserted headless in CI.
///
/// <c>Palette</c> and <c>AudioOwner</c> are CORE's answers, not the host's: the
/// palette arrives already tinted toward the art's dominant colours in backdrop
/// mode (dashboard-schema §32; core's tintPalette/dominantColors are the one
/// rule for every port), and AudioOwner is §3 audio focus, which the metadata
/// line reports and no shell may guess. An absent or malformed field is read as
/// "no answer" - the pack's own palette stands - never guessed at.
/// </summary>
public sealed record VisualizationFeed(
    bool Active, string PlaybackState, string? Title, string? Artist, string? Album,
    string? Artwork, string ArtworkMode, string Style, IReadOnlyList<string> Palette, bool AudioOwner)
{
    public static VisualizationFeed Parse(string json)
    {
        try
        {
            using var d = JsonDocument.Parse(json);
            var r = d.RootElement;
            if (r.ValueKind != JsonValueKind.Object) return Idle;
            string? Str(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            var meta = r.TryGetProperty("metadata", out var m) && m.ValueKind == JsonValueKind.Object ? m : default;
            var palette = new List<string>();
            if (r.TryGetProperty("palette", out var pal) && pal.ValueKind == JsonValueKind.Array)
                foreach (var c in pal.EnumerateArray())
                    if (c.ValueKind == JsonValueKind.String && c.GetString() is { } hex && IsHex(hex)) palette.Add(hex);
            return new VisualizationFeed(
                r.TryGetProperty("active", out var a) && a.ValueKind == JsonValueKind.True,
                Str(r, "playbackState") ?? "none",
                meta.ValueKind == JsonValueKind.Object ? Str(meta, "title") : null,
                meta.ValueKind == JsonValueKind.Object ? Str(meta, "artist") : null,
                meta.ValueKind == JsonValueKind.Object ? Str(meta, "album") : null,
                Str(r, "artwork"), Str(r, "artworkMode") ?? "off", Str(r, "style") ?? "spectrum",
                palette, r.TryGetProperty("audioOwner", out var ao) && ao.ValueKind == JsonValueKind.True);
        }
        catch { return Idle; }
    }

    private static bool IsHex(string s)
    {
        if (s.Length != 7 || s[0] != '#') return false;
        for (var i = 1; i < 7; i++) if (Uri.IsHexDigit(s[i]) == false) return false;
        return true;
    }

    public static readonly VisualizationFeed Idle =
        new(false, "none", null, null, null, null, "off", "spectrum", Array.Empty<string>(), false);
}
