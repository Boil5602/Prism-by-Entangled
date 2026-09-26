using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;

namespace PrismHost;

/// <summary>
/// The playback doctor's voice on the wall (2026-09-23, "can you see what can be done to autodetect and autorecover from video playback
/// errors?"). Core watches every video window on its title and reopens it when the page errs, never starts, freezes or loses its player
/// (video.ts, DOCTOR_*); the host only says so - a pill when a window is reopened, with the page's own words and the try, and when core has
/// stopped trying and the failure is left for the person's Retry. Reads videoState every few seconds; decides nothing.
/// </summary>
public sealed partial class MainWindow
{
    private DispatcherTimer? _doctorTimer;
    private readonly Dictionary<string, double> _doctorSaid = new();

    private void InitPlaybackDoctor()
    {
        _doctorTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        _doctorTimer.Tick += async (_, __) => await DoctorTickAsync();
        _doctorTimer.Start();
        // B-289: back from a minimize, every window presents afresh (the same empty frames as after Watch, B-295)
        AppWindow.Changed += (_, e) =>
        {
            if (!e.DidPresenterChange && !e.DidSizeChange && !e.DidVisibilityChange) return;
            var minimized = AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter op && op.State == Microsoft.UI.Windowing.OverlappedPresenterState.Minimized;
            if (_wasMinimized && !minimized) _surfaces.NudgeSoon();
            _wasMinimized = minimized;
        };
    }
    private bool _wasMinimized;

    private async Task DoctorTickAsync()
    {
        JsonArray? vs = null;
        try { vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray; } catch { return; }
        if (vs is null) return;
        foreach (var t in vs.OfType<JsonObject>())
        {
            var id = t["id"]?.GetValue<string>();
            if (id is null || t["recovering"] is not JsonObject rec) continue;
            var at = rec["at"] is JsonValue av && av.TryGetValue<double>(out var a) ? a : 0;
            if (_doctorSaid.TryGetValue(id, out var said) && said == at) continue;
            _doctorSaid[id] = at;
            var why = rec["why"]?.GetValue<string>() ?? "the video stopped";
            var attempt = rec["attempt"] is JsonValue nv && nv.TryGetValue<int>(out var n) ? n : 1;
            var gaveUp = rec["gaveUp"]?.GetValue<bool>() == true;
            var name = (t["pending"] as JsonObject)?["name"]?.GetValue<string>() ?? (t["video"] as JsonObject)?["title"]?.GetValue<string>() ?? "the video";
            var svc = t["adapter"]?.GetValue<string>() ?? "";
            SetPill("Prism \u00B7 " + (svc.Length > 0 ? svc + ": " : "") + Shorten(why, 60) + (gaveUp
                ? " - tried " + attempt + (attempt == 1 ? " time" : " times") + "; Retry is on Watch"
                : " - reopening " + Shorten(name, 36) + " (try " + attempt + " of 2)"));
            LogLine("playback doctor " + id + ": " + (gaveUp ? "gave up" : "try " + attempt) + " - " + why);
        }
    }
}
