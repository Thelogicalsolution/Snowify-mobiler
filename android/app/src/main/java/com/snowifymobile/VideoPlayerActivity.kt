@file:Suppress("UnsafeOptInUsageError")

package com.snowifymobile

import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.content.res.ColorStateList
import android.graphics.drawable.RippleDrawable
import android.view.View
import android.widget.ImageView
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import android.os.Bundle
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise

// Hands the result of the video screen back to the JS promise that opened it.
object VideoBridge {
    @Volatile private var pending: Promise? = null
    @Volatile private var label: String = ""

    fun begin(promise: Promise, streamLabel: String) {
        val old = pending
        if (old != null) {
            try {
                old.reject("VIDEO_REPLACED", "Another video was opened")
            } catch (e: Exception) {
                // already settled
            }
        }
        pending = promise
        label = streamLabel
    }

    fun finish(positionMs: Long, ended: Boolean, error: String?) {
        val p = pending ?: return
        pending = null
        val map = Arguments.createMap()
        map.putDouble("positionMs", positionMs.toDouble())
        map.putBoolean("ended", ended)
        map.putString("error", error)
        map.putString("label", label)
        p.resolve(map)
    }
}

// Full-screen ad-free video player: a video stream and an audio stream merged by ExoPlayer.
class VideoPlayerActivity : Activity() {
    private var player: ExoPlayer? = null
    private var playerView: PlayerView? = null
    private var closed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        val videoUrl = intent.getStringExtra("videoUrl") ?: ""
        val audioUrl = intent.getStringExtra("audioUrl") ?: ""
        val startMs = intent.getLongExtra("startMs", 0L)
        if (videoUrl.isEmpty()) {
            closeWith(false, "No video address")
            return
        }

        val view = PlayerView(this)
        view.setBackgroundColor(Color.BLACK)
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        // A back arrow that shows and hides together with the player controls.
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        root.addView(
            view,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )

        val density = resources.displayMetrics.density
        val buttonSize = (48 * density).toInt()
        val margin = (12 * density).toInt()
        val back = ImageView(this)
        back.setImageResource(R.drawable.ic_video_back)
        back.scaleType = ImageView.ScaleType.CENTER_INSIDE
        val pad = (12 * density).toInt()
        back.setPadding(pad, pad, pad, pad)
        back.contentDescription = "Back"
        val circle = GradientDrawable()
        circle.shape = GradientDrawable.OVAL
        circle.setColor(Color.argb(120, 0, 0, 0))
        val mask = GradientDrawable()
        mask.shape = GradientDrawable.OVAL
        mask.setColor(Color.BLACK)
        back.background = RippleDrawable(ColorStateList.valueOf(Color.argb(70, 255, 255, 255)), circle, mask)
        back.setOnClickListener { closeWith(false, null) }
        val backParams = FrameLayout.LayoutParams(buttonSize, buttonSize, Gravity.TOP or Gravity.START)
        backParams.setMargins(margin, margin, margin, margin)
        root.addView(back, backParams)

        // Keep the arrow clear of the status bar area and camera cut-outs.
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            backParams.setMargins(margin + safe.left, margin + safe.top, margin, margin)
            back.layoutParams = backParams
            insets
        }

        // The arrow follows the controller: visible when the controls are, hidden when they hide.
        view.setControllerVisibilityListener(
            PlayerView.ControllerVisibilityListener { visibility ->
                back.animate().cancel()
                if (visibility == View.VISIBLE) {
                    back.visibility = View.VISIBLE
                    back.animate().alpha(1f).setDuration(200).start()
                } else {
                    back.animate().alpha(0f).setDuration(200).withEndAction { back.visibility = View.GONE }.start()
                }
            }
        )

        // Locked orientation: portrait by default, the fullscreen button flips between locked landscape and locked portrait.
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        view.setFullscreenButtonClickListener { isFullScreen ->
            requestedOrientation = if (isFullScreen) {
                ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            } else {
                ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            }
        }

        setContentView(root)
        ViewCompat.requestApplyInsets(root)
        playerView = view
        hideBars()

        val factory = DefaultHttpDataSource.Factory()
            .setUserAgent(USER_AGENT)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(15000)
            .setAllowCrossProtocolRedirects(true)
        val sources = ProgressiveMediaSource.Factory(factory)
        val videoSource = sources.createMediaSource(MediaItem.fromUri(videoUrl))
        val source = if (audioUrl.isNotEmpty()) {
            MergingMediaSource(videoSource, sources.createMediaSource(MediaItem.fromUri(audioUrl)))
        } else {
            videoSource
        }

        val exo = ExoPlayer.Builder(this).build()
        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) closeWith(true, null)
            }

            override fun onPlayerError(error: PlaybackException) {
                closeWith(false, "${error.errorCodeName}: ${error.cause?.message ?: error.message}")
            }
        })
        exo.setMediaSource(source)
        if (startMs > 0) exo.seekTo(startMs)
        exo.prepare()
        exo.playWhenReady = true
        view.player = exo
        player = exo
    }

    private fun hideBars() {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideBars()
    }

    private fun closeWith(ended: Boolean, error: String?) {
        if (closed) return
        closed = true
        val position = player?.currentPosition ?: 0L
        playerView?.player = null
        player?.release()
        player = null
        VideoBridge.finish(position, ended, error)
        if (!isFinishing) finish()
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations) closeWith(false, null)
    }

    override fun onDestroy() {
        super.onDestroy()
        closeWith(false, null)
    }

    companion object {
        private const val USER_AGENT =
            "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    }
}