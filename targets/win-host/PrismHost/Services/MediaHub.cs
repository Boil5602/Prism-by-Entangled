using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace PrismHost.Services;

/// <summary>
/// The media hub switch (docs/features/media-hub.md, 2026-10-05, "How do we prevent windows from taking audio devices away from prism?
/// That needs to be programmed around as though prism is also a media hub"): when a Remote Desktop connection to this PC is closed,
/// Windows leaves the sign-in session off the console and takes every audio device away from it - Prism goes dark and silent, a phone
/// listening hears level-zero frames. Windows itself cannot be told otherwise; what can be done is to put the session back on the console
/// the moment the remote desktop leaves. That is one scheduled task (Windows' own tscon on the session-disconnect trigger), registered and
/// removed here through one UAC prompt each way. Off by default: a PC whose console comes back signed in is the person's choice.
/// </summary>
public static class MediaHub
{
    public const string TaskName = "Prism keep the console";
    /// <summary>The switch's name everywhere it shows (2026-10-06, "Can the 'Keep the sound and the screen ... remote desktop .. On' actually show
    /// 'Remote Desktop Support: On' with a tooltip explaining what it does").</summary>
    public const string MenuLabel = "Remote Desktop Support";
    /// <summary>What the switch does, for the tooltips.</summary>
    public const string Explain = "When a Remote Desktop connection to this PC is closed, Windows takes the sound and the screen away from this sign-in, so Prism goes silent and dark. With Remote Desktop Support on, Prism puts the session back on the PC's own screen the moment the remote desktop leaves, and Prism carries on. The PC's screen then shows the desktop signed in, not the sign-in screen.";

    /// <summary>The switch as last read (the scheduled task exists); refreshed at the menu and when the phone asks.</summary>
    public static bool On { get; private set; }
    private static DateTime _readAt = DateTime.MinValue;

    // The task carries its script INLINE (-EncodedCommand) and the XML it is registered from lives only for the moment of registration in a
    // temp file: a script file in the person's own folder run as SYSTEM would let anything running as the person edit it and become SYSTEM
    // at the next remote disconnect (the commit's security review, 2026-10-05). The registered definition lives in Windows' own task store.

    /// <summary>Reads whether the task exists (no elevation needed); at most once a minute unless forced.</summary>
    public static async Task<bool> RefreshAsync(bool force = false)
    {
        if (!force && DateTime.Now - _readAt < TimeSpan.FromMinutes(1)) return On;
        _readAt = DateTime.Now;
        // the task's key in Windows' task cache (2026-10-06, "It has me enable it, but when I go back it still says off"): a task that runs as
        // SYSTEM cannot be listed by the person's own process - schtasks /Query answered "Access is denied" and that read as no task. The key
        // tells the two apart in any language: there and protected (a security refusal) is on, absent is off.
        await Task.Yield();
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Schedule\TaskCache\Tree\" + TaskName);
            On = key is not null;
        }
        catch (System.Security.SecurityException) { On = true; }
        catch (UnauthorizedAccessException) { On = true; }
        catch { /* the last reading stands */ }
        return On;
    }

    /// <summary>Registers the task (one UAC prompt). False when Windows did not allow it or the task did not register.</summary>
    public static async Task<bool> TurnOnAsync(Action<string> log)
    {
        bool ok;
        try
        {
            using var def = WriteTaskDefinition();
            ok = await ElevatedAsync("/Create /TN \"" + TaskName + "\" /XML \"" + def.Path + "\" /F", log);
        }
        catch (Exception e) { log("media hub: could not write the task definition: " + e.Message); return false; }
        await RefreshAsync(force: true);
        log("media hub: keep the console " + (ok && On ? "on" : "not turned on"));
        return ok && On;
    }

    /// <summary>Removes the task (one UAC prompt).</summary>
    public static async Task<bool> TurnOffAsync(Action<string> log)
    {
        var ok = await ElevatedAsync("/Delete /TN \"" + TaskName + "\" /F", log);
        await RefreshAsync(force: true);
        log("media hub: keep the console " + (ok && !On ? "off" : "not turned off"));
        return ok && !On;
    }

    private static async Task<bool> ElevatedAsync(string args, Action<string> log)
    {
        try
        {
            var psi = new ProcessStartInfo("schtasks.exe", args) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
            using var p = Process.Start(psi);
            if (p is null) return false;
            await p.WaitForExitAsync();
            if (p.ExitCode != 0) log("media hub: schtasks " + args.Split(' ')[0] + " answered " + p.ExitCode);
            return p.ExitCode == 0;
        }
        catch (Exception e) { log("media hub: Windows did not allow it (" + e.Message + ")"); return false; }   // the UAC prompt declined: 1223
    }

    /// <summary>The task's definition in a temp file, held open with no write or delete sharing from the moment it is written until Windows'
    /// elevated schtasks has read it, so no other program running as the person can swap it in between (2026-10-06); deleted on dispose.</summary>
    public sealed class TaskDefinition : IDisposable
    {
        public string Path { get; }
        private readonly FileStream _hold;
        internal TaskDefinition(string path, FileStream hold) { Path = path; _hold = hold; }
        public void Dispose() { try { _hold.Dispose(); } catch { } try { File.Delete(Path); } catch { } }
    }
    public static TaskDefinition WriteTaskDefinition()
    {
        var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "prism-keep-console-" + Guid.NewGuid().ToString("N") + ".xml");
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(Script(Environment.UserName)));
        var bytes = Encoding.Unicode.GetPreamble().Concat(Encoding.Unicode.GetBytes(TaskXml(encoded))).ToArray();   // schtasks reads it as Unicode, as its header says
        var fs = new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read);
        fs.Write(bytes); fs.Flush(true);
        return new TaskDefinition(path, fs);
    }

    /// <summary>What the task runs: the person's own session, found disconnected, put back on the console.</summary>
    private static string Script(string user) => """
        # Prism: put this PC's sign-in session back on its own screen after a Remote Desktop connection leaves
        # (docs/features/media-hub.md). Windows takes every audio device away from a disconnected session; Prism
        # on the console keeps its sound and its screen. Registered by Prism's menu, inline in the task; removed there too.
        $me = '__USER__'
        Start-Sleep -Milliseconds 1500
        $lines = & query session 2>$null
        foreach ($line in $lines) {
          if ($line -match ('^\s*(\S+\s+)?' + [regex]::Escape($me) + '\s+(\d+)\s+Disc')) { & tscon $matches[2] /dest:console; break }
        }
        """.Replace("__USER__", user.Replace("'", "''"));

    /// <summary>The task: on any remote disconnect, as SYSTEM, the script above inline (base64 of its UTF-16); a minute at most.</summary>
    private static string TaskXml(string encodedScript) => """
        <?xml version="1.0" encoding="UTF-16"?>
        <Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
          <RegistrationInfo>
            <Description>Prism: puts the sign-in session back on this PC's screen when a Remote Desktop connection leaves, so Prism keeps its sound and its screen. Turned on and off from Prism's menu.</Description>
          </RegistrationInfo>
          <Triggers>
            <SessionStateChangeTrigger>
              <Enabled>true</Enabled>
              <StateChange>RemoteDisconnect</StateChange>
            </SessionStateChangeTrigger>
          </Triggers>
          <Principals>
            <Principal id="Author">
              <UserId>S-1-5-18</UserId>
              <RunLevel>HighestAvailable</RunLevel>
            </Principal>
          </Principals>
          <Settings>
            <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
            <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
            <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
            <AllowHardTerminate>true</AllowHardTerminate>
            <StartWhenAvailable>false</StartWhenAvailable>
            <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
            <AllowStartOnDemand>true</AllowStartOnDemand>
            <Enabled>true</Enabled>
            <Hidden>false</Hidden>
            <RunOnlyIfIdle>false</RunOnlyIfIdle>
            <ExecutionTimeLimit>PT1M</ExecutionTimeLimit>
            <Priority>7</Priority>
          </Settings>
          <Actions Context="Author">
            <Exec>
              <Command>powershell.exe</Command>
              <Arguments>-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand __SCRIPT__</Arguments>
            </Exec>
          </Actions>
        </Task>
        """.Replace("__SCRIPT__", encodedScript);

    // ---- this process's own session: connected to a screen, or left behind by a remote desktop

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQuerySessionInformationW(IntPtr hServer, int sessionId, int infoClass, out IntPtr buffer, out int bytes);
    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr buffer);
    private const int WtsConnectState = 8, WtsCurrentSession = -1, WtsDisconnected = 4;

    /// <summary>True when this session is attached to no console and no remote desktop client (Windows then has no audio device for it).</summary>
    public static bool SessionDisconnected()
    {
        try
        {
            if (!WTSQuerySessionInformationW(IntPtr.Zero, WtsCurrentSession, WtsConnectState, out var buf, out var n) || n < 4) return false;
            try { return Marshal.ReadInt32(buf) == WtsDisconnected; } finally { WTSFreeMemory(buf); }
        }
        catch { return false; }
    }
}
