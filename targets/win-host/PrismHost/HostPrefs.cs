using System.Text.Json;
using System.Text.Json.Nodes;

namespace PrismHost;

/// <summary>
/// Host-only preferences: things about THIS machine (full motion, later kiosk
/// details), never about the household's scenes - so they live beside
/// store.json, not in it (store.json is the section-10 model the migration and
/// the seed own). One small JSON object; a missing or unreadable file is the
/// defaults, and a write failure is never fatal.
/// </summary>
internal static class HostPrefs
{
    private static readonly string PrefsFile = Path.Combine(HostPaths.DataDir, "host-prefs.json");
    private static JsonObject? _doc;
    private static readonly object Gate = new();

    private static JsonObject Doc()
    {
        lock (Gate)
        {
            if (_doc is not null) return _doc;
            try { _doc = File.Exists(PrefsFile) && JsonNode.Parse(File.ReadAllText(PrefsFile)) is JsonObject o ? o : new JsonObject(); }
            catch { _doc = new JsonObject(); }
            return _doc;
        }
    }

    public static bool GetBool(string key, bool fallback)
    {
        try { return Doc()[key] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : fallback; }
        catch { return fallback; }
    }

    public static double GetDouble(string key, double fallback)
    {
        try { return Doc()[key] is JsonValue v && v.TryGetValue<double>(out var d) && double.IsFinite(d) ? d : fallback; }
        catch { return fallback; }
    }

    public static void Set(string key, double value) => Write(key, value);

    private static void Write(string key, JsonNode value)
    {
        lock (Gate)
        {
            var d = Doc();
            d[key] = value;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(PrefsFile)!);
                File.WriteAllText(PrefsFile, d.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            }
            catch { /* the in-memory value still applies for this run */ }
        }
    }

    public static void Set(string key, bool value)
    {
        lock (Gate)
        {
            var d = Doc();
            d[key] = value;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(PrefsFile)!);
                File.WriteAllText(PrefsFile, d.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            }
            catch { /* the in-memory value still applies for this run */ }
        }
    }
}
