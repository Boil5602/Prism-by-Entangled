package world.entangled.prism.shell

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Content blocking (§5) — a shell feature, network-level, organized as named
 * categories each bound to an ATTRIBUTED upstream list. Nothing here is a
 * judgment of the shell's own: every blocked host traces to a list the user
 * can see (name, maintainer, URL, license, sync date, entry count) and
 * disable. Per-tile toggle comes from core (`blocking` in surface.create).
 *
 * Asset layout (`assets/blocklists/`):
 *   sources.json            — [{ id, name, maintainer, url, license, syncedAt, default, hosts, cosmetic? }]
 *   <id>.hosts              — one hostname per line (# comments); subdomains match by suffix
 *   easylist-cosmetic.txt   — ABP element-hiding rules handed to core for the §27 veil
 *
 * Lists sync independently of shell releases (§5); the bundled copies are
 * the offline baseline.
 */
class BlockList(context: Context, private val store: PrismStore) {

    class Source(
        val id: String,
        val name: String,
        val maintainer: String,
        val url: String,
        val license: String,
        val syncedAt: String,
        val defaultOn: Boolean,
        val hosts: Set<String>,
        val cosmeticAsset: String?,
        /** Upstream wire format (§5 sync): "abp" or "hosts". */
        val format: String,
    )

    val sources: List<Source>
    private val assets = context.assets
    /** Source id → hosts asset name (for bundled baseline text handed to core). */
    private val hostsAssets = mutableMapOf<String, String>()

    init {
        sources = try {
            val arr = JSONArray(assets.open("blocklists/sources.json").bufferedReader().use { it.readText() })
            (0 until arr.length()).map { i ->
                val s = arr.getJSONObject(i)
                Source(
                    id = s.getString("id"),
                    name = s.getString("name"),
                    maintainer = s.optString("maintainer", "unknown"),
                    url = s.optString("url", ""),
                    license = s.optString("license", "unknown"),
                    syncedAt = s.optString("syncedAt", "unknown"),
                    defaultOn = s.optBoolean("default", true),
                    hosts = readHosts(s.optString("hosts", "")),
                    cosmeticAsset = if (s.has("cosmetic")) s.getString("cosmetic") else null,
                    format = s.optString("format", if (s.has("cosmetic")) "abp" else "hosts"),
                ).also { src -> if (s.has("hosts")) hostsAssets[src.id] = s.getString("hosts") }
            }
        } catch (e: Exception) {
            Log.w(TAG, "no blocklists bundled: $e")
            emptyList()
        }
        Log.i(TAG, "blocklists: " + sources.joinToString { "${it.name}(${it.hosts.size})" })
    }

    /** User choice per category persists in the §10 store; default from the source. */
    fun isEnabled(source: Source): Boolean =
        store.get("blocking:${source.id}")?.let { it == "on" } ?: source.defaultOn

    fun setEnabled(id: String, on: Boolean) = store.set("blocking:$id", if (on) "on" else "off")

    /**
     * The source that blocks this host, or null. Suffix match on labels so
     * `ads.example.com` matches an `example.com` entry; the blocked-request
     * log names the list (§5: "whose judgment").
     */
    fun blockedBy(host: String?): Source? {
        if (host.isNullOrEmpty()) return null
        val h = host.lowercase()
        for (src in sources) {
            if (!isEnabled(src)) continue
            var probe = h
            while (true) {
                if (src.hosts.contains(probe)) return src
                val dot = probe.indexOf('.')
                if (dot < 0) break
                probe = probe.substring(dot + 1)
            }
        }
        return null
    }

    /** Synced host sets pushed by core (`net.applyBlockHosts`); they replace the bundled set per source. */
    private val synced = mutableMapOf<String, Pair<String, Set<String>>>()

    fun applySynced(id: String, name: String, hosts: List<String>) {
        synced[id] = name to hosts.toHashSet()
        Log.i(TAG, "list '$name' applied: ${hosts.size} hosts")
    }

    /**
     * Fast path used by every request: core-synced set wins, bundled set is
     * the offline baseline, category enable comes from the same store key
     * core writes (`blocking:<id>`).
     */
    fun blockedByAny(host: String?): String? {
        if (host.isNullOrEmpty()) return null
        val h = host.lowercase()
        for (src in sources) {
            val entry = synced[src.id]
            val hosts = entry?.second ?: run { if (!isEnabled(src)) return@run null; src.hosts } ?: continue
            if (entry == null && !isEnabled(src)) continue
            var probe = h
            while (true) {
                if (hosts.contains(probe)) return entry?.first ?: src.name
                val dot = probe.indexOf('.')
                if (dot < 0) break
                probe = probe.substring(dot + 1)
            }
        }
        return null
    }

    /** §5 source specs for core (`BlockSourceSpec[]`), carrying bundled baseline text. */
    fun sourceSpecsJson(): JSONArray {
        val out = JSONArray()
        for (src in sources) {
            val spec = JSONObject()
                .put("id", src.id)
                .put("name", src.name)
                .put("maintainer", src.maintainer)
                .put("url", src.url)
                .put("license", src.license)
                .put("format", src.format)
                .put("defaultOn", src.defaultOn)
                .put("bundledSyncedAt", src.syncedAt)
            // Bundled baseline in the source's own wire format: ABP sources get
            // their cosmetic rules plus the hosts baseline as ||host^ lines;
            // hosts sources carry the hosts file verbatim.
            val bundled = StringBuilder()
            val hostsAsset = hostsAssetOf(src)
            if (src.format == "abp") {
                bundled.append("[Adblock Plus 2.0]\n")
                src.cosmeticAsset?.let { asset ->
                    try { bundled.append(assets.open("blocklists/$asset").bufferedReader().use { it.readText() }).append('\n') } catch (_: Exception) {}
                }
                for (h in src.hosts) bundled.append("||").append(h).append("^\n")
            } else if (hostsAsset != null) {
                try { bundled.append(assets.open("blocklists/$hostsAsset").bufferedReader().use { it.readText() }) } catch (_: Exception) {}
            }
            if (bundled.isNotEmpty()) spec.put("bundled", bundled.toString())
            out.put(spec)
        }
        return out
    }

    private fun hostsAssetOf(src: Source): String? = hostsAssets[src.id]

    /** §27: attributed cosmetic sources for core, as `CosmeticSourceSpec[]` JSON. */
    fun cosmeticSourcesJson(): JSONArray {
        val out = JSONArray()
        for (src in sources) {
            val asset = src.cosmeticAsset ?: continue
            if (!isEnabled(src)) continue
            val text = try {
                assets.open("blocklists/$asset").bufferedReader().use { it.readText() }
            } catch (_: Exception) { continue }
            out.put(
                JSONObject()
                    .put(
                        "attribution",
                        JSONObject()
                            .put("name", src.name)
                            .put("maintainer", src.maintainer)
                            .put("url", src.url)
                            .put("license", src.license)
                            .put("syncedAt", src.syncedAt),
                    )
                    .put("text", text),
            )
        }
        return out
    }

    private fun readHosts(asset: String): Set<String> {
        if (asset.isEmpty()) return emptySet()
        return try {
            assets.open("blocklists/$asset").bufferedReader().useLines { lines ->
                lines.map { it.substringBefore('#').trim().lowercase() }
                    .filter { it.isNotEmpty() }
                    .map { line ->
                        // Accept plain hosts and hosts-file style "0.0.0.0 host".
                        val parts = line.split(Regex("\\s+"))
                        if (parts.size >= 2 && parts[0].all { c -> c.isDigit() || c == '.' }) parts[1] else parts[0]
                    }
                    .toSet()
            }
        } catch (e: Exception) {
            Log.w(TAG, "hosts asset $asset unreadable: $e")
            emptySet()
        }
    }

    companion object {
        private const val TAG = "PrismBlock"
    }
}
