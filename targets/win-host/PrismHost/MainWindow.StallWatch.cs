namespace PrismHost;

/// <summary>
/// The window's own thread, watched for stalls (2026-09-28): a tick every 100 ms on the UI thread; one that comes late by more than a third of
/// a second means the thread was busy and clicks were waiting, and host.log says so - - among the lines that name what ran.
/// Diagnostics only; it changes nothing.
/// </summary>
public sealed partial class MainWindow
{
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _stallWatch;   // held: a timer nobody holds is collected and never fires
    private const int StallTickMs = 100, StallLogMs = 350;

    private void StartStallWatch()
    {
        _stallWatch = DispatcherQueue.CreateTimer();
        _stallWatch.Interval = TimeSpan.FromMilliseconds(StallTickMs);
        _stallWatch.IsRepeating = true;
        var last = Environment.TickCount64;
        _stallWatch.Tick += (_, __) =>
        {
            var now = Environment.TickCount64;
            var late = now - last - StallTickMs;
            last = now;
            if (late >= StallLogMs) LogLine($"ui stall {late} ms");
        };
        _stallWatch.Start();
    }
}
