/**
 * Browser pool (spec §10 on the daemon): one Chromium process per storage
 * profile, each with its own persistent user-data-dir under the daemon's
 * data dir. Tiles live in that browser's DEFAULT context, so cookies,
 * localStorage, IndexedDB, and service workers survive restarts exactly
 * like the Android per-profile WebView storage.
 *
 * Isolation between profiles is process isolation; tiles that share a
 * profile string deliberately share a session (§10). Nothing here ever
 * clears a data dir — updates migrate, never wipe.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PipeCdp } from "./cdp-pipe.js";

export interface Browser {
  profile: string;
  proc: ChildProcess;
  cdp: PipeCdp;
}

export class BrowserPool {
  private browsers = new Map<string, Promise<Browser>>();
  /** Called once per newly spawned browser so callers can subscribe to its events. */
  onSpawn: ((browser: Browser) => void) | null = null;

  constructor(
    private exe: string,
    private dataDir: string,
    private onExit: (profile: string, code: number | null) => void,
  ) {}

  /** The browser for a profile, spawning it on first use. */
  get(profile: string): Promise<Browser> {
    let b = this.browsers.get(profile);
    if (!b) {
      b = this.spawn(profile);
      this.browsers.set(profile, b);
    }
    return b;
  }

  profiles(): string[] {
    return [...this.browsers.keys()];
  }

  async killAll(): Promise<void> {
    for (const [profile, p] of this.browsers) {
      this.browsers.delete(profile);
      try {
        (await p).proc.kill();
      } catch {
        /* already gone */
      }
    }
  }

  private async spawn(profile: string): Promise<Browser> {
    const dir = join(this.dataDir, "profiles", safeName(profile));
    mkdirSync(dir, { recursive: true });
    const proc = spawn(
      this.exe,
      [
        "--remote-debugging-pipe",
        `--user-data-dir=${dir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        "--disable-features=InfiniteSessionRestore",
        "--start-minimized",
        "--no-startup-window",
      ],
      { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
    );
    proc.on("exit", (code) => {
      this.browsers.delete(profile);
      this.onExit(profile, code);
    });
    const cdp = new PipeCdp(proc);
    const version = await cdp.send("Browser.getVersion");
    console.log(`[prism-daemon] browser for profile '${profile}': ${String(version["product"])} (${dir})`);
    const browser: Browser = { profile, proc, cdp };
    this.onSpawn?.(browser);
    return browser;
  }
}

function safeName(profile: string): string {
  return profile.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 64) || "default";
}
