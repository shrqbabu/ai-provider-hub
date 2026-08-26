package com.aihub.android.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** On-device cache of hub collections + chats. Never ships a catalog. */
class LocalStore(context: Context) {
    private val sp = context.getSharedPreferences("aihub_store", Context.MODE_PRIVATE)

    fun getText(key: String): String? = sp.getString(key, null)

    fun setText(key: String, value: String) {
        sp.edit().putString(key, value).apply()
    }

    fun loadChats(): List<ChatSession> {
        val raw = getText("chats") ?: return emptyList()
        return try {
            parseChats(JSONArray(raw))
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun saveChats(list: List<ChatSession>) {
        setText("chats", chatsToJson(list).toString())
    }

    companion object {
        fun parseChats(arr: JSONArray): List<ChatSession> = arr.toObjList().map { o ->
            val msgs = (o.optJSONArray("messages") ?: JSONArray()).toObjList().map { m ->
                val atts = (m.optJSONArray("attachments") ?: JSONArray()).toObjList().map { a ->
                    Attachment(a.str("name"), a.str("type").ifBlank { a.str("mime") }, a.str("dataUrl"))
                }
                UiMessage(
                    id = m.str("id"),
                    role = m.str("role"),
                    content = m.str("content"),
                    attachments = atts,
                    error = m.str("error").ifBlank { null },
                    tokensIn = m.int("tokensIn"),
                    tokensOut = m.int("tokensOut"),
                )
            }
            ChatSession(
                id = o.str("id"),
                title = o.str("title"),
                modelId = o.str("modelId"),
                messages = msgs,
                createdAt = o.lng("createdAt"),
                updatedAt = o.lng("updatedAt"),
                pinned = o.bool("pinned"),
                favorite = o.bool("favorite"),
                deleted = o.bool("deleted"),
                systemPrompt = o.str("systemPrompt"),
                contextPromptId = o.str("contextPromptId"),
                maxTokens = o.int("maxTokens"),
                tokenCompress = if (o.has("tokenCompress") && !o.isNull("tokenCompress")) o.optBoolean("tokenCompress") else null,
                promptCompress = if (o.has("promptCompress") && !o.isNull("promptCompress")) o.optBoolean("promptCompress") else null,
                compressMode = o.str("compressMode").ifBlank { null },
            )
        }

        fun chatsToJson(list: List<ChatSession>): JSONArray {
            val arr = JSONArray()
            for (c in list) {
                val msgs = JSONArray()
                for (m in c.messages) {
                    val atts = JSONArray()
                    m.attachments.forEach { a ->
                        atts.put(JSONObject().put("name", a.name).put("type", a.mime).put("dataUrl", a.dataUrl))
                    }
                    msgs.put(
                        JSONObject()
                            .put("id", m.id)
                            .put("role", m.role)
                            .put("content", m.content)
                            .put("attachments", atts)
                            .put("createdAt", c.updatedAt)
                            .put("tokensIn", m.tokensIn)
                            .put("tokensOut", m.tokensOut)
                            .put("error", m.error ?: JSONObject.NULL),
                    )
                }
                arr.put(
                    JSONObject()
                        .put("id", c.id)
                        .put("title", c.title)
                        .put("modelId", c.modelId)
                        .put("messages", msgs)
                        .put("createdAt", c.createdAt)
                        .put("updatedAt", c.updatedAt)
                        .put("pinned", c.pinned)
                        .put("favorite", c.favorite)
                        .put("deleted", c.deleted)
                        .put("systemPrompt", c.systemPrompt)
                        .put("contextPromptId", c.contextPromptId)
                        .put("maxTokens", c.maxTokens)
                        .put("tokenCompress", c.tokenCompress ?: JSONObject.NULL)
                        .put("promptCompress", c.promptCompress ?: JSONObject.NULL)
                        .put("compressMode", c.compressMode ?: JSONObject.NULL),
                )
            }
            return arr
        }
    }
}
