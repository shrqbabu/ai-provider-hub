package com.aihub.android.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class HubModel(val id: String, val ownedBy: String)

data class ChatTurn(val role: String, val content: String)

class HubException(message: String) : Exception(message)

class HubClient(
    private val baseUrl: String,
    private val apiKey: String,
) {
    private val json = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private fun root(): String = baseUrl.trim().trimEnd('/')

    private fun auth(builder: Request.Builder): Request.Builder {
        val key = apiKey.trim()
        return builder
            .addHeader("Authorization", "Bearer $key")
            .addHeader("x-api-key", key)
            .addHeader("Content-Type", "application/json")
    }

    fun ping(): String {
        val urls = listOf("${root()}/api/ping", "${root()}/v1/models")
        var last = "Could not reach hub"
        for (url in urls) {
            val req = auth(Request.Builder().url(url)).get().build()
            try {
                http.newCall(req).execute().use { res ->
                    val text = res.body?.string().orEmpty()
                    if (res.isSuccessful) {
                        if (text.contains("<html", ignoreCase = true)) {
                            last = "Hub returned a web page. Use the hub root URL (no /chat)."
                        } else {
                            return "ok"
                        }
                    } else {
                        last = "HTTP ${res.code}: ${text.take(180).ifBlank { res.message }}"
                        if (res.code == 401) last = "Invalid gateway key (ah-…). Create one in the web app: More → Gateway Keys."
                    }
                }
            } catch (e: Exception) {
                last = e.message ?: last
            }
        }
        throw HubException(last)
    }

    fun listModels(): List<HubModel> {
        var last = "Failed to load models"
        for (path in listOf("/v1/models", "/api/v1/models")) {
            val req = auth(Request.Builder().url(root() + path)).get().build()
            try {
                http.newCall(req).execute().use { res ->
                    val text = res.body?.string().orEmpty()
                    if (!res.isSuccessful) {
                        last = parseError(res.code, text)
                        if (res.code == 401 || res.code == 403) throw HubException(last)
                        return@use
                    }
                    val data = JSONObject(text).optJSONArray("data") ?: JSONArray()
                    val out = ArrayList<HubModel>(data.length())
                    for (i in 0 until data.length()) {
                        val o = data.optJSONObject(i) ?: continue
                        val id = o.optString("id").trim()
                        if (id.isEmpty()) continue
                        out.add(HubModel(id = id, ownedBy = o.optString("owned_by").ifBlank { "hub" }))
                    }
                    return out
                }
            } catch (e: HubException) {
                throw e
            } catch (e: Exception) {
                last = e.message ?: last
            }
        }
        throw HubException(last)
    }

    fun streamChat(
        model: String,
        messages: List<ChatTurn>,
        maxTokens: Int,
        temperature: Double?,
        onDelta: (String) -> Unit,
    ): Pair<Int, Int> {
        val arr = JSONArray()
        for (m in messages) {
            arr.put(JSONObject().put("role", m.role).put("content", m.content))
        }
        val body = JSONObject()
            .put("model", model.replace(Regex("^aip/"), ""))
            .put("messages", arr)
            .put("stream", true)
            .put("stream_options", JSONObject().put("include_usage", true))
        if (maxTokens > 0) body.put("max_tokens", maxTokens)
        if (temperature != null) body.put("temperature", temperature)

        val req = auth(Request.Builder().url("${root()}/v1/chat/completions"))
            .post(body.toString().toRequestBody(json))
            .build()

        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) {
                throw HubException(parseError(res.code, res.body?.string().orEmpty()))
            }
            return readSse(res, onDelta)
        }
    }

    private fun readSse(res: Response, onDelta: (String) -> Unit): Pair<Int, Int> {
        val source = res.body?.source() ?: throw HubException("Empty stream")
        var tin = 0
        var tout = 0
        val buf = StringBuilder()
        while (!source.exhausted()) {
            val line = source.readUtf8Line() ?: break
            if (line.isBlank()) continue
            if (!line.startsWith("data:")) continue
            val payload = line.removePrefix("data:").trim()
            if (payload == "[DONE]") break
            try {
                val obj = JSONObject(payload)
                val usage = obj.optJSONObject("usage")
                if (usage != null) {
                    tin = usage.optInt("prompt_tokens", tin)
                    tout = usage.optInt("completion_tokens", tout)
                }
                val choices = obj.optJSONArray("choices") ?: continue
                val delta = choices.optJSONObject(0)?.optJSONObject("delta") ?: continue
                val content = delta.optString("content")
                if (content.isNotEmpty()) {
                    buf.append(content)
                    onDelta(content)
                }
            } catch (_: Exception) {
                // skip malformed frames
            }
        }
        return tin to tout
    }

    private fun parseError(code: Int, text: String): String {
        return try {
            val o = JSONObject(text)
            val err = o.optJSONObject("error")
            val msg = err?.optString("message") ?: o.optString("error")
            if (msg.isNotBlank()) msg else "HTTP $code"
        } catch (_: Exception) {
            if (text.contains("<html", ignoreCase = true)) {
                "Hub returned a web page, not the API. Use the hub root URL (no /chat). Example: https://your-domain.com"
            } else {
                text.take(220).ifBlank { "HTTP $code" }
            }
        }
    }
}
