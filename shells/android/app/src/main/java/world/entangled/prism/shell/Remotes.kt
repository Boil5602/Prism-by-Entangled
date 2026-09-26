package world.entangled.prism.shell

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.hardware.input.InputManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.InputDevice
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject

/**
 * Bluetooth remotes (§11) — shell-owned plumbing, zero decisions:
 *
 * - Every key event carries the device's slug so core can apply per-device
 *   overrides (`inputs["device:<slug>"]`). Any number of remotes at once;
 *   last event wins in core.
 * - Pairing: Just-Works HID pairing is the platform's; the shell opens the
 *   system Bluetooth pairing UI (TV and tablet alike) and Android tracks
 *   trusted devices and auto-reconnects natively. Names are editable in
 *   system settings and reflected here.
 * - Battery: reported where the HID battery service exposes it (API 31+);
 *   null otherwise — never guessed.
 */
class Remotes(private val context: Context) {

    /** Stable slug for a device: its user-visible name, lower-kebab. */
    fun slugFor(event: KeyEvent): String? {
        val dev = event.device ?: InputDevice.getDevice(event.deviceId) ?: return null
        if (dev.isVirtual) return null
        return slug(dev.name)
    }

    fun startPairing() {
        try {
            val intent = Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.w(TAG, "no bluetooth settings activity: $e")
        }
    }

    /** Paired HID remotes as `RemoteDeviceInfo[]`. */
    fun list(): JSONArray {
        val out = JSONArray()
        val connectedNames = connectedInputDeviceNames()
        val bonded: Set<BluetoothDevice> = try {
            (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter?.bondedDevices
                ?: BluetoothAdapter.getDefaultAdapter()?.bondedDevices ?: emptySet()
        } catch (e: SecurityException) {
            Log.w(TAG, "bluetooth permission missing: $e")
            emptySet()
        }
        for (d in bonded) {
            val name = try { d.name ?: continue } catch (_: SecurityException) { continue }
            val major = try { d.bluetoothClass?.majorDeviceClass } catch (_: SecurityException) { null }
            if (major != null && major != android.bluetooth.BluetoothClass.Device.Major.PERIPHERAL) continue
            out.put(
                JSONObject()
                    .put("device", slug(name))
                    .put("name", name)
                    .put("connected", connectedNames.contains(name))
                    .put("battery", batteryFor(name) ?: JSONObject.NULL),
            )
        }
        return out
    }

    private fun connectedInputDeviceNames(): Set<String> {
        val im = context.getSystemService(Context.INPUT_SERVICE) as InputManager
        return im.inputDeviceIds.toList().mapNotNull { id -> InputDevice.getDevice(id)?.takeIf { !it.isVirtual }?.name }.toSet()
    }

    private fun batteryFor(name: String): Int? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
        val im = context.getSystemService(Context.INPUT_SERVICE) as InputManager
        for (id in im.inputDeviceIds) {
            val dev = InputDevice.getDevice(id) ?: continue
            if (dev.name != name) continue
            val state = dev.batteryState
            if (!state.isPresent) return null
            val c = state.capacity
            return if (c.isNaN() || c < 0f) null else (c * 100).toInt()
        }
        return null
    }

    companion object {
        private const val TAG = "PrismRemotes"
        fun slug(name: String): String =
            name.trim().lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').ifEmpty { "remote" }
    }
}
