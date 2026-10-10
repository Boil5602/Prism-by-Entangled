using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace PrismHost.Services;

/// <summary>
/// A live channel's commercial break, read off the picture (2026-10-06, "Maybe we need to come up with a number of rules to follow for
/// YouTube tv ad detection to come back with a confidence interval for ads and veil them if above a certain percentage"). YouTube TV's
/// page and traffic say nothing during the channel's own breaks (a whole break recorded request by request changed nothing), so each
/// window's picture is scored, the way Comskip and MythTV flag commercials: every rule adds or takes evidence, and a two-state model
/// (show / break) with the usual lengths - a show runs about eight minutes between breaks, a break three and a half - turns the
/// evidence into the chance this is a break. Above 90% the window is covered; below 50% it is uncovered (cover slow, uncover fast).
///
/// The rules, each tuned on recorded frames labelled by eye (USA and FX, seven breaks):
///  - the channel's logo: its corner and its pattern are learned from the window's own show time (a steady mark in one corner while
///    the rest of the corner moves); missing = a break, present = the show. Matched by pattern, not by edges, so an advertiser's own
///    mark in the same corner does not pass for it. Learned once a channel, kept on disk, so a window tuned into a break knows it.
///  - a cut to black: breaks begin and end on one, so a black frame opens the door both ways for a few seconds.
///  - what the screen says (OCR, on the PC): a web address, a phone number, an app-store line - an ad ("if a web address or phone
///    number are on the screen, that's probably a pretty strong indicator"); credits and the rating card - the show. A web address
///    the channel shows during its show (a news channel's) is learned and no longer counts.
///  - time: a break is not called in its first seconds, and one that has run past five minutes is doubted.
/// No logo learned yet: only what the screen says can call a break, and it is let go quickly.
/// Measured on the recordings: 86-95% of break time covered, 0.3-4% of show time covered wrongly (FX's first seconds after a break
/// carry the rating badge before the logo returns).
/// </summary>
internal sealed class BreakModel
{
    public const int W = 320, H = 180;
    private const int CH = 45, CW = 80;
    private static readonly (int y, int x)[] Corners = { (0, 0), (0, 240), (135, 0), (135, 240) };
    private const float SteadyAt = 0.5f;

    private readonly float[][] _steady = new float[4][];   // how often each corner pixel has a strong edge
    private readonly float[][] _pattern = new float[4][];  // the corner's mean high-pass picture (the logo's shape and shade)
    private int _n;
    private int _corner = -1;
    private byte[]? _prev;
    private double _pb = 0.05;
    private double _lastBlack = -99, _since;
    private double _adTextAt = -99, _showTextAt = -99;
    // the reading of an ad's words before the last one, and when the logo was last plainly seen (the flat-corner rule below)
    private double _adTextPrevAt = -999, _logoUpAt = -99;
    // an ad's words with no logo to read (the bare rule below): its last two readings, and how long each word has stayed on screen
    private double _bareAdAt = -99, _bareAdPrevAt = -999;
    private readonly Dictionary<string, (double First, double Last)> _tokenSpan = new();
    private readonly Dictionary<string, double> _scenery = new();
    // a game's commentary (GameSaid): the game words heard lately, and when the commentary last said it is the game
    private readonly Queue<(double At, int N)> _gameWords = new();
    private double _gameSaidAt = -99;
    // the show's own card (below): only these start the minute and a half in which the logo alone covers nothing
    private double _showCardAt = -99;
    // a channel's promo for its own show ("Season finale, Friday 10/9c") carries its logo: seen inside a break, it holds the break (below)
    private double _promoAt = -99, _promoLogoAt = -1;
    // a network's banner over its own show ("ALL NEW ... SUNDAYS", "SEASON PREMIERE Tonight 9/8c"), and whether the cover up now came by the
    // quick re-cover (the rule a banner fools)
    private double _snipeAt = -99;
    private bool _quickCover;
    // the captions' last line: a show runs captions under its network's banner; a full-screen promo inside a break often has none
    private double _ccLineAt = -999;
    // a rating badge read on the screen ("14", "TV 14", "TV-PG": a show coming back), and whether the cover up now is the promo rule's
    private double _badgeAt = -99;
    private bool _promoCover;
    private static readonly Regex Badge = new(@"^\s*(tv[ -]?)?(14|pg|ma|y7|g)\s*$|tv[ -]?(14|pg|ma|y7)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex SnipeWords = new(@"all[- ]new|\b(sun|mon|tues|wednes|thurs|fri|satur)days\b|season premiere|series premiere|season finale|series finale|marathon|new episodes?|premieres?\b|(january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}\b|\btonight\b|\b\d{1,2}/\d{1,2}c\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private readonly Dictionary<string, int> _showTokens = new();   // ad-looking text seen while the logo is up: the channel's own

    public bool Active { get; private set; }
    public double LastAdTextAt => _adTextAt;
    public double Chance => _pb;
    public double? LogoScore { get; private set; }
    public bool HasLogo => _corner >= 0 && _n >= LearnFrames;
    /// <summary>Set when a learned logo was given up (missing longer than any break): the saved one is stale.</summary>
    public bool Relearned { get; set; }
    private const int LearnFrames = 480;   // eight minutes at a frame a second: longer than any break, so a window that opens on one (a
                                           // two-minute charity ad's phone bar and code sat still the whole time) still learns the show's mark
    private double _absentSince = -1, _startT = -1, _sureSince = -1, _showTextUsed = -99, _qrAt = -99;
    // the logo set aside: missing longer than a break with nothing else saying ad (2026-10-06, AMC showed no logo at all through a film's
    // first minutes - the old film carried it, the next did not - and the window was covered for seven); trusted again when it is back
    /// <summary>How long the chance must hold above 90% before a cover (tunable for the offline runs).</summary>
    internal static double SureSeconds = 30;   // logo alone: past the longest promo snipe seen (TLC's, 28 s, 2026-10-07; FX's banners 8 s); replayed on two morning passes, wrong covers 1.1% to 0.6%
    /// <summary>A break that ended this recently re-covers without the wait.</summary>
    internal static double RecoverSeconds = 45;
    private double _endedAt = -999, _cutAt = -999;
    private int _logoBack;
    private double _adSeenAt = -999, _wordSeenAt = -999;
    private bool _staleUntilLogo;
    private double _creditsAt = -999, _changedAt = -999;
    /// <summary>A cover lets go when no ad has said so for this long.</summary>
    internal static double StaleSeconds = 60;
    private bool _sureOnCut;
    internal static double ShowCardQuiet = 90;
    internal static double CutDiff = 60, CutWindow = 3, CutSureSeconds = 30;   // the same as the logo alone: a cut does not hurry it (a promo snipe at a scene cut covered TLC 18 s, 2026-10-07)
    private bool _suspended;
    private double _suspendedAt;
    private int _seenAgain;
    private bool _resumeSuspended;
    public bool Suspended => _suspended;
    /// <summary>The window's channel is near a program's start or end, as its guide lists it.</summary>
    public bool NearEdge { get; set; }
    /// <summary>The guide gave the window's program times (else credits are taken wherever they look like credits).</summary>
    public bool EdgeKnown { get; set; }
    /// <summary>The window's channel carries no commercials.</summary>
    public bool AdFreeChannel { get; set; }
    private double _dismissedUntil = -1;
    /// <summary>A Not an ad taken back (Ad debug's This is an ad right after it, 2026-10-07, "I had one I falsely reported not an ad then
    /// clicked this is an ad right after"): the window may be covered again at once. True when there was a hold to lift.</summary>
    public bool Undismiss(double t) { if (t >= _dismissedUntil) return false; _dismissedUntil = -1; return true; }
    /// <summary>The person's Not an ad still holds (five minutes): no cover, whoever decides.</summary>
    public bool DismissedAt(double t) => t < _dismissedUntil;
    /// <summary>The person said this is no ad (the card's Not an ad): uncovered now, nothing covers here for five minutes, and the pictures
    /// of the last minute are never learned.</summary>
    public bool Dismiss(double t)
    {
        _dismissedUntil = t + 300; _pb = 0.02; _sureSince = -1; _endedAt = -999; _changedAt = t;
        var was = Active; Active = false; return was;
    }
    /// <summary>The logo set aside by hand (a channel known to be showing none).</summary>
    public void SetAside() { _suspended = true; _resumeSuspended = true; _seenAgain = 0; }
    // the channel's own "logo present" level (2026-10-06: BBC America's small two-line mark matches at 0.15-0.3 in a dark film where USA's
    // and FX's match at 0.5-1, so fixed cut-offs called its film a break): the upper quarter of the last thirteen minutes of matches -
    // a break fills at most a third of that, so the show sets it
    private readonly Queue<double> _scores = new();
    private double _level = 0.6;
    public string Why { get; private set; } = "";
    /// <summary>Why a break the model is sure of is not covered yet (the test bench's reading; empty when covered or not sure).</summary>
    public string Hold { get; private set; } = "";
    private double _lastChange, _lastMean, _lastStd;
    /// <summary>The model's readings at t, for training a learned break detector (2026-10-07, "I love the idea of the trained model"): levels, and
    /// seconds since each kind of evidence was last seen (capped at 120). The names are <see cref="FeatureNames"/>.</summary>
    public static readonly string[] FeatureNames = { "logo", "logo_seen", "logo_ratio", "since_logo_up", "absent_for", "change", "mean", "std", "since_black", "since_cut",
        "since_ad_text", "since_show_text", "since_show_card", "since_promo", "since_snipe", "since_badge", "since_cc_ad", "since_cc_line", "since_game", "since_qr",
        "since_sound", "since_credits", "known_ad", "chance", "active", "near_edge", "has_logo", "set_aside", "game_words", "cue_on", "since_cue_stop", "since_cue_predict" };
    public double[] Features(double t)
    {
        double S(double at) => Math.Min(120, Math.Max(0, t - at));
        return new double[] { LogoScore ?? 0, LogoScore is null ? 0 : 1, LogoScore is { } l ? l / _level : 0, S(_logoUpAt), _absentSince < 0 ? 0 : Math.Min(600, t - _absentSince),
            _lastChange, _lastMean, _lastStd, S(_lastBlack), S(_cutAt), S(_adTextAt), S(_showTextAt), S(_showCardAt), S(_promoAt), S(_snipeAt), S(_badgeAt), S(_ccAdAt),
            S(_ccLineAt), S(_gameSaidAt), S(_qrAt), S(_soundAt), S(_creditsAt), KnownAd(t) ? 1 : 0, _pb, Active ? 1 : 0, NearEdge ? 1 : 0, HasLogo ? 1 : 0, _suspended ? 1 : 0,
            _gameWords.Where(x => t - x.At <= 300).Sum(x => x.N), t < _cueReadUntil ? 1 : 0, S(_cueStopAt), S(_cuePredictAt) };
    }

    public BreakModel() { for (var k = 0; k < 4; k++) { _steady[k] = new float[CH * CW]; _pattern[k] = new float[CH * CW]; } }

    /// <summary>One frame (W x H grey) at time t (seconds), dt seconds after the last. Returns true when Active changed.</summary>
    public bool Step(byte[] g, double t, double dt)
    {
        if (g.Length != W * H) return false;
        var change = _prev is null ? 0 : MeanAbsDiff(g, _prev);
        _lastChange = change;
        if (_prev is not null && change < 0.4) { if (_stillSince < 0) _stillSince = t; return false; }   // a still picture (paused, or a frozen page): no evidence
        _stillSince = -1;
        if (change >= CutDiff) _cutAt = t;   // a hard cut: the whole picture changed at once
        _prev = g;
        ReadInset(g, t);
        if (_startT < 0) { _startT = t; if (_resumeSuspended) { _suspendedAt = t; _resumeSuspended = false; } }
        if (t - _startT < 12) return false;   // the page's first seconds (black, a spinner): nothing to read yet
        double mean = 0, sq = 0;
        foreach (var v in g) { mean += v; sq += v * v; }
        mean /= g.Length; var std = Math.Sqrt(Math.Max(0, sq / g.Length - mean * mean));
        var black = mean < 20 && std < 8;
        _lastMean = mean; _lastStd = std;
        // credits (2026-10-06, "If we can avoid veiling credits, preferred"): a frame almost all black (rolling credits, a title card), or
        // the picture squeezed into the top or the left with the rest black (the end-credits squeeze with its "Next" promo). The logo goes
        // with them, so the logo alone never covers credits; an ad's own words, a QR code or a known ad picture still can
        if (!black && CreditsLook(g)) _creditsAt = t;
        var e = Edges(g); var hp = HighPass(g);
        var learn = (!HasLogo || _pb < 0.3) && !black;
        if (learn)
        {
            var a = _n < LearnFrames ? 1f / (_n + 1) : 1f / LearnFrames;
            for (var k = 0; k < 4; k++)
            {
                if (_corner >= 0 && k != _corner) continue;
                var (y0, x0) = Corners[k]; var s = _steady[k]; var p = _pattern[k];
                for (var y = 0; y < CH; y++)
                    for (var x = 0; x < CW; x++)
                    {
                        var i = (y0 + y) * W + x0 + x; var j = y * CW + x;
                        var rim = x0 + x < 3 || x0 + x > W - 4 || y0 + y < 3 || y0 + y > H - 4;   // the capture's own edge is not a mark
                        s[j] += a * ((!rim && e[i] > 25 ? 1f : 0f) - s[j]);
                        p[j] += a * (hp[i] - p[j]);
                    }
            }
        }
        _n++;
        if (_corner < 0 && _n >= LearnFrames)
        {
            int best = -1, bestN = 0;
            for (var k = 0; k < 4; k++) { var c = Count(_steady[k]); if (c > bestN) { bestN = c; best = k; } }
            if (bestN >= 15) _corner = best;
        }

        double llr = 0; var why = new List<string>();
        LogoScore = null;
        // a corner too flat to show the logo either way (a light logo on a light picture): no word from the logo on this frame
        var faint = false;
        // ... unless the faint corner still matches the logo plainly: then the logo is there (a dark scene's faint mark still says show)
        if (HasLogo && !black) { var m0 = LogoMatch(hp); faint = _logoContrast < MinLogoContrast && m0 / _level < 0.6; }
        if (faint) why.Add("logo can't be seen");
        if (HasLogo && !black && !faint)   // a black frame shows no logo and says nothing about one: it only marks a cut
        {
            var sc = LogoMatch(hp);
            LogoScore = sc;
            if (!Active) { _scores.Enqueue(sc); if (_scores.Count > 800) _scores.Dequeue(); }   // the level is the show's: never learned from a covered stretch
            // only once the history holds seven minutes, so the show outweighs any break in it (a window that restarted in a break set its
            // level from the break's own noise: 0.15, and an ad read as the show); until then the saved level, or 0.6
            if (_scores.Count >= 400 && _scores.Count % 20 == 0)
            {
                var sorted = _scores.OrderBy(x => x).ToArray();
                _level = Math.Clamp(sorted[(int)(sorted.Length * 0.75)], 0.2, 1.0);
            }
            var z = sc / _level;
            if (_suspended)
            {
                // set aside: no word either way until the mark is plainly back (two frames), then trusted again
                _seenAgain = z >= 0.6 ? _seenAgain + 1 : 0;
                if (_seenAgain >= 2) { _suspended = false; _absentSince = -1; why.Add("logo back"); }
                else if (t - _suspendedAt > 1200) { Reset(); var w0 = Active; Active = false; Why = "logo given up"; return w0; }
                else why.Add("logo set aside");
            }
            // uncover fast: the channel's logo plainly back two looks running ends a break at once (2026-10-06 22:00:45, Adult Swim's show
            // came back and the cover stayed nine seconds while the chance wound down)
            _logoBack = !_suspended && z >= 0.8 ? _logoBack + 1 : 0;
            // ... except under the channel's promo for its own show, which carries the logo (an Ad debug report 2026-10-07 08:42: USA's
            // "Anna Pigeon, season finale Friday 10/9c" came mid-break, the logo called the show and the promo played uncovered): a
            // promo's words hold a break that is already up, never start one, and at most 35 s from the logo's return (a show's own
            // banner for a coming episode comes mid-scene, rarely in the first seconds back)
            var promoHold = Active && t - _promoAt <= 5 && (_promoLogoAt < 0 || t - _promoLogoAt <= 35);
            if (promoHold && _logoBack >= 2 && _promoLogoAt < 0) _promoLogoAt = t;
            if (!Active || t - _promoAt > 5) _promoLogoAt = -1;
            if (promoHold) { _logoBack = 0; why.Add("promo"); }
            if (Active && _logoBack >= 2) _pb = Math.Min(_pb, 0.3);
            if (!_suspended)
            {
                llr += promoHold ? 1.0 : z < 0.12 ? 2.5 : z < 0.22 ? 1.0 : z < 0.4 ? -0.3 : z < 0.6 ? -1.2 : -2.5;   // a faint mark is still the show (a dark film)
                why.Add("logo " + sc.ToString("0.00") + "/" + _level.ToString("0.00"));
            }
            // missing longer than any break runs: the logo was learned wrong (a window that opened on a break, a badge taken for
            // it) or the channel changed its mark - learned again from here, and a break called on it is let go
            if (!_suspended)
            {
                if (z >= 0.6) { _absentSince = -1; _logoUpAt = t; }   // only a plain mark says the logo is there (a faint half-match kept the clock from ever running)
                else if (_absentSince < 0) _absentSince = t;
                // missing four minutes with nothing in the last minute saying ad, or six minutes whatever else: longer than any break
                // read (4:46 the longest) - the channel is showing no logo, not an ad
                var lastAd = Math.Max(_adTextAt, _qrAt);
                if (_absentSince >= 0 && (t - _absentSince > 360 || (t - _absentSince > 240 && t - lastAd > 60)))
                {
                    _suspended = true; _suspendedAt = t; _seenAgain = 0; _pb = Math.Min(_pb, 0.1);
                    why.Add("logo gone longer than a break");
                }
            }
        }
        // a cut to black
        if (black) { _lastBlack = t; why.Add("black"); _blacks.Enqueue(t); }
        ReadInsetTail(t);
        while (_blacks.Count > 0 && t - _blacks.Peek() > 8) _blacks.Dequeue();
        // what the screen says (read every few seconds; the reading lasts a little)
        // an ad's words count while the channel's logo is not plainly there (an ad never carries it; a speaker's banner or a news
        // channel's caption can name an address while it does) - and .edu and .gov are no advertiser's (C-SPAN2's "harvard.edu" backdrop
        // covered a talk for twelve seconds, 2026-10-06 19:03)
        var logoUp = LogoScore is { } lz && lz / _level >= 0.6;
        // the show's own words in the last ten seconds outweigh an ad's: a show can name a web address (Family Guy said "zillow.com" over its
        // opening credits and was covered four seconds, 2026-10-06 21:31)
        var showSaid = t - _showTextAt <= 10;
        // a game's commentary (GameSaid below) is the show: on a channel with no logo to read it holds off a cover, and under a cover that has
        // stood ten seconds it lifts it (the captions run a few seconds behind the picture, so a game's last words come after its break began)
        var gameSaid = t - _gameSaidAt <= 10;
        // ... and with a logo too, a new cover waits while the commentary goes on (TBS 17:27:33: the logo dipped for a replay graphic and a scrap
        // of the stadium's sign, "ig.com", covered the game two seconds after the commentary)
        var gameShow = gameSaid && (!HasLogo || _suspended || !Active || t - _since > 10);
        if (gameShow) { showSaid = true; llr -= 3.0; why.Add("game commentary"); }
        // an ad's words on the screen count only with the channel's learned logo plainly away: a show can put a phone number or an address
        // on screen too (Unbreakable's news broadcast showed "800-656-1482" with FX's logo just back, 2026-10-07 07:10, covered 14 s)
        var logoAway = HasLogo && !_suspended && LogoScore is { } la && la / _level < 0.3;
        // ... or with the corner too flat to read and the logo not plainly seen for 15 s, when the words come twice within eight seconds (an Ad
        // debug report 2026-10-07 10:54: USA's Progressive ad named progressive.com in eight readings over a flat corner and covered nothing,
        // because a corner that can't be seen says nothing either way). A light scene of the show still flashes its logo within 15 s, and its
        // phone number in a news banner is a single reading.
        var faintOk = faint && HasLogo && !_suspended && t - _logoUpAt >= 15 && _adTextAt - _adTextPrevAt <= 8 && t - _showTextAt > 60;   // and no show's words in the last minute: a film's credits end on its studio's address (Friends on TBS, www.warnerbros.com, 2026-10-07 10:30:41)
        // no logo to read (set aside, or not learned yet): an ad's own words still cover, read twice within eight seconds with no show's words
        // for a minute, and never words that have stayed on screen for 40 s (the scenery's: the ALDS backdrop's Booking.com). TBS's postseason
        // coverage (2026-10-07 15:34-16:00) carried no corner logo, the logo was set aside, and a break's Liberty Mutual, Grubhub and Bimzelx
        // addresses covered nothing: only a QR code did
        var bare = (!HasLogo || _suspended) && t - _bareAdAt <= 5 && _bareAdAt - _bareAdPrevAt <= 8 && t - _showTextAt > 60 && t - _gameSaidAt > 20;
        if (bare) why.Add("ad text, no logo");
        var adText = (t - _adTextAt <= 5 && (logoAway || faintOk) && !showSaid) || bare;
        if (adText && faintOk && !logoAway) why.Add("corner flat");
        if (adText) { llr += 3.0; why.Add("ad text"); }
        // words heard in the captions are weaker than words on the screen (a show's dialogue says brand names too): some weight, and only
        // with the channel's logo learned and away - never a cover on their own
        if (t - _ccAdAt <= 5 && HasLogo && !logoUp && !showSaid) { llr += 1.0; why.Add("ad words heard"); }
        else if (t - _showTextAt <= 5) { llr -= 3.0; why.Add("show text"); if (t - _showCardAt <= 5 && _showCardAt > _showTextUsed) { _showTextUsed = _showCardAt; _pb = Math.Min(_pb, 0.2); _endedAt = -999; } }   // the show's own card: no quick re-cover after it (FX's rating card, 2026-10-06 19:24, came before its logo)
        // a QR code on screen: an ad's (they asked to be scanned in a third of the breaks read; a show almost never carries one)
        if (t - _qrAt <= 5 && t - _adTextAt > 5 && !logoUp) { llr += 2.0; why.Add("qr code"); }
        // a picture seen in a break before, twice within eight seconds, with the channel's logo away: an ad Prism knows (AdPrints)
        var known = (KnownAd(t) || t - _soundAt <= 3) && HasLogo && !_suspended;
        if (known && !logoUp) { llr += 3.0; why.Add("known ad"); }

        if (!HasLogo || _suspended)
        {
            // no logo learned yet: only the screen's words call a break, and without them it is let go
            if (t - _adTextAt > 5 && t - _showTextAt > 5) llr -= 0.8;
        }
        var cut = t - _lastBlack <= 4;
        var pin = cut ? 0.08 : dt / 480; var pout = cut ? 0.08 : dt / 210;
        if (Active && t - _since > 300) pout = Math.Max(pout, dt / 30);
        var pb = _pb * (1 - pout) + (1 - _pb) * pin;
        var o = pb / (1 - pb) * Math.Exp(llr * dt / 2);
        _pb = Math.Clamp(o / (1 + o), 0.002, 0.995);
        Why = string.Join(", ", why);
        var was = Active;
        // cover slow: sure for four seconds (a dark close-up or a graphic over the logo reads as a break for a moment - 4 to 14 s flashes on
        // the show, 2026-10-06), or at once when the screen itself says ad; uncover fast
        if (_pb >= 0.9) { if (_sureSince < 0) { _sureSince = t; _sureOnCut = t - _cutAt <= CutWindow; } } else _sureSince = -1;
        // a logo that went at a hard cut is a break's start far more often than a banner (banners slide in over a running scene): its wait
        // is shorter (break starts 2026-10-06: the picture changed wholesale as the logo went; FX's banners came mid-scene)
        var wait = _sureOnCut ? CutSureSeconds : SureSeconds;
        // the show's own card ("The following program is rated...") says the show is starting: a film opens without its channel's logo for
        // a while, so for a minute and a half only the screen's words for an ad can cover (FX, 2026-10-06 19:24 and 19:38: covered 14-16 s)
        if (t - _showCardAt < ShowCardQuiet) wait = double.PositiveInfinity;
        // the network's banner over its own show while the show talks: the logo is under the banner, and alone it covers nothing (TLC 18:24:00,
        // "ER: Caught On Camera TONIGHT" sat over the logo past the 30 s wait and covered the show 17 s)
        if (t - _snipeAt <= 6 && t - _ccLineAt <= 8) wait = double.PositiveInfinity;
        // ... and at once when a break ended moments ago: a channel's own promo inside a break shows its logo for a few seconds, the
        // cover came down for it and the next ad played uncovered while the six seconds ran (BBC America, 2026-10-06 18:39:41)
        var justBroke = t - _endedAt < RecoverSeconds;
        // the wait depends on the evidence: the screen's own words for an ad (an address, a phone number, a QR code) or a break that ended
        // moments ago cover at once; the logo alone waits SureSeconds - a channel's promo banner over its own corner hides the logo for up to
        // eight seconds mid-show (FX's "The Drop" and "FX Presents" banners, 2026-10-06 18:56-19:04, covered by a four-second wait)
        // a known ad picture counts only with the channel's logo learned, trusted and away - never on a channel whose logo is set aside (C-SPAN2's
        // slides matched the library and covered a Supreme Court argument for ten minutes, 2026-10-06 22:28) - and it never by itself keeps a
        // cover going: only an ad's own words or a QR code do (the matches had fed their own learning)
        // ... and not in the half minute after a break ended: the show's return frames are the ones most like the break's last pictures
        var knownOk = (KnownAd(t) || t - _soundAt <= 3) && HasLogo && !_suspended && t - _changedAt > 30;   // a known ad's picture or its sound (AdSounds)
        var said = adText || ((t - _qrAt <= 5 || knownOk) && !logoUp && !showSaid);
        var worded = adText || (t - _qrAt <= 5 && !logoUp && !showSaid) || (t - _ccAdAt <= 5 && !showSaid);
        if (worded) _wordSeenAt = t;
        if (worded || (knownOk && !logoUp && !showSaid)) _adSeenAt = t;   // a trusted known ad keeps a cover; only words teach the library
        // a stale cover lets go near a program's edge (a film's logo-less opening); in the middle of a program a long break of ads that never
        // name themselves stays covered while the logo stays away (USA's cover lifted mid-break at 60 s, 2026-10-07 07:27:38)
        if (Active && (NearEdge || !EdgeKnown) && t - Math.Max(_adSeenAt, _since) > StaleSeconds) { _pb = Math.Min(_pb, 0.3); _staleUntilLogo = true; }
        // after a stale cover, the logo alone covers nothing until the logo has been plainly back (the next break) - an ad's own word still can
        if (_staleUntilLogo && _logoBack >= 2) _staleUntilLogo = false;
        if (_staleUntilLogo && !said) wait = double.PositiveInfinity;
        // credits come at a program's edges; elsewhere a dark frame is a dark scene or a dark ad (a whiskey ad's black frames lifted USA's
        // cover mid-break, 2026-10-07 07:04:31)
        var credits = t - _creditsAt <= 10 && (NearEdge || !EdgeKnown);
        if (credits && !said) wait = double.PositiveInfinity;
        if (Active && credits && t - _adSeenAt > 10) _pb = Math.Min(_pb, 0.3);   // a cover running into credits with no ad's word lets go
        // no flapping (2026-10-06 22:53-22:54, FX's cover went on and off every two or three seconds): a quick re-cover never over credits or a
        // stale cover; a cover holds at least eight seconds unless the logo is plainly back or the show's words are seen; an uncover holds eight
        // seconds unless an ad's own word comes
        // the guide's program edges (2026-10-06, "really tighten this up"): within three minutes of a program's start or two and a half of its end
        // (credits, a film's opening, its rating card - nearly every wrong cover of the evening) only an ad's own words or a QR code cover, and a
        // cover with none in its last 20 s lets go. A channel without commercials (C-SPAN, PBS) is never covered.
        if (NearEdge)
        {
            // the screen's words or a QR code; words only heard are never a cover on their own, here least of all (HGTV 17:00:56: a program's
            // credits under its "season premiere tonight" banner, covered 22 s on a caption's ad words)
            said = adText || (t - _qrAt <= 5 && !logoUp && !showSaid);
            wait = double.PositiveInfinity;
            if (Active && t - _wordSeenAt > 20) _pb = Math.Min(_pb, 0.3);
        }
        // a slot the stream itself marks as an ad covers at once and holds to its end (2026-10-07: FX's 60.5 s slot at 21:13:05, which the
        // page's own signal reported 23 s later)
        var cueOn = t < _cueUntil;
        if (cueOn) { said = true; _adSeenAt = t; _pb = Math.Max(_pb, 0.95); why.Add("the stream's ad cue"); }
        if (AdFreeChannel || t < _dismissedUntil) { said = false; wait = double.PositiveInfinity; _pb = Math.Min(_pb, 0.05); }
        // no quick re-cover in a game: the break's end is the game coming back, and its score bug comes and goes (TBS 17:37:47, a sponsored
        // pitching change right after the break hid it, and the quick re-cover covered the game 30 s)
        var inGame = _gameWords.Where(x => t - x.At <= 300).Sum(x => x.N) >= 6;
        var quick = justBroke && !credits && !_staleUntilLogo && !NearEdge && !AdFreeChannel && !inGame;
        var settled = t - _changedAt >= 8;
        Hold = Active || _sureSince < 0 ? "" : $"wait {wait:0}s sure {t - _sureSince:0}s said {said} settled {settled} stale {_staleUntilLogo} credits {credits} card {t - _showCardAt < ShowCardQuiet} near {NearEdge}";
        if (!Active && _sureSince >= 0 && (said || ((quick || t - _sureSince >= wait) && settled))) { Active = true; _since = t; _changedAt = t; _quickCover = !said && t - _sureSince < wait; _promoCover = false; }
        // a quick re-cover that turns out to be the network's banner over its own show lets go at once: the banner's words ("ALL NEW Sister Wives
        // SUNDAYS", TLC 17:43:40, covered 26 s) are read a moment after the logo went under it
        else if (Active && _quickCover && t - _since <= 12 && t - _snipeAt <= 4 && t - _ccLineAt <= 8 && !said) { Active = false; _changedAt = t; _endedAt = -999; _pb = Math.Min(_pb, 0.3); _quickCover = false; }
        // the hold only inside a break an ad has spoken in lately: a doubtful cover lifts at once
        // the show's rating badge comes up as it returns ("14" top-left: TLC 16:43:10 and 17:14:24, USA at every return; covers stayed 24 s
        // longer): a cover up twenty seconds with no ad's word lately lifts at once, and is not quickly put back
        else if (Active && t - _badgeAt <= 2 && t - _since > 20 && t - _adTextAt > 5 && t - _qrAt > 5) { Active = false; _changedAt = t; _endedAt = -999; _promoCover = false; _quickCover = false; }
        else if (Active && _promoCover && t - _badgeAt <= 2) { Active = false; _changedAt = t; _endedAt = -999; _promoCover = false; }   // the show's rating badge: it is back
        else if (Active && _pb < 0.35 && (settled || _logoBack >= 2 || showSaid || t - _adSeenAt > 20) && !(_promoCover && t - _since <= 30 && t - _ccLineAt > 8)) { Active = false; _changedAt = t; _endedAt = t - _showCardAt < ShowCardQuiet || _staleUntilLogo || credits ? -999 : t; }   // ended by the show's own card: no quick re-cover (FX 2026-10-06 19:52:41, the order of the two had undone it)
        // ... and the other way round: the network's own promo words on a screen with no captions, moments after a cover lifted, are the break
        // going on (USA 17:45:39: "WE'LL BE BACK", the logo back, then a full-screen promo for an SVU marathon ran 24 s uncovered). Only on a
        // channel whose captions ran lately (one with none at all says nothing by its silence)
        if (!Active && _endedAt > 0 && t - _endedAt <= 30 && t - _snipeAt <= 3 && t - _ccLineAt > 8 && t - _ccLineAt < 300 && _badgeAt < _endedAt && !NearEdge && !AdFreeChannel && t >= _dismissedUntil)
        { Active = true; _since = t; _changedAt = t; _quickCover = false; _promoCover = true; _pb = Math.Max(_pb, 0.9); Why += (Why.Length > 0 ? ", " : "") + "promo, no captions"; }
        // inside a slot the stream marks as an ad, nothing lifts the cover (a badge, a banner, a promo's end): it is up to the slot's end
        if (cueOn && !Active && !AdFreeChannel && t >= _dismissedUntil) { Active = true; _since = t; _changedAt = t; _quickCover = false; _promoCover = false; }
        return Active != was;
    }

    private static readonly Regex Url = new(@"\b(www\.[a-z0-9-]+|[a-z0-9-]{2,}\.(com|org|net|tv|app|io|ly|co|now|news|shop|store|ai|us|me|plus|health|live|link))\b(/[a-z0-9/-]*)?", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex Phone = new(@"\b1?[-. (]{0,2}[2-9]\d{2}[-. )]{1,2}\d{3}[-. ]\d{4}\b|\b1-8\d\d-[A-Z0-9-]{7,}\b", RegexOptions.Compiled);
    private static readonly Regex AdWords = new(@"[a-z0-9]+ dot com\b|call 1[- ]?8\d\d|1-800|toll[- ]free|download the app|app store|google play|get it on|terms apply|restrictions apply|see store|visit [a-z0-9-]+\.|call now|scan (the )?code|order now|order online|shop now|learn more|we.ll be right back|ask your doctor|side effects|tickets on sale|in theat(er|re)s|only in theat|stream(ing)? now|now streaming|free trial|limited time|while supplies last|see dealer|msrp|\bapr\b|% off|\$\d+(\.\d\d(/mo| a month| per month)?|/mo| a month| per month)|offer ends|sign up today|apply now|get started at|join now|become a member", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex PromoWords = new(@"set your dvr|season finale|series finale|season premiere|series premiere|\b\d{1,2}(:\d\d)?/\d{1,2}(:\d\d)?c\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    // a sports banner's sponsor ("2026 ALDS Booking.com coverage continues tbs") runs over the show as well as inside breaks: its address is
    // the sponsor's tag, not an ad's word (an Ad debug report 2026-10-07 08:47:58, TBS's banner hid the logo and covered Young Sheldon 4 s)
    private static readonly Regex SponsorTag = new(@"\bcontinues\b|presented by|brought to you by|\b(alds|nlds|alcs|nlcs)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    // the words of a show's own card, as against its credits (an Ad debug report 2026-10-07 09:24: a Chick-fil-A ad dressed as a film's
    // credits read "STARRING", and its minute and a half of quiet let the break run 50 s uncovered): a credit word still counts as the show's
    // own for ten seconds, but only the card - the rating notice, a viewer warning, the TV rating badge - or the show's line before the break
    // starts the quiet
    private static readonly Regex ShowCard = new(@"the following program|viewer discretion|\btv[- ]?(y7|y|g|pg|14|ma)[ -]+[dlsv]{1,4}\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ShowWords = new(@"directed by|produced by|executive producer|co-producer|written by|teleplay|created by|starring|the following program|viewer discretion|music by|pictures present|pictures and .{3,40} present|a film by|in association with|based on the (novel|book)|guest star|\btv[- ]?(y7|y|g|pg|14|ma)[ -]+[dlsv]{1,4}\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>What the screen said at time t (the text reader's lines). Returns the reason it counted, or null.</summary>
    private readonly Queue<double> _printHits = new();
    /// <summary>The fingerprint watch: this frame was (or was not) seen in a break before.</summary>
    public void PrintSeen(double t) { _printHits.Enqueue(t); while (_printHits.Count > 0 && t - _printHits.Peek() > 8) _printHits.Dequeue(); }
    /// <summary>A QR code seen at t (the bench's replay of a recorded reading).</summary>
    public void QrSeen(double t) => _qrAt = t;
    private double _soundAt = -999;
    /// <summary>The window's sound matched an ad heard before (AdSounds).</summary>
    public void SoundSeen(double t) => _soundAt = t;
    // the stream's own ad cue (YouTube TV's "Cuepoint-Event", read from the data its page hands the player): a marked slot is an ad, from its
    // START to its STOP or its announced length; a PREDICT_START only says one is coming
    // Two clocks (2026-10-08). The page reads a cue when the data is buffered, 14 to 31 s before it plays: that reading (CueRead) is
    // the learned detector's input "cue_on", as every recording it was trained on has it. The sure rule (CueOnAt, and the rules
    // below that stand down for a marked slot) goes by the cue as the playhead reaches it (CueSeen).
    private double _cueUntil = -1, _cueReadUntil = -1, _cueAt = -999, _cueStopAt = -999, _cuePredictAt = -999;
    /// <summary>Every rule says the show is on: the channel's logo plainly up, the rules' chance under 5%, no ad's words or QR code for ten
    /// seconds, no known ad picture, no marked slot. The learned detector may not start a cover then (2026-10-08 23:42-23:58: five covers of
    /// NBC Sports' WNBA game, a sport it had never seen, its logo plainly up).</summary>
    public bool PlainShow(double t) => LogoUpNow && _pb < 0.05 && t - _adTextAt > 10 && t - _qrAt > 10 && !KnownAd(t) && t >= _cueUntil;
    // ---- a ticker channel's inset picture (2026-10-08, NFL Network: twenty-odd "is an ad" reports in a morning) ----
    // The channel keeps its ticker - and in it its logo - on screen through a break and plays the ads in a picture drawn inset above it:
    // black margins of about 15 of 320 pixels down both sides, where its own programmes reach the edges. So the logo, the detector's word
    // for "the show is on", never leaves, and the breaks were missed. Read on the recorded frames: across a morning (09:00-12:14) the inset
    // came to 13 stretches of some two and a half minutes, 26% of the time, with 12 of the person's 17 presses inside them; overnight and
    // the evening before the same (6 to 7 an hour); and every frame looked at where the picture was inset but the marks said "show" was an
    // advertisement (15 of 15). A film shown 4:3 has margins of 40 pixels, not 15. The other five presses fell where the channel's local
    // ads play full screen with no ticker, which the logo's leaving already tells.
    /// <summary>The channel on now keeps its ticker up through its breaks (set by the window's watch): an inset picture is a break.</summary>
    public bool TickerChannel { get; set; }
    private double _insetSince = -1, _insetAt = -999, _insetFrameAt = -999;
    private int _fullRun;
    /// <summary>A break by the inset picture: inset for three seconds, until two frames running plainly reach an edge again (a dark shot
    /// inside an ad is neither) or twelve seconds pass with no inset frame.</summary>
    public bool InsetBreakAt(double t) => TickerChannel && !_insetProgramme && _insetSince >= 0 && _insetAt - _insetSince >= 3 && t - _insetAt <= 12;
    // ... unless the programme itself is shown inset (2026-10-09, 00:17-00:31: a Thursday night game's repeat, the game in the same
    // inset picture over the ticker as the ads around it, covered for thirteen minutes and counting). A break does not last six minutes:
    // inset for 330 s or more of the last ten minutes, the inset picture is the programme's own and the rule stands down, until the
    // picture has reached the edges for a minute running (the channel's usual programmes do). The channel's daytime breaks were inset
    // 150 s at a time, 26% of the hour; two of them back to back fall short of it.
    private bool _insetProgramme;
    private double _fullSince = -1, _insetSum, _insetPrev = -999;
    private readonly Queue<(double T, double Dt)> _insetSeen = new();
    /// <summary>The inset picture is the programme's own for now: the inset rule is standing down.</summary>
    public bool InsetProgramme => TickerChannel && _insetProgramme;
    // ... and the full-screen ads beside an inset break (2026-10-08, a report at 13:52: the cover lifted while one played). The stations'
    // own minute plays with no ticker at all, so there the ticker's logo is plainly AWAY - on a channel whose programmes always carry it.
    // For two minutes after the picture was last inset, the logo plainly away is still the break; the logo plainly back at two looks ends
    // it. On the marked hours this covers 36% to 53% of the ad time the inset misses, and the six stretches it covered that the marks
    // called show were advertisements (USAA, a campaign ad, EGO, Carhartt, two schedule promos).
    // It begins once the logo has been away four seconds running (the show's own way back in wipes over the ticker for three or four),
    // and then stays until the logo is plainly up at two looks running: read look by look it came and went inside one ad.
    private double _insetOnAt = -999, _tailAt = -999, _awaySince = -1;
    private int _tailUps;
    private bool _tailOn;
    public bool InsetTailAt(double t) => TickerChannel && _tailOn && t - _tailAt <= 3;
    private void ReadInsetTail(double t)
    {
        if (!TickerChannel) return;
        if (InsetBreakAt(t)) { _insetOnAt = t; _tailUps = 0; _awaySince = -1; _tailOn = false; return; }
        if (t - _insetOnAt > 120) { _tailOn = false; return; }
        if (LogoUpNow) { _awaySince = -1; if (++_tailUps >= 2) _tailOn = false; }
        else if (LogoAwayNow) { _tailUps = 0; if (_awaySince < 0) _awaySince = t; if (t - _awaySince >= 4) _tailOn = true; }
        if (_tailOn) _tailAt = t;
    }
    private void ReadInset(byte[] g, double t)
    {
        if (!TickerChannel) { _insetSince = -1; _fullRun = 0; _insetProgramme = false; _insetSeen.Clear(); _insetSum = 0; _fullSince = -1; return; }
        if (t - _insetFrameAt > 6) { _insetSince = -1; _fullRun = 0; }   // a gap in the frames: nothing is known across it
        _insetFrameAt = t;
        // the picture above the ticker and below a top band: rows 18 to 158 of 180
        int r0 = H / 10, r1 = H * 158 / 180, rows = r1 - r0;
        bool Dark(int x) { var s = 0; for (var y = r0; y < r1; y++) s += g[y * W + x]; return s < 14 * rows; }
        int left = 0, right = 0;
        while (left < W && Dark(left)) left++;
        if (left < W) while (right < W && Dark(W - 1 - right)) right++; else right = W;
        var inset = left >= 10 && left <= 24 && right >= 10 && right <= 24;
        var full = left < 4 || right < 4;   // the picture reaches an edge (an all-dark frame reaches neither, and says nothing)
        _fullRun = full ? _fullRun + 1 : 0;
        if (inset) { if (_insetSince < 0) _insetSince = t; _insetAt = t; }
        // how much of the last ten minutes was inset, by the seconds each inset frame stands for
        var dt = Math.Clamp(t - _insetPrev, 0.5, 3); _insetPrev = t;
        if (inset) { _insetSeen.Enqueue((t, dt)); _insetSum += dt; }
        while (_insetSeen.Count > 0 && t - _insetSeen.Peek().T > 600) _insetSum -= _insetSeen.Dequeue().Dt;
        if (full) { if (_fullSince < 0) _fullSince = t; } else if (inset) _fullSince = -1;
        if (!_insetProgramme && _insetSum >= 330) _insetProgramme = true;
        else if (_insetProgramme && _fullSince >= 0 && t - _fullSince >= 60) { _insetProgramme = false; _insetSeen.Clear(); _insetSum = 0; }
        if (_insetSince >= 0 && (_fullRun >= 2 || t - _insetAt > 12)) _insetSince = -1;
    }
    // the black frames of the last eight seconds (a frame is read about once a second)
    private readonly Queue<double> _blacks = new();
    /// <summary>A dark scene, not a cut: four or more black frames in the last eight seconds, and nothing an ad shows (its words, a QR code,
    /// a known ad picture, a marked slot). A cut to black at a break's edge is a frame or two; a night scene stays black for many seconds,
    /// the channel's logo unreadable all the while - and the learned detector reads "black, no logo" as a break. It may not start a cover
    /// then (2026-10-08 10:50-10:54, FX's Antlers on the big screen: six covers in four minutes, each with seven or eight of the last eight
    /// frames black, lifted when a lit shot showed the logo; "not an ad").</summary>
    public bool DarkScene(double t) => _blacks.Count >= 4 && t - _blacks.Peek() <= 8 && t - _adTextAt > 10 && t - _qrAt > 10 && !KnownAd(t) && t >= _cueUntil;
    // an infomercial (2026-10-08, "1 cover it": FX's overnight paid programming, a Shark vacuum and a coin set, flickered covered and not all
    // night): the same phone number on screen for minutes, where an ordinary ad shows one for less than one
    private readonly Dictionary<string, (double First, double Last, int N)> _phones = new();
    private double _infomercialAt = -999;
    /// <summary>An infomercial is on: one phone number read five times or more over two minutes or longer, the last time within 90 s (the
    /// reader catches the number only now and then: a 20 s hold flickered AMC's morning paid programming covered and not 26 times an hour).</summary>
    public bool InfomercialAt(double t) => t - _infomercialAt <= 90;
    // A paid programme that says so itself (2026-10-09, Food Network 05:30-06:00: "The following is a paid program for ..." stood on the
    // screen at 05:30:35, and "This is a paid program ..." again at 05:43 and 05:53; the guide gave the window no programme at all from
    // 04:30 to 07:50, so the Paid Programming rule had no title to read, no phone number stood, and the half hour was covered in pieces,
    // 17 minutes of its 30). The card is the screen's own statement: it covers to the end of its half hour (PaidSlotEnd). The shell
    // keeps the clock; the model only says when the card was last read and which wording.
    // "A paid advertisement" is not the card: a law firm's two-minute spot inside ordinary breaks says "THIS IS A PAID ADVERTISEMENT
    // FOR LEGAL SERVICES" (Food Network 2026-10-07 22:17 and 23:38, 2026-10-08 00:43 and 01:42), and would cover the show to the half hour.
    private static readonly Regex PaidCard = new(@"\b(the following|this) (is|was) a paid (program|programme|presentation)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    /// <summary>When a paid programme's own card was last read on the screen (-9999: never).</summary>
    public double PaidCardAt { get; private set; } = -9999;
    /// <summary>The card read last was the opening one ("The following is ..."), not one shown during the programme.</summary>
    public bool PaidCardFollowing { get; private set; }
    /// <summary>The end of the half hour a paid programme's card was read in: paid programmes are sold by the half hour. The opening card
    /// can come up to five minutes before its slot begins, and then the slot meant is the next one.</summary>
    public static DateTimeOffset PaidSlotEnd(DateTimeOffset at, bool following)
    {
        var left = 1800 - (at.Minute % 30 * 60 + at.Second);
        if (following && left < 300) left += 1800;
        return at.AddSeconds(left).AddMilliseconds(-at.Millisecond);
    }
    // A phone number standing on the screen with the channel's logo away keeps a cover (2026-10-08). The long call-now ads (CNN 09:19,
    // a Medicare supplement, 100 s; 09:39, a car warranty, 70 s; 10:42, windows, 95 s) are slow and talkative under one banner, and the
    // learned detector let go of them 10 to 30 s in: 263 s of the CNN exam's ad time, its largest loss. It never starts a break's
    // cover: a show can put a number up too, and then its logo is up with it.
    // The reader loses the number for a quarter of a minute at a time while the web address beside it stays, so an address carries the
    // hold on for 45 s after a number stood. An address alone holds nothing: a news banner's own ("CNN.COM/ABBY", 03:59, the overnight
    // repeat's logo read as away) held a cover over the show for a minute when it did; the channel's own address is left out as well.
    private readonly Dictionary<string, (double First, double Last, int N)> _stands = new();
    private double _phoneStandAt = -999, _addressStandAt = -999;
    private void Stand(string k, double t, bool phone)
    {
        var e = _stands.TryGetValue(k, out var v) && t - v.Last <= 20 ? (v.First, t, v.N + 1) : (t, t, 1);
        _stands[k] = e;
        if (e.Item3 >= 3 && e.Item2 - e.Item1 >= 6) { if (phone) _phoneStandAt = t; else _addressStandAt = t; }
        if (_stands.Count > 60) foreach (var old in _stands.Where(x => t - x.Value.Last > 120).Select(x => x.Key).ToList()) _stands.Remove(old);
    }
    /// <summary>The address begins with the channel's own name ("cnn.com/abby" on CNN, "foodnetwork.com" on Food Network).</summary>
    private bool OwnAddress(string address)
    {
        var a = address.ToLowerInvariant(); if (a.StartsWith("www.", StringComparison.Ordinal)) a = a[4..];
        var name = new string((ChannelName ?? "").ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
        var first = new string((ChannelName ?? "").ToLowerInvariant().TakeWhile(char.IsLetterOrDigit).ToArray());
        return (name.Length >= 2 && a.StartsWith(name, StringComparison.Ordinal)) || (first.Length >= 2 && a.StartsWith(first, StringComparison.Ordinal));
    }
    /// <summary>One phone number read three times or more over six seconds or longer, the last within twelve (or a web address so read
    /// within 45 s of the number), and the logo plainly away: a cover that is up, or was within twenty seconds, stays.</summary>
    public bool AdLineAt(double t) => LogoAwayNow && (t - _phoneStandAt <= 12 || (t - _addressStandAt <= 12 && t - _phoneStandAt <= 45));
    /// <summary>Inside a slot the stream marks as an ad.</summary>
    public bool CueOnAt(double t) => t < _cueUntil;
    /// <summary>The cue as the page read it from its buffer, ahead of the picture: the learned detector's inputs.</summary>
    public void CueRead(string ev, double dur, double pos, double t)
    {
        // read ahead of the picture, a slot's announcement or its start says one is COMING (until it arrives, CueSeen)
        if (ev is "EVENT_PREDICT_START" or "EVENT_START") _cueComingAt = t;
        if (ev == "EVENT_PREDICT_START") { _cuePredictAt = t; return; }
        if (ev is "EVENT_START" or "EVENT_CONTINUE") { _cueAt = t; _cueReadUntil = t + Math.Max(4, dur - pos) + 2; return; }
        if (ev == "EVENT_STOP") { _cueStopAt = t; _cueReadUntil = t; }
    }
    // One stream's own look-ahead (2026-10-09). The page reads a slot's marker 11 to 31 s before the slot plays, and its announcement
    // up to 15 s before that: for those seconds Prism knows an ad slot is about to start. A slot does not follow the show's return
    // within half a minute, so a cover that is up stays up until the slot arrives - the break is not over. On CNN, FX and Comedy
    // Central the slot sits inside the break and the learned detector let go in the seconds before it (CNN 09:59, 26 s; Comedy Central
    // 14:02, 31 s). It never starts a cover: where a slot opens the break (NBC Sports) the show is on until it does.
    private double _cueComingAt = -999;
    /// <summary>A marked slot has been read from the buffer and has not reached the screen yet (75 s at most).</summary>
    public bool CueComingAt(double t) => t - _cueComingAt <= 75 && t >= _cueUntil;
    /// <summary>The cue as the playhead reaches it: the slot is on the screen from now.</summary>
    public void CueSeen(string ev, double dur, double pos, double t)
    {
        if (ev is "EVENT_START" or "EVENT_CONTINUE") { _cueUntil = t + Math.Max(4, dur - pos) + 2; _cueComingAt = -999; return; }
        // a STOP marks the piece of the stream the slot ends IN, not the end: read in the page at 56.5 s of a 61 s slot, and the player's
        // own ad mark went off 4.3 s later (2026-10-08). The slot runs out its announced length (a piece is some 5 s)
        if (ev == "EVENT_STOP") _cueUntil = t + Math.Clamp(dur - pos, 0, 8);
    }
    private bool KnownAd(double t) { while (_printHits.Count > 0 && t - _printHits.Peek() > 8) _printHits.Dequeue(); return _printHits.Count >= 2; }
    /// <summary>A frame the watch may learn from: well inside a break it is sure of, the logo plainly away.</summary>
    /// <summary>The channel's learned logo is plainly away on this frame (the back-fill of a break's opening reads it frame by frame).</summary>
    /// <summary>The channel's learned logo is plainly there on this frame (the show, for the replay's count of false matches).</summary>
    /// <summary>When the break watch's cover went up (NaN with none): a Not an ad over it says how long the show was covered.</summary>
    public double ActiveSince => Active ? _since : double.NaN;
    public bool LogoUpNow => HasLogo && !_suspended && LogoScore is { } lu && lu / _level >= 0.6;
    public bool LogoAwayNow => HasLogo && !_suspended && LogoScore is { } lz && lz / _level < 0.3;
    public bool LearnableAt(double t) => Active && t - _since >= 15 && t - _wordSeenAt <= 20 && !_suspended && LogoScore is { } lz && lz / _level < 0.3;

    /// <summary>A break that was up when Prism closed, taken up again on the same channel (2026-10-07: every restart threw the running covers
    /// away and the windows' breaks played uncovered a minute while the watch began again). The logo plainly back still lifts it at once.</summary>
    public void ResumeBreak(double t) { Active = true; _since = t; _changedAt = t; _pb = 0.95; _adSeenAt = t; _wordSeenAt = t; _sureSince = t; }

    /// <summary>The program on now by the guide (set by the window's watch): its name on screen is the show's own banner.</summary>
    public string ShowTitle { get; set; } = "";
    /// <summary>The channel's name by the guide ("CNN"): an address carrying it is the channel's own, never an ad's.</summary>
    public string ChannelName { get; set; } = "";
    private static bool HasWord(string s, string w)
    {
        for (var i = s.IndexOf(w, StringComparison.OrdinalIgnoreCase); i >= 0; i = s.IndexOf(w, i + 1, StringComparison.OrdinalIgnoreCase))
        {
            var before = i == 0 || !char.IsLetterOrDigit(s[i - 1]);
            var after = i + w.Length >= s.Length || !char.IsLetterOrDigit(s[i + w.Length]);
            if (before && after) return true;
        }
        return false;
    }

    public string? Text(string text, double t, bool spoken = false)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        if (spoken) _ccLineAt = t;
        var flat = text.Replace('\n', ' ');
        if (!spoken && PaidCard.Match(flat) is { Success: true } pc) { PaidCardAt = t; PaidCardFollowing = pc.Value.StartsWith("the following", StringComparison.OrdinalIgnoreCase); }
        // the show's own name on screen is the show's banner, never an ad's (2026-10-07, "Seems confused by friends, keeps muting and calling
        // it an ad": TBS slid "Friends Back to Back Next" over its logo mid-scene, the logo read as gone and the quick re-cover covered the show)
        if (!spoken && ShowTitle.Length >= 4 && HasWord(flat, ShowTitle)) { _showTextAt = t; return "show: its own name (" + ShowTitle + ")"; }
        if (ShowWords.Match(flat) is { Success: true } sw) { _showTextAt = t; if (ShowCard.IsMatch(flat)) _showCardAt = t; return "show: " + sw.Value; }
        if (spoken && RepeatsBeforeBreak(flat, t) is { } rep) { _showTextAt = t; _showCardAt = t; return rep; }
        if (spoken && GameSaid(flat, t) is { } game) return game;
        string? promo = null;
        if (!spoken && PromoWords.Match(flat) is { Success: true } pw) { _promoAt = t; promo = "promo: " + pw.Value.ToLowerInvariant(); }
        if (!spoken && SnipeWords.IsMatch(flat)) _snipeAt = t;
        if (!spoken && Badge.IsMatch(flat.Trim())) _badgeAt = t;
        var tokens = new List<string>();
        foreach (Match m in Url.Matches(flat)) { tokens.Add(m.Value.ToLowerInvariant()); if (!spoken && !OwnAddress(m.Value)) Stand(m.Value.ToLowerInvariant(), t, phone: false); }
        foreach (Match m in Phone.Matches(flat))
        {
            var ph = Regex.Replace(m.Value, @"\D", "");
            tokens.Add(ph);
            if (!spoken && ph.Length >= 10)
            {
                var k = ph[^10..];   // the number without its leading 1
                var e = _phones.TryGetValue(k, out var v) && t - v.Last <= 120 ? (v.First, t, v.N + 1) : (t, t, 1);
                _phones[k] = e;
                if (e.Item3 >= 5 && e.Item2 - e.Item1 >= 120) _infomercialAt = t;
                Stand(k, t, phone: true);
                if (_phones.Count > 50) foreach (var old in _phones.Where(x => t - x.Value.Last > 600).Select(x => x.Key).ToList()) _phones.Remove(old);
            }
        }
        foreach (Match m in AdWords.Matches(flat)) tokens.Add(m.Value.ToLowerInvariant());
        if (tokens.Count == 0) return promo;
        // ... unless the logo has been gone a while already: the same banner runs full screen as a promo inside the break (TBS 07:46:40 and
        // 08:48:35, its ALDS promo), and over the show it hides the logo only for the moment it slides in
        if (SponsorTag.Match(flat) is { Success: true } st && !(_absentSince >= 0 && t - _absentSince >= 8)) return "sponsor tag: " + st.Value.ToLowerInvariant();
        // the channel's own furniture: an address shown while its logo is up (a news channel's) stops counting after three sightings
        if (LogoScore is > 0.5 && !Active)
        {
            foreach (var tk in tokens) _showTokens[tk] = _showTokens.TryGetValue(tk, out var c) ? c + 1 : 1;
            return null;
        }
        tokens.RemoveAll(Fragment);   // a scrap of an address (ig.com, tg.com) is no ad's word, logo or not
        // the channel's own address ("CNN.com/cnnweather" in CNN's banner over its show, covered 13 s at 22:00:52 before CNN's logo was learned)
        var own = Regex.Replace(ChannelName.ToLowerInvariant(), "[^a-z]", "");
        if (own.Length >= 3) tokens.RemoveAll(tk => Regex.Replace(tk.ToLowerInvariant(), "[^a-z]", "").Contains(own, StringComparison.Ordinal));
        if (tokens.Count == 0) return promo;
        foreach (var tk in tokens)
        {
            // the channel's furniture (an address seen three times with its logo plainly up), however the reader spells it (TBS 18:15:04 and
            // 18:22:37: "Booking.co" as the logo dipped covered the game)
            if (_showTokens.Any(x => x.Value >= 3 && SameStem(x.Key, tk))) continue;
            if (spoken) { _ccAdAt = t; return "ad: " + tk; }
            // a word that keeps coming back over 40 s is the scenery's, gaps of up to a quarter of an hour and all (the text reader
            // catches a backdrop now and then: the ALDS game's booking.com came 42 s apart, read as new, and covered the game 24 s,
            // 2026-10-07 16:19:45), and stays the scenery's for a quarter of an hour. An ad aired twice in that time is the price;
            // its pictures still cover it (AdPrints)
            var span = _tokenSpan.TryGetValue(tk, out var sp) && t - sp.Last <= 900 ? (sp.First, t) : (t, t);
            _tokenSpan[tk] = span;
            if (t - span.Item1 >= 40) _scenery[tk] = t;
            if (_tokenSpan.Count > 200) foreach (var old in _tokenSpan.Where(x => t - x.Value.Last > 900).Select(x => x.Key).ToList()) _tokenSpan.Remove(old);
            // the reader garbles a backdrop's address a new way each time (Booking.co, Booking.cem, &ooking.com, 16:03-16:59): a word sharing
            // five letters in a row with the scenery's is the scenery's (the no-logo rule's: on a channel with a logo, an ad aired twice in a
            // quarter of an hour would read as scenery and its cover lose its words, TLC 16:52 and 17:31 on the bench)
            _adTextPrevAt = _adTextAt; _adTextAt = t;
            if (_scenery.Any(x => t - x.Value < 900 && SameStem(x.Key, tk))) _scenery[tk] = t;
            else { _bareAdPrevAt = _bareAdAt; _bareAdAt = t; }
            return "ad: " + tk;
        }
        return null;
    }

    /// <summary>Two readings of the same words (the scenery rule): five letters in a row in common, ignoring everything but letters.</summary>
    private static bool SameStem(string a, string b)
    {
        if (a == b) return true;
        var x = new string(a.Where(char.IsLetter).ToArray()); var y = new string(b.Where(char.IsLetter).ToArray());
        for (var i = 0; i + 5 <= x.Length; i++) if (y.Contains(x.Substring(i, 5), StringComparison.Ordinal)) return true;
        return false;
    }
    /// <summary>An address with under four letters before its dot (tg.com, l.cnm): a piece of something the reader half saw.</summary>
    private static bool Fragment(string tk)
    {
        if (tk.StartsWith("www.", StringComparison.Ordinal)) tk = tk[4..];
        var dot = tk.IndexOf('.');
        if (dot < 0 || tk.Contains('/') || tk.Any(char.IsDigit) && !tk.Any(char.IsLetter)) return false;   // an address with a path is whole (ro.co/meganfox)
        return tk[..dot].Count(char.IsLetter) < 4;
    }

    // a game's own words (2026-10-07, "I think the captions should clue you into the show being on"): play-by-play names the inning, the
    // pitch, the bullpen, every few seconds, and an ad almost never does. Words an ad says as often (walk, count, base, plate, top, bottom)
    // are left out. Measured on TBS's ALDS coverage: 40% of the game's caption lines had one within eight seconds, no line of a break did.
    private static readonly HashSet<string> GameWords = new(StringComparer.Ordinal)
    {
        "inning", "innings", "pitch", "pitches", "pitched", "pitcher", "pitchers", "pitching", "strikeout", "strikeouts", "bullpen", "homer", "homers",
        "homered", "batter", "hitter", "hitters", "catcher", "dugout", "rbi", "rbis", "bunt", "slider", "fastball", "curveball", "changeup", "sinker",
        "cutter", "grounder", "flyout", "infield", "outfield", "shortstop", "umpire", "baserunner", "doubleplay", "southpaw", "lefty", "righty",
        "quarterback", "touchdown", "interception", "linebacker", "sideline", "endzone", "scrimmage", "punt", "rebound", "rebounds", "layup",
        "dunk", "pointer", "puck", "goalie", "faceoff", "powerplay", "penalty", "crossbar", "offside",
        // a replay review: the score bug (TBS's learned "logo" in a game) leaves the screen for the replay, and the commentary goes on in these
        // (17:28:13 and 17:28:50, both covered as breaks)
        "replay", "review", "overturned", "overturn", "foul", "umpires", "challenge",
    };
    /// <summary>A line of captions in a game's commentary: one of the game's words within eight seconds, on a channel whose captions have
    /// sounded like a game for a while (six game words in five minutes), so a drama that says "pitch" once is never a game.</summary>
    private string? GameSaid(string text, double t)
    {
        var n = 0;
        // ... and the teams the guide names ("Cleveland Guardians at Chicago White Sox"): the commentary says them all game long
        var teams = Regex.Matches(ShowTitle.ToLowerInvariant(), "[a-z]{4,}").Select(x => x.Value).Where(x => x is not "game" and not "series" and not "live" and not "postseason" and not "playoff" and not "playoffs").ToHashSet();
        foreach (Match m in Regex.Matches(text.ToLowerInvariant(), "[a-z]+")) if (GameWords.Contains(m.Value) || teams.Contains(m.Value)) n++;
        if (n > 0) _gameWords.Enqueue((t, n));
        while (_gameWords.Count > 0 && t - _gameWords.Peek().At > 300) _gameWords.Dequeue();
        if (n == 0) return null;
        var lately = _gameWords.Where(x => t - x.At <= 8).Sum(x => x.N);
        if (lately < 1 || _gameWords.Sum(x => x.N) < 6) return null;
        _gameSaidAt = t;
        return "show: the game's commentary";
    }

    // the show's last lines before a break (2026-10-07, an Ad debug report 08:54: HGTV came back on "Welcome to your new primary suite", the
    // line it left on, and the cover stayed eight seconds while its faint logo came up): a show often comes back on a moment it already
    // showed, and an ad never says the show's own words. Lines heard with the channel's logo plainly up (the show for sure, never the
    // break's first seconds before its cover) are kept for three minutes; inside a break, a line that shares three runs of three words
    // with them is the show's own text.
    private readonly List<(double At, HashSet<string> Grams)> _showLines = new();
    private double _logoPlainAt = -99;
    private static HashSet<string> Grams(string text)
    {
        var w = System.Text.RegularExpressions.Regex.Matches(text.ToLowerInvariant(), @"[a-z']+").Select(m => m.Value).ToArray();
        var g = new HashSet<string>();
        for (var i = 0; i + 2 < w.Length; i++) g.Add(w[i] + " " + w[i + 1] + " " + w[i + 2]);
        return g;
    }
    private string? RepeatsBeforeBreak(string text, double t)
    {
        _showLines.RemoveAll(x => t - x.At > 180);
        var g = Grams(text);
        if (g.Count == 0) return null;
        if (_suspended || !HasLogo) return null;
        if (LogoScore is { } up && up / _level >= 0.6) _logoPlainAt = t;
        if (!Active)
        {
            // heard with the logo plainly up or within ten seconds of it (a light scene hides a faint logo: HGTV's corner read nothing for
            // the line it left on) - a break's first ad lines come later than that, after the logo went at its cut
            if (t - _logoPlainAt <= 10) _showLines.Add((t, g));
            return null;
        }
        // ... and only with the logo not plainly away now: inside an ad the corner reads away, at the show's return it is faint or up
        if (LogoScore is { } now && now / _level < 0.3) return null;
        foreach (var (at, kept) in _showLines)
        {
            if (at > _since) continue;
            var n = g.Count(kept.Contains);
            if (n >= 3) return "show: the line before the break again";
        }
        return null;
    }

    /// <summary>A QR code on the text reader's picture (w x h grey): three finder squares of one size in an L. Marks the time when found.</summary>
    public bool Qr(byte[] g, int w, int h, double t)
    {
        if (g.Length != w * h) return false;
        var centers = new List<(int x, int y, int m)>();
        var segs = new List<(bool dark, int len, int x0)>();
        for (var y = 2; y < h - 2; y += 2)
        {
            // a row's own threshold: halfway between its dark and its light
            int lo = 255, hi = 0;
            for (var x = 0; x < w; x++) { var v = g[y * w + x]; if (v < lo) lo = v; if (v > hi) hi = v; }
            if (hi - lo < 60) continue;
            var th = (lo + hi) / 2;
            segs.Clear();
            var cur = g[y * w] < th; var x0 = 0;
            for (var x = 1; x <= w; x++)
            {
                var dark = x < w && g[y * w + x] < th;
                if (x < w && dark == cur) continue;
                segs.Add((cur, x - x0, x0)); cur = dark; x0 = x;
            }
            for (var k = 0; k + 4 < segs.Count; k++)
            {
                if (!segs[k].dark) continue;
                int r0 = segs[k].len, r1 = segs[k + 1].len, r2 = segs[k + 2].len, r3 = segs[k + 3].len, r4 = segs[k + 4].len;
                var tot = r0 + r1 + r2 + r3 + r4; var mod = tot / 7.0;
                if (tot < 7 || tot > 140) continue;
                if (!(Near(r0, mod) && Near(r1, mod) && Near(r2, 3 * mod) && Near(r3, mod) && Near(r4, mod))) continue;
                var cx = segs[k + 2].x0 + r2 / 2;
                if (Vertical(g, w, h, cx, y, th, mod)) centers.Add((cx, y, tot));
            }
        }
        // merge hits on the same square, then look for three of a size in an L
        var squares = new List<(double x, double y, double m, int n)>();
        foreach (var c in centers)
        {
            var i = squares.FindIndex(q => Math.Abs(q.x - c.x) < q.m / 2 && Math.Abs(q.y - c.y) < q.m / 2);
            if (i < 0) squares.Add((c.x, c.y, c.m, 1));
            else { var q = squares[i]; squares[i] = ((q.x * q.n + c.x) / (q.n + 1), (q.y * q.n + c.y) / (q.n + 1), (q.m * q.n + c.m) / (q.n + 1), q.n + 1); }
        }
        squares.RemoveAll(q => q.n < 2);
        for (var a = 0; a < squares.Count; a++)
            for (var b = 0; b < squares.Count; b++)
                for (var c = 0; c < squares.Count; c++)
                {
                    if (a == b || b == c || a == c) continue;
                    var (A, B, C) = (squares[a], squares[b], squares[c]);
                    if (Math.Abs(A.m - B.m) > A.m * 0.3 || Math.Abs(A.m - C.m) > A.m * 0.3) continue;
                    // A the corner: AB and AC the same length, square to each other, and a code's width apart (3 to 12 squares)
                    double abx = B.x - A.x, aby = B.y - A.y, acx = C.x - A.x, acy = C.y - A.y;
                    double ab = Math.Sqrt(abx * abx + aby * aby), ac = Math.Sqrt(acx * acx + acy * acy);
                    if (ab < A.m * 2 || ab > A.m * 12 || Math.Abs(ab - ac) > ab * 0.15) continue;
                    if (Math.Abs(abx * acx + aby * acy) > ab * ac * 0.15) continue;
                    _qrAt = t; return true;
                }
        return false;
    }
    private static bool Near(int run, double want) => Math.Abs(run - want) <= Math.Max(1.0, want * 0.6);
    private static bool Vertical(byte[] g, int w, int h, int cx, int cy, int th, double mod)
    {
        if (cx < 0 || cx >= w) return false;
        bool D(int y) => y >= 0 && y < h && g[y * w + cx] < th;
        // up and down from the centre: dark (the core), light, dark, then light past the edge - the same 1:1:3:1:1 across
        int up = 0; while (D(cy - up)) up++;
        var core = up; int down = 1; while (D(cy + down)) down++;
        core += down - 1;
        if (!(Math.Abs(core - 3 * mod) <= Math.Max(1.5, 3 * mod * 0.6))) return false;
        int y1 = cy - up, l1 = 0; while (y1 >= 0 && !D(y1)) { l1++; y1--; }
        int d1 = 0; while (y1 >= 0 && D(y1)) { d1++; y1--; }
        int y2 = cy + down, l2 = 0; while (y2 < h && !D(y2)) { l2++; y2++; }
        int d2 = 0; while (y2 < h && D(y2)) { d2++; y2++; }
        return Near(l1, mod) && Near(d1, mod) && Near(l2, mod) && Near(d2, mod);
    }

    private double _ccWordsAt = -99, _ccQuietSince = -1, _stillSince = -1, _ccAdAt = -99;
    /// <summary>How long the picture has stood still (seconds), 0 when it moves.</summary>
    public double StillFor(double t) => _stillSince < 0 ? 0 : t - _stillSince;
    /// <summary>A silence in the window's own sound (2026-10-06, "There will certainly be a total cut when transitioning from the show to the
    /// commercial and back"): a cut like a black frame - it opens the door both ways for a few seconds and counts as the hard cut a
    /// break's start is.</summary>
    public void Silence(double at)
    {
        // measured, not used (2026-10-07): shows fall silent for half a second and more all the time (1,947 silences on C-SPAN2 in an
        // evening, 15 in its covers; on FX 1,001 in the show, 179 in breaks) and the 15/30/60 s spacing of spots is as common in shows. Read
        // as a cut, a silence had shortened the logo's wait to three seconds in the middle of shows
        _silenceAt = at;
    }
    private double _silenceAt = -999;
    /// <summary>The captions' new words at time t and how long they have been quiet (ms; -1 never seen). Kept for the tuning: the
    /// quiet and the words are logged and read as text; how they weigh on a break is measured before it is decided.</summary>
    public void Captions(string words, double quietMs, double t)
    {
        if (words.Length > 0) _ccWordsAt = t;
        _ccQuietSince = quietMs >= 0 ? t - quietMs / 1000.0 : -1;
    }
    public double CaptionsQuietFor(double t) => _ccQuietSince < 0 ? -1 : t - _ccQuietSince;

    private double _logoContrast = 1;
    /// <summary>The corner's own contrast at the logo's pixels against the learned logo's: below this the picture cannot say whether the logo
    /// is there (a light logo over a light picture, 2026-10-07, "sometimes it is fooled by a light logo on a light background, but it's still
    /// there") and the logo gives no evidence either way.</summary>
    internal static double MinLogoContrast = 0.45;
    private double LogoMatch(float[] hp)
    {
        var (y0, x0) = Corners[_corner]; var s = _steady[_corner]; var p = _pattern[_corner];
        double sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0; var n = 0;
        for (var y = 0; y < CH; y++)
            for (var x = 0; x < CW; x++)
            {
                var j = y * CW + x; if (s[j] <= SteadyAt) continue;
                double a = hp[(y0 + y) * W + x0 + x], b = p[j];
                sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n++;
            }
        if (n < 15) return 0;
        var va = saa - sa * sa / n; var vb = sbb - sb * sb / n;
        _logoContrast = vb < 1e-3 ? 0 : Math.Sqrt(va / vb);
        if (va < 1e-3 || vb < 1e-3) return 0;
        return (sab - sa * sb / n) / Math.Sqrt(va * vb);
    }

    private void Reset()
    {
        for (var k = 0; k < 4; k++) { Array.Clear(_steady[k]); Array.Clear(_pattern[k]); }
        _n = 0; _corner = -1; _pb = 0.05; _absentSince = -1; LogoScore = null; Relearned = true; _scores.Clear(); _level = 0.6; _suspended = false;
    }

    private static bool CreditsLook(byte[] g)
    {
        static double Dark(byte[] g, int y0, int y1, int x0, int x1)
        {
            int n = 0, d = 0;
            for (var y = y0; y < y1; y += 2) for (var x = x0; x < x1; x += 2) { n++; if (g[y * W + x] < 25) d++; }
            return n == 0 ? 0 : d / (double)n;
        }
        var all = Dark(g, 0, H, 0, W);
        if (all > 0.9) return true;
        if (Dark(g, H * 2 / 3, H, 0, W) > 0.85 && Dark(g, 0, H / 2, 0, W) < 0.6) return true;   // squeezed up
        if (Dark(g, 0, H, W * 2 / 3, W) > 0.85 && Dark(g, 0, H, 0, W / 2) < 0.6) return true;   // squeezed left
        return false;
    }

    private static int Count(float[] s) { var c = 0; foreach (var v in s) if (v > SteadyAt) c++; return c; }

    private static double MeanAbsDiff(byte[] a, byte[] b)
    {
        long d = 0; for (var i = 0; i < a.Length; i += 3) d += Math.Abs(a[i] - b[i]);
        return d / (double)(a.Length / 3);
    }

    private static float[] Edges(byte[] g)
    {
        var e = new float[W * H];
        for (var y = 1; y < H - 1; y++)
            for (var x = 1; x < W - 1; x++)
            {
                var i = y * W + x;
                float gx = g[i + 1] - g[i - 1], gy = g[i + W] - g[i - W];
                e[i] = MathF.Sqrt(gx * gx + gy * gy);
            }
        return e;
    }

    /// <summary>The picture less its 9x9 local mean: the logo's own shape and shade, whatever is behind it.</summary>
    private static float[] HighPass(byte[] g)
    {
        var ii = new long[(W + 1) * (H + 1)];
        for (var y = 0; y < H; y++)
        {
            long row = 0;
            for (var x = 0; x < W; x++) { row += g[y * W + x]; ii[(y + 1) * (W + 1) + x + 1] = ii[y * (W + 1) + x + 1] + row; }
        }
        var hp = new float[W * H];
        for (var y = 0; y < H; y++)
        {
            int y0 = Math.Max(0, y - 4), y1 = Math.Min(H, y + 5);
            for (var x = 0; x < W; x++)
            {
                int x0 = Math.Max(0, x - 4), x1 = Math.Min(W, x + 5);
                var sum = ii[y1 * (W + 1) + x1] - ii[y0 * (W + 1) + x1] - ii[y1 * (W + 1) + x0] + ii[y0 * (W + 1) + x0];
                hp[y * W + x] = g[y * W + x] - sum / (float)((y1 - y0) * (x1 - x0));
            }
        }
        return hp;
    }

    // ---- kept per channel, so a window tuned into a break already knows the logo
    public void Save(string path)
    {
        if (!HasLogo) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            using var w = new BinaryWriter(File.Create(path));
            w.Write(3); w.Write(_corner); w.Write(_level);
            w.Write(_suspended ? DateTimeOffset.UtcNow.ToUnixTimeSeconds() : 0L);   // set aside when saved: still set aside after a restart
            foreach (var v in _steady[_corner]) w.Write(v);
            foreach (var v in _pattern[_corner]) w.Write(v);
        }
        catch { }
    }

    public static BreakModel Load(string path)
    {
        var m = new BreakModel();
        try
        {
            if (!File.Exists(path)) return m;
            using var r = new BinaryReader(File.OpenRead(path));
            var ver = r.ReadInt32(); if (ver < 1 || ver > 3) return m;
            var k = r.ReadInt32(); if (k < 0 || k > 3) return m;
            if (ver >= 2) m._level = Math.Clamp(r.ReadDouble(), 0.2, 1.0);
            var setAside = ver >= 3 ? r.ReadInt64() : 0L;
            for (var j = 0; j < CH * CW; j++) m._steady[k][j] = r.ReadSingle();
            for (var j = 0; j < CH * CW; j++) m._pattern[k][j] = r.ReadSingle();
            m._corner = k; m._n = LearnFrames;
            // a logo set aside within the last twenty minutes stays set aside (the channel is still showing none)
            if (setAside > 0 && DateTimeOffset.UtcNow.ToUnixTimeSeconds() - setAside < 1200) { m._suspended = true; m._suspendedAt = double.NegativeInfinity; m._resumeSuspended = true; }   // known: the four-minute wait is behind it
        }
        catch { return new BreakModel(); }
        return m;
    }
}
