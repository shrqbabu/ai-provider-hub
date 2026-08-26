package com.aihub.android.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aihub.android.data.Attachment
import com.aihub.android.data.UiMessage
import com.aihub.android.ui.theme.Coral
import com.aihub.android.ui.theme.LocalHubColors
import com.aihub.android.ui.theme.White
import kotlinx.coroutines.launch
import java.util.Calendar

@Composable
fun ChatShell(vm: HubViewModel) {
    val c = LocalHubColors.current
    val drawerState = rememberDrawerState(if (vm.drawerOpen) DrawerValue.Open else DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    LaunchedEffect(vm.drawerOpen) { if (vm.drawerOpen) drawerState.open() else drawerState.close() }
    LaunchedEffect(drawerState.currentValue) { vm.drawerOpen = drawerState.currentValue == DrawerValue.Open }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet(drawerContainerColor = c.canvas) {
                DrawerBody(vm) { scope.launch { drawerState.close() } }
            }
        },
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .background(c.canvas)
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding(),
        ) {
            TopBar(vm, onMenu = { scope.launch { drawerState.open() } })
            Box(Modifier.weight(1f).fillMaxWidth()) {
                val chat = vm.current
                when {
                    !vm.connected -> EmptyHint("Connect to your hub to load live models.")
                    vm.loadingModels && vm.models.isEmpty() -> CenterSpinner()
                    vm.models.isEmpty() -> EmptyHint(vm.modelsError ?: "No models from hub yet.")
                    chat == null || chat.messages.isEmpty() -> Greeting()
                    else -> MessageList(vm, chat.messages)
                }
            }
            vm.snack?.let {
                Text(it, color = c.muted, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
            }
            if (vm.pendingAttach.isNotEmpty()) {
                Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    vm.pendingAttach.forEach { a ->
                        Text(
                            a.name,
                            color = c.ink,
                            fontSize = 12.sp,
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(c.surface)
                                .clickable { vm.removeAttachment(a.name) }
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                        )
                    }
                }
            }
            if (vm.connected) {
                Composer(vm)
            }
        }
    }
    if (vm.connectOpen) ConnectDialog(vm)
    if (vm.modelPickerOpen) ModelPicker(vm)
    if (vm.plusOpen) PlusSheet(vm)
    if (vm.settingsOpen) SettingsPage(vm)
}

@Composable
private fun TopBar(vm: HubViewModel, onMenu: () -> Unit) {
    val c = LocalHubColors.current
    val title = vm.current?.title?.takeIf { vm.current?.messages?.isNotEmpty() == true } ?: shortModel(vm.selectedModel.ifBlank { "Models" })
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onMenu, modifier = Modifier.size(44.dp)) {
            Icon(Icons.Outlined.Menu, contentDescription = "Menu", tint = c.ink)
        }
        Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
            Text(
                title,
                color = c.ink,
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .clickable(enabled = vm.connected) { vm.modelPickerOpen = true }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
        IconButton(onClick = { vm.settingsOpen = true }, modifier = Modifier.size(44.dp)) {
            Icon(Icons.Outlined.Tune, contentDescription = "Settings", tint = c.ink)
        }
    }
}

@Composable
private fun Greeting() {
    val c = LocalHubColors.current
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    val line = when (hour) {
        in 5..11 -> "How can I help you this morning?"
        in 12..16 -> "How can I help you this afternoon?"
        in 17..21 -> "How can I help you this evening?"
        else -> "Start chatting anytime"
    }
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("✻", color = Coral, fontSize = 52.sp)
        Spacer(Modifier.height(16.dp))
        Text(line, color = c.ink, fontSize = 28.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageList(vm: HubViewModel, messages: List<UiMessage>) {
    val c = LocalHubColors.current
    val ctx = LocalContext.current
    val state = rememberLazyListState()
    LaunchedEffect(messages.lastOrNull()?.content, messages.size) {
        if (messages.isNotEmpty()) state.animateScrollToItem(messages.lastIndex)
    }
    LazyColumn(
        state = state,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        items(messages, key = { it.id }) { m ->
            if (m.role == "user") {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
                    if (m.attachments.isNotEmpty()) {
                        m.attachments.forEach { a ->
                            Text(
                                a.name,
                                color = c.muted,
                                fontSize = 12.sp,
                                modifier = Modifier
                                    .padding(bottom = 6.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(c.surface)
                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                            )
                        }
                    }
                    Text(
                        m.content,
                        color = c.ink,
                        fontSize = 16.5.sp,
                        lineHeight = 24.sp,
                        modifier = Modifier
                            .widthIn(max = 320.dp)
                            .clip(RoundedCornerShape(18.dp))
                            .background(c.userBubble)
                            .combinedClickable(
                                onClick = {},
                                onLongClick = { copyText(ctx, m.content) },
                            )
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                    )
                }
            } else {
                Column(Modifier.fillMaxWidth()) {
                    Text(
                        m.content.ifBlank { if (m.streaming) "▍" else "" },
                        color = c.ink,
                        fontSize = 16.5.sp,
                        lineHeight = 24.sp,
                        modifier = Modifier.combinedClickable(
                            onClick = {},
                            onLongClick = {
                                copyText(ctx, m.content)
                            },
                        ),
                    )
                    if (!m.streaming && m.content.isNotBlank()) {
                        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("✱", color = Coral, fontSize = 12.sp)
                            Spacer(Modifier.size(8.dp))
                            Text("Can make mistakes. Double-check.", color = c.muted, fontSize = 11.sp)
                        }
                    }
                    m.error?.let { Text(it, color = Coral, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp)) }
                }
            }
        }
        vm.lastUsage?.let { u ->
            item {
                Text("Tokens in ${u.first} · out ${u.second}", color = c.muted, fontSize = 11.sp)
            }
        }
        vm.streamError?.let { item { Text(it, color = Coral, fontSize = 13.sp) } }
    }
}

private fun copyText(ctx: Context, text: String) {
    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("message", text))
}

@Composable
private fun Composer(vm: HubViewModel) {
    val c = LocalHubColors.current
    val canSend = vm.selectedModel.isNotBlank() && !vm.sending && (vm.input.isNotBlank() || vm.pendingAttach.isNotEmpty())
    Row(
        Modifier
            .padding(12.dp)
            .shadow(8.dp, RoundedCornerShape(28.dp), spotColor = androidx.compose.ui.graphics.Color(0x22000000))
            .clip(RoundedCornerShape(28.dp))
            .background(c.pill)
            .border(1.dp, c.line, RoundedCornerShape(28.dp))
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(c.surface).clickable { vm.plusOpen = true },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Add, contentDescription = "Add", tint = c.muted, modifier = Modifier.size(20.dp))
        }
        Box(Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 8.dp)) {
            if (vm.input.isEmpty()) {
                Text(
                    if (vm.selectedModel.isBlank()) "Connect, then pick a model…"
                    else "Reply to ${shortModel(vm.selectedModel)}…",
                    color = c.muted,
                    fontSize = 16.sp,
                )
            }
            BasicTextField(
                value = vm.input,
                onValueChange = { vm.input = it },
                textStyle = TextStyle(color = c.ink, fontSize = 16.sp),
                cursorBrush = SolidColor(Coral),
                modifier = Modifier.fillMaxWidth(),
                maxLines = 6,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { if (canSend) vm.send() }),
            )
        }
        if (vm.sending) {
            Box(
                Modifier.size(40.dp).clip(CircleShape).background(c.ink).clickable { vm.stop() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Stop, contentDescription = "Stop", tint = White, modifier = Modifier.size(18.dp))
            }
        } else {
            Box(
                Modifier.size(40.dp).clip(CircleShape).background(if (canSend) Coral else c.surface).clickable(enabled = canSend) { vm.send() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.ArrowUpward, contentDescription = "Send", tint = if (canSend) White else c.muted, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
fun DrawerBody(vm: HubViewModel, close: () -> Unit) {
    val c = LocalHubColors.current
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(20.dp)) {
        Text("AI Hub", color = c.ink, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        Text(
            if (vm.connected) vm.prefs.hubUrl else "Not connected",
            color = c.muted,
            fontSize = 12.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            "New chat",
            color = Coral,
            fontSize = 16.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .clickable { vm.newChat(); close() }
                .padding(vertical = 12.dp),
        )
        HubField(vm.chatSearch, "Search chats") { vm.chatSearch = it }
        Spacer(Modifier.height(8.dp))
        val q = vm.chatSearch.trim().lowercase()
        val recent = vm.chats.filter { !it.deleted && (q.isEmpty() || it.title.lowercase().contains(q)) }
            .sortedWith(compareByDescending<com.aihub.android.data.ChatSession> { it.pinned }.thenByDescending { it.updatedAt })
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            recent.take(30).forEach { chat ->
                QuietRow(
                    title = (if (chat.pinned) "📌 " else "") + chat.title,
                    subtitle = android.text.format.DateFormat.format("MMM d · HH:mm", chat.updatedAt).toString(),
                ) { vm.openChat(chat.id); close() }
            }
            Spacer(Modifier.height(16.dp))
            Text("HUB", color = c.muted, fontSize = 11.sp, letterSpacing = 1.2.sp)
            listOf(
                "providers" to "Providers",
                "models" to "Models",
                "combos" to "Combos",
                "compress" to "Compress",
                "prompts" to "Prompts",
                "keys" to "Gateway keys",
                "keystore" to "Key store",
                "cookies" to "Cookies",
                "quota" to "Quota",
                "usage" to "Usage",
                "trash" to "Trash",
            ).forEach { (id, label) ->
                QuietRow(label) { vm.openRoute(id); close() }
            }
        }
        if (vm.connected) {
            TextButton(onClick = { vm.disconnect(); close() }) { Text("Disconnect", color = Coral) }
        }
    }
}

@Composable
fun ConnectDialog(vm: HubViewModel) {
    val c = LocalHubColors.current
    Dialog(
        onDismissRequest = { if (vm.connected) vm.connectOpen = false },
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = vm.connected),
    ) {
        Column(
            Modifier.fillMaxSize().background(c.canvas).statusBarsPadding().navigationBarsPadding().padding(24.dp).verticalScroll(rememberScrollState()),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Connect hub", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = c.ink, modifier = Modifier.weight(1f))
                if (vm.connected) {
                    IconButton(onClick = { vm.connectOpen = false }) {
                        Icon(Icons.Outlined.Close, contentDescription = "Close", tint = c.ink)
                    }
                }
            }
            Text(
                "No models ship in this app. Paste the live hub URL and a gateway key (ah-…). Phone: http://<pc-ip>:3000. Emulator: http://10.0.2.2:3000.",
                color = c.muted,
                fontSize = 14.sp,
            )
            FieldLabel("Hub URL")
            HubField(vm.hubUrl, "https://your-hub.example.com") { vm.hubUrl = it }
            FieldLabel("Gateway key")
            HubField(vm.apiKey, "ah-…", secret = true) { vm.apiKey = it }
            vm.connectError?.let { Text(it, color = Coral, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp)) }
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { vm.connect() },
                enabled = !vm.connecting,
                colors = ButtonDefaults.buttonColors(containerColor = c.ink, contentColor = c.pill),
                shape = RoundedCornerShape(24.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                if (vm.connecting) CircularProgressIndicator(Modifier.size(18.dp), color = c.pill, strokeWidth = 2.dp)
                else Text("Connect")
            }
        }
    }
}

@Composable
fun ModelPicker(vm: HubViewModel) {
    val c = LocalHubColors.current
    Dialog(onDismissRequest = { vm.modelPickerOpen = false }) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(c.canvas).padding(8.dp).height(460.dp),
        ) {
            Text("Favorites · Combos · Models", fontWeight = FontWeight.SemiBold, color = c.ink, modifier = Modifier.padding(16.dp))
            if (vm.loadingModels) CenterSpinner()
            else if (vm.models.isEmpty()) EmptyHint(vm.modelsError ?: "No models from hub.")
            else {
                val fav = vm.customModels.filter { it.favorite }.map { it.modelId }.toSet()
                val ordered = vm.models.sortedWith(
                    compareBy<com.aihub.android.data.HubModel> { if (it.id in fav) 0 else if (it.isCombo) 1 else 2 }
                        .thenBy { it.id },
                )
                LazyColumn {
                    items(ordered, key = { it.id }) { m ->
                        val custom = vm.customModels.firstOrNull { it.modelId == m.id || it.id == m.id }
                        QuietRow(
                            title = custom?.displayName?.ifBlank { m.id } ?: m.id,
                            subtitle = if (m.isCombo) "combo" else m.ownedBy,
                        ) { vm.selectModel(m.id) }
                    }
                }
            }
        }
    }
}

@Composable
fun PlusSheet(vm: HubViewModel) {
    val c = LocalHubColors.current
    val ctx = LocalContext.current
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val name = uri.lastPathSegment?.substringAfterLast('/') ?: "file"
        val mime = ctx.contentResolver.getType(uri) ?: "application/octet-stream"
        ctx.contentResolver.openInputStream(uri)?.use { input ->
            val bytes = input.readBytes().take(2_000_000).toByteArray()
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            vm.addAttachment(Attachment(name, mime, "data:$mime;base64,$b64"))
        }
    }
    Dialog(onDismissRequest = { vm.plusOpen = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxSize().background(c.canvas).statusBarsPadding().navigationBarsPadding().padding(20.dp).verticalScroll(rememberScrollState()),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Add", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = c.ink, modifier = Modifier.weight(1f))
                IconButton(onClick = { vm.plusOpen = false }) { Icon(Icons.Outlined.Close, null, tint = c.ink) }
            }
            QuietRow("Photo") { pick.launch("image/*") }
            QuietRow("File") { pick.launch("*/*") }
            Spacer(Modifier.height(8.dp))
            Text("CONTEXT", color = c.muted, fontSize = 11.sp, letterSpacing = 1.2.sp)
            if (vm.prompts.isEmpty()) {
                Text("No prompts on the hub yet.", color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 8.dp))
            } else {
                vm.prompts.forEach { p ->
                    QuietRow(p.title, p.kind) { vm.applyContextPrompt(p.id) }
                }
            }
            Spacer(Modifier.height(8.dp))
            Text("COMPRESS", color = c.muted, fontSize = 11.sp, letterSpacing = 1.2.sp)
            Spacer(Modifier.height(8.dp))
            ModeChips(vm.compressMode, listOf("off", "light", "smart", "aggressive")) { vm.compressMode = it }
            SettingSwitch("Prompt compress", vm.promptCompress) { vm.promptCompress = it }
            SettingSwitch("History compress", vm.tokenCompress) { vm.tokenCompress = it }
            Spacer(Modifier.height(8.dp))
            Text("OUTPUT LIMIT", color = c.muted, fontSize = 11.sp, letterSpacing = 1.2.sp)
            Spacer(Modifier.height(8.dp))
            val presets = listOf(0 to "Auto", 1024 to "1K", 2048 to "2K", 4096 to "4K", 8192 to "8K", 16384 to "16K", 32768 to "32K", 65536 to "64K")
            ModeChips(
                selected = presets.firstOrNull { it.first == vm.maxTokens }?.second ?: "Auto",
                modes = presets.map { it.second },
            ) { label ->
                vm.maxTokens = presets.first { it.second == label }.first
                vm.persistSettings()
            }
        }
    }
}
