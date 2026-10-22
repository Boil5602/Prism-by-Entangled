using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// This PC's name (2026-10-21, "let the user name their machine, which we'll show top and center when the chrome or watch is up"):
/// a household with a Prism in the kitchen and one in the den can tell them apart from across the room. The name sits top and
/// centre of the music player's chrome (over the muted banner, which steps under it) and of Watch's header. It is set from the Prism
/// menu (both players), the Device page and Watch settings' This Prism tab, and it is a host preference (host-prefs.json, "machine.name"):
/// a thing about this PC, never part of the household's scenes, and it never leaves the PC - the phone page, the update check and the
/// reports carry nothing of it.
/// </summary>
public sealed partial class MainWindow
{
    private const string MachineNameKey = "machine.name";
    private const int MachineNameMax = 40;

    /// <summary>The name as set, or empty for none.</summary>
    private static string MachineName => CleanMachineName(HostPrefs.GetString(MachineNameKey, ""));

    /// <summary>One line, one space between words, at most forty characters.</summary>
    private static string CleanMachineName(string raw)
    {
        var s = string.Join(" ", (raw ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return s.Length > MachineNameMax ? s.Substring(0, MachineNameMax).TrimEnd() : s;
    }

    private static string MachineNameTip() =>
        (MachineName is { Length: > 0 } pc ? "This PC is " + pc + ". " : "") + "Shown at the top of the music player and of Watch. It stays on this PC.";

    /// <summary>Set (or clear, with an empty name) and show it everywhere it is up.</summary>
    private void SetMachineName(string raw)
    {
        var name = CleanMachineName(raw);
        if (name == MachineName) return;
        HostPrefs.Set(MachineNameKey, name);
        LogLine("machine name: " + (name.Length > 0 ? "\"" + name + "\"" : "cleared"));
        foreach (var parts in _vizParts.Values) if (parts.Name is { } t) t.Text = name;
        SyncChromeNames();
        if (VideoHubOpen) _ = ShowVideoHubAsync();
    }

    /// <summary>The chrome's name blocks shown while there is a name and Watch is down: Watch draws its own in the same place (2026-10-22).</summary>
    private void SyncChromeNames()
    {
        var show = MachineName.Length > 0 && !VideoHubOpen;
        foreach (var parts in _vizParts.Values) if (parts.Name is { } t) t.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>The chrome's block: the name in ink, read from across the room, nothing when there is none.</summary>
    private TextBlock MachineNameBlock()
    {
        var name = MachineName;
        return new TextBlock
        {
            Text = name, FontFamily = new FontFamily("Segoe UI"), FontSize = 26, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, CharacterSpacing = 30,
            Foreground = Tokens.Ink, Opacity = 0.92, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 700,
            HorizontalAlignment = HorizontalAlignment.Center, IsHitTestVisible = false,
            Visibility = name.Length > 0 && !VideoHubOpen ? Visibility.Visible : Visibility.Collapsed,
        };
    }

    /// <summary>Watch settings, This Prism tab: the name in a box, saved with the tab's Save and exit.</summary>
    private Func<List<string>> BuildMachineNameSection(StackPanel body)
    {
        var was = MachineName;
        body.Children.Add(new TextBlock { Text = "This PC's name", FontSize = 17, Foreground = HubInk });
        body.Children.Add(new TextBlock { Text = "Shown at the top of the music player and of Watch, so a household with more than one Prism can tell them apart. It stays on this PC.", FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        var box = new TextBox { Text = was, PlaceholderText = "Living room", MaxLength = MachineNameMax, Width = 380, FontSize = 15, HorizontalAlignment = HorizontalAlignment.Left };
        body.Children.Add(box);
        return () =>
        {
            var said = new List<string>();
            var name = CleanMachineName(box.Text);
            if (name == was) return said;
            SetMachineName(name);
            said.Add(name.Length > 0 ? "This PC is " + name : "This PC's name cleared");
            return said;
        };
    }

    /// <summary>The Prism menu's and the Device page's way: one box in a dialog. Empty clears the name.</summary>
    private async Task PromptMachineNameAsync()
    {
        var was = MachineName;
        var box = new TextBox { Text = was, PlaceholderText = "Living room", MaxLength = MachineNameMax, MinWidth = 420, SelectionStart = was.Length };
        var note = new TextBlock { Text = "Shown at the top of the music player and of Watch. It stays on this PC. Leave it empty for no name.", Foreground = Muted, FontSize = 12, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) };
        var body = new StackPanel();
        body.Children.Add(box);
        body.Children.Add(note);
        var dlg = new ContentDialog
        {
            Title = "Name this PC",
            Content = body,
            PrimaryButtonText = "Save",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = RootGrid.XamlRoot,
            RequestedTheme = ElementTheme.Dark,
        };
        try
        {
            if (await dlg.ShowAsync() != ContentDialogResult.Primary) return;
        }
        catch (Exception ex) { SetStatus("dialog: " + ex.Message); return; }
        var name = CleanMachineName(box.Text);
        SetMachineName(name);
        SetPill("Prism" + Mid + (name.Length > 0 ? "this PC is " + name : "this PC has no name"));
    }
}
