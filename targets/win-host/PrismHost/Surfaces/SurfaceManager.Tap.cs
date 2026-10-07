namespace PrismHost.Surfaces;

/// <summary>
/// The window taps (2026-10-06, "there could be 10 people private listening, in which case they should each hear whatever they have
/// selected in the companion app"): every service plays in one shared browser, whose sound the system hands over as one mix, so a phone's
/// own window is read in that window's page instead. The page's player is routed through the page's own audio graph - on to its speakers as
/// before, and to a reader that posts its samples to the host (16-bit stereo, 48 kHz, about 85 ms a message). The reader sits before the
/// page's mute, so a window the room does not hear can still be heard on a phone. The player's source is shared with the YouTube TV
/// adapter's level meter (window.__prismAudio): a player can be routed into a page's audio graph only once. Read on a DRM-protected YouTube TV window: its sound
/// comes through (2026-10-06, peak 0.15 on a muted window). Started on the windows phones listen to, stopped when none does; a page that
/// navigates is tapped again on the next look.
/// </summary>
public sealed partial class SurfaceManager
{
    /// <summary>A window's tap: its id and 16-bit stereo PCM at 48 kHz.</summary>
    public event Action<string, byte[]>? TapFrames;
    private HashSet<string> _tapsWanted = new();

    private const string TapStartJs = @"(function(){var T=window.__prismTap;if(T&&T.proc){T.on=true;return 'on';}
var A=window.__prismAudio=window.__prismAudio||{ctx:null,src:new WeakMap()};T=window.__prismTap=T||{on:true,ctx:null,cur:null,proc:null};T.on=true;
function main(){var vs=[].filter.call(document.querySelectorAll('video,audio'),function(v){return !v.paused&&v.currentTime>0&&(v.tagName==='AUDIO'||v.getBoundingClientRect().width>40);});
vs.sort(function(a,b){return b.getBoundingClientRect().width-a.getBoundingClientRect().width;});return vs[0]||null;}
function send(e){if(!T.on)return;var b=e.inputBuffer,n=b.length,L=b.getChannelData(0),R=b.numberOfChannels>1?b.getChannelData(1):L;var out=new Int16Array(n*2);
for(var i=0;i<n;i++){var l=L[i],r=R[i];l=l>1?1:l<-1?-1:l;r=r>1?1:r<-1?-1:r;out[2*i]=l*32767;out[2*i+1]=r*32767;}
var u8=new Uint8Array(out.buffer),s='';for(var j=0;j<u8.length;j+=32768)s+=String.fromCharCode.apply(null,u8.subarray(j,j+32768));
try{window.chrome.webview.postMessage(JSON.stringify({type:'prism-tap',pcm:btoa(s)}));}catch(x){}}
function attach(){var v=main();if(!v||v===T.cur)return;try{if(!A.ctx)A.ctx=new AudioContext({sampleRate:48000});T.ctx=A.ctx;
var src=A.src.get(v);if(!src){src=T.ctx.createMediaElementSource(v);src.connect(T.ctx.destination);A.src.set(v,src);}
if(!T.proc){T.proc=T.ctx.createScriptProcessor(4096,2,2);var g=T.ctx.createGain();g.gain.value=0;T.proc.connect(g);g.connect(T.ctx.destination);T.proc.onaudioprocess=send;}
if(T.cur&&A.src.get(T.cur)){try{A.src.get(T.cur).disconnect(T.proc);}catch(x){}}
src.connect(T.proc);T.cur=v;if(T.ctx.state!=='running')T.ctx.resume();}catch(x){T.err=String(x);}}
attach();if(!T.timer)T.timer=setInterval(function(){if(T.on)attach();},2000);return 'started';})()";
    private const string TapStopJs = "(function(){if(window.__prismTap)window.__prismTap.on=false;return 'off';})()";

    /// <summary>The windows to tap now: started where wanted (again on every call, so a page that navigated is tapped anew), stopped elsewhere.</summary>
    public void SetTaps(HashSet<string> want)
    {
        var was = _tapsWanted;
        _tapsWanted = new HashSet<string>(want);
        foreach (var id in want) _ = RunTapAsync(id, TapStartJs, !was.Contains(id));
        foreach (var id in was) if (!want.Contains(id)) _ = RunTapAsync(id, TapStopJs, true);
    }
    /// <summary>Every few seconds while phones listen: the taps asked for again (idempotent; a navigated page has lost its tap).</summary>
    public void RefreshTaps() { foreach (var id in _tapsWanted) _ = RunTapAsync(id, TapStartJs, false); }

    private async Task RunTapAsync(string id, string js, bool log)
    {
        if (Get(id)?.View?.CoreWebView2 is not { } core) return;
        try { var r = await core.ExecuteScriptAsync(js); if (log || r.Contains("started")) _onStatus("listen tap " + id + ": " + r.Trim('"')); }
        catch (Exception ex) { _onStatus("listen tap " + id + ": " + ex.Message); }
    }

    /// <summary>A page's message that is a tap's samples: handled here, never core's.</summary>
    private bool TryTap(string tileId, string json)
    {
        if (!json.StartsWith("{\"type\":\"prism-tap\"", StringComparison.Ordinal)) return false;
        var at = json.IndexOf("\"pcm\":\"", StringComparison.Ordinal);
        var end = json.LastIndexOf('"');
        if (at < 0 || end <= at + 7) return true;
        try { TapFrames?.Invoke(tileId, Convert.FromBase64String(json.Substring(at + 7, end - at - 7))); } catch { }
        return true;
    }
}
