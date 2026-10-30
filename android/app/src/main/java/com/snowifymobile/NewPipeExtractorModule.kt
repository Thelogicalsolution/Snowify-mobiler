package com.snowifymobile

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.palette.graphics.Palette
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.schabi.newpipe.extractor.Page
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem
import org.schabi.newpipe.extractor.channel.ChannelInfo
import org.schabi.newpipe.extractor.stream.VideoStream
import org.schabi.newpipe.extractor.linkhandler.ListLinkHandler
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory

class NewPipeExtractorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        try {
            NewPipe.init(
                OkHttpDownloader.getInstance(),
                Localization("en", "US"),
                ContentCountry("US")
            )
        } catch (e: Exception) {
            // Already initialized, safe to ignore
        }
    }

    override fun getName(): String {
        return "NewPipeExtractorModule"
    }

    @ReactMethod
    fun searchVideos(query: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val youtubeService = ServiceList.YouTube

                // Run two searches: one restricted to YouTube's "Songs"
                // category (real music-metadata results, matching what
                // YouTube's own Music filter chip returns), and one with
                // the default "videos" filter as a fallback/supplement.
                // Results are merged music-first, deduped by URL, so
                // songs surface above regular videos without discarding
                // anything.
                val musicExtractor = youtubeService.getSearchExtractor(
                    query,
                    listOf(YoutubeSearchQueryHandlerFactory.MUSIC_SONGS),
                    ""
                )
                val videoExtractor = youtubeService.getSearchExtractor(
                    query,
                    listOf(YoutubeSearchQueryHandlerFactory.VIDEOS),
                    ""
                )

                musicExtractor.fetchPage()
                videoExtractor.fetchPage()

                val seenUrls = HashSet<String>()
                val orderedItems = mutableListOf<StreamInfoItem>()

                for (item in musicExtractor.initialPage.items) {
                    if (item is StreamInfoItem && seenUrls.add(item.url)) {
                        orderedItems.add(item)
                    }
                }
                for (item in videoExtractor.initialPage.items) {
                    if (item is StreamInfoItem && seenUrls.add(item.url)) {
                        orderedItems.add(item)
                    }
                }

                val results: WritableArray = Arguments.createArray()

                for (item in orderedItems) {
                    val map: WritableMap = Arguments.createMap()
                    map.putString("url", item.url)
                    map.putString("name", item.name)
                    map.putString(
                        "thumbnailUrl",
                        item.thumbnails.firstOrNull()?.url ?: ""
                    )
                    results.pushMap(map)
                }

                promise.resolve(results)
            } catch (e: Exception) {
                promise.reject("SEARCH_ERROR", e.message, e)
            }
        }
    }

    // Picks an audio stream by bitrate tier.
    // "best" = highest bitrate, "low" = lowest bitrate, "balanced" = middle.
    // Streams with an unknown bitrate (-1) are ignored unless none report one.
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

    @ReactMethod
    fun getStreamUrl(videoUrl: String, quality: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val youtubeService = ServiceList.YouTube
                val streamInfo = StreamInfo.getInfo(youtubeService, videoUrl)

                val chosenAudio: AudioStream? = pickAudioStream(streamInfo.audioStreams, quality)

                if (chosenAudio == null) {
                    promise.reject("NO_AUDIO_STREAM", "No audio stream found for this video")
                    return@launch
                }

                // The real container/codec suffix (e.g. "m4a", "webm") - used
                // on the JS side so downloaded files are saved with a correct
                // extension instead of a generic one. Local files have no HTTP
                // content-type header for the player to sniff, so a wrong or
                // missing extension can make it misdetect the format, causing
                // random playback stops and missed "track ended" events.
                val formatSuffix = chosenAudio.format?.suffix ?: "m4a"

                val result: WritableMap = Arguments.createMap()
                result.putString("streamUrl", chosenAudio.content)
                result.putString("title", streamInfo.name)
                result.putString("duration", streamInfo.duration.toString())
                result.putString("format", formatSuffix)
                result.putString(
                    "thumbnailUrl",
                    streamInfo.thumbnails.firstOrNull()?.url ?: ""
                )

                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("STREAM_ERROR", e.message, e)
            }
        }
    }

    // Extracts the dominant colors from a track's thumbnail image, sorted
    // by "population" (how much of the image's area each color actually
    // covers). Returns up to 3 {color, share} entries - color is a hex
    // string, share is that swatch's population as a fraction of the total
    // population across all returned swatches (0-1), used on the JS side to
    // weight how strongly a color should influence its UI tier (a color
    // that's barely present should only tint faintly). Resolves with an
    // empty array if the image had too few distinct colors to extract
    // anything useful from.
    @ReactMethod
    fun extractPalette(imageUrl: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val client = OkHttpClient()
                val request = Request.Builder().url(imageUrl).build()
                val response = client.newCall(request).execute()

                if (!response.isSuccessful) {
                    promise.reject("PALETTE_ERROR", "Failed to fetch image: ${response.code}")
                    return@launch
                }

                val bytes = response.body?.bytes()
                if (bytes == null || bytes.isEmpty()) {
                    promise.reject("PALETTE_ERROR", "Empty image response")
                    return@launch
                }

                val bitmap: Bitmap? = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                if (bitmap == null) {
                    promise.reject("PALETTE_ERROR", "Could not decode image")
                    return@launch
                }

                val palette = Palette.from(bitmap).generate()
                val sorted = palette.swatches.sortedByDescending { it.population }

                val results: WritableArray = Arguments.createArray()
                if (sorted.isEmpty()) {
                    promise.resolve(results)
                    return@launch
                }

                val totalPopulation = sorted.sumOf { it.population }.toDouble().coerceAtLeast(1.0)

                for (i in 0 until 3) {
                    val swatch = sorted[if (i < sorted.size) i else sorted.size - 1]
                    val share = swatch.population / totalPopulation
                    val map: WritableMap = Arguments.createMap()
                    map.putString("color", String.format("#%06X", 0xFFFFFF and swatch.rgb))
                    map.putDouble("share", share)
                    results.pushMap(map)
                }

                promise.resolve(results)
            } catch (e: Exception) {
                promise.reject("PALETTE_ERROR", e.message, e)
            }
        }
    }

    // The songs/videos YouTube suggests after the given one ("up next").
    // Only regular items between 1 and 15 minutes are returned, which skips
    // live streams (duration -1), very short clips and long mixes. If a
    // music.youtube.com link yields nothing, the same video is retried on
    // www.youtube.com.
    @ReactMethod
    fun getRelatedStreams(videoUrl: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val youtubeService = ServiceList.YouTube

                fun collect(url: String): List<StreamInfoItem> =
                    StreamInfo.getInfo(youtubeService, url)
                        .relatedItems
                        .filterIsInstance<StreamInfoItem>()
                        .filter { it.duration.toLong() in 60L..900L }

                var items = collect(videoUrl)
                if (items.isEmpty() && videoUrl.contains("music.youtube.com")) {
                    items = collect(videoUrl.replace("music.youtube.com", "www.youtube.com"))
                }

                val results: WritableArray = Arguments.createArray()
                for (item in items.distinctBy { it.url }) {
                    val map: WritableMap = Arguments.createMap()
                    map.putString("url", item.url)
                    map.putString("name", item.name)
                    map.putString("thumbnailUrl", item.thumbnails.firstOrNull()?.url ?: "")
                    results.pushMap(map)
                }
                promise.resolve(results)
            } catch (e: Exception) {
                promise.reject("RELATED_ERROR", e.message, e)
            }
        }
    }

    // True when the active network is Wi-Fi or Ethernet; false on mobile data or when offline.
    @ReactMethod
    fun isOnWifi(promise: Promise) {
        try {
            val cm = reactApplicationContext.getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val network = cm.activeNetwork
            val caps = if (network != null) cm.getNetworkCapabilities(network) else null
            val onWifi = caps != null && (
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) ||
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET)
            )
            promise.resolve(onWifi)
        } catch (e: Exception) {
            promise.reject("NETWORK_ERROR", e.message, e)
        }
    }

    // Playlist search: regular YouTube playlists and mixes ("playlists" filter).
    @ReactMethod
    fun searchPlaylists(query: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val extractor = ServiceList.YouTube.getSearchExtractor(
                    query,
                    listOf("playlists"),
                    ""
                )
                extractor.fetchPage()

                val results: WritableArray = Arguments.createArray()
                for (item in extractor.initialPage.items) {
                    if (item !is PlaylistInfoItem) continue
                    val map: WritableMap = Arguments.createMap()
                    map.putString("url", item.url)
                    map.putString("name", item.name)
                    map.putString("thumbnailUrl", item.thumbnails.firstOrNull()?.url ?: "")
                    map.putString("uploader", item.uploaderName ?: "")
                    map.putDouble("count", item.streamCount.toDouble())
                    results.pushMap(map)
                }
                promise.resolve(results)
            } catch (e: Exception) {
                promise.reject("PLAYLIST_SEARCH_ERROR", e.message, e)
            }
        }
    }

    // The songs of a YouTube playlist or mix, following pages until maxItems is reached.
    // Mixes are endless, so they are simply cut at maxItems (or at what YouTube returns).
    @ReactMethod
    fun getPlaylistTracks(playlistUrl: String, maxItems: Int, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val youtubeService = ServiceList.YouTube
                val info = PlaylistInfo.getInfo(youtubeService, playlistUrl)

                val items = ArrayList<StreamInfoItem>()
                items.addAll(info.relatedItems.filterIsInstance<StreamInfoItem>())

                var next: Page? = info.nextPage
                var pages = 0
                while (items.size < maxItems && pages < 10) {
                    val current = next ?: break
                    val page = PlaylistInfo.getMoreItems(youtubeService, playlistUrl, current)
                    items.addAll(page.items.filterIsInstance<StreamInfoItem>())
                    next = page.nextPage
                    pages++
                }

                val tracks: WritableArray = Arguments.createArray()
                val seen = HashSet<String>()
                var added = 0
                for (item in items) {
                    if (added >= maxItems) break
                    if (!seen.add(item.url)) continue
                    val map: WritableMap = Arguments.createMap()
                    map.putString("url", item.url)
                    map.putString("name", item.name)
                    map.putString("thumbnailUrl", item.thumbnails.firstOrNull()?.url ?: "")
                    tracks.pushMap(map)
                    added++
                }

                val result: WritableMap = Arguments.createMap()
                result.putString("name", info.name)
                result.putString("uploader", info.uploaderName ?: "")
                result.putDouble("count", info.streamCount.toDouble())
                result.putArray("tracks", tracks)
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("PLAYLIST_ERROR", e.message, e)
            }
        }
    }

    // Title, uploader (usually the artist) and length in seconds of a video - used to match lyrics.
    @ReactMethod
    fun getTrackMeta(videoUrl: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val info = StreamInfo.getInfo(ServiceList.YouTube, videoUrl)
                val map: WritableMap = Arguments.createMap()
                map.putString("title", info.name)
                map.putString("uploader", info.uploaderName ?: "")
                map.putDouble("duration", info.duration.toDouble())
                map.putString("uploaderUrl", info.uploaderUrl ?: "")
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("META_ERROR", e.message, e)
            }
        }
    }

    // Opens the native video screen (VideoPlayerActivity) for a YouTube video. The promise
    // resolves when that screen closes, with the position it stopped at.
    @ReactMethod
    fun playVideo(videoUrl: String, startSeconds: Double, maxHeight: Int, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val info = StreamInfo.getInfo(ServiceList.YouTube, videoUrl)
                val audio = pickAudioStream(info.audioStreams, "best")

                val adaptive = info.videoOnlyStreams.filter { it.height in 1..maxHeight }
                val h264 = adaptive.filter { it.codec?.startsWith("avc1") == true }
                val chosenVideo = h264.maxByOrNull { it.height }
                    ?: adaptive.filter { it.codec?.startsWith("av01") != true }.maxByOrNull { it.height }
                val combined = info.videoStreams.filter { it.height in 1..maxHeight }.maxByOrNull { it.height }

                val videoStreamUrl: String
                var audioStreamUrl = ""
                val label: String
                if (chosenVideo != null && audio != null) {
                    videoStreamUrl = chosenVideo.content
                    audioStreamUrl = audio.content
                    label = "${chosenVideo.height}p ${chosenVideo.codec ?: ""} + audio"
                } else if (combined != null) {
                    videoStreamUrl = combined.content
                    label = "${combined.height}p combined"
                } else {
                    promise.reject("NO_VIDEO_STREAM", "No playable video stream found")
                    return@launch
                }

                val activity = reactApplicationContext.currentActivity
                if (activity == null) {
                    promise.reject("NO_ACTIVITY", "The app is not in the foreground")
                    return@launch
                }

                VideoBridge.begin(promise, label)
                val intent = android.content.Intent(activity, VideoPlayerActivity::class.java)
                intent.putExtra("videoUrl", videoStreamUrl)
                intent.putExtra("audioUrl", audioStreamUrl)
                intent.putExtra("startMs", (startSeconds * 1000).toLong())
                activity.runOnUiThread { activity.startActivity(intent) }
            } catch (e: Exception) {
                promise.reject("VIDEO_ERROR", e.message, e)
            }
        }
    }

    // Video-only search (YouTube's plain "videos" filter): no music results mixed in.
    @ReactMethod
    fun searchVideoOnly(query: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val extractor = ServiceList.YouTube.getSearchExtractor(
                    query,
                    listOf(YoutubeSearchQueryHandlerFactory.VIDEOS),
                    ""
                )
                extractor.fetchPage()

                val results: WritableArray = Arguments.createArray()
                val seen = HashSet<String>()
                for (item in extractor.initialPage.items) {
                    if (item !is StreamInfoItem) continue
                    if (item.duration.toLong() <= 0L) continue
                    if (!seen.add(item.url)) continue
                    val map: WritableMap = Arguments.createMap()
                    map.putString("url", item.url)
                    map.putString("name", item.name)
                    map.putString("thumbnailUrl", item.thumbnails.lastOrNull()?.url ?: "")
                    map.putString("uploader", item.uploaderName ?: "")
                    map.putDouble("duration", item.duration.toDouble())
                    map.putString("uploaderUrl", item.uploaderUrl ?: "")
                    results.pushMap(map)
                }
                promise.resolve(results)
            } catch (e: Exception) {
                promise.reject("VIDEO_SEARCH_ERROR", e.message, e)
            }
        }
    }

    // Cached tab handlers and page tokens of the channels opened so far.
    private val channelTabs = java.util.concurrent.ConcurrentHashMap<String, ListLinkHandler>()
    private val channelPages = java.util.concurrent.ConcurrentHashMap<String, Page>()
    private val channelPageCounter = java.util.concurrent.atomic.AtomicLong(0)

    // A channel's header (name, avatar, subscribers) and which tabs it has.
    @ReactMethod
    fun getChannel(channelUrl: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val info = ChannelInfo.getInfo(ServiceList.YouTube, channelUrl)
                var hasVideos = false
                var hasPlaylists = false
                for (tab in info.tabs) {
                    val filters = tab.contentFilters
                    if (filters.contains("videos")) {
                        channelTabs["${info.url}|videos"] = tab
                        hasVideos = true
                    }
                    if (filters.contains("playlists")) {
                        channelTabs["${info.url}|playlists"] = tab
                        hasPlaylists = true
                    }
                }
                val map: WritableMap = Arguments.createMap()
                map.putString("url", info.url)
                map.putString("name", info.name)
                map.putString("avatarUrl", info.avatars.lastOrNull()?.url ?: "")
                map.putDouble("subscribers", info.subscriberCount.toDouble())
                map.putBoolean("hasVideos", hasVideos)
                map.putBoolean("hasPlaylists", hasPlaylists)
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("CHANNEL_ERROR", e.message, e)
            }
        }
    }

    // One page of a channel tab ("videos" or "playlists"). An empty pageToken means the first
    // page; the returned "next" token (empty when there is no more) fetches the following one.
    @ReactMethod
    fun getChannelTab(channelUrl: String, tab: String, pageToken: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val handler = channelTabs["$channelUrl|$tab"]
                if (handler == null) {
                    promise.reject("NO_TAB", "This channel has no $tab tab")
                    return@launch
                }
                val extractor = ServiceList.YouTube.getChannelTabExtractor(handler)
                val page = if (pageToken.isEmpty()) {
                    extractor.fetchPage()
                    extractor.initialPage
                } else {
                    val saved = channelPages[pageToken]
                    if (saved == null) {
                        promise.reject("NO_PAGE", "This page expired, open the channel again")
                        return@launch
                    }
                    extractor.getPage(saved)
                }

                val items: WritableArray = Arguments.createArray()
                val seen = HashSet<String>()
                for (item in page.items) {
                    if (tab == "playlists") {
                        if (item !is PlaylistInfoItem) continue
                        if (!seen.add(item.url)) continue
                        val map: WritableMap = Arguments.createMap()
                        map.putString("url", item.url)
                        map.putString("name", item.name)
                        map.putString("thumbnailUrl", item.thumbnails.firstOrNull()?.url ?: "")
                        map.putString("uploader", item.uploaderName ?: "")
                        map.putDouble("count", item.streamCount.toDouble())
                        items.pushMap(map)
                    } else {
                        if (item !is StreamInfoItem) continue
                        if (item.duration.toLong() <= 0L) continue
                        if (!seen.add(item.url)) continue
                        val map: WritableMap = Arguments.createMap()
                        map.putString("url", item.url)
                        map.putString("name", item.name)
                        map.putString("thumbnailUrl", item.thumbnails.lastOrNull()?.url ?: "")
                        map.putString("uploader", item.uploaderName ?: "")
                        map.putString("uploaderUrl", item.uploaderUrl ?: "")
                        map.putDouble("duration", item.duration.toDouble())
                        items.pushMap(map)
                    }
                }

                var nextToken = ""
                val next = page.nextPage
                if (next != null) {
                    if (channelPages.size > 300) channelPages.clear()
                    nextToken = "p" + channelPageCounter.incrementAndGet()
                    channelPages[nextToken] = next
                }

                val result: WritableMap = Arguments.createMap()
                result.putArray("items", items)
                result.putString("next", nextToken)
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("CHANNEL_TAB_ERROR", e.message, e)
            }
        }
    }

    // ---- Video downloads: a video file and a sound file saved in the app's private storage ----
    private val dlUserAgent =
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .build()
    private val downloadProgress = java.util.concurrent.ConcurrentHashMap<String, LongArray>()
    private val downloadCancel = java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.atomic.AtomicBoolean>()
    private val downloadCalls = java.util.concurrent.ConcurrentHashMap<String, okhttp3.Call>()

    // Best video-only stream at or below the requested height (H.264 preferred so it plays everywhere).
    private fun pickVideoStreamAtHeight(streams: List<VideoStream>, height: Int): VideoStream? {
        val atOrBelow = streams.filter { it.height in 1..height }
        if (atOrBelow.isEmpty()) return null
        val bestHeight = atOrBelow.maxOf { it.height }
        val sameHeight = atOrBelow.filter { it.height == bestHeight }
        return sameHeight.firstOrNull { it.codec?.startsWith("avc1") == true }
            ?: sameHeight.firstOrNull { it.codec?.startsWith("av01") != true }
            ?: sameHeight.first()
    }

    // File size from the server (a one-byte range request), or -1 when unknown.
    private fun probeSize(url: String): Long {
        return try {
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", dlUserAgent)
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

    // Downloads url into target in 8 MB range requests, counting bytes into progress[0].
    private fun downloadToFile(
        id: String,
        url: String,
        target: java.io.File,
        progress: LongArray,
        cancel: java.util.concurrent.atomic.AtomicBoolean
    ) {
        val chunk = 8L * 1024 * 1024
        var start = 0L
        var total = -1L
        var finished = false
        val buffer = ByteArray(64 * 1024)
        java.io.FileOutputStream(target).use { out ->
            while (!finished) {
                if (cancel.get()) throw java.io.IOException("cancelled")
                val end = if (total > 0) minOf(start + chunk - 1, total - 1) else start + chunk - 1
                val wanted = end - start + 1
                val request = Request.Builder()
                    .url(url)
                    .header("User-Agent", dlUserAgent)
                    .header("Range", "bytes=$start-$end")
                    .build()
                val call = httpClient.newCall(request)
                downloadCalls[id] = call
                call.execute().use { response ->
                    if (!response.isSuccessful) throw java.io.IOException("HTTP ${response.code}")
                    val body = response.body ?: throw java.io.IOException("Empty response")
                    val partial = response.code == 206
                    if (partial && total < 0) {
                        total = response.header("Content-Range")?.substringAfterLast('/')?.toLongOrNull() ?: -1L
                    }
                    val input = body.byteStream()
                    var read = 0
                    var got = 0L
                    while (input.read(buffer).also { read = it } != -1) {
                        if (cancel.get()) throw java.io.IOException("cancelled")
                        out.write(buffer, 0, read)
                        got += read
                        progress[0] += read.toLong()
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
            }
        }
    }

    // Which qualities can be downloaded, with the total size (video plus sound) of each.
    @ReactMethod
    fun getVideoDownloadOptions(videoUrl: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val info = StreamInfo.getInfo(ServiceList.YouTube, videoUrl)
                val audio = pickAudioStream(info.audioStreams, "best")
                val audioBytes = if (audio != null) probeSize(audio.content) else 0L
                val result: WritableArray = Arguments.createArray()
                val seen = HashSet<Int>()
                for (target in listOf(360, 480, 720, 1080)) {
                    val stream = pickVideoStreamAtHeight(info.videoOnlyStreams, target) ?: continue
                    if (!seen.add(stream.height)) continue
                    val videoBytes = probeSize(stream.content)
                    val map: WritableMap = Arguments.createMap()
                    map.putInt("height", stream.height)
                    map.putString("codec", stream.codec ?: "")
                    map.putDouble(
                        "bytes",
                        if (videoBytes > 0) (videoBytes + maxOf(audioBytes, 0L)).toDouble() else -1.0
                    )
                    result.pushMap(map)
                }
                if (audio == null || result.size() == 0) {
                    promise.reject("NO_VIDEO_STREAM", "No downloadable video streams found")
                    return@launch
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("OPTIONS_ERROR", e.message, e)
            }
        }
    }

    // Downloads the sound and the video of trackUrl at the chosen height. Resolves with the file paths.
    @ReactMethod
    fun startVideoDownload(id: String, trackUrl: String, height: Int, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            val cancel = java.util.concurrent.atomic.AtomicBoolean(false)
            val progress = longArrayOf(0L, -1L)
            downloadCancel[id] = cancel
            downloadProgress[id] = progress
            var videoFile: java.io.File? = null
            var audioFile: java.io.File? = null
            try {
                val info = StreamInfo.getInfo(ServiceList.YouTube, trackUrl)
                val audio = pickAudioStream(info.audioStreams, "best")
                    ?: throw java.io.IOException("No audio stream")
                val video = pickVideoStreamAtHeight(info.videoOnlyStreams, height)
                    ?: throw java.io.IOException("No video stream")
                val dir = java.io.File(reactApplicationContext.filesDir, "videos")
                dir.mkdirs()
                val safe = id.replace(Regex("[^A-Za-z0-9_-]"), "_")
                val vFile = java.io.File(dir, "$safe.video.${video.format?.suffix ?: "mp4"}")
                val aFile = java.io.File(dir, "$safe.audio.${audio.format?.suffix ?: "m4a"}")
                videoFile = vFile
                audioFile = aFile

                val videoSize = probeSize(video.content)
                val audioSize = probeSize(audio.content)
                progress[1] = if (videoSize > 0 && audioSize > 0) videoSize + audioSize else -1L

                downloadToFile(id, audio.content, aFile, progress, cancel)
                downloadToFile(id, video.content, vFile, progress, cancel)

                val result: WritableMap = Arguments.createMap()
                result.putString("videoPath", vFile.absolutePath)
                result.putString("audioPath", aFile.absolutePath)
                result.putInt("height", video.height)
                result.putString("codec", video.codec ?: "")
                result.putDouble("bytes", (vFile.length() + aFile.length()).toDouble())
                promise.resolve(result)
            } catch (e: Exception) {
                videoFile?.delete()
                audioFile?.delete()
                if (cancel.get()) {
                    promise.reject("CANCELLED", "Download cancelled")
                } else {
                    promise.reject("DOWNLOAD_ERROR", e.message, e)
                }
            } finally {
                downloadProgress.remove(id)
                downloadCancel.remove(id)
                downloadCalls.remove(id)
            }
        }
    }

    @ReactMethod
    fun getVideoDownloadProgress(id: String, promise: Promise) {
        val p = downloadProgress[id]
        val map: WritableMap = Arguments.createMap()
        map.putDouble("received", (p?.get(0) ?: 0L).toDouble())
        map.putDouble("total", (p?.get(1) ?: -1L).toDouble())
        map.putBoolean("active", p != null)
        promise.resolve(map)
    }

    @ReactMethod
    fun cancelVideoDownload(id: String) {
        downloadCancel[id]?.set(true)
        downloadCalls[id]?.cancel()
    }

    @ReactMethod
    fun deleteFile(path: String, promise: Promise) {
        try {
            promise.resolve(java.io.File(path).delete())
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun getFreeSpace(promise: Promise) {
        try {
            val stat = android.os.StatFs(reactApplicationContext.filesDir.absolutePath)
            promise.resolve(stat.availableBytes.toDouble())
        } catch (e: Exception) {
            promise.resolve(-1.0)
        }
    }

    // Opens the video screen for an already downloaded video (works without internet).
    @ReactMethod
    fun playLocalVideo(videoPath: String, audioPath: String, startSeconds: Double, promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity
            if (activity == null) {
                promise.reject("NO_ACTIVITY", "The app is not in the foreground")
                return
            }
            if (!java.io.File(videoPath).exists() || !java.io.File(audioPath).exists()) {
                promise.reject("MISSING_FILE", "The downloaded files are missing")
                return
            }
            VideoBridge.begin(promise, "downloaded")
            val intent = android.content.Intent(activity, VideoPlayerActivity::class.java)
            intent.putExtra("videoUrl", "file://" + videoPath)
            intent.putExtra("audioUrl", "file://" + audioPath)
            intent.putExtra("startMs", (startSeconds * 1000).toLong())
            activity.runOnUiThread { activity.startActivity(intent) }
        } catch (e: Exception) {
            promise.reject("VIDEO_ERROR", e.message, e)
        }
    }
}
