using System.Diagnostics;

namespace PrismHost.Services;

/// <summary>
/// This PC's one administrator step (2026-10-06, "We should add the remote desktop support option at the same setup time right? So they
/// dont get a late UAC prompt"; docs/features/updates.md, "Setup"). Two things need Windows' permission, and on a TV with a remote there
/// is nobody at a keyboard to give it later, so both are asked for together, once, while someone sets the PC up:
///   - the firewall rule that lets phones on the home network reach Prism's remote: inbound TCP 8471 for the installed exe only, from the
///     local subnet only, so Windows never asks about it (it asked once a version while each update ran from its own folder);
///   - Remote Desktop Support, if chosen (Services.MediaHub).
/// One elevated cmd runs netsh and schtasks; a person declining the prompt changes nothing.
/// </summary>
public static class DeviceSetup
{
    public const string FirewallRuleName = "Prism phone remote";
    public const int RemotePort = 8471;

    /// <summary>Starting with Windows (2026-10-26, "when my PC restarted, prism wasn't launched so I couldn't reach it remotely"): a value under
    /// this account's Run key naming the installed exe, so Windows starts Prism each time the account signs in. No administrator rights, so it
    /// is its own switch, apart from the one prompt above. A restart brings Prism back only once the account is signed in: a PC nobody touches
    /// also needs Windows set to sign in by itself (said on the page).</summary>
    public const string RunValueName = "Prism";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    /// <summary>The exe the Run value names: the Prism running now. For everyone but a developer that is the installed copy (the copy that
    /// installed it hands off to it, Services.Updates), and a developer's own build folder is swapped in place across restarts, so the path
    /// holds. A value naming another exe (an older install, a folder since gone) reads as off, and pressing the switch names this one.</summary>
    public static string StartExe => Environment.ProcessPath ?? Updates.InstallExe;

    /// <summary>Whether Windows starts Prism with this account's sign-in: the Run value is there and names the exe Prism would name today.</summary>
    public static bool StartsAtSignIn()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey);
            var v = key?.GetValue(RunValueName) as string;
            return !string.IsNullOrWhiteSpace(v) && string.Equals(v.Trim().Trim('"'), StartExe, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    /// <summary>Puts the Run value in place or takes it away. True when Windows has it the way it was asked after.</summary>
    public static bool SetStartAtSignIn(bool on, Action<string> log)
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(RunKey, writable: true);
            if (key is null) return false;
            if (on) key.SetValue(RunValueName, "\"" + StartExe + "\"", Microsoft.Win32.RegistryValueKind.String);
            else key.DeleteValue(RunValueName, throwOnMissingValue: false);
            log("setup: start at sign-in " + (on ? "on (" + StartExe + ")" : "off"));
            return StartsAtSignIn() == on;
        }
        catch (Exception e) { log("setup: start at sign-in " + e.Message); return false; }
    }

    /// <summary>Whether Windows Firewall has Prism's rule for the installed exe (read without administrator rights).</summary>
    public static bool FirewallRuleInPlace()
    {
        try
        {
            var t = Type.GetTypeFromProgID("HNetCfg.FwPolicy2");
            if (t is null) return false;
            dynamic policy = Activator.CreateInstance(t)!;
            foreach (dynamic r in policy.Rules)
            {
                string? name = r.Name, app = r.ApplicationName;
                if (name == FirewallRuleName && string.Equals(app, Updates.InstallExe, StringComparison.OrdinalIgnoreCase) && (bool)r.Enabled) return true;
            }
        }
        catch { }
        return false;
    }

    /// <summary>The rule and, if asked, Remote Desktop Support, under one Windows prompt. True when everything asked for is in place after.</summary>
    public static async Task<bool> SetUpAsync(bool firewall, bool remoteDesktop, Action<string> log)
    {
        if (!firewall && !remoteDesktop) return true;
        var steps = new List<string>();
        MediaHub.TaskDefinition? def = null;
        try
        {
            if (firewall)
            {
                var exe = Updates.InstallExe;
                steps.Add("netsh advfirewall firewall delete rule name=\"" + FirewallRuleName + "\" >nul 2>&1");
                steps.Add("netsh advfirewall firewall add rule name=\"" + FirewallRuleName + "\" dir=in action=allow program=\"" + exe + "\" protocol=TCP localport=" + RemotePort
                          + " remoteip=localsubnet profile=any enable=yes description=\"Lets phones on this home network reach Prism's remote. Added by Prism's setup.\"");
            }
            if (remoteDesktop)
            {
                def = MediaHub.WriteTaskDefinition();
                steps.Add("schtasks /Create /TN \"" + MediaHub.TaskName + "\" /XML \"" + def.Path + "\" /F");
            }
            var psi = new ProcessStartInfo("cmd.exe", "/c " + string.Join(" & ", steps)) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
            using var p = Process.Start(psi);
            if (p is null) return false;
            await p.WaitForExitAsync();
        }
        catch (Exception e) { log("setup: Windows did not allow it (" + e.Message + ")"); return false; }
        finally { def?.Dispose(); }
        var fwOk = !firewall || FirewallRuleInPlace();
        var rdOk = !remoteDesktop || await MediaHub.RefreshAsync(force: true);
        log("setup: firewall rule " + (firewall ? (fwOk ? "added" : "not added") : "not asked") + ", Remote Desktop Support " + (remoteDesktop ? (rdOk ? "on" : "not turned on") : "not asked"));
        return fwOk && rdOk;
    }
}
