namespace PrismHost;

/// <summary>
/// The entry point, written out (2026-10-23) so one exe is two programs: with --launcher it is the phone launcher (Services/PhoneLauncher),
/// which opens no window and starts no XAML, and otherwise it is Prism, started exactly as the XAML compiler's own Main did.
/// </summary>
public static class Program
{
    [global::System.STAThread]
    static void Main(string[] args)
    {
        if (args.Contains(Services.PhoneLauncher.Arg)) { Services.PhoneLauncher.Run(); return; }
        global::WinRT.ComWrappersSupport.InitializeComWrappers();
        global::Microsoft.UI.Xaml.Application.Start(_ =>
        {
            var context = new global::Microsoft.UI.Dispatching.DispatcherQueueSynchronizationContext(global::Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread());
            global::System.Threading.SynchronizationContext.SetSynchronizationContext(context);
            new App();
        });
    }
}
