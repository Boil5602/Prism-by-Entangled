// The recording's sound (2026-11-08, the break-watch redesign's Phase D): while the break watch records frames to the bench folder, the
// services' browser process is captured (the same shared process loopback the listen page and the visualizer use) and written as MP3,
// 16 kHz mono 32 kbps, in files of an hour under diagnostics/bench/_audio; keep.py carries them into the day's golden folder beside the
// frames. audio.log beside them says which tile had the sound when each file began and whenever it changed, so a file can be read
// against that window's frames. A sidecar: the frames are never altered. Off unless the recording is on (PRISM_FRAME_SAMPLER=1 and
// Keep recording or Ad debug), and PRISM_GOLDEN_AUDIO=0 keeps it off even then.
using System;
using System.IO;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using PrismHost.Services.Audio;

namespace PrismHost.Services;

internal static class GoldenAudio
{
    private static readonly object s_gate = new();
    private static ProcessLoopbackCapture.Shared? s_capture;
    private static uint s_pid;
    private static BufferedWaveProvider? s_buffer;
    private static ISampleProvider? s_resampled;
    private static NAudio.Lame.LameMP3FileWriter? s_writer;
    private static FileStream? s_file;
    private static DateTime s_fileAt;
    private static string s_owner = "";
    private static long s_frames;
    private static Action<string>? s_log;
    private static float s_gain = 1f;
    // the splice detector (2026-11-08, the redesign's Phase D): the mono stream's RMS over 50 ms blocks; a run of 150 ms or more under
    // -50 dBFS is logged to splice.log with its start (ms of the day) and length, the cheap half of the splice (the black half is in the frames)
    private static double s_blockSum; private static int s_blockN; private static long s_blockStartMs = -1, s_quietSinceMs = -1; private static int s_quietBlocks;
    private const double QuietDb = -50; private const int BlockSamples = 48000 / 20;
    private static readonly float[] s_mono = new float[4800];
    private static readonly byte[] s_pcm = new byte[9600];
    private static readonly float[] s_out = new float[4800];
    private static readonly WaveFormat s_outFormat = new(16000, 16, 1);

    private static string Dir => Path.Combine(HostPaths.DataDir, "diagnostics", "bench", "_audio");
    public static bool Enabled => Environment.GetEnvironmentVariable("PRISM_GOLDEN_AUDIO") != "0";

    /// <summary>Capture the browser pid's sound (a no-op when it already is); a change of pid reopens.</summary>
    public static void Ensure(uint pid, Action<string> log)
    {
        if (!Enabled || pid == 0) return;
        lock (s_gate)
        {
            s_log = log;
            if (s_capture is not null && s_pid == pid) return;
            StopLocked();
            try
            {
                // ReadFully false (2026-11-08): with it true the provider pads an empty buffer with silence for ever, and the first live minute
                // wrote 195 MB of it; the resampler is read only for what the buffer holds
                s_buffer = new BufferedWaveProvider(WaveFormat.CreateIeeeFloatWaveFormat(48000, 1)) { BufferDuration = TimeSpan.FromSeconds(10), DiscardOnBufferOverflow = true, ReadFully = false };
                s_resampled = new WdlResamplingSampleProvider(s_buffer.ToSampleProvider(), 16000);
                s_capture = ProcessLoopbackCapture.Take(pid, OnFrames); s_pid = pid;
                log("golden audio: capture of browser " + pid + " started");
            }
            catch (Exception ex) { log("golden audio: capture failed (" + ex.Message + ")"); StopLocked(); }
        }
    }

    /// <summary>The level the muter has in force on the browser (SessionMuter.LevelApplied): the recording undoes it as the listen page does
    /// (the room step's floor while PRISM is muted in the room, the wall's volume otherwise), so the file holds the sound at full.</summary>
    public static void SourceLevel(uint pid, float level)
    {
        var g = ListenStream.GainFor(level); if (float.IsNaN(g)) return;
        lock (s_gate) { if (pid == s_pid && g != s_gain) { s_gain = g; Note("gain " + (g == 1f ? "1" : "x" + Math.Round(g))); } }
    }

    /// <summary>The tile whose sound this is (the stage's audio owner), for audio.log.</summary>
    public static void Owner(string tile)
    {
        lock (s_gate)
        {
            if (tile == s_owner) return;
            s_owner = tile;
            if (s_writer is not null) Note("owner " + tile);
        }
    }

    public static void Stop()
    {
        lock (s_gate) StopLocked();
    }

    private static void StopLocked()
    {
        try { s_capture?.Dispose(); } catch { }
        s_capture = null; s_pid = 0;
        CloseFile();
        s_buffer = null; s_resampled = null;
    }

    private static void OnFrames(float[] samples, int frames, int channels)
    {
        // 48 kHz interleaved float from the capture (the count is FRAMES, each `channels` floats; 2026-11-08: dividing again halved the
        // recording and doubled its pitch for its first hour) -> mono float into the buffer; the resampler and the encoder run on this thread too
        lock (s_gate)
        {
            if (s_buffer is null || s_resampled is null) return;
            for (var k = 0; k < frames; k += s_mono.Length)
            {
                var n = Math.Min(s_mono.Length, frames - k);
                for (var i = 0; i < n; i++)
                {
                    float sum = 0; for (var c = 0; c < channels; c++) sum += samples[(k + i) * channels + c];
                    s_mono[i] = sum / channels * s_gain;
                    s_blockSum += (double)s_mono[i] * s_mono[i]; if (++s_blockN >= BlockSamples) Block();
                }
                var bytes = new byte[n * 4]; Buffer.BlockCopy(s_mono, 0, bytes, 0, bytes.Length);
                s_buffer.AddSamples(bytes, 0, bytes.Length);
            }
            try
            {
                int got; var rounds = 0;
                while (s_buffer.BufferedBytes >= 4 * 480 && rounds++ < 8 && (got = s_resampled.Read(s_out, 0, Math.Min(s_out.Length, s_buffer.BufferedBytes / 12))) > 0)
                {
                    EnsureFile();
                    for (var i = 0; i < got; i++) { var v = (short)Math.Clamp(s_out[i] * 32767f, -32768f, 32767f); s_pcm[2 * i] = (byte)v; s_pcm[2 * i + 1] = (byte)(v >> 8); }
                    s_writer!.Write(s_pcm, 0, got * 2); s_frames += got;
                }
            }
            catch (Exception ex) { s_log?.Invoke("golden audio: write failed (" + ex.Message + ")"); CloseFile(); }
        }
    }

    private static void Block()
    {
        var nowMs = (long)DateTime.Now.TimeOfDay.TotalMilliseconds;
        var db = 10 * Math.Log10(Math.Max(1e-12, s_blockSum / Math.Max(1, s_blockN))); s_blockSum = 0; s_blockN = 0;
        if (db < QuietDb)
        {
            if (s_quietSinceMs < 0) { s_quietSinceMs = nowMs - 50; s_quietBlocks = 0; }
            s_quietBlocks++;
        }
        else if (s_quietSinceMs >= 0)
        {
            var len = s_quietBlocks * 50;
            if (len >= 150) Splice("silence " + s_quietSinceMs + " " + len);
            s_quietSinceMs = -1; s_quietBlocks = 0;
        }
    }

    private static void Splice(string what)
    {
        try { Directory.CreateDirectory(Dir); File.AppendAllText(Path.Combine(Dir, "splice.log"), Diagnostics.Redact.Line(DateTime.Now.ToString("HH:mm:ss.fff") + " " + what + " owner " + s_owner) + Environment.NewLine); } catch { }
    }

    private static void EnsureFile()
    {
        var now = DateTime.Now;
        if (s_writer is not null && now - s_fileAt < TimeSpan.FromHours(1) && now.Date == s_fileAt.Date) return;
        CloseFile();
        Directory.CreateDirectory(Dir);
        var path = Path.Combine(Dir, now.ToString("HHmmss") + ".mp3");
        s_file = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read);
        s_writer = new NAudio.Lame.LameMP3FileWriter(s_file, s_outFormat, 32); s_fileAt = now; s_frames = 0;
        Note("file " + Path.GetFileName(path) + " owner " + s_owner + " pid " + s_pid);
    }

    private static void CloseFile()
    {
        try { s_writer?.Flush(); s_writer?.Dispose(); } catch { }
        try { s_file?.Dispose(); } catch { }
        if (s_writer is not null) Note("closed " + s_frames / 16000 + " s");
        s_writer = null; s_file = null;
    }

    private static void Note(string what)
    {
        try { Directory.CreateDirectory(Dir); File.AppendAllText(Path.Combine(Dir, "audio.log"), Diagnostics.Redact.Line(DateTime.Now.ToString("HH:mm:ss.fff") + " " + what) + Environment.NewLine); } catch { }
    }
}
