package world.entangled.prism.shell

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Update driver (§28). Core decides when to check and when to install;
 * this class only moves bytes:
 *
 * - fetchManifest: GET exactly the URL core hands over. No query string,
 *   no cookies, no identifying headers — the request reveals nothing but
 *   "someone checked" (§22).
 * - apply: download the signed APK, verify its SHA-256 when the manifest
 *   carries one, and stage it through PackageInstaller. As device owner
 *   the install is silent; otherwise the system will ask, which core treats
 *   as "staged" (nothing happens until someone confirms). §10 storage is
 *   untouched by an in-place update.
 */
class Updater(private val context: Context) {

    fun fetchManifest(url: String, done: (String?, String?) -> Unit) {
        Thread {
            var conn: HttpURLConnection? = null
            try {
                val u = URL(url)
                require(u.query == null && u.ref == null) { "manifest URL must be unparameterized" }
                conn = (u.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15_000
                    readTimeout = 15_000
                    useCaches = false
                    setRequestProperty("User-Agent", "Prism") // no version, no device
                    setRequestProperty("Accept", "application/json")
                }
                val code = conn.responseCode
                if (code != 200) throw IllegalStateException("HTTP $code")
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                done(text, null)
            } catch (e: Exception) {
                Log.w(TAG, "manifest fetch failed: $e")
                done(null, e.toString())
            } finally {
                conn?.disconnect()
            }
        }.start()
    }

    fun apply(release: JSONObject, done: (String) -> Unit) {
        val url = release.optString("url", "")
        if (url.isEmpty()) return done("failed")
        Thread {
            try {
                val file = File(context.cacheDir, "prism-update.apk")
                downloadTo(url, file)
                val expected = release.optString("sha256", "")
                if (expected.isNotEmpty() && !sha256(file).equals(expected, ignoreCase = true)) {
                    file.delete()
                    throw IllegalStateException("sha256 mismatch")
                }
                stage(file)
                done("staged")
            } catch (e: Exception) {
                Log.e(TAG, "update apply failed: $e")
                done("failed")
            }
        }.start()
    }

    private fun downloadTo(url: String, file: File) {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("User-Agent", "Prism")
        }
        try {
            if (conn.responseCode != 200) throw IllegalStateException("HTTP ${conn.responseCode}")
            conn.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
        } finally {
            conn.disconnect()
        }
    }

    private fun stage(file: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("prism.apk", 0, file.length()).use { out ->
                file.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val intent = Intent(context, MainActivity::class.java).setAction(ACTION_INSTALLED)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            session.commit(PendingIntent.getActivity(context, sessionId, intent, flags).intentSender)
        }
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(65536)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        private const val TAG = "PrismUpdate"
        const val ACTION_INSTALLED = "world.entangled.prism.UPDATE_INSTALLED"
    }
}
