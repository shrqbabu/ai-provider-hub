package com.aihub.android.engine

import com.aihub.android.data.ChatTurn

fun estimateTokens(text: String): Int = (text.length + 3) / 4

fun compressPrompt(text: String, mode: String): String {
    if (text.isBlank() || mode == "off") return text
    var out = text.replace("\r\n", "\n")
        .replace(Regex("[ \\t]+\\n"), "\n")
        .replace(Regex("\\n{3,}"), "\n\n")
        .replace(Regex("[ \\t]{2,}"), " ")
        .trim()
    if (mode == "light") return out
    out = out.replace(Regex("<!--[\\s\\S]*?-->"), "")
        .replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
    val phrases = listOf(
        "I would like you to", "I want you to", "can you please", "could you please",
        "make sure to", "be sure to", "don't forget to", "it is important to note that",
        "due to the fact that", "in order to", "at this point in time",
    )
    for (p in phrases) out = out.replace(p, "", ignoreCase = true)
    out = out.replace(Regex("\\b(basically|actually|literally|honestly|obviously|really|quite|just)\\b", RegexOption.IGNORE_CASE), "")
    out = out.replace(Regex("[ \\t]{2,}"), " ").replace(Regex("\\n{3,}"), "\n\n").trim()
    if (mode == "aggressive" && out.length > 1600) {
        val head = out.take((out.length * 0.35).toInt().coerceAtLeast(80))
        val tail = out.takeLast((out.length * 0.18).toInt().coerceAtLeast(40))
        out = "$head\n[…]\n$tail"
    }
    return out.trim()
}

fun compressHistory(
    messages: List<ChatTurn>,
    budget: Int,
    mode: String,
    keepLast: Int,
): List<ChatTurn> {
    if (mode == "off") return messages
    fun cost(list: List<ChatTurn>) = list.sumOf { estimateTokens(it.content) }
    if (cost(messages) <= budget) return messages
    val keep = keepLast.coerceAtLeast(2)
    val out = messages.toMutableList()
    val lastKeepStart = (out.size - keep).coerceAtLeast(0)
    for (i in 0 until lastKeepStart) {
        if (cost(out) <= budget) break
        val m = out[i]
        if (m.role == "system") continue
        val c = m.content
        val next = when (mode) {
            "light" -> if (c.length > 900) c.take(400) + "\n[…compressed…]\n" + c.takeLast(200) else c
            "aggressive" -> c.split(Regex("(?<=[.!?।])\\s+")).firstOrNull()?.take(220) ?: c.take(220)
            else -> {
                val parts = c.split(Regex("(?<=[.!?।])\\s+")).filter { it.isNotBlank() }
                if (parts.size > 4) (parts.take(2) + "…" + parts.takeLast(1)).joinToString(" ")
                else if (c.length > 700) c.take((c.length * 0.35).toInt()) + " […]" + c.takeLast((c.length * 0.2).toInt())
                else compressPrompt(c, "smart")
            }
        }
        if (next != c) out[i] = m.copy(content = next)
    }
    var i = 0
    while (cost(out) > budget && out.size > keep && i < out.size - keep) {
        if (out[i].role != "system") {
            out[i] = out[i].copy(content = "[Earlier ${out[i].role} turn omitted to fit the token budget.]")
        }
        i++
    }
    return out
}
