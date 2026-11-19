using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Threading.Tasks;

namespace PrismHost;

/// <summary>
/// The look-ahead (docs/features/look-ahead.md, 2026-11-17; off unless the person turns it on in Watch settings): the big screen plays
/// a live channel about fifteen seconds behind live while a second page on the same channel, never seen and never heard, stays at the
/// live edge. The break watch reads that page as it reads any window, so by the time a break reaches the big screen the watch has
/// already seen its first quarter minute: the cover goes up where the break began (<see cref="LookAheadPlan"/>; a cover's end
/// is not helped, it comes down where the watch lifts it).
///
/// What this file does, a step a look of the break watch:
///  - asks core whether the big screen's channel may be delayed (the service can, and it is not sport), and for the live page;
///  - measures how far the big screen is behind the live page from the two pages' sound (<see cref="LagFinder"/>: their clocks cannot
///    be compared) and keeps the measure between readings by each page's own clock;
///  - puts the big screen behind with the page's own Back button, a press at a time, and checks that it got there;
///  - gives the big screen's cover from the plan while the live page is healthy, and steps aside when it is not: the break watch on the
///    big screen itself goes on reading all the while, and its own call stands whenever the plan has none;
///  - backs off for the rest of the session when the live page will not play (too many streams on the account), and returns the big
///    screen to live with the page's own Forward to live button.
/// Only the page's own buttons are pressed. Nothing is held back or replayed by PRISM: both pictures are the service's own player.
/// </summary>
public sealed partial class MainWindow
{
    private const string ScoutId = "scout:big";
    private const double LookTarget = 15;   // seconds behind live the big screen is put: one press of Back (2026-11-17: the bench gave 93.8% at 15 s and 94.0% at 30 s)

    private sealed class LookAheadState
    {
        public string Phase = "off";            // off | opening | aligning | pressing | on
        public string Of = "", Url = "";        // the big window followed, and the address it was on when the live page opened
        public double Since;                    // when the phase began (the watch's clock)
        public readonly LookAheadPlan Plan = new();
        public readonly LagFinder Lag = new();
        public double OffBig = double.NaN, OffScout = double.NaN;   // each page's wall clock less its player's clock, at its last look
        public readonly LagClaim Claim = new(); public bool HasBase; public double BaseLag, BaseOffBig, BaseOffScout, MeasuredAt = -999, FindAt = -999;
        public int ScoutLooks; public double ScoutSeen = -999;      // looks at the live page with its player playing, and the last of them
        public bool ScoutBehind;
        public int PressesLeft, Tries; public double PressAt = -999;
        public int Reopens; public string ReopenUrl = "";   // the live page opened again for want of a measure, and on which address
        public double BackSec = 15; public string? TooMany;
        public double AskedAt = -999; public bool Allowed; public string Why = "";
        public double SaidAt = -999, TextAt = -999, ScoutLiveAt = -999;
        public double PlanFrom = double.NaN;    // the first moment of the programme the plan may speak for (the live page's first looks are a start-up)
        public double BehindSince = -1;         // since when the big screen has been far behind live by the person's own move (-1: it is not)
        public bool PageOpen;                  // core has the live page open (it is kept across a change of channel)
        /// <summary>Seconds the big screen plays behind the live page, or NaN while it is not known.</summary>
        public double Delay => HasBase && !double.IsNaN(OffBig) && !double.IsNaN(OffScout) ? BaseLag + (OffBig - BaseOffBig) - (OffScout - BaseOffScout) : double.NaN;
    }

    private readonly LookAheadState _look = new();
    private string? _lookStood;        // why the delay is off for the rest of this session (the live page would not play), or null
    private string? _lookHeldUrl;      // the address the person took back to live: no delay there until the channel changes

    private static bool LookAheadOn => HostPrefs.GetBool("video.lookAhead", false);
    private static string F1(double v) => v.ToString("0.0", CultureInfo.InvariantCulture);

    /// <summary>Before the break watch looks at its windows: the live page is opened, kept or closed, and joins the windows to look at.</summary>
    private async Task LookAheadStepAsync(string? bigId, List<string> ids, double now)
    {
        if (_surfaces is null) return;
        var la = _look;
        var bigUrl = bigId is null ? null : _surfaces.SourceOf(bigId);
        var onChannel = bigId is not null && ids.Contains(bigId) && bigUrl is not null;
        if (la.Phase != "off" && (!onChannel || bigId != la.Of || !SameWatch(bigUrl, la.Url)))
        {
            // a new channel is at live by itself; the live page is kept for it when it too may be delayed
            await LookAheadCloseAsync(onChannel && bigId == la.Of ? "the channel changed" : "the big screen left the channel", toLive: false, keepPage: onChannel);
        }
        if (bigUrl is not null && _lookHeldUrl is not null && !SameWatch(bigUrl, _lookHeldUrl)) _lookHeldUrl = null;
        var want = LookAheadOn && _lookStood is null && onChannel && (_lookHeldUrl is null || !SameWatch(bigUrl, _lookHeldUrl));
        if (want && _watches.TryGetValue(bigId!, out var bst))
        {
            // nothing to gain where the watch covers nothing, and a viewer who went back in the programme themselves is left alone
            // (a channel covered only in the service's own marked slots gains nothing either: each page is told of a slot at its own place)
            if (bst.Model.AdFreeChannel || bst.SureOnly) want = false;
            // ... and never a recording: the page says it is one within its first looks, so ten looks pass before a live page opens
            else if (la.Phase == "off" && (bst.BehindLive || bst.Ticks < 10)) want = false;
            // the person went back in the programme (more than 45 s behind live, where nothing is covered): the live page has nothing
            // to give there, so it is closed after ten seconds and its stream freed; it opens again when the big screen is back at live
            else if (la.Phase != "off" && bst.BehindLive)
            {
                if (la.BehindSince < 0) la.BehindSince = now;
                if (now - la.BehindSince >= 10) { la.BehindSince = -1; await LookAheadCloseAsync("the big screen was taken back in the programme", toLive: false); return; }
            }
            else la.BehindSince = -1;
        }
        else want = false;   // the watch has not looked at the big screen yet
        if (want && now - la.AskedAt >= 30)
        {
            la.AskedAt = now;
            try
            {
                var raw = await ModelCallAsync(PrismHost.Channel.HostCalls.VideoLookAhead, bigId!);
                using var d = JsonDocument.Parse(raw is { Length: > 2 } ? raw : "{}");
                var r = d.RootElement;
                la.Allowed = r.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True;
                la.Why = r.TryGetProperty("why", out var why) ? why.GetString() ?? "" : "";
                if (r.TryGetProperty("backSec", out var bs) && bs.ValueKind == JsonValueKind.Number && bs.GetDouble() > 0) la.BackSec = bs.GetDouble();
                la.TooMany = r.TryGetProperty("tooMany", out var tm) && tm.ValueKind == JsonValueKind.String ? tm.GetString() : null;
            }
            catch { la.Allowed = false; la.Why = "no answer"; }
        }
        if (want && !la.Allowed) want = false;
        if (!want)
        {
            if (la.Phase != "off") await LookAheadCloseAsync(!LookAheadOn ? "turned off in Watch settings" : la.Why == "sports" ? "sport is on this channel" : "this channel is not delayed", toLive: true);
            else if (la.PageOpen) { la.PageOpen = false; try { await ModelCallAsync(PrismHost.Channel.HostCalls.VideoScout, ""); } catch { } }
            return;
        }
        if (la.Phase == "off")
        {
            la.Phase = "opening"; la.Since = now; la.Of = bigId!; la.Url = bigUrl!;
            la.Plan.Reset(); la.PlanFrom = double.NaN; la.Lag.Reset(); la.HasBase = false; la.OffBig = la.OffScout = double.NaN; la.ScoutLooks = 0; la.ScoutSeen = -999; la.Tries = 0; la.PressesLeft = 0; la.MeasuredAt = -999;
            await ModelCallAsync(PrismHost.Channel.HostCalls.VideoScout, bigId!);
            la.PageOpen = true;
            LogLine("look-ahead: the live page is opening on " + bigId + "'s channel");
        }
        // the live page is looked at first, so the big screen's cover in this same look knows what it saw
        if ((_surfaces.SourceOf(ScoutId) ?? "").Contains("tv.youtube.com/watch", StringComparison.OrdinalIgnoreCase)) ids.Insert(0, ScoutId);
    }

    /// <summary>Two addresses of the same channel's player (the query string may differ).</summary>
    private static bool SameWatch(string? a, string? b) => a is not null && b is not null && ChannelOf(a) is { } ca && ca == ChannelOf(b);

    /// <summary>A page's sound words from its meter, as the break watch reads them: the live page's and the big screen's are laid over each other.</summary>
    private void LookAheadWords(string id, double now, List<uint> words)
    {
        if (_look.Phase == "off" || words.Count == 0) return;
        if (id == ScoutId) _look.Lag.Ahead(now, words); else if (id == _look.Of) _look.Lag.Behind(now, words);
    }

    /// <summary>A page's own clock at a look (its wall clock less its player's time), and whether its player plays.</summary>
    private void LookAheadClock(string id, double now, double off, bool playing, bool behind)
    {
        var la = _look;
        if (la.Phase == "off") return;
        if (id == ScoutId)
        {
            // a page that loaded again counts its time from a new start: the measure begins again
            if (!double.IsNaN(la.OffScout) && Math.Abs(off - la.OffScout) > 120) { la.HasBase = false; la.Lag.Reset(); LogLine("look-ahead: the live page started again, measuring again"); }
            // a page that moved in its programme (a stall, a press): its sound so far no longer lines up; the clocks carry the measure meanwhile
            else if (!double.IsNaN(la.OffScout) && Math.Abs(off - la.OffScout) > 0.75) la.Lag.ResetAhead();
            la.OffScout = off; la.ScoutBehind = behind;
            if (playing) { la.ScoutLooks++; la.ScoutSeen = now; }
        }
        else if (id == la.Of)
        {
            if (!double.IsNaN(la.OffBig) && Math.Abs(off - la.OffBig) > 120)
            {
                la.HasBase = false; la.Lag.Reset();
                if (la.Phase is "on" or "pressing") { la.Phase = "aligning"; la.Since = now; la.Tries = 0; }
                LogLine("look-ahead: the big screen's page started again, measuring again");
            }
            else if (!double.IsNaN(la.OffBig) && Math.Abs(off - la.OffBig) > 0.75) la.Lag.ResetBehind();
            la.OffBig = off;
        }
    }

    /// <summary>The break watch's call on the live page at a look: noted for the big screen's covers.</summary>
    // the end finder (Assets/breakwatch/end-finder.json, 2026-11-17): the reading that looks both ways; without its file the plan's
    // ends rest on the black frame alone
    private static readonly EndFinder? s_endFinder = EndFinder.Load(Path.Combine(AppContext.BaseDirectory, "Assets", "breakwatch", "end-finder.json"), Services.BreakModel.FeatureNames);
    private EndFinder.State? _endState;

    private void LookAheadLook(double now, double chance, bool covered, bool sure, double blackAt, double[] readings)
    {
        // its first fifty seconds on a channel the watch has no history (the rules decide alone, MainWindow.BreakWatch): the plan speaks
        // only for what the live page saw after them, and the big screen's own reading stands for everything before
        if (double.IsNaN(_look.PlanFrom)) _look.PlanFrom = now + 50;
        if (s_endFinder is not null)
        {
            // a plan that was emptied (another channel, Not an ad) starts the end finder's looks again too
            if (_endState is null || _look.Plan.Count == 0) { _endState = s_endFinder.NewState(); _look.Plan.EndMin = s_endFinder.Min; LogLine("look-ahead: the end finder reads the live page (trained on " + s_endFinder.Trained + " looks, the show is back over " + s_endFinder.Min.ToString("0.00", CultureInfo.InvariantCulture) + ")"); }
            foreach (var (qt, qq) in s_endFinder.Look(_endState, now, readings)) _look.Plan.Back(qt, qq);
        }
        _look.Plan.Look(now, chance, covered, sure, blackAt);
        // one line for each cover the watch lifted, eight seconds after (the end finder's answers are in by then): where the plan
        // put it against where the watch had it, and what moved its end
        var delay = _look.Delay;
        if (_look.Phase == "on" && !double.IsNaN(delay) && _look.Plan.LastLifted(delay, now) is { } c && c.Lifted != _saidLift && now - c.Lifted >= 8)
        {
            _saidLift = c.Lifted;
            LogLine("look-ahead: a cover of " + F1(c.Lifted - c.Called) + " s by the watch; the plan starts it " + F1(c.Called - c.From) + " s sooner and ends it " + F1(c.Lifted - c.To) + " s sooner ("
                + (c.End == "black" ? "a black frame" : c.End == "finder" ? "the end finder" : "no mark of the return") + "), " + F1(delay) + " s in hand");
        }
    }
    private double _saidLift = double.NaN;

    /// <summary>The big screen's cover by the plan, or null when the plan has no say (the delay is not on, or the live page has gone quiet).</summary>
    private bool? LookAheadCover(string id, double now)
    {
        var la = _look;
        if (la.Phase != "on" || id != la.Of) return null;
        var delay = la.Delay;
        if (double.IsNaN(delay) || delay < 3 || delay > 90 || now - la.Plan.LastLook > 6) return null;
        if (double.IsNaN(la.PlanFrom) || now - delay < la.PlanFrom) return null;
        return la.Plan.CoverAt(now - delay, now);
    }

    /// <summary>The person said a cover on the big screen was no advertisement: the plan forgets what it had.</summary>
    private void LookAheadDismissed(string id, double now)
    {
        if (id != _look.Of || _look.Phase == "off") return;
        _look.Plan.Reset();
        // the live page's own reading is told the same, so it does not call the same stretch a break again
        if (_watches.TryGetValue(ScoutId, out var s)) { s.Model.Dismiss(now); s.Covered = false; if (s.L is not null) s.L.Up = false; }
    }

    /// <summary>After the break watch's looks: the measure, the presses, and the watch on the live page's health.</summary>
    private async Task LookAheadAfterAsync(double now)
    {
        if (_surfaces is null) return;
        var la = _look;
        if (la.Phase == "off") return;
        // the measure by sound, every three seconds
        if (now - la.FindAt >= 3)
        {
            la.FindAt = now;
            if (la.Lag.Find(-20, 80) is { } found && !double.IsNaN(la.OffBig) && !double.IsNaN(la.OffScout))
            {
                var was = la.Delay;
                // a jump away from the clocks waits until it has stood longer than one advertisement (LagClaim)
                var jump = la.HasBase && Math.Abs(found.Lag - was) > 1.5;
                if (!jump) la.Claim.Drop();
                if (jump && !la.Claim.Jump(found.Lag - la.OffBig + la.OffScout, now)) { }
                else if (!la.HasBase || Math.Abs(found.Lag - was) > 0.25)
                {
                    if (!la.HasBase || Math.Abs(found.Lag - was) > 1.5)
                        LogLine("look-ahead: the big screen is " + F1(found.Lag) + " s behind the live page by their sound" + (la.HasBase ? " (the clocks said " + F1(was) + ")" : "") + ", " + (found.Differ * 100).ToString("0", CultureInfo.InvariantCulture) + "% of bits differ");
                    la.BaseLag = found.Lag; la.BaseOffBig = la.OffBig; la.BaseOffScout = la.OffScout; la.HasBase = true;
                }
                la.MeasuredAt = now;
            }
        }
        var delay = la.Delay;
        switch (la.Phase)
        {
            case "opening":
                if (la.ScoutLooks >= 8) { la.Phase = "aligning"; la.Since = now; la.SaidAt = now; LogLine("look-ahead: the live page plays; measuring how the two pages stand"); }
                else if (now - la.Since > 75) await LookAheadStandDownAsync("the live page did not play");
                break;
            case "aligning":
                if (la.HasBase && now - la.MeasuredAt < 10)
                {
                    la.PressesLeft = Math.Max(0, (int)Math.Round((LookTarget - delay) / la.BackSec));
                    la.Phase = "pressing"; la.Since = now; la.PressAt = now - 10;
                    LogLine("look-ahead: " + (la.PressesLeft == 0 ? "the big screen is already " + F1(delay) + " s behind" : la.PressesLeft + " press(es) of Back to put the big screen about " + F1(LookTarget) + " s behind (it is " + F1(delay) + " s behind now)"));
                }
                // no measure in two and a half minutes: the live page may have opened far from live (seen 2026-11-18, two minutes
                // off, and a second opening measured at once). It is opened again, twice at most on one address
                else if (!la.HasBase && now - la.Since > 150 && (la.ReopenUrl != la.Url || la.Reopens < 2))
                {
                    if (la.ReopenUrl != la.Url) { la.ReopenUrl = la.Url; la.Reopens = 0; }
                    la.Reopens++;
                    await LookAheadCloseAsync("no measure of the two pages; the live page opens again", toLive: false);
                    return;
                }
                else if (now - la.SaidAt > 120) { la.SaidAt = now; LogLine("look-ahead: no measure yet (silence, or the two pages are in different advertisements); the big screen stays live"); }
                break;
            case "pressing":
                if (la.PressesLeft > 0)
                {
                    if (now - la.PressAt < 2) break;
                    la.PressAt = now; la.PressesLeft--;
                    var r = await _surfaces.EvalOnTileAsync(la.Of, "window.__prismVideoCmd ? window.__prismVideoCmd('seekbackward') : false");
                    LogLine("look-ahead: Back pressed on the big screen (" + (r ?? "no answer") + ")");
                }
                else if (now - la.PressAt >= 5)
                {
                    if (!double.IsNaN(delay) && Math.Abs(delay - LookTarget) <= 6)
                    {
                        la.Phase = "on"; la.Since = now;
                        LogLine("look-ahead: on - the big screen plays " + F1(delay) + " s behind the live page");
                        SetPill("PRISM" + Mid + "the big screen now plays " + Math.Round(delay) + " seconds behind live, so ad covers can be on time");
                    }
                    else if (++la.Tries >= 3)
                    {
                        LogLine("look-ahead: the big screen did not go behind (" + (double.IsNaN(delay) ? "no measure" : F1(delay) + " s") + ") after three tries; no delay on this channel");
                        _lookHeldUrl = la.Url;
                        await LookAheadCloseAsync("the page's Back button did not hold a delay", toLive: true);
                    }
                    else { la.Phase = "aligning"; la.Since = now; la.MeasuredAt = -999; LogLine("look-ahead: the big screen is " + (double.IsNaN(delay) ? "not measured" : F1(delay) + " s behind") + " after the presses; trying again"); }
                }
                break;
            case "on":
                if (!double.IsNaN(delay) && delay < 5)
                {
                    // the person pressed their way back to live: theirs to choose, until the channel changes
                    LogLine("look-ahead: the big screen is at live again (" + F1(delay) + " s); no delay until the channel changes");
                    _lookHeldUrl = la.Url;
                    await LookAheadCloseAsync("the big screen went back to live", toLive: false);
                    return;
                }
                if (now - la.SaidAt > 300) { la.SaidAt = now; LogLine("look-ahead: on, " + (double.IsNaN(delay) ? "delay not known" : F1(delay) + " s behind") + ", " + la.Plan.Count + " looks kept"); }
                break;
        }
        if (la.Phase == "off") return;
        // the live page's health: it must go on playing at its live edge
        if (la.Phase != "opening")
        {
            if (la.ScoutBehind && now - la.ScoutLiveAt > 20)
            {
                la.ScoutLiveAt = now;
                await _surfaces.EvalOnTileAsync(ScoutId, "window.__prismVideoCmd ? window.__prismVideoCmd('seeklive') : false");
                LogLine("look-ahead: the live page had fallen behind; Forward to live pressed on it");
            }
            if (now - la.ScoutSeen > 30) { await LookAheadStandDownAsync(await LookAheadTooManyAsync() ? "the service says too many streams are playing" : "the live page stopped playing"); return; }
        }
        // the service's own words for too many streams, on either page, looked for every ten seconds
        if (la.TooMany is { Length: > 0 } && now - la.TextAt >= 10)
        {
            la.TextAt = now;
            if (await LookAheadTooManyAsync()) await LookAheadStandDownAsync("the service says too many streams are playing");
        }
    }

    private async Task<bool> LookAheadTooManyAsync()
    {
        if (_surfaces is null || _look.TooMany is not { Length: > 0 } pattern) return false;
        var js = "(function(){try{return new RegExp(" + JsonSerializer.Serialize(pattern) + ",'i').test(document.body.innerText||'')}catch(e){return false}})()";
        foreach (var id in new[] { ScoutId, _look.Of })
            if (id.Length > 0 && await _surfaces.EvalOnTileAsync(id, js) == "true") return true;
        return false;
    }

    /// <summary>The live page will not play: closed, and no delay for the rest of this session.</summary>
    private async Task LookAheadStandDownAsync(string why)
    {
        _lookStood = why;
        LogLine("look-ahead: off for this session - " + why);
        var wasOn = _look.Phase is "on" or "pressing";
        await LookAheadCloseAsync(why, toLive: true);
        if (wasOn) SetPill("PRISM" + Mid + "the big screen is back at live (" + why + ")");
    }

    /// <summary>The live page closed; the big screen returned to live by the page's own button when PRISM had put it behind.</summary>
    private async Task LookAheadCloseAsync(string why, bool toLive, bool keepPage = false)
    {
        var la = _look;
        if (la.Phase == "off") return;
        var behind = la.Phase is "on" or "pressing" || (!double.IsNaN(la.Delay) && la.Delay > 8);
        LogLine("look-ahead: closed (" + why + ")" + (toLive && behind ? "; the big screen goes back to live" : ""));
        if (toLive && behind && _surfaces is not null && la.Of.Length > 0)
        {
            var r = await _surfaces.EvalOnTileAsync(la.Of, "window.__prismVideoCmd ? window.__prismVideoCmd('seeklive') : false");
            LogLine("look-ahead: Forward to live pressed on the big screen (" + (r ?? "no answer") + ")");
            // a press that did not take was seen once (2026-11-17): pressed again two seconds on, where the button is off when already at live
            var of = la.Of;
            _ = Task.Delay(2000).ContinueWith(_ => DispatcherQueue.TryEnqueue(async () => { try { if (_surfaces is not null) await _surfaces.EvalOnTileAsync(of, "window.__prismVideoCmd ? window.__prismVideoCmd('seeklive') : false"); } catch { } }));
        }
        la.Phase = "off"; la.Of = ""; la.Url = ""; la.HasBase = false; la.AskedAt = -999;
        la.Plan.Reset(); la.Lag.Reset();
        if (keepPage) return;
        la.PageOpen = false;
        try { await ModelCallAsync(PrismHost.Channel.HostCalls.VideoScout, ""); } catch { }
    }

    /// <summary>Watch settings turned the delay on or off: a new start either way (a session's back-off ends when the person asks again).</summary>
    private void SetLookAhead(bool on)
    {
        HostPrefs.Set("video.lookAhead", on);
        _lookStood = null; _lookHeldUrl = null; _look.AskedAt = -999;
        LogLine("look-ahead: turned " + (on ? "on" : "off") + " in Watch settings");
    }
}
