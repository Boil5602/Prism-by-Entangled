/**
 * WebRTC sender for private listening (spec §14) — the low-latency
 * transport, fed from the SAME capture mix as the HTTP stream.
 *
 * ffmpeg packetizes the mix as Opus RTP to a local UDP port (see
 * audio.ts); each admitted listener gets a sendonly peer connection whose
 * audio track is written those RTP packets. Signaling (offer/answer/ICE)
 * rides the §6 remote API and is relayed by core, which decides who may
 * negotiate; this file only moves packets.
 */

import { createSocket, type Socket } from "node:dgram";
import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  RtpPacket,
} from "werift";

const OPUS = new RTCRtpCodecParameters({
  mimeType: "audio/opus",
  clockRate: 48000,
  channels: 2,
  payloadType: 111,
});

export class WebRtcSender {
  private peers = new Map<string, RTCPeerConnection>();
  private tracks = new Map<string, MediaStreamTrack>();
  private udp: Socket | null = null;
  /** A peer that failed/closed without the phone leaving — §14 unexpected loss. */
  onLost: ((listener: string) => void) | null = null;

  constructor(private rtpPort: number) {}

  /** Bind the local RTP intake once; ffmpeg targets this port while capturing. */
  start(): void {
    if (this.udp) return;
    const sock = createSocket("udp4");
    sock.on("message", (buf) => {
      if (this.tracks.size === 0) return;
      let packet: RtpPacket;
      try {
        packet = RtpPacket.deSerialize(buf);
      } catch {
        return;
      }
      for (const track of this.tracks.values()) track.writeRtp(packet);
    });
    sock.bind(this.rtpPort, "127.0.0.1");
    this.udp = sock;
  }

  stop(): void {
    for (const id of [...this.peers.keys()]) void this.close(id);
    this.udp?.close();
    this.udp = null;
  }

  count(): number {
    return this.peers.size;
  }

  /** Answer a listener's offer with a sendonly Opus track. */
  async offer(listener: string, offerSdp: string): Promise<string> {
    await this.close(listener); // renegotiation from scratch is simplest and rare
    const pc = new RTCPeerConnection({ codecs: { audio: [OPUS] } });
    const track = new MediaStreamTrack({ kind: "audio" });
    pc.addTrack(track);
    pc.connectionStateChange.subscribe((state) => {
      if ((state === "failed" || state === "closed" || state === "disconnected") && this.peers.get(listener) === pc) {
        this.peers.delete(listener);
        this.tracks.delete(listener);
        this.onLost?.(listener);
      }
    });
    this.peers.set(listener, pc);
    this.tracks.set(listener, track);
    await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    // Gather ICE (host candidates on the LAN) before answering — no trickle
    // needed for the frame's side; the phone may still trickle its own.
    await new Promise<void>((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const timer = setTimeout(resolve, 2000);
      pc.iceGatheringStateChange.subscribe((s) => {
        if (s === "complete") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return pc.localDescription?.sdp ?? answer.sdp;
  }

  async ice(listener: string, candidateJson: string): Promise<void> {
    const pc = this.peers.get(listener);
    if (!pc) return;
    try {
      const c = JSON.parse(candidateJson) as { candidate: string; sdpMid?: string; sdpMLineIndex?: number };
      await pc.addIceCandidate(c);
    } catch {
      /* malformed candidate — ignore */
    }
  }

  /** Explicit leave: the phone asked; not a loss. */
  async close(listener: string): Promise<void> {
    const pc = this.peers.get(listener);
    this.peers.delete(listener);
    this.tracks.delete(listener);
    if (pc) await pc.close().catch(() => {});
  }
}
