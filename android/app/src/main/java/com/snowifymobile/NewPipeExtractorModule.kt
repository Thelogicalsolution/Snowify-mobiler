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
                val searchExtractor = youtubeService.getSearchExtractor(query)
                searchExtractor.fetchPage()

                val results: WritableArray = Arguments.createArray()

                for (item in searchExtractor.initialPage.items) {
                    // Only include actual playable videos.
                    // This skips mixes/radios, playlists, and channels,
                    // which have URLs the stream extractor can't play directly.
                    if (item !is StreamInfoItem) {
                        continue
                    }

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

    @ReactMethod
    fun getStreamUrl(videoUrl: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val youtubeService = ServiceList.YouTube
                val streamInfo = StreamInfo.getInfo(youtubeService, videoUrl)

                val bestAudio: AudioStream? = streamInfo.audioStreams
                    .maxByOrNull { it.averageBitrate }

                if (bestAudio == null) {
                    promise.reject("NO_AUDIO_STREAM", "No audio stream found for this video")
                    return@launch
                }

                val result: WritableMap = Arguments.createMap()
                result.putString("streamUrl", bestAudio.content)
                result.putString("title", streamInfo.name)
                result.putString("duration", streamInfo.duration.toString())
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