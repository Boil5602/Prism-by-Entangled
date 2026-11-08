namespace PrismHost.Storage;

/// <summary>
/// A before/after comparison of two store snapshots, classified for the §10
/// invariant the scene-model migration must keep (scene-model-spec §7,
/// dashboard-schema §10): the migration may ADD keys under one prefix
/// (`scene-model:`) and may touch nothing else. Pure: the host runs it around
/// the first-boot migration and logs the verdict; PrismHost.Tests pins it.
/// </summary>
public sealed record StoreDiff(
    IReadOnlyList<string> AddedUnderPrefix,
    IReadOnlyList<string> AddedElsewhere,
    IReadOnlyList<string> Changed,
    IReadOnlyList<string> Removed)
{
    /// <summary>True when the only difference is keys added under the prefix.</summary>
    public bool OnlyAddedUnderPrefix => AddedElsewhere.Count == 0 && Changed.Count == 0 && Removed.Count == 0;

    /// <summary>A removed or rewritten pre-existing key: the §10 violation (no migration may ever do it).</summary>
    public bool ViolatesNeverRewrite => Changed.Count > 0 || Removed.Count > 0;

    public static StoreDiff Classify(IReadOnlyDictionary<string, string> before, IReadOnlyDictionary<string, string> after, string prefix)
    {
        var addedPrefix = new List<string>();
        var addedOther = new List<string>();
        var changed = new List<string>();
        var removed = new List<string>();
        foreach (var (k, v) in before)
        {
            if (!after.TryGetValue(k, out var nv)) removed.Add(k);
            else if (!string.Equals(v, nv, StringComparison.Ordinal)) changed.Add(k);
        }
        foreach (var k in after.Keys)
            if (!before.ContainsKey(k)) (k.StartsWith(prefix, StringComparison.Ordinal) ? addedPrefix : addedOther).Add(k);
        addedPrefix.Sort(StringComparer.Ordinal); addedOther.Sort(StringComparer.Ordinal); changed.Sort(StringComparer.Ordinal); removed.Sort(StringComparer.Ordinal);
        return new StoreDiff(addedPrefix, addedOther, changed, removed);
    }

    public string Summary() =>
        $"added {AddedUnderPrefix.Count} under prefix" +
        (AddedElsewhere.Count > 0 ? $", added elsewhere: {string.Join(", ", AddedElsewhere)}" : "") +
        (Changed.Count > 0 ? $", CHANGED: {string.Join(", ", Changed)}" : "") +
        (Removed.Count > 0 ? $", REMOVED: {string.Join(", ", Removed)}" : "");
}
