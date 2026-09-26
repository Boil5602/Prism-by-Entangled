package world.entangled.prism.shell

import android.content.Context
import android.content.SharedPreferences

/**
 * Store driver (§10, §23). Backing for core's persisted state (hero overrides
 * etc.). This store — and every WebView profile — is NEVER cleared by the
 * shell for any reason: no wipe on update, migration, crash, or reboot.
 * Storage formats that change must migrate, never reset.
 */
class PrismStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("prism-store", Context.MODE_PRIVATE)

    /** Synchronous read — called from the JS bridge thread; prefs are thread-safe. */
    fun get(key: String): String? = prefs.getString(key, null)

    fun set(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }
}
