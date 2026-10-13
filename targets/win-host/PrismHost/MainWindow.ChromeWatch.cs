using System.Text.Json.Nodes;
using Microsoft.UI.Dispatching;

namespace PrismHost;

/// <summary>
/// The page chrome watch (2026-10-11, "find where adapters and examples of end user behaviors may be bringing websites and chrome into
/// the video players"): every fifteen seconds each video window's page is asked, in its own words, whether its video fills the window
/// and what stands over its middle. The answer is logged when it changes, one line a window:
///
///   page chrome youtube-tv-home-16x9-XL-w2: page, video 0%, /feed/library "Library - YouTube TV"
///   page chrome screen: overlay, video 100%, over DIV.profile-gate "Who's watching?"
///   page chrome screen: video, 100%
///
/// video: the video fills most of the window. page: it does not (a home page, a title page, a sign-in page, an error). overlay: the
/// video is there but something else holds the middle of the window with words on it (a gate, a prompt, a banner). A player's own
/// control bar over a paused video has no words at the middle and reads as video. The hourly check sums the page and overlay time
/// per window (scripts/breakwatch/hourly.py); five days of the break watch's recordings had been swept first (scripts/breakwatch/
/// chrome_sweep.py) and showed none on YouTube TV, which is the only service those recordings cover. Nothing leaves the PC: the
/// line is host.log's. The words logged are the page's own at the middle of the window, cut to sixty characters.
/// </summary>
public sealed partial class MainWindow
{
    private DispatcherQueueTimer? _chromeWatch;
    private readonly Dictionary<string, string> _chromeLast = new();
    private const string ChromeProbeJs =
        "(function(){try{var W=innerWidth,H=innerHeight;if(!W||!H)return JSON.stringify({err:'no size'});var vs=[].slice.call(document.querySelectorAll('video'));var best=null,ba=0;" +
        "vs.forEach(function(v){var r=v.getBoundingClientRect();var a=Math.max(0,Math.min(r.right,W)-Math.max(r.left,0))*Math.max(0,Math.min(r.bottom,H)-Math.max(r.top,0));if(a>ba){ba=a;best=v}});" +
        "var fill=Math.round(100*ba/(W*H));var el=document.elementFromPoint(W/2,H/2);var over='',txt='';" +
        "if(el&&best&&el!==best&&!best.contains(el)){var t=(el.innerText||'').trim().replace(/\\s+/g,' ');if(t){over=(el.tagName+(typeof el.className==='string'&&el.className?'.'+el.className.trim().split(/\\s+/).slice(0,2).join('.'):'')).slice(0,50);txt=t.slice(0,60)}}" +
        "return JSON.stringify({fill:fill,age:Math.round(performance.now()),playing:!!(best&&!best.paused&&!best.ended),over:over,txt:txt,path:location.pathname.slice(0,60),title:(document.title||'').slice(0,60)})}catch(e){return JSON.stringify({err:String(e).slice(0,80)})}})()";

    private void StartChromeWatch()
    {
        _chromeWatch = DispatcherQueue.CreateTimer();
        _chromeWatch.Interval = TimeSpan.FromSeconds(15);
        _chromeWatch.IsRepeating = true;
        var busy = false;
        _chromeWatch.Tick += async (_, __) =>
        {
            if (busy) return;
            busy = true;
            try { await ChromeWatchTickAsync(); }
            catch (Exception ex) { LogLine("page chrome: " + ex.GetType().Name + ": " + ex.Message); }
            finally { busy = false; }
        };
        _chromeWatch.Start();
    }

    private async Task ChromeWatchTickAsync()
    {
        JsonArray? wins = null;
        try { wins = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray; } catch { }
        if (wins is null) return;
        var seen = new HashSet<string>();
        foreach (var w in wins.OfType<JsonObject>())
        {
            var id = w["id"]?.GetValue<string>() ?? "";
            if (id.Length == 0) continue;
            seen.Add(id);
            var raw = await _surfaces.EvalOnTileAsync(id, ChromeProbeJs);
            if (raw is null || raw.StartsWith("__prism_eval_error", StringComparison.Ordinal)) continue;
            JsonObject? a = null;
            try { var inner = JsonNode.Parse(raw); a = JsonNode.Parse(inner?.GetValue<string>() ?? "null") as JsonObject; } catch { }
            if (a is null) continue;
            if (a["err"] is not null) continue;
            var fill = a["fill"]?.GetValue<int>() ?? 0;
            var over = a["over"]?.GetValue<string>() ?? "";
            var txt = a["txt"]?.GetValue<string>() ?? "";
            var path = a["path"]?.GetValue<string>() ?? "";
            var title = a["title"]?.GetValue<string>() ?? "";
            var state = fill < 60 ? "page" : over.Length > 0 ? "overlay" : "video";
            // a page in its first minute is still loading (every restart showed as page chrome, 2026-10-11): not a reading yet
            if (state != "video" && (a["age"]?.GetValue<double>() ?? 999999) < 60000) continue;
            var line = state switch
            {
                "page" => "page, video " + fill + "%, " + path + " \"" + title + "\"",
                "overlay" => "overlay, video " + fill + "%, over " + over + " \"" + txt + "\"",
                _ => "video, " + fill + "%",
            };
            // logged when the state or the page changes, not the fill's wobble
            var key = state + "|" + (state == "video" ? "" : path + "|" + over);
            if (_chromeLast.TryGetValue(id, out var was) && was == key) continue;
            _chromeLast[id] = key;
            LogLine("page chrome " + id + ": " + line);
        }
        foreach (var gone in _chromeLast.Keys.Where(k => !seen.Contains(k)).ToList()) _chromeLast.Remove(gone);
    }
}
