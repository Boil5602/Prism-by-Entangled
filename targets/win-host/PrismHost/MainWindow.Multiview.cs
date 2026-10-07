using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// Multiview (2026-09-23, "up to 3 PIPs, and a button to turn it on/off and one for swapping the video of focus to the next service
/// instantly"; "a quick change on the watch page too. So people can set their programs quickly for all 4"). Core keeps the windows and
/// places them (videoMultiview); the host draws the verbs: Multiview and Swap on the stage bar, the four windows as target chips on the
/// Watch page - a card press plays into the chosen window, and after a small window is filled the target steps to the next one and Watch
/// stays up, so all four can be set in a row. A press on a small window's shield brings it to the big place.
/// </summary>
public sealed partial class MainWindow
{
    private bool _mvOn;
    private int _mvTarget;
    private JsonArray _mvWindows = new();
    private int _mvMax = 5;
    /// <summary>The windows at most, big one included - core's word (MV_MAX), read with every state.</summary>
    private int MvMax => Math.Max(2, _mvMax);
    private StackPanel? _mvStrip;
    /// <summary>The big screen has a title playing or loading (core's big.has) - only then is a second window offered (2026-09-24).</summary>
    private bool _mvBigHas;
    /// <summary>What the big screen shows, for the strip with multiview off (Hulu, then the title).</summary>
    private string _mvBigWhat = "";

    private async Task<JsonObject?> MvCallAsync(string action, string? arg = null)
    {
        JsonObject? r = null;
        try { r = JsonNode.Parse(await ModelCallAsync("videoMultiview", action, arg) ?? "null") as JsonObject; } catch { }
        // the windows moved: each re-linked a moment later (2026-10-06, "Twitch in Windows 3 has disappeared and is currently showing a transparent
        // border" after a swap moved it there - B-295's see-through window, which a move alone does not bring back)
        if (action is "swap" or "focus" or "place" or "remove" or "order") _surfaces.NudgeSoon();
        if (r is not null && r["ok"]?.GetValue<bool>() != false)
        {
            _mvOn = r["on"]?.GetValue<bool>() == true;
            _mvTarget = r["target"] is JsonValue tv && tv.TryGetValue<int>(out var t) ? t : 0;
            _mvWindows = r["windows"] as JsonArray ?? new JsonArray();
            _mvBigHas = (r["big"] as JsonObject)?["has"]?.GetValue<bool>() == true;
            _mvBigWhat = r["big"] is JsonObject bg ? (bg["name"]?.GetValue<string>() ?? "") + (bg["title"]?.GetValue<string>() is { Length: > 0 } bt ? " \u00B7 " + Shorten(bt, 22) : "") : "";
            if (r["max"] is JsonValue mv && mv.TryGetValue<int>(out var mx)) _mvMax = mx;
            _mvBig = r["big"] as JsonObject;
            SyncWatchStack();   // Watch's corner places follow the windows (MainWindow.WatchScreens)
            SyncMvBars();   // a window opened, closed or swapped: its bar follows the controls at once
            PlaceStageBar();   // the controls follow the big window's place
            SyncMvIcon();   // the icon beside the tabs says on / off whichever control changed it (2026-09-24: it stayed gold after Turn off)
            SyncEmptyStage();   // the last window out: the empty stage (MultiviewDrag)
        }
        return r;
    }

    /// <summary>Before a card's pick: false when it plays into a small window - Watch stays up for the next one, the target steps on.</summary>
    private bool PickLeavesWatch(string title)
    {
        if (!_mvOn || _mvTarget <= 0) return true;
        var n = _mvTarget;
        SetPill("Prism \u00B7 " + Shorten(title, 40) + " \u2192 window " + (n + 1));
        _ = MvStepAfterAsync(n);
        return false;
    }
    /// <summary>The target steps to the next small window once the pick has reached core (it reads the target when the pick arrives).</summary>
    private async Task MvStepAfterAsync(int was)
    {
        await Task.Delay(1500);
        if (!_mvOn || _mvTarget != was) return;
        await MvCallAsync("target", (was >= MvMax - 1 ? 0 : was + 1).ToString());
        await Task.Delay(2500);   // the new window's page is up by now: its name on the chip
        await MvCallAsync("state");
        DrawMvStrip();
    }

    /// <summary>The Watch page's multiview row: off - one chip to turn it on; on - the four windows as targets, Swap and Turn off.</summary>
    private FrameworkElement MvStripHost()
    {
        _mvStrip = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, 4, 0, 6) };
        // the strip pops out from the multi-window icon (2026-09-23, "replace Multiview with a multi window icon button as well and animate the
        // popout to display the windows"): hidden until the icon is pressed, or while a card or a window is in the air
        _mvPop = new Border { Child = _mvStrip, Visibility = Visibility.Collapsed, Opacity = 0, RenderTransform = new TranslateTransform() };
        DrawMvStrip();
        _ = RedrawMvStripAsync();   // core's own word: multiview comes back on after a restart
        return _mvPop;
    }
    private Border? _mvPop;
    private bool _mvPopOpen;
    private Button? _mvIcon;
    /// <summary>Multiview as a multi-window icon beside the tabs: a press opens the windows strip (turning multiview on when it is off), again closes it.</summary>
    private Button? _clearChip;
    /// <summary>Clear screens on Watch's toolbar (2026-09-24, "from the watch window, I want to be able to clear all the video screens even if
    /// only 1 is playing"): shown while something is on a screen.</summary>
    private Button ClearScreensButton()
    {
        var b = Chip(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = {
            new FontIcon { Glyph = "\uE711", FontSize = 12, Foreground = HubInk },
            new TextBlock { Text = "Clear screens", FontSize = 13, Foreground = HubInk } } }, false);
        b.Height = 40; b.VerticalAlignment = VerticalAlignment.Center;
        ToolTipService.SetToolTip(b, "Close every video window and pause the big screen.");
        // shown while something is on a screen (2026-09-24, "Clear screens shouldnt be an option when nothing is on any screen"): multiview on,
        // or a title on the big screen; core's state is read as Watch opens so it is current
        b.Visibility = _mvOn || _mvBigHas ? Visibility.Visible : Visibility.Collapsed;
        b.Click += async (_, __) => await ClearScreensAsync();
        _ = MvCallAsync("state");
        _clearChip = b;
        return b;
    }
    private async Task ClearScreensAsync()
    {
        await MvCallAsync("state");
        var had = _mvOn || _mvBigHas;
        var r = await MvCallAsync("clearAll");
        if (r?["sceneId"]?.GetValue<string>() is { } sid) await SceneAppliedAsync(sid, r.ToJsonString());
        SetPill("Prism \u00B7 " + (had ? "screens cleared" : "nothing to clear"));
        DrawMvStrip();
        // in place, never the page drawn again (2026-09-25, "I pressed clear video and noticed all of my rows refresh. The videos I watched should've
        // just been fluidly added to continue watching"): the corner's screens follow core's word (MvCallAsync above), the head says Nothing
        // playing, and the rows take the watched titles in as they follow the services (FollowHubAsync, in place)
        if (VideoHubOpen && _hubHeadLine is { } hl)
        {
            hl.Children.Clear();
            hl.Children.Add(new TextBlock { Text = "Nothing playing", FontSize = 14, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
        }
        KickLiveRows();   // Continue watching takes what was just watched at once, a card fading in at its place
    }
    private void SyncMvIcon()
    {
        if (_clearChip is { } cc) cc.Visibility = _mvOn || _mvBigHas ? Visibility.Visible : Visibility.Collapsed;
        if (_mvIcon is not { } mi) return;
        if (!_mvOn) _mvPopOpen = false;
        mi.Visibility = _mvOn ? Visibility.Visible : Visibility.Collapsed;   // no switch: shown while there are windows to arrange (2026-09-24)
        mi.Background = _mvOn || _mvPopOpen ? HubChipOn : HubChip;
        if (mi.Content is FontIcon fi) fi.Foreground = _mvOn ? HubAmber : HubInk;
        mi.Visibility = _mvOn && _mvWindows.Count > 1 ? Visibility.Visible : Visibility.Collapsed;
        ToolTipService.SetToolTip(mi, "Swap: window 2 becomes the big one, at once, and its sound comes with it.");
    }
    private Button MvIconButton()
    {
        // Swap (2026-09-25): the windows strip this icon opened is gone (the corner's places are the windows), so it swaps instead
        var icon = new FontIcon { Glyph = "\uE8AB", FontSize = 18, Foreground = _mvOn ? HubAmber : HubInk };
        var b = Chip(icon, _mvOn || _mvPopOpen);
        b.Width = 40; b.Height = 40; b.Padding = new Thickness(0); b.CornerRadius = new CornerRadius(20);
        b.Visibility = _mvOn ? Visibility.Visible : Visibility.Collapsed;
        ToolTipService.SetToolTip(b, "Swap: press to choose a window, each press the next one, its number shown on it. Three seconds after your last press it becomes the big one, with its sound.");
        b.Click += (_, __) => SwapPress(null);   // MainWindow.SwapPick
        _mvIcon = b;
        return b;
    }
    /// <summary>The strip shown or hidden to match: in, it slides down and fades up, each window a beat after the last; out, it fades.</summary>
    private void SyncMvPop()
    {
        if (_mvPop is null || _mvStrip is null) return;
        var want = _mvStrip.Children.Count > 0;   // always shown (2026-09-24)
        var shown = _mvPop.Visibility == Visibility.Visible;
        var sb = new Microsoft.UI.Xaml.Media.Animation.Storyboard();
        Microsoft.UI.Xaml.Media.Animation.DoubleAnimation A(DependencyObject target, string prop, double from, double to, int ms, int delay = 0)
        {
            var a = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { From = from, To = to, Duration = TimeSpan.FromMilliseconds(ms), BeginTime = TimeSpan.FromMilliseconds(delay), EasingFunction = new Microsoft.UI.Xaml.Media.Animation.CubicEase { EasingMode = Microsoft.UI.Xaml.Media.Animation.EasingMode.EaseOut } };
            Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(a, target); Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(a, prop);
            sb.Children.Add(a); return a;
        }
        if (want && !shown)
        {
            _mvPop.Visibility = Visibility.Visible;
            A(_mvPop, "Opacity", 0, 1, 160);
            if (_mvPop.RenderTransform is TranslateTransform) A(_mvPop.RenderTransform, "Y", -14, 0, 220);
            var i = 0;
            foreach (var child in _mvStrip.Children.OfType<FrameworkElement>())
            {
                child.Opacity = 0; child.RenderTransform = new TranslateTransform();
                A(child, "Opacity", 0, 1, 180, 60 + i * 55);
                A(child.RenderTransform, "X", -18, 0, 240, 60 + i * 55);
                i++;
            }
            sb.Begin();
        }
        else if (!want && shown)
        {
            A(_mvPop, "Opacity", 1, 0, 120);
            sb.Completed += (_, __) => { if (!((_mvPopOpen || _stripDragging) && _mvStrip.Children.Count > 0)) _mvPop.Visibility = Visibility.Collapsed; };
            sb.Begin();
        }
    }
    private async Task RedrawMvStripAsync() { await MvCallAsync("state"); DrawMvStrip(); }
    /// <summary>The places the strip offers (2026-09-23, "only show Window 3 as an option if Window 2 has been filled. Window 4 if Window 3 is
    /// filled, window 5 if window 4 is filled"): the big window, every filled window, and the next one - never a run of empty ones.</summary>
    // a second window only once the big screen has something (2026-09-24, "Should screen 2 show if nothing has been added to screen 1?")
    private int MvShownPlaces() => _mvOn ? Math.Min(MvMax, Math.Max(1, _mvWindows.Count) + 1) : _mvBigHas ? 2 : 1;

    /// <summary>The strip's places as drop targets while a card or a window is in the air (MultiviewDrag); cleared when it is drawn plain.</summary>
    private readonly List<(FrameworkElement zone, int index)> _stripZones = new();
    private bool _stripDragging;

    private void DrawMvStrip()
    {
        if (_mvStrip is null) return;
        _mvStrip.Children.Clear();
        _stripZones.Clear();
        // always up on Watch (2026-09-24, "keep it up in watch at the top so I know what it is"; "I also should always see the big screen box in
        // watch"): the Big window box names what it shows, or that nothing is playing; Window 2 joins it once the big screen has something
        _mvStrip.Children.Add(new TextBlock { Text = "Play into", FontSize = 15, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 4, 0) });
        for (var i = 0; i < MvShownPlaces(); i++)
        {
            var w = _mvOn ? _mvWindows.OfType<JsonObject>().FirstOrDefault(x => x["index"] is JsonValue iv && iv.TryGetValue<int>(out var ii) && ii == i) : null;
            var what = w is null ? (!_mvOn && i == 0 ? (_mvBigHas && _mvBigWhat.Length > 0 ? _mvBigWhat : "nothing playing") : "empty") : (w["name"]?.GetValue<string>() ?? "") + (w["title"]?.GetValue<string>() is { Length: > 0 } t ? " \u00B7 " + Shorten(t, 22) : "");
            var sel = i == _mvTarget;
            var chip = Chip(new StackPanel
            {
                Spacing = 1,
                Children =
                {
                    new TextBlock { Text = i == 0 ? "Big window" : "Window " + (i + 1), FontSize = 12, Foreground = sel ? HubAmber : HubDim },
                    new TextBlock { Text = what, FontSize = 14, Foreground = sel ? HubAmber : HubInk, TextTrimming = TextTrimming.CharacterEllipsis },
                },
            }, sel);
            // one size for every place, wide enough for most titles (2026-09-24, "make the big window and small window boxes large enough they can fit
            // most things without cutting them off, but lock them so they dont keep moving the swap and turn off buttons"); the full name in the tooltip
            chip.Width = 280; chip.HorizontalContentAlignment = HorizontalAlignment.Left;
            var idx = i;
            ToolTipService.SetToolTip(chip, (w is not null ? what + "\n" : "") + (i == 0 ? "A card you press plays in the big window; what is there moves down and keeps playing." : "A card you press plays in small window " + (i + 1) + "; Watch stays up for the next.")
                + "\nOr hold a card and drag it here." + (w is not null ? " Drag this window onto another to trade places, or off the strip to take it out of multiview." : ""));
            chip.Click += async (_, __) => { await MvCallAsync("target", idx.ToString()); DrawMvStrip(); };
            if (w?["tile"]?.GetValue<string>() is { } wt) MakeChipDraggable(chip, wt, i);   // pulled onto another place it trades; anywhere else it leaves multiview
            _mvStrip.Children.Add(chip);
            _stripZones.Add((chip, i));
        }
        if (_stripDragging)
        {
            // in the air: the strip IS the target ("just drag them in place into the Big Screen + Window 2 ..."); Swap / Turn off wait
            _mvStrip.Children.Add(new TextBlock { Text = "Drop on a window \u00B7 anywhere else " + (_dragCard is not null ? "cancels" : "takes it out"), FontSize = 14, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 0, 0, 0) });
            SyncMvPop();
            return;
        }
        if (_mvOn)   // Swap and Clear all are multiview's; a single screen is cleared from the toolbar
        {
            var swap = Chip(new TextBlock { Text = "Swap", FontSize = 14, Foreground = HubInk }, false);
            ToolTipService.SetToolTip(swap, "The next window becomes the big one, at once; its sound comes with it.");
            swap.IsEnabled = _mvWindows.Count > 1;
            swap.Click += async (_, __) => { await MvCallAsync("swap"); DrawMvStrip(); };
            _mvStrip.Children.Add(swap);
            var clearAllStrip = Chip(new TextBlock { Text = "Clear all", FontSize = 14, Foreground = HubInk }, false);
            ToolTipService.SetToolTip(clearAllStrip, "Close every small window at once; the big one plays on.");
            clearAllStrip.IsEnabled = _mvWindows.Count > 1;
            clearAllStrip.Click += async (_, __) => await MvClearAllAsync();
            _mvStrip.Children.Add(clearAllStrip);
        }
        // no Turn off (2026-09-24): Clear all ends multiview; nothing hidden waits to come back
        SyncMvPop();
    }

    /// <summary>The small windows' bars follow the stage's controls: shown with them, gone with them - the accent outline alone stays.</summary>
    private void SyncMvBars()
    {
        var shown = StageBar.Visibility == Visibility.Visible;
        var now = new HashSet<string>();
        foreach (var w in _mvWindows.OfType<JsonObject>())
        {
            var id = w["tile"]?.GetValue<string>();
            if (id is not null) { _surfaces.SetFloatBarShown(id, shown); _surfaces.SetMvClose(id, _mvOn); now.Add(id); }   // every window, the big one too (it wears no bar, and may go small next)
        }
        foreach (var gone in _mvCloseShown.Where(x => !now.Contains(x)).ToList()) _surfaces.SetMvClose(gone, false);
        _mvCloseShown.Clear(); _mvCloseShown.UnionWith(now);
    }
    private readonly HashSet<string> _mvCloseShown = new();

    /// <summary>A window's X (2026-09-24): out of multiview, as a drag off the strip does - the windows after it move up a place (core's remove).</summary>
    private async Task MvRemoveWindowAsync(string tile)
    {
        var name = MvWindowName(tile);
        var r = await MvCallAsync("remove", tile);
        if (r?["ok"]?.GetValue<bool>() == false) { SetPill("Prism \u00B7 " + (r["error"]?.GetValue<string>() ?? "could not clear it")); return; }
        if (r?["sceneId"]?.GetValue<string>() is { } sid) await SceneAppliedAsync(sid, r.ToJsonString());
        SetPill("Prism \u00B7 " + Shorten(name, 40) + " cleared" + (_mvWindows.Count == 0 ? ". Nothing is playing now" : ""));
        DrawMvStrip();
        if (StageBar.Visibility == Visibility.Visible) await ShowStageBarAsync(true);
    }
    /// <summary>When each window's protected-video failure was last retried.</summary>
    private readonly Dictionary<string, DateTime> _drmRetried = new();
    /// <summary>A player reported no protected-video system (2026-09-24, "dont wait 90 seconds, autorepair when that 4 second message hits"): the
    /// page is loaded again at once - a failure is one failure now that Chromium's fallback is off. A second failure within 3 minutes is said
    /// plainly, and a multiview window that cannot play closes.</summary>
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    /// <summary>Windows is showing this session over Remote Desktop (SM_REMOTESESSION): protected video (PlayReady) is refused to every app.</summary>
    private static bool InRemoteSession() { try { return GetSystemMetrics(0x1000) != 0; } catch { return false; } }
    private async Task OnDrmFailedAsync(string tile)
    {
        var name = MvWindowName(tile);
        // over Remote Desktop no retry can help (2026-09-24: the session was rdp-tcp#0 - PlayReady refused to every service, Disney+ plays on
        // nothing else): said plainly, and a multiview window that cannot play closes
        if (InRemoteSession())
        {
            LogLine("drm repair: " + tile + " - remote session, protected video unavailable");
            SetPill("Prism \u00B7 " + Shorten(name, 40) + " can't play over Remote Desktop. Protected video needs the PC's own screen.");
            await MvCallAsync("state");
            var lead = _mvWindows.OfType<JsonObject>().FirstOrDefault()?["tile"]?.GetValue<string>();
            if (_mvOn && lead != tile && _mvWindows.OfType<JsonObject>().Any(w => w["tile"]?.GetValue<string>() == tile)) await MvRemoveWindowAsync(tile);
            return;
        }
        if (!_drmRetried.TryGetValue(tile, out var at) || (DateTime.UtcNow - at).TotalMinutes > 3)
        {
            _drmRetried[tile] = DateTime.UtcNow;
            LogLine("drm repair: " + tile + " reloaded after DRM_NO_SUPPORTED_KEY_SYSTEM");
            SetPill("Prism \u00B7 " + Shorten(name, 40) + ": its video protection failed, trying again");
            await _surfaces.EvalOnTileAsync(tile, "location.reload()");
            return;
        }
        LogLine("drm repair: " + tile + " failed again - reported");
        SetPill("Prism \u00B7 " + Shorten(name, 40) + " couldn't start its video protection twice. Restarting Prism usually clears it.");
        await MvCallAsync("state");
        var first = _mvWindows.OfType<JsonObject>().FirstOrDefault()?["tile"]?.GetValue<string>();
        if (_mvOn && first != tile && _mvWindows.OfType<JsonObject>().Any(w => w["tile"]?.GetValue<string>() == tile)) await MvRemoveWindowAsync(tile);
    }
    /// <summary>Clear all (2026-09-24, "a clear all button to do all at once"): every small window closes; the big one plays on, multiview ends.</summary>
    private async Task MvClearAllAsync()
    {
        var r = await MvCallAsync("close");
        if (r?["sceneId"]?.GetValue<string>() is { } sid) await SceneAppliedAsync(sid, r.ToJsonString());
        SetPill("Prism \u00B7 multiview cleared. The big window keeps playing");
        DrawMvStrip();
        if (StageBar.Visibility == Visibility.Visible) await ShowStageBarAsync(true);
    }

    /// <summary>The stage bar's multiview verbs: the switch, and Swap while there is more than one window.</summary>
    private async Task AddMvVerbsAsync(StackPanel bar)
    {
        await MvCallAsync("state");
        // no Multiview switch (2026-09-24): a title dragged onto a small window starts it; Clear all, or the last small window closing, ends it
        if (_mvOn && _mvWindows.Count > 1)
        {
            var swapText = new TextBlock { Text = SwapLabelText(), FontSize = 13, Foreground = HubInk };
            var swap = Chip(swapText, false);
            ToolTipService.SetToolTip(swap, "Press to choose a window: each press picks the next one, and the numbers show on the windows. Three seconds after your last press it becomes the big one, with its sound.");
            if (SwapChoosing) _swapLabels.Add(swapText);
            swap.Click += (_, __) => SwapPress(swapText);   // nothing moves until the choice settles (MainWindow.SwapPick)
            bar.Children.Add(swap);
            var clearAll = Chip(new TextBlock { Text = "Clear all", FontSize = 13, Foreground = HubInk }, false);
            ToolTipService.SetToolTip(clearAll, "Close every small window at once; the big one plays on.");
            clearAll.Click += async (_, __) => await MvClearAllAsync();
            bar.Children.Add(clearAll);
        }
    }

    /// <summary>Shift with Play / Pause (2026-09-23, "Shift + Pause = Pause all videos in multiscreen as well. Shift + Play = Play All, or still use
    /// the individual play/pause buttons as needed"): with multiview on, every window takes the verb; without Shift, only the one it belongs to.
    /// The big window keeps the sound - a small window's play never takes it (core).</summary>
    private bool MvAllCommand(string cmd)
    {
        if (!_mvOn || (cmd != "play" && cmd != "pause") || _mvWindows.Count < 2) return false;
        if ((Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Windows.System.VirtualKey.Shift) & Windows.UI.Core.CoreVirtualKeyStates.Down) == 0) return false;
        foreach (var w in _mvWindows.OfType<JsonObject>()) if (w["tile"]?.GetValue<string>() is { } t) _brain.Call(HostCalls.TileCommand, t, cmd);
        SetPill("Prism \u00B7 " + (cmd == "pause" ? "paused" : "playing") + " all " + _mvWindows.Count + " windows");
        return true;
    }
    /// <summary>The Play / Pause tooltip's second line while Shift has something to reach.</summary>
    private string MvAllTip(string cmd) => _mvOn && _mvWindows.Count > 1 && (cmd == "play" || cmd == "pause") ? "\nShift-click: " + (cmd == "pause" ? "pause" : "play") + " all " + _mvWindows.Count + " windows" : "";

    /// <summary>A press on a window's shield: a small window comes to the big place; the big one shows the stage bar as before.</summary>
    private async Task<bool> MvShieldPressedAsync(string tileId)
    {
        if (!_mvOn) return false;
        await MvCallAsync("state");
        var first = _mvWindows.OfType<JsonObject>().FirstOrDefault()?["tile"]?.GetValue<string>();
        if (!_mvWindows.OfType<JsonObject>().Any(w => w["tile"]?.GetValue<string>() == tileId) || first == tileId) return false;
        await MvCallAsync("focus", tileId);
        if (StageBar.Visibility == Visibility.Visible) await ShowStageBarAsync(true);   // the bar speaks for the new big window
        return true;
    }
}
