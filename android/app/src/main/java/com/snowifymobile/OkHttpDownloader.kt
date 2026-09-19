package com.snowifymobile

import okhttp3.OkHttpClient
import okhttp3.Request as OkHttpRequest
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import java.io.IOException

class OkHttpDownloader private constructor() : Downloader() {

    private val client = OkHttpClient.Builder()
        .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .build()

    companion object {
        @Volatile
        private var instance: OkHttpDownloader? = null

        fun getInstance(): OkHttpDownloader {
            return instance ?: synchronized(this) {
                instance ?: OkHttpDownloader().also { instance = it }
            }
        }
    }

    @Throws(IOException::class)
    override fun execute(request: Request): Response {
        val httpMethod = request.httpMethod()
        val url = request.url()
        val headers = request.headers()
        val dataToSend = request.dataToSend()

        var builder = OkHttpRequest.Builder().url(url)

        for ((key, values) in headers) {
            for (value in values) {
                builder = builder.addHeader(key, value)
            }
        }

        builder = if (dataToSend != null) {
            builder.method(httpMethod, okhttp3.RequestBody.create(null, dataToSend))
        } else {
            builder.method(httpMethod, null)
        }

        val response = client.newCall(builder.build()).execute()
        val body = response.body?.string() ?: ""
        val latestUrl = response.request.url.toString()

        return Response(
            response.code,
            response.message,
            response.headers.toMultimap(),
            body,
            latestUrl
        )
    }
}
