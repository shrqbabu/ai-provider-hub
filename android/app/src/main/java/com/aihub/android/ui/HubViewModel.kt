package com.aihub.android.ui

import android.app.Application
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.aihub.android.data.Attachment
import com.aihub.android.data.ChatSession
import com.aihub.android.data.ChatTurn
import com.aihub.android.data.ComboLog
import com.aihub.android.data.GatewayKeyMeta
import com.aihub.android.data.HubClient
import com.aihub.android.data.HubCombo
import com.aihub.android.data.HubDiscoveredModel
import com.aihub.android.data.HubException
import com.aihub.android.data.HubModel
import com.aihub.android.data.HubPrompt
import com.aihub.android.data.HubProvider
import com.aihub.android.data.KeyStoreItem
import com.aihub.android.data.LocalStore
import com.aihub.android.data.Prefs
import com.aihub.android.data.QuotaRow
import com.aihub.android.data.UiMessage
import com.aihub.android.data.UsageEntry
import com.aihub.android.data.parseComboLogs
import com.aihub.android.data.parseCombos
import com.aihub.android.data.parseDiscovered
import com.aihub.android.data.parseKeyStore
import com.aihub.android.data.parsePrompts
import com.aihub.android.data.parseProviders
import com.aihub.android.data.parseUsage
import com.aihub.android.data.toJson
import com.aihub.android.data.toJsonArray
import com.aihub.android.engine.compressHistory
import com.aihub.android.engine.compressPrompt
import com.aihub.android.engine.estimateTokens
import com.aihub.android.engine.looksCutOff
import com.aihub.android.engine.resolveInputBudget
import com.aihub.android.engine.resolveMaxTokens
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID

class HubViewModel(app: Application) : AndroidViewModel(app) {
    val prefs = Prefs(app)
    private val store = LocalStore(app)
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var liveClient: HubClient? = null

    var hubUrl by mutableStateOf(prefs.hubUrl)
    var apiKey by mutableStateOf(prefs.apiKey)
    var connecting by mutableStateOf(false)
    var connectError by mutableStateOf<String?>(null)
    var connected by mutableStateOf(prefs.isConnected())
    var connectOpen by mutableStateOf(!prefs.isConnected())

    var models by mutableStateOf<List<HubModel>>(emptyList())
    var modelsError by mutableStateOf<String?>(null)
    var loadingModels by mutableStateOf(false)
    var selectedModel by mutableStateOf(prefs.lastModel)

    var chats by mutableStateOf(store.loadChats())
    var currentId by mutableStateOf<String?>(null)
    val current: ChatSession?
        get() = chats.firstOrNull { it.id == currentId }

    var input by mutableStateOf("")
    var pendingAttach by mutableStateOf<List<Attachment>>(emptyList())
    var sending by mutableStateOf(false)
    var streamError by mutableStateOf<String?>(null)
    var lastUsage by mutableStateOf<Pair<Int, Int>?>(null)
    var snack by mutableStateOf<String?>(null)
    var chatSearch by mutableStateOf("")

    var drawerOpen by mutableStateOf(false)
    var settingsOpen by mutableStateOf(false)
    var modelPickerOpen by mutableStateOf(false)
    var plusOpen by mutableStateOf(false)
    var route by mutableStateOf("chat")

    var maxTokens by mutableStateOf(prefs.maxTokens)
    var tokenCompress by mutableStateOf(prefs.tokenCompress)
    var promptCompress by mutableStateOf(prefs.promptCompress)
    var compressMode by mutableStateOf(prefs.compressMode)
    var keepLast by mutableStateOf(prefs.keepLast)
    var threshold by mutableStateOf(prefs.threshold)
    var reserveTokens by mutableStateOf(prefs.reserveTokens)
    var contextPrompt by mutableStateOf(prefs.contextPrompt)
    var defaultContextPromptId by mutableStateOf(prefs.defaultContextPromptId)
    var theme by mutableStateOf(prefs.theme)

    var providers by mutableStateOf<List<HubProvider>>(emptyList())
    var customModels by mutableStateOf<List<HubDiscoveredModel>>(emptyList())
    var combos by mutableStateOf<List<HubCombo>>(emptyList())
    var prompts by mutableStateOf<List<HubPrompt>>(emptyList())
    var keyStore by mutableStateOf<List<KeyStoreItem>>(emptyList())
    var gatewayKeys by mutableStateOf<List<GatewayKeyMeta>>(emptyList())
    var usage by mutableStateOf<List<UsageEntry>>(emptyList())
    var comboLogs by mutableStateOf<List<ComboLog>>(emptyList())
    var quotaLabel by mutableStateOf("")
    var quotaRows by mutableStateOf<List<QuotaRow>>(emptyList())
    var dataError by mutableStateOf<String?>(null)
    var dataLoading by mutableStateOf(false)
    var newRawKey by mutableStateOf<String?>(null)
    var editingModel by mutableStateOf<HubDiscoveredModel?>(null)
    var studioIn by mutableStateOf("")
    var studioMode by mutableStateOf(prefs.compressMode)

    init {
        if (connected) {
            refreshModels()
            hydrateHub()
        }
        if (currentId == null) {
            val live = chats.filter { !it.deleted }.sortedWith(
                compareByDescending<ChatSession> { it.pinned }.thenByDescending { it.updatedAt },
            )
            currentId = live.firstOrNull()?.id
        }
    }

    private fun client(): HubClient {
        val c = HubClient(prefs.hubUrl, prefs.apiKey)
        liveClient = c
        return c
    }

    fun persistSettings() {
        prefs.maxTokens = maxTokens
        prefs.tokenCompress = tokenCompress
        prefs.promptCompress = promptCompress
        prefs.compressMode = compressMode
        prefs.keepLast = keepLast
        prefs.threshold = threshold
        prefs.reserveTokens = reserveTokens
        prefs.contextPrompt = contextPrompt
        prefs.defaultContextPromptId = defaultContextPromptId
        prefs.theme = theme
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
                    val c = HubClient(url, key)
                    c.ping()
                    c.listModels()
                }
                prefs.hubUrl = url
                prefs.apiKey = key
                hubUrl = url
                models = list
                modelsError = if (list.isEmpty()) {
                    "Hub returned no models. Add a provider in Providers, then refresh."
                } else null
                if (list.isNotEmpty() && (selectedModel.isBlank() || list.none { it.id == selectedModel })) {
                    selectedModel = list.first().id
                    prefs.lastModel = selectedModel
                }
                connected = true
                connectOpen = false
                hydrateHub()
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
        providers = emptyList()
        customModels = emptyList()
        selectedModel = ""
        modelsError = null
        route = "chat"
    }

    fun refreshModels() {
        if (!prefs.isConnected()) return
        loadingModels = true
        modelsError = null
        viewModelScope.launch {
            try {
                val list = withContext(Dispatchers.IO) { client().listModels() }
                models = list
                if (list.isEmpty()) {
                    modelsError = "Hub returned no models. Add a provider + API key, then refresh."
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

    fun hydrateHub() {
        if (!prefs.isConnected()) return
        dataLoading = true
        dataError = null
        viewModelScope.launch {
            try {
                val c = client()
                val p = withContext(Dispatchers.IO) { runCatching { parseProviders(c.getDataArray("providers")) }.getOrElse { emptyList() } }
                val m = withContext(Dispatchers.IO) { runCatching { parseDiscovered(c.getDataArray("models")) }.getOrElse { emptyList() } }
                val co = withContext(Dispatchers.IO) { runCatching { parseCombos(c.getDataArray("combos")) }.getOrElse { emptyList() } }
                val pr = withContext(Dispatchers.IO) { runCatching { parsePrompts(c.getDataArray("prompts")) }.getOrElse { emptyList() } }
                val ks = withContext(Dispatchers.IO) { runCatching { parseKeyStore(c.getDataArray("keystore")) }.getOrElse { emptyList() } }
                val us = withContext(Dispatchers.IO) { runCatching { parseUsage(c.getDataArray("usage")) }.getOrElse { emptyList() } }
                val cl = withContext(Dispatchers.IO) { runCatching { parseComboLogs(c.getDataArray("combo_logs")) }.getOrElse { emptyList() } }
                val remoteChats = withContext(Dispatchers.IO) { runCatching { LocalStore.parseChats(c.getDataArray("chats")) }.getOrNull() }
                val keys = withContext(Dispatchers.IO) { runCatching { c.listGatewayKeys() }.getOrElse { emptyList() } }
                val settings = withContext(Dispatchers.IO) { runCatching { c.getDataObject("settings") }.getOrNull() }
                providers = p
                customModels = m
                combos = co
                prompts = pr
                keyStore = ks
                usage = us
                comboLogs = cl
                gatewayKeys = keys
                if (!remoteChats.isNullOrEmpty()) {
                    val merged = mergeChats(store.loadChats(), remoteChats)
                    chats = merged
                    store.saveChats(merged)
                }
                if (settings != null) applyRemoteSettings(settings)
            } catch (e: Exception) {
                dataError = e.message
            } finally {
                dataLoading = false
            }
        }
    }

    private fun mergeChats(local: List<ChatSession>, remote: List<ChatSession>): List<ChatSession> {
        val map = LinkedHashMap<String, ChatSession>()
        for (c in remote) map[c.id] = c
        for (c in local) {
            val prev = map[c.id]
            if (prev == null || c.updatedAt >= prev.updatedAt) map[c.id] = c
        }
        return map.values.sortedByDescending { it.updatedAt }
    }

    private fun applyRemoteSettings(o: JSONObject) {
        if (o.has("maxTokens")) maxTokens = o.optInt("maxTokens", maxTokens)
        if (o.has("tokenCompress")) tokenCompress = o.optBoolean("tokenCompress", tokenCompress)
        if (o.has("promptCompress")) promptCompress = o.optBoolean("promptCompress", promptCompress)
        val mode = o.optString("tokenCompressMode").ifBlank { o.optString("compressMode") }
        if (mode.isNotBlank()) compressMode = mode
        if (o.has("keepLastMessages")) keepLast = o.optInt("keepLastMessages", keepLast)
        if (o.has("tokenCompressThreshold")) threshold = o.optDouble("tokenCompressThreshold", threshold.toDouble()).toFloat()
        if (o.has("contextReserveTokens")) reserveTokens = o.optInt("contextReserveTokens", reserveTokens)
        if (o.has("defaultContextPromptId")) defaultContextPromptId = o.optString("defaultContextPromptId")
        if (o.has("theme")) theme = o.optString("theme", theme)
        persistSettings()
    }

    private fun persistChats(next: List<ChatSession>, remote: Boolean = true) {
        chats = next
        store.saveChats(next)
        if (remote) {
            viewModelScope.launch(Dispatchers.IO) {
                runCatching { client().putData("chats", LocalStore.chatsToJson(next)) }
            }
        }
    }

    private fun updateCurrent(transform: (ChatSession) -> ChatSession) {
        val id = currentId ?: return
        persistChats(chats.map { if (it.id == id) transform(it) else it })
    }

    fun selectModel(id: String) {
        selectedModel = id
        prefs.lastModel = id
        modelPickerOpen = false
        updateCurrent { it.copy(modelId = id, updatedAt = System.currentTimeMillis()) }
    }

    fun openRoute(r: String) {
        route = r
        drawerOpen = false
        if (r != "chat") hydrateHub()
        if (r == "quota") loadQuota()
    }

    fun newChat() {
        val now = System.currentTimeMillis()
        val session = ChatSession(
            id = UUID.randomUUID().toString(),
            title = "New chat",
            modelId = selectedModel,
            messages = emptyList(),
            createdAt = now,
            updatedAt = now,
        )
        persistChats(listOf(session) + chats)
        currentId = session.id
        streamError = null
        lastUsage = null
        drawerOpen = false
        route = "chat"
    }

    fun openChat(id: String) {
        currentId = id
        route = "chat"
        drawerOpen = false
        streamError = null
    }

    fun renameChat(id: String, title: String) {
        persistChats(chats.map { if (it.id == id) it.copy(title = title.ifBlank { it.title }, updatedAt = System.currentTimeMillis()) else it })
    }

    fun togglePin(id: String) {
        persistChats(chats.map { if (it.id == id) it.copy(pinned = !it.pinned, updatedAt = System.currentTimeMillis()) else it })
    }

    fun toggleFavorite(id: String) {
        persistChats(chats.map { if (it.id == id) it.copy(favorite = !it.favorite, updatedAt = System.currentTimeMillis()) else it })
    }

    fun softDelete(id: String) {
        persistChats(chats.map { if (it.id == id) it.copy(deleted = true, updatedAt = System.currentTimeMillis()) else it })
        if (currentId == id) {
            currentId = chats.firstOrNull { !it.deleted && it.id != id }?.id
        }
    }

    fun restoreChat(id: String) {
        persistChats(chats.map { if (it.id == id) it.copy(deleted = false, updatedAt = System.currentTimeMillis()) else it })
    }

    fun emptyTrash() {
        persistChats(chats.filter { !it.deleted })
    }

    fun addAttachment(a: Attachment) {
        pendingAttach = pendingAttach + a
        plusOpen = false
    }

    fun removeAttachment(name: String) {
        pendingAttach = pendingAttach.filterNot { it.name == name }
    }

    fun stop() {
        liveClient?.stop()
        sending = false
    }

    fun send() {
        val text = input.trim()
        if ((text.isEmpty() && pendingAttach.isEmpty()) || sending) return
        if (selectedModel.isBlank()) {
            streamError = "Pick a model from the hub first."
            return
        }
        persistSettings()
        if (currentId == null || current == null || current?.deleted == true) newChat()
        val chatId = currentId ?: return
        input = ""
        val atts = pendingAttach
        pendingAttach = emptyList()
        streamError = null
        val user = UiMessage(UUID.randomUUID().toString(), "user", text, attachments = atts)
        val asst = UiMessage(UUID.randomUUID().toString(), "assistant", "", streaming = true)
        updateCurrent { c ->
            val title = if (c.messages.isEmpty()) text.take(48).ifBlank { c.title } else c.title
            c.copy(
                title = title,
                modelId = selectedModel,
                messages = c.messages + user + asst,
                updatedAt = System.currentTimeMillis(),
            )
        }
        sending = true
        val assistantId = asst.id
        viewModelScope.launch { runStream(chatId, assistantId, continueFrom = null, resumes = 0, continues = 0) }
    }

    fun retryLast() {
        val c = current ?: return
        val lastUser = c.messages.lastOrNull { it.role == "user" } ?: return
        persistChats(chats.map {
            if (it.id != c.id) it
            else it.copy(messages = it.messages.dropLastWhile { m -> m.role == "assistant" }, updatedAt = System.currentTimeMillis())
        })
        input = lastUser.content
        pendingAttach = lastUser.attachments
        send()
    }

    fun deleteMessage(id: String) {
        updateCurrent { c -> c.copy(messages = c.messages.filterNot { it.id == id }, updatedAt = System.currentTimeMillis()) }
    }

    private suspend fun runStream(
        chatId: String,
        assistantId: String,
        continueFrom: String?,
        resumes: Int,
        continues: Int,
    ) {
        val acc = StringBuilder(continueFrom.orEmpty())
        try {
            val history = buildPayload(chatId, continueFrom != null)
            val modelMeta = customModels.firstOrNull { it.modelId == selectedModel || it.id == selectedModel }
            val cap = resolveMaxTokens(current?.maxTokens ?: 0, modelMeta, maxTokens, selectedModel)
            val usage = withContext(Dispatchers.IO) {
                client().streamChat(
                    model = selectedModel,
                    messages = history,
                    maxTokens = cap,
                    temperature = modelMeta?.temperature,
                ) { delta ->
                    acc.append(delta)
                    val snap = acc.toString()
                    main.post { patchAssistant(chatId, assistantId, snap, true, null) }
                }
            }
            lastUsage = usage.promptTokens to usage.completionTokens
            var text = acc.toString()
            if (usage.finishReason == "length" && continues < 4) {
                patchAssistant(chatId, assistantId, text, true, null)
                runStream(chatId, assistantId, text, resumes, continues + 1)
                return
            }
            if (text.isNotBlank() && looksCutOff(text) && resumes < 2) {
                patchAssistant(chatId, assistantId, text, true, null)
                runStream(chatId, assistantId, text, resumes + 1, continues)
                return
            }
            if (text.isBlank()) text = "(empty reply)"
            patchAssistant(chatId, assistantId, text, false, null)
            recordUsage(usage.promptTokens, usage.completionTokens)
        } catch (e: Exception) {
            val err = e.message ?: "Request failed"
            if (err.contains("Canceled", true) || err.contains("Socket closed", true)) {
                patchAssistant(chatId, assistantId, acc.toString().ifBlank { "(stopped)" }, false, null)
            } else {
                streamError = err
                patchAssistant(chatId, assistantId, acc.toString(), false, err)
            }
        } finally {
            sending = false
        }
    }

    private fun patchAssistant(chatId: String, assistantId: String, text: String, streaming: Boolean, error: String?) {
        persistChats(
            chats.map { c ->
                if (c.id != chatId) c
                else c.copy(
                    messages = c.messages.map { m ->
                        if (m.id == assistantId) m.copy(content = text, streaming = streaming, error = error) else m
                    },
                    updatedAt = System.currentTimeMillis(),
                )
            },
            remote = !streaming,
        )
    }

    private fun recordUsage(tin: Int, tout: Int) {
        val entry = UsageEntry(
            id = UUID.randomUUID().toString(),
            providerId = "",
            modelId = selectedModel,
            tokensIn = tin,
            tokensOut = tout,
            cost = 0.0,
            durationMs = 0,
            createdAt = System.currentTimeMillis(),
        )
        usage = listOf(entry) + usage
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { client().putData("usage", toJsonArray(usage.map { it.toJson() })) }
        }
    }

    private fun buildPayload(chatId: String, continuing: Boolean): List<ChatTurn> {
        val chat = chats.firstOrNull { it.id == chatId }
        val modelMeta = customModels.firstOrNull { it.modelId == selectedModel || it.id == selectedModel }
        val promptId = chat?.contextPromptId?.ifBlank { null }
            ?: modelMeta?.contextPromptId?.ifBlank { null }
            ?: defaultContextPromptId.ifBlank { null }
        val library = prompts.firstOrNull { it.id == promptId && it.kind != "snippet" }?.content.orEmpty()
        val sysParts = listOf(
            library,
            modelMeta?.customSystemPrompt.orEmpty(),
            chat?.systemPrompt.orEmpty(),
            contextPrompt,
        ).map { it.trim() }.filter { it.isNotEmpty() }
        val usePrompt = chat?.promptCompress ?: promptCompress
        val useHist = chat?.tokenCompress ?: tokenCompress
        val mode = chat?.compressMode ?: modelMeta?.compressMode ?: compressMode
        val sys = sysParts.joinToString("\n\n").let {
            if (usePrompt && mode != "off") compressPrompt(it, mode) else it
        }
        val turns = mutableListOf<ChatTurn>()
        if (sys.isNotEmpty()) turns += ChatTurn("system", sys)
        val msgs = chat?.messages.orEmpty()
        for (m in msgs) {
            if (m.streaming && m.content.isEmpty()) continue
            if (m.error != null && m.content.isBlank()) continue
            turns += ChatTurn(m.role, m.content, m.attachments)
        }
        if (continuing) {
            turns += ChatTurn("user", "Continue exactly where you left off. Do not repeat.")
        }
        var out = turns.toList()
        if (useHist && mode != "off") {
            val before = out.sumOf { estimateTokens(it.content) }
            val budget = resolveInputBudget(modelMeta, reserveTokens, threshold)
            out = compressHistory(out, budget, mode, keepLast)
            val after = out.sumOf { estimateTokens(it.content) }
            val saved = (before - after).coerceAtLeast(0)
            if (saved > 0) {
                prefs.tokensSaved = prefs.tokensSaved + saved
                prefs.compressRuns = prefs.compressRuns + 1
                snack = "Saved $saved tokens · ${out.size} turns"
            }
        }
        return out
    }

    fun saveProviders(list: List<HubProvider>) {
        providers = list
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { client().putData("providers", toJsonArray(list.map { it.toJson() })) }
                .onFailure { main.post { dataError = it.message } }
                .onSuccess { main.post { refreshModels() } }
        }
    }

    fun saveCustomModels(list: List<HubDiscoveredModel>) {
        customModels = list
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { client().putData("models", toJsonArray(list.map { it.toJson() })) }
                .onFailure { main.post { dataError = it.message } }
        }
    }

    fun saveCombos(list: List<HubCombo>) {
        combos = list
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { client().putData("combos", toJsonArray(list.map { it.toJson() })) }
                .onFailure { main.post { dataError = it.message } }
                .onSuccess { main.post { refreshModels() } }
        }
    }

    fun savePrompts(list: List<HubPrompt>) {
        prompts = list
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { client().putData("prompts", toJsonArray(list.map { it.toJson() })) }
                .onFailure { main.post { dataError = it.message } }
        }
    }

    fun saveKeyStore(list: List<KeyStoreItem>) {
        keyStore = list
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { client().putData("keystore", toJsonArray(list.map { it.toJson() })) }
                .onFailure { main.post { dataError = it.message } }
        }
    }

    fun createKey(label: String) {
        viewModelScope.launch {
            try {
                val (raw, meta) = withContext(Dispatchers.IO) { client().createGatewayKey(label) }
                newRawKey = raw
                gatewayKeys = listOf(meta) + gatewayKeys
            } catch (e: Exception) {
                dataError = e.message
            }
        }
    }

    fun revokeKey(id: String) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { client().revokeGatewayKey(id) }
                gatewayKeys = gatewayKeys.map { if (it.id == id) it.copy(revoked = true) else it }
            } catch (e: Exception) {
                dataError = e.message
            }
        }
    }

    fun loadQuota() {
        viewModelScope.launch {
            try {
                val (label, rows) = withContext(Dispatchers.IO) { client().getQuota() }
                quotaLabel = label
                quotaRows = rows
            } catch (e: Exception) {
                quotaLabel = ""
                quotaRows = emptyList()
                dataError = e.message
            }
        }
    }

    fun pushSettingsRemote() {
        persistSettings()
        viewModelScope.launch(Dispatchers.IO) {
            val o = JSONObject()
                .put("theme", theme)
                .put("maxTokens", maxTokens)
                .put("tokenCompress", tokenCompress)
                .put("promptCompress", promptCompress)
                .put("tokenCompressMode", compressMode)
                .put("keepLastMessages", keepLast)
                .put("tokenCompressThreshold", threshold)
                .put("contextReserveTokens", reserveTokens)
                .put("defaultContextPromptId", defaultContextPromptId)
                .put("defaultModelId", selectedModel)
            runCatching { client().putData("settings", o) }
        }
    }

    fun exportJson(): String = try {
        org.json.JSONObject()
            .put("providers", toJsonArray(providers.map { it.toJson() }))
            .put("models", toJsonArray(customModels.map { it.toJson() }))
            .put("combos", toJsonArray(combos.map { it.toJson() }))
            .put("prompts", toJsonArray(prompts.map { it.toJson() }))
            .put("keystore", toJsonArray(keyStore.map { it.toJson() }))
            .put("chats", LocalStore.chatsToJson(chats))
            .toString(2)
    } catch (_: Exception) {
        "{}"
    }

    fun applyContextPrompt(id: String) {
        defaultContextPromptId = id
        updateCurrent { it.copy(contextPromptId = id, updatedAt = System.currentTimeMillis()) }
        val p = prompts.firstOrNull { it.id == id }
        if (p != null && p.kind == "snippet") {
            input = if (input.isBlank()) p.content else input + "\n" + p.content
        } else if (p != null) {
            contextPrompt = p.content
        }
        plusOpen = false
        persistSettings()
    }
}
