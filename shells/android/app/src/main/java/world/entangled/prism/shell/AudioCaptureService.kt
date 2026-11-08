package world.entangled.prism.shell

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Private listening capture (§14) — the ONE capture mix on Android.
 *
 * AudioPlaybackCapture (API 29+) records the device's media playback — our
 * WebViews are our audio session, so every web tile is captured. Launched
 * native apps that opt out of capture (DRM players) are not; that limit is
 * documented, not hidden. The mix is encoded once (AAC-LC, ADTS framing)
 * and fanned out to every subscriber: today the chunked HTTP stream, later
 * the WebRTC sender — both feed from this one capture.
 *
 * Runs as a foreground service (required for MediaProjection) with a
 * quiet notification. Core decides when capture starts and stops.
 */
class AudioCaptureService : Service() {

    private var projection: MediaProjection? = null
    private var record: AudioRecord? = null
    private var codec: MediaCodec? = null
    private var worker: Thread? = null
    @Volatile private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopCapture()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                startForegroundQuietly()
                val code = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                @Suppress("DEPRECATION")
                val data = intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
                if (data == null) {
                    Log.w(TAG, "no projection result; stopping")
                    stopSelf()
                    return START_NOT_STICKY
                }
                startCapture(code, data)
            }
        }
        return START_NOT_STICKY
    }

    private fun startForegroundQuietly() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Private listening", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Frame audio is streaming to a paired phone"
                },
            )
        }
        val notification: Notification = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this))
            .setContentTitle("Private listening")
            .setContentText("Frame audio is streaming to a paired phone")
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun startCapture(resultCode: Int, data: Intent) {
        if (running) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Log.w(TAG, "AudioPlaybackCapture needs API 29+")
            stopSelf()
            return
        }
        try {
            val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val proj = mpm.getMediaProjection(resultCode, data) ?: throw IllegalStateException("projection denied")
            projection = proj
            val config = AudioPlaybackCaptureConfiguration.Builder(proj)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()
            val format = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build()
            val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT)
            val rec = AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(maxOf(minBuf * 4, 65536))
                .setAudioPlaybackCaptureConfig(config)
                .build()
            record = rec

            val enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            val mf = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, 2).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 65536)
            }
            enc.configure(mf, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec = enc

            running = true
            rec.startRecording()
            enc.start()
            worker = Thread({ pump(rec, enc) }, "prism-audio-capture").also { it.start() }
            AudioHub.capturing = true
            Log.i(TAG, "capture started (${SAMPLE_RATE}Hz stereo → AAC ${BITRATE / 1000}kbps)")
        } catch (e: Exception) {
            Log.e(TAG, "capture failed: $e")
            stopCapture()
            stopSelf()
        }
    }

    /** PCM in → AAC out → ADTS frames to every subscriber. */
    private fun pump(rec: AudioRecord, enc: MediaCodec) {
        val pcm = ByteArray(4096)
        val info = MediaCodec.BufferInfo()
        while (running) {
            val n = rec.read(pcm, 0, pcm.size)
            if (n > 0) {
                val inIdx = enc.dequeueInputBuffer(10_000)
                if (inIdx >= 0) {
                    val buf = enc.getInputBuffer(inIdx) ?: continue
                    buf.clear()
                    buf.put(pcm, 0, n)
                    enc.queueInputBuffer(inIdx, 0, n, System.nanoTime() / 1000, 0)
                }
            }
            var outIdx = enc.dequeueOutputBuffer(info, 0)
            while (outIdx >= 0) {
                val out = enc.getOutputBuffer(outIdx)
                if (out != null && info.size > 0 && (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                    val frame = ByteArray(info.size + 7)
                    writeAdtsHeader(frame, info.size + 7)
                    out.position(info.offset)
                    out.get(frame, 7, info.size)
                    AudioHub.broadcast(frame)
                }
                enc.releaseOutputBuffer(outIdx, false)
                outIdx = enc.dequeueOutputBuffer(info, 0)
            }
        }
    }

    /** ADTS header for AAC-LC, 48kHz (index 3), stereo (channel config 2). */
    private fun writeAdtsHeader(p: ByteArray, packetLen: Int) {
        val profile = 2 // AAC LC
        val freqIdx = 3 // 48000
        val chanCfg = 2
        p[0] = 0xFF.toByte()
        p[1] = 0xF9.toByte()
        p[2] = (((profile - 1) shl 6) + (freqIdx shl 2) + (chanCfg shr 2)).toByte()
        p[3] = (((chanCfg and 3) shl 6) + (packetLen shr 11)).toByte()
        p[4] = ((packetLen and 0x7FF) shr 3).toByte()
        p[5] = (((packetLen and 7) shl 5) + 0x1F).toByte()
        p[6] = 0xFC.toByte()
    }

    private fun stopCapture() {
        running = false
        AudioHub.capturing = false
        try { worker?.join(1000) } catch (_: InterruptedException) {}
        worker = null
        try { record?.stop() } catch (_: Exception) {}
        try { record?.release() } catch (_: Exception) {}
        record = null
        try { codec?.stop() } catch (_: Exception) {}
        try { codec?.release() } catch (_: Exception) {}
        codec = null
        try { projection?.stop() } catch (_: Exception) {}
        projection = null
        AudioHub.closeAll()
        Log.i(TAG, "capture stopped")
    }

    override fun onDestroy() {
        stopCapture()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "PrismAudio"
        private const val CHANNEL = "prism-listening"
        private const val NOTIFICATION_ID = 1471
        const val ACTION_START = "world.entangled.prism.AUDIO_START"
        const val ACTION_STOP = "world.entangled.prism.AUDIO_STOP"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val SAMPLE_RATE = 48_000
        const val BITRATE = 128_000
    }
}

/**
 * Fan-out of the encoded mix to transport subscribers. A subscriber whose
 * socket fails is dropped and its listener id reported — that is the §14
 * "unexpected loss" signal that keeps the frame's speakers muted (grace).
 */
object AudioHub {
    class Subscriber(val listener: String, val out: OutputStream)

    @Volatile var capturing = false
    var onLost: ((listener: String) -> Unit)? = null
    private val subscribers = CopyOnWriteArrayList<Subscriber>()

    fun subscribe(s: Subscriber) { subscribers.add(s) }
    fun unsubscribe(s: Subscriber) { subscribers.remove(s) }
    fun count(): Int = subscribers.size

    fun broadcast(frame: ByteArray) {
        for (s in subscribers) {
            try {
                s.out.write(frame)
                s.out.flush()
            } catch (_: IOException) {
                subscribers.remove(s)
                try { s.out.close() } catch (_: Exception) {}
                onLost?.invoke(s.listener)
            }
        }
    }

    fun closeAll() {
        for (s in subscribers) try { s.out.close() } catch (_: Exception) {}
        subscribers.clear()
    }
}
