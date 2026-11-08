package world.entangled.prism.shell

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView

/**
 * §26 intermission scenery over a NATIVE app (a §12 launch tile in the
 * foreground). Prism's own window is behind the app, so the scenery is a
 * system overlay window ("draw over other apps", a user toggle). Shows
 * pack imagery and the glyph; the real Skip chip appears only while the
 * observer reports the app's skip affordance, and a press on it is the
 * human's — forwarded by core to the app's control. Nothing here times,
 * clicks, or dismisses anything on its own.
 */
class AppOverlay(private val context: Context, private val onSkip: () -> Unit) {
    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private var view: FrameLayout? = null
    private var chip: TextView? = null

    val canDraw: Boolean get() = Settings.canDrawOverlays(context)

    fun show(source: String) {
        if (view != null) return
        if (!canDraw) {
            Log.w(TAG, "overlay permission not granted — intermission over apps is off")
            return
        }
        val layout = FrameLayout(context).apply {
            background = imagery(source)
            addView(
                TextView(context).apply {
                    text = "◐ intermission"
                    setTextColor(0x66D7DCE3)
                    textSize = 13f
                },
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.BOTTOM or Gravity.END,
                ).apply { setMargins(0, 0, 24, 18) },
            )
            isFocusableInTouchMode = true
            isFocusable = true
            // OK/Enter on the TV remote = the human pressing the chip; Back = nothing here
            // (leaving the overlay is core's uncover; the app underneath keeps focus semantics).
            setOnKeyListener { _, code, ev ->
                if (ev.action == KeyEvent.ACTION_DOWN && (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER) && chip != null) {
                    onSkip(); true
                } else false
            }
            alpha = 0f
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, type,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        )
        try {
            wm.addView(layout, lp)
            view = layout
            layout.animate().alpha(1f).setDuration(400).start()
            layout.requestFocus()
        } catch (e: Exception) {
            Log.e(TAG, "overlay failed: $e")
        }
    }

    fun hide() {
        val v = view ?: return
        view = null
        chip = null
        v.animate().alpha(0f).setDuration(200).withEndAction {
            try { wm.removeView(v) } catch (_: Exception) {}
        }.start()
    }

    fun setSkip(available: Boolean) {
        val v = view ?: return
        if (!available) {
            chip?.let { v.removeView(it) }
            chip = null
            return
        }
        if (chip != null) return
        val c = TextView(context).apply {
            text = "Skip  ✓   (OK)"
            setTextColor(0xFF0A0C0F.toInt())
            textSize = 16f
            setPadding(36, 18, 36, 18)
            background = GradientDrawable().apply { cornerRadius = 40f; setColor(0xFFF0A83C.toInt()) }
            isClickable = true
            setOnClickListener { onSkip() }
        }
        chip = c
        v.addView(
            c,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START)
                .apply { setMargins(28, 0, 0, 22) },
        )
    }

    /** First image of the named pack from assets, else a pack-flavoured gradient. */
    private fun imagery(source: String): android.graphics.drawable.Drawable {
        val pack = source.removePrefix("pack:")
        try {
            val files = context.assets.list("packs/$pack").orEmpty().filter { it.matches(Regex(".*\\.(jpe?g|png|webp)$", RegexOption.IGNORE_CASE)) }
            if (files.isNotEmpty()) {
                val pick = files[(System.nanoTime() % files.size).toInt().let { if (it < 0) -it else it }]
                context.assets.open("packs/$pack/$pick").use { stream ->
                    val bmp = BitmapFactory.decodeStream(stream)
                    if (bmp != null) return BitmapDrawable(context.resources, bmp).apply { gravity = Gravity.FILL; setTargetDensity(context.resources.displayMetrics) }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "pack '$pack' unreadable: $e")
        }
        val colors = if (source.contains("nature")) intArrayOf(0xFF12241A.toInt(), 0xFF060D08.toInt()) else intArrayOf(0xFF141B33.toInt(), 0xFF05070F.toInt())
        return GradientDrawable(GradientDrawable.Orientation.TL_BR, colors)
    }

    companion object {
        private const val TAG = "PrismOverlay"
    }
}
