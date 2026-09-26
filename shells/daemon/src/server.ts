/**
 * Remote API listener (§6) for the daemon. Same posture as the Android
 * shell's server: static remote page served directly, everything else
 * forwarded verbatim into core's RemoteApi — routing and auth live there.
 *
 * Also serves `/packs/<pack>/<file>` from the local imagery directory for
 * the §26/§27 veil — the page loads art from localhost, never the web.
 */

import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import type { RemoteApi } from "prism-core";
import type { AudioCapture } from "./audio.js";

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function startServer(
  remote: RemoteApi,
  port: number,
  remoteHtmlPath: string,
  packsDir?: string,
  capture?: AudioCapture,
): Server {
  // CORS: the remote PWA installed from one frame controls the others (§6
  // multi-frame picker). Bearer-only auth, no cookies ⇒ wildcard is safe.
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
  const server = createServer((req, res) => {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Max-Age": "86400" });
      res.end();
      return;
    }
    void (async () => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/remote")) {
        try {
          // Bake the phone's token into the manifest link server-side: iOS
          // reads the manifest before scripts run and installs its start_url.
          const t = url.searchParams.get("token");
          let html = readFileSync(remoteHtmlPath, "utf8");
          if (t) html = html.replace('href="/manifest.json"', `href="/manifest.json?token=${encodeURIComponent(t)}"`);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(html);
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("remote page asset missing");
        }
        return;
      }

      // Installable PWA (§6 step 2): per-request manifest so the installed
      // app starts already paired (iPhone home-screen apps have their own storage).
      if (req.method === "GET" && url.pathname === "/manifest.json") {
        const t = url.searchParams.get("token");
        const manifest = {
          name: "Prism Remote",
          short_name: "Prism",
          start_url: t ? `/remote?token=${encodeURIComponent(t)}` : "/remote",
          scope: "/",
          display: "standalone",
          background_color: "#14171C",
          theme_color: "#14171C",
          icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
        };
        res.writeHead(200, { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(manifest));
        return;
      }
      if (req.method === "GET" && url.pathname === "/icon.svg") {
        try {
          res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" });
          res.end(readFileSync(join(remoteHtmlPath, "..", "icon.svg")));
        } catch {
          res.writeHead(404);
          res.end();
        }
        return;
      }

      // §14 HTTP audio stream: ticket-only auth (never the pairing token in a
      // URL). Redeem the ticket, then serve bytes — which this daemon does not
      // produce yet (PipeWire capture lands with the PrismOS audio work).
      if (req.method === "GET" && url.pathname === "/audio/stream") {
        const listener = remote.redeemStreamTicket(url.searchParams.get("ticket"));
        if (!listener) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid or expired stream ticket" }));
          return;
        }
        if (!capture?.capturing) {
          res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ error: "capture is not running" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "audio/aac", "Cache-Control": "no-store", Connection: "close" });
        const sub = { listener, out: res };
        capture.subscribe(sub);
        console.log(`[prism-daemon] stream listener joined (${capture.count()} total)`);
        // A close we did not initiate is the phone going away: report it so
        // core holds the speakers (grace); an explicit leave ends the stream
        // from our side and is not a loss.
        req.on("close", () => {
          if (capture.count() > 0 && capture.unsubscribeIfPresent(sub)) capture.onLost?.(listener);
          console.log(`[prism-daemon] stream listener left (${capture.count()} total)`);
        });
        return;
      }

      // Local imagery packs — no auth (no secrets, LAN only), no traversal.
      if (req.method === "GET" && packsDir && url.pathname.startsWith("/packs/")) {
        const rel = normalize(decodeURIComponent(url.pathname.slice("/packs/".length)));
        const file = join(packsDir, rel);
        const type = IMAGE_TYPES[extname(file).toLowerCase()];
        if (rel.startsWith("..") || !type || !file.startsWith(packsDir) || !existsSync(file) || !statSync(file).isFile()) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("no such image");
          return;
        }
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "max-age=86400" });
        res.end(readFileSync(file));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length ? Buffer.concat(chunks).toString("utf8") : null;
      const auth = req.headers.authorization;
      const token = auth?.toLowerCase().startsWith("bearer ")
        ? auth.slice(7).trim()
        : url.searchParams.get("token");

      const out = await remote.handle({
        method: req.method ?? "GET",
        path: url.pathname,
        body,
        token,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 200) : null,
      });
      res.writeHead(out.status, {
        "Content-Type": out.contentType,
        "Cache-Control": "no-store",
      });
      res.end(out.body);
    })().catch((e) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    });
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    // A taken port is a configuration problem, not a crash: say so and stop
    // cleanly so the browser pool is torn down.
    if (e.code === "EADDRINUSE") console.error(`[prism-daemon] port ${port} is already in use (another daemon running?) — pass --port`);
    else console.error(`[prism-daemon] remote API listener failed: ${String(e)}`);
    process.emit("SIGTERM");
  });
  server.listen(port);
  return server;
}
