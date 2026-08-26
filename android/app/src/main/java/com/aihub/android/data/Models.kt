package com.aihub.android.data

import org.json.JSONArray
import org.json.JSONObject

data class HubModel(val id: String, val ownedBy: String) {
    val isCombo: Boolean get() = ownedBy.equals("combo", true)
}

data class ChatTurn(
    val role: String,
    val content: String,
    val attachments: List<Attachment> = emptyList(),
)

data class Attachment(
    val name: String,
    val mime: String,
    val dataUrl: String,
)

data class UiMessage(
    val id: String,
    val role: String,
    val content: String,
    val streaming: Boolean = false,
    val attachments: List<Attachment> = emptyList(),
    val error: String? = null,
    val tokensIn: Int = 0,
    val tokensOut: Int = 0,
)

data class ChatSession(
    val id: String,
    val title: String,
    val modelId: String,
    val messages: List<UiMessage>,
    val createdAt: Long,
    val updatedAt: Long,
    val pinned: Boolean = false,
    val favorite: Boolean = false,
    val deleted: Boolean = false,
    val systemPrompt: String = "",
    val contextPromptId: String = "",
    val maxTokens: Int = 0,
    val tokenCompress: Boolean? = null,
    val promptCompress: Boolean? = null,
    val compressMode: String? = null,
)

data class HubProvider(
    val id: String,
    val key: String,
    val name: String,
    val displayName: String,
    val authMode: String,
    val apiKey: String,
    val apiKeys: List<String>,
    val cookie: String,
    val apiFormat: String,
    val baseURL: String,
    val extraHeaders: Map<String, String>,
    val disabled: Boolean,
    val streaming: Boolean,
    val vision: Boolean,
    val email: String,
)

data class HubDiscoveredModel(
    val id: String,
    val providerId: String,
    val providerKey: String,
    val modelId: String,
    val displayName: String,
    val contextWindow: Int,
    val tokenLimit: Int,
    val maxTokens: Int,
    val temperature: Double?,
    val contextPromptId: String,
    val customSystemPrompt: String,
    val tokenCompress: Boolean?,
    val promptCompress: Boolean?,
    val compressMode: String?,
    val vision: Boolean,
    val pdf: Boolean,
    val streaming: Boolean,
    val toolCalling: Boolean,
    val reasoning: Boolean,
    val favorite: Boolean,
    val disabled: Boolean,
    val inputPrice: Double?,
    val outputPrice: Double?,
)

data class HubCombo(
    val id: String,
    val name: String,
    val description: String,
    val members: List<Pair<String, String>>,
    val createdAt: Long,
    val updatedAt: Long,
)

data class HubPrompt(
    val id: String,
    val title: String,
    val content: String,
    val kind: String,
    val favorite: Boolean,
    val tags: List<String>,
)

data class KeyStoreItem(
    val id: String,
    val label: String,
    val keyValue: String,
    val createdAt: Long,
)

data class GatewayKeyMeta(
    val id: String,
    val label: String,
    val last4: String,
    val createdAt: Long,
    val revoked: Boolean,
)

data class UsageEntry(
    val id: String,
    val providerId: String,
    val modelId: String,
    val tokensIn: Int,
    val tokensOut: Int,
    val cost: Double,
    val durationMs: Long,
    val createdAt: Long,
)

data class ComboLog(
    val id: String,
    val comboName: String,
    val respondingModel: String,
    val tokensIn: Int,
    val tokensOut: Int,
    val durationMs: Long,
    val createdAt: Long,
)

data class QuotaRow(
    val model: String,
    val family: String,
    val remaining: Double?,
    val resetTime: String?,
    val source: String,
)

data class ProviderKind(
    val key: String,
    val label: String,
    val baseURL: String,
    val apiFormat: String,
)

val PROVIDER_KINDS = listOf(
    ProviderKind("openai", "OpenAI", "https://api.openai.com/v1", "openai"),
    ProviderKind("anthropic", "Claude (Anthropic)", "https://api.anthropic.com/v1", "anthropic"),
    ProviderKind("google", "Google AI Studio", "https://generativelanguage.googleapis.com/v1", "openai"),
    ProviderKind("nvidia", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1", "openai"),
    ProviderKind("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "openai"),
    ProviderKind("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "openai"),
    ProviderKind("grok", "Grok (xAI)", "https://api.x.ai/v1", "openai"),
    ProviderKind("custom", "OpenAI-compatible", "", "openai"),
)

fun JSONObject.str(key: String, fallback: String = ""): String =
    if (isNull(key)) fallback else optString(key, fallback)

fun JSONObject.bool(key: String, fallback: Boolean = false): Boolean =
    if (!has(key) || isNull(key)) fallback else optBoolean(key, fallback)

fun JSONObject.int(key: String, fallback: Int = 0): Int =
    if (!has(key) || isNull(key)) fallback else optInt(key, fallback)

fun JSONObject.lng(key: String, fallback: Long = 0L): Long =
    if (!has(key) || isNull(key)) fallback else optLong(key, fallback)

fun JSONObject.dblOrNull(key: String): Double? =
    if (!has(key) || isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }

fun JSONArray.toObjList(): List<JSONObject> =
    (0 until length()).mapNotNull { optJSONObject(it) }

fun parseProviders(arr: JSONArray): List<HubProvider> = arr.toObjList().map { o ->
    val extra = mutableMapOf<String, String>()
    val eh = o.optJSONObject("extraHeaders")
    if (eh != null) eh.keys().forEach { extra[it] = eh.optString(it) }
    val keys = o.optJSONArray("apiKeys")
    val more = if (keys != null) (0 until keys.length()).map { keys.optString(it) }.filter { it.isNotBlank() } else emptyList()
    HubProvider(
        id = o.str("id"),
        key = o.str("key"),
        name = o.str("name"),
        displayName = o.str("displayName").ifBlank { o.str("name") },
        authMode = o.str("authMode", "apiKey"),
        apiKey = o.str("apiKey"),
        apiKeys = more,
        cookie = o.str("cookie"),
        apiFormat = o.str("apiFormat", "openai"),
        baseURL = o.str("baseURL"),
        extraHeaders = extra,
        disabled = o.bool("disabled"),
        streaming = o.bool("streaming", true),
        vision = o.bool("vision"),
        email = o.str("email"),
    )
}

fun HubProvider.toJson(): JSONObject {
    val o = JSONObject()
        .put("id", id)
        .put("key", key)
        .put("name", name)
        .put("displayName", displayName)
        .put("authMode", authMode)
        .put("apiKey", apiKey)
        .put("cookie", cookie)
        .put("apiFormat", apiFormat)
        .put("baseURL", baseURL)
        .put("disabled", disabled)
        .put("streaming", streaming)
        .put("vision", vision)
        .put("email", email)
        .put("connectedAt", System.currentTimeMillis())
        .put("fileUpload", false)
    val ks = JSONArray()
    apiKeys.forEach { ks.put(it) }
    o.put("apiKeys", ks)
    val eh = JSONObject()
    extraHeaders.forEach { (k, v) -> eh.put(k, v) }
    o.put("extraHeaders", eh)
    return o
}

fun parseDiscovered(arr: JSONArray): List<HubDiscoveredModel> = arr.toObjList().map { o ->
    HubDiscoveredModel(
        id = o.str("id"),
        providerId = o.str("providerId"),
        providerKey = o.str("providerKey"),
        modelId = o.str("modelId").ifBlank { o.str("id") },
        displayName = o.str("displayName").ifBlank { o.str("modelId") },
        contextWindow = o.int("contextWindow"),
        tokenLimit = o.int("tokenLimit"),
        maxTokens = o.int("maxTokens"),
        temperature = o.dblOrNull("temperature"),
        contextPromptId = o.str("contextPromptId"),
        customSystemPrompt = o.str("customSystemPrompt"),
        tokenCompress = if (o.has("tokenCompress") && !o.isNull("tokenCompress")) o.optBoolean("tokenCompress") else null,
        promptCompress = if (o.has("promptCompress") && !o.isNull("promptCompress")) o.optBoolean("promptCompress") else null,
        compressMode = o.str("compressMode").ifBlank { null },
        vision = o.bool("vision"),
        pdf = o.bool("pdf"),
        streaming = o.bool("streaming", true),
        toolCalling = o.bool("toolCalling"),
        reasoning = o.bool("reasoning"),
        favorite = o.bool("favorite"),
        disabled = o.bool("disabled"),
        inputPrice = o.dblOrNull("inputPrice"),
        outputPrice = o.dblOrNull("outputPrice"),
    )
}

fun HubDiscoveredModel.toJson(): JSONObject {
    val o = JSONObject()
        .put("id", id)
        .put("providerId", providerId)
        .put("providerKey", providerKey)
        .put("modelId", modelId)
        .put("displayName", displayName)
        .put("contextWindow", contextWindow)
        .put("tokenLimit", tokenLimit)
        .put("maxTokens", maxTokens)
        .put("contextPromptId", contextPromptId)
        .put("customSystemPrompt", customSystemPrompt)
        .put("vision", vision)
        .put("pdf", pdf)
        .put("streaming", streaming)
        .put("toolCalling", toolCalling)
        .put("reasoning", reasoning)
        .put("favorite", favorite)
        .put("disabled", disabled)
    o.put("temperature", temperature ?: JSONObject.NULL)
    o.put("tokenCompress", tokenCompress ?: JSONObject.NULL)
    o.put("promptCompress", promptCompress ?: JSONObject.NULL)
    o.put("compressMode", compressMode ?: JSONObject.NULL)
    o.put("inputPrice", inputPrice ?: JSONObject.NULL)
    o.put("outputPrice", outputPrice ?: JSONObject.NULL)
    return o
}

fun parseCombos(arr: JSONArray): List<HubCombo> = arr.toObjList().map { o ->
    val mem = o.optJSONArray("members") ?: JSONArray()
    val members = mem.toObjList().map { m -> m.str("providerId") to m.str("modelId") }
    HubCombo(
        id = o.str("id"),
        name = o.str("name"),
        description = o.str("description"),
        members = members,
        createdAt = o.lng("createdAt"),
        updatedAt = o.lng("updatedAt"),
    )
}

fun HubCombo.toJson(): JSONObject {
    val mem = JSONArray()
    members.forEach { (p, m) -> mem.put(JSONObject().put("providerId", p).put("modelId", m)) }
    return JSONObject()
        .put("id", id)
        .put("name", name)
        .put("description", description)
        .put("members", mem)
        .put("createdAt", createdAt)
        .put("updatedAt", updatedAt)
}

fun parsePrompts(arr: JSONArray): List<HubPrompt> = arr.toObjList().map { o ->
    val tags = o.optJSONArray("tags")
    HubPrompt(
        id = o.str("id"),
        title = o.str("title"),
        content = o.str("content"),
        kind = o.str("kind", "context"),
        favorite = o.bool("favorite"),
        tags = if (tags != null) (0 until tags.length()).map { tags.optString(it) } else emptyList(),
    )
}

fun HubPrompt.toJson(): JSONObject {
    val tags = JSONArray()
    this.tags.forEach { tags.put(it) }
    return JSONObject()
        .put("id", id)
        .put("title", title)
        .put("content", content)
        .put("kind", kind)
        .put("favorite", favorite)
        .put("tags", tags)
        .put("updatedAt", System.currentTimeMillis())
}

fun parseKeyStore(arr: JSONArray): List<KeyStoreItem> = arr.toObjList().map { o ->
    KeyStoreItem(o.str("id"), o.str("label"), o.str("keyValue"), o.lng("createdAt"))
}

fun KeyStoreItem.toJson(): JSONObject = JSONObject()
    .put("id", id).put("label", label).put("keyValue", keyValue).put("createdAt", createdAt)

fun parseUsage(arr: JSONArray): List<UsageEntry> = arr.toObjList().map { o ->
    UsageEntry(
        id = o.str("id"),
        providerId = o.str("providerId"),
        modelId = o.str("modelId"),
        tokensIn = o.int("tokensIn"),
        tokensOut = o.int("tokensOut"),
        cost = o.optDouble("cost", 0.0),
        durationMs = o.lng("durationMs"),
        createdAt = o.lng("createdAt"),
    )
}

fun UsageEntry.toJson(): JSONObject = JSONObject()
    .put("id", id).put("providerId", providerId).put("modelId", modelId)
    .put("tokensIn", tokensIn).put("tokensOut", tokensOut).put("cost", cost)
    .put("durationMs", durationMs).put("createdAt", createdAt)

fun parseComboLogs(arr: JSONArray): List<ComboLog> = arr.toObjList().map { o ->
    ComboLog(
        id = o.str("id"),
        comboName = o.str("comboName"),
        respondingModel = o.str("respondingModelName").ifBlank { o.str("respondingModelId") },
        tokensIn = o.int("tokensIn"),
        tokensOut = o.int("tokensOut"),
        durationMs = o.lng("durationMs"),
        createdAt = o.lng("createdAt"),
    )
}

fun toJsonArray(list: List<JSONObject>): JSONArray {
    val a = JSONArray()
    list.forEach { a.put(it) }
    return a
}

fun unwrapValueArray(text: String): JSONArray {
    val root = JSONObject(text)
    val v = root.opt("value")
    return when (v) {
        is JSONArray -> v
        is JSONObject -> JSONArray().put(v)
        JSONObject.NULL, null -> JSONArray()
        else -> JSONArray()
    }
}

fun unwrapValueObject(text: String): JSONObject? {
    val root = JSONObject(text)
    val v = root.opt("value")
    return v as? JSONObject
}
