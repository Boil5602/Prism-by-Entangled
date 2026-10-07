using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The Updates dialog (dashboard-schema section 28; docs/features/updates.md; 2026-10-05): what runs, what the update server offers, a check
/// now, an install now, a restart into a staged version; and, for a fork, the server address and the public key that signs its manifests.
/// Core decides what is newer and when the night window installs; Services/Updates.cs moves the bytes.
/// </summary>
public sealed partial class MainWindow
{
    private JsonObject? _updateStatus;

    /// <summary>The note beside the menu item: a version ready, or one waiting for a restart.</summary>
    private string UpdateMenuNote()
    {
        if (Services.Updates.Staged() is { } st) return st.version + " installed, restart to switch";
        var av = (_updateStatus?["available"] as JsonObject)?["version"]?.GetValue<string>();
        return av is { Length: > 0 } ? av + " is ready to install" : "";
    }

    /// <summary>Said once on the status line when a release is there (after core's first check) or staged.</summary>
    private void RefreshUpdateNotice()
    {
        // staged: the notice is the restart offer, with its button (2026-10-06); ready to install: the line alone, as before
        if (Services.Updates.Staged() is not null) { OfferRestartIfStaged(); return; }
        var note = UpdateMenuNote();
        if (note.Length > 0) SetPill("Prism" + Mid + note + ". Prism menu, Updates.");
    }

    private async Task PollUpdateStatusAsync()
    {
        try { _updateStatus = JsonNode.Parse(await ModelCallAsync("updateStatus") ?? "null") as JsonObject; } catch { _updateStatus = null; }
    }

    private async Task ShowUpdatesAsync()
    {
        await PollUpdateStatusAsync();
        var body = new StackPanel { Spacing = 10, MinWidth = 520 };
        var running = new TextBlock { Text = "Running Prism " + AppVersion.Text + " on the " + Services.Updates.TrackLabel(Services.Updates.Channel) + " track", FontSize = 14, Foreground = HubInk };
        var line = new TextBlock { FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        var notes = new TextBlock { FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, Visibility = Visibility.Collapsed, Margin = new Thickness(0, 4, 0, 0) };
        body.Children.Add(running); body.Children.Add(line); body.Children.Add(notes);

        var verbs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var check = Chip(new TextBlock { Text = "Check now", FontSize = 14, Foreground = HubInk }, false);
        var install = Chip(new TextBlock { Text = "Install now", FontSize = 14, Foreground = HubAmber }, true);
        var restart = Chip(new TextBlock { Text = "Restart into the new version", FontSize = 14, Foreground = HubAmber }, true);
        verbs.Children.Add(check); verbs.Children.Add(install); verbs.Children.Add(restart);
        body.Children.Add(verbs);

        // the changelog feed beside the dialog (2026-10-07, "can we have the option to see a change log feed on the side of that modal window?
        // Maybe just a checkbox to turn it on with the changelog for the latest version"): off by default, the choice kept; the releases come
        // in the signed manifest's history (docs/features/updates.md), so showing them fetches nothing
        var showChanges = new CheckBox { Content = new TextBlock { Text = "Show what's changed", FontSize = 14, Foreground = HubInk }, IsChecked = HostPrefs.GetBool("updates.showChanges", false), MinWidth = 0 };
        body.Children.Add(showChanges);
        var feed = new StackPanel { Spacing = 14 };
        var feedPane = new ScrollViewer
        {
            Content = feed, Width = 420, MaxHeight = 640, Margin = new Thickness(28, 0, 0, 0), Padding = new Thickness(0, 0, 12, 0),
            Visibility = showChanges.IsChecked == true ? Visibility.Visible : Visibility.Collapsed,
        };
        showChanges.Checked += (_, __) => { feedPane.Visibility = Visibility.Visible; HostPrefs.Set("updates.showChanges", true); };
        showChanges.Unchecked += (_, __) => { feedPane.Visibility = Visibility.Collapsed; HostPrefs.Set("updates.showChanges", false); };
        void DrawFeed()
        {
            feed.Children.Clear();
            feed.Children.Add(new TextBlock { Text = "What's changed", FontSize = 17, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
            var st = _updateStatus;
            var src = (st?["available"] as JsonObject) ?? (st?["latest"] as JsonObject);
            var running = st?["currentVersion"]?.GetValue<string>() ?? "";
            var list = new List<(string version, string date, string notes)>();
            if (src?["history"] is JsonArray hs)
                foreach (var h in hs)
                    if (h is JsonObject ho && ho["version"]?.GetValue<string>() is { } hv && ho["notes"]?.GetValue<string>() is { } hn)
                        list.Add((hv, ho["date"]?.GetValue<string>() ?? "", hn));
            if (list.Count == 0 && src?["version"]?.GetValue<string>() is { } sv && src["notes"]?.GetValue<string>() is { Length: > 0 } sn)
                list.Add((sv, src["date"]?.GetValue<string>() ?? "", sn));   // a manifest from before the feed: its one release
            if (list.Count == 0)
            {
                feed.Children.Add(new TextBlock { Text = "The update server hasn't sent a changelog yet. Check now asks it.", FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
                return;
            }
            foreach (var (v, d, n) in list)
            {
                var cmp = CompareVersions(v, running);
                var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
                head.Children.Add(new TextBlock { Text = "Prism " + v, FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = cmp > 0 ? HubAmber : HubInk });
                if (DateTime.TryParse(d, out var dd)) head.Children.Add(new TextBlock { Text = dd.ToString("MMM d"), FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Bottom });
                if (cmp > 0) head.Children.Add(new TextBlock { Text = "New", FontSize = 13, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Bottom });
                else if (cmp == 0) head.Children.Add(new TextBlock { Text = "Running now", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Bottom });
                var item = new StackPanel { Spacing = 4 };
                item.Children.Add(head);
                item.Children.Add(new TextBlock { Text = n, FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
                feed.Children.Add(item);
            }
        }

        void Draw()
        {
            var st = _updateStatus;
            var av = st?["available"] as JsonObject;
            var staged = Services.Updates.Staged();
            var last = st?["lastCheck"]?.GetValue<string>();
            var res = st?["lastResult"]?.GetValue<string>();
            string when = last is { Length: > 0 } && DateTime.TryParse(last, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt) ? dt.ToLocalTime().ToString("ddd HH:mm") : "never";
            if (staged is { } s2) line.Text = "Prism " + s2.version + " is installed and runs at the next start.";
            else if (av is not null) line.Text = "Prism " + (av["version"]?.GetValue<string>() ?? "?") + " is ready to install. Last check " + when + ".";
            else line.Text = (res is "unreachable" ? "The update server could not be reached. Last tried " + when + "."
                : res is "invalid" ? "The update server's answer did not verify, so nothing was taken from it. Last tried " + when + "."
                : last is { Length: > 0 } ? "This is the newest version on the " + Services.Updates.TrackLabel(Services.Updates.Channel) + " track. Last check " + when + "."
                : "Not checked yet. Prism checks once a day; Check now asks right away.");
            var n = av?["notes"]?.GetValue<string>();
            notes.Text = n ?? ""; notes.Visibility = string.IsNullOrWhiteSpace(n) ? Visibility.Collapsed : Visibility.Visible;
            install.Visibility = av is not null && staged is null ? Visibility.Visible : Visibility.Collapsed;
            restart.Visibility = staged is not null ? Visibility.Visible : Visibility.Collapsed;
            DrawFeed();
        }
        Draw();
        check.Click += async (_, __) => { line.Text = "Checking\u2026"; try { _updateStatus = JsonNode.Parse(await ModelCallAwaitAsync("updateCheck", 30_000) ?? "null") as JsonObject; } catch { } Draw(); };
        install.Click += async (_, __) => { line.Text = "Downloading and checking\u2026 (the status line says how far)"; install.IsEnabled = false; try { _updateStatus = JsonNode.Parse(await ModelCallAwaitAsync("updateInstallNow", 15 * 60_000) ?? "null") as JsonObject; } catch { } install.IsEnabled = true; Draw(); OfferRestartIfStaged(); };
        restart.Click += (_, __) => RestartIntoStaged();

        // the track and the check cadence: a person's settings
        var track = new ComboBox { Header = "Track", FontSize = 13, MinWidth = 220 };
        foreach (var (id, label, note) in new[] { ("alpha", "Alpha", "what ships while Prism is built"), ("beta", "Beta", "the release candidate"), ("stable", "Full", "the full release") })
            track.Items.Add(new ComboBoxItem { Content = label + Mid + note, Tag = id });
        track.SelectedIndex = Services.Updates.Channel == "alpha" ? 0 : Services.Updates.Channel == "beta" ? 1 : 2;
        // when the check runs (2026-10-06, "Let the user check for updates at a scheduled time"): daily or one day a week at a time of day, or
        // never; taken at once, and the line under it says when the next check is
        var how = new ComboBox { Header = "Check for updates", FontSize = 13, MinWidth = 160 };
        foreach (var (id, label) in new[] { ("daily", "Every day"), ("weekly", "Once a week"), ("never", "Never") }) how.Items.Add(new ComboBoxItem { Content = label, Tag = id });
        how.SelectedIndex = !Services.Updates.Enabled ? 2 : Services.Updates.CheckWeekday >= 0 ? 1 : 0;
        var day = new ComboBox { Header = "On", FontSize = 13, MinWidth = 140 };
        foreach (var (d, label) in new[] { (1, "Monday"), (2, "Tuesday"), (3, "Wednesday"), (4, "Thursday"), (5, "Friday"), (6, "Saturday"), (0, "Sunday") }) day.Items.Add(new ComboBoxItem { Content = label, Tag = d });
        var wd = Services.Updates.CheckWeekday;
        day.SelectedIndex = wd >= 1 ? wd - 1 : wd == 0 ? 6 : 0;
        TimeSpan at0 = TimeSpan.TryParse(Services.Updates.CheckAt, out var parsedAt) ? parsedAt : new TimeSpan(4, 0, 0);
        var at = new TimePicker { Header = "At", Time = at0, MinuteIncrement = 5, FontSize = 13 };
        var nextLine = new TextBlock { FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        var when = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        when.Children.Add(how); when.Children.Add(day); when.Children.Add(at);
        void SayNext()
        {
            var n = _updateStatus?["nextCheck"]?.GetValue<string>();
            nextLine.Text = !Services.Updates.Enabled ? "Prism checks only when you press Check now."
                : n is { Length: > 0 } && DateTime.TryParse(n, null, System.Globalization.DateTimeStyles.RoundtripKind, out var nd) ? "Next check " + nd.ToLocalTime().ToString("dddd") + " at " + nd.ToLocalTime().ToString("t") + "."
                : "";
        }
        async Task ApplyWhen()
        {
            var mode = (how.SelectedItem as ComboBoxItem)?.Tag as string ?? "daily";
            day.Visibility = mode == "weekly" ? Visibility.Visible : Visibility.Collapsed;
            at.Visibility = mode == "never" ? Visibility.Collapsed : Visibility.Visible;
            Services.Updates.Enabled = mode != "never";
            Services.Updates.CheckAt = at.Time.ToString(@"hh\:mm");
            Services.Updates.CheckWeekday = mode == "weekly" ? ((day.SelectedItem as ComboBoxItem)?.Tag as int? ?? 1) : -1;
            var sched = System.Text.Json.JsonSerializer.Serialize(Services.Updates.Schedule);
            try { _updateStatus = JsonNode.Parse(await ModelCallAwaitAsync("updateSetSchedule", 10_000, sched, Services.Updates.Enabled) ?? "null") as JsonObject; } catch { }
            SayNext();
            LogLine("updates: check " + (mode == "never" ? "never" : (mode == "weekly" ? "weekly, day " + Services.Updates.CheckWeekday : "daily") + " at " + Services.Updates.CheckAt));
        }
        day.Visibility = how.SelectedIndex == 1 ? Visibility.Visible : Visibility.Collapsed;
        at.Visibility = how.SelectedIndex == 2 ? Visibility.Collapsed : Visibility.Visible;
        how.SelectionChanged += async (_, __) => await ApplyWhen();
        day.SelectionChanged += async (_, __) => await ApplyWhen();
        at.TimeChanged += async (_, __) => await ApplyWhen();
        SayNext();
        var settings = new StackPanel { Spacing = 8, Margin = new Thickness(0, 8, 0, 0) };
        settings.Children.Add(track); settings.Children.Add(when); settings.Children.Add(nextLine);
        body.Children.Add(settings);

        // the update server: shown, not edited (2026-10-05, "Why is the public key editable"): the key decides which releases this Prism will
        // install, so a page or a message saying "paste this" must not find an open field. Change the update server reveals the fields, for a
        // fork of Prism someone runs themselves, with the warning first.
        var fork = new Expander { Header = new TextBlock { Text = "Update server" + (Services.Updates.ServerIsCustom ? "  " + Mid + "  not Entangled's" : ""), FontSize = 13, Foreground = Services.Updates.ServerIsCustom ? HubAmber : HubInk }, Margin = new Thickness(0, 8, 0, 0), HorizontalAlignment = HorizontalAlignment.Stretch };
        var inner = new StackPanel { Spacing = 8 };
        inner.Children.Add(new TextBlock { Text = "Prism checks one static file at this address once a day, with nothing about this machine in the request, and takes a release only when the file's signature matches this key. A fork of Prism sets its own address and key here.", FontSize = 12, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        var shown = new StackPanel { Spacing = 4 };
        shown.Children.Add(new TextBlock { Text = "Address: " + Services.Updates.Url, FontSize = 12, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true });
        shown.Children.Add(new TextBlock { Text = "Key: " + (Services.Updates.Key.Length > 0 ? Services.Updates.Key : "none (no signature check)"), FontSize = 12, Foreground = Services.Updates.Key.Length > 0 ? HubInk : HubAmber, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true });
        var change = Chip(new TextBlock { Text = "Change the update server", FontSize = 13, Foreground = HubInk }, false);
        var editor = new StackPanel { Spacing = 8, Visibility = Visibility.Collapsed };
        editor.Children.Add(new TextBlock { Text = "Only for a fork of Prism you run yourself. Whoever holds the private key for the key below decides what this Prism installs. Never change these because a page, a message or a caller told you to.", FontSize = 12, Foreground = HubAmber, TextWrapping = TextWrapping.Wrap });
        var url = new TextBox { Text = Services.Updates.Url, Header = "Manifest address", FontSize = 13 };
        var key = new TextBox { Text = Services.Updates.Key, Header = "Public key (JWK). Empty: no signature check", FontSize = 12, TextWrapping = TextWrapping.Wrap, AcceptsReturn = true };
        var reset = Chip(new TextBlock { Text = "Back to Entangled's", FontSize = 13, Foreground = HubInk }, false);
        reset.Click += (_, __) => { url.Text = Services.Updates.DefaultUrl; key.Text = Services.Updates.DefaultKey; };
        change.Click += (_, __) => { editor.Visibility = Visibility.Visible; change.Visibility = Visibility.Collapsed; };
        var save = Chip(new TextBlock { Text = "Save", FontSize = 14, Foreground = HubAmber }, true);
        var saved = new TextBlock { FontSize = 12, Foreground = HubInk };
        save.Click += async (_, __) =>
        {
            var u = url.Text.Trim();
            if (u.Contains('?') || u.Contains('#') || !(u.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || u.StartsWith("http://127.0.0.1", StringComparison.OrdinalIgnoreCase) || u.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase))) { saved.Text = "The address must be https and carry no query."; saved.Foreground = HubAmber; return; }
            if (key.Text.Trim().Length > 0)
            {
                JsonObject? jk = null; try { jk = JsonNode.Parse(key.Text.Trim()) as JsonObject; } catch { }
                if (jk is null || (jk["kty"]?.GetValue<string>() ?? "") != "EC" || (jk["crv"]?.GetValue<string>() ?? "") != "P-256" || jk["x"] is null || jk["y"] is null) { saved.Text = "The key must be a public EC P-256 JWK, as sign-manifest.mjs prints it."; saved.Foreground = HubAmber; return; }
            }
            Services.Updates.Url = u; Services.Updates.Key = key.Text.Trim(); Services.Updates.Channel = (track.SelectedItem as ComboBoxItem)?.Tag as string ?? Services.Updates.BuildTrack;
            try { _updateStatus = JsonNode.Parse(await ModelCallAwaitAsync("updateSetChannel", 30_000, Services.Updates.Channel) ?? "null") as JsonObject; } catch { }
            running.Text = "Running Prism " + AppVersion.Text + " on the " + Services.Updates.TrackLabel(Services.Updates.Channel) + " track";
            Draw();
            saved.Text = "Saved. The address takes effect at the next start; the track now."; saved.Foreground = HubInk;
            LogLine("updates: settings saved (address " + u + ", key " + (key.Text.Trim().Length > 0 ? "set" : "empty") + ", " + Services.Updates.Channel + ")");
        };
        editor.Children.Add(url); editor.Children.Add(key); editor.Children.Add(reset);
        inner.Children.Add(shown); inner.Children.Add(change); inner.Children.Add(editor);
        fork.Content = inner;
        body.Children.Add(fork);
        body.Children.Add(save); body.Children.Add(saved);

        var sides = new Grid();
        sides.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        sides.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var left = new ScrollViewer { Content = body, MaxHeight = 640 };
        sides.Children.Add(left);
        Grid.SetColumn(feedPane, 1);
        sides.Children.Add(feedPane);
        var dlg = new ContentDialog { Title = "Updates", Content = sides, CloseButtonText = "Close", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        dlg.Resources["ContentDialogMaxWidth"] = 1120.0;   // room for the feed beside the settings
        try { await dlg.ShowAsync(); } catch (Exception ex) { SetStatus("updates: " + ex.Message); }
    }

    /// <summary>Numeric version order (0.26.9 before 0.26.10); anything after a '+' or a space is not compared.</summary>
    private static int CompareVersions(string a, string b)
    {
        static int[] Parts(string v) => v.Split('+', ' ')[0].TrimStart('v').Split('.', '-').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray();
        var x = Parts(a); var y = Parts(b);
        for (var i = 0; i < Math.Max(x.Length, y.Length); i++)
        {
            var d = (i < x.Length ? x[i] : 0) - (i < y.Length ? y[i] : 0);
            if (d != 0) return d < 0 ? -1 : 1;
        }
        return 0;
    }

    /// <summary>The staged version started, this one closed (the hand-off App.OnLaunched makes at every start, here by the person's press).</summary>
    private void RestartIntoStaged()
    {
        var st = Services.Updates.Staged();
        if (st is null) { SetPill("Prism" + Mid + "nothing is staged"); return; }
        // the staged copy installs itself into the install folder once this one has closed (--prism-promote), then starts Prism from there
        if (Services.Updates.StartPromotion(LogLine)) Close();
        else SetPill("Prism" + Mid + "could not start " + st.Value.version);
    }

    // ---- the restart offer (2026-10-06, "can you show a restart now button temporarily with the status that comes up suggesting restart"): when a
    // new version has finished installing - Install now, or the night window (RefreshUpdateNotice) - the status line says so with a Restart now button beside it, once
    // per version, for 45 seconds; any other status line takes its place. The Updates dialog and the menu's note still say it after.
    private Button? _pillAction;
    private string? _pillActionFor;
    private string? _restartOffered;

    private void OfferRestartIfStaged()
    {
        if (Services.Updates.Staged() is not { } st || st.version == _restartOffered) return;
        _restartOffered = st.version;
        ShowPillOffer("Prism" + Mid + st.version + " is installed. Restart to switch to it", "Restart now", RestartIntoStaged, 45);
        LogLine("updates: " + st.version + " installed, restart offered");
    }

    /// <summary>A status line with one button beside it, held for a while; any other status line takes its place and the button goes with it.</summary>
    private void ShowPillOffer(string text, string button, Action press, int seconds)
    {
        SetPill(text, hold: true);
        RootGrid.DispatcherQueue.TryEnqueue(() =>
        {
            if (_pillAction is not null) PillRow.Children.Remove(_pillAction);
            var b = Chip(new TextBlock { Text = button, FontSize = 12, Foreground = HubAmber }, true);
            b.Padding = new Thickness(10, 2, 10, 2);
            b.Click += (_, __) => press();
            PillRow.Children.Add(b);
            _pillAction = b; _pillActionFor = text;
            var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(seconds) };
            t.Tick += (_, __) => { t.Stop(); if (_pillActionFor == text) ReleasePill(""); };
            t.Start();
        });
    }

    /// <summary>
    /// The first-run note (2026-10-06, "add the first-run note"): a download installs itself silently into the fixed folder on its first run, so
    /// the installed copy says once where Prism now lives - the Start menu - and that the folder it was unzipped into can be deleted, with a
    /// button that opens that folder. Someone moved over from an older Prism's update folder gets the first half only: that folder is
    /// removed by Prism itself. Shown a few seconds into the start, after the splash, for a minute.
    /// </summary>
    private void ShowInstalledNoteIfAny()
    {
        if (Services.Updates.InstalledFrom() is not { } from) return;
        var oldUpdate = Services.Updates.IsOldUpdateFolder(from);
        LogLine("updates: first-run note (installed from " + (oldUpdate ? "an older update folder" : from) + ")");
        // the shortcuts asked first (2026-10-06, "we should prompt the user to see whether they want to add a shortcut to their desktop, taskbar,
        // start menu"); someone moved over from an older Prism's update folder already had theirs, repointed at the install folder
        _ = Task.Delay(TimeSpan.FromSeconds(6)).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(async () =>
        {
            if (!oldUpdate) await AskShortcutsAsync(true);
            if (oldUpdate || !System.IO.Directory.Exists(from))
                SetPill("Prism" + Mid + "installed. It updates itself from now on.");
            else
                ShowPillOffer("Prism" + Mid + "installed. You can delete the folder you downloaded it to.", "Show that folder", () => OpenPath(from), 60);
        }));
    }
}
