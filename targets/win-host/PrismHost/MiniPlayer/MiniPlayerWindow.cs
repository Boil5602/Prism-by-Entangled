using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Windows.Graphics;
using PrismHost.Core;
using PrismHost.Surfaces.Visualization;

namespace PrismHost.MiniPlayer;

/// <summary>
/// B-221 (2026-09-16): the mini player. "A button that sends the music player to a mini player (always on top of
/// other windows), no title bar ... a little 3D bevelled version of the graphic scene that is currently selected ...
/// with the controls on the screen, but hiding controls until mouseover."
///
/// A second window of the host, always on top, no border or title bar, drawing the stage's current visual live: a
/// second VisualizationHost on the same style, source and audio bands (the stage's own scene is XAML shapes moved by
/// the bands, so a small copy sways exactly as the wall does). The scene sits in a bevelled frame - lit top-left edge,
/// shadowed bottom-right, a soft drop shadow, a slight perspective tilt - so it reads as a little 3D tile. The transport
/// (previous, play/pause, next, mute, the song) fades in when the pointer is over it and out a second after it leaves.
/// Drag anywhere to move it; Escape or a double-click brings the full player back. Its place is remembered (host prefs).
///
/// The music keeps playing from the main window's hidden pages: this is a window of the same host, not another app,
/// and everything else - sign-in, settings, the scenes - stays in the full player (the person's call, 2026-09-16).
/// This file is plain ASCII: every glyph is a char code, never an escape (the host's sources are mixed encodings).
/// </summary>
public sealed class MiniPlayerWindow : Window
{
    public const int DefaultWidth = 400, DefaultHeight = 225;   // "I'm okay with the mini player being larger, it's very small" (2026-09-17)
    /// <summary>"We should be able to resize the mini player up to 4x this size. This is a great minimum" (2026-09-17): 16:9 from 400 wide to 1600.</summary>
    public const int MinWidth = 400, MaxWidth = 1600;
    private const string PrefX = "miniPlayerX", PrefY = "miniPlayerY", PrefW = "miniPlayerW";
    private double _widthDip = DefaultWidth;

    private static readonly string GlyphPrev = ((char)0xE892).ToString(), GlyphNext = ((char)0xE893).ToString();
    private static readonly string GlyphPlay = ((char)0xE768).ToString(), GlyphPause = ((char)0xE769).ToString();
    private static readonly string GlyphAudioOn = ((char)0xE767).ToString(), GlyphAudioOff = ((char)0xE74F).ToString();
    private static readonly string GlyphRestore = ((char)0xE740).ToString();
    private static readonly string GlyphLike = ((char)0xE8E1).ToString(), GlyphDislike = ((char)0xE8E0).ToString();   // B-155's thumbs, "still accessible in the mini player" (2026-09-17)   // FullScreen (arrows outward: expand) - back to the full player

    private static readonly Windows.UI.Color Ink = Windows.UI.Color.FromArgb(255, 0xE8, 0xEC, 0xF2);
    private static readonly Windows.UI.Color Amber = Windows.UI.Color.FromArgb(255, 0xF2, 0xB1, 0x4C);
    private static readonly Windows.UI.Color Matte = Windows.UI.Color.FromArgb(255, 0x0C, 0x0D, 0x12);

    private readonly Grid _root = new();
    private readonly Grid _sceneHost = new();
    private readonly Grid _controls = new();
    private readonly TextBlock _title = new(), _artist = new(), _from = new();
    private readonly Grid _meta = new();
    private readonly FontIcon _playIcon = new() { FontSize = 16 }, _muteIcon = new() { FontSize = 14 };
    private readonly FontIcon _prevIcon = new() { FontSize = 13 }, _nextIcon = new() { FontSize = 13 }, _backIcon = new() { FontSize = 13 };
    private readonly FontIcon _upIcon = new() { FontSize = 13, Glyph = GlyphLike }, _downIcon = new() { FontSize = 13, Glyph = GlyphDislike };
    private Button _up = null!, _down = null!;
    private Button _prev = null!, _play = null!, _next = null!, _mute = null!, _back = null!;
    private readonly DispatcherTimer _hide = new() { Interval = TimeSpan.FromMilliseconds(1100) };
    private VisualizationHost? _viz;
    private bool _playing, _muted, _shown, _placed;
    private double _scale = 1;

    // drag: the pointer's grab offset inside the window, in physical pixels
    private bool _dragging;
    private uint _dragPointer;

    /// <summary>A transport press: play | pause | prev | next | mute | unmute.</summary>
    public event Action<string>? Command;
    /// <summary>Escape or a double-click: bring the full player back.</summary>
    public event Action? ReturnRequested;
    public Action<string>? Log;

    public MiniPlayerWindow()
    {
        Title = "Prism mini player";
        _root.Background = new SolidColorBrush(Matte);
        _root.RequestedTheme = ElementTheme.Dark;

        // ---- the bevel: an outer lit edge, an inner shadowed edge, the scene tilted a touch inside
        var outer = new Border
        {
            Margin = new Thickness(6), CornerRadius = new CornerRadius(12), BorderThickness = new Thickness(3),
            BorderBrush = Diagonal(Windows.UI.Color.FromArgb(255, 0x8C, 0x93, 0xA6), Windows.UI.Color.FromArgb(255, 0x2A, 0x2D, 0x3A), Windows.UI.Color.FromArgb(255, 0x0A, 0x0B, 0x10)),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x16, 0x18, 0x20)),
        };
        var inner = new Border
        {
            CornerRadius = new CornerRadius(9), BorderThickness = new Thickness(2),
            BorderBrush = Diagonal(Windows.UI.Color.FromArgb(255, 0x05, 0x06, 0x09), Windows.UI.Color.FromArgb(255, 0x20, 0x22, 0x2C), Windows.UI.Color.FromArgb(255, 0x6E, 0x74, 0x86)),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x10, 0x12, 0x18)),
        };
        var sceneFrame = new Border { CornerRadius = new CornerRadius(7), Margin = new Thickness(3) };
        _sceneHost.Projection = new PlaneProjection { RotationX = 5, RotationY = -4, CenterOfRotationX = 0.5, CenterOfRotationY = 0.5 };
        sceneFrame.Child = _sceneHost;
        // a faint sheen down the top, the way light catches a bevelled tile
        var sheen = new Border
        {
            IsHitTestVisible = false, CornerRadius = new CornerRadius(7), Margin = new Thickness(3), VerticalAlignment = VerticalAlignment.Top, Height = 46,
            Background = new LinearGradientBrush
            {
                StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(0, 1),
                GradientStops = { new GradientStop { Color = Windows.UI.Color.FromArgb(0x30, 0xFF, 0xFF, 0xFF), Offset = 0 }, new GradientStop { Color = Windows.UI.Color.FromArgb(0x00, 0xFF, 0xFF, 0xFF), Offset = 1 } },
            },
        };
        var innerGrid = new Grid();
        innerGrid.Children.Add(sceneFrame);
        innerGrid.Children.Add(sheen);
        innerGrid.Children.Add(BuildMeta());
        innerGrid.Children.Add(BuildControls());
        inner.Child = innerGrid;
        outer.Child = inner;
        _root.Children.Add(outer);

        // ---- the controls show while the pointer is over the window, and a beat after it leaves
        _root.PointerEntered += (_, __) => { _hide.Stop(); ShowControls(true); };
        _root.PointerExited += (_, __) => _hide.Start();
        _hide.Tick += (_, __) => { _hide.Stop(); if (!_dragging) ShowControls(false); };

        // ---- drag anywhere (a press on a button is the button's - it marks the event handled first)
        _root.PointerPressed += OnRootPressed;
        _root.PointerMoved += OnRootMoved;
        _root.PointerReleased += OnRootReleased;
        _root.PointerCaptureLost += (_, __) => EndDrag();
        _root.PointerWheelChanged += (_, e) =>
        {
            // the wheel over the tile steps its size, a notch at a time, between the minimum and four times it
            var delta = e.GetCurrentPoint(_root).Properties.MouseWheelDelta;
            if (delta == 0) return;
            ResizeTo(_widthDip + (delta > 0 ? 40 : -40));
            e.Handled = true;
        };
        _root.DoubleTapped += (_, e) => { e.Handled = true; ReturnRequested?.Invoke(); };
        _root.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Escape) { e.Handled = true; ReturnRequested?.Invoke(); } };
        _root.IsTabStop = true;
        _root.Loaded += (_, __) => { _root.Focus(FocusState.Programmatic); Place(); };

        Content = _root;
        Closed += (_, __) => { try { _hide.Stop(); _viz?.Dispose(); _viz = null; } catch { } };
    }

    /// <summary>The song, the artist, and where it plays from ("All Hits Radio (middot) Amazon Music") - always on the tile,
    /// bottom-left, on a soft scrim; only the controls wait for the pointer ("can we still show the song name, artist, and
    /// station or playlist name, and service name", 2026-09-17).</summary>
    private Grid BuildMeta()
    {
        _meta.VerticalAlignment = VerticalAlignment.Bottom;
        _meta.HorizontalAlignment = HorizontalAlignment.Stretch;
        _meta.Margin = new Thickness(3, 0, 3, 3);
        _meta.Padding = new Thickness(12, 30, 12, 9);
        _meta.IsHitTestVisible = false;
        _meta.Background = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(0, 1),
            GradientStops = { new GradientStop { Color = Windows.UI.Color.FromArgb(0x00, 0x08, 0x09, 0x0E), Offset = 0 }, new GradientStop { Color = Windows.UI.Color.FromArgb(0xB4, 0x08, 0x09, 0x0E), Offset = 0.55 }, new GradientStop { Color = Windows.UI.Color.FromArgb(0xD8, 0x08, 0x09, 0x0E), Offset = 1 } },
        };
        var col = new StackPanel { Spacing = 1, HorizontalAlignment = HorizontalAlignment.Left, MaxWidth = 250 };
        _title.FontSize = 14; _title.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; _title.Foreground = new SolidColorBrush(Ink); _title.TextTrimming = TextTrimming.CharacterEllipsis;
        _artist.FontSize = 12; _artist.Foreground = new SolidColorBrush(Ink); _artist.TextTrimming = TextTrimming.CharacterEllipsis;
        _from.FontSize = 11; _from.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x8A, 0x93, 0xA2)); _from.TextTrimming = TextTrimming.CharacterEllipsis;
        col.Children.Add(_title); col.Children.Add(_artist); col.Children.Add(_from);
        _meta.Children.Add(col);
        return _meta;
    }

    private Grid BuildControls()
    {
        _controls.VerticalAlignment = VerticalAlignment.Bottom;
        _controls.HorizontalAlignment = HorizontalAlignment.Right;
        _controls.Margin = new Thickness(3, 0, 3, 3);
        _controls.Padding = new Thickness(10, 8, 8, 8);
        _controls.Opacity = 0;
        _controls.IsHitTestVisible = false;
        var row = new Grid { ColumnSpacing = 2 };
        for (var i = 0; i < 7; i++) row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _down = Ctl("down", _downIcon, "Thumbs down tells the service you dislike this", () => Command?.Invoke("thumbdown"));
        _up = Ctl("up", _upIcon, "Thumbs up tells the service you like this", () => Command?.Invoke("thumbup"));
        _prevIcon.Glyph = GlyphPrev; _nextIcon.Glyph = GlyphNext; _backIcon.Glyph = GlyphRestore;
        _prev = Ctl("prev", _prevIcon, "Previous", () => Command?.Invoke("prev"));
        _play = Ctl("play", _playIcon, "Play / pause", () => Command?.Invoke(_playing ? "pause" : "play"));
        _next = Ctl("next", _nextIcon, "Next", () => Command?.Invoke("next"));
        _mute = Ctl("mute", _muteIcon, "Mute / unmute the wall", () => Command?.Invoke(_muted ? "unmute" : "mute"));
        _back = Ctl("back", _backIcon, "Back to the full player (Esc, or double-click)", () => ReturnRequested?.Invoke());
        var c = 0;
        foreach (var b in new[] { _down, _up, _prev, _play, _next, _mute, _back }) { Grid.SetColumn(b, c++); row.Children.Add(b); }
        _controls.Children.Add(row);
        _playIcon.Glyph = GlyphPlay; _muteIcon.Glyph = GlyphAudioOn;
        return _controls;
    }

    private static Button Ctl(string name, UIElement face, string tip, Action click)
    {
        var b = new Button { Name = name, Content = face, Padding = new Thickness(8, 5, 8, 5), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), Foreground = new SolidColorBrush(Ink) };
        ToolTipService.SetToolTip(b, tip);
        b.Click += (_, __) => click();
        // the press is the button's: never the start of a drag
        b.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, e) => e.Handled = true), true);
        return b;
    }

    private static LinearGradientBrush Diagonal(Windows.UI.Color a, Windows.UI.Color mid, Windows.UI.Color b)
        => new()
        {
            StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops = { new GradientStop { Color = a, Offset = 0 }, new GradientStop { Color = mid, Offset = 0.5 }, new GradientStop { Color = b, Offset = 1 } },
        };

    private bool _snapping;
    private void OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if (!args.DidSizeChange || _snapping) return;
        try
        {
            var size = AppWindow.Size;
            var wDip = Math.Clamp(size.Width / _scale, MinWidth, MaxWidth);
            var hWant = (int)Math.Round(wDip * 9 / 16 * _scale);
            var wWant = (int)Math.Round(wDip * _scale);
            _widthDip = wDip;
            if (Math.Abs(size.Height - hWant) > 1 || size.Width != wWant)
            {
                _snapping = true;
                try { AppWindow.Resize(new SizeInt32(wWant, hWant)); } finally { _snapping = false; }
            }
            ApplyTextScale();
            try { HostPrefs.Set(PrefW, _widthDip); } catch { }
        }
        catch (Exception ex) { Log?.Invoke("mini player: size follow failed: " + ex.Message); }
    }

    /// <summary>Size the tile to this width (DIPs) at 16:9, between the minimum and four times it; the top-left corner stays put and the text grows with it.</summary>
    private void ResizeTo(double widthDip, bool persist = true)
    {
        var w = Math.Clamp(widthDip, MinWidth, MaxWidth);
        if (Math.Abs(w - _widthDip) < 0.5) return;
        _widthDip = w;
        try
        {
            var pos = AppWindow.Position;
            AppWindow.MoveAndResize(new RectInt32(pos.X, pos.Y, (int)Math.Round(w * _scale), (int)Math.Round(w * 9 / 16 * _scale)));
        }
        catch (Exception ex) { Log?.Invoke("mini player: resize failed: " + ex.Message); }
        ApplyTextScale();
        if (persist) { try { HostPrefs.Set(PrefW, _widthDip); } catch { } }
    }

    /// <summary>"With the increased size, the text can be made a little bigger": every size grows with the tile's width, a touch under proportionally so a 4x tile is not shouting.</summary>
    private void ApplyTextScale()
    {
        var s = Math.Pow(_widthDip / DefaultWidth, 0.85);
        _title.FontSize = 14 * s; _artist.FontSize = 12 * s; _from.FontSize = 11 * s;
        _playIcon.FontSize = 16 * s; _muteIcon.FontSize = 14 * s; _prevIcon.FontSize = 13 * s; _nextIcon.FontSize = 13 * s; _backIcon.FontSize = 13 * s; _upIcon.FontSize = 13 * s; _downIcon.FontSize = 13 * s;
        var pad = 8 * s;
        foreach (var b in new[] { _down, _up, _prev, _play, _next, _mute, _back }) if (b is not null) b.Padding = new Thickness(pad, pad * 0.6, pad, pad * 0.6);
        _meta.Padding = new Thickness(12 * s, 30 * s, 12 * s, 9 * s);
        foreach (var c in _meta.Children) if (c is StackPanel sp) sp.MaxWidth = _widthDip * 0.62;
    }

    private void ShowControls(bool on)
    {
        if (_shown == on) return;
        _shown = on;
        _controls.IsHitTestVisible = on;
        var sb = new Storyboard();
        var da = new DoubleAnimation { To = on ? 1 : 0, Duration = new Duration(TimeSpan.FromMilliseconds(on ? 160 : 320)), EnableDependentAnimation = true };
        Storyboard.SetTarget(da, _controls);
        Storyboard.SetTargetProperty(da, "Opacity");
        sb.Children.Add(da);
        sb.Begin();
    }

    // ------------------------------------------------------------------ the scene and its state

    /// <summary>The visual to draw: a host built by the main window on the stage's style, source and audio bands.</summary>
    public void ShowScene(VisualizationHost viz)
    {
        try { _viz?.Dispose(); } catch { }
        _sceneHost.Children.Clear();
        _viz = viz;
        viz.HorizontalAlignment = HorizontalAlignment.Stretch; viz.VerticalAlignment = VerticalAlignment.Stretch;
        _sceneHost.Children.Add(viz);
    }

    /// <summary>Core's feed for the stage (palette, artwork, active), mirrored here.</summary>
    public void Feed(string json) { try { _viz?.SetFeed(json); } catch (Exception ex) { Log?.Invoke("mini player: feed failed: " + ex.Message); } }

    /// <summary>The transport as the stage shows it - the same facts, from the same poll.</summary>
    public void Update(bool playing, string? title, string? artist, bool prev, bool next, bool canPlay, bool muted, string? collection = null, string? service = null, bool canRate = false, int rating = 0)
    {
        _playing = playing; _muted = muted;
        // the thumbs: live while the service rates, the standing verdict in amber (the stage fills the thumb; here the ink says it)
        _up.IsEnabled = canRate; _down.IsEnabled = canRate;
        _upIcon.Foreground = new SolidColorBrush(rating == 1 ? Amber : Ink);
        _downIcon.Foreground = new SolidColorBrush(rating == -1 ? Amber : Ink);
        _playIcon.Glyph = playing ? GlyphPause : GlyphPlay;
        _muteIcon.Glyph = muted ? GlyphAudioOff : GlyphAudioOn;
        _muteIcon.Foreground = new SolidColorBrush(muted ? Amber : Ink);
        _title.Text = title ?? "";
        _artist.Text = artist ?? "";
        var sep = " " + (char)0xB7 + " ";
        _from.Text = !string.IsNullOrWhiteSpace(collection) && !string.IsNullOrWhiteSpace(service) ? collection + sep + service : (collection ?? service ?? "");
        _from.Visibility = _from.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        _artist.Visibility = _artist.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        _prev.IsEnabled = prev; _next.IsEnabled = next; _play.IsEnabled = canPlay;
    }

    // ------------------------------------------------------------------ the window: always on top, no chrome, remembered place

    private void Place()
    {
        if (_placed) return;
        _placed = true;
        try
        {
            _scale = _root.XamlRoot?.RasterizationScale ?? 1;
            // "Why can't we just drag the corner of the mini player to resize like a traditional window?" (2026-09-17) - it can: the
            // OS resize frame is part of the window border, so the border stays (a hairline) and only the title bar goes.
            // Edges and corners resize with the usual cursors; the shape snaps back to 16:9 as the size changes.
            var presenter = OverlappedPresenter.Create();
            presenter.IsAlwaysOnTop = true;
            presenter.IsResizable = true;
            presenter.IsMaximizable = false;
            presenter.IsMinimizable = false;
            presenter.SetBorderAndTitleBar(true, false);
            presenter.PreferredMinimumWidth = (int)Math.Round(MinWidth * _scale); presenter.PreferredMinimumHeight = (int)Math.Round(MinWidth * 9 / 16 * _scale);
            presenter.PreferredMaximumWidth = (int)Math.Round(MaxWidth * _scale); presenter.PreferredMaximumHeight = (int)Math.Round(MaxWidth * 9 / 16 * _scale);
            AppWindow.SetPresenter(presenter);
            AppWindow.Changed += OnAppWindowChanged;
            _widthDip = Math.Clamp(HostPrefs.GetDouble(PrefW, DefaultWidth), MinWidth, MaxWidth);
            var w = (int)Math.Round(_widthDip * _scale);
            var h = (int)Math.Round(_widthDip * 9 / 16 * _scale);
            var px0 = HostPrefs.GetDouble(PrefX, double.NaN);
            var py0 = HostPrefs.GetDouble(PrefY, double.NaN);
            var x = double.IsNaN(px0) ? int.MinValue : (int)px0;
            var y = double.IsNaN(py0) ? int.MinValue : (int)py0;
            if (!TryWorkArea(out var wa)) wa = new RectInt32(0, 0, 1920, 1080);
            // 2026-09-18: "whenever the miniplayer is started, it always goes to the bottom right of my 2nd monitor. Could it
            // instead return to its last location?" It tried: the remembered spot was checked against the work area of the
            // display the NEW window happened to open on, so a spot on the other monitor never passed and the fallback
            // corner won every time. A remembered spot counts when any connected display can show it (the same rule and
            // the same monitor list as the main window's restore - DisplayArea.FindAll throws on this machine).
            var remembered = false;
            if (!double.IsNaN(px0) && !double.IsNaN(py0))
            {
                IEnumerable<WindowPlacement.Rect> displays;
                try { displays = DisplayArea.FindAll().Select(d => new WindowPlacement.Rect(d.OuterBounds.X, d.OuterBounds.Y, d.OuterBounds.Width, d.OuterBounds.Height)).ToList(); }
                catch { displays = WindowPlacement.Win32Monitors(); }
                remembered = WindowPlacement.IsReachable(new WindowPlacement.Rect(x, y, w, h), displays);
            }
            if (!remembered) { x = wa.X + wa.Width - w - 24; y = wa.Y + wa.Height - h - 24; }
            AppWindow.MoveAndResize(new RectInt32(x, y, w, h));
            ApplyTextScale();
            Log?.Invoke("mini player: opened at " + x + "," + y + " " + w + "x" + h + " scale " + _scale.ToString("0.00") + (remembered ? " (remembered)" : " (bottom-right)"));
        }
        catch (Exception ex) { Log?.Invoke("mini player: place failed: " + ex.Message); }
    }

    private bool TryWorkArea(out RectInt32 wa)
    {
        try { wa = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea; return true; }
        catch { try { wa = DisplayArea.Primary.WorkArea; return true; } catch { wa = default; return false; } }
    }

    // The drag pins the window to the cursor's SCREEN position (GetCursorPos, physical pixels) minus the grab offset. The
    // first cut derived the cursor from the window's own reported position plus the pointer's place inside it - a position
    // that lags one move behind the move just made, so every step undershot and then caught up ("like catching a trophy
    // fish", 2026-09-17). The cursor's own coordinates have no such lag.
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT p);
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] private struct POINT { public int X, Y; }
    private int _grabDx, _grabDy;
    private int _lastX = int.MinValue, _lastY = int.MinValue;

    private void OnRootPressed(object sender, PointerRoutedEventArgs e)
    {
        var pt = e.GetCurrentPoint(_root);
        if (!pt.Properties.IsLeftButtonPressed) return;
        if (!GetCursorPos(out var c)) return;
        var pos = AppWindow.Position;
        _grabDx = c.X - pos.X; _grabDy = c.Y - pos.Y;
        _dragging = true; _dragPointer = e.Pointer.PointerId;
        _lastX = pos.X; _lastY = pos.Y;
        _root.CapturePointer(e.Pointer);
        e.Handled = true;
    }

    private void OnRootMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_dragging || e.Pointer.PointerId != _dragPointer) return;
        if (!GetCursorPos(out var c)) return;
        var nx = c.X - _grabDx;
        var ny = c.Y - _grabDy;
        if (nx != _lastX || ny != _lastY) { _lastX = nx; _lastY = ny; try { AppWindow.Move(new PointInt32(nx, ny)); } catch { } }
        e.Handled = true;
    }

    private void OnRootReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_dragging) return;
        _root.ReleasePointerCapture(e.Pointer);
        EndDrag();
        e.Handled = true;
    }

    private void EndDrag()
    {
        if (!_dragging) return;
        _dragging = false;
        try { var p = AppWindow.Position; HostPrefs.Set(PrefX, (double)p.X); HostPrefs.Set(PrefY, (double)p.Y); } catch { }
        _hide.Start();
    }
}
