package world.entangled.prism.shell

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject

/**
 * §26 for native apps — OBSERVE, NEVER INTERACT.
 *
 * Android's accessibility API lets Prism read the UI tree of the app in
 * front (even through DRM-secure windows, which only block screenshots).
 * This service watches DECLARED media packages only and reports two
 * observations to core: the app's own ad markers ("Ad 1 of 3",
 * "Advertisement") and the appearance of a clickable Skip affordance
 * ("Skip", "Skip Ad", "Skip Intro", "Skip Recap"). Core runs the same
 * cover-slow / uncover-fast intermission as for web tiles.
 *
 * The ONLY action this service ever performs is `performSkip`, and only
 * when core forwards a human's activation (OK on the chip, phone button).
 * There is no timer, no auto-click, no dismissal of anything — the same
 * hard rule the adapter lint enforces for web tiles. Reviewers: any new
 * `performAction` call here must trace to a human keypress.
 */
class PrismAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        instance = this
        serviceInfo = (serviceInfo ?: AccessibilityServiceInfo()).apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
            notificationTimeout = 250
            // No packageNames filter: window-state events from every app are
            // needed to know what is in front (and when the wall is back).
            // UI CONTENT is only ever read for WATCHED packages (see scan()).
            packageNames = null
        }
        Log.i(TAG, "observer connected; watching ${WATCHED.size} media packages")
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onInterrupt() {}

    private var lastForeground = ""
    private var skipVisible = false
    private var adVisible = false
    private var skipNodeText: String? = null
    private var lastScan = 0L
    private var lastDump = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val pkg = event.packageName?.toString() ?: return
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val fg = if (pkg == packageName) "" else pkg
            if (fg != lastForeground) {
                lastForeground = fg
                if (fg.isEmpty()) reset()
                emit(JSONObject().put("type", "app-foreground").put("id", "").put("package", fg))
            }
        }
        if (pkg !in WATCHED) return
        val now = System.currentTimeMillis()
        if (now - lastScan < 300) return // throttle: reading a tree is cheap, but not free
        lastScan = now
        scan(pkg)
    }

    /** Walk the active window's tree once; report transitions only. */
    private fun scan(pkg: String) {
        val root = rootInActiveWindow ?: return
        var skip: AccessibilityNodeInfo? = null
        var ad = false
        val seen = ArrayList<String>()
        try {
            walk(root, 0) { node ->
                val text = (node.text?.toString() ?: "") + " " + (node.contentDescription?.toString() ?: "")
                val t = text.trim()
                if (t.isNotEmpty()) {
                    if (seen.size < 40) seen.add((if (node.isClickable) "[c]" else "") + t.take(60))
                    if (skip == null && SKIP_RE.containsMatchIn(t) && (node.isClickable || node.isFocusable)) skip = node
                    if (!ad && AD_RE.containsMatchIn(t)) ad = true
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "scan failed: $e")
        }
        // Diagnostic (debug level): what the watched app exposes, so ad recipes can be
        // tuned from real breaks. Never leaves the device; only WATCHED packages.
        val now = System.currentTimeMillis()
        if (now - lastDump > 5000) {
            lastDump = now
            Log.d(TAG, "tree[$pkg] ${seen.size} texts: " + seen.joinToString(" | "))
        }
        val skipNow = skip != null
        if (ad != adVisible) {
            adVisible = ad
            emit(JSONObject().put("type", "app-ad-break").put("id", "").put("package", pkg).put("active", ad))
        }
        if (skipNow != skipVisible) {
            skipVisible = skipNow
            skipNodeText = skip?.let { (it.text ?: it.contentDescription)?.toString() }
            val ev = JSONObject().put("type", "app-skip-available").put("id", "").put("package", pkg).put("available", skipNow)
            if (skipNow) ev.put("target", "text:" + skipNodeText)
            emit(ev)
        }
    }

    private fun walk(node: AccessibilityNodeInfo, depth: Int, visit: (AccessibilityNodeInfo) -> Unit) {
        if (depth > 40) return
        visit(node)
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            walk(child, depth + 1, visit)
        }
    }

    /**
     * The forwarded human press: re-find the observed Skip node NOW and click
     * it. Returns false if it is gone (the chip was stale) — never clicks
     * anything else as a fallback.
     */
    fun performSkip(pkg: String, target: String): Boolean {
        if (pkg !in WATCHED) return false
        val root = rootInActiveWindow ?: return false
        if (root.packageName?.toString() != pkg) return false
        val wanted = target.removePrefix("text:")
        var found: AccessibilityNodeInfo? = null
        walk(root, 0) { node ->
            if (found != null) return@walk
            val t = ((node.text ?: node.contentDescription)?.toString() ?: "").trim()
            if (t == wanted || (SKIP_RE.containsMatchIn(t) && (node.isClickable || node.isFocusable))) found = node
        }
        val node = found ?: return false
        // Climb to the nearest clickable ancestor if the text node itself isn't.
        var target2: AccessibilityNodeInfo? = node
        while (target2 != null && !target2.isClickable) target2 = target2.parent
        val ok = (target2 ?: node).performAction(AccessibilityNodeInfo.ACTION_CLICK)
        Log.i(TAG, "human skip forwarded to '$wanted' in $pkg → $ok")
        return ok
    }

    /**
     * The forwarded human's text: set it on the editable node that currently
     * has input focus in the foreground app. Appends to existing text so a
     * partially typed field is not clobbered. Never focuses or picks a field
     * itself — the human navigated there with the remote.
     */
    fun typeInto(pkg: String, text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        if (root.packageName?.toString() != pkg) return false
        val node = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        if (!node.isEditable) return false
        val existing = node.text?.toString() ?: ""
        val args = android.os.Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, existing + text)
        }
        val ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        Log.i(TAG, "human text forwarded into $pkg field → $ok")
        return ok
    }

    /** The forwarded human's Back press (global action) for the foreground app. */
    fun back(pkg: String): Boolean {
        if (lastForeground != pkg) return false
        return performGlobalAction(GLOBAL_ACTION_BACK)
    }

    private fun reset() {
        skipVisible = false
        adVisible = false
        skipNodeText = null
    }

    private fun emit(event: JSONObject) {
        events?.invoke(event)
    }

    companion object {
        private const val TAG = "PrismObserve"
        /** Declared media packages the observer may read. Nothing else, ever. */
        val WATCHED: Set<String> = setOf(
            "com.netflix.ninja", "com.amazon.amazonvideo.livingroom", "com.disney.disneyplus",
            "com.hbo.hbonow", "com.wbd.stream", "com.plexapp.android", "com.google.android.youtube.tv",
            "com.imdbtv.livingroom", "com.hulu.livingroomplus", "com.peacocktv.peacockandroid",
            "com.cbs.ott", "tv.pluto.android", "com.tubitv",
        )
        private val SKIP_RE = Regex("^\\s*skip(\\s+(ad|ads|intro|recap|credits))?\\s*$", RegexOption.IGNORE_CASE)
        private val AD_RE = Regex("(^|\\b)(ad|advertisement)\\s*(\\d+\\s*of\\s*\\d+)?\\s*(·|•|\\||$)|\\bsponsored\\b|\\bad break\\b", RegexOption.IGNORE_CASE)

        @Volatile var instance: PrismAccessibilityService? = null
        /** Wired by MainActivity: observations flow into core as surface events. */
        @Volatile var events: ((JSONObject) -> Unit)? = null

        val isEnabled: Boolean get() = instance != null
    }
}
