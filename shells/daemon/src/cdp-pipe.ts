/**
 * Minimal CDP client over --remote-debugging-pipe (fd 3 out, fd 4 in,
 * NUL-delimited JSON). Modern Chromium builds no longer honor
 * --remote-debugging-port; the pipe is the supported programmatic
 * transport (it also needs no sockets). Uses flat session mode:
 * Target.attachToTarget({flatten:true}) and per-message sessionId.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

interface CdpError {
  code: number;
  message: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: CdpError;
  sessionId?: string;
}

export type CdpEventHandler = (params: Record<string, unknown>, sessionId?: string) => void;

export class PipeCdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private events = new EventEmitter();
  private writer: Writable;
  private buffer = "";

  constructor(proc: ChildProcess) {
    const out = proc.stdio[3] as Writable | null;
    const inp = proc.stdio[4] as Readable | null;
    if (!out || !inp) throw new Error("browser was not spawned with CDP pipes on fd 3/4");
    this.writer = out;
    inp.setEncoding("utf8");
    inp.on("data", (chunk: string) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf("\0")) >= 0) {
        const raw = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        try {
          this.dispatch(JSON.parse(raw) as CdpMessage);
        } catch {
          /* skip malformed frames */
        }
      }
    });
    proc.on("exit", () => {
      const err = new Error("browser exited");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
  }

  private dispatch(msg: CdpMessage): void {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else p.resolve(msg.result ?? {});
    } else if (msg.method) {
      this.events.emit(msg.method, msg.params ?? {}, msg.sessionId);
    }
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: CdpMessage = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.writer.write(JSON.stringify(msg) + "\0");
    });
  }

  on(method: string, handler: CdpEventHandler): void {
    this.events.on(method, (params: Record<string, unknown>, sessionId?: string) =>
      handler(params, sessionId),
    );
  }
}
