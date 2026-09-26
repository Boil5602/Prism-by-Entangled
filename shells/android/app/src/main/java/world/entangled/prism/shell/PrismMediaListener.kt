package world.entangled.prism.shell

import android.content.ComponentName
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.service.notification.NotificationListenerService
import android.util.Log
import org.json.JSONObject

/**
 * §26 for native apps, second signal: MEDIA SESSIONS. Every app that plays
 * media publishes a session (what the system's Now Playing shows): title,
 * duration, position, state. Reading them needs Android's notification
 * access (a user toggle) — that's the only reason this is a
 * NotificationListenerService; it ignores notifications entirely.
 *
 * Observation only. The spec's own telltale is the duration collapsing
 * from a show's length to an ad's; some players also title the ad item.
 * Transitions are reported as `app-ad-break` for the watched package;
 * core covers slow / uncovers fast. Nothing here presses anything — media
 * sessions expose no Skip, so native apps covered this way have no chip.
 */
class PrismMediaListener : NotificationListenerService() {

    private var manager: MediaSessionManager? = null
    private val callbacks = HashMap<String, MediaController.Callback>()
    private val controllers = HashMap<String, MediaController>()
    /** Per package: last content duration (ms) seen while not in an ad. */
    private val contentDuration = HashMap<String, Long>()
    private val inAd = HashMap<String, Boolean>()

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { list -> rebind(list ?: emptyList()) }

    override fun onListenerConnected() {
        val mgr = getSystemService(MEDIA_SESSION_SERVICE) as MediaSessionManager
        manager = mgr
        val me = ComponentName(this, PrismMediaListener::class.java)
        try {
            mgr.addOnActiveSessionsChangedListener(sessionsListener, me)
            rebind(mgr.getActiveSessions(me))
            Log.i(TAG, "media-session observer connected")
        } catch (e: SecurityException) {
            Log.w(TAG, "notification access not granted: $e")
        }
    }

    override fun onListenerDisconnected() {
        try { manager?.removeOnActiveSessionsChangedListener(sessionsListener) } catch (_: Exception) {}
        for ((pkg, c) in controllers) callbacks[pkg]?.let { c.unregisterCallback(it) }
        controllers.clear(); callbacks.clear()
    }

    private fun rebind(list: List<MediaController>) {
        val wanted = list.filter { it.packageName in PrismAccessibilityService.WATCHED }.associateBy { it.packageName }
        for ((pkg, c) in controllers.toMap()) if (!wanted.containsKey(pkg)) {
            callbacks[pkg]?.let { c.unregisterCallback(it) }
            controllers.remove(pkg); callbacks.remove(pkg)
            if (inAd[pkg] == true) { inAd[pkg] = false; emitAd(pkg, false) } // session gone = doubt = uncover
        }
        for ((pkg, c) in wanted) if (!controllers.containsKey(pkg)) {
            val cb = object : MediaController.Callback() {
                override fun onMetadataChanged(metadata: MediaMetadata?) { evaluate(pkg, metadata, c.playbackState) }
                override fun onPlaybackStateChanged(state: PlaybackState?) { evaluate(pkg, c.metadata, state) }
                override fun onSessionDestroyed() { if (inAd[pkg] == true) { inAd[pkg] = false; emitAd(pkg, false) } }
            }
            c.registerCallback(cb)
            controllers[pkg] = c; callbacks[pkg] = cb
            evaluate(pkg, c.metadata, c.playbackState)
        }
    }

    /**
     * The heuristic, stated plainly so it can be judged: an item that is
     * short (< 2 min) while the previously seen content was long (> 5 min),
     * or whose title reads as an ad, is an ad. Anything else — including a
     * missing duration — is content (uncover fast, cover slow).
     */
    private fun evaluate(pkg: String, md: MediaMetadata?, ps: PlaybackState?) {
        val title = md?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE)
        val duration = md?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: -1L
        val pos = ps?.position ?: -1L
        Log.d(TAG, "session[$pkg] state=${ps?.state} title='${title ?: ""}' duration=${duration}ms pos=${pos}ms")
        val adTitle = title != null && AD_TITLE.containsMatchIn(title)
        val shortItem = duration in 1..120_000
        val hadLongContent = (contentDuration[pkg] ?: 0L) > 300_000
        val ad = adTitle || (shortItem && hadLongContent)
        if (!ad && duration > 300_000) contentDuration[pkg] = duration
        if (ad != (inAd[pkg] ?: false)) {
            inAd[pkg] = ad
            emitAd(pkg, ad)
        }
    }

    private fun emitAd(pkg: String, active: Boolean) {
        Log.i(TAG, "ad-break $active for $pkg (media session)")
        PrismAccessibilityService.events?.invoke(
            JSONObject().put("type", "app-ad-break").put("id", "").put("package", pkg).put("active", active),
        )
    }

    companion object {
        private const val TAG = "PrismMedia"
        private val AD_TITLE = Regex("^\\s*(ad|advertisement|ad break|sponsored)\\b", RegexOption.IGNORE_CASE)
    }
}
