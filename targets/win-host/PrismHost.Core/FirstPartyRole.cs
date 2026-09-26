using System.Text.Json;

namespace PrismHost.Core;

/// <summary>
/// docs/concept-scenes.md §1, "first-party roles pre-resolve": a Scene
/// Template role whose suggestions are a single first-party App — one the
/// catalog marks <c>account: "none"</c>, so there is nothing to sign in to —
/// is pre-filled by the wizard instead of being asked about. That is what
/// keeps six-role Family Hub down to four real decisions.
///
/// The rule is deliberately narrow. Two suggestions means the household has a
/// genuine choice and the wizard must ask; an App that can be signed into is
/// never pre-filled, because "already set up" would be a claim we cannot make.
/// Pre-filling is never final: the resolved card still offers "Choose a
/// different app".
/// </summary>
public static class FirstPartyRole
{
    /// <summary>The catalog entry declares this App has nothing to sign in to (§31 <c>account: "none"</c>).</summary>
    public static bool NoAccount(string? catalogJson)
    {
        if (string.IsNullOrEmpty(catalogJson)) return false;
        try
        {
            using var doc = JsonDocument.Parse(catalogJson);
            return doc.RootElement.TryGetProperty("account", out var a)
                && a.ValueKind == JsonValueKind.String
                && string.Equals(a.GetString(), "none", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;   // an unreadable entry is never treated as first-party
        }
    }

    /// <summary>
    /// True when this role may be resolved without asking: exactly one
    /// suggestion, and that suggestion's catalog entry needs no account.
    /// </summary>
    public static bool IsPreresolvable(IReadOnlyList<string>? suggestions, string? catalogJson) =>
        suggestions is { Count: 1 } && !string.IsNullOrWhiteSpace(suggestions[0]) && NoAccount(catalogJson);
}
