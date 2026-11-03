package com.snowifymobile

import android.content.Intent
import android.net.Uri
import android.os.Bundle

import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "SnowifyMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  // A link shared from a browser or another app arrives as ACTION_SEND text. React Native only passes
  // VIEW intents to Linking, so turn the shared link into a VIEW intent before React sees it.
  private fun shareToView(i: Intent?): Intent? {
    if (i == null || i.action != Intent.ACTION_SEND) return i
    val text = i.getStringExtra(Intent.EXTRA_TEXT) ?: return i
    val found = Regex("https?://\\S+").find(text) ?: return i
    val copy = Intent(i)
    copy.action = Intent.ACTION_VIEW
    copy.data = Uri.parse(found.value)
    return copy
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    setIntent(shareToView(intent))
    super.onCreate(savedInstanceState)
  }

  override fun onNewIntent(intent: Intent?) {
    val fixed = shareToView(intent)
    setIntent(fixed)
    super.onNewIntent(fixed)
  }
  // Hide the status bar and navigation buttons; swiping from the top or bottom edge shows them again for a moment.
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideNavigationBar()
  }

  private fun hideNavigationBar() {
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(WindowInsetsCompat.Type.systemBars())
  }
}
