using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace PrismHost.Services.Audio;

/// <summary>
/// B-152 (2026-09-08): a loopback capture scoped to ONE process tree - the music source's own WebView2
/// browser process - through the Windows 10 2004+ virtual device VAD\Process_Loopback
/// (ActivateAudioInterfaceAsync + AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK). The device loopback
/// it replaces heard everything the machine played, and a conference call in another app moved the
/// stage. This hears the source and nothing else.
///
/// Delivers interleaved 32-bit float frames at 48 kHz stereo (process loopback needs the caller to
/// name the format) through <see cref="Frames"/> from a background pump thread.
/// </summary>
internal sealed class ProcessLoopbackCapture : IDisposable
{
    private const string VirtualDevice = "VAD\\Process_Loopback";
    private static readonly Guid IidAudioClient = new("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");

    private AudioClient? _client;
    private Thread? _pump;
    private readonly AutoResetEvent _event = new(false);
    private volatile bool _stop;

    public uint Pid { get; private set; }
    public WaveFormat Format { get; } = WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);
    /// <summary>The pump's first failure, if any - the owner restarts or falls back.</summary>
    public Exception? Error { get; private set; }
    /// <summary>Diagnostics: packets and frames delivered, packets the engine flagged silent, wakes of the pump.</summary>
    public long Packets, FramesTotal, SilentPackets, Wakes, Peak1000;
    /// <summary>(interleaved samples, frame count, channels) - the buffer is reused; copy what you keep.</summary>
    public event Action<float[], int, int>? Frames;

    public static ProcessLoopbackCapture Start(uint pid, Action<float[], int, int> onFrames)
    {
        var c = new ProcessLoopbackCapture { Pid = pid };
        c.Frames += onFrames;
        // the activation and the client live in the multithreaded apartment: from the UI thread's STA the activated
        // object could not be cast to IAudioClient (seen live 2026-09-08); from an MTA thread it can
        Exception? failed = null;
        // the activation has been seen to fail the IAudioClient cast once and succeed on the retry (three times on 2026-09-08)
        var t = new Thread(() => { try { try { c.Activate(pid); } catch (InvalidCastException) { Thread.Sleep(150); c.Activate(pid); } c.Run(); } catch (Exception ex) { failed = ex; } }) { IsBackground = true, Name = "prism-process-loopback-activate" };
        t.SetApartmentState(ApartmentState.MTA);
        t.Start(); t.Join(8000);
        if (failed is not null) { c.Dispose(); throw failed; }
        if (c._client is null) { c.Dispose(); throw new TimeoutException("process loopback activation did not complete"); }
        return c;
    }

    private void Activate(uint pid)
    {
        // AUDIOCLIENT_ACTIVATION_PARAMS { ActivationType; ProcessLoopbackParams { TargetProcessId; ProcessLoopbackMode } } - 12 bytes
        const int paramsSize = 12;
        var pParams = Marshal.AllocHGlobal(paramsSize);
        var pv = Marshal.AllocHGlobal(24);   // PROPVARIANT (x64)
        try
        {
            Marshal.WriteInt32(pParams, 0, 1);                // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
            Marshal.WriteInt32(pParams, 4, unchecked((int)pid));
            Marshal.WriteInt32(pParams, 8, 0);                // PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
            for (var i = 0; i < 24; i++) Marshal.WriteByte(pv, i, 0);
            Marshal.WriteInt16(pv, 0, 0x41);                  // VT_BLOB
            Marshal.WriteInt32(pv, 8, paramsSize);            // blob.cbSize
            Marshal.WriteIntPtr(pv, 16, pParams);             // blob.pBlobData

            var handler = new Handler();
            var iid = IidAudioClient;
            ActivateAudioInterfaceAsync(VirtualDevice, ref iid, pv, handler, out _);
            if (!handler.Done.Wait(5000)) throw new TimeoutException("process loopback activation did not complete");
            var (hr, obj) = handler.Result;
            if (hr < 0 || obj is null) throw new COMException("process loopback activation failed", hr);
            var client = new AudioClient((IAudioClient)obj);
            client.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.Loopback | AudioClientStreamFlags.EventCallback, 2_000_000, 0, Format, Guid.Empty);
            client.SetEventHandle(_event.SafeWaitHandle.DangerousGetHandle());
            _client = client;
        }
        finally { Marshal.FreeHGlobal(pv); Marshal.FreeHGlobal(pParams); }
    }

    private void Run()
    {
        _client!.Start();
        _pump = new Thread(Pump) { IsBackground = true, Name = "prism-process-loopback" };
        _pump.Start();
    }

    private void Pump()
    {
        var cc = _client!.AudioCaptureClient;
        var ch = Format.Channels;
        var buf = new float[4096 * ch];
        while (!_stop)
        {
            _event.WaitOne(50);   // the event, or a poll - process loopback has been seen to under-signal
            Wakes++;
            try
            {
                while (!_stop && cc.GetNextPacketSize() > 0)
                {
                    var ptr = cc.GetBuffer(out var frames, out var flags);
                    var n = frames * ch;
                    if (buf.Length < n) buf = new float[n];
                    Packets++; FramesTotal += frames;
                    if ((flags & AudioClientBufferFlags.Silent) != 0) { SilentPackets++; Array.Clear(buf, 0, n); }
                    else { Marshal.Copy(ptr, buf, 0, n); float pk = 0; for (var i = 0; i < n; i++) pk = Math.Max(pk, Math.Abs(buf[i])); Peak1000 = (long)(pk * 1000); }
                    cc.ReleaseBuffer(frames);
                    Frames?.Invoke(buf, frames, ch);
                }
            }
            catch (Exception ex) { Error = ex; break; }
        }
    }

    public void Dispose()
    {
        _stop = true;
        // the client lives in the multithreaded apartment (Start): from the UI thread's STA even its Stop cannot be cast
        // (E_NOINTERFACE at every visualization stop, 2026-09-08) and the client leaked running - the teardown goes where it lives
        var t = new Thread(() =>
        {
            try { _client?.Stop(); } catch { }
            try { _pump?.Join(500); } catch { }
            try { _client?.Dispose(); } catch { }
        }) { IsBackground = true, Name = "prism-process-loopback-stop" };
        t.SetApartmentState(ApartmentState.MTA);
        t.Start(); t.Join(2000);
        _event.Dispose();
    }

    // ---- interop

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    private static extern void ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        ref Guid riid,
        IntPtr activationParams,
        IActivateAudioInterfaceCompletionHandler completionHandler,
        out IActivateAudioInterfaceAsyncOperation activationOperation);

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object? activatedInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation);
    }

    [ComVisible(true)]
    public sealed class Handler : IActivateAudioInterfaceCompletionHandler
    {
        public readonly ManualResetEventSlim Done = new(false);
        public (int hr, object? obj) Result;
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation)
        {
            try { activateOperation.GetActivateResult(out var hr, out var obj); Result = (hr, obj); }
            catch (Exception ex) { Result = (ex.HResult, null); }
            Done.Set();
        }
    }
}
