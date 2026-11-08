package world.entangled.prism.shell

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * Surface driver (§23): executes core's surface.* commands. Each tile is a
 * container holding a WebView plus a snapshot ImageView used by the §16
 * freeze/reveal machinery and the §18 warm state (renderer released, frozen
 * pixels shown). No layout, audio, or lifecycle decisions are made here.
 *
 * §16 contract: surfaces are created HIDDEN (alpha 0 over the dark
 * substrate) and become visible only when core calls surface.reveal.
 */
class SurfaceManager(
    private val container: FrameLayout,
    private val store: PrismStore,
    /** §5 network blocking; null = shell built without lists (nothing blocked). */
    private val blockList: BlockList? = null,
) {
    /** Wired after construction (CoreRuntime needs SurfaceManager and vice versa). */
    var events: ((JSONObject) -> Unit)? = null
    /** Is any tile's page holding the remote right now? Synchronous — key routing must not wait on core. */
    fun anyEntered(): Boolean = tiles.values.any { it.entered }
    /** Is any frame raised (solo / full screen)? */
    fun anyRaised(): Boolean = tiles.values.any { (it.frame.z) > 0f }
    /** A tile raised above the others (§2 fullscreen takeover) — the shell's chrome adapts its hint. */
    var onTakeover: ((Boolean) -> Unit)? = null

    /** §26/§27 local imagery + remote page served from app assets, never the web. */
    private val assetLoader = androidx.webkit.WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", androidx.webkit.WebViewAssetLoader.AssetsPathHandler(container.context))
        .build()

    private class Tile(
        val frame: FrameLayout,
        var web: WebView?,
        val snap: ImageView,
        val profile: String,
        val background: Int,
        /** §5 per-tile blocking as resolved by core (§27 veil-only ⇒ false). */
        val blocking: Boolean,
        /** §2 viewport: "desktop" sends a desktop UA + wide viewport (streaming web players need it). */
        val viewport: String = "auto",
        /** Desktop identity claimed in UA + client hints: "windows" (default) or "mac". */
        val uaPlatform: String = "windows",
    ) {
        /** Older WebViews without document-start scripts: apply the viewport rewrite on load instead. */
        var viewportFixOnLoad = false
        var focused = false
        var entered = false
        /** A player's fullscreen custom view (onShowCustomView), while shown. */
        var custom: View? = null
        var customCallback: android.webkit.WebChromeClient.CustomViewCallback? = null
        var lastInteractionMs = 0L
        var veil: View? = null
        var poster: View? = null
        /** §26 pass-through: the real Skip chip on the scenery; a tap is a human action. */
        var skipChip: View? = null
    }

    /**
     * §18 recency: sees every touch before children (works for warm tiles,
     * whose WebView is gone) and never consumes — pages behave normally.
     */
    private class TileFrame(
        context: android.content.Context,
        private val onDown: () -> Unit,
    ) : FrameLayout(context) {
        override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
            if (ev.actionMasked == MotionEvent.ACTION_DOWN) onDown()
            return super.dispatchTouchEvent(ev)
        }
    }

    private val tiles = mutableMapOf<String, Tile>()

    /** Entry point for every command core emits through the bridge. */
    fun execute(cmd: JSONObject) {
        when (val op = cmd.getString("op")) {
            "surface.create" -> create(cmd)
            "surface.destroy" -> destroy(cmd.getString("id"))
            "surface.setRect" -> setRect(cmd.getString("id"), cmd.getJSONObject("rect"))
            "surface.setOpacity" -> tiles[cmd.getString("id")]?.frame?.alpha = cmd.getDouble("opacity").toFloat()
            // Solo layout: off-screen tiles neither draw nor tick, but keep renderer + session.
            "surface.setVisible" -> tiles[cmd.getString("id")]?.let { t ->
                val on = cmd.getBoolean("visible")
                if (on) { t.web?.onResume(); t.frame.visibility = View.VISIBLE } else { t.frame.visibility = View.GONE; t.web?.onPause() }
            }
            "surface.setZ" -> {
                tiles[cmd.getString("id")]?.let { t -> t.frame.z = cmd.getDouble("z").toFloat(); applyRing(t) }
                onTakeover?.invoke(tiles.values.any { (it.frame?.z ?: 0f) > 0f })
            }
            "surface.navigate" -> tiles[cmd.getString("id")]?.web?.loadUrl(cmd.getString("url"))
            "surface.inject" -> inject(cmd)
            "surface.freeze" -> freeze(cmd.getString("id"))
            "surface.reveal" -> reveal(cmd.getString("id"), cmd.getLong("durationMs"))
            "surface.suspend" -> suspend(cmd.getString("id"))
            "surface.resume" -> resume(cmd.getString("id"))
            "surface.showIntermission" -> showIntermission(cmd.getString("id"), cmd.getString("source"))
            "surface.hideIntermission" -> hideIntermission(cmd.getString("id"))
            "surface.setIntermissionSkip" -> setIntermissionSkip(cmd.getString("id"), cmd.getBoolean("available"))
            "surface.setMuted" -> setMuted(cmd.getString("id"), cmd.getBoolean("muted"))
            "surface.setFocused" -> setFocused(cmd.getString("id"), cmd.getBoolean("focused"))
            "surface.setPageInput" -> setPageInput(cmd.getString("id"), cmd.getBoolean("active"))
            "surface.sendKey" -> sendKey(cmd.getString("id"), cmd.getString("key"))
            "surface.typeText" -> typeText(cmd.getString("id"), cmd.getString("text"))
            "store.set" -> store.set(cmd.getString("key"), cmd.getString("value"))
            "runtime.error" -> Log.e(TAG, "core error: ${cmd.optString("message")}")
            else -> Log.w(TAG, "unknown op from core: $op")
        }
    }

    private fun create(cmd: JSONObject) {
        val id = cmd.getString("id")
        if (tiles.containsKey(id)) return
        val profile = cmd.getString("profile")
        val background = parseColor(cmd.getString("background"))

        val snap = ImageView(container.context).apply {
            scaleType = ImageView.ScaleType.FIT_XY
            visibility = View.GONE
        }
        lateinit var tile: Tile
        val frame = TileFrame(container.context) {
            val now = System.currentTimeMillis()
            if (now - tile.lastInteractionMs > INTERACTION_THROTTLE_MS) {
                tile.lastInteractionMs = now
                events?.invoke(JSONObject().put("type", "interaction").put("id", id))
            }
        }.apply {
            setBackgroundColor(background)
            addView(snap, FrameLayout.LayoutParams(MATCH, MATCH))
        }
        tile = Tile(frame, null, snap, profile, background, cmd.optBoolean("blocking", true), cmd.optString("viewport", "auto"), cmd.optString("uaPlatform", "windows"))
        tiles[id] = tile

        val launchPkg = cmd.optString("launch", "")
        if (launchPkg.isNotEmpty()) {
            attachPoster(tile, launchPkg) // §12: poster, not a web view
        } else {
            attachWebView(id, tile)
        }

        // Attached zero-sized until core assigns a rect — nothing flashes.
        container.addView(frame, FrameLayout.LayoutParams(0, 0))
    }

    /** §12 launch tile: app icon + label resolved locally; taps route via core. */
    private fun attachPoster(tile: Tile, pkg: String) {
        val pm = container.context.packageManager
        val column = android.widget.LinearLayout(container.context).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            alpha = 0f
            background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TL_BR,
                intArrayOf(0xFF1E232B.toInt(), 0xFF0A0C0F.toInt()),
            )
            try {
                val info = pm.getApplicationInfo(pkg, 0)
                addView(
                    ImageView(context).apply { setImageDrawable(pm.getApplicationIcon(info)) },
                    android.widget.LinearLayout.LayoutParams(160, 160),
                )
                addView(android.widget.TextView(context).apply {
                    text = pm.getApplicationLabel(info)
                    setTextColor(0xFFD7DCE3.toInt())
                    textSize = 16f
                    setPadding(0, 20, 0, 0)
                })
            } catch (_: Exception) {
                addView(android.widget.TextView(context).apply {
                    text = pkg
                    setTextColor(0xFF8A93A0.toInt())
                    textSize = 14f
                })
            }
        }
        tile.poster = column
        tile.frame.addView(column, FrameLayout.LayoutParams(MATCH, MATCH))
    }

    /** Build the renderer for a tile — used at create and §18 resume. */
    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun attachWebView(id: String, tile: Tile) {
        if (tile.web != null) return
        val web = WebView(container.context)

        // §10: isolated per-tile storage profiles where the WebView supports
        // them. Same profile string across tiles = deliberately shared session.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            ProfileStore.getInstance().getOrCreateProfile("prism-${tile.profile}")
            WebViewCompat.setProfile(web, "prism-${tile.profile}")
        } else {
            Log.w(TAG, "WebView multi-profile unsupported; tile '$id' shares the default profile")
        }

        web.apply {
            // §16: dark substrate; the surface itself starts invisible and is
            // revealed by core only at readiness.
            setBackgroundColor(tile.background)
            alpha = 0f
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            if (tile.viewport == "desktop" || tile.viewport == "wide") {
                // §2 desktop viewport: a desktop Chrome UA (streaming web players refuse
                // mobile/WebView UAs) and a wide layout viewport. "wide" keeps the honest
                // Android UA (services that fingerprint the transport — Paramount+ 403s a
                // Windows claim from this WebView) and takes only the wide layout.
                if (tile.viewport == "desktop") settings.userAgentString = settings.userAgentString
                    // Windows, not Linux: some services (Paramount+) answer 403 to a Linux desktop UA.
                    .replace(Regex("\\(Linux; Android [^)]*\\)"), if (tile.uaPlatform == "mac") "(Macintosh; Intel Mac OS X 10_15_7)" else "(Windows NT 10.0; Win64; x64)")
                    .replace(Regex("; wv\\)"), ")")
                    .replace(Regex(" Mobile Safari"), " Safari")
                    .replace(Regex("Version/[0-9.]+ "), "")
                settings.useWideViewPort = true
                settings.loadWithOverviewMode = true
                // Client hints must agree with the UA string: the WebView otherwise
                // advertises brand "Android WebView" / platform "Android" next to a
                // Windows Chrome UA, and bot filters (Paramount+: Varnish 403) reject
                // the contradiction. Same identity in both channels.
                if (tile.viewport == "desktop" && WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) {
                    val major = Regex("Chrome/(\\d+)").find(settings.userAgentString)?.groupValues?.get(1) ?: "120"
                    val brands = listOf(
                        androidx.webkit.UserAgentMetadata.BrandVersion.Builder().setBrand("Chromium").setMajorVersion(major).setFullVersion("$major.0.0.0").build(),
                        androidx.webkit.UserAgentMetadata.BrandVersion.Builder().setBrand("Google Chrome").setMajorVersion(major).setFullVersion("$major.0.0.0").build(),
                        androidx.webkit.UserAgentMetadata.BrandVersion.Builder().setBrand("Not_A Brand").setMajorVersion("24").setFullVersion("24.0.0.0").build(),
                    )
                    val meta = androidx.webkit.UserAgentMetadata.Builder()
                        .setBrandVersionList(brands)
                        .setFullVersion("$major.0.0.0")
                        .setPlatform(if (tile.uaPlatform == "mac") "macOS" else "Windows")
                        .setPlatformVersion(if (tile.uaPlatform == "mac") "14.5.0" else "10.0.0")
                        .setArchitecture("x86")
                        .setBitness(64)
                        .setMobile(false)
                        .setModel("")
                        .build()
                    androidx.webkit.WebSettingsCompat.setUserAgentMetadata(settings, meta)
                }
                // 1 CSS px per physical px: a full-screen tile lays out at the panel's real
                // width (1920 on a 1080p override) instead of width / density — the
                // difference between a desktop page and a phone page blown up 2x.
                // Sites pin `width=device-width, maximum-scale=1` in their viewport meta,
                // which overrides any initial scale, so the meta itself is rewritten
                // (at document start where supported, else on load) — Chromium re-lays
                // out on a viewport meta change.
                val density = container.resources.displayMetrics.density
                setInitialScale((100f / density).toInt().coerceAtLeast(25))
                if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    WebViewCompat.addDocumentStartJavaScript(this, DESKTOP_VIEWPORT_JS, setOf("*"))
                } else {
                    tile.viewportFixOnLoad = true
                }
            }
            addJavascriptInterface(TileHost(id), "PrismTile")
            webChromeClient = object : android.webkit.WebChromeClient() {
                /**
                 * DRM: a streaming player asks for the Widevine key system through
                 * EME; without a grant here the WebView denies it silently and the
                 * site shows "video unavailable". Protected media only — camera,
                 * microphone and MIDI requests are refused (§19 posture: a frame
                 * never opens a sensor to a page).
                 */
                override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                    val media = request.resources.filter { it == android.webkit.PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID }.toTypedArray()
                    if (media.isNotEmpty()) request.grant(media) else request.deny()
                }

                /** A player's own fullscreen button: its view fills this tile's frame. */
                override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                    val t = tiles[id] ?: return callback.onCustomViewHidden()
                    t.custom?.let { t.frame.removeView(it) }
                    t.custom = view
                    t.customCallback = callback
                    t.frame.addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                    view.z = 5f
                }

                override fun onHideCustomView() {
                    val t = tiles[id] ?: return
                    t.custom?.let { t.frame.removeView(it) }
                    t.custom = null
                    t.customCallback = null
                }
            }
            webViewClient = object : WebViewClient() {
                /**
                 * §5 network-level blocking + §26/§27 local imagery. Blocked
                 * requests get an empty 200 (not an error page — nothing on
                 * the wall changes); the log names the list that decided.
                 */
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: android.webkit.WebResourceRequest,
                ): android.webkit.WebResourceResponse? {
                    assetLoader.shouldInterceptRequest(request.url)?.let { return it }
                    if (!tile.blocking || request.isForMainFrame) return null
                    val src = blockList?.blockedByAny(request.url.host) ?: return null
                    Log.d(TAG, "blocked ${request.url.host} for '$id' — $src")
                    return android.webkit.WebResourceResponse(
                        "text/plain", "utf-8", 200, "OK", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)),
                    )
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: android.webkit.WebResourceRequest,
                ): Boolean {
                    val scheme = request.url.scheme?.lowercase()
                    if (scheme == "http" || scheme == "https" || scheme == "about" || scheme == "data" || scheme == "blob") return false
                    // A site's handoff to the store / its native app: not for a tile. Stay on the page.
                    Log.i(TAG, "refused ${scheme}:// navigation for '$id' (${request.url.toString().take(80)})")
                    return true
                }

                override fun onPageCommitVisible(view: WebView, url: String) {
                    events?.invoke(JSONObject().put("type", "first-paint").put("id", id))
                }

                override fun onPageFinished(view: WebView, url: String) {
                    if (url == BLANK) return // the dark stand-in after a failure, not a page
                    if (tile.viewportFixOnLoad) view.evaluateJavascript(DESKTOP_VIEWPORT_JS, null)
                    view.evaluateJavascript(MEDIA_LISTENER_JS, null)
                    events?.invoke(
                        JSONObject().put("type", "load-finished").put("id", id).put("ok", true),
                    )
                }

                /**
                 * §16 no white frames: a main-frame failure (DNS blip, offline)
                 * must never leave WebView's white error page on the wall.
                 * Swap in the dark substrate and report ok=false — core's quiet
                 * retry (refresh engine, exponential backoff) brings the page
                 * back on its own; stale pixels never turn white.
                 */
                override fun onReceivedError(
                    view: WebView,
                    request: android.webkit.WebResourceRequest,
                    error: android.webkit.WebResourceError,
                ) {
                    if (!request.isForMainFrame) return
                    Log.w(TAG, "load failed for '$id': ${error.description} (${request.url})")
                    view.loadUrl(BLANK)
                    events?.invoke(
                        JSONObject().put("type", "load-finished").put("id", id).put("ok", false),
                    )
                }

                override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                    // SPA navigations (pushState) land here — adapters re-inject (§5).
                    if (!isReload) {
                        events?.invoke(JSONObject().put("type", "navigated").put("id", id))
                    }
                }
            }
        }

        tile.web = web
        // Below the snapshot layer, so frozen pixels stay on top until reveal.
        tile.frame.addView(web, 0, FrameLayout.LayoutParams(MATCH, MATCH))
    }

    private fun destroy(id: String) {
        tiles.remove(id)?.let {
            container.removeView(it.frame)
            it.web?.destroy() // renderer only — profile storage persists (§10)
        }
    }

    /** §18 warm: release the renderer; the frozen snapshot stays on the wall. */
    private fun suspend(id: String) {
        val t = tiles[id] ?: return
        t.web?.let {
            t.frame.removeView(it)
            it.destroy()
        }
        t.web = null
        Log.d(TAG, "tile '$id' → warm (renderer released)")
    }

    /** §18 revive: rebuild the renderer hidden behind the frozen pixels. */
    private fun resume(id: String) {
        val t = tiles[id] ?: return
        attachWebView(id, t)
        Log.d(TAG, "tile '$id' → live (renderer rebuilt)")
    }

    private fun setRect(id: String, rect: JSONObject) {
        val t = tiles[id] ?: return
        val w = rect.getDouble("w").roundToInt()
        val h = rect.getDouble("h").roundToInt()
        val resized = t.frame.width > 0 && (t.frame.width != w || t.frame.height != h)
        // §16 no white frames: Chromium paints white where it has not yet
        // rasterized at the new size. Hold the last pixels (stretched) over
        // the surface and crossfade back once it has had a few frames.
        if (resized && t.web != null && t.web?.alpha == 1f) {
            freeze(id)
            t.frame.postDelayed({ if (tiles[id] === t) reveal(id, 180) }, 700)
        }
        val lp = FrameLayout.LayoutParams(w, h)
        lp.leftMargin = rect.getDouble("x").roundToInt()
        lp.topMargin = rect.getDouble("y").roundToInt()
        t.frame.layoutParams = lp
    }

    /** §16: capture the tile's current pixels and hold them over the surface. */
    private fun freeze(id: String) {
        val t = tiles[id] ?: return
        val web = t.web ?: return
        val w = web.width
        val h = web.height
        if (w <= 0 || h <= 0) return // never laid out — nothing to hold
        // NOTE: do not gate on web.alpha — core may freeze mid-crossfade
        // (reveal issued, animation not yet ticked). Content exists whenever
        // core decided to freeze; view alpha is irrelevant to draw().
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        web.draw(Canvas(bitmap))
        // Cancel a still-running reveal fade so its end-action (hide +
        // release) can't clobber the pixels we're about to hold. Canceled
        // ViewPropertyAnimators skip their end actions.
        t.snap.animate().cancel()
        t.snap.setImageBitmap(bitmap)
        t.snap.alpha = 1f
        t.snap.visibility = View.VISIBLE
    }

    /**
     * §26 intermission: full-bleed imagery crossfaded over the tile. v0
     * imagery is a generated gradient per pack (bundled packs land with the
     * imagery pipeline); a subtle glyph says content will return.
     */
    private fun showIntermission(id: String, source: String) {
        val t = tiles[id] ?: return
        if (t.veil != null) return
        val colors = when {
            source.contains("nature") -> intArrayOf(0xFF12241A.toInt(), 0xFF060D08.toInt())
            source.contains("cosmos") -> intArrayOf(0xFF141B33.toInt(), 0xFF05070F.toInt())
            else -> intArrayOf(0xFF14171C.toInt(), 0xFF0A0C0F.toInt())
        }
        val veil = FrameLayout(container.context).apply {
            background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TL_BR, colors,
            )
            addView(
                android.widget.TextView(container.context).apply {
                    text = "◐ intermission"
                    setTextColor(0x66D7DCE3)
                    textSize = 13f
                },
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    android.view.Gravity.BOTTOM or android.view.Gravity.END,
                ).apply { setMargins(0, 0, 24, 18) },
            )
            alpha = 0f
        }
        t.veil = veil
        t.frame.addView(veil, FrameLayout.LayoutParams(MATCH, MATCH))
        veil.animate().alpha(1f).setDuration(400).start()
    }

    /**
     * §26 pass-through skip: a REAL "Skip ✓" chip on the scenery while the
     * player's own skip control exists. Tapping it reports `intermission-skip`
     * and core forwards that genuine tap to the control. The shell never taps
     * it, times it, or synthesizes anything — synthetic interaction is
     * prohibited (§26).
     */
    private fun setIntermissionSkip(id: String, available: Boolean) {
        val t = tiles[id] ?: return
        val veil = t.veil as? FrameLayout
        if (!available || veil == null) {
            t.skipChip?.let { (it.parent as? FrameLayout)?.removeView(it) }
            t.skipChip = null
            return
        }
        if (t.skipChip?.parent === veil) return // already on this scenery
        val chip = android.widget.TextView(container.context).apply {
            text = "Skip  ✓"
            setTextColor(0xFF0A0C0F.toInt())
            textSize = 16f
            setPadding(36, 18, 36, 18)
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 40f
                setColor(0xFFF0A83C.toInt())
            }
            isClickable = true
            isFocusable = true
            setOnClickListener {
                events?.invoke(JSONObject().put("type", "intermission-skip").put("id", id))
            }
        }
        t.skipChip = chip
        veil.addView(
            chip,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                android.view.Gravity.BOTTOM or android.view.Gravity.START,
            ).apply { setMargins(28, 0, 0, 22) },
        )
    }

    /** §26 uncover fast: quick fade, audio already restored by core. */
    private fun hideIntermission(id: String) {
        val t = tiles[id] ?: return
        val veil = t.veil ?: return
        t.veil = null
        veil.animate().alpha(0f).setDuration(150).withEndAction {
            t.frame.removeView(veil)
        }.start()
    }

    /** §16: crossfade to the live surface — from frozen pixels or from hidden. */
    private fun reveal(id: String, durationMs: Long) {
        val t = tiles[id] ?: return
        t.web?.let { web ->
            if (web.alpha < 1f) web.animate().alpha(1f).setDuration(durationMs).start()
        }
        t.poster?.let { poster ->
            if (poster.alpha < 1f) poster.animate().alpha(1f).setDuration(durationMs).start()
        }
        if (t.snap.visibility == View.VISIBLE) {
            t.snap.animate().alpha(0f).setDuration(durationMs).withEndAction {
                t.snap.visibility = View.GONE
                t.snap.setImageDrawable(null) // release the bitmap
            }.start()
        }
    }

    private fun inject(cmd: JSONObject) {
        val web = tiles[cmd.getString("id")]?.web ?: return
        if (!cmd.isNull("css")) {
            val css = JSONObject.quote(cmd.getString("css"))
            web.evaluateJavascript(
                "(function(){var s=document.createElement('style');s.textContent=$css;document.head.appendChild(s)})()",
                null,
            )
        }
        if (!cmd.isNull("js")) web.evaluateJavascript(cmd.getString("js"), null)
    }

    /**
     * §7 page input mode: the tile's WebView takes keyboard focus so forwarded
     * keys land in the page; a brighter ring says "you're inside". Leaving
     * clears focus so the wall owns the d-pad again.
     */
    private fun setPageInput(id: String, active: Boolean) {
        val t = tiles[id] ?: return
        val web = t.web
        if (active && web != null) {
            web.isFocusable = true
            web.isFocusableInTouchMode = true
            web.requestFocus()
            t.entered = true
        } else {
            web?.clearFocus()
            container.requestFocus()
            t.entered = false
        }
        applyRing(t)
    }

    /** Evaluate in the tile's page and hand the JSON-encoded result back (core's read-only checks). */
    /** Page history back for a HUMAN's Back press; false when the page has none. */
    fun goBack(id: String): Boolean {
        val web = tiles[id]?.web ?: return false
        if (!web.canGoBack()) return false
        web.goBack()
        return true
    }

    fun evaluate(id: String, js: String, cb: (String?) -> Unit) {
        val web = tiles[id]?.web ?: return cb(null)
        web.evaluateJavascript(js) { v -> cb(v) }
    }

    /** Forward a HUMAN key press as a real platform key event into the tile's WebView. */
    private fun sendKey(id: String, key: String) {
        val web = tiles[id]?.web ?: return
        val code = when (key) {
            "DPAD_UP" -> android.view.KeyEvent.KEYCODE_DPAD_UP
            "DPAD_DOWN" -> android.view.KeyEvent.KEYCODE_DPAD_DOWN
            "DPAD_LEFT" -> android.view.KeyEvent.KEYCODE_DPAD_LEFT
            "DPAD_RIGHT" -> android.view.KeyEvent.KEYCODE_DPAD_RIGHT
            "DPAD_CENTER" -> android.view.KeyEvent.KEYCODE_DPAD_CENTER
            "ENTER" -> android.view.KeyEvent.KEYCODE_ENTER
            "BACK" -> android.view.KeyEvent.KEYCODE_BACK
            "TAB" -> android.view.KeyEvent.KEYCODE_TAB
            "SPACE" -> android.view.KeyEvent.KEYCODE_SPACE
            "DEL", "BACKSPACE" -> android.view.KeyEvent.KEYCODE_DEL
            "ESCAPE" -> android.view.KeyEvent.KEYCODE_ESCAPE
            "MEDIA_PLAY_PAUSE" -> android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            "PAGE_UP" -> android.view.KeyEvent.KEYCODE_PAGE_UP
            "PAGE_DOWN" -> android.view.KeyEvent.KEYCODE_PAGE_DOWN
            else -> {
                val name = "KEYCODE_" + key.uppercase()
                android.view.KeyEvent.keyCodeFromString(name).takeIf { it != android.view.KeyEvent.KEYCODE_UNKNOWN } ?: return
            }
        }
        if (!web.hasFocus()) web.requestFocus()
        val now = android.os.SystemClock.uptimeMillis()
        web.dispatchKeyEvent(android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_DOWN, code, 0))
        web.dispatchKeyEvent(android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_UP, code, 0))
    }

    /** Forward HUMAN-typed text as real key events (character map), so any page input accepts it. */
    private fun typeText(id: String, text: String) {
        val web = tiles[id]?.web ?: return
        if (!web.hasFocus()) web.requestFocus()
        val kcm = android.view.KeyCharacterMap.load(android.view.KeyCharacterMap.VIRTUAL_KEYBOARD)
        val events = kcm.getEvents(text.toCharArray())
        if (events != null) {
            for (e in events) web.dispatchKeyEvent(e)
        } else {
            // Characters without key events (emoji etc.): commit via the input connection.
            web.evaluateJavascript(
                "(function(t){var e=document.activeElement;if(!e)return;" +
                    "if('value' in e){e.value+=t;e.dispatchEvent(new Event('input',{bubbles:true}));}})(" +
                    JSONObject.quote(text) + ")",
                null,
            )
        }
    }

    /** §12 TV d-pad: an accent ring on the focused tile; select activates it (core decides what). */
    private fun setFocused(id: String, focused: Boolean) {
        val t = tiles[id] ?: return
        t.focused = focused
        applyRing(t)
    }

    /** Rings belong to the wall: a raised frame (full screen, solo) never glows; entered draws thicker. */
    private fun applyRing(t: Tile) {
        t.frame.foreground = if ((t.focused || t.entered) && t.frame.z <= 0f) {
            android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.TRANSPARENT)
                setStroke(if (t.entered) 10 else 6, 0xFFF0A83C.toInt())
                cornerRadius = 14f
            }
        } else null
    }

    private fun setMuted(id: String, muted: Boolean) {
        val web = tiles[id]?.web ?: return
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MUTE_AUDIO)) {
            WebViewCompat.setAudioMuted(web, muted)
        } else {
            web.evaluateJavascript(
                "document.querySelectorAll('video,audio').forEach(function(m){m.muted=$muted})",
                null,
            )
        }
    }

    /** Per-tile JS host: pages report media playback for the §3 audio machine. */
    private inner class TileHost(private val id: String) {
        @JavascriptInterface
        fun notifyPlayback(playing: Boolean) {
            events?.invoke(
                JSONObject().put("type", "playback").put("id", id).put("playing", playing),
            )
        }

        /** Adapter `frame.ready()` — explicit §16 readiness for late-painting SPAs. */
        @JavascriptInterface
        fun notifyReady() {
            events?.invoke(JSONObject().put("type", "adapter-ready").put("id", id))
        }

        /** §17 framing verdict: selector found and framed, or missing. */
        @JavascriptInterface
        fun notifyFocusResult(found: Boolean) {
            events?.invoke(JSONObject().put("type", "focus-result").put("id", id).put("found", found))
        }

        /** §26 adapter ad-break signal — passive observation only. */
        @JavascriptInterface
        fun notifyAdBreak(active: Boolean) {
            events?.invoke(JSONObject().put("type", "ad-break").put("id", id).put("active", active))
        }

        /** §26 adapter observed the player's skip affordance — observation only, never a click. */
        @JavascriptInterface
        fun notifySkipAvailable(available: Boolean, target: String) {
            val ev = JSONObject().put("type", "skip-available").put("id", id).put("available", available)
            if (target.isNotEmpty()) ev.put("target", target)
            events?.invoke(ev)
        }

        /** §25 media position report — feeds the virtual playhead. duration <= 0 = live stream. */
        @JavascriptInterface
        fun notifyPosition(position: Double, duration: Double) {
            val event = JSONObject().put("type", "media-position").put("id", id).put("position", position)
            if (duration > 0) event.put("duration", duration) else event.put("duration", JSONObject.NULL)
            events?.invoke(event)
        }
    }

    private fun parseColor(hex: String): Int = try {
        Color.parseColor(hex)
    } catch (_: IllegalArgumentException) {
        Color.parseColor("#0e0e10")
    }

    companion object {
        private const val BLANK = "about:blank"
        private const val TAG = "PrismSurface"
        private const val MATCH = FrameLayout.LayoutParams.MATCH_PARENT
        private const val INTERACTION_THROTTLE_MS = 5_000L

        /** Document-level capture listeners survive SPA navigation. */
        /**
         * §2 desktop viewport: lay the page out at 1 CSS px per physical px whatever
         * the site's own viewport meta says. Read-only otherwise; nothing clicked.
         */
        private val DESKTOP_VIEWPORT_JS = """
            (function () {
              if (window.__prismViewport) return; window.__prismViewport = true;
              // This WebView's Widevine answers only an unspecified robustness: both the
              // SW_SECURE_* a desktop player asks for and the HW_SECURE_* it falls back to
              // are refused, so players (Shaka) conclude "no DRM". Retry without levels.
              try {
                var rmksa = navigator.requestMediaKeySystemAccess.bind(navigator);
                navigator.requestMediaKeySystemAccess = function (ks, cfgs) {
                  var fixed = (cfgs || []).map(function (c) { var d = JSON.parse(JSON.stringify(c)); ['videoCapabilities', 'audioCapabilities'].forEach(function (k) { (d[k] || []).forEach(function (cap) { if (/^(SW|HW)_/.test(cap.robustness || '')) cap.robustness = ''; }); }); return d; });
                  return rmksa(ks, cfgs).catch(function () { return rmksa(ks, fixed); });
                };
                // The same for capability queries: players gate on decodingInfo with a
                // keySystemConfiguration; a named robustness answers supported:false here.
                if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) {
                  var odi = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
                  navigator.mediaCapabilities.decodingInfo = function (cfg) {
                    return odi(cfg).then(function (r) {
                      if (r && r.supported) return r;
                      var k = cfg && cfg.keySystemConfiguration;
                      if (!k) return r;
                      var d = JSON.parse(JSON.stringify(cfg));
                      var ks = d.keySystemConfiguration;
                      ['video', 'audio'].forEach(function (m) { if (ks[m] && /^(SW|HW)_/.test(ks[m].robustness || '')) ks[m].robustness = ''; });
                      return odi(d).catch(function () { return r; });
                    });
                  };
                }
              } catch (e) {}
              var s = 1 / (window.devicePixelRatio || 1);
              var want = 'width=device-width, initial-scale=' + s + ', minimum-scale=' + s + ', maximum-scale=' + s;
              function fix() {
                var head = document.head; if (!head) return;
                var m = head.querySelector('meta[name=viewport]');
                if (!m) { m = document.createElement('meta'); m.name = 'viewport'; head.appendChild(m); }
                if (m.getAttribute('content') !== want) m.setAttribute('content', want);
              }
              // Chromium evaluates the meta when it is SET, not when the page later
              // resizes: re-assert it after load and on every resize (a tile going
              // full screen), toggling the value so the change is real.
              function reassert() { var m = document.head && document.head.querySelector('meta[name=viewport]'); if (m) m.setAttribute('content', 'width=device-width'); fix(); }
              fix();
              new MutationObserver(fix).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
              window.addEventListener('load', function () { setTimeout(reassert, 50); setTimeout(reassert, 1500); setTimeout(reassert, 4000); });
              if (document.readyState === 'complete') { setTimeout(reassert, 50); setTimeout(reassert, 1500); }
              var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(reassert, 120); });
            })();
        """.trimIndent()
        private val MEDIA_LISTENER_JS = """
            (function () {
              if (window.__prismMedia) return;
              window.__prismMedia = true;
              var notify = function (p) { try { PrismTile.notifyPlayback(p); } catch (e) {} };
              document.addEventListener('playing', function () { notify(true); }, true);
              document.addEventListener('pause', function () { notify(false); }, true);
            })();
        """.trimIndent()
    }
}
