package com.aihub.android.data

import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class HubException(message: String) : Exception(message)

data class StreamResult(
    val promptTokens: Int,
    val completionTokens: Int,
    val finishReason: String,
)

class HubClient(
    private val baseUrl: String,
    private val apiKey: String,
) {
    private val json = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var active: Call? = null

    fun stop() {
        active?.cancel()
        active = null
    }

    private fun root(): String = baseUrl.trim().trimEnd('/')

    private fun auth(builder: Request.Builder, gateway: Boolean = true): Request.Builder {
        val key = apiKey.trim()
        val b = builder.addHeader("Content-Type", "application/json")
        if (key.isNotBlank()) {
            b.addHeader("Authorization", "Bearer $key")
            if (gateway) b.addHeader("x-api-key", key)
        }
        return b
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
    ): StreamResult {
        val arr = JSONArray()
        for (m in messages) {
            val item = JSONObject().put("role", m.role)
            if (m.attachments.isEmpty()) {
                item.put("content", m.content)
            } else {
                val parts = JSONArray()
                if (m.content.isNotBlank()) {
                    parts.put(JSONObject().put("type", "text").put("text", m.content))
                }
                for (a in m.attachments) {
                    if (a.mime.startsWith("image/")) {
                        parts.put(
                            JSONObject().put("type", "image_url")
                                .put("image_url", JSONObject().put("url", a.dataUrl)),
                        )
                    } else {
                        parts.put(
                            JSONObject().put("type", "text")
                                .put("text", "\n[file ${a.name}]\n${a.dataUrl.take(8000)}"),
                        )
                    }
                }
                item.put("content", parts)
            }
            arr.put(item)
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
        val call = http.newCall(req)
        active = call
        try {
            call.execute().use { res ->
                if (!res.isSuccessful) {
                    throw HubException(parseError(res.code, res.body?.string().orEmpty()))
                }
                return readSse(res, onDelta)
            }
        } finally {
            if (active === call) active = null
        }
    }

    fun getRaw(path: String): Pair<Int, String> {
        val req = auth(Request.Builder().url(root() + path), gateway = true).get().build()
        http.newCall(req).execute().use { res ->
            return res.code to res.body?.string().orEmpty()
        }
    }

    fun putRaw(path: String, body: String): Pair<Int, String> {
        val req = auth(Request.Builder().url(root() + path), gateway = true)
            .put(body.toRequestBody(json))
            .build()
        http.newCall(req).execute().use { res ->
            return res.code to res.body?.string().orEmpty()
        }
    }

    fun postRaw(path: String, body: String): Pair<Int, String> {
        val req = auth(Request.Builder().url(root() + path), gateway = true)
            .post(body.toRequestBody(json))
            .build()
        http.newCall(req).execute().use { res ->
            return res.code to res.body?.string().orEmpty()
        }
    }

    fun deleteRaw(path: String): Pair<Int, String> {
        val req = auth(Request.Builder().url(root() + path), gateway = true).delete().build()
        http.newCall(req).execute().use { res ->
            return res.code to res.body?.string().orEmpty()
        }
    }

    fun getDataArray(key: String): JSONArray {
        val (code, text) = getRaw("/api/data?key=$key")
        if (code == 401 || code == 403) throw HubException(dataAuthHint(text))
        if (code !in 200..299) throw HubException(parseError(code, text))
        return unwrapValueArray(text)
    }

    fun getDataObject(key: String): JSONObject? {
        val (code, text) = getRaw("/api/data?key=$key")
        if (code == 401 || code == 403) throw HubException(dataAuthHint(text))
        if (code !in 200..299) throw HubException(parseError(code, text))
        return unwrapValueObject(text)
    }

    fun putData(key: String, value: Any) {
        val body = JSONObject().put("value", value).toString()
        val (code, text) = putRaw("/api/data?key=$key", body)
        if (code == 401 || code == 403) throw HubException(dataAuthHint(text))
        if (code !in 200..299) throw HubException(parseError(code, text))
    }

    fun listGatewayKeys(): List<GatewayKeyMeta> {
        val (code, text) = getRaw("/api/keys")
        if (code == 401 || code == 403) throw HubException(dataAuthHint(text))
        if (code !in 200..299) throw HubException(parseError(code, text))
        val keys = JSONObject(text).optJSONArray("keys") ?: JSONArray()
        return keys.toObjList().map { o ->
            GatewayKeyMeta(
                id = o.str("id"),
                label = o.str("label"),
                last4 = o.str("last4"),
                createdAt = o.lng("createdAt"),
                revoked = o.bool("revoked"),
            )
        }
    }

    fun createGatewayKey(label: String): Pair<String, GatewayKeyMeta> {
        val (code, text) = postRaw("/api/keys", JSONObject().put("label", label).toString())
        if (code == 401 || code == 403) throw HubException(dataAuthHint(text))
        if (code !in 200..299) throw HubException(parseError(code, text))
        val o = JSONObject(text)
        val k = o.optJSONObject("key") ?: JSONObject()
        return o.optString("raw") to GatewayKeyMeta(
            id = k.str("id"),
            label = k.str("label"),
            last4 = k.str("last4"),
            createdAt = k.lng("createdAt"),
            revoked = k.bool("revoked"),
        )
    }

    fun revokeGatewayKey(id: String) {
        val (code, text) = deleteRaw("/api/keys?id=${java.net.URLEncoder.encode(id, "UTF-8")}")
        if (code !in 200..299) throw HubException(parseError(code, text))
    }

    fun getQuota(): Pair<String, List<QuotaRow>> {
        val (code, text) = getRaw("/api/quota?refresh=1")
        if (code == 404) throw HubException("No Antigravity provider on this hub.")
        if (code !in 200..299) throw HubException(parseError(code, text))
        val o = JSONObject(text)
        val acc = o.optJSONObject("account")
        val label = listOfNotNull(acc?.optString("email"), acc?.optString("plan")).filter { it.isNotBlank() }.joinToString(" · ")
        val rows = (o.optJSONArray("rows") ?: JSONArray()).toObjList().map { r ->
            QuotaRow(
                model = r.str("model"),
                family = r.str("family"),
                remaining = r.dblOrNull("remainingFraction"),
                resetTime = r.str("resetTime").ifBlank { null },
                source = r.str("source"),
            )
        }
        return label to rows
    }

    fun exportBackup(): String {
        val (code, text) = getRaw("/api/backup")
        if (code !in 200..299) throw HubException(parseError(code, text))
        return text
    }

    fun importBackup(jsonText: String) {
        val (code, text) = postRaw("/api/backup", jsonText)
        if (code !in 200..299) throw HubException(parseError(code, text))
    }

    private fun readSse(res: Response, onDelta: (String) -> Unit): StreamResult {
        val source = res.body?.source() ?: throw HubException("Empty stream")
        var tin = 0
        var tout = 0
        var finish = ""
        while (!source.exhausted()) {
            val line = source.readUtf8Line() ?: break
            if (line.isBlank() || !line.startsWith("data:")) continue
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
                val c0 = choices.optJSONObject(0) ?: continue
                val fr = c0.optString("finish_reason")
                if (fr.isNotBlank() && fr != "null") finish = fr
                val delta = c0.optJSONObject("delta") ?: continue
                val content = delta.optString("content")
                if (content.isNotEmpty()) onDelta(content)
            } catch (_: Exception) {
            }
        }
        return StreamResult(tin, tout, finish)
    }

    private fun dataAuthHint(text: String): String {
        val msg = parseError(401, text)
        return if (msg.contains("Unauthorized", true) || msg == "HTTP 401") {
            "Hub data APIs need local mode (no Firebase) or a Firebase ID token. Chat via ah-… still works."
        } else msg
    }

    private fun parseError(code: Int, text: String): String {
        return try {
            val o = JSONObject(text)
            val err = o.optJSONObject("error")
            val msg = err?.optString("message") ?: o.optString("error")
            if (msg.isNotBlank()) msg else "HTTP $code"
        } catch (_: Exception) {
            if (text.contains("<html", ignoreCase = true)) {
                "Hub returned a web page, not the API. Use the hub root URL (no /chat)."
            } else {
                text.take(220).ifBlank { "HTTP $code" }
            }
        }
    }
}
