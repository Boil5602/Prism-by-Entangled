using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.UI.Xaml;
using PrismHost.Services;

namespace PrismHost;

/// <summary>
/// The break watch (2026-10-06): YouTube TV's live channels carry the channel's own commercials inside the stream, and neither the page
/// nor its traffic says when one plays. Every two seconds each YouTube TV window's picture is scored by its <see cref="BreakModel"/>
/// (the channel's logo, cuts to black, what the screen says, how long things run), and a break it is sure of is sent on as the page's
/// own ad-break signal would be - the same cover, mute and card as every other service. Off with Watch settings' break watch.
/// The logos it learns are kept per channel in the data folder (breakwatch\), so the next time a channel is tuned it is known at once.
/// </summary>
public sealed partial class MainWindow
{
    private sealed class BreakWatchState
    {
        public required BreakModel Model;
        public required string Channel;
        public int Ticks;
        public double LastT;
        public bool SetAside;
        public double FrozenAskedAt = -999;
        public long EdgeStart, EdgeEnd; public string ChannelName = ""; public double EdgesAt = -999;
        public readonly Queue<string> Recent = new();   // the last 40 looks' readings, for a report
        public readonly List<uint> Sound = new();       // the sound's fingerprint words, the last 20 s
        public readonly List<(double At, uint W)> BreakSound = new();   // a sure break's words, kept when it ends
        public readonly Queue<(double At, ulong[] Fp)> PendingPrints = new();
        public int Skips;   // a quiet small window's skipped looks
        // the last two minutes of pictures and sound, each with whether the logo was away: when a break is confirmed, its opening is learned
        // too (2026-10-07, "With the ad fingerprints, can't we tighten these known ads up?" - Domino's was known only 14 s in, because a break's
        // first fifteen seconds were never taught)
        public readonly Queue<(double At, ulong[] Fp, bool Away)> RecentPrints = new();
        public readonly Queue<(double At, uint W, bool Away)> RecentSound = new();
        public bool Backfilled;
        // the break being taught: its clip in the library and when it began, so each picture keeps its place (a run of them is an ad playing)
        public int Clip; public double ClipStart;
        public readonly PrintRuns Runs = new();
    }

    private DispatcherTimer? _breakWatch;
    private readonly Dictionary<string, BreakWatchState> _watches = new();
    private readonly Stopwatch _watchClock = Stopwatch.StartNew();
    private bool _watching;
    private long _lookMs; private int _looks;
    private Windows.Media.Ocr.OcrEngine? _ocr;
    private bool _ocrTried;

    private static bool BreakWatchOn => HostPrefs.GetBool("video.breakWatch", true);
    private static string BreakWatchDir => Path.Combine(HostPaths.DataDir, "breakwatch");

    /// <summary>The break watch's cover on a window lifted by the person's word, and none there for five minutes (the cover's Not an ad, and
    /// Ad debug's, 2026-10-07: "it isn't an ad but intermission shows on" - five presses of Ad debug's Not an ad only reported).</summary>
    private bool DismissBreak(string id, out BreakWatchState st, out double now)
    {
        now = _watchClock.Elapsed.TotalSeconds;
        if (_surfaces is null || !_watches.TryGetValue(id, out st!)) { st = null!; return false; }
        st.PendingPrints.Clear();
        st.Model.Dismiss(now);
        _surfaces.WatchAdBreak(id, false);
        _surfaces.SetNotAnAd(id, false);
        LogLine("break watch " + id + ": the person said Not an ad (" + st.ChannelName + ") - uncovered, no cover here for five minutes");
        return true;
    }

    private void InitBreakWatch()
    {
        _notAdHandler = id =>
        {
            if (!DismissBreak(id, out var st, out var now)) return;
            Correction(id, st.ChannelName, "not an ad");
            Bench(id, now, null, "notanad");
            ShowNotAdReport(id, st.ChannelName, st.Recent.ToList());
        };
        // a look a second (2026-10-06: two seconds made each break's start wait longer; the screen's words then cover at once)
        _breakWatch = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _breakWatch.Tick += async (_, __) =>
        {
            if (_watching) return;
            _watching = true;
            var sw = Stopwatch.StartNew();
            try { await BreakWatchTickAsync(); }
            catch (Exception e) { LogLine("break watch: " + e.Message); }
            finally { _watching = false; _lookMs += sw.ElapsedMilliseconds; if (++_looks % 60 == 0) { LogLine("break watch: a look takes " + (_lookMs / 60) + " ms on average"); _lookMs = 0; } }
        };
        _breakWatch.Start();
    }

    private Action<string>? _notAdHandler;
    private bool _notAdWired;
    private async System.Threading.Tasks.Task BreakWatchTickAsync()
    {
        if (_surfaces is null) return;
        if (!_notAdWired && _notAdHandler is not null) { _surfaces.NotAnAdPressed += _notAdHandler; _notAdWired = true; }   // the surfaces are made after the watch starts
        var ids = BreakWatchOn ? _surfaces.TilesAt("tv.youtube.com/watch") : new List<string>();
        // a window that left YouTube TV (or the watch was turned off): its break, if one was called, ends with it
        foreach (var gone in _watches.Keys.Where(k => !ids.Contains(k)).ToList())
        {
            var st = _watches[gone];
            if (st.Model.Active) _surfaces.WatchAdBreak(gone, false);
            st.Model.Save(ModelPath(st.Channel));
            _watches.Remove(gone);
        }
        var bigId = _surfaces.BigWindowId();
        foreach (var id in ids)
        {
            var channel = ChannelOf(_surfaces.SourceOf(id));
            if (channel is null) continue;
            if (!_watches.TryGetValue(id, out var st) || st.Channel != channel)
            {
                if (st is not null)
                {
                    if (st.Model.Active) _surfaces.WatchAdBreak(id, false);
                    st.Model.Save(ModelPath(st.Channel));
                }
                st = new BreakWatchState { Model = BreakModel.Load(ModelPath(channel)), Channel = channel };
                _watches[id] = st;
                LogLine("break watch " + id + ": channel " + channel + (st.Model.HasLogo ? " (logo known)" : " (learning its logo)"));
                // in a break when Prism closed a moment ago, on this channel: the cover goes straight back up
                if (st.Model.HasLogo && BreakWasUp(id, channel)) { st.Model.ResumeBreak(_watchClock.Elapsed.TotalSeconds); _surfaces.WatchAdBreak(id, true); _surfaces.SetNotAnAd(id, true); LogLine("break watch " + id + ": the break that was up before the restart is covered again"); }
                Bench(id, _watchClock.Elapsed.TotalSeconds, null, "channel " + channel);
            }
            // the big window first (2026-10-07, "Are we able to prioritize the big window's throughput over the others?"): a quiet small window
            // is looked at every other second, every second once a break is up or its chance is rising. With Ad debug on, every window every
            // second ("Can we just include the extra screenshotting and performance hit when the Ad debug mode is enabled")
            if (!s_adDebug && id != bigId && !st.Model.Active && st.Model.Chance < 0.2 && (st.Skips++ % 2 == 1)) continue;
            var withText = st.Ticks % 2 == 0;   // the text reader every other look: every two seconds a window (four on a quiet small one)
            var shot = await _surfaces.CaptureForWatchAsync(id, withText);
            if (shot is null) continue;
            var now = _watchClock.Elapsed.TotalSeconds;
            var dt = st.LastT > 0 ? Math.Clamp(now - st.LastT, 0.5, 6) : 2;
            st.LastT = now;
            Bench(id, now, shot.Value.Gray, null);
            if (shot.Value.BigGray is { } bg && st.Model.Qr(bg, 960, 540, now))
            {
                Bench(id, now, null, "qr");
                LogLine("break watch " + id + ": a QR code on screen" + (st.Model.Active ? " (in a break)" : ""));
            }
            if (shot.Value.Big is { } big)
            {
                try
                {
                    var said = await ReadScreenAsync(big);
                    if (said is { Length: > 0 }) Bench(id, now, null, "text " + said.Replace('\n', ' '));
                    // every reading that counted is logged (how soon a break puts its words up is what the four-minute rule is tuned on)
                    if (said is { Length: > 0 } && st.Model.Text(said, now) is { } why)
                        LogLine("break watch " + id + ": screen says " + why + (st.Model.Active ? " (in a break)" : ""));
                }
                finally { big.Dispose(); }
            }
            // the sound's level (the adapter's meter): its silences are cuts; and whether the player plays, for the freeze check below
            var playing = false;
            try
            {
                var lraw = await _surfaces.EvalOnTileAsync(id, "window.__prismLevel ? window.__prismLevel() : ''");
                if (lraw is { Length: > 2 } && !lraw.StartsWith("__prism", StringComparison.Ordinal) && System.Text.Json.JsonSerializer.Deserialize<string>(lraw) is { Length: > 2 } lj)
                {
                    using var ld = System.Text.Json.JsonDocument.Parse(lj);
                    var lr = ld.RootElement;
                    playing = lr.TryGetProperty("paused", out var pz) && pz.ValueKind == System.Text.Json.JsonValueKind.False;
                    // the sound's fingerprint (AdSounds): matched against the ads heard before; a sure break's words are kept as it goes
                    if (lr.TryGetProperty("afp", out var af) && af.GetString() is { Length: >= 8 } hex)
                    {
                        Bench(id, now, null, "afp " + hex);
                        for (var k = 0; k + 8 <= hex.Length; k += 8)
                            if (uint.TryParse(hex.AsSpan(k, 8), System.Globalization.NumberStyles.HexNumber, null, out var w))
                            {
                                st.Sound.Add(w);
                                if (st.Model.LearnableAt(now)) st.BreakSound.Add((now, w));
                                st.RecentSound.Enqueue((now, w, st.Model.LogoAwayNow));
                            }
                        if (st.Sound.Count > 400) st.Sound.RemoveRange(0, st.Sound.Count - 400);
                        if (Sounds.Heard(st.Sound)) st.Model.SoundSeen(now);
                    }
                    if (lr.TryGetProperty("silences", out var ss) && ss.ValueKind == System.Text.Json.JsonValueKind.Array)
                        foreach (var x in ss.EnumerateArray())
                        {
                            var ago = x.GetProperty("ago").GetDouble() / 1000.0; var ms = x.GetProperty("ms").GetDouble();
                            st.Model.Silence(now - ago);
                            Bench(id, now, null, "silence " + ago.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture));
                            LevelLog(id, "silence " + Math.Round(ms) + " ms, " + Math.Round(ago, 1) + " s ago" + (st.Model.Active ? " [covered]" : ""));
                        }
                    if (st.Ticks % 10 == 0 && lr.TryGetProperty("db", out var db) && db.ValueKind == System.Text.Json.JsonValueKind.Number)
                        LevelLog(id, "level " + db.GetDouble() + " dB, peak " + (lr.TryGetProperty("peak", out var pk) && pk.ValueKind == System.Text.Json.JsonValueKind.Number ? pk.GetDouble().ToString() : "?") + (st.Model.Active ? " [covered]" : ""));
                }
            }
            catch { }
            // the captions (the adapter keeps them on, hidden unless the person chose them): their new words read like the screen's
            if (withText)
            {
                try
                {
                    var raw = await _surfaces.EvalOnTileAsync(id, "window.__prismCC ? window.__prismCC() : ''");
                    if (raw is { Length: > 2 } && System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Deserialize<string>(raw) ?? "{}") is { } cj)
                    {
                        var words = cj.RootElement.TryGetProperty("text", out var tw) ? tw.GetString() ?? "" : "";
                        var quiet = cj.RootElement.TryGetProperty("quietMs", out var qm) ? qm.GetDouble() : -1;
                        st.Model.Captions(words, quiet, now);
                        if (words.Length > 0) Bench(id, now, null, "cc " + words);
                        if (words.Length > 0)
                        {
                            if (st.Model.Text(words, now, spoken: true) is { } cwhy) LogLine("break watch " + id + ": captions say " + cwhy + (st.Model.Active ? " (in a break)" : ""));
                            CaptionLog(id, (st.Model.Active ? "[covered] " : "") + words);
                        }
                    }
                }
                catch { }
            }
            // fingerprints: a picture seen in a break before; a picture of a break the watch is sure of is kept
            if (AdPrints.Of(shot.Value.Gray, BreakModel.W, BreakModel.H) is { } fp)
            {
                if (Prints.Seen(fp)) st.Model.PrintSeen(now);
                else if (st.Model.LearnableAt(now)) st.PendingPrints.Enqueue((now, fp));
                // a run of a known break's pictures in order, matched loosely (2026-10-07, "lets proceed with #1"): a known ad at once
                if (st.Runs.Look(now, Prints.Places(fp, PrintRuns.Loose))) { st.Model.PrintSeen(now); st.Model.PrintSeen(now); }
                st.RecentPrints.Enqueue((now, fp, st.Model.LogoAwayNow));
            }
            while (st.RecentPrints.Count > 0 && now - st.RecentPrints.Peek().At > 120) st.RecentPrints.Dequeue();
            while (st.RecentSound.Count > 0 && now - st.RecentSound.Peek().At > 120) st.RecentSound.Dequeue();
            // the break's opening, once an ad has named itself in it: back from now while the logo stayed away (the show's last frames have it),
            // less the first three seconds of that run (a fade, a cut). Only a break the watch is sure of and an ad spoke in teaches, as before.
            if (st.Model.LearnableAt(now) && !st.Backfilled)
            {
                st.Backfilled = true;
                var pics = st.RecentPrints.ToArray();
                var i = pics.Length - 1;
                while (i >= 0 && pics[i].Away) i--;
                var runStart = i + 1 < pics.Length ? pics[i + 1].At : now;
                st.Clip = Prints.NextClip(); st.ClipStart = runStart;
                var taught = 0;
                foreach (var pic in pics)
                    if (pic.Away && pic.At >= runStart + 3 && pic.At < now - 1 && !Prints.Seen(pic.Fp)) { Prints.Learn(pic.Fp, st.Clip, (float)(pic.At - runStart)); taught++; }
                var snd = st.RecentSound.ToArray();
                var j = snd.Length - 1;
                while (j >= 0 && snd[j].Away) j--;
                var sRun = j + 1 < snd.Length ? snd[j + 1].At : now;
                var early = snd.Where(x => x.Away && x.At >= sRun + 3 && !st.BreakSound.Any(b => b.At == x.At)).Select(x => (x.At, x.W)).ToList();
                st.BreakSound.InsertRange(0, early);
                if (taught > 0 || early.Count > 0)
                    LogLine("break watch " + id + ": the break's opening learned (" + taught + " pictures, " + (early.Count / 20) + " s of sound from " + Math.Round(now - runStart) + " s back)");
            }
            // a picture is learned only once the break has gone on twenty seconds past it: the last seconds before a show returns (its rating
            // card, its first shot) are never taught as an ad (FX's TV-14 card matched and covered the film's return 17 s, 2026-10-06 23:08)
            if (!st.Model.Active)
            {
                st.Backfilled = false; st.Clip = 0;
                st.PendingPrints.Clear();
                // the break's sound, all but its last twenty seconds (the show's return), as one known ad stretch
                if (st.BreakSound.Count > 0)
                {
                    var end = st.BreakSound[^1].At;
                    var keep = st.BreakSound.Where(x => x.At <= end - 20).Select(x => x.W).ToList();
                    if (keep.Count >= 64) { Sounds.Learn(keep); LogLine("break watch " + id + ": learned " + (keep.Count / 20) + " s of an ad's sound (" + Sounds.Count + " stretches)"); }
                    st.BreakSound.Clear();
                }
            }
            else while (st.PendingPrints.Count > 0 && now - st.PendingPrints.Peek().At >= 20) { var pp = st.PendingPrints.Dequeue(); Prints.Learn(pp.Fp, st.Clip, st.Clip == 0 ? 0 : (float)(pp.At - st.ClipStart)); }
            {
            }
            // the guide's program on this window, every 30 s (a new program's times as it starts)
            if (now - st.EdgesAt >= 30)
            {
                st.EdgesAt = now;
                try
                {
                    var er = await ModelCallAsync(PrismHost.Channel.HostCalls.VideoProgramEdges, id);
                    if (er is { Length: > 4 } && System.Text.Json.Nodes.JsonNode.Parse(er) is System.Text.Json.Nodes.JsonObject eo)
                    {
                        st.ChannelName = eo["channel"]?.GetValue<string>() ?? "";
                        st.Model.ShowTitle = eo["title"]?.GetValue<string>() ?? "";   // the program on now, by the guide
                        st.EdgeStart = (long)(eo["start"]?.GetValue<double>() ?? 0);
                        st.EdgeEnd = eo["end"] is { } en ? (long)en.GetValue<double>() : 0;
                    }
                }
                catch { }
            }
            var wall = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var near = (st.EdgeStart > 0 && wall - st.EdgeStart < 180_000) || (st.EdgeEnd > 0 && st.EdgeEnd - wall < 75_000)   /* the last 75 s: the end credits; a break running up to the hour is still a break (TBS lost its cover at 2.5 min, 2026-10-07 07:57) */;
            if (near != st.Model.NearEdge) LogLine("break watch " + id + ": " + (near ? "near a program's edge (" + st.ChannelName + ") - only an ad's own words cover" : "away from the program's edges"));
            if (near != st.Model.NearEdge || st.Ticks % 60 == 0) Bench(id, now, null, "edge " + (near ? 1 : 0) + " " + st.ChannelName);
            st.Model.NearEdge = near;
            st.Model.EdgeKnown = st.EdgeStart > 0;
            st.Model.AdFreeChannel = AdFree.IsMatch(st.ChannelName) || ChannelOff(st.ChannelName);   // and the channels the person turned off
            var hadLogo = st.Model.HasLogo;
            var changed = st.Model.Step(shot.Value.Gray, now, dt);
            st.Recent.Enqueue(DateTime.Now.ToString("HH:mm:ss") + " " + st.Model.Chance.ToString("P0") + (st.Model.Active ? " covered" : "") + (st.Model.Why.Length > 0 ? " (" + st.Model.Why + ")" : "") + (st.Model.NearEdge ? " near edge" : ""));
            while (st.Recent.Count > 40) st.Recent.Dequeue();
            st.Ticks++;
            if (st.Model.Suspended != st.SetAside)
            {
                st.SetAside = st.Model.Suspended;
                st.Model.Save(ModelPath(channel));   // kept at once: a restart keeps the channel's logo set aside
                LogLine("break watch " + id + ": " + (st.SetAside ? "the logo has been missing longer than a break; set aside until it is back" : "the logo is back"));
            }
            // a picture that stands still while the player plays is frozen (2026-10-06, "FOX 8, freezes should be detected and video reloaded":
            // it sat on one ad frame for seven minutes): the playback doctor opens it again, at most every two minutes a window
            if (playing && st.Model.StillFor(now) >= 20 && now - st.FrozenAskedAt > 120)
            {
                st.FrozenAskedAt = now;
                var r = await ModelCallAsync(PrismHost.Channel.HostCalls.VideoPictureFrozen, id, Math.Round(st.Model.StillFor(now)));
                LogLine("break watch " + id + ": the picture has stood still " + Math.Round(st.Model.StillFor(now)) + " s while it plays - " + (r ?? "no answer"));
            }
            if (st.Model.Relearned)
            {
                st.Model.Relearned = false;
                try { File.Delete(ModelPath(channel)); } catch { }
                LogLine("break watch " + id + ": the logo for " + channel + " was missing six minutes, learning it again");
            }
            if (!hadLogo && st.Model.HasLogo) { LogLine("break watch " + id + ": logo learned for " + channel); st.Model.Save(ModelPath(channel)); }
            if (changed)
            {
                LogLine("break watch " + id + ": " + (st.Model.Active ? "break" : "show") + " (" + st.Model.Chance.ToString("P0") + "; " + st.Model.Why + ")");
                Bench(id, now, null, st.Model.Active ? "call break" : "call show");
                _surfaces.WatchAdBreak(id, st.Model.Active);
                _surfaces.SetNotAnAd(id, st.Model.Active);
            }
            else if (st.Ticks % 30 == 0)
                LogLine("break watch " + id + ": " + st.Model.Chance.ToString("P0") + (st.Model.Active ? " break" : "") + (st.Model.Why.Length > 0 ? " (" + st.Model.Why + ")" : ""));
            if (st.Ticks % 300 == 0) { st.Model.Save(ModelPath(channel)); Prints.Save(); Sounds.Save(); }   // the learned logo and the ads seen, every five minutes
            if (changed || (st.Model.Active && st.Ticks % 10 == 0)) NoteBreakUp(id, channel, st.Model.Active);   // what a restart resumes
        }
    }

    // the windows in a break, kept on this PC so a restart puts their covers back (breakwatch/up.json: window, channel, when last seen up)
    private static readonly Dictionary<string, (string Channel, long At)> s_breakUp = LoadBreakUp();
    private static string BreakUpPath => Path.Combine(BreakWatchDir, "up.json");
    private static Dictionary<string, (string Channel, long At)> LoadBreakUp()
    {
        var d = new Dictionary<string, (string, long)>();
        try
        {
            if (File.Exists(BreakUpPath) && System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(BreakUpPath)) is System.Text.Json.Nodes.JsonObject o)
                foreach (var (k, v) in o) if (v is System.Text.Json.Nodes.JsonObject e) d[k] = (e["channel"]?.GetValue<string>() ?? "", e["at"]?.GetValue<long>() ?? 0);
        }
        catch { }
        return d;
    }
    private static void NoteBreakUp(string id, string channel, bool up)
    {
        if (up) s_breakUp[id] = (channel, DateTimeOffset.UtcNow.ToUnixTimeSeconds()); else if (!s_breakUp.Remove(id)) return;
        try
        {
            var o = new System.Text.Json.Nodes.JsonObject();
            foreach (var (k, v) in s_breakUp) o[k] = new System.Text.Json.Nodes.JsonObject { ["channel"] = v.Channel, ["at"] = v.At };
            Directory.CreateDirectory(BreakWatchDir);
            File.WriteAllText(BreakUpPath, o.ToJsonString());
        }
        catch { }
    }
    /// <summary>The window was in a break on this channel within the last minute (a restart, not a new day).</summary>
    private static bool BreakWasUp(string id, string channel) =>
        s_breakUp.TryGetValue(id, out var b) && b.Channel == channel && DateTimeOffset.UtcNow.ToUnixTimeSeconds() - b.At <= 60;

    /// <summary>What the screen says, read on the PC (Windows' own text reader; nothing leaves the machine).</summary>
    private async System.Threading.Tasks.Task<string?> ReadScreenAsync(Windows.Graphics.Imaging.SoftwareBitmap bmp)
    {
        if (!_ocrTried)
        {
            _ocrTried = true;
            try { _ocr = Windows.Media.Ocr.OcrEngine.TryCreateFromUserProfileLanguages() ?? Windows.Media.Ocr.OcrEngine.TryCreateFromLanguage(new Windows.Globalization.Language("en-US")); }
            catch { _ocr = null; }
            LogLine("break watch: text reader " + (_ocr is null ? "unavailable (the logo and the cuts still count)" : "ready (" + _ocr.RecognizerLanguage.LanguageTag + ")"));
        }
        if (_ocr is null) return null;
        var r = await _ocr.RecognizeAsync(bmp);
        return string.Join("\n", r.Lines.Select(l => l.Text));
    }

    /// <summary>The channel a YouTube TV window plays: its watch address's id (a live channel's stream keeps one).</summary>
    private static string? ChannelOf(string? url)
    {
        if (url is null) return null;
        var m = Regex.Match(url, @"tv\.youtube\.com/watch/([A-Za-z0-9_-]{6,})");
        return m.Success ? m.Groups[1].Value : null;
    }

    /// <summary>Channels that carry no commercials: never covered (C-SPAN2 was covered ten minutes, 2026-10-06 22:28).</summary>
    private static readonly Regex AdFree = new(@"^(C-SPAN\d?|PBS( Kids)?|PBS .*)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Channels the person asked Prism never to cover (2026-10-06, "we'll have to make this a feature they can shut down"): kept by name.</summary>
    private static List<string> ChannelsOff() => HostPrefs.GetString("video.breakWatchOff", "").Split('|', StringSplitOptions.RemoveEmptyEntries).ToList();
    private static bool ChannelOff(string name) => name.Length > 0 && ChannelsOff().Contains(name, StringComparer.OrdinalIgnoreCase);
    private void SetChannelOff(string name, bool off)
    {
        if (name.Length == 0) return;
        var l = ChannelsOff(); l.RemoveAll(x => string.Equals(x, name, StringComparison.OrdinalIgnoreCase));
        if (off) l.Add(name);
        HostPrefs.Set("video.breakWatchOff", string.Join("|", l));
        LogLine("break watch: " + name + (off ? " won't be covered" : " is covered again"));
    }

    private static string ModelPath(string channel) => Path.Combine(BreakWatchDir, channel + ".logo");
    /// <summary>Dev only (with the frame recorder): the sound's silences and level, by window and time, for the break watch's tuning.</summary>
    /// <summary>The person's corrections, kept on this PC for tuning (breakwatch\corrections.log): when, which window and channel, what was said.</summary>
    private static void Correction(string id, string channel, string what)
    {
        try { Directory.CreateDirectory(BreakWatchDir); File.AppendAllText(Path.Combine(BreakWatchDir, "corrections.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "\t" + id + "\t" + channel + "\t" + what + Environment.NewLine); }
        catch { }
    }
    /// <summary>
    /// Dev only (PRISM_FRAME_SAMPLER=1): the test bench's recording (2026-10-07, "Proceed" - a change is replayed on everything recorded
    /// before it goes live). Each look's 320x180 grey frame as diagnostics\bench\window\HHmmssfff.gray, and every reading - the screen's
    /// words, a QR code, captions, silences, the program edge, the channel, the watch's own calls - as lines of events.log, on the same
    /// clock (seconds since Prism started, and the wall time). An hour a window is kept.
    /// </summary>
    private static readonly bool BenchOn = Environment.GetEnvironmentVariable("PRISM_FRAME_SAMPLER") == "1";
    private static int _benchPrune;
    /// <summary>Ad debug is on: the full ad watching and, on a dev machine, the bench's recording (set as the switch changes).</summary>
    private static bool s_adDebug;
    /// <summary>
    /// A window's video seeked, paused, played or changed speed (SurfaceManager.MediaNote, 2026-10-07): a line of the bench's events.log,
    /// "media seek 4682.1 -> 4672.0" or "media pause at 4682.1". A report made after going back 10 s is then read against what the screen
    /// showed, and the hindsight labeller sees a replayed stretch as the replay it is.
    /// </summary>
    private void OnMediaNote(string id, string json)
    {
        try
        {
            using var d = System.Text.Json.JsonDocument.Parse(json);
            var r = d.RootElement;
            var what = r.TryGetProperty("what", out var w) ? w.GetString() ?? "" : "";
            string P(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number ? v.GetDouble().ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) : "?";
            Bench(id, _watchClock.Elapsed.TotalSeconds, null, what == "seek" ? "media seek " + P("from") + " -> " + P("to") : "media " + what + " at " + P("to"));
        }
        catch { }
    }
    private static void Bench(string id, double t, byte[]? frame, string? evt)
    {
        if (!BenchOn || !s_adDebug) return;   // the recording only while Ad debug is on (2026-10-07)
        try
        {
            var dir = Path.Combine(HostPaths.DataDir, "diagnostics", "bench", id);
            Directory.CreateDirectory(dir);
            var wall = DateTime.Now;
            if (frame is not null)
            {
                File.WriteAllBytes(Path.Combine(dir, wall.ToString("HHmmssfff") + ".gray"), frame);
                if (++_benchPrune % 600 == 0)
                {
                    var files = Directory.GetFiles(dir, "*.gray"); Array.Sort(files);
                    for (var i = 0; i < files.Length - 3600; i++) try { File.Delete(files[i]); } catch { }
                    KeepTail(Path.Combine(dir, "events.log"));
                    foreach (var sub in new[] { "levels", "captions" })
                        try { foreach (var f in Directory.GetFiles(Path.Combine(HostPaths.DataDir, "diagnostics", sub), "*.log")) KeepTail(f); } catch { }
                }
            }
            if (evt is not null)
                File.AppendAllText(Path.Combine(dir, "events.log"), wall.ToString("HHmmssfff") + " " + t.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + " " + evt.Replace('\n', ' ').Replace('\r', ' ') + Environment.NewLine);
        }
        catch { }
    }

    /// <summary>A dev log past 10 MB is cut back to its newest 5 MB at a line (2026-10-07: the bench's events.log grew about 2 MB a window a
    /// day with no end; its lines carry the time of day and no date, so the cap is by size).</summary>
    private static void KeepTail(string path, long max = 10L << 20, long keep = 5L << 20)
    {
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists || info.Length <= max) return;
            byte[] tail;
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                fs.Seek(-keep, SeekOrigin.End);
                tail = new byte[keep];
                var n = 0; while (n < tail.Length) { var r = fs.Read(tail, n, tail.Length - n); if (r <= 0) break; n += r; }
                if (n < tail.Length) Array.Resize(ref tail, n);
            }
            var cut = Array.IndexOf(tail, (byte)'\n') + 1;   // from the next whole line
            File.WriteAllBytes(path, tail.AsSpan(cut).ToArray());
        }
        catch { }
    }

    private static void LevelLog(string id, string what)
    {
        if (Environment.GetEnvironmentVariable("PRISM_FRAME_SAMPLER") != "1") return;
        try
        {
            var dir = Path.Combine(HostPaths.DataDir, "diagnostics", "levels");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, id + ".log"), DateTime.Now.ToString("HH:mm:ss") + " " + what + Environment.NewLine);
        }
        catch { }
    }
    /// <summary>Dev only (with the frame recorder): the captions read, by window and time, for the break watch's tuning.</summary>
    private static void CaptionLog(string id, string words)
    {
        if (Environment.GetEnvironmentVariable("PRISM_FRAME_SAMPLER") != "1") return;
        try
        {
            var dir = Path.Combine(HostPaths.DataDir, "diagnostics", "captions");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, id + ".log"), DateTime.Now.ToString("HH:mm:ss") + " " + words.Replace(Environment.NewLine, " ") + Environment.NewLine);
        }
        catch { }
    }

    private AdPrints? _prints;
    private AdPrints Prints => _prints ??= new AdPrints(Path.Combine(BreakWatchDir, "prints.bin"));
    private AdSounds? _sounds;
    private AdSounds Sounds => _sounds ??= new AdSounds(Path.Combine(BreakWatchDir, "sounds.bin"));

    private void SaveBreakWatches()
    {
        _prints?.Save(); _sounds?.Save();
        foreach (var st in _watches.Values) st.Model.Save(ModelPath(st.Channel));
    }
}
