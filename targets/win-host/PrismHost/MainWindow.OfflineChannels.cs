using System;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace PrismHost;

/// <summary>
/// Followed channels that are off the air (2026-10-06): an offline channel's card cannot be dragged into a window ("if the channel is offline
/// (i have one for coshmack that is offline), it wouldn't make sense to make it draggable"), and Hide offline leaves them out of the row - the
/// whole row when every channel is offline ("Lets add a checkbox on Twitch Followed Channels that says Hide Offline. And if all are offline, then
/// we might as well hide the whole row and save the space"). The box stands on the row and in Watch settings (the row may be gone).
/// </summary>
public sealed partial class MainWindow
{
    private static bool HideOfflineChannels => HostPrefs.GetBool("video.hideOfflineChannels", false);

    /// <summary>A channel the service says is off the air (Twitch's Followed row reads "Offline" under it).</summary>
    private static bool ChannelOffline(JsonObject item) =>
        (item["kind"]?.GetValue<string>() ?? "") == "channel"
        && string.Equals((item["subtitle"]?.GetValue<string>() ?? "").Trim(), "Offline", StringComparison.OrdinalIgnoreCase);

    private CheckBox HideOfflineBox(double size)
    {
        var box = new CheckBox { Content = new TextBlock { Text = "Hide offline", FontSize = size, Foreground = HubInk }, IsChecked = HideOfflineChannels, VerticalAlignment = VerticalAlignment.Center, MinWidth = 0 };
        ToolTipService.SetToolTip(box, "Leave channels that are offline out of your followed channels rows. With every channel offline the row is hidden. This setting is also in Watch settings.");
        void Set(bool on)
        {
            if (HideOfflineChannels == on) return;
            HostPrefs.Set("video.hideOfflineChannels", on);
            LogLine("watch: hide offline channels " + (on ? "on" : "off"));
            if (VideoHubOpen) _ = ShowVideoHubAsync();
        }
        box.Checked += (_, __) => Set(true);
        box.Unchecked += (_, __) => Set(false);
        return box;
    }
}
