using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// The service's own page in a window, for trouble (2026-11-15, docs/roadmap.md). The Video player shows the service's video and
/// hides the page's own controls; a setting PRISM has no control for, an error or a prompt the service puts up is then out of reach.
/// Service page on the stage bar puts the playing page in a window of PRISM's over the player, with the adapter's hiding styles off
/// for as long as the window is up: the page as the service draws it, the video still playing. Done (or Esc) puts the page and the
/// styles back. The video window itself never shows a service's page (the rule of 2026-11-05): this is a window over it. The page is
/// the playing surface itself, moved as Watch's corner moves it (SurfaceManager.BeginPip), so nothing loads again and what core sets
/// meanwhile waits for the return. Every service the same way: the styles are one element, no work in an adapter.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _svcPage;
    private string? _svcTile;
    private DispatcherTimer? _svcTimer;
    private bool ServicePageOpen => _svcPage is not null;

    // the adapter's stylesheet is one element (SurfaceManager's __prism-style): off while the window is up, on again after
    private const string SvcStylesOffJs = "(function(){try{var s=document.getElementById('__prism-style');if(s&&!s.disabled)s.disabled=true;document.documentElement.classList.add('prism-service-page');return true;}catch(e){return false;}})()";
    private const string SvcStylesOnJs = "(function(){try{var s=document.getElementById('__prism-style');if(s)s.disabled=false;document.documentElement.classList.remove('prism-service-page');return true;}catch(e){return false;}})()";

    /// <summary>The stage bar's Service page button.</summary>
    private void ServicePageVerb(string slot, Action<Button> place)
    {
        var b = Chip(new FontIcon { Glyph = ((char)0xE774).ToString(), FontSize = 16, Foreground = HubInk }, false);   // the globe, as on the Music player's bar (2026-11-15)
        ToolTipService.SetToolTip(b, "Full Player. Something wrong with the service? This opens its own page in a window, with its own controls, settings and messages. The video keeps playing.");
        b.Click += (_, __) => OpenServicePage(slot);
        place(b);
    }

    private void OpenServicePage(string slot)
    {
        CloseServicePage();
        if (_surfaces.RectOf(slot) is null) return;
        if (VideoHubOpen) CloseVideoHub();   // Watch holds the screen in its corner: the window opens over the player itself
        HideStageBar();
        var vw = TileCanvas.ActualWidth > 0 ? TileCanvas.ActualWidth : _w; var vh = TileCanvas.ActualHeight > 0 ? TileCanvas.ActualHeight : _h;
        const double barH = 44;
        // a 16:9 window in the middle, as large as leaves the scrim in view around it
        var w = Math.Round(Math.Min(vw * 0.78, (vh * 0.80 - barH) * 16 / 9)); var h = Math.Round(w * 9 / 16);
        var x = Math.Round((vw - w) / 2); var y = Math.Round((vh - h) / 2 + barH / 2);
        _surfaces.BeginPip(slot, new ChannelRect(x, y, w, h));
        _surfaces.SetShieldOff(slot, true);   // the shield over a fullscreen player takes every press: down, so the service's controls can be used
        _ = _surfaces.EvalOnTileAsync(slot, SvcStylesOffJs);

        var host = new Grid();
        Canvas.SetZIndex(host, 1010);   // over the stage bar (1000)
        // the scrim, in four pieces around the window: the page's own pixels and presses stay its own, and a press beside it does nothing
        void Piece(double px, double py, double pw, double ph)
        {
            if (pw <= 0 || ph <= 0) return;
            host.Children.Add(new Border { Background = Tokens.Scrim, Width = pw, Height = ph, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(px, py, 0, 0) });
        }
        var top = y - barH;
        Piece(0, 0, vw, top); Piece(0, y + h, vw, vh - (y + h)); Piece(0, top, x, h + barH); Piece(x + w, top, vw - (x + w), h + barH);
        host.Children.Add(new Border { Width = w + 2, Height = h + barH + 2, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(x - 1, top - 1, 0, 0), BorderBrush = Tokens.AmberAt(0x3A), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8, 8, 0, 0), IsHitTestVisible = false });
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var title = new TextBlock { Text = "The service's own page. Done puts PRISM's controls back.", FontSize = 14, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(14, 0, 10, 0), TextTrimming = TextTrimming.CharacterEllipsis };
        row.Children.Add(title);
        var done = Chip(new TextBlock { Text = "Done", FontSize = 14, Foreground = HubInk }, true);
        done.VerticalAlignment = VerticalAlignment.Center; done.Margin = new Thickness(0, 0, 8, 0);
        done.Click += (_, __) => CloseServicePage();
        Grid.SetColumn(done, 1);
        row.Children.Add(done);
        host.Children.Add(new Border { Width = w, Height = barH, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(x, top, 0, 0), Background = Tokens.Ground, CornerRadius = new CornerRadius(8, 8, 0, 0), Child = row });
        RootGrid.Children.Add(host);
        _svcPage = host; _svcTile = slot;

        // a page the service loads meanwhile gets PRISM's styles again from the surface: taken off again, and the window goes with its page
        _svcTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _svcTimer.Tick += (_, __) =>
        {
            if (_svcTile is not { } t) return;
            if (_surfaces.RectOf(t) is null || !_surfaces.InPip(t)) { CloseServicePage(); return; }
            _ = _surfaces.EvalOnTileAsync(t, SvcStylesOffJs);
        };
        _svcTimer.Start();
        LogLine("service page: " + slot + " in a window, the adapter's styles off");
    }

    private void CloseServicePage()
    {
        if (_svcPage is null) return;
        _svcTimer?.Stop(); _svcTimer = null;
        RootGrid.Children.Remove(_svcPage); _svcPage = null;
        var t = _svcTile; _svcTile = null;
        if (t is null) return;
        _ = _surfaces.EvalOnTileAsync(t, SvcStylesOnJs);
        _surfaces.SetShieldOff(t, false);
        _surfaces.EndPip(t);
        LogLine("service page: closed, " + t + " back in its place");
    }
}
