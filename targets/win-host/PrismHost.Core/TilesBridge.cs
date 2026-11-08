using System.Text.Json;

namespace PrismHost.Tiles;

/// <summary>
/// The page side of the first-party micro-facets (docs/concept-scenes.md §6).
///
/// Two Prism-owned pages — Chores &amp; notes and Timer — are served from
/// Assets/tiles at <c>https://tiles.prism/…</c>. They hold no document logic:
/// they post ONE human edit at a time and render whatever comes back, and core
/// (packages/core/src/tiles-data.ts) owns the shape and persists it through the
/// Store driver (§10 — written, never wiped). That is what lets the phone's
/// §6 <c>POST /chores</c> and the panel's own tap edit the same list.
///
/// This class is the whole host share of that: parse the page's message,
/// refuse anything that is not one of the two documents, and build the sync
/// <c>PrismRuntime.tiles*</c> expression the brain answers. It decides nothing
/// about chores or timers (§23) — and the origin check means a page that is NOT
/// one of ours cannot reach the store through this channel, whatever it posts.
/// </summary>
public static class TilesBridge
{
    /// <summary>The virtual host the shell maps Assets/tiles to (beside brain.prism and prism-art.local).</summary>
    public const string HostName = "tiles.prism";

    /// <summary>Store key: the household list + the notes beneath it (core's CHORES_KEY).</summary>
    public const string ChoresKey = "tiles:chores";
    /// <summary>Store key: the timer's mode, duration and deadline (core's TIMER_KEY).</summary>
    public const string TimerKey = "tiles:timer";
    /// <summary>Store key: the week the agenda facet shows (core's AGENDA_KEY, CS-10.3).</summary>
    public const string AgendaKey = "tiles:agenda";

    /// <summary>The only keys this channel will read or write. Anything else is refused, not created.</summary>
    public static readonly string[] Keys = { ChoresKey, TimerKey, AgendaKey };

    public static bool KeyAllowed(string? key) => key is not null && Array.IndexOf(Keys, key) >= 0;

    /// <summary>True for a page the shell itself serves at tiles.prism. Only such a page may use this channel.</summary>
    public static bool IsTilesOrigin(string? url)
    {
        if (string.IsNullOrEmpty(url)) return false;
        return Uri.TryCreate(url, UriKind.Absolute, out var u)
            && u.Scheme == Uri.UriSchemeHttps
            && string.Equals(u.Host, HostName, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The document a tiles.prism URL actually loads. The virtual host mapping
    /// serves files, not directories, so the charter's https://tiles.prism/chores/
    /// (docs/concept-scenes.md §6) is navigated as .../chores/index.html - the
    /// facet keeps the directory URL, the surface loads the file. Anything that
    /// is not a directory URL on this host comes back untouched. Verified on the
    /// wall 2026-09-02: the directory URL loaded an empty document, the explicit
    /// index.html loaded and revealed.
    /// </summary>
    public static string DocumentUrl(string url)
    {
        if (!IsTilesOrigin(url)) return url;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || !u.AbsolutePath.EndsWith("/", StringComparison.Ordinal)) return url;
        var b = new UriBuilder(u) { Path = u.AbsolutePath + "index.html" };
        return b.Uri.ToString();
    }

    /// <summary>"get" (read the document) or "apply" (one human edit).</summary>
    public enum RequestKind { Get, Apply }

    /// <param name="Kind">What the page asked for.</param>
    /// <param name="Key">One of <see cref="Keys"/>.</param>
    /// <param name="IntentJson">The tiles-data.ts TilesIntent, verbatim; empty for a Get.</param>
    public sealed record Request(RequestKind Kind, string Key, string IntentJson);

    /// <summary>
    /// A page message → a request, or null when it is not one (every other
    /// message on this channel belongs to the §26/§27/§30 engine and must fall
    /// through untouched). Refuses an unknown key and an oversized intent.
    /// </summary>
    public static Request? TryParse(string? json)
    {
        if (string.IsNullOrEmpty(json) || json.Length > 64 * 1024) return null;
        if (!json.Contains("\"prism-tiles\"", StringComparison.Ordinal)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (!root.TryGetProperty("prism-tiles", out var kindEl) || kindEl.ValueKind != JsonValueKind.String) return null;
            if (!root.TryGetProperty("key", out var keyEl) || keyEl.ValueKind != JsonValueKind.String) return null;
            var key = keyEl.GetString();
            if (!KeyAllowed(key)) return null;

            switch (kindEl.GetString())
            {
                case "get":
                    return new Request(RequestKind.Get, key!, "");
                case "apply":
                    if (!root.TryGetProperty("intent", out var iEl) || iEl.ValueKind != JsonValueKind.String) return null;
                    var intent = iEl.GetString() ?? "";
                    if (intent.Length == 0 || intent.Length > 8 * 1024) return null;
                    return new Request(RequestKind.Apply, key!, intent);
                default:
                    return null;
            }
        }
        catch (JsonException) { return null; }
    }

    /// <summary>The sync brain call that answers a request (BrainHost.EvalAsync).</summary>
    public static string RuntimeExpression(Request request) => request.Kind switch
    {
        RequestKind.Get => "PrismRuntime.tilesGet(" + JsonSerializer.Serialize(request.Key) + ")",
        _ => "PrismRuntime.tilesApply(" + JsonSerializer.Serialize(request.Key) + "," + JsonSerializer.Serialize(request.IntentJson) + ")",
    };

    /// <summary>The message that carries a document back to every tiles.prism page (host → page).</summary>
    public static string DocMessage(string key, string docJson) =>
        "{\"prism-tiles\":\"doc\",\"key\":" + JsonSerializer.Serialize(key) + ",\"doc\":" +
        (string.IsNullOrWhiteSpace(docJson) || docJson == "null" ? "null" : docJson) + "}";

    /// <summary>The message that tells a page an edit was refused, in the words core used.</summary>
    public static string ErrorMessage(string key, string message) =>
        "{\"prism-tiles\":\"error\",\"key\":" + JsonSerializer.Serialize(key) + ",\"message\":" + JsonSerializer.Serialize(message) + "}";

    /// <summary>
    /// core's tilesApply answer → the document to push back, or the refusal to
    /// report. A malformed answer reports itself rather than pushing nothing.
    /// </summary>
    public static (string? DocJson, string? Error) ReadApplyResult(string? resultJson)
    {
        if (string.IsNullOrWhiteSpace(resultJson) || resultJson == "null") return (null, "the page's edit did not reach Prism");
        try
        {
            using var doc = JsonDocument.Parse(resultJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return (null, "unreadable answer");
            if (root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True && root.TryGetProperty("doc", out var d))
                return (d.GetRawText(), null);
            var msg = root.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;
            return (null, msg ?? "refused");
        }
        catch (JsonException) { return (null, "unreadable answer"); }
    }
}
