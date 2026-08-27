package com.analytics.agent.data.remote

import com.analytics.agent.data.model.ApiErrorBody
import com.analytics.agent.data.model.ApiErrorEnvelope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

val AppJson: Json = Json {
    ignoreUnknownKeys = true
    isLenient = true
    coerceInputValues = true
    explicitNulls = false
    encodeDefaults = true
}

val JsonMediaType = "application/json; charset=utf-8".toMediaType()

/**
 * Shared HTTP plumbing.
 *
 * The client holds only the publishable Supabase key and the access token of
 * the signed-in admin. No service-role key, database password or AI provider
 * key is ever present on the device.
 */
object Http {

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(300, TimeUnit.SECONDS) // large uploads
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(true)
        .build()

    suspend fun execute(request: Request): Response = withContext(Dispatchers.IO) {
        try {
            client.newCall(request).execute()
        } catch (e: UnknownHostException) {
            throw AppError.Offline(e)
        } catch (e: SocketTimeoutException) {
            throw AppError.Timeout(e)
        } catch (e: IOException) {
            throw AppError.Offline(e)
        }
    }

    inline fun <reified T> decode(body: String, fallback: () -> T): T = try {
        AppJson.decodeFromString<T>(body)
    } catch (e: Exception) {
        fallback()
    }

    fun parseError(status: Int, body: String?): AppError {
        val parsed: ApiErrorBody? = body?.let {
            runCatching { AppJson.decodeFromString<ApiErrorEnvelope>(it).detail }.getOrNull()
                ?: runCatching { AppJson.decodeFromString<ApiErrorBody>(it) }.getOrNull()
        }
        return AppError.fromApi(status, parsed)
    }

    fun jsonBody(payload: String): RequestBody = payload.toRequestBody(JsonMediaType)
}
