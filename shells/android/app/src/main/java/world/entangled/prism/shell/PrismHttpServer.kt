package world.entangled.prism.shell

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Device-local HTTP listener for the remote API (§6). Deliberately dumb:
 * static assets (the remote page) are served directly; every API path is
 * forwarded into core as JSON and core's response is written back verbatim.
 * Routing, auth, and command semantics all live in prism-core (§23).
 */
class PrismHttpServer(
    private val port: Int,
    private val context: Context,
    /** Forwards {requestId, method, path, body, token} into core. */
    private val forward: (requestId: Int, requestJson: String) -> Unit,
    /** §14: redeem a stream ticket via core → listener id, or null. */
    private val redeemStreamTicket: (ticket: String) -> String? = { null },
) {
    private val running = AtomicBoolean(false)
    private val requestIds = AtomicInteger(1)
    private val pending = ConcurrentHashMap<Int, CompletableFuture<JSONObject>>()
    private var socket: ServerSocket? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        Thread({
            try {
                val server = ServerSocket(port)
                socket = server
                Log.i(TAG, "remote API listening on :$port")
                while (running.get()) {
                    val client = server.accept()
                    Thread({ handle(client) }, "prism-http-conn").start()
                }
            } catch (e: Exception) {
                if (running.get()) Log.e(TAG, "server died", e)
            }
        }, "prism-http-accept").start()
    }

    fun stop() {
        running.set(false)
        try { socket?.close() } catch (_: Exception) {}
    }

    /** Called from the command stream when core answers an http request. */
    fun complete(cmd: JSONObject) {
        pending.remove(cmd.getInt("requestId"))?.complete(cmd)
    }

    private fun handle(client: Socket) {
        client.use { c ->
            c.soTimeout = 10_000
            val reader = BufferedReader(InputStreamReader(c.getInputStream()))
            val out = c.getOutputStream()
            try {
                val requestLine = reader.readLine() ?: return
                val parts = requestLine.split(" ")
                if (parts.size < 2) return
                val method = parts[0]
                val (path, query) = splitQuery(parts[1])

                var contentLength = 0
                var bearer: String? = null
                var userAgent: String? = null
                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) break
                    val lower = line.lowercase()
                    if (lower.startsWith("content-length:")) {
                        contentLength = line.substringAfter(":").trim().toIntOrNull() ?: 0
                    } else if (lower.startsWith("authorization: bearer ")) {
                        bearer = line.substring("authorization: bearer ".length).trim()
                    } else if (lower.startsWith("user-agent:")) {
                        userAgent = line.substringAfter(":").trim().take(200)
                    }
                }
                val body = if (contentLength > 0) {
                    val buf = CharArray(contentLength)
                    var read = 0
                    while (read < contentLength) {
                        val n = reader.read(buf, read, contentLength - read)
                        if (n < 0) break
                        read += n
                    }
                    String(buf, 0, read)
                } else null

                // CORS: the remote PWA installed from one frame controls the others
                // (multi-frame picker). Safe because auth is a bearer header, never a
                // cookie — a random site cannot replay it without the token.
                if (method == "OPTIONS") {
                    out.write(
                        ("HTTP/1.1 204 No Content\r\n" + CORS +
                            "Access-Control-Max-Age: 86400\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").toByteArray(),
                    )
                    out.flush()
                    return
                }

                if (method == "GET" && (path == "/" || path == "/remote")) {
                    // Bake this phone's token into the manifest link server-side: iOS
                    // reads the manifest before page scripts run, and the installed
                    // app's start_url comes from it (must arrive already paired).
                    val t = query["token"]
                    val html = try { context.assets.open("remote.html").bufferedReader().use { it.readText() } } catch (_: Exception) { null }
                        ?: return writeResponse(out, 404, "text/plain", "asset missing".toByteArray())
                    val page = if (t != null) html.replace("href=\"/manifest.json\"", "href=\"/manifest.json?token=" + java.net.URLEncoder.encode(t, "UTF-8") + "\"") else html
                    return writeResponse(out, 200, "text/html; charset=utf-8", page.toByteArray())
                }
                // Installable PWA (§6 step 2). The manifest is generated per request so
                // the installed app's start URL carries this phone's pairing token —
                // on iPhone a home-screen app has its own storage, so it must arrive
                // already paired. The token is LAN-only and per phone; the QR already
                // shows it.
                if (method == "GET" && path == "/manifest.json") {
                    val t = query["token"]
                    val start = if (t != null) "/remote?token=" + java.net.URLEncoder.encode(t, "UTF-8") else "/remote"
                    val manifest = JSONObject()
                        .put("name", "Prism Remote")
                        .put("short_name", "Prism")
                        .put("start_url", start)
                        .put("scope", "/")
                        .put("display", "standalone")
                        .put("background_color", "#14171C")
                        .put("theme_color", "#14171C")
                        .put("icons", org.json.JSONArray().put(
                            JSONObject().put("src", "/icon.svg").put("sizes", "any").put("type", "image/svg+xml").put("purpose", "any maskable"),
                        ))
                    return writeResponse(out, 200, "application/manifest+json", manifest.toString().toByteArray())
                }
                if (method == "GET" && path == "/icon.svg") return serveAsset(out, "icon.svg", "image/svg+xml")

                // §14 HTTP audio stream: ticket-only auth (never a pairing token in
                // a URL). Chunked AAC/ADTS fed from the single capture mix; the
                // socket stays open until the phone leaves or the stream ends.
                if (method == "GET" && path == "/audio/stream") {
                    val listener = query["ticket"]?.let(redeemStreamTicket)
                    if (listener == null) {
                        return writeResponse(out, 401, "application/json", """{"error":"invalid or expired stream ticket"}""".toByteArray())
                    }
                    if (!AudioHub.capturing) {
                        return writeResponse(out, 503, "application/json", """{"error":"capture is not running"}""".toByteArray())
                    }
                    c.soTimeout = 0
                    out.write(
                        ("HTTP/1.1 200 OK\r\n" + CORS +
                            "Content-Type: audio/aac\r\n" +
                            "Cache-Control: no-store\r\n" +
                            "Transfer-Encoding: identity\r\n" +
                            "Connection: close\r\n\r\n").toByteArray(),
                    )
                    out.flush()
                    val sub = AudioHub.Subscriber(listener, out)
                    AudioHub.subscribe(sub)
                    Log.i(TAG, "stream listener joined (${AudioHub.count()} total)")
                    // Block until the socket dies; broadcast() drops us on write failure.
                    try {
                        while (AudioHub.capturing && !c.isClosed) {
                            if (reader.read() < 0) break // client hung up (EOF)
                        }
                    } catch (_: Exception) {}
                    AudioHub.unsubscribe(sub)
                    Log.i(TAG, "stream listener left (${AudioHub.count()} total)")
                    return
                }

                val token = bearer ?: query["token"]
                val id = requestIds.getAndIncrement()
                val future = CompletableFuture<JSONObject>()
                pending[id] = future
                forward(
                    id,
                    JSONObject()
                        .put("method", method)
                        .put("path", path)
                        .put("body", body ?: JSONObject.NULL)
                        .put("token", token ?: JSONObject.NULL)
                        .put("userAgent", userAgent ?: JSONObject.NULL)
                        .toString(),
                )
                val res = try {
                    // Some core actions legitimately wait on a page (typing waits for
                    // the field to appear, up to ~12s) — give them room.
                    future.get(30, TimeUnit.SECONDS)
                } catch (_: Exception) {
                    pending.remove(id)
                    null
                }
                if (res == null) {
                    writeResponse(out, 504, "application/json", """{"error":"core did not respond"}""".toByteArray())
                } else {
                    writeResponse(
                        out,
                        res.getInt("status"),
                        res.optString("contentType", "application/json"),
                        res.getString("body").toByteArray(),
                    )
                }
            } catch (e: Exception) {
                Log.w(TAG, "request failed: $e")
            }
        }
    }

    private fun serveAsset(out: OutputStream, name: String, contentType: String) {
        val bytes = try {
            context.assets.open(name).use { it.readBytes() }
        } catch (_: Exception) {
            return writeResponse(out, 404, "text/plain", "asset missing".toByteArray())
        }
        writeResponse(out, 200, contentType, bytes)
    }

    private fun writeResponse(out: OutputStream, status: Int, contentType: String, body: ByteArray) {
        val reason = if (status in 200..299) "OK" else "X"
        out.write(
            ("HTTP/1.1 $status $reason\r\n" + CORS +
                "Content-Type: $contentType\r\n" +
                "Content-Length: ${body.size}\r\n" +
                "Cache-Control: no-store\r\n" +
                "Connection: close\r\n\r\n").toByteArray(),
        )
        out.write(body)
        out.flush()
    }

    private fun splitQuery(target: String): Pair<String, Map<String, String>> {
        val q = target.indexOf('?')
        if (q < 0) return target to emptyMap()
        val path = target.substring(0, q)
        val params = target.substring(q + 1).split("&").mapNotNull { kv ->
            val eq = kv.indexOf('=')
            if (eq < 0) null
            else URLDecoder.decode(kv.substring(0, eq), "UTF-8") to
                URLDecoder.decode(kv.substring(eq + 1), "UTF-8")
        }.toMap()
        return path to params
    }

    companion object {
        private const val TAG = "PrismRemote"
        /** Bearer-only API; no credentials/cookies, so a wildcard origin is safe (§6 multi-frame remote). */
        const val CORS = "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Authorization, Content-Type\r\n"
    }
}
