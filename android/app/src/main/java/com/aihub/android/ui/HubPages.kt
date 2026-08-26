package com.aihub.android.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aihub.android.data.HubCombo
import com.aihub.android.data.HubDiscoveredModel
import com.aihub.android.data.HubPrompt
import com.aihub.android.data.HubProvider
import com.aihub.android.data.KeyStoreItem
import com.aihub.android.data.PROVIDER_KINDS
import com.aihub.android.engine.compressPrompt
import com.aihub.android.engine.estimateTokens
import com.aihub.android.ui.theme.Coral
import com.aihub.android.ui.theme.LocalHubColors
import java.util.UUID

@Composable
fun HubDestination(vm: HubViewModel) {
    androidx.activity.compose.BackHandler(enabled = vm.route != "chat") { vm.openRoute("chat") }
    when (vm.route) {
        "providers" -> ProvidersPage(vm)
        "models" -> ModelsPage(vm)
        "combos" -> CombosPage(vm)
        "compress" -> CompressStudio(vm)
        "prompts" -> PromptsPage(vm)
        "keys" -> KeysPage(vm)
        "keystore" -> KeyStorePage(vm)
        "cookies" -> CookiesPage(vm)
        "quota" -> QuotaPage(vm)
        "usage" -> UsagePage(vm)
        "trash" -> TrashPage(vm)
        else -> ChatShell(vm)
    }
}

@Composable
private fun PageScaffold(vm: HubViewModel, title: String, content: @Composable () -> Unit) {
    val c = LocalHubColors.current
    Column(Modifier.fillMaxSize().background(c.canvas).navigationBarsPadding()) {
        PageHeader(title) { vm.openRoute("chat") }
        vm.dataError?.let { Text(it, color = Coral, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) }
        if (vm.dataLoading) CenterSpinner() else content()
    }
}

@Composable
private fun ProvidersPage(vm: HubViewModel) {
    val c = LocalHubColors.current
    var adding by remember { mutableStateOf(false) }
    PageScaffold(vm, "Providers") {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text("Live from GET /api/data?key=providers. Empty until the hub has any.", color = c.muted, fontSize = 13.sp)
            Spacer(Modifier.height(8.dp))
            Text("Add provider", color = Coral, modifier = Modifier.clickable { adding = true }.padding(vertical = 12.dp))
            if (vm.providers.isEmpty()) {
                EmptyHint("No providers on this hub yet.")
            } else {
                vm.providers.forEach { p ->
                    QuietRow(
                        title = (if (p.disabled) "○ " else "● ") + p.displayName.ifBlank { p.name },
                        subtitle = listOf(p.key, p.authMode, p.baseURL).filter { it.isNotBlank() }.joinToString(" · "),
                    ) { }
                    Row {
                        TextButton(onClick = {
                            vm.saveProviders(vm.providers.map { if (it.id == p.id) it.copy(disabled = !it.disabled) else it })
                        }) { Text(if (p.disabled) "Enable" else "Disable", color = Coral) }
                        TextButton(onClick = { vm.saveProviders(vm.providers.filterNot { it.id == p.id }) }) { Text("Remove", color = Coral) }
                    }
                }
            }
        }
    }
    if (adding) AddProviderDialog(vm) { adding = false }
}

@Composable
private fun AddProviderDialog(vm: HubViewModel, onClose: () -> Unit) {
    val c = LocalHubColors.current
    var kind by remember { mutableStateOf(PROVIDER_KINDS.first()) }
    var name by remember { mutableStateOf(kind.label) }
    var key by remember { mutableStateOf("") }
    var url by remember { mutableStateOf(kind.baseURL) }
    var format by remember { mutableStateOf(kind.apiFormat) }
    var mode by remember { mutableStateOf("apiKey") }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.canvas).padding(20.dp).verticalScroll(rememberScrollState())) {
            PageHeader("Add provider", onClose)
            Text("Templates only fill the form. Nothing is saved until you tap Save.", color = c.muted, fontSize = 13.sp)
            FieldLabel("Type")
            ModeChips(kind.key, PROVIDER_KINDS.map { it.key }) { k ->
                kind = PROVIDER_KINDS.first { it.key == k }
                name = kind.label
                url = kind.baseURL
                format = kind.apiFormat
            }
            FieldLabel("Display name")
            HubField(name, "OpenAI") { name = it }
            FieldLabel("API key")
            HubField(key, "sk-…", secret = true) { key = it }
            FieldLabel("Base URL")
            HubField(url, "https://") { url = it }
            FieldLabel("Auth mode")
            ModeChips(mode, listOf("apiKey", "cookie", "oauth")) { mode = it }
            FieldLabel("API format")
            ModeChips(format, listOf("openai", "anthropic")) { format = it }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    val p = HubProvider(
                        id = UUID.randomUUID().toString(),
                        key = kind.key,
                        name = name,
                        displayName = name,
                        authMode = mode,
                        apiKey = key,
                        apiKeys = emptyList(),
                        cookie = if (mode == "cookie") key else "",
                        apiFormat = format,
                        baseURL = url,
                        extraHeaders = emptyMap(),
                        disabled = false,
                        streaming = true,
                        vision = false,
                        email = "",
                    )
                    vm.saveProviders(vm.providers + p)
                    onClose()
                },
                colors = ButtonDefaults.buttonColors(containerColor = c.ink, contentColor = c.pill),
                shape = RoundedCornerShape(24.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) { Text("Save to hub") }
        }
    }
}

@Composable
private fun ModelsPage(vm: HubViewModel) {
    val c = LocalHubColors.current
    var adding by remember { mutableStateOf(false) }
    PageScaffold(vm, "Models") {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text("Customize rows live in /api/data?key=models. Picker list is GET /v1/models.", color = c.muted, fontSize = 13.sp)
            Text("Add manual model", color = Coral, modifier = Modifier.clickable { adding = true }.padding(vertical = 12.dp))
            if (vm.customModels.isEmpty() && vm.models.isEmpty()) {
                EmptyHint("No models from hub.")
            }
            vm.customModels.forEach { m ->
                QuietRow(m.displayName.ifBlank { m.modelId }, listOf(m.providerKey, "${m.contextWindow} ctx").joinToString(" · ")) {
                    vm.editingModel = m
                }
            }
            val extra = vm.models.filter { live -> vm.customModels.none { it.modelId == live.id || it.id == live.id } }
            if (extra.isNotEmpty()) {
                Text("FROM GATEWAY", color = c.muted, fontSize = 11.sp, letterSpacing = 1.2.sp, modifier = Modifier.padding(top = 16.dp))
                extra.forEach { live ->
                    QuietRow(live.id, live.ownedBy) {
                        vm.editingModel = HubDiscoveredModel(
                            id = live.id, providerId = "", providerKey = live.ownedBy, modelId = live.id,
                            displayName = live.id, contextWindow = 0, tokenLimit = 0, maxTokens = 0,
                            temperature = null, contextPromptId = "", customSystemPrompt = "",
                            tokenCompress = null, promptCompress = null, compressMode = null,
                            vision = false, pdf = false, streaming = true, toolCalling = false,
                            reasoning = false, favorite = false, disabled = false, inputPrice = null, outputPrice = null,
                        )
                    }
                }
            }
        }
    }
    vm.editingModel?.let { m -> CustomizeModel(vm, m) { vm.editingModel = null } }
    if (adding) {
        vm.editingModel = HubDiscoveredModel(
            id = UUID.randomUUID().toString(), providerId = "", providerKey = "custom",
            modelId = "", displayName = "", contextWindow = 128000, tokenLimit = 0, maxTokens = 0,
            temperature = null, contextPromptId = "", customSystemPrompt = "",
            tokenCompress = null, promptCompress = null, compressMode = null,
            vision = false, pdf = false, streaming = true, toolCalling = false,
            reasoning = false, favorite = false, disabled = false, inputPrice = null, outputPrice = null,
        )
        adding = false
    }
}

@Composable
private fun CustomizeModel(vm: HubViewModel, seed: HubDiscoveredModel, onClose: () -> Unit) {
    val c = LocalHubColors.current
    var m by remember { mutableStateOf(seed) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.canvas).padding(20.dp).verticalScroll(rememberScrollState())) {
            PageHeader("Customize", onClose)
            FieldLabel("Display name")
            HubField(m.displayName, "Sonnet") { m = m.copy(displayName = it) }
            FieldLabel("Model id")
            HubField(m.modelId, "claude-sonnet-4-5") { m = m.copy(modelId = it) }
            FieldLabel("Context window")
            ModeChips(
                selected = listOf(8, 16, 32, 64, 128, 200, 1000).firstOrNull { it * 1000 == m.contextWindow }?.let { "${it}K" } ?: "custom",
                modes = listOf("8K", "16K", "32K", "64K", "128K", "200K", "1M"),
            ) { label ->
                val n = when (label) {
                    "1M" -> 1_000_000
                    else -> label.removeSuffix("K").toInt() * 1000
                }
                m = m.copy(contextWindow = n)
            }
            FieldLabel("Token limit (input budget)")
            HubField(if (m.tokenLimit == 0) "" else m.tokenLimit.toString(), "empty = context") {
                m = m.copy(tokenLimit = it.filter { ch -> ch.isDigit() }.toIntOrNull() ?: 0)
            }
            FieldLabel("Max output tokens")
            HubField(if (m.maxTokens == 0) "" else m.maxTokens.toString(), "Auto") {
                m = m.copy(maxTokens = it.filter { ch -> ch.isDigit() }.toIntOrNull() ?: 0)
            }
            FieldLabel("Temperature 0–2")
            HubField(m.temperature?.toString() ?: "", "default") {
                m = m.copy(temperature = it.toDoubleOrNull())
            }
            FieldLabel("Custom system prompt")
            HubField(m.customSystemPrompt, "Optional", singleLine = false) { m = m.copy(customSystemPrompt = it) }
            SettingSwitch("Favorite", m.favorite) { m = m.copy(favorite = it) }
            SettingSwitch("Vision", m.vision) { m = m.copy(vision = it) }
            SettingSwitch("PDF", m.pdf) { m = m.copy(pdf = it) }
            SettingSwitch("Reasoning", m.reasoning) { m = m.copy(reasoning = it) }
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    val id = m.id.ifBlank { m.modelId }
                    val next = m.copy(id = id)
                    val rest = vm.customModels.filterNot { it.id == next.id || it.modelId == next.modelId }
                    vm.saveCustomModels(rest + next)
                    onClose()
                },
                colors = ButtonDefaults.buttonColors(containerColor = c.ink, contentColor = c.pill),
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(24.dp),
            ) { Text("Save") }
        }
    }
}

@Composable
private fun CombosPage(vm: HubViewModel) {
    val c = LocalHubColors.current
    var name by remember { mutableStateOf("") }
    var member by remember { mutableStateOf("") }
    PageScaffold(vm, "Combos") {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text("Named fallback chains. Chat picker lists combo names first.", color = c.muted, fontSize = 13.sp)
            FieldLabel("New combo name")
            HubField(name, "fast-fallback") { name = it }
            FieldLabel("First member model id")
            HubField(member, "gpt-4o-mini") { member = it }
            TextButton(onClick = {
                if (name.isBlank() || member.isBlank()) return@TextButton
                val combo = HubCombo(
                    id = UUID.randomUUID().toString(),
                    name = name.trim(),
                    description = "",
                    members = listOf("" to member.trim()),
                    createdAt = System.currentTimeMillis(),
                    updatedAt = System.currentTimeMillis(),
                )
                vm.saveCombos(vm.combos + combo)
                name = ""; member = ""
            }) { Text("Save combo", color = Coral) }
            vm.combos.forEach { combo ->
                QuietRow(combo.name, combo.members.joinToString(" → ") { it.second }) {}
                TextButton(onClick = { vm.saveCombos(vm.combos.filterNot { it.id == combo.id }) }) { Text("Delete", color = Coral) }
            }
            if (vm.comboLogs.isNotEmpty()) {
                Text("COMBO LOGS", color = c.muted, fontSize = 11.sp, letterSpacing = 1.2.sp, modifier = Modifier.padding(top = 16.dp))
                vm.comboLogs.take(40).forEach { log ->
                    QuietRow(log.comboName, "${log.respondingModel} · in ${log.tokensIn} out ${log.tokensOut}") {}
                }
            }
        }
    }
}

@Composable
private fun CompressStudio(vm: HubViewModel) {
    val c = LocalHubColors.current
    val out = compressPrompt(vm.studioIn, vm.studioMode)
    val before = estimateTokens(vm.studioIn)
    val after = estimateTokens(out)
    val pct = if (before == 0) 0 else ((before - after) * 100 / before)
    PageScaffold(vm, "Compress") {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text("Extractive. No second LLM. Paste any prompt — nothing is seeded.", color = c.muted, fontSize = 13.sp)
            SettingSwitch("Prompt compress", vm.promptCompress) { vm.promptCompress = it; vm.persistSettings() }
            SettingSwitch("History token compress", vm.tokenCompress) { vm.tokenCompress = it; vm.persistSettings() }
            FieldLabel("Mode")
            ModeChips(vm.studioMode, listOf("off", "light", "smart", "aggressive")) {
                vm.studioMode = it
                vm.compressMode = it
            }
            FieldLabel("Keep last turns: ${vm.keepLast}")
            Slider(value = vm.keepLast.toFloat(), onValueChange = { vm.keepLast = it.toInt() }, valueRange = 2f..24f, colors = SliderDefaults.colors(thumbColor = Coral, activeTrackColor = Coral))
            FieldLabel("Threshold ${(vm.threshold * 100).toInt()}%")
            Slider(value = vm.threshold, onValueChange = { vm.threshold = it }, valueRange = 0.4f..0.95f, colors = SliderDefaults.colors(thumbColor = Coral, activeTrackColor = Coral))
            FieldLabel("Reserve tokens: ${vm.reserveTokens}")
            Slider(value = vm.reserveTokens.toFloat(), onValueChange = { vm.reserveTokens = it.toInt() }, valueRange = 512f..16000f, colors = SliderDefaults.colors(thumbColor = Coral, activeTrackColor = Coral))
            FieldLabel("Original")
            HubField(vm.studioIn, "Paste system / context text", singleLine = false) { vm.studioIn = it }
            FieldLabel("Compressed · saved $pct% ($before → $after tok)")
            Text(out.ifBlank { "—" }, color = c.ink, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.surface).padding(12.dp))
            Text("Saved ${vm.prefs.tokensSaved} tokens · ${vm.prefs.compressRuns} runs", color = c.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
private fun PromptsPage(vm: HubViewModel) {
    val c = LocalHubColors.current
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("context") }
    PageScaffold(vm, "Prompts") {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text("Loaded from /api/data?key=prompts. This app does not seed templates.", color = c.muted, fontSize = 13.sp)
            FieldLabel("Title")
            HubField(title, "Coding pair") { title = it }
            FieldLabel("Kind")
            ModeChips(kind, listOf("context", "snippet")) { kind = it }
            FieldLabel("Body")
            HubField(body, "You are…", singleLine = false) { body = it }
            TextButton(onClick = {
                if (title.isBlank() || body.isBlank()) return@TextButton
                vm.savePrompts(
                    vm.prompts + HubPrompt(UUID.randomUUID().toString(), title.trim(), body, kind, false, emptyList()),
                )
                title = ""; body = ""
            }) { Text("Save to hub", color = Coral) }
            vm.prompts.forEach { p ->
                QuietRow(p.title, p.kind) { vm.applyContextPrompt(p.id); vm.openRoute("chat") }
                TextButton(onClick = { vm.savePrompts(vm.prompts.filterNot { it.id == p.id }) }) { Text("Delete", color = Coral) }
            }
            if (vm.prompts.isEmpty()) EmptyHint("No prompts on the hub.")
        }
    }
}

@Composable
private fun KeysPage(vm: HubViewModel) {
    val c = LocalHubColors.current
    val ctx = LocalContext.current
    var label by remember { mutableStateOf("Android") }
    PageScaffold(vm, "Gateway keys") {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text("Create / revoke ah-… keys on this hub. Raw key is shown once.", color = c.muted, fontSize = 13.sp)
            FieldLabel("Label")
            HubField(label, "Android") { label = it }
            TextButton(onClick = { vm.createKey(label.ifBlank { "Android" }) }) { Text("Create key", color = Coral) }
            vm.newRawKey?.let { raw ->
                Text(raw, color = c.ink, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(c.surface).padding(12.dp).clickable {
                    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("key", raw))
                })
                Text("Copy now — it will not be shown again.", color = c.muted, fontSize = 12.sp)
            }
            Spacer(Modifier.height(8.dp))
            Text("Cursor / Claude Desktop / Cline", color = c.ink, fontWeight = FontWeight.Medium)
            Text("base URL = ${vm.prefs.hubUrl}/v1\nmodel = upstream id or combo name", color = c.muted, fontSize = 13.sp)
            vm.gatewayKeys.forEach { k ->
                QuietRow(k.label + if (k.revoked) " (revoked)" else "", "…${k.last4}") {}
                if (!k.revoked) TextButton(onClick = { vm.revokeKey(k.id) }) { Text("Revoke", color = Coral) }
            }
        }
    }
}

@Composable
private fun KeyStorePage(vm: HubViewModel) {
    val c = LocalHubColors.current
    var label by remember { mutableStateOf("") }
    var value by remember { mutableStateOf("") }
    PageScaffold(vm, "Key store") {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text("Vault of raw provider keys on the hub. Never logged.", color = c.muted, fontSize = 13.sp)
            FieldLabel("Label")
            HubField(label, "OpenAI prod") { label = it }
            FieldLabel("Secret")
            HubField(value, "sk-…", secret = true) { value = it }
            TextButton(onClick = {
                if (value.isBlank()) return@TextButton
                vm.saveKeyStore(
                    vm.keyStore + KeyStoreItem(UUID.randomUUID().toString(), label.ifBlank { "Key" }, value, System.currentTimeMillis()),
                )
                label = ""; value = ""
            }) { Text("Save", color = Coral) }
            vm.keyStore.forEach { item ->
                QuietRow(item.label, "••••${item.keyValue.takeLast(4)}") {}
                TextButton(onClick = { vm.saveKeyStore(vm.keyStore.filterNot { it.id == item.id }) }) { Text("Delete", color = Coral) }
            }
            if (vm.keyStore.isEmpty()) EmptyHint("Key store is empty.")
        }
    }
}

@Composable
private fun CookiesPage(vm: HubViewModel) {
    val cookieProviders = vm.providers.filter { it.authMode == "cookie" || it.cookie.isNotBlank() }
    PageScaffold(vm, "Cookies") {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text("Web-session providers from the hub (authMode = cookie).", color = LocalHubColors.current.muted, fontSize = 13.sp)
            if (cookieProviders.isEmpty()) EmptyHint("No cookie providers on this hub.")
            cookieProviders.forEach { p ->
                QuietRow(p.displayName, "cookie length ${p.cookie.length}") {}
            }
        }
    }
}

@Composable
private fun QuotaPage(vm: HubViewModel) {
    PageScaffold(vm, "Quota") {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text(vm.quotaLabel.ifBlank { "Antigravity quota from GET /api/quota" }, color = LocalHubColors.current.muted, fontSize = 13.sp)
            Text("Refresh", color = Coral, modifier = Modifier.clickable { vm.loadQuota() }.padding(vertical = 12.dp))
            if (vm.quotaRows.isEmpty()) EmptyHint("No quota rows. Connect Antigravity OAuth on the hub.")
            vm.quotaRows.forEach { r ->
                val pct = r.remaining?.let { "${(it * 100).toInt()}% left" } ?: "n/a"
                QuietRow(r.model, "${r.family} · $pct · ${r.source}") {}
            }
        }
    }
}

@Composable
private fun UsagePage(vm: HubViewModel) {
    val tin = vm.usage.sumOf { it.tokensIn }
    val tout = vm.usage.sumOf { it.tokensOut }
    PageScaffold(vm, "Usage") {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text("In $tin · out $tout · ${vm.usage.size} requests", color = LocalHubColors.current.ink, fontSize = 16.sp)
            if (vm.usage.isEmpty()) EmptyHint("No usage yet. Chat first.")
            vm.usage.take(80).forEach { u ->
                QuietRow(u.modelId, "in ${u.tokensIn} · out ${u.tokensOut}") {}
            }
        }
    }
}

@Composable
private fun TrashPage(vm: HubViewModel) {
    val trash = vm.chats.filter { it.deleted }
    PageScaffold(vm, "Trash") {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).verticalScroll(rememberScrollState())) {
            Text("Empty trash", color = Coral, modifier = Modifier.clickable { vm.emptyTrash() }.padding(vertical = 12.dp))
            if (trash.isEmpty()) EmptyHint("Trash is empty.")
            trash.forEach { chat ->
                QuietRow(chat.title) {}
                TextButton(onClick = { vm.restoreChat(chat.id) }) { Text("Restore", color = Coral) }
            }
        }
    }
}

@Composable
fun SettingsPage(vm: HubViewModel) {
    val c = LocalHubColors.current
    val ctx = LocalContext.current
    Dialog(
        onDismissRequest = {
            vm.pushSettingsRemote()
            vm.settingsOpen = false
        },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Column(
            Modifier.fillMaxSize().background(c.canvas).padding(20.dp).verticalScroll(rememberScrollState()),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Settings", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = c.ink, modifier = Modifier.weight(1f))
                IconButton(onClick = {
                    vm.pushSettingsRemote()
                    vm.settingsOpen = false
                }) { Icon(Icons.Outlined.Close, null, tint = c.ink) }
            }
            FieldLabel("Theme")
            ModeChips(vm.theme, listOf("light", "dark", "system")) { vm.theme = it }
            FieldLabel("Hub URL")
            HubField(vm.hubUrl, "https://") { vm.hubUrl = it; vm.prefs.hubUrl = it }
            FieldLabel("Default context prompt")
            if (vm.prompts.none { it.kind != "snippet" }) {
                Text("None on hub. Add one under Prompts.", color = c.muted, fontSize = 13.sp)
            } else {
                vm.prompts.filter { it.kind != "snippet" }.forEach { p ->
                    val on = vm.defaultContextPromptId == p.id
                    Text(
                        p.title,
                        color = if (on) c.pill else c.ink,
                        modifier = Modifier
                            .padding(vertical = 4.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (on) c.ink else c.surface)
                            .clickable { vm.defaultContextPromptId = p.id }
                            .padding(12.dp)
                            .fillMaxWidth(),
                    )
                }
            }
            FieldLabel("Context prompt (this device)")
            HubField(vm.contextPrompt, "Optional system text", singleLine = false) { vm.contextPrompt = it }
            FieldLabel("Max tokens (0 = Auto)")
            HubField(if (vm.maxTokens == 0) "" else vm.maxTokens.toString(), "0") {
                vm.maxTokens = it.filter { ch -> ch.isDigit() }.toIntOrNull() ?: 0
            }
            HorizontalDivider(color = c.line, modifier = Modifier.padding(vertical = 16.dp))
            Text("Backup", fontWeight = FontWeight.Medium, color = c.ink)
            TextButton(onClick = {
                val json = vm.exportJson()
                val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("backup", json))
                vm.snack = "Backup copied to clipboard"
            }) { Text("Copy export JSON", color = Coral) }
            Text("Profile", fontWeight = FontWeight.Medium, color = c.ink, modifier = Modifier.padding(top = 12.dp))
            Text(if (vm.connected) vm.prefs.hubUrl else "Not connected", color = c.muted, fontSize = 13.sp)
            TextButton(onClick = { vm.connectOpen = true; vm.settingsOpen = false }) { Text("Reconnect", color = Coral) }
        }
    }
}
