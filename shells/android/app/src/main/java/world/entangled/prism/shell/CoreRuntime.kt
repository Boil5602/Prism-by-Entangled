package world.entangled.prism.shell

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * Hosts prism-core in a hidden WebView (the embedded JS runtime of §23).
 * Kotlin decides nothing: every command comes out of core as JSON via the
 * PrismBridge host object, and every event goes back in through
 * PrismRuntime.* calls. See packages/core/src/runtime.ts for the protocol.
 */
class CoreRuntime(
    context: Context,
    private val store: PrismStore,
    private val onCommand: (JSONObject) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var ready = false
    private val queued = mutableListOf<String>()

    @SuppressLint("SetJavaScriptEnabled")
    val webView: WebView = WebView(context).apply {
        settings.javaScriptEnabled = true
        addJavascriptInterface(BridgeHost(), "PrismBridge")
    }

    private inner class BridgeHost {
        /** Fire-and-forget driver command; executed in-order on the main thread. */
        @JavascriptInterface
        fun dispatch(json: String) {
            val cmd = JSONObject(json)
            main.post { onCommand(cmd) }
        }

        /** Synchronous store read (JS-bridge thread; SharedPreferences is thread-safe). */
        @JavascriptInterface
        fun storeGet(key: String): String? = store.get(key)
    }

    /** Load the core bundle, then initialize with the dashboard document. */
    fun start(runtimeJs: String, docJson: String, widthPx: Int, heightPx: Int, optionsJson: String) {
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript(runtimeJs, null)
                view.evaluateJavascript(
                    "PrismRuntime.init(${JSONObject.quote(docJson)}, $widthPx, $heightPx, " +
                        "${JSONObject.quote(optionsJson)})",
                    null,
                )
                // Flush calls made before the bundle was installed.
                ready = true
                queued.forEach { view.evaluateJavascript(it, null) }
                queued.clear()
            }
        }
        webView.loadDataWithBaseURL(
            "https://core.prism.invalid/",
            "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>",
            "text/html", "utf-8", null,
        )
    }

    fun resize(widthPx: Int, heightPx: Int) {
        call("PrismRuntime.resize($widthPx, $heightPx)")
    }

    /** Surface event (load-finished / first-paint / playback) into core. */
    fun event(json: JSONObject) {
        call("PrismRuntime.event(${JSONObject.quote(json.toString())})")
    }

    /** Raw input event ({"key": "..."}) into core (§7). */
    fun input(json: JSONObject) {
        call("PrismRuntime.input(${JSONObject.quote(json.toString())})")
    }

    /** Remote API request into core (§6); response returns via the bridge. */
    fun http(requestId: Int, requestJson: String) {
        call("PrismRuntime.http($requestId, ${JSONObject.quote(requestJson)})")
    }

    /** Mint a pairing token (§6); the QR payload returns via the bridge. */
    fun switchTo(dashboardId: String) {
        call("PrismRuntime.switchTo(${JSONObject.quote(dashboardId)})")
    }

    fun mintPairing(baseUrl: String, onlyIfUnpaired: Boolean = false) {
        call("PrismRuntime.mintPairing(${JSONObject.quote(baseUrl)}, $onlyIfUnpaired)")
    }

    /**
     * Answer a request-lane op (veil imagery, update manifest/apply…).
     * `resultJson` is a JSON value; pass an error string to reject instead.
     */
    fun resolve(requestId: Int, resultJson: String?, error: String? = null) {
        val result = if (resultJson == null) "null" else JSONObject.quote(resultJson)
        val err = if (error == null) "null" else JSONObject.quote(error)
        call("PrismRuntime.resolve($requestId, $result, $err)")
    }

    /**
     * §14 stream auth: redeem a ticket synchronously from the HTTP thread
     * (bounded wait; the JS call itself is a Map lookup). Returns the
     * listener id or null.
     */
    fun redeemStreamTicket(ticket: String): String? {
        val latch = java.util.concurrent.CountDownLatch(1)
        var result: String? = null
        main.post {
            if (!ready) { latch.countDown(); return@post }
            webView.evaluateJavascript("PrismRuntime.redeemStreamTicket(${JSONObject.quote(ticket)})") { v ->
                // evaluateJavascript returns a JSON-encoded string ("\"abc\"" or "\"\"").
                val s = v?.trim('"') ?: ""
                result = if (s.isEmpty() || s == "null") null else s
                latch.countDown()
            }
        }
        latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        return result
    }

    /** Edit-mode menu: current state JSON, delivered on the main thread (never blocks it). */
    fun state(cb: (JSONObject?) -> Unit) {
        main.post {
            if (!ready) { cb(null); return@post }
            webView.evaluateJavascript("PrismRuntime.state()") { v ->
                var result: JSONObject? = null
                try {
                    // evaluateJavascript returns a JSON-encoded string; unwrap it.
                    val s = if (v != null && v.startsWith("\"")) org.json.JSONTokener(v).nextValue().toString() else v
                    if (s != null && s != "null") result = JSONObject(s)
                } catch (_: Exception) {}
                cb(result)
            }
        }
    }

    fun setTileMode(tileId: String, mode: String) {
        call("PrismRuntime.setTileMode(${JSONObject.quote(tileId)}, ${JSONObject.quote(mode)})")
    }

    private fun call(expr: String) {
        main.post {
            if (ready) webView.evaluateJavascript(expr, null)
            else queued.add(expr)
        }
    }
}
