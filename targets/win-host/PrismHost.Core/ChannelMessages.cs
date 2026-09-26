using System.Text.Json;
using PrismHost.Channel;

namespace PrismHost.Channel;

/// <summary>One parsed core→host command off the brain's JSON channel.</summary>
public sealed record CommandMessage(string Op, double? RequestId, JsonElement Payload)
{
    public string? GetString(string name) =>
        Payload.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public double GetNumber(string name, double fallback = 0) =>
        Payload.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : fallback;

    public bool GetBool(string name, bool fallback = false) =>
        Payload.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? v.GetBoolean() : fallback;

    public ChannelRect? GetRect(string name)
    {
        if (!Payload.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Object) return null;
        double N(string f) => v.TryGetProperty(f, out var n) && n.ValueKind == JsonValueKind.Number ? n.GetDouble() : 0;
        return new ChannelRect(N("x"), N("y"), N("w"), N("h"));
    }
}

/// <summary>How the host should treat a parsed command (win-host-spec §2).</summary>
public enum CommandRoute
{
    /// <summary>Implemented by the M1 seam — execute it.</summary>
    Execute,
    /// <summary>Known op outside M1 scope, fire-and-forget — log and drop.</summary>
    StubIgnore,
    /// <summary>Known request-lane op outside M1 — answer resolve(null, "unsupported") so core degrades instead of hanging.</summary>
    StubResolveUnsupported,
    /// <summary>Not in the schema at all — a drift bug; log loudly.</summary>
    Unknown,
}

/// <summary>
/// Pure channel logic: parse the JSON envelope and classify against the
/// GENERATED schema (Channel.g.cs). The host executes; it never decides —
/// anything unrecognized is schema drift, surfaced, never guessed at.
/// </summary>
public static class ChannelParser
{
    public static CommandMessage? Parse(string json)
    {
        try
        {
            var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (!root.TryGetProperty("op", out var op) || op.ValueKind != JsonValueKind.String) return null;
            double? requestId = root.TryGetProperty("requestId", out var r) && r.ValueKind == JsonValueKind.Number
                ? r.GetDouble() : null;
            return new CommandMessage(op.GetString()!, requestId, root);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static CommandRoute Route(CommandMessage msg)
    {
        if (!ChannelSchema.RequestLane.TryGetValue(msg.Op, out var isRequest)) return CommandRoute.Unknown;
        if (ChannelSchema.M1.Contains(msg.Op)) return CommandRoute.Execute;
        return isRequest ? CommandRoute.StubResolveUnsupported : CommandRoute.StubIgnore;
    }

    /// <summary>JS for a host→core call: PrismRuntime.fn(...args) via the {fn,args} message shape.</summary>
    public static string HostCallJson(string fn, params object?[] args) =>
        JsonSerializer.Serialize(new { fn, args });

    /// <summary>The resolve answer for a stubbed request op.</summary>
    public static string ResolveUnsupportedJson(double requestId) =>
        HostCallJson(HostCalls.Resolve, requestId, null, "unsupported: not implemented in M1");
}
