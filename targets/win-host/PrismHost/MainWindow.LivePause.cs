using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace PrismHost;

/// <summary>
/// A live channel its service cannot pause (2026-10-06):
/// core says so per tile (can.pause, from the adapter's livePause); Pause is drawn dim with the reason in its tooltip, and a press - the bar's,
/// a window's, the keyboard's or a remote's - says the channel can't be paused and offers Mute beside it.
/// </summary>
public sealed partial class MainWindow
{
    private const string CannotPauseTip = "Live TV on this service can't be paused. Press to mute it instead.";

    /// <summary>Can this tile's player pause now? Core's word, read at the press (a channel can start or end between draws).</summary>
    private async Task<bool> CanPauseAsync(string tile)
    {
        try
        {
            var vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray;
            var t = vs?.OfType<JsonObject>().FirstOrDefault(x => x["id"]?.GetValue<string>() == tile);
            return (t?["can"] as JsonObject)?["pause"]?.GetValue<bool>() != false;
        }
        catch { return true; }
    }

    private void SayCannotPause(string tile)
    {
        LogLine("live pause: " + tile + " cannot pause, Mute offered");
        if (_wallMuted) { SetPill("Prism" + Mid + "live TV on this service can't be paused. The sound is already off."); return; }
        ShowPillOffer("Prism" + Mid + "live TV on this service can't be paused. Mute it instead?", "Mute", () => SetWallMutedFromWall(tile, true), 12);
    }
}
