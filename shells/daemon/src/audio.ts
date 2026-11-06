/**
 * Private listening capture for the daemon (spec §14) — the ONE capture mix.
 *
 * Linux/PrismOS: PipeWire's monitor source captures full system output —
 * every tile, everything — through ffmpeg's pulse input (`@DEFAULT_MONITOR@`
 * under pipewire-pulse), encoded once to AAC-LC/ADTS and fanned out to
 * every transport subscriber. The Windows recipe needs a loopback device
 * the user names (`--audio-source dshow:<device>`); without one, private
 * listening reports unsupported rather than pretending.
 *
 * `test:` is an in-process synthetic source (no ffmpeg) used to verify the
 * HTTP path, ticket auth, and peer-drop detection where no capture exists.
 *
 * Core decides when capture starts and stops; this only moves bytes.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";

export interface AudioSubscriber {
  listener: string;
  out: Writable;
}

export class AudioCapture {
  private proc: ChildProcess | null = null;
  private testTimer: ReturnType<typeof setInterval> | null = null;
  private subscribers = new Set<AudioSubscriber>();
  capturing = false;
  /** A subscriber's socket died without the phone leaving — §14 unexpected loss. */
  onLost: ((listener: string) => void) | null = null;

  constructor(
    private source: string | null,
    /** Local UDP port the Opus RTP output targets (WebRTC sender); null = no webrtc. */
    private rtpPort: number | null = null,
    private ffmpeg = "ffmpeg",
  ) {}

  /**
   * Transports this daemon can serve from the one mix: http whenever a
   * source is configured; webrtc when ffmpeg also emits Opus RTP (not for
   * the synthetic test source, which has no encoder).
   */
  transports(): Array<"webrtc" | "http"> {
    if (!this.source) return [];
    const real = !this.source.startsWith("test:");
    return real && this.rtpPort ? ["webrtc", "http"] : ["http"];
  }

  start(): void {
    if (this.capturing || !this.source) return;
    if (this.source.startsWith("test:")) {
      // Synthetic ADTS-shaped frames at ~130 kbps so the plumbing is exercised.
      let seq = 0;
      this.testTimer = setInterval(() => {
        const frame = Buffer.alloc(340);
        frame[0] = 0xff;
        frame[1] = 0xf9;
        frame.fill(seq++ & 0xff, 7);
        this.broadcast(frame);
      }, 21); // 1024 samples @ 48 kHz ≈ 21.3 ms per AAC frame
      this.capturing = true;
      console.log("[prism-daemon] audio capture started (test source)");
      return;
    }
    // One input, two outputs from the same mix: AAC/ADTS on stdout for the
    // HTTP transport, Opus RTP to the local WebRTC sender (§14 dual transport).
    const args = this.inputArgs(this.source).concat([
      "-vn", "-ac", "2", "-ar", "48000",
      "-c:a", "aac", "-b:a", "128k", "-f", "adts", "pipe:1",
      ...(this.rtpPort
        ? ["-vn", "-ac", "2", "-ar", "48000", "-c:a", "libopus", "-b:a", "96k", "-application", "lowdelay",
           "-payload_type", "111", "-f", "rtp", `rtp://127.0.0.1:${this.rtpPort}?pkt_size=1200`]
        : []),
    ]);
    const proc = spawn(this.ffmpeg, ["-hide_banner", "-loglevel", "error", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout!.on("data", (chunk: Buffer) => this.broadcast(chunk));
    proc.stderr!.on("data", (d: Buffer) => console.warn(`[prism-daemon] ffmpeg: ${d.toString().trim()}`));
    proc.on("exit", (code) => {
      if (this.capturing) console.warn(`[prism-daemon] ffmpeg exited (${code}); capture ended`);
      this.capturing = false;
      this.proc = null;
      this.closeAll();
    });
    proc.on("error", (e) => console.warn(`[prism-daemon] ffmpeg unavailable: ${String(e)}`));
    this.proc = proc;
    this.capturing = true;
    console.log(`[prism-daemon] audio capture started (${this.source})`);
  }

  stop(): void {
    if (!this.capturing) return;
    this.capturing = false;
    if (this.testTimer) clearInterval(this.testTimer);
    this.testTimer = null;
    this.proc?.kill();
    this.proc = null;
    this.closeAll();
    console.log("[prism-daemon] audio capture stopped");
  }

  subscribe(s: AudioSubscriber): void {
    this.subscribers.add(s);
  }

  unsubscribe(s: AudioSubscriber): void {
    this.subscribers.delete(s);
  }

  /** True if the subscriber was still registered (i.e. we did not end it ourselves). */
  unsubscribeIfPresent(s: AudioSubscriber): boolean {
    return this.subscribers.delete(s);
  }

  count(): number {
    return this.subscribers.size;
  }

  private broadcast(chunk: Buffer): void {
    for (const s of this.subscribers) {
      if (s.out.destroyed || s.out.writableEnded) {
        this.subscribers.delete(s);
        this.onLost?.(s.listener);
        continue;
      }
      s.out.write(chunk, (err) => {
        if (err && this.subscribers.delete(s)) this.onLost?.(s.listener);
      });
    }
  }

  private closeAll(): void {
    for (const s of this.subscribers) {
      try {
        s.out.end();
      } catch {
        /* already gone */
      }
    }
    this.subscribers.clear();
  }

  private inputArgs(source: string): string[] {
    const [kind, ...rest] = source.split(":");
    const target = rest.join(":");
    switch (kind) {
      case "pulse": // PipeWire via pipewire-pulse: the monitor of the default sink
        return ["-f", "pulse", "-i", target || "@DEFAULT_MONITOR@"];
      case "alsa":
        return ["-f", "alsa", "-i", target || "default"];
      case "dshow": // Windows recipe: a loopback device such as "virtual-audio-capturer"
        return ["-f", "dshow", "-i", `audio=${target}`];
      case "lavfi": // synthetic, for bring-up with ffmpeg present
        return ["-f", "lavfi", "-i", target || "sine=frequency=440:sample_rate=48000"];
      default:
        return ["-i", source];
    }
  }
}

/** Platform default: PipeWire monitor on Linux; nothing elsewhere (honest). */
export function defaultAudioSource(): string | null {
  return process.platform === "linux" ? "pulse:@DEFAULT_MONITOR@" : null;
}
