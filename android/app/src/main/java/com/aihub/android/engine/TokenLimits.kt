package com.aihub.android.engine

import com.aihub.android.data.HubDiscoveredModel

fun resolveMaxTokens(
    chatMax: Int,
    model: HubDiscoveredModel?,
    settingsMax: Int,
    modelId: String,
): Int {
    if (chatMax > 0) return chatMax
    if (model != null && model.maxTokens > 0) return model.maxTokens
    if (settingsMax > 0) return settingsMax
    val id = modelId.lowercase()
    val reasoning = model?.reasoning == true ||
        id.contains("o1") || id.contains("o3") || id.contains("deepseek-r1") ||
        id.contains("qwq") || id.contains("thinking")
    return if (reasoning) 32768 else 16384
}

fun resolveInputBudget(
    model: HubDiscoveredModel?,
    reserve: Int,
    threshold: Float,
): Int {
    val window = when {
        model != null && model.tokenLimit > 0 -> model.tokenLimit
        model != null && model.contextWindow > 0 -> model.contextWindow
        else -> 128000
    }
    val usable = (window - reserve.coerceAtLeast(0)).coerceAtLeast(256)
    return (usable * threshold).toInt().coerceAtLeast(256)
}

fun looksCutOff(text: String): Boolean {
    val t = text.trim()
    if (t.isEmpty()) return true
    val ticks = t.count { it == '`' }
    if (ticks % 2 == 1) return true
    val last = t.last()
    return last !in ".!?。？！…\"'”’)"
}
