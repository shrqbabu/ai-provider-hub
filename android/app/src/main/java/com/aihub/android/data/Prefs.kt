package com.aihub.android.data

import android.content.Context

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("aihub", Context.MODE_PRIVATE)

    var hubUrl: String
        get() = sp.getString("hubUrl", "")?.trim().orEmpty()
        set(v) { sp.edit().putString("hubUrl", v.trim().trimEnd('/')).apply() }

    var apiKey: String
        get() = sp.getString("apiKey", "")?.trim().orEmpty()
        set(v) { sp.edit().putString("apiKey", v.trim()).apply() }

    var lastModel: String
        get() = sp.getString("lastModel", "")?.orEmpty() ?: ""
        set(v) { sp.edit().putString("lastModel", v).apply() }

    var maxTokens: Int
        get() = sp.getInt("maxTokens", 0)
        set(v) { sp.edit().putInt("maxTokens", v).apply() }

    var tokenCompress: Boolean
        get() = sp.getBoolean("tokenCompress", true)
        set(v) { sp.edit().putBoolean("tokenCompress", v).apply() }

    var promptCompress: Boolean
        get() = sp.getBoolean("promptCompress", true)
        set(v) { sp.edit().putBoolean("promptCompress", v).apply() }

    var compressMode: String
        get() = sp.getString("compressMode", "smart") ?: "smart"
        set(v) { sp.edit().putString("compressMode", v).apply() }

    var keepLast: Int
        get() = sp.getInt("keepLast", 6)
        set(v) { sp.edit().putInt("keepLast", v).apply() }

    var threshold: Float
        get() = sp.getFloat("threshold", 0.75f)
        set(v) { sp.edit().putFloat("threshold", v).apply() }

    var contextPrompt: String
        get() = sp.getString("contextPrompt", "") ?: ""
        set(v) { sp.edit().putString("contextPrompt", v).apply() }

    fun isConnected(): Boolean = hubUrl.isNotBlank() && apiKey.isNotBlank()

    fun clearConnection() {
        sp.edit().remove("hubUrl").remove("apiKey").apply()
    }
}
