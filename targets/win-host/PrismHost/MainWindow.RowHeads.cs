using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The heads of Watch's two live rows, Continue watching and My list: the row's name, its order switch, and (Continue watching, by service) a
/// chip per service that jumps the row to that service's titles.
///
/// The order is core's (2026-09-26, "make a quick switch for the continue watching sorting order", "We also need this on My List", "Also add a
/// reverse order for all of these"): core names the choices and their hints (orderChoices), keeps the person's choice on the device
/// (videoRowOrder) and orders the cards; the host draws the chips, asks, and lets the live follow glide the cards to their new places.
/// The jump chips (2026-09-26, "offer a quick jump to different services (only if theyre in the queue)") show for the services the row holds -
/// none when it holds one - and only while it is grouped by service.
/// </summary>
public sealed partial class MainWindow
{
    private StackPanel? _contJumps;
    private List<JsonObject> _contCards = new();
    private readonly Dictionary<string, (string order, bool reverse)> _rowOrder = new();
    private readonly Dictionary<string, (string order, bool reverse)> _rowWanted = new();
    private readonly Dictionary<string, Action> _rowPaint = new();

    /// <summary>Each live pass: the rows' orders as core has them now. A profile set switched brings its own orders (2026-09-27, "Make sure the sort
    /// settings are saved by profile set too. So if I switch, they get updated to the new profile set preference"): the chips repaint, the jump
    /// chips follow; the cards come in the new order on the same pass.</summary>
    private void SyncRowOrders(JsonObject menu)
    {
        if (menu["orders"] is not JsonObject orders) return;
        foreach (var row in new[] { "continue", "list" })
        {
            if (_rowWanted.ContainsKey(row) || !_rowOrder.TryGetValue(row, out var have)) continue;   // a press on its way wins
            var now = (orders[row]?.GetValue<string>() ?? have.order, orders[row + "Reverse"]?.GetValue<bool>() == true);
            if (now == have) continue;
            _rowOrder[row] = now;
            if (_rowPaint.TryGetValue(row, out var paint)) paint();
            if (row == "continue" && _contJumps is not null) { _contJumps.Tag = null; FillContinueJumps(_contCards); }
        }
    }

    /// <summary>A live row's head: its name, the order chips and the reverse chip, and for Continue watching the jump chips.</summary>
    private FrameworkElement LiveRowHead(string head, SolidColorBrush ink, string row, JsonObject? menu, List<JsonObject> cards)
    {
        var title = RowHead(head, ink);
        title.VerticalAlignment = VerticalAlignment.Center;
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18, Children = { title } };
        var orders = menu?["orders"] as JsonObject;
        var order = orders?[row]?.GetValue<string>() ?? (row == "list" ? "prism" : "title");
        var reverse = orders?[row + "Reverse"]?.GetValue<bool>() == true;
        // a choice just pressed wins over a menu read before core had it (review 2026-09-26); it is dropped once core answers with it
        if (_rowWanted.TryGetValue(row, out var want)) { if (want == (order, reverse)) _rowWanted.Remove(row); else (order, reverse) = want; }
        _rowOrder[row] = (order, reverse);
        if ((menu?["orderChoices"] as JsonObject)?[row] is JsonArray choices && choices.Count > 0)
            panel.Children.Add(OrderSwitch(row, choices));
        if (row == "continue")
        {
            var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
            _contJumps = chips;
            panel.Children.Add(chips);
            FillContinueJumps(cards);
        }
        return panel;
    }

    /// <summary>The row's order chips (the chosen one lit) and a reverse chip; a press asks core and the row glides to its new order.</summary>
    private FrameworkElement OrderSwitch(string row, JsonArray choices)
    {
        var box = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        var chips = new List<(Button b, string id)>();
        Button? rev = null;
        void Paint()
        {
            var (order, reverse) = _rowOrder[row];
            foreach (var (b, id) in chips) b.Background = id == order ? HubChipOn : HubChip;
            if (rev is not null)
            {
                // a switch, not one of the choices: a round outlined button, lit amber while on
                rev.Background = reverse ? HubChipOn : RevOff;
                rev.BorderBrush = reverse ? HubAmber : HubDim;
                ((FontIcon)rev.Content).Foreground = reverse ? HubAmber : HubInk;
                ToolTipService.SetToolTip(rev, (reverse ? "Reverse is on. " : "Reverse is off. ") + RevHint);
            }
        }
        foreach (var c in choices.OfType<JsonObject>())
        {
            var id = S(c, "id"); var label = S(c, "label"); var hint = S(c, "hint");
            if (id.Length == 0) continue;
            var b = Chip(new TextBlock { Text = label, FontSize = 12, Foreground = HubInk }, id == _rowOrder[row].order);
            b.Padding = new Thickness(10, 3, 10, 3);
            if (hint.Length > 0) ToolTipService.SetToolTip(b, hint);
            b.Click += (_, __) => { if (_rowOrder[row].order == id) return; _rowOrder[row] = (id, _rowOrder[row].reverse); Paint(); _ = SetRowOrderAsync(row, id, null); };
            chips.Add((b, id));
            box.Children.Add(b);
        }
        // the reverse switch (2026-09-26, "can we add a reverse symbol instead. And it should look different than the other 2 pills because it is
        // on/off while the others are one or the other"): the sort symbol in a round outlined button, apart from the pills
        rev = Chip(new FontIcon { Glyph = "\uE8CB", FontSize = 13, Foreground = HubInk }, false);
        rev.Width = 28; rev.Height = 28; rev.Padding = new Thickness(0); rev.CornerRadius = new CornerRadius(14);
        rev.BorderThickness = new Thickness(1.5); rev.Margin = new Thickness(6, 0, 0, 0);
        rev.Click += (_, __) => { var r = !_rowOrder[row].reverse; _rowOrder[row] = (_rowOrder[row].order, r); Paint(); _ = SetRowOrderAsync(row, null, r); };
        box.Children.Add(rev);
        Paint();
        _rowPaint[row] = Paint;
        return box;
    }

    private static readonly SolidColorBrush RevOff = new(Windows.UI.Color.FromArgb(0x10, 0xFF, 0xFF, 0xFF));
    private const string RevHint = "Flips the order. A to Z becomes Z to A. By service goes Z to A, the services and the titles in each. New first keeps the bannered titles in front.";

    private async Task SetRowOrderAsync(string row, string? order, bool? reverse)
    {
        (string order, bool reverse) cur = _rowOrder.TryGetValue(row, out var c) ? c : (row == "list" ? "prism" : "title", false);
        _rowOrder[row] = _rowWanted[row] = (order ?? cur.order, reverse ?? cur.reverse);
        try { await ModelCallAsync("videoRowOrder", row, order ?? "", reverse is null ? "" : reverse.Value ? "1" : "0"); } catch { }
        if (row == "continue") { if (_contJumps is not null) _contJumps.Tag = null; FillContinueJumps(_contCards); }
        // the row starts again at its first card in the new order, now (a flag waiting for the row to change could linger and snap it back
        // hours later when the order moved nothing - review 2026-09-26); the cards glide to their places on the live pass
        if (_liveRows.TryGetValue(row, out var r)) FindChild<ScrollViewer>(r.host)?.ChangeView(0, null, null, false);
        KickLiveRows();
    }

    /// <summary>One chip per service the row holds, in the row's order, while it is grouped by service; redrawn when that set changes.</summary>
    private void FillContinueJumps(List<JsonObject> cards)
    {
        _contCards = cards;
        if (_contJumps is not { } chips) return;
        var grouped = _rowOrder.TryGetValue("continue", out var o) && o.order == "service";
        var svcs = cards.Select(c => (app: S(c, "app"), name: S(c, "service"))).Where(x => x.app.Length > 0)
            .GroupBy(x => x.app).Select(g => (app: g.Key, name: g.First().name, n: g.Count())).ToList();
        var sig = (grouped ? "g|" : "-|") + string.Join("|", svcs.Select(x => x.app + ":" + x.n));
        if (chips.Tag as string == sig) return;
        chips.Tag = sig;
        chips.Children.Clear();
        if (!grouped || svcs.Count < 2) return;   // one service, or not grouped: nothing to jump between
        foreach (var (app, name, n) in svcs)
        {
            var label = name.Length > 0 ? name : app;
            var content = new StackPanel
            {
                Orientation = Orientation.Horizontal, Spacing = 6,
                Children = { ServiceMark(app, label, 18), new TextBlock { Text = label, FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center } },
            };
            var b = Chip(content, false);
            b.Padding = new Thickness(6, 3, 10, 3);
            ToolTipService.SetToolTip(b, label + " has " + n + (n == 1 ? " title" : " titles") + " in Continue watching. Press to go to them.");
            var a = app;
            b.Click += (_, __) => JumpContinueTo(a);
            chips.Children.Add(b);
        }
    }

    /// <summary>The row glides to the first card of the service.</summary>
    private void JumpContinueTo(string app)
    {
        if (!_liveRows.TryGetValue("continue", out var r) || FindChild<ScrollViewer>(r.host) is not { } sv || sv.Content is not StackPanel line) return;
        var card = line.Children.OfType<Button>().FirstOrDefault(b => b.Visibility == Visibility.Visible
            && (Microsoft.UI.Xaml.Automation.AutomationProperties.GetAutomationId(b) ?? "").StartsWith("row:" + app + "|", StringComparison.Ordinal));
        if (card is null) return;
        try
        {
            var x = Microsoft.UI.Xaml.Controls.Primitives.LayoutInformation.GetLayoutSlot(card).X;   // its place in the row, not where a glide has it now
            sv.ChangeView(Math.Max(0, x), null, null, false);
        }
        catch { }
    }
}
