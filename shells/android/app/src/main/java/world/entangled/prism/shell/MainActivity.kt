package world.entangled.prism.shell

import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.doOnLayout
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import org.json.JSONObject
import java.net.NetworkInterface

/**
 * The Prism Android shell. Hosts core in a hidden WebView (CoreRuntime),
 * executes its commands over tile WebViews (SurfaceManager), listens for the
 * remote API (PrismHttpServer), and renders the pairing QR (§6). All
 * behavior is core's; this file is plumbing only.
 */
class MainActivity : ComponentActivity() {

    private lateinit var root: FrameLayout
    private var core: CoreRuntime? = null
    private var server: PrismHttpServer? = null
    private var qrOverlay: View? = null
    private var menuChip: TextView? = null
    private var lastW = 0
    private var lastH = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // A frame is furniture: stay on, stay immersive, stay dark (§16, §24).
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_FULLSCREEN

        root = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#0e0e10")) }
        // Always-visible affordance so the menu is discoverable from the couch.
        menuChip = TextView(this).apply {
                text = CHIP_WALL
                setTextColor(Color.parseColor("#B8C0CC"))
                setBackgroundColor(Color.parseColor("#B31E232B"))
                textSize = 13f
                setPadding(22, 10, 22, 10)
                z = 90f
            }
        root.addView(
            menuChip,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, 20, 20) },
        )
        setContent {
            AndroidView(modifier = Modifier.fillMaxSize(), factory = { root })
        }

        val runtimeJs = readAsset("prism-runtime.js")
        val docJson = readAsset("dashboard.json")
        if (runtimeJs == null || docJson == null) {
            showHint(
                "Missing assets.\n\n" +
                    "Run `npm run android:assets` at the repo root to bundle prism-core, " +
                    "then rebuild. dashboard.json must also exist in app assets.",
            )
            return
        }

        val store = PrismStore(this)
        val blockList = BlockList(this, store) // §5: attributed lists, per-tile toggle from core
        this.blockList = blockList
        val surfaces = SurfaceManager(root, store, blockList)
        surfacesRef = surfaces
        surfaces.onTakeover = { full ->
            // In the solo layout one app is always raised and Back opens the menu — say so.
            core?.state { s -> soloMode = s?.optString("layoutMode") == "solo"; runOnUiThread { menuChip?.text = if (full && !soloMode) CHIP_FULL else CHIP_WALL } }
                ?: runOnUiThread { menuChip?.text = if (full) CHIP_FULL else CHIP_WALL }
        }
        val runtime = CoreRuntime(this, store) { cmd -> route(cmd, surfaces) }
        updater = Updater(this)
        surfaces.events = { evt -> runtime.event(evt) }
        core = runtime

        server = PrismHttpServer(
            REMOTE_PORT, this,
            forward = { id, req -> runtime.http(id, req) },
            redeemStreamTicket = { ticket -> runtime.redeemStreamTicket(ticket) },
        )
        server?.start()
        // §14 peer-drop: a stream socket that dies without the phone leaving
        // is an unexpected loss — core keeps the speakers muted through grace.
        AudioHub.onLost = { listener ->
            runtime.event(JSONObject().put("type", "listener-lost").put("id", "").put("listener", listener))
        }
        // §26 native: the accessibility observer's observations flow into core
        // as surface events (app-foreground / app-ad-break / app-skip-available).
        PrismAccessibilityService.events = { evt -> runOnUiThread { runtime.event(evt) } }
        Log.i("PrismObserve", "observer enabled=${PrismAccessibilityService.isEnabled} overlay=${android.provider.Settings.canDrawOverlays(this)}")

        // The core-host WebView must be attached for timers to run; 1×1, unseen.
        root.addView(runtime.webView, FrameLayout.LayoutParams(1, 1))

        root.doOnLayout {
            lastW = root.width
            lastH = root.height
            // §18 device budget from RAM class; core does the enforcing.
            val mem = android.app.ActivityManager.MemoryInfo().also {
                (getSystemService(ACTIVITY_SERVICE) as android.app.ActivityManager).getMemoryInfo(it)
            }
            val gb = mem.totalMem / (1024.0 * 1024 * 1024)
            val computed = if (gb >= 5) 6 else if (gb >= 2.5) 4 else 2
            // Debug/conformance override: adb shell am start --ei maxLiveTiles N
            val maxLive = intent.getIntExtra("maxLiveTiles", computed)
            Log.i("PrismShell", "device RAM %.1fGB → maxLiveTiles=%d".format(gb, maxLive))
            // §19 context: software identities only — versions, never ids.
            val webViewVer = try {
                android.webkit.WebView.getCurrentWebViewPackage()?.versionName
                    ?.substringBefore(".") ?: "unknown"
            } catch (_: Exception) { "unknown" }
            val isTv = (getSystemService(UI_MODE_SERVICE) as android.app.UiModeManager)
                .currentModeType == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
            // §25 decode budget by device class; §27 attributed cosmetic lists;
            // §28 static manifest (no query string — core refuses otherwise).
            val budgetClass = if (isTv && gb < 2.5) "tv-box-2gb" else if (gb >= 5) "mini-pc" else "tablet"
            val previewBudget = when (budgetClass) {
                "tv-box-2gb" -> JSONObject().put("maxPlayingVideo", 1).put("minPeekIntervalSec", 60)
                "mini-pc" -> JSONObject().put("maxPlayingVideo", 3).put("minPeekIntervalSec", 30)
                else -> JSONObject().put("maxPlayingVideo", 2).put("minPeekIntervalSec", 30)
            }
            val versionName = packageManager.getPackageInfo(packageName, 0).versionName ?: "0"
            val options = JSONObject()
                .put("maxLiveTiles", maxLive)
                .put("adapters", loadAdapters())
                .put("previewBudget", previewBudget)
                .put("blocking", JSONObject().put("sources", blockList.sourceSpecsJson())) // §5: core syncs + applies
                // §14: this shell serves the background-proof HTTP transport from
                // AudioPlaybackCapture (API 29+); WebRTC lands later.
                .put(
                    "audio",
                    JSONObject()
                        .put("transports", org.json.JSONArray().also { if (android.os.Build.VERSION.SDK_INT >= 29) it.put("http") })
                        .put("streamPath", "/audio/stream"),
                )
                .put(
                    "update",
                    JSONObject()
                        .put("currentVersion", versionName)
                        .put("manifestUrl", UPDATE_MANIFEST_URL)
                        .put("channel", store.get("updates:channel") ?: "stable"),
                )
                .put(
                    "compat",
                    JSONObject()
                        .put(
                            "shell",
                            "prism-android@" + (packageManager.getPackageInfo(packageName, 0).versionName ?: "0"),
                        )
                        .put("engine", "webview@$webViewVer")
                        .put("device", if (isTv) "tv-16x9" else "tablet-16x10"),
                )
            runtime.start(runtimeJs, docJson, lastW, lastH, options.toString())
            // First boot (§6): a QR only while no phone is paired. Afterwards a
            // short on-wall note says how to reach the menu instead.
            requestPairingQr(onlyIfUnpaired = true)
        }
        root.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            if (root.width > 0 && (root.width != lastW || root.height != lastH)) {
                lastW = root.width
                lastH = root.height
                core?.resize(lastW, lastH)
            }
        }
    }

    /** Commands from core: remote/http/display ops handled here, surface ops delegated. */
    private fun route(cmd: JSONObject, surfaces: SurfaceManager) {
        when (cmd.getString("op")) {
            "http.response" -> server?.complete(cmd)
            "remote.pairing" -> {
                Log.i("PrismRemote", "pairing URL: ${cmd.getString("url")}")
                showQr(cmd.getString("url"))
            }
            "remote.paired-count" -> {
                val n = cmd.getInt("n")
                Log.i("PrismRemote", "$n phone(s) already paired; no boot QR")
                toast("$n phone${if (n == 1) "" else "s"} paired \u00b7 press Back for the menu")
            }
            // §6: the phone's first authenticated call means it's paired — take
            // the QR down without anyone reaching for the TV remote.
            "remote.paired" -> dismissQr()
            // Display driver (§4 schedules, §6 POST /display). Real panel
            // power needs device-owner mode; v0 sleep = minimum brightness.
            "display.setBrightness" -> setBrightness(cmd.getDouble("value").toFloat())
            "display.setPower" ->
                setBrightness(if (cmd.getString("state") == "sleep") 0.01f else 1f)
            // §24 alarm tone: system default alarm sound — local, offline-proof.
            "alarm.setTone" -> setAlarmTone(cmd.getBoolean("playing"))
            // §12: launch a native app fullscreen; Back returns to the shell.
            "media.launch" -> launchApp(
                cmd.getString("package"),
                if (cmd.isNull("deepLink")) "" else cmd.optString("deepLink", ""),
            )
            // §14: frame speakers while someone listens privately.
            "media.setSpeakers" -> setSpeakers(cmd.getString("mode"))
            // §14: the one capture mix (AudioPlaybackCapture) and its transports.
            "surface.captureAudio" -> setCapture(cmd.getBoolean("enable"))
            "media.serveAudio" -> Log.i("PrismAudio", "serve ${cmd.getString("transport")} = ${cmd.getBoolean("enable")}") // http is served on demand by the listener
            // §12: installed launchable apps for the remote's "open" sheet.
            "media.listApps" -> core?.resolve(cmd.getInt("requestId"), listApps().toString())
            // §26 native: forward a HUMAN's skip to the observed node via the accessibility observer.
            "media.appSkip" -> {
                val ok = PrismAccessibilityService.instance?.performSkip(cmd.getString("package"), cmd.getString("target")) ?: false
                core?.resolve(cmd.getInt("requestId"), if (ok) "true" else "false")
            }
            // §7 native: a human's text / Back into the app in front, via the observer.
            "media.appType" -> {
                val ok = PrismAccessibilityService.instance?.typeInto(cmd.getString("package"), cmd.getString("text")) ?: false
                core?.resolve(cmd.getInt("requestId"), if (ok) "true" else "false")
            }
            "media.appBack" -> {
                val ok = PrismAccessibilityService.instance?.back(cmd.getString("package")) ?: false
                core?.resolve(cmd.getInt("requestId"), if (ok) "true" else "false")
            }
            // §26 native: scenery over a fullscreen app rides the overlay window, not a tile view.
            "surface.showIntermission" -> {
                val id = cmd.getString("id")
                if (launchTiles.contains(id)) { overlayTile = id; appOverlay.show(cmd.getString("source")) } else surfaces.execute(cmd)
            }
            "surface.hideIntermission" -> {
                val id = cmd.getString("id")
                if (launchTiles.contains(id)) { if (overlayTile == id) overlayTile = null; appOverlay.hide() } else surfaces.execute(cmd)
            }
            "surface.setIntermissionSkip" -> {
                val id = cmd.getString("id")
                if (launchTiles.contains(id)) appOverlay.setSkip(cmd.getBoolean("available")) else surfaces.execute(cmd)
            }
            "surface.create" -> {
                if (cmd.optString("launch", "").isNotEmpty()) launchTiles.add(cmd.getString("id"))
                surfaces.execute(cmd)
            }
            // §11: shell-owned pairing UI and the paired-remote list for edit mode.
            "input.startPairing" -> remotes.startPairing()
            "input.listRemotes" -> core?.resolve(cmd.getInt("requestId"), remotes.list().toString())
            // Read-only page check for core (does a field exist / hold the text?).
            "surface.goBack" -> {
                val requestId = cmd.getInt("requestId")
                core?.resolve(requestId, if (surfaces.goBack(cmd.getString("id"))) "true" else "false")
            }
            "surface.evaluate" -> {
                val requestId = cmd.getInt("requestId")
                surfaces.evaluate(cmd.getString("id"), cmd.getString("js")) { v -> core?.resolve(requestId, v) }
            }
            // §27: local imagery URLs for a pack — served by WebViewAssetLoader, never fetched.
            "surface.veilImagery" -> core?.resolve(cmd.getInt("requestId"), packImages(cmd.getString("source")).toString())
            // §5 list sync: exactly the URL core hands over; core parses and decides.
            "net.fetchStatic" -> {
                val requestId = cmd.getInt("requestId")
                updater?.fetchManifest(cmd.getString("url")) { text, err ->
                    core?.resolve(requestId, text?.let { JSONObject.quote(it) }, err)
                }
            }
            "net.applyBlockHosts" -> {
                val arr = cmd.getJSONArray("hosts")
                blockList?.applySynced(
                    cmd.getString("sourceId"),
                    cmd.getString("name"),
                    List(arr.length()) { arr.getString(it) },
                )
            }
            // §28: bytes only; policy stayed in core.
            "update.fetchManifest" -> {
                val requestId = cmd.getInt("requestId")
                updater?.fetchManifest(cmd.getString("url")) { text, err ->
                    core?.resolve(requestId, text?.let { JSONObject.quote(it) }, err)
                }
            }
            "update.apply" -> {
                val requestId = cmd.getInt("requestId")
                updater?.apply(cmd.getJSONObject("release")) { result ->
                    core?.resolve(requestId, JSONObject.quote(result))
                }
            }
            else -> surfaces.execute(cmd)
        }
    }

    private var updater: Updater? = null
    private var blockList: BlockList? = null
    private var centerDownAt = 0L
    private var centerLong = false
    private var menuOverlay: View? = null

    /* ------------------------ on-frame menu (edit mode, §6/§11/§12) ------------------------ */

    /**
     * A shell-rendered menu, built from core's state: pairing QR, remote
     * pairing, and the web/native choice for tiles that have both. Every
     * action is a core call; the menu decides nothing.
     */
    private fun showMenu() {
        if (menuOverlay != null) return
        dismissQr()
        val c = core ?: return
        c.state { state -> if (menuOverlay == null) buildMenu(state) }
    }

    private fun buildMenu(state: JSONObject?) {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1E232B"))
            setPadding(40, 32, 40, 32)
            addView(TextView(this@MainActivity).apply {
                text = "Prism · " + (state?.optString("name") ?: "")
                setTextColor(Color.parseColor("#F0A83C")); textSize = 14f; setPadding(12, 0, 0, 12)
            })
        }
        fun item(label: String, onClick: () -> Unit): TextView = TextView(this).apply {
            text = label; textSize = 20f; setTextColor(Color.parseColor("#D7DCE3")); setPadding(24, 18, 24, 18)
            isFocusable = true; isClickable = true
            background = android.graphics.drawable.StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), android.graphics.drawable.ColorDrawable(Color.parseColor("#2A3240")))
                addState(intArrayOf(), android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
            }
            setOnClickListener { onClick() }
        }
        card.addView(item("Pair a phone (show QR code)") { dismissMenu(); requestPairingQr() })
        // Layouts of the bundle: one app at a time vs the wall (§9 dashboards).
        val dashes = state?.optJSONArray("dashboards")
        val current = state?.optString("dashboard")
        if (dashes != null && dashes.length() > 1) {
            for (i in 0 until dashes.length()) {
                val id = dashes.getString(i)
                if (id == current) continue
                val base = current?.removeSuffix("-solo")
                val label = when (id) {
                    "$base-solo" -> "Show one app at a time"
                    base -> "Show the wall of apps"
                    else -> "Switch to $id"
                }
                card.addView(item(label) { dismissMenu(); core?.switchTo(id) })
            }
        }
        card.addView(item("Add a Bluetooth remote…") { dismissMenu(); remotes.startPairing() })
        val tiles = state?.optJSONArray("tiles")
        if (tiles != null) for (i in 0 until tiles.length()) {
            val t = tiles.getJSONObject(i)
            val alt = t.optJSONObject("alternative") ?: continue
            val id = t.getString("id")
            val current = t.optString("mode", "web")
            val label = if (current == "web") "$id: Web player  ✓   (switch to native app)" else "$id: Native app  ✓   (switch to web player)"
            card.addView(item(label) { core?.setTileMode(id, alt.getString("mode")); dismissMenu() })
            card.addView(TextView(this).apply {
                text = "Native app: intermission and Skip work only where the app exposes its ad markers to Prism's observer — no in-page overlay. Web player: full intermission."
                setTextColor(Color.parseColor("#8A93A0")); textSize = 13f; setPadding(24, 0, 24, 14); maxWidth = 1100
            })
        }
        card.addView(item("Close") { dismissMenu() })
        val scrim = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#CC0A0C0F"))
            isClickable = true
            setOnClickListener { dismissMenu() }
            addView(card, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
            z = 120f
        }
        menuOverlay = scrim
        root.addView(scrim, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        (card.getChildAt(1) as? View)?.requestFocus()
    }

    private fun dismissMenu() {
        menuOverlay?.let { root.removeView(it) }
        menuOverlay = null
    }
    private val remotes by lazy { Remotes(this) } // §11
    /** §26 native: launch tiles (their scenery is an overlay window) and which one is covered. */
    private val launchTiles = HashSet<String>()
    private var overlayTile: String? = null
    private val appOverlay by lazy {
        AppOverlay(this) {
            // A human pressed the chip (touch or OK on the overlay) — forward via core.
            overlayTile?.let { id -> core?.event(JSONObject().put("type", "intermission-skip").put("id", id)) }
        }
    }
    private var normalVolume = -1

    /* ------------------------ §14 capture consent + service ------------------------ */

    private var projectionResult: Pair<Int, android.content.Intent>? = null
    private var captureWanted = false

    /**
     * AudioPlaybackCapture rides a MediaProjection, which Android grants
     * through its own consent dialog (once per app process; accepted with
     * the TV remote). Core asked for capture; we ask the OS, then start the
     * foreground service. Nothing here decides *when* — that was core.
     */
    private fun setCapture(enable: Boolean) {
        captureWanted = enable
        if (!enable) {
            startService(android.content.Intent(this, AudioCaptureService::class.java).setAction(AudioCaptureService.ACTION_STOP))
            return
        }
        // RECORD_AUDIO is a runtime permission (a device-owner build grants it
        // silently; otherwise the OS asks once). Then the projection consent.
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO), REQ_AUDIO_PERM)
            return
        }
        val saved = projectionResult
        if (saved != null) {
            startCaptureService(saved.first, saved.second)
            return
        }
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as android.media.projection.MediaProjectionManager
        @Suppress("DEPRECATION")
        startActivityForResult(mpm.createScreenCaptureIntent(), REQ_PROJECTION)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_AUDIO_PERM) return
        if (grantResults.firstOrNull() == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            if (captureWanted) setCapture(true)
        } else {
            Log.w("PrismAudio", "RECORD_AUDIO denied — private listening stays off")
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_PROJECTION) return
        if (resultCode == RESULT_OK && data != null) {
            projectionResult = resultCode to data
            if (captureWanted) startCaptureService(resultCode, data)
        } else {
            Log.w("PrismAudio", "capture consent declined — private listening stays off")
        }
    }

    private fun startCaptureService(resultCode: Int, data: android.content.Intent) {
        val intent = android.content.Intent(this, AudioCaptureService::class.java)
            .setAction(AudioCaptureService.ACTION_START)
            .putExtra(AudioCaptureService.EXTRA_RESULT_CODE, resultCode)
            .putExtra(AudioCaptureService.EXTRA_RESULT_DATA, data)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
    }

    /** §14 speakers: duck to a quarter, mute to zero, normal restores what was there. */
    private fun setSpeakers(mode: String) {
        val am = getSystemService(AUDIO_SERVICE) as android.media.AudioManager
        val stream = android.media.AudioManager.STREAM_MUSIC
        try {
            when (mode) {
                "normal" -> if (normalVolume >= 0) {
                    am.setStreamVolume(stream, normalVolume, 0)
                    normalVolume = -1
                }
                else -> {
                    if (normalVolume < 0) normalVolume = am.getStreamVolume(stream)
                    val target = if (mode == "duck") (am.getStreamMaxVolume(stream) / 4) else 0
                    am.setStreamVolume(stream, target, 0)
                }
            }
        } catch (e: Exception) {
            Log.w("PrismShell", "speakers $mode failed: $e")
        }
    }

    /** Files under assets/packs/<pack>/ as asset-loader URLs; empty ⇒ textured fallback (§27). */
    private fun packImages(source: String): org.json.JSONArray {
        val out = org.json.JSONArray()
        val pack = source.removePrefix("pack:").takeIf { source.startsWith("pack:") } ?: return out
        try {
            for (file in assets.list("packs/$pack").orEmpty()) {
                if (file.substringAfterLast('.').lowercase() in setOf("jpg", "jpeg", "png", "webp")) {
                    out.put("https://appassets.androidplatform.net/assets/packs/$pack/$file")
                }
            }
        } catch (e: Exception) {
            Log.w("PrismShell", "pack '$pack' unreadable: $e")
        }
        return out
    }

    /** §12: apps with a TV (leanback) or ordinary launcher entry — what the remote offers beside sites. */
    private fun listApps(): org.json.JSONArray {
        val out = org.json.JSONArray()
        val pm = packageManager
        val seen = HashSet<String>()
        val queries = listOf(
            android.content.Intent(android.content.Intent.ACTION_MAIN).addCategory(android.content.Intent.CATEGORY_LEANBACK_LAUNCHER),
            android.content.Intent(android.content.Intent.ACTION_MAIN).addCategory(android.content.Intent.CATEGORY_LAUNCHER),
        )
        for (q in queries) {
            for (ri in pm.queryIntentActivities(q, 0)) {
                val pkg = ri.activityInfo.packageName
                if (pkg == packageName || !seen.add(pkg)) continue
                out.put(JSONObject().put("package", pkg).put("label", ri.loadLabel(pm).toString()))
            }
        }
        return out
    }

    private fun launchApp(pkg: String, deepLink: String) {
        try {
            val intent = if (deepLink.isNotEmpty()) {
                android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(deepLink))
                    .setPackage(pkg)
            } else {
                packageManager.getLaunchIntentForPackage(pkg)
                    ?: packageManager.getLeanbackLaunchIntentForPackage(pkg)
            }
            if (intent != null) startActivity(intent)
            else Log.w("PrismShell", "no launch intent for $pkg")
        } catch (e: Exception) {
            Log.e("PrismShell", "launch failed for $pkg", e)
        }
    }

    private var alarmPlayer: android.media.MediaPlayer? = null

    private fun setAlarmTone(playing: Boolean) {
        if (!playing) {
            alarmPlayer?.stop()
            alarmPlayer?.release()
            alarmPlayer = null
            return
        }
        if (alarmPlayer != null) return
        try {
            val uri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM)
                ?: android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION)
            alarmPlayer = android.media.MediaPlayer().apply {
                setDataSource(this@MainActivity, uri)
                setAudioAttributes(
                    android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                        .build(),
                )
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            Log.e("PrismShell", "alarm tone failed", e)
        }
    }

    private fun setBrightness(value: Float) {
        window.attributes = window.attributes.apply {
            screenBrightness = value.coerceIn(0.01f, 1f)
        }
    }

    private fun requestPairingQr(onlyIfUnpaired: Boolean = false) {
        val ip = localIp() ?: return showHint("No network — connect WiFi/Ethernet for the remote.")
        core?.mintPairing("http://$ip:$REMOTE_PORT", onlyIfUnpaired)
    }

    /** A few seconds of small text at the bottom of the wall; never a dialog. */
    private fun toast(message: String, ms: Long = 7_000) {
        val v = TextView(this).apply {
            text = message
            setTextColor(Color.parseColor("#D7DCE3"))
            setBackgroundColor(Color.parseColor("#D91E232B"))
            textSize = 15f
            setPadding(28, 14, 28, 14)
            z = 95f
        }
        root.addView(
            v,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { setMargins(0, 0, 0, 28) },
        )
        root.postDelayed({ root.removeView(v) }, ms)
    }

    /**
     * §12: the frame owns the d-pad. Tile WebViews would otherwise consume
     * arrows/select for in-page focus before the activity ever sees them, so
     * navigation keys are intercepted at dispatch and routed to core (which
     * moves the focus ring / activates). Everything else flows normally.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // The on-frame menu owns every key while open (it is a normal focusable view tree).
        if (menuOverlay != null) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_BACK -> dismissMenu()
                    KeyEvent.KEYCODE_DPAD_DOWN -> menuMove(1)
                    KeyEvent.KEYCODE_DPAD_UP -> menuMove(-1)
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> menuItems().firstOrNull { it.isFocused }?.performClick()
                }
            }
            return true // the menu owns every key while open
        }
        // The corner chip as a d-pad target: ▼ on a solo app highlights it, OK opens the menu, ▲ returns.
        if (chipFocused) {
            if (event.action == KeyEvent.ACTION_DOWN) {
                when (event.keyCode) {
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { setChipFocused(false); showMenu() }
                    KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_BACK -> setChipFocused(false)
                    else -> setChipFocused(false)
                }
            }
            return true
        }
        // Long-press OK opens the menu (Shield remotes have no Menu key); short press activates.
        if (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || event.keyCode == KeyEvent.KEYCODE_ENTER) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) { centerDownAt = event.eventTime; centerLong = false; return true }
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount > 0 && !centerLong && (event.isLongPress || event.eventTime - centerDownAt >= 600)) {
                centerLong = true; showMenu(); return true
            }
            if (event.action == KeyEvent.ACTION_UP) {
                if (!centerLong && qrOverlay == null && core != null) onKeyDown(event.keyCode, event)
                else if (!centerLong && qrOverlay != null) dismissQr()
                return true
            }
            return true
        }
        // Back is the one dedicated button every TV remote has: inside an entered
        // page it leaves the page (core); on the wall it opens the menu (pairing
        // QR, per-tile settings). No long-press to discover.
        if (event.keyCode == KeyEvent.KEYCODE_BACK && qrOverlay == null && core != null) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                core?.state { s ->
                    if (s != null && !s.isNull("entered")) onKeyDown(KeyEvent.KEYCODE_BACK, event) else showMenu()
                }
            }
            return true
        }
        if (event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN && event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 && qrOverlay == null && core != null) {
            // On a raised app that is NOT entered, ▼ has nowhere to go but the chip. Decided
            // from the shell's own synchronous state — an async read raced the OK before it.
            if (soloMode && surfacesRef?.anyRaised() == true && surfacesRef?.anyEntered() == false) { setChipFocused(true); return true }
            onKeyDown(KeyEvent.KEYCODE_DPAD_DOWN, event)
            return true
        }
        // Keys we do not route: log the name once so remote buttons can be mapped (Settings, ☰ …).
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            val kc = event.keyCode
            if (kc != KeyEvent.KEYCODE_BACK && kc != KeyEvent.KEYCODE_DPAD_CENTER && kc != KeyEvent.KEYCODE_ENTER && kc !in KeyEvent.KEYCODE_DPAD_UP..KeyEvent.KEYCODE_DPAD_CENTER) {
                Log.i("PrismKeys", "key ${KeyEvent.keyCodeToString(kc)} (scan ${event.scanCode}) from ${event.device?.name}")
            }
        }
        // The remote's Settings/☰ button while Prism is in front: our menu, not the system's.
        if ((event.keyCode == KeyEvent.KEYCODE_SETTINGS || event.keyCode == KeyEvent.KEYCODE_MENU) && event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            if (menuOverlay == null) showMenu() else dismissMenu()
            return true
        }
        val nav = when (event.keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN,
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_BUTTON_A,
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_CHANNEL_DOWN,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE,
            KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_PREVIOUS -> true
            else -> false
        }
        if (nav && qrOverlay == null && core != null) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) onKeyDown(event.keyCode, event)
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    /** BT remotes and TV d-pads arrive as ordinary key events (§7, §11, §12). */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (qrOverlay != null && (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_DPAD_CENTER)) {
            dismissQr()
            return true
        }
        // Menu / Info (remotes that have them) open the on-frame menu.
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_INFO) {
            showMenu()
            return true
        }
        val core = core ?: return super.onKeyDown(keyCode, event)
        // §11: the device slug rides along so per-remote overrides apply;
        // core resolves override → dashboard map → default.
        val input = JSONObject().put("key", KeyEvent.keyCodeToString(keyCode))
        remotes.slugFor(event)?.let { input.put("device", it) }
        core.input(input)
        if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
            core.state { s -> if (s != null && s.optString("layoutMode") == "solo" && s.isNull("entered")) runOnUiThread { showStrip(s) } }
        }
        return true
    }

    /* ---------------- menu d-pad + chip focus ---------------- */

    private var chipFocused = false
    private var soloMode = false
    private var surfacesRef: SurfaceManager? = null
    private fun setChipFocused(on: Boolean) {
        chipFocused = on
        menuChip?.apply {
            setBackgroundColor(Color.parseColor(if (on) "#F0A83C" else "#B31E232B"))
            setTextColor(Color.parseColor(if (on) "#14171C" else "#B8C0CC"))
        }
    }

    private fun menuItems(): List<View> {
        val card = (menuOverlay as? ViewGroup)?.getChildAt(0) as? ViewGroup ?: return emptyList()
        return (0 until card.childCount).map { card.getChildAt(it) }.filter { it.isFocusable }
    }

    private fun menuMove(delta: Int) {
        val items = menuItems(); if (items.isEmpty()) return
        val at = items.indexOfFirst { it.isFocused }
        val next = ((if (at < 0) 0 else at + delta) + items.size) % items.size
        items[next].requestFocus()
    }

    /* ---------------- solo layout: the strip of apps (shell-rendered, transient) ---------------- */

    private var strip: View? = null
    private val stripHide = Runnable { strip?.let { root.removeView(it) }; strip = null }

    private fun brandLabel(t: JSONObject): String {
        val key = (t.optString("url") + " " + t.optString("launch") + " " + t.optString("id")).lowercase()
        return when {
            "youtube" in key -> "YouTube"; "netflix" in key -> "Netflix"; "disney" in key -> "Disney+"
            "hbomax" in key || "wbd" in key -> "HBO Max"; "primevideo" in key || "amazon" in key -> "Prime Video"
            "tubi" in key -> "Tubi"; "xumo" in key -> "Xumo"; "hulu" in key -> "Hulu"; "apple" in key -> "Apple TV"; "paramount" in key || "cbs" in key -> "Paramount+"
            else -> t.optString("id")
        }
    }

    private fun showStrip(state: JSONObject) {
        root.removeCallbacks(stripHide)
        strip?.let { root.removeView(it) }
        val tiles = state.getJSONArray("tiles")
        val current = state.optString("fullscreen")
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#E6141A22"))
            setPadding(24, 18, 24, 18)
            for (i in 0 until tiles.length()) {
                val t = tiles.getJSONObject(i)
                if (t.has("launch") && !t.has("url")) continue
                val on = t.optString("id") == current
                addView(TextView(this@MainActivity).apply {
                    text = brandLabel(t)
                    textSize = if (on) 22f else 17f
                    setTextColor(Color.parseColor(if (on) "#F0A83C" else "#8A93A0"))
                    setPadding(28, 8, 28, 8)
                    if (on) setBackgroundColor(Color.parseColor("#2A3240"))
                })
            }
        }
        strip = row
        root.addView(
            row,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { setMargins(0, 0, 0, 90) },
        )
        row.z = 96f
        root.postDelayed(stripHide, 2500)
    }

    /* ---------------- pairing QR overlay (shell-rendered, §6) ------------- */

    private fun showQr(url: String) {
        dismissQr()
        // Big enough to scan from across the room (a bed, a couch): most of
        // the short edge goes to the code itself; the captions stay small.
        val sizePx = (minOf(root.width, root.height) * 0.78).toInt().coerceAtLeast(300)
        val bitmap = qrBitmap(url, sizePx) ?: return

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#1E232B"))
            setPadding(40, 28, 40, 20)
            addView(ImageView(this@MainActivity).apply { setImageBitmap(bitmap) })
            addView(TextView(this@MainActivity).apply {
                text = "Scan with your phone camera to control this frame"
                setTextColor(Color.parseColor("#D7DCE3"))
                textSize = 16f
                gravity = Gravity.CENTER
                setPadding(0, 16, 0, 4)
            })
            addView(TextView(this@MainActivity).apply {
                text = "$url\nBack or OK dismisses · Back on the wall opens the menu"
                setTextColor(Color.parseColor("#8A93A0"))
                textSize = 11f
                gravity = Gravity.CENTER
            })
        }

        val scrim = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#CC0A0C0F"))
            isClickable = true
            setOnClickListener { dismissQr() }
            addView(
                card,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.CENTER,
                ),
            )
            z = 100f
        }
        qrOverlay = scrim
        root.addView(scrim, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
    }

    private fun dismissQr() {
        qrOverlay?.let { root.removeView(it) }
        qrOverlay = null
    }

    private fun qrBitmap(text: String, size: Int): Bitmap? = try {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
        for (x in 0 until size) for (y in 0 until size) {
            bmp.setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
        }
        bmp
    } catch (e: Exception) {
        Log.e("PrismRemote", "QR encode failed", e)
        null
    }

    private fun localIp(): String? = try {
        NetworkInterface.getNetworkInterfaces().asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.asSequence() }
            .firstOrNull { it.isSiteLocalAddress && it.address.size == 4 }
            ?.hostAddress
    } catch (_: Exception) {
        null
    }

    private fun readAsset(name: String): String? = try {
        assets.open(name).bufferedReader().use { it.readText() }
    } catch (_: Exception) {
        null
    }

    /** Bundled adapter set (§5) from the assets "adapters" dir, keyed by file name. */
    private fun loadAdapters(): JSONObject {
        val out = JSONObject()
        try {
            for (file in assets.list("adapters").orEmpty()) {
                if (!file.endsWith(".json")) continue
                val body = readAsset("adapters/$file") ?: continue
                out.put(file.removeSuffix(".json"), JSONObject(body))
            }
        } catch (e: Exception) {
            Log.w("PrismShell", "adapter assets unreadable: $e")
        }
        return out
    }

    private fun showHint(message: String) {
        root.addView(
            TextView(this).apply {
                text = message
                setTextColor(Color.parseColor("#8A93A0"))
                textSize = 16f
                setPadding(48, 48, 48, 48)
            },
        )
    }

    override fun onDestroy() {
        server?.stop()
        super.onDestroy()
    }

    companion object {
        private const val CHIP_WALL = "\u2630  Menu"
        private const val CHIP_FULL = "\u2039  Back returns to the wall"
        const val REMOTE_PORT = 8471
        private const val REQ_PROJECTION = 1414
        private const val REQ_AUDIO_PERM = 1415
        /** §28: static, unparameterized — core refuses anything else. */
        const val UPDATE_MANIFEST_URL = "https://entangled.world/prism/updates/manifest.json"
    }
}
