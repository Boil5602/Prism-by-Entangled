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
        // the learned detector's running state, and what the window shows now (the learned decision, or the hand rules' without a model)
        public LearnedBreak.State? L;
        public bool Covered;
        /// <summary>The inset rule is standing down for a programme shown inset (BreakModel.InsetProgramme), as last logged.</summary>
        public bool InsetProgramme;
        /// <summary>When the learned detector's cover (or a sure rule's) was last up, and whether the standing ad line holds it now.</summary>
        public double CoveredAt = -999;
        public double PaidCardSeen = -9999;   // the paid programme card this window's half hour was set from
        public long PaidUntil;                // ... and the end of that half hour (unix ms)
        public double PaidHoldAt = -999;      // when core was last told how long the paid programme's cover has left (B-364)
        public bool SureOnly;                 // the person set this channel to sure breaks only (ChannelCovers.Sure)
        public bool Withheld;                 // ... and the watch has found a break it is not covering (said once in the log)
        public bool AdLine;
        public bool CueComing;
        /// <summary>The picture is inset over the channel's ticker (BreakModel.InsetBreakAt), as last logged.</summary>
        public bool Inset;
        public double LearnedFrom = -1;   // when the learned detector began on this window: the rules decide its first 45 s (its history is empty)
    }

    private DispatcherTimer? _breakWatch;
    private readonly Dictionary<string, BreakWatchState> _watches = new();
    private readonly Stopwatch _watchClock = Stopwatch.StartNew();
    private bool _watching;
    private long _lookMs; private int _looks;
    private Windows.Media.Ocr.OcrEngine? _ocr;
    private bool _ocrTried;

    private static bool BreakWatchOn => HostPrefs.GetBool("video.breakWatch", true);
    // the learned detector (Assets/breakwatch/learned.json, 2026-10-07): it decides the covers when its file is there and the setting is on;
    // the hand rules still run (they make its readings) and decide alone without it
    private static LearnedBreak? s_learned;
    private static bool LearnedOn => s_learned is not null && HostPrefs.GetBool("video.breakWatchLearned", true);
    private static string BreakWatchDir => Path.Combine(HostPaths.DataDir, "breakwatch");

    /// <summary>The break watch's cover on a window lifted by the person's word, and none there for five minutes (the cover's Not an ad, and
    /// Ad debug's, 2026-10-07: "it isn't an ad but intermission shows on" - five presses of Ad debug's Not an ad only reported).</summary>
    private bool DismissBreak(string id, out BreakWatchState st, out double now)
    {
        now = _watchClock.Elapsed.TotalSeconds;
        if (_surfaces is null || !_watches.TryGetValue(id, out st!)) { st = null!; return false; }
        st.PendingPrints.Clear();
        st.Model.Dismiss(now);
        st.Covered = false; if (st.L is not null) st.L.Up = false;
        _surfaces.WatchAdBreak(id, false);
        _surfaces.SetNotAnAd(id, false);
        LogLine("break watch " + id + ": the person said Not an ad (" + st.ChannelName + ") - uncovered, no cover here for five minutes");
        return true;
    }

    private void InitBreakWatch()
    {
        s_learned = LearnedBreak.Load(Path.Combine(AppContext.BaseDirectory, "Assets", "breakwatch", "learned.json"));
        LogLine(s_learned is null ? "break watch: no learned detector, the hand rules decide" : "break watch: the learned detector decides (trained on " + s_learned.Trained + " marked seconds)" + (LearnedOn ? "" : " - turned off in settings"));
        _notAdHandler = id =>
        {
            if (!DismissBreak(id, out var st, out var now)) return;
            Correction(id, st.ChannelName, "not an ad");
            NotAdCounted(st.ChannelName);
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
            if (st.Covered) _surfaces.WatchAdBreak(gone, false);
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
                    if (st.Covered) _surfaces.WatchAdBreak(id, false);
                    st.Model.Save(ModelPath(st.Channel));
                }
                st = new BreakWatchState { Model = BreakModel.Load(ModelPath(channel)), Channel = channel, L = s_learned?.NewState() };
                _watches[id] = st;
                LogLine("break watch " + id + ": channel " + channel + (st.Model.HasLogo ? " (logo known)" : " (learning its logo)"));
                // in a break when Prism closed a moment ago, on this channel: the cover goes straight back up
                if (st.Model.HasLogo && BreakWasUp(id, channel)) { st.Model.ResumeBreak(_watchClock.Elapsed.TotalSeconds); st.Covered = true; if (st.L is not null) st.L.Up = true; _surfaces.WatchAdBreak(id, true); _surfaces.SetNotAnAd(id, true); LogLine("break watch " + id + ": the break that was up before the restart is covered again"); }
                Bench(id, _watchClock.Elapsed.TotalSeconds, null, "channel " + channel);
            }
            // the big window first (2026-10-07, "Are we able to prioritize the big window's throughput over the others?"): a quiet small window
            // is looked at every other second, every second once a break is up or its chance is rising. With Ad debug on, every window every
            // second ("Can we just include the extra screenshotting and performance hit when the Ad debug mode is enabled")
            // ... "quiet" by the learned detector's word too (2026-10-08): it decides the covers, and a window whose score is rising or whose
            // cover is up was still looked at every other second while the hand rules read under 20% - a slower start and a slower lift on
            // every small window of a household that has Ad debug off
            if (!s_adDebug && !s_record && id != bigId && !st.Model.Active && st.Model.Chance < 0.2 && !st.Covered && (st.L is null || st.L.LastP < 0.3) && (st.Skips++ % 2 == 1)) continue;
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
                    // the level itself, kept with the recording at every look (2026-10-08): loudness could not be studied as evidence because
                    // it only reached a log, every tenth look
                    if (lr.TryGetProperty("db", out var dbv) && dbv.ValueKind == System.Text.Json.JsonValueKind.Number)
                        Bench(id, now, null, "level " + dbv.GetDouble().ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + (lr.TryGetProperty("peak", out var pkv) && pkv.ValueKind == System.Text.Json.JsonValueKind.Number ? " " + pkv.GetDouble().ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) : ""));
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
                            if (st.L is not null) s_learned?.Caption(st.L, words, now);   // the caption classifier's view, for the learned detector
                            if (st.Model.Text(words, now, spoken: true) is { } cwhy) LogLine("break watch " + id + ": captions say " + cwhy + (st.Model.Active ? " (in a break)" : ""));
                            CaptionLog(id, (st.Model.Active ? "[covered] " : "") + words);
                        }
                    }
                }
                catch { }
            }
            var printSeenNow = false;   // a known ad's picture in this look (the learned detector's print_seen)
            // fingerprints: a picture seen in a break before; a picture of a break the watch is sure of is kept
            if (AdPrints.Of(shot.Value.Gray, BreakModel.W, BreakModel.H) is { } fp)
            {
                if (Prints.Seen(fp)) { st.Model.PrintSeen(now); printSeenNow = true; }
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
                        st.Model.ChannelName = st.ChannelName;
                        _surfaces.SetVeilBand(id, TickerBand(st.ChannelName));   // a channel's ticker stays readable under the cover
                        st.Model.TickerChannel = TickerBand(st.ChannelName) > 0;  // ... and on such a channel an inset picture is the break
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
            // the guide's programme, kept with the recording (2026-10-08): the Paid Programming rule reads it, and a replay or a trainer had
            // no way to know what the guide said - an infomercial's marked hours could not be told from a film's
            if (st.Ticks % 60 == 0 && st.Model.ShowTitle.Length > 0) Bench(id, now, null, "title " + st.Model.ShowTitle.Replace('\n', ' '));
            st.Model.NearEdge = near;
            st.Model.EdgeKnown = st.EdgeStart > 0;
            st.Model.AdFreeChannel = AdFree.IsMatch(st.ChannelName) || ChannelOff(st.ChannelName);   // and the channels the person turned off
            st.SureOnly = !st.Model.AdFreeChannel && ChannelsSure().Contains(st.ChannelName, StringComparer.OrdinalIgnoreCase);
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
            // what the window shows: the learned detector's call when it is on (a marked ad slot always covers; the person's Not an ad and an
            // ad-free channel never do), the hand rules' otherwise
            var covered = st.Model.Active;
            if (LearnedOn && st.L is not null)
            {
                var lp = s_learned!.Score(st.L, st.Model.Features(now), printSeenNow ? 1 : 0, now);
                var lup = s_learned.Decide(st.L, lp, now);
                if (st.LearnedFrom < 0) st.LearnedFrom = now;
                // its first 45 s on a window (a restart, a new channel) the learned detector has no history - no rolling means, no captions - and
                // training never saw such a start: the rules decide meanwhile (2026-10-07 23:40: a break the restart had put back up was lifted
                // at 0.01 and covered again 40 s later)
                if (now - st.LearnedFrom < 45) { lup = st.Model.Active; st.L.Up = lup; }
                else if (lup && !st.Covered && st.Model.PlainShow(now)) { lup = false; st.L.Up = false; }   // no cover begun while every rule says the show is on
                // ... nor on a dark scene the rules do not call a break themselves: black frames for seconds, the logo unreadable, nothing an ad shows
                else if (lup && !st.Covered && !st.Model.Active && st.Model.DarkScene(now)) { lup = false; st.L.Up = false; }
                // ... and a phone number or web address standing with the logo away keeps a cover that is up or was within twenty seconds
                // (BreakModel.AdLineAt: the long call-now ads the learned detector lets go of)
                var adLine = now - st.CoveredAt <= 20 && st.Model.AdLineAt(now);
                if (adLine && !lup && adLine != st.AdLine) LogLine("break watch " + id + ": a phone number or web address stands with the logo away (still the break)");
                st.AdLine = adLine;
                // ... and so does a marked slot read from the buffer and not yet on the screen (BreakModel.CueComingAt): the break is not over
                var cueComing = now - st.CoveredAt <= 20 && st.Model.CueComingAt(now);
                if (cueComing && !lup && !adLine && cueComing != st.CueComing) LogLine("break watch " + id + ": a marked slot is coming (still the break)");
                st.CueComing = cueComing;
                covered = !st.Model.AdFreeChannel && !st.Model.DismissedAt(now) && (lup || st.Model.CueOnAt(now) || st.Model.InfomercialAt(now) || adLine || cueComing);
                if (covered) st.CoveredAt = now;
                if (changed) LogLine("break watch " + id + ": the rules say " + (st.Model.Active ? "break" : "show") + " (" + st.Model.Chance.ToString("P0") + "; " + st.Model.Why + "), learned " + lp.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture));
            }
            // paid programming by the guide is an infomercial for its whole slot (2026-10-08, "Infomercials should be manageable based on the
            // schedule/guide information"); the phone-number rule (BreakModel.InfomercialAt) covers one the guide does not name
            if (!covered && !st.Model.AdFreeChannel && !st.Model.DismissedAt(now) && string.Equals(st.Model.ShowTitle.Trim(), "Paid Programming", StringComparison.OrdinalIgnoreCase)) covered = true;
            // ... and so is one that says so on the screen, to the end of its half hour (BreakModel.PaidCard: the guide named nothing)
            if (st.Model.PaidCardAt > st.PaidCardSeen)
            {
                st.PaidCardSeen = st.Model.PaidCardAt;
                var until = BreakModel.PaidSlotEnd(DateTimeOffset.Now, st.Model.PaidCardFollowing);
                if (until.ToUnixTimeMilliseconds() != st.PaidUntil) LogLine("break watch " + id + ": the screen says this is a paid program (an infomercial until " + until.ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture) + ")");
                st.PaidUntil = until.ToUnixTimeMilliseconds();
            }
            if (!covered && !st.Model.AdFreeChannel && !st.Model.DismissedAt(now) && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() < st.PaidUntil) covered = true;
            // a paid programme's cover outlasts core's five-minute backstop (B-364, 2026-10-10: FX's 04:00 infomercial lost its cover at 04:05
            // with the watch still saying break, and the three after it played uncovered): the end of its half hour is known, so core is told
            // how long is left at each look that still finds it, every half minute (IntermissionController.hold). A watch that stops looking
            // stops saying so, and the backstop falls as before.
            var paidLeft = (st.PaidUntil - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) / 1000.0;
            if (paidLeft <= 0 && string.Equals(st.Model.ShowTitle.Trim(), "Paid Programming", StringComparison.OrdinalIgnoreCase))
                paidLeft = (BreakModel.PaidSlotEnd(DateTimeOffset.Now, false) - DateTimeOffset.Now).TotalSeconds;
            if (covered && paidLeft > 0 && now - st.PaidHoldAt >= 30)
            {
                st.PaidHoldAt = now;
                // core answers ok:false when the window has no cover to hold: it came down at the backstop in the seconds between one
                // half hour's end and the next one's notice (FX 06:30:15, the notice at 06:30:27) - the break is said again and the cover returns
                var held = await ModelCallAsync(PrismHost.Channel.HostCalls.AdBreakHold, id, Math.Round(paidLeft));
                if (st.Covered && held is not null && held.Contains("\"ok\":false", StringComparison.Ordinal)) _surfaces.ReassertAdBreak(id);
            }
            // a ticker channel's inset picture is a break (2026-10-08, NFL Network: its logo stays up in the ticker through the ads, so neither
            // the rules nor the learned detector saw most breaks; BreakModel.InsetBreakAt has the reading and what it was checked against)
            var inset = st.Model.InsetBreakAt(now) || st.Model.InsetTailAt(now);
            if (st.Model.InsetProgramme != st.InsetProgramme)
            {
                st.InsetProgramme = st.Model.InsetProgramme;
                LogLine("break watch " + id + ": " + (st.InsetProgramme ? "the picture has been inset too long to be a break: the programme itself is shown inset (the inset rule stands down)" : "the picture has reached the edges for a minute: an inset picture is a break again"));
            }
            if (inset != st.Inset)
            {
                st.Inset = inset;
                LogLine("break watch " + id + ": " + (inset ? (st.Model.InsetBreakAt(now) ? "the picture is inset over the ticker (a break)" : "full screen with the ticker gone, just after an inset break (still the break)") : "the picture reaches the edges again"));
                Bench(id, now, null, inset ? "inset 1" : "inset 0");
            }
            if (!covered && inset && !st.Model.AdFreeChannel && !st.Model.DismissedAt(now)) covered = true;
            // Sure breaks only (the person's choice for this channel, ChannelCovers.Sure): the cover is up only for what does not guess -
            // YouTube TV's own marked slot as it plays, one known to be coming while a cover is up, and a paid programme the guide or the
            // screen names. The watch goes on reading the picture and learning as it does on any channel; it just does not cover on it.
            if (st.SureOnly)
            {
                var found = covered;
                var paidNow = string.Equals(st.Model.ShowTitle.Trim(), "Paid Programming", StringComparison.OrdinalIgnoreCase) || DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() < st.PaidUntil;
                covered = !st.Model.DismissedAt(now) && (st.Model.CueOnAt(now) || (st.Covered && st.Model.CueComingAt(now)) || paidNow);
                var withheld = found && !covered;
                if (withheld != st.Withheld) { st.Withheld = withheld; if (withheld) LogLine("break watch " + id + ": a break the watch found is not covered (sure breaks only on " + st.ChannelName + ")"); }
            }
            else st.Withheld = false;
            var shownChanged = covered != st.Covered;
            if (shownChanged)
            {
                st.Covered = covered;
                LogLine("break watch " + id + ": " + (covered ? "break" : "show") + " (" + (LearnedOn && st.L is not null ? "learned " + st.L.LastP.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + ", rules " : "") + st.Model.Chance.ToString("P0") + "; " + st.Model.Why + ")");
                Bench(id, now, null, covered ? "call break" : "call show");
                _surfaces.WatchAdBreak(id, covered);
                _surfaces.SetNotAnAd(id, covered);
            }
            else if (st.Ticks % 30 == 0)
                LogLine("break watch " + id + ": " + st.Model.Chance.ToString("P0") + (st.Model.Active ? " break" : "") + (st.Model.Why.Length > 0 ? " (" + st.Model.Why + ")" : ""));
            if (st.Ticks % 300 == 0) { st.Model.Save(ModelPath(channel)); Prints.Save(); Sounds.Save(); }   // the learned logo and the ads seen, every five minutes
            if (shownChanged || (st.Covered && st.Ticks % 10 == 0)) NoteBreakUp(id, channel, st.Covered);   // what a restart resumes
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
    private void SetChannelOff(string name, bool off) => SetChannelMode(name, off ? ChannelCovers.Off : ChannelCovers.On);

    /// <summary>How a channel's breaks are covered (2026-10-10, "a right click channel settings menu, for live stations, with the ability to
    /// disable the ad veils" - "I like your on, sure breaks, off idea"). On: every break the watch finds. Sure: only what does not guess -
    /// YouTube TV's own marked ad slot, and a paid programme the guide or the screen names. Off: never. Kept by channel name; the channels
    /// turned off stay in the list they always were in (video.breakWatchOff), the sure ones beside it (video.breakWatchSure).</summary>
    internal enum ChannelCovers { On, Sure, Off }
    private static List<string> ChannelsSure() => HostPrefs.GetString("video.breakWatchSure", "").Split('|', StringSplitOptions.RemoveEmptyEntries).ToList();
    private static ChannelCovers ChannelMode(string name) =>
        name.Length == 0 ? ChannelCovers.On : ChannelOff(name) ? ChannelCovers.Off : ChannelsSure().Contains(name, StringComparer.OrdinalIgnoreCase) ? ChannelCovers.Sure : ChannelCovers.On;
    private void SetChannelMode(string name, ChannelCovers mode)
    {
        if (name.Length == 0) return;
        var off = ChannelsOff(); off.RemoveAll(x => string.Equals(x, name, StringComparison.OrdinalIgnoreCase));
        var sure = ChannelsSure(); sure.RemoveAll(x => string.Equals(x, name, StringComparison.OrdinalIgnoreCase));
        if (mode == ChannelCovers.Off) off.Add(name); else if (mode == ChannelCovers.Sure) sure.Add(name);
        HostPrefs.Set("video.breakWatchOff", string.Join("|", off));
        HostPrefs.Set("video.breakWatchSure", string.Join("|", sure));
        LogLine("break watch: " + name + (mode == ChannelCovers.Off ? " won't be covered" : mode == ChannelCovers.Sure ? " is covered in sure breaks only" : " is covered again"));
    }

    /// <summary>A channel whose covers the person keeps calling wrong drops to sure breaks only (2026-10-10, "disabling ad veils for live
    /// channels if false positives exceed a certain threshold"). Prism only knows a cover was wrong when it is told, so the count is of
    /// Not an ad presses on the channel in the last seven days: video.breakWatchAutoSure of them (3 unless set, 0 for never). It says so
    /// on the status line; the channel's menu in Live and Watch settings put it back.</summary>
    private void NotAdCounted(string name)
    {
        if (name.Length == 0) return;
        var limit = (int)HostPrefs.GetDouble("video.breakWatchAutoSure", 3);
        var nowS = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        // "<channel>=<unix seconds>" a press, the last week's kept
        var kept = HostPrefs.GetString("video.breakWatchNotAd", "").Split('|', StringSplitOptions.RemoveEmptyEntries)
            .Where(x => x.LastIndexOf('=') > 0 && long.TryParse(x.Substring(x.LastIndexOf('=') + 1), out var t) && nowS - t < 7 * 86400).ToList();
        kept.Add(name + "=" + nowS);
        HostPrefs.Set("video.breakWatchNotAd", string.Join("|", kept));
        if (limit <= 0 || ChannelMode(name) != ChannelCovers.On) return;
        var n = kept.Count(x => string.Equals(x.Substring(0, x.LastIndexOf('=')), name, StringComparison.OrdinalIgnoreCase));
        if (n < limit) return;
        SetChannelMode(name, ChannelCovers.Sure);
        LogLine("break watch: " + name + " said Not an ad " + n + " times in a week - sure breaks only from here");
        SetPill("Prism" + Mid + name + " is now covered only in breaks YouTube TV marks, after " + n + " Not an ad presses this week. Right-click the channel in Live to change it");
    }

    private static string ModelPath(string channel) => Path.Combine(BreakWatchDir, channel + ".logo");
    /// <summary>Dev only (with the frame recorder): the sound's silences and level, by window and time, for the break watch's tuning.</summary>
    /// <summary>The person's corrections, kept on this PC for tuning (breakwatch\corrections.log): when, which window and channel, what was said.</summary>
    private static void Correction(string id, string channel, string what)
    {
        try { Directory.CreateDirectory(BreakWatchDir); File.AppendAllText(Path.Combine(BreakWatchDir, "corrections.log"), PrismHost.Diagnostics.Redact.Line(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "\t" + id + "\t" + channel + "\t" + what) + Environment.NewLine); }
        catch { }
    }
    /// <summary>
    /// Dev only (PRISM_FRAME_SAMPLER=1): the test bench's recording (2026-10-07, "Proceed" - a change is replayed on everything recorded
    /// before it goes live). Each look's 320x180 grey frame as diagnostics\bench\window\HHmmssfff.gray, and every reading - the screen's
    /// words, a QR code, captions, silences, the program edge, the channel, the watch's own calls - as lines of events.log, on the same
    /// clock (seconds since Prism started, and the wall time). An hour a window is kept.
    /// </summary>
    private static readonly bool BenchOn = Environment.GetEnvironmentVariable("PRISM_FRAME_SAMPLER") == "1";
    // a count for each window (2026-10-08): with one count for all, a window was trimmed only when it happened to write the 600th frame -
    // some at every turn, one not for hours (14,430 frames, a gigabyte)
    private static readonly Dictionary<string, int> _benchPrune = new();
    /// <summary>Ad debug is on: the full ad watching and, on a dev machine, the bench's recording (set as the switch changes).</summary>
    private static bool s_adDebug;
    /// <summary>
    /// Keep recording (2026-10-08): the bench records with Ad debug off too, so the PC can be used as Prism, covers drawn, while the
    /// recordings for training go on. Until now a recording meant Ad debug, and Ad debug means no covers: the PC either gathered data or
    /// was a viewer. A dev machine's switch only (PRISM_FRAME_SAMPLER=1). While it is on every window is looked at each second, as the
    /// kept recordings all were. The frames are the page's own picture and the sound is the page's own meter, so a drawn cover and its
    /// mute change nothing in what is recorded.
    /// </summary>
    private static bool s_record;
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
    /// <summary>
    /// The stream's own ad cue (2026-10-07, found in the data YouTube TV's page hands its player: "Cuepoint-Type: TYPE_AD", "Cuepoint-Event:
    /// EVENT_PREDICT_START / START / CONTINUE / STOP", the slot's total length and the playhead in it). They mark the slots YouTube TV fills
    /// itself, not the network's own ads: the break model covers for a marked slot at once, and the bench records every cue.
    /// The page hands a cue over twice (2026-10-08, the adapter's verified.cue). Until then it came once, when the data was buffered, 14 to
    /// 31 s before the picture: a slot that opens a break covered that much of the show (NBC Sports: 693 of 3,326 slot seconds on the
    /// marked hours were the show) and let go that much early. Now the early word ("early", with "lead" = how far ahead it is) is the
    /// bench's "cue" line as it always was and the learned detector's input, the timing it was trained on (slid to the picture alone it
    /// lost 0.9 points of ad time on the exams); and the word that comes as the playhead reaches the slot is the sure rule's (CueOnAt),
    /// the bench's "cueat" line. A cue the page could not place comes once and is both.
    /// </summary>
    private void OnCueNote(string id, string json)
    {
        try
        {
            using var d = System.Text.Json.JsonDocument.Parse(json);
            var r = d.RootElement;
            var ev = r.TryGetProperty("ev", out var e) ? e.GetString() ?? "" : "";
            var dur = r.TryGetProperty("dur", out var du) && du.ValueKind == System.Text.Json.JsonValueKind.Number ? du.GetDouble() : 0;
            var pos = r.TryGetProperty("pos", out var po) && po.ValueKind == System.Text.Json.JsonValueKind.Number ? po.GetDouble() : 0;
            var now = _watchClock.Elapsed.TotalSeconds;
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            var lead = r.TryGetProperty("lead", out var le) && le.ValueKind == System.Text.Json.JsonValueKind.Number ? le.GetDouble() : -1;
            var early = r.TryGetProperty("early", out _);
            var read = early || lead < 0;     // as buffered: the learned detector's input
            var plays = !early;               // as it plays: the sure rule's
            var body = ev + " " + dur.ToString("0.0", inv) + " " + pos.ToString("0.0", inv);
            if (read) Bench(id, now, null, "cue " + body);
            if (plays) Bench(id, now, null, "cueat " + body + " " + (lead >= 0 ? lead.ToString("0.0", inv) : "now"));
            if (plays && ev != "EVENT_CONTINUE") LogLine("break watch " + id + ": the stream's ad cue " + ev + " (" + dur.ToString("0", inv) + " s slot, at " + pos.ToString("0", inv) + " s" + (lead >= 0 ? ", read " + lead.ToString("0", inv) + " s ahead of the picture" : "") + ")");
            if (_watches.TryGetValue(id, out var st))
            {
                if (read) st.Model.CueRead(ev, dur, pos, now);
                if (plays) st.Model.CueSeen(ev, dur, pos, now);
            }
        }
        catch { }
    }
    /// <summary>
    /// The ticker a channel keeps on screen through its breaks, as the share of the picture's height (from its bottom) the cover leaves
    /// open. Set by hand for the one channel read so far (2026-10-08): NFL Network's ticker - scores, headlines, its logo - stays up while
    /// the ads play in the picture above it; on the recorded frames the picture ends at row 161 of 180 and everything under it barely
    /// changes through a break. Learning the band per channel is the next step (a strip that stands still through sure breaks).
    /// </summary>
    private static double TickerBand(string channel) => string.Equals(channel.Trim(), "NFL Network", StringComparison.OrdinalIgnoreCase) ? 0.10 : 0;

    private static void Bench(string id, double t, byte[]? frame, string? evt)
    {
        if (!BenchOn || !(s_adDebug || s_record)) return;   // the recording while Ad debug is on (2026-10-07) or Keep recording is (2026-10-08)
        try
        {
            var dir = Path.Combine(HostPaths.DataDir, "diagnostics", "bench", id);
            Directory.CreateDirectory(dir);
            var wall = DateTime.Now;
            if (frame is not null)
            {
                File.WriteAllBytes(Path.Combine(dir, wall.ToString("HHmmssfff") + ".gray"), frame);
                var written = _benchPrune[id] = (_benchPrune.TryGetValue(id, out var bn) ? bn : 0) + 1;
                if (written % 600 == 0)
                {
                    // the newest 3,600 by when they were WRITTEN (2026-10-08). A frame's name is the time of day alone, and sorted by name the
                    // evening before's frames were the "newest" all of the next day: every prune deleted the day's own frames and kept
                    // yesterday's 22:47-23:59. Measured that day: 10% to 50% of each window's recording gone, in gaps of half an hour
                    var files = new DirectoryInfo(dir).GetFiles("*.gray").OrderBy(f => f.LastWriteTimeUtc).ToArray();
                    for (var i = 0; i < files.Length - 3600; i++) try { files[i].Delete(); } catch { }
                    KeepTail(Path.Combine(dir, "events.log"));
                    foreach (var sub in new[] { "levels", "captions" })
                        try { foreach (var f in Directory.GetFiles(Path.Combine(HostPaths.DataDir, "diagnostics", sub), "*.log")) KeepTail(f); } catch { }
                }
            }
            if (evt is not null)
            {
                // redacted like every diagnostics write (B-91, section 22), but for the sound's fingerprint: its line is a run of hex words,
                // which is what the redactor takes a secret to look like, and the replay matches ads by it
                var body = evt.Replace('\n', ' ').Replace('\r', ' ');
                File.AppendAllText(Path.Combine(dir, "events.log"), wall.ToString("HHmmssfff") + " " + t.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + " " + (body.StartsWith("afp ", StringComparison.Ordinal) ? body : PrismHost.Diagnostics.Redact.Line(body)) + Environment.NewLine);
            }
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
            File.AppendAllText(Path.Combine(dir, id + ".log"), PrismHost.Diagnostics.Redact.Line(DateTime.Now.ToString("HH:mm:ss") + " " + what) + Environment.NewLine);
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
            File.AppendAllText(Path.Combine(dir, id + ".log"), PrismHost.Diagnostics.Redact.Line(DateTime.Now.ToString("HH:mm:ss") + " " + words.Replace(Environment.NewLine, " ")) + Environment.NewLine);
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
