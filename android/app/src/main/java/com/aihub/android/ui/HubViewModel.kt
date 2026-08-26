package com.aihub.android.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.aihub.android.data.ChatTurn
import com.aihub.android.data.HubClient
import com.aihub.android.data.HubException
import com.aihub.android.data.HubModel
import com.aihub.android.data.Prefs
import com.aihub.android.engine.compressHistory
import com.aihub.android.engine.compressPrompt
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class UiMessage(
    val role: String,
    val content: String,
    val streaming: Boolean = false,
)

class HubViewModel(app: Application) : AndroidViewModel(app) {
    val prefs = Prefs(app)

    var hubUrl by mutableStateOf(prefs.hubUrl)
    var apiKey by mutableStateOf(prefs.apiKey)
    var connecting by mutableStateOf(false)
    var connectError by mutableStateOf<String?>(null)
    var connected by mutableStateOf(prefs.isConnected())

    var models by mutableStateOf<List<HubModel>>(emptyList())
    var modelsError by mutableStateOf<String?>(null)
    var loadingModels by mutableStateOf(false)
    var selectedModel by mutableStateOf(prefs.lastModel)

    var messages by mutableStateOf<List<UiMessage>>(emptyList())
    var input by mutableStateOf("")
    var sending by mutableStateOf(false)
    var streamError by mutableStateOf<String?>(null)
    var lastUsage by mutableStateOf<Pair<Int, Int>?>(null)

    var drawerOpen by mutableStateOf(false)
    var settingsOpen by mutableStateOf(false)
    var modelPickerOpen by mutableStateOf(false)
    var connectOpen by mutableStateOf(!prefs.isConnected())

    var maxTokens by mutableStateOf(prefs.maxTokens)
    var tokenCompress by mutableStateOf(prefs.tokenCompress)
    var promptCompress by mutableStateOf(prefs.promptCompress)
    var compressMode by mutableStateOf(prefs.compressMode)
    var keepLast by mutableStateOf(prefs.keepLast)
    var threshold by mutableStateOf(prefs.threshold)
    var contextPrompt by mutableStateOf(prefs.contextPrompt)

    init {
        if (connected) refreshModels()
    }

    fun persistSettings() {
        prefs.maxTokens = maxTokens
        prefs.tokenCompress = tokenCompress
        prefs.promptCompress = promptCompress
        prefs.compressMode = compressMode
        prefs.keepLast = keepLast
        prefs.threshold = threshold
        prefs.contextPrompt = contextPrompt
    }

    fun connect() {
        connecting = true
        connectError = null
        viewModelScope.launch {
            try {
                val url = hubUrl.trim().trimEnd('/')
                val key = apiKey.trim()
                if (url.isBlank()) throw HubException("Enter the hub URL from the web app.")
                if (!key.startsWith("ah-")) throw HubException("Gateway key must start with ah-")
                val list = withContext(Dispatchers.IO) {
                    val client = HubClient(url, key)
                    client.ping()
                    client.listModels()
                }
                prefs.hubUrl = url
                prefs.apiKey = key
                hubUrl = url
                models = list
                if (list.isEmpty()) {
                    modelsError = "Hub returned no models. Add a provider + API key in the web app, then refresh."
                    selectedModel = ""
                } else {
                    modelsError = null
                    if (selectedModel.isBlank() || list.none { it.id == selectedModel }) {
                        selectedModel = list.first().id
                        prefs.lastModel = selectedModel
                    }
                }
                connected = true
                connectOpen = false
            } catch (e: Exception) {
                connectError = e.message ?: "Could not reach hub"
                connected = false
                models = emptyList()
            } finally {
                connecting = false
            }
        }
    }

    fun disconnect() {
        prefs.clearConnection()
        connected = false
        connectOpen = true
        models = emptyList()
        messages = emptyList()
        selectedModel = ""
        modelsError = null
    }

    fun refreshModels() {
        if (!prefs.isConnected()) return
        loadingModels = true
        modelsError = null
        viewModelScope.launch {
            try {
                val list = withContext(Dispatchers.IO) {
                    HubClient(prefs.hubUrl, prefs.apiKey).listModels()
                }
                models = list
                if (list.isEmpty()) {
                    modelsError = "Hub returned no models. Add a provider + API key in the web app, then refresh."
                } else if (selectedModel.isBlank() || list.none { it.id == selectedModel }) {
                    selectedModel = list.first().id
                    prefs.lastModel = selectedModel
                }
            } catch (e: Exception) {
                models = emptyList()
                modelsError = e.message ?: "Failed to load models from hub"
            } finally {
                loadingModels = false
            }
        }
    }

    fun selectModel(id: String) {
        selectedModel = id
        prefs.lastModel = id
        modelPickerOpen = false
    }

    fun newChat() {
        messages = emptyList()
        streamError = null
        lastUsage = null
        drawerOpen = false
    }

    fun send() {
        val text = input.trim()
        if (text.isEmpty() || sending) return
        if (selectedModel.isBlank()) {
            streamError = "Pick a model from the hub first."
            return
        }
        persistSettings()
        input = ""
        streamError = null
        messages = messages + UiMessage("user", text)
        sending = true
        messages = messages + UiMessage("assistant", "", streaming = true)
        val assistantIndex = messages.lastIndex

        viewModelScope.launch {
            val acc = StringBuilder()
            val main = Handler(Looper.getMainLooper())
            try {
                val history = buildPayload()
                val usage = withContext(Dispatchers.IO) {
                    HubClient(prefs.hubUrl, prefs.apiKey).streamChat(
                        model = selectedModel,
                        messages = history,
                        maxTokens = maxTokens,
                        temperature = null,
                    ) { delta ->
                        acc.append(delta)
                        val snap = acc.toString()
                        main.post {
                            messages = messages.mapIndexed { i, m ->
                                if (i == assistantIndex) m.copy(content = snap, streaming = true) else m
                            }
                        }
                    }
                }
                lastUsage = usage
                val finalText = acc.toString().ifBlank { "(empty reply)" }
                messages = messages.mapIndexed { i, m ->
                    if (i == assistantIndex) m.copy(content = finalText, streaming = false) else m
                }
            } catch (e: Exception) {
                val err = e.message ?: "Request failed"
                streamError = err
                messages = messages.mapIndexed { i, m ->
                    if (i == assistantIndex) m.copy(content = "Error: $err", streaming = false) else m
                }
            } finally {
                sending = false
            }
        }
    }

    private fun buildPayload(): List<ChatTurn> {
        val sys = contextPrompt.trim()
        val turns = mutableListOf<ChatTurn>()
        if (sys.isNotEmpty()) turns += ChatTurn("system", sys)
        for (m in messages) {
            if (m.streaming && m.content.isEmpty()) continue
            if (m.content.startsWith("Error:")) continue
            turns += ChatTurn(m.role, m.content)
        }
        var out = turns.toList()
        if (promptCompress && compressMode != "off") {
            out = out.map { t ->
                if (t.role == "system" || t.role == "user") {
                    t.copy(content = compressPrompt(t.content, compressMode))
                } else t
            }
        }
        if (tokenCompress && compressMode != "off") {
            val budget = if (maxTokens > 0) {
                (maxTokens * threshold).toInt().coerceAtLeast(256)
            } else 6000
            out = compressHistory(out, budget, compressMode, keepLast)
        }
        return out
    }
}
