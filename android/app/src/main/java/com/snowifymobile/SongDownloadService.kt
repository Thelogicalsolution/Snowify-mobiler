package com.snowifymobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder
import android.os.StatFs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

// The song download queue, saved in a file so it survives the app being closed.
object SongDownloads {
    private const val FILE_NAME = "song_queue.json"
    private val lock = Any()

    private fun queueFile(ctx: Context): File = File(ctx.filesDir, FILE_NAME)

    private fun emptyRoot(): JSONObject {
        val root = JSONObject()
        root.put("lang", "en")
        root.put("items", JSONArray())
        return root
    }

    private fun load(ctx: Context): JSONObject {
        return try {
            val f = queueFile(ctx)
            if (f.exists()) JSONObject(f.readText()) else emptyRoot()
        } catch (e: Exception) {
            emptyRoot()
        }
    }

    private fun save(ctx: Context, root: JSONObject) {
        val tmp = File(ctx.filesDir, "$FILE_NAME.tmp")
        tmp.writeText(root.toString())
        if (!tmp.renameTo(queueFile(ctx))) {
            queueFile(ctx).writeText(root.toString())
            tmp.delete()
        }
    }

    private fun indexOfUrl(items: JSONArray, url: String): Int {
        for (i in 0 until items.length()) {
            if (items.getJSONObject(i).optString("url") == url) return i
        }
        return -1
    }

    private fun update(ctx: Context, url: String, change: (JSONObject) -> Unit) {
        synchronized(lock) {
            val root = load(ctx)
            val items = root.getJSONArray("items")
            val at = indexOfUrl(items, url)
            if (at >= 0) {
                change(items.getJSONObject(at))
                save(ctx, root)
            }
        }
    }

    private fun count(ctx: Context, vararg states: String): Int {
        return synchronized(lock) {
            val items = load(ctx).getJSONArray("items")
            var n = 0
            for (i in 0 until items.length()) {
                if (items.getJSONObject(i).optString("state") in states) n++
            }
            n
        }
    }

    fun openCount(ctx: Context): Int = count(ctx, "pending", "active")

    fun pendingCount(ctx: Context): Int = count(ctx, "pending")

    fun lang(ctx: Context): String {
        return synchronized(lock) { load(ctx).optString("lang", "en") }
    }

    fun snapshot(ctx: Context): String {
        return synchronized(lock) { load(ctx).getJSONArray("items").toString() }
    }

    fun enqueue(ctx: Context, newItems: JSONArray, quality: String, lang: String): Int {
        return synchronized(lock) {
            val root = load(ctx)
            root.put("lang", lang)
            val items = root.getJSONArray("items")
            var added = 0
            for (i in 0 until newItems.length()) {
                val src = newItems.getJSONObject(i)
                val url = src.optString("url", "")
                if (url.isEmpty()) continue
                val at = indexOfUrl(items, url)
                if (at >= 0) {
                    val state = items.getJSONObject(at).optString("state")
                    if (state == "pending" || state == "active" || state == "done") continue
                    items.remove(at)
                }
                val item = JSONObject()
                item.put("url", url)
                item.put("name", src.optString("name", ""))
                item.put("thumbnailUrl", src.optString("thumbnailUrl", ""))
                item.put("quality", quality)
                item.put("state", "pending")
                item.put("path", "")
                item.put("bytes", 0)
                item.put("error", "")
                item.put("tries", 0)
                items.put(item)
                added++
            }
            save(ctx, root)
            added
        }
    }

    fun claimNext(ctx: Context): JSONObject? {
        return synchronized(lock) {
            val root = load(ctx)
            val items = root.getJSONArray("items")
            var found: JSONObject? = null
            for (i in 0 until items.length()) {
                val o = items.getJSONObject(i)
                if (o.optString("state") == "pending") {
                    o.put("state", "active")
                    save(ctx, root)
                    found = JSONObject(o.toString())
                    break
                }
            }
            found
        }
    }

    fun markDone(ctx: Context, url: String, path: String, bytes: Long) {
        update(ctx, url) {
            it.put("state", "done")
            it.put("path", path)
            it.put("bytes", bytes)
            it.put("error", "")
        }
    }

    fun requeue(ctx: Context, url: String, tries: Int, error: String) {
        update(ctx, url) {
            it.put("state", "pending")
            it.put("tries", tries)
            it.put("error", error)
        }
    }

    fun markFailed(ctx: Context, url: String, tries: Int, error: String) {
        update(ctx, url) {
            it.put("state", "failed")
            it.put("tries", tries)
            it.put("error", error)
        }
    }

    // Removes finished and failed entries once the app has recorded them.
    fun ack(ctx: Context, urls: JSONArray) {
        synchronized(lock) {
            val drop = HashSet<String>()
            for (i in 0 until urls.length()) drop.add(urls.optString(i))
            val root = load(ctx)
            val items = root.getJSONArray("items")
            val keep = JSONArray()
            for (i in 0 until items.length()) {
                val o = items.getJSONObject(i)
                val state = o.optString("state")
                val finished = state == "done" || state == "failed"
                if (!(finished && drop.contains(o.optString("url")))) keep.put(o)
            }
            root.put("items", keep)
            save(ctx, root)
        }
    }

    // Drops everything that has not finished; finished entries stay so the app can record them.
    fun cancelAll(ctx: Context) {
        synchronized(lock) {
            val root = load(ctx)
            val items = root.getJSONArray("items")
            val keep = JSONArray()
            for (i in 0 until items.length()) {
                val o = items.getJSONObject(i)
                val state = o.optString("state")
                if (state == "done" || state == "failed") keep.put(o)
            }
            root.put("items", keep)
            save(ctx, root)
        }
    }

    // After a crash or a kill, anything that was mid-download starts again.
    fun recover(ctx: Context) {
        synchronized(lock) {
            val root = load(ctx)
            val items = root.getJSONArray("items")
            for (i in 0 until items.length()) {
                val o = items.getJSONObject(i)
                if (o.optString("state") == "active") o.put("state", "pending")
            }
            save(ctx, root)
        }
    }
}

class SongDownloadService : Service() {

    companion object {
        const val ACTION_CANCEL = "com.snowifymobile.CANCEL_SONG_DOWNLOADS"
        private const val CHANNEL_ID = "song_downloads"
        private const val NOTIF_ID = 4201
        private const val DONE_NOTIF_ID = 4202
        private const val USER_AGENT =
            "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

        @Volatile
        var running = false

        fun start(ctx: Context) {
            val intent = Intent(ctx, SongDownloadService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent) else ctx.startService(intent)
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .build()
    private val activeCalls = ConcurrentHashMap.newKeySet<Call>()
    private val doneCount = AtomicInteger(0)
    private val failCount = AtomicInteger(0)

    @Volatile
    private var stopRequested = false

    @Volatile
    private var userCancelled = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createChannel()
        goForeground()
        if (intent?.action == ACTION_CANCEL) {
            userCancelled = true
            stopRequested = true
            SongDownloads.cancelAll(this)
            for (c in activeCalls) c.cancel()
            if (!running) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            return START_NOT_STICKY
        }
        if (!running) {
            running = true
            stopRequested = false
            userCancelled = false
            doneCount.set(0)
            failCount.set(0)
            scope.launch { runQueue() }
        }
        return START_NOT_STICKY
    }

    // Android 15: dataSync services get a total of 6 hours; stop quickly when the system says so.
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopRequested = true
        for (c in activeCalls) c.cancel()
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun runQueue() {
        try {
            try {
                NewPipe.init(
                    OkHttpDownloader.getInstance(),
                    Localization("en", "US"),
                    ContentCountry("US")
                )
            } catch (e: Exception) {
                // already initialized
            }
            SongDownloads.recover(this)
            while (!stopRequested) {
                coroutineScope {
                    repeat(2) { launch { worker() } }
                }
                if (stopRequested || SongDownloads.pendingCount(this) == 0) break
            }
        } catch (e: Exception) {
            // fall through to cleanup
        } finally {
            finishRun()
        }
    }

    private fun finishRun() {
        running = false
        val done = doneCount.get()
        val failed = failCount.get()
        if (!userCancelled && !stopRequested && done + failed > 0) postFinished(done, failed)
        stopForeground(Service.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private suspend fun worker() {
        while (!stopRequested) {
            val item = SongDownloads.claimNext(this) ?: return
            val url = item.getString("url")
            val tries = item.optInt("tries", 0)
            publish()
            try {
                val result = downloadOne(item)
                SongDownloads.markDone(this, url, result.first, result.second)
                doneCount.incrementAndGet()
            } catch (e: Exception) {
                if (userCancelled) {
                    // the item was already removed from the queue
                } else if (stopRequested) {
                    SongDownloads.requeue(this, url, tries, "")
                } else if (tries + 1 < 3) {
                    SongDownloads.requeue(this, url, tries + 1, e.message ?: "error")
                    delay(3000)
                } else {
                    SongDownloads.markFailed(this, url, tries + 1, e.message ?: "error")
                    failCount.incrementAndGet()
                }
            }
            publish()
        }
    }

    private fun downloadOne(item: JSONObject): Pair<String, Long> {
        val url = item.getString("url")
        val quality = item.optString("quality", "best")
        val info = StreamInfo.getInfo(ServiceList.YouTube, url)
        val audio = pickAudioStream(info.audioStreams, quality)
            ?: throw IOException("No audio stream")
        val dir = File(filesDir, "songs")
        dir.mkdirs()
        val key = Integer.toHexString(url.hashCode())
        val suffix = audio.format?.suffix ?: "m4a"
        val finalFile = File(dir, "sg_" + key + "." + suffix)
        val part = File(dir, "sg_" + key + ".part")
        if (finalFile.exists() && finalFile.length() > 0) {
            return Pair(finalFile.absolutePath, finalFile.length())
        }
        try {
            val size = probeSize(audio.content)
            if (size > 0) {
                val free = StatFs(dir.absolutePath).availableBytes
                if (free < size + 50L * 1024 * 1024) throw IOException("Not enough free space")
            }
            downloadToFile(audio.content, part)
            if (stopRequested) throw IOException("stopped")
            if (part.length() <= 0L) throw IOException("Empty file")
            if (size > 0 && part.length() < size) throw IOException("Download incomplete")
            if (!part.renameTo(finalFile)) throw IOException("Could not save the file")
        } catch (e: Exception) {
            part.delete()
            throw e
        }
        return Pair(finalFile.absolutePath, finalFile.length())
    }

    private fun pickAudioStream(streams: List<AudioStream>, quality: String): AudioStream? {
        if (streams.isEmpty()) {
            return null
        }
        val withBitrate = streams.filter { it.averageBitrate > 0 }
        val candidates = if (withBitrate.isNotEmpty()) withBitrate else streams
        val sorted = candidates.sortedBy { it.averageBitrate }
        return when (quality) {
            "low" -> sorted.first()
            "balanced" -> sorted[(sorted.size - 1) / 2]
            else -> sorted.last()
        }
    }

    private fun probeSize(url: String): Long {
        return try {
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", USER_AGENT)
                .header("Range", "bytes=0-0")
                .build()
            httpClient.newCall(request).execute().use { r ->
                val total = r.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
                total ?: (r.header("Content-Length")?.toLongOrNull() ?: -1L)
            }
        } catch (e: Exception) {
            -1L
        }
    }

    // Downloads url into target in 8 MB range requests.
    private fun downloadToFile(url: String, target: File) {
        val chunk = 8L * 1024 * 1024
        var start = 0L
        var total = -1L
        var finished = false
        val buffer = ByteArray(64 * 1024)
        java.io.FileOutputStream(target).use { out ->
            while (!finished) {
                if (stopRequested) throw IOException("stopped")
                val end = if (total > 0) minOf(start + chunk - 1, total - 1) else start + chunk - 1
                val wanted = end - start + 1
                val request = Request.Builder()
                    .url(url)
                    .header("User-Agent", USER_AGENT)
                    .header("Range", "bytes=$start-$end")
                    .build()
                val call = httpClient.newCall(request)
                activeCalls.add(call)
                try {
                    call.execute().use { response ->
                        if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
                        val body = response.body ?: throw IOException("Empty response")
                        val partial = response.code == 206
                        if (partial && total < 0) {
                            total = response.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull() ?: -1L
                        }
                        val input = body.byteStream()
                        var read = 0
                        var got = 0L
                        while (input.read(buffer).also { read = it } != -1) {
                            if (stopRequested) throw IOException("stopped")
                            out.write(buffer, 0, read)
                            got += read
                        }
                        start += got
                        if (!partial) {
                            finished = true
                        } else if (total > 0 && start >= total) {
                            finished = true
                        } else if (got < wanted) {
                            finished = true
                        }
                    }
                } finally {
                    activeCalls.remove(call)
                }
            }
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "Song downloads", NotificationManager.IMPORTANCE_LOW)
                )
            }
        }
    }

    private fun newBuilder(): Notification.Builder {
        return if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    }

    private fun buildNotification(): Notification {
        val remaining = SongDownloads.openCount(this)
        val finished = doneCount.get() + failCount.get()
        val total = finished + remaining
        val uk = SongDownloads.lang(this) == "uk"
        val title = if (uk) "\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043d\u044f \u043f\u0456\u0441\u0435\u043d\u044c" else "Downloading songs"
        val text = if (uk) "$finished \u0437 $total" else "$finished of $total"
        val cancelLabel = if (uk) "\u0421\u043a\u0430\u0441\u0443\u0432\u0430\u0442\u0438 \u0432\u0441\u0435" else "Cancel all"
        val cancelIntent = Intent(this, SongDownloadService::class.java).setAction(ACTION_CANCEL)
        val cancelPending = PendingIntent.getService(
            this, 1, cancelIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val cancelAction = Notification.Action.Builder(
            Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel),
            cancelLabel,
            cancelPending
        ).build()
        val builder = newBuilder()
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(total, finished, total <= 0)
            .addAction(cancelAction)
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        if (launch != null) {
            builder.setContentIntent(
                PendingIntent.getActivity(
                    this, 0, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )
        }
        if (Build.VERSION.SDK_INT >= 31) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        }
        return builder.build()
    }

    private fun goForeground() {
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    private fun publish() {
        try {
            val nm = getSystemService(NotificationManager::class.java)
            nm.notify(NOTIF_ID, buildNotification())
        } catch (e: Exception) {
            // the notification is optional
        }
    }

    private fun postFinished(done: Int, failed: Int) {
        try {
            val uk = SongDownloads.lang(this) == "uk"
            val title = if (uk) "\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043d\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u043e" else "Downloads finished"
            val text = if (uk) "$done \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043e, \u043f\u043e\u043c\u0438\u043b\u043e\u043a: $failed" else "$done downloaded, $failed failed"
            val n = newBuilder()
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(title)
                .setContentText(text)
                .setAutoCancel(true)
                .build()
            val nm = getSystemService(NotificationManager::class.java)
            nm.notify(DONE_NOTIF_ID, n)
        } catch (e: Exception) {
            // the notification is optional
        }
    }
}