using System;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Lyrics on the screen (2026-11-15, docs/features/lyrics.md): the lines of the song as the music service's own page draws them, the
/// line being sung in the middle and its words lit as they are sung. The service has the right to show its lyrics to its
/// subscriber; PRISM opens the page's own lyrics (core musicLyrics, a page action) and reads what the page draws, as it reads a video
/// page's captions (the adapter's __prismMusicLyrics). Nothing is fetched from anywhere and no line is kept: the lines live in this
/// view for as long as the song plays. A service whose adapter has no such route has no Lyrics button on the control bar.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _lyHost;
    private TextBlock? _lyPrev, _lyCur, _lyNext;
    private DispatcherTimer? _lyTimer;
    private string? _lyTile;
    private string _lySong = "", _lyShown = "";
    private int _lyCount = -1;
    private string[] _lyLines = Array.Empty<string>();
    private long _lyOpenAskedAt, _lyLinesAskedAt;
    private bool _lyBusy;

    private bool LyricsOn(string tile) => _lyTile == tile;

    private readonly System.Collections.Generic.Dictionary<string, bool> _lyCan = new();

    /// <summary>The control bar's Lyrics button: there only for a service whose adapter can read its lyrics, amber while they are on.</summary>
    private void SyncLyricsButton(VizChromeParts parts)
    {
        var tile = parts.Source;
        if (string.IsNullOrEmpty(tile)) { parts.Lyrics.Visibility = Visibility.Collapsed; return; }
        if (!_lyCan.TryGetValue(tile, out var can))
        {
            _lyCan[tile] = false;   // asked once a service; the answer comes with the next refresh
            _ = AskLyricsCanAsync(tile);
        }
        var on = LyricsOn(tile);
        parts.Lyrics.Visibility = can ? Visibility.Visible : Visibility.Collapsed;
        parts.LyricsIcon.Foreground = on ? Tokens.Amber : Tokens.Ink;
        ToolTipService.SetToolTip(parts.Lyrics, on ? "Lyrics are on. Press to take them off" : "Lyrics: the words of the song on the screen, lit as they are sung");
    }

    private async Task AskLyricsCanAsync(string tile)
    {
        try
        {
            var st = JsonNode.Parse(await ModelCallAsync("musicLyricsState", tile) ?? "null") as JsonObject;
            if (st is null) _lyCan.Remove(tile); else _lyCan[tile] = st["can"]?.GetValue<bool>() == true;   // no answer yet: asked again
        }
        catch { _lyCan.Remove(tile); }
    }

    /// <summary>Lyrics on for this service's page, or off (null).</summary>
    private void SetLyrics(string? tile)
    {
        if (_lyTile is { } was && was != tile) _ = ModelCallAsync("musicLyrics", was, false);
        _lyTile = tile;
        HostPrefs.Set("music.lyricsTile", tile ?? "");
        _lySong = ""; _lyCount = -1; _lyLines = Array.Empty<string>(); _lyShown = ""; _lyOpenAskedAt = 0;
        if (tile is null)
        {
            _lyTimer?.Stop();
            if (_lyHost is not null) _lyHost.Visibility = Visibility.Collapsed;
            LogLine("lyrics: off");
            return;
        }
        EnsureLyricsView();
        _lyTimer ??= NewLyricsTimer();
        _lyTimer.Start();
        LogLine("lyrics: on for " + tile);
    }

    /// <summary>The choice of the last session, once the pages are up.</summary>
    private void RestoreLyrics()
    {
        var t = HostPrefs.GetString("music.lyricsTile", "");
        if (t.Length > 0 && _lyTile is null) SetLyrics(t);
    }

    private DispatcherTimer NewLyricsTimer()
    {
        var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(200) };
        t.Tick += async (_, __) => { if (_lyBusy) return; _lyBusy = true; try { await LyricsTickAsync(); } catch { } finally { _lyBusy = false; } };
        return t;
    }

    private void EnsureLyricsView()
    {
        if (_lyHost is not null) return;
        _lyPrev = new TextBlock { FontSize = 26, Foreground = Tokens.Dim, TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap, HorizontalAlignment = HorizontalAlignment.Center };
        _lyCur = new TextBlock { FontSize = 46, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Tokens.Ink, TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap, HorizontalAlignment = HorizontalAlignment.Center };
        _lyNext = new TextBlock { FontSize = 26, Foreground = Tokens.Dim, TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap, HorizontalAlignment = HorizontalAlignment.Center };
        var col = new StackPanel { Spacing = 10, Children = { _lyPrev, _lyCur, _lyNext } };
        var plate = new Border { Background = Tokens.Scrim, CornerRadius = new CornerRadius(14), Padding = new Thickness(36, 20, 36, 22), Child = col, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(60, 0, 60, 110), MaxWidth = 1500 };
        _lyHost = new Grid { IsHitTestVisible = false, Visibility = Visibility.Collapsed, Children = { plate } };
        Canvas.SetZIndex(_lyHost, 900);   // over the tiles and their visualizations, under the pill and the bars
        RootGrid.Children.Add(_lyHost);
    }

    private async Task LyricsTickAsync()
    {
        if (_lyTile is not { } tile || _lyHost is null) return;
        // the Video player is on (its Watch grip shows): no lyrics over a video or the Watch page, and the music page is left asleep
        if (WatchGrip.Visibility == Visibility.Visible) { _lyHost.Visibility = Visibility.Collapsed; return; }
        var o = await LyricsAskAsync(tile, "read");
        if (o is null) { _lyHost.Visibility = Visibility.Collapsed; return; }
        var now = Environment.TickCount64;
        if (o["open"]?.GetValue<bool>() != true)
        {
            _lyHost.Visibility = Visibility.Collapsed;
            // the page's lyrics are closed (a new page, the first press): opened through core, a page action, at most every five seconds
            if (o["can"]?.GetValue<bool>() == true && (o["song"]?.GetValue<string>() ?? "").Length > 0 && now - _lyOpenAskedAt > 5000) { _lyOpenAskedAt = now; await ModelCallAsync("musicLyrics", tile, true); }
            return;
        }
        var song = o["song"]?.GetValue<string>() ?? ""; var n = o["n"]?.GetValue<int>() ?? 0; var cur = o["cur"]?.GetValue<int>() ?? -1;
        if ((song != _lySong || n != _lyCount) && now - _lyLinesAskedAt > 600)
        {
            _lyLinesAskedAt = now;
            var all = await LyricsAskAsync(tile, "lines");
            if (all?["lines"] is JsonArray la && (all["song"]?.GetValue<string>() ?? "") == song)
            {
                var lines = new string[la.Count];
                for (var i = 0; i < la.Count; i++) lines[i] = la[i]?.GetValue<string>() ?? "";
                _lyLines = lines; _lySong = song; _lyCount = n; _lyShown = "";
            }
        }
        var playing = o["playing"]?.GetValue<bool>() == true;
        if (!playing || cur < 0 || cur >= _lyLines.Length || song != _lySong) { _lyHost.Visibility = Visibility.Collapsed; return; }
        DrawLyrics(cur, o["words"] as JsonArray);
        _lyHost.Visibility = Visibility.Visible;
    }

    private async Task<JsonObject?> LyricsAskAsync(string tile, string cmd)
    {
        var raw = await _surfaces.EvalOnTileAsync(tile, "window.__prismMusicLyrics ? window.__prismMusicLyrics('" + cmd + "') : ''");
        if (raw is not { Length: > 2 } || raw.StartsWith("__prism_eval_error", StringComparison.Ordinal)) return null;
        try { return JsonNode.Parse(JsonSerializer.Deserialize<string>(raw) ?? "null") is JsonObject o && o["ok"]?.GetValue<bool>() == true ? o : null; }
        catch { return null; }
    }

    /// <summary>The line before, the line being sung with its sung words in amber, the line after. Drawn again only when something changed.</summary>
    private void DrawLyrics(int cur, JsonArray? words)
    {
        if (_lyPrev is null || _lyCur is null || _lyNext is null) return;
        var sig = new System.Text.StringBuilder().Append(cur).Append(':');
        if (words is not null) foreach (var w in words) sig.Append((w?["p"]?.GetValue<int>() ?? 0) >= 50 ? '1' : '0');
        var s = sig.ToString();
        if (s == _lyShown) return;
        _lyShown = s;
        string Near(int i, int step) { for (var k = i + step; k >= 0 && k < _lyLines.Length; k += step) if (_lyLines[k].Length > 0) return _lyLines[k]; return ""; }
        _lyPrev.Text = Near(cur, -1); _lyNext.Text = Near(cur, 1);
        _lyPrev.Visibility = _lyPrev.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        _lyNext.Visibility = _lyNext.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        _lyCur.Inlines.Clear();
        if (words is null || words.Count == 0) { _lyCur.Inlines.Add(new Run { Text = _lyLines[cur] }); return; }
        foreach (var w in words)
        {
            var sung = (w?["p"]?.GetValue<int>() ?? 0) >= 50;
            _lyCur.Inlines.Add(new Run { Text = (w?["w"]?.GetValue<string>() ?? "") + (w?["sp"]?.GetValue<bool>() == true ? " " : ""), Foreground = sung ? Tokens.Amber : Tokens.Ink });
        }
    }
}
