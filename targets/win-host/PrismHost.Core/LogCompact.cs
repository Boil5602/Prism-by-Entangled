using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PrismHost.Diagnostics;

/// <summary>
/// The shape of an event line in host.log (2026-09-30: a page's now-playing report carried Peacock's whole channel guide - logos,
/// what is on, every channel - forty kilobytes, several times a second across the windows; the log grew two gigabytes in thirteen
/// hours and would have filled a laptop's disk in days).
///
/// A JSON event is written with its scalars intact and its bulk stood in for: an array past <see cref="MaxItems"/> items becomes a
/// count, a string past <see cref="MaxString"/> characters is cut with what was left, and a line past <see cref="MaxLine"/> characters
/// is cut whatever its shape. The fields a reader of the log looks for (type, id, the video's kind, title, channel, playing, position,
/// the music's title) are scalars, and stay. Text that is not JSON is only capped.
///
/// Nothing here redacts: every line still goes through <see cref="Redact.Line"/> at the write.
/// </summary>
public static class LogCompact
{
    public const int MaxItems = 4;
    public const int MaxString = 300;
    public const int MaxLine = 6000;

    public static string Event(string? text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var s = text.TrimStart();
        if (s.Length > 0 && (s[0] == '{' || s[0] == '['))
        {
            try
            {
                var node = JsonNode.Parse(s);
                if (node is not null && Compact(node) is { } compact) s = compact.ToJsonString(new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            }
            catch (JsonException) { /* not JSON after all: capped below */ }
        }
        return s.Length <= MaxLine ? s : s[..MaxLine] + " ...(+" + (s.Length - MaxLine) + " chars)";
    }

    private static JsonNode? Compact(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject o:
            {
                var r = new JsonObject();
                foreach (var (k, v) in o) r[k] = Compact(v);
                return r;
            }
            case JsonArray a when a.Count > MaxItems:
                return JsonValue.Create("[" + a.Count + " items]");
            case JsonArray a:
            {
                var r = new JsonArray();
                foreach (var v in a) r.Add(Compact(v));
                return r;
            }
            case JsonValue v when v.TryGetValue<string>(out var str) && str.Length > MaxString:
                return JsonValue.Create(str[..MaxString] + " ...(+" + (str.Length - MaxString) + " chars)");
            case null:
                return null;
            default:
                return node.DeepClone();
        }
    }
}
