namespace PrismHost.Core;

/// <summary>
/// One Scene Template role, reduced to what the wizard's completion rule
/// needs (docs/concept-scenes.md §7a). <c>VisualizationSource</c> is the
/// hidden role id a <c>kind: "visualization"</c> role draws from; null for
/// every other kind.
/// </summary>
public sealed record TemplateRoleRef(string Id, string Kind, string? VisualizationSource);

/// <summary>
/// The wizard's side of core's <c>templateCompletion</c> (§7a), kept here so
/// it is pinned by a test rather than living inside a XAML page: the Create
/// button and core's own refusal must agree, or the household is told "every
/// role is resolved" and then handed an error.
///
/// The rules, verbatim from §7a: a template counts its slot roles AND its
/// hidden roles; a <c>visualization</c> role is complete when the hidden role
/// it names is resolved and is never a question of its own (the wizard creates
/// the hidden facet and the visualization together); and a hidden
/// <c>music</c> role is never pre-resolved, because a music service is signed
/// into.
/// </summary>
public static class TemplateRoles
{
    public const string Visualization = "visualization";
    public const string Music = "music";

    private static readonly TemplateRoleRef[] None = Array.Empty<TemplateRoleRef>();

    /// <summary>Is this role answered? A visualization role is, exactly when its source is.</summary>
    public static bool IsResolved(TemplateRoleRef? role, IEnumerable<string>? resolved)
    {
        if (role is null) return false;
        var have = new HashSet<string>(resolved ?? Enumerable.Empty<string>(), StringComparer.Ordinal);
        if (!string.Equals(role.Kind, Visualization, StringComparison.Ordinal)) return have.Contains(role.Id);
        return !string.IsNullOrWhiteSpace(role.VisualizationSource) && have.Contains(role.VisualizationSource!);
    }

    /// <summary>
    /// The role ids still open, in the order given. A visualization role is
    /// omitted while the role it names is declared by this template - that
    /// role's own line is the one the household is asked about - and reported
    /// only when it names nothing this template declares and nothing resolved.
    /// </summary>
    public static IReadOnlyList<string> Unresolved(IReadOnlyList<TemplateRoleRef>? roles, IEnumerable<string>? resolved)
    {
        var all = roles ?? None;
        var have = new HashSet<string>(resolved ?? Enumerable.Empty<string>(), StringComparer.Ordinal);
        var declared = new HashSet<string>(all.Select(r => r.Id), StringComparer.Ordinal);
        var open = new List<string>();
        foreach (var r in all)
        {
            if (string.Equals(r.Kind, Visualization, StringComparison.Ordinal))
            {
                var src = r.VisualizationSource;
                if (string.IsNullOrWhiteSpace(src) || (!have.Contains(src!) && !declared.Contains(src!))) open.Add(r.Id);
                continue;
            }
            if (!have.Contains(r.Id)) open.Add(r.Id);
        }
        return open;
    }

    /// <summary>Every role is answered (core's <c>templateCompletion().complete</c>).</summary>
    public static bool IsComplete(IReadOnlyList<TemplateRoleRef>? roles, IEnumerable<string>? resolved) =>
        Unresolved(roles, resolved).Count == 0;

    /// <summary>
    /// §2.5.1: a hidden music role is never pre-resolved - it needs a
    /// sign-in, and "already set up" is a claim we cannot make. A
    /// visualization role is never pre-resolved either: it is not an App
    /// question at all.
    /// </summary>
    public static bool NeverPreresolved(string? kind) =>
        string.Equals(kind, Music, StringComparison.Ordinal) || string.Equals(kind, Visualization, StringComparison.Ordinal);
}
