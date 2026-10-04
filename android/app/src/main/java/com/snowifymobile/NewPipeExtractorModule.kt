package com.snowifymobile

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
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
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
}