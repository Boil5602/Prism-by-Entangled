using System.Reflection;

namespace PrismHost;

/// <summary>
/// The app's version as people read it (2026-09-28, "Are we tracking a version number for the windows app?" - it read 1.0.0 whatever the build):
/// the project's Version plus the commit it was built from, "0.1.0+fa7090c". A Debug build says so.
/// </summary>
public static class AppVersion
{
    public static string Text { get; } = Read();

    private static string Read()
    {
        var info = typeof(AppVersion).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "";
        var plus = info.IndexOf('+');
        var text = plus < 0 ? (info.Length > 0 ? info : "dev") : info[..plus] + "+" + info[(plus + 1)..Math.Min(info.Length, plus + 8)];
#if DEBUG
        text += " (debug)";
#endif
        return text;
    }
}
