using System.IO;
using System.Text.Json;

namespace PrismHost.Services;

/// <summary>Outcome of verifying the Edge profile a §29 hand-off window would run in.</summary>
public enum HandoffStatus
{
    /// <summary>The host has no Edge hand-off today (B-24): nothing launches Edge, so there is nothing to verify - reported, never warned.</summary>
    HandoffNotPresent,
    /// <summary>The hand-off profile folder does not exist yet (Edge never ran with it).</summary>
    ProfileMissing,
    /// <summary>The profile exists but the Prism veil extension is not installed in it - a hand-off would mean "ads came back".</summary>
    ExtensionMissing,
    /// <summary>The extension is installed and enabled in the profile.</summary>
    Verified,
}

/// <summary>
/// win-host-spec §5 "Launched Edge windows": a hand-off runs outside WebView2,
/// so the §26/§27/§30 engine must come from the Prism extension installed in
/// the Edge profile used for hand-offs. The kiosk installer installs/verifies it
/// (targets/win-host/kiosk/Install-PrismKiosk.ps1) and the host warns when a
/// hand-off window would lack it. The check reads Edge's own profile record
/// (Preferences → extensions.settings) - no Edge process is touched.
/// </summary>
public static class HandoffCheck
{
    /// <summary>Extension ids the veil ships under (Chromium store id + the unpacked dev id are both accepted).</summary>
    public static readonly string[] VeilExtensionIds = { "prism-veil" };
    /// <summary>The user-data-dir a hand-off window would use: separate from the user's daily Edge profile (§10 / §22).</summary>
    public static string HandoffProfileDir(string prismRoot) => Path.Combine(prismRoot, "edge-handoff");
    /// <summary>Does the host have a hand-off path at all? Flipped when Media.launch lands (B-24).</summary>
    public const bool HandoffImplemented = false;

    public static HandoffStatus Verify(string prismRoot)
    {
        if (!HandoffImplemented) return HandoffStatus.HandoffNotPresent;
        return VerifyProfile(HandoffProfileDir(prismRoot));
    }

    /// <summary>The profile-level check itself (also what the installer's -Verify calls through PowerShell).</summary>
    public static HandoffStatus VerifyProfile(string userDataDir)
    {
        var prefs = Path.Combine(userDataDir, "Default", "Preferences");
        if (!Directory.Exists(userDataDir) || !File.Exists(prefs)) return HandoffStatus.ProfileMissing;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(prefs));
            if (!doc.RootElement.TryGetProperty("extensions", out var ext) || !ext.TryGetProperty("settings", out var settings) || settings.ValueKind != JsonValueKind.Object)
                return HandoffStatus.ExtensionMissing;
            foreach (var entry in settings.EnumerateObject())
            {
                // match by manifest name (unpacked ids are hashes of the path) or by a known id
                var name = entry.Value.TryGetProperty("manifest", out var m) && m.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                var known = VeilExtensionIds.Contains(entry.Name) || name.Contains("Prism", StringComparison.OrdinalIgnoreCase) && name.Contains("Veil", StringComparison.OrdinalIgnoreCase);
                if (!known) continue;
                var state = entry.Value.TryGetProperty("state", out var st) && st.ValueKind == JsonValueKind.Number ? st.GetInt32() : 1;
                if (state == 1) return HandoffStatus.Verified;       // 1 = enabled in Chromium's extension prefs
            }
            return HandoffStatus.ExtensionMissing;
        }
        catch { return HandoffStatus.ExtensionMissing; }
    }

    /// <summary>The warning the host shows when a hand-off would run unverified (null = nothing to warn about).</summary>
    public static string? Warning(HandoffStatus status) => status switch
    {
        HandoffStatus.ProfileMissing => "Edge hand-off profile not set up - run the kiosk installer before using Full Screen hand-offs (ads would not be veiled there)",
        HandoffStatus.ExtensionMissing => "Prism veil extension missing from the Edge hand-off profile - a hand-off window would show ads unveiled",
        _ => null,
    };
}
