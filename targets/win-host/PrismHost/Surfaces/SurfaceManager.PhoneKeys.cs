using System.Text.Json;

namespace PrismHost.Surfaces;

/// <summary>
/// The phone's keyboard on a page (2026-10-03, "a simple web app delivered via QR codes ... enabling keyboard entry from phones"): what a
/// person types on the phone lands in the field focused on the wall, through the DevTools protocol's own input - trusted input, as a
/// keyboard's, into whatever the page has focused. Prism keeps nothing of it. Keys: Enter, Backspace, Tab, Escape and the D-pad.
/// </summary>
public sealed partial class SurfaceManager
{
    public async Task TypeTextAsync(string id, string text)
    {
        var tile = Get(id);
        if (tile?.View?.CoreWebView2 is not { } core || text.Length == 0) return;
        if (IsParkable(tile)) await WakeAsync(tile);
        try { await core.CallDevToolsProtocolMethodAsync("Input.insertText", JsonSerializer.Serialize(new { text })); }
        catch (Exception ex) { _onStatus("type: " + ex.Message); }
    }

    private static readonly Dictionary<string, (string key, string code, int vk)> PhoneKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ENTER"] = ("Enter", "Enter", 13), ["BACKSPACE"] = ("Backspace", "Backspace", 8), ["TAB"] = ("Tab", "Tab", 9), ["ESCAPE"] = ("Escape", "Escape", 27),
        ["DPAD_UP"] = ("ArrowUp", "ArrowUp", 38), ["DPAD_DOWN"] = ("ArrowDown", "ArrowDown", 40), ["DPAD_LEFT"] = ("ArrowLeft", "ArrowLeft", 37), ["DPAD_RIGHT"] = ("ArrowRight", "ArrowRight", 39),
        ["SPACE"] = (" ", "Space", 32),
    };
    public async Task SendKeyAsync(string id, string key)
    {
        var tile = Get(id);
        if (tile?.View?.CoreWebView2 is not { } core || !PhoneKeys.TryGetValue(key, out var k)) return;
        if (IsParkable(tile)) await WakeAsync(tile);
        try
        {
            // a key that makes a character is a keyDown with its text; one that does not (Backspace, the arrows) is a rawKeyDown, as a keyboard's
            var text = k.vk == 13 ? "\r" : k.vk == 32 ? " " : null;
            var down = new Dictionary<string, object> { ["type"] = text is null ? "rawKeyDown" : "keyDown", ["key"] = k.key, ["code"] = k.code, ["windowsVirtualKeyCode"] = k.vk, ["nativeVirtualKeyCode"] = k.vk };
            if (text is not null) down["text"] = text;   // a null is refused by the protocol ("The parameter is incorrect")
            await core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", JsonSerializer.Serialize(down));
            await core.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", JsonSerializer.Serialize(new Dictionary<string, object> { ["type"] = "keyUp", ["key"] = k.key, ["code"] = k.code, ["windowsVirtualKeyCode"] = k.vk, ["nativeVirtualKeyCode"] = k.vk }));
        }
        catch (Exception ex) { _onStatus("key: " + ex.Message); }
    }
}
