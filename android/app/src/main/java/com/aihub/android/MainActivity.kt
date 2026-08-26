package com.aihub.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aihub.android.ui.HubViewModel
import com.aihub.android.ui.UiMessage
import com.aihub.android.ui.theme.Coral
import com.aihub.android.ui.theme.Cream
import com.aihub.android.ui.theme.CreamDeep
import com.aihub.android.ui.theme.HubTheme
import com.aihub.android.ui.theme.Ink
import com.aihub.android.ui.theme.InkMuted
import com.aihub.android.ui.theme.Line
import com.aihub.android.ui.theme.White
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val vm: HubViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            HubTheme {
                HubApp(vm)
            }
        }
    }
}

@Composable
private fun HubApp(vm: HubViewModel) {
    val drawerState = rememberDrawerState(
        if (vm.drawerOpen) DrawerValue.Open else DrawerValue.Closed
    )
    val scope = rememberCoroutineScope()
    LaunchedEffect(vm.drawerOpen) {
        if (vm.drawerOpen) drawerState.open() else drawerState.close()
    }
    LaunchedEffect(drawerState.currentValue) {
        vm.drawerOpen = drawerState.currentValue == DrawerValue.Open
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet(drawerContainerColor = Cream) {
                DrawerBody(vm) { scope.launch { drawerState.close() } }
            }
        },
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .background(Cream)
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding(),
        ) {
            TopBar(
                modelLabel = vm.selectedModel.ifBlank { "Models" },
                onMenu = { scope.launch { drawerState.open() } },
                onModel = { if (vm.connected) vm.modelPickerOpen = true },
                onSettings = { vm.settingsOpen = true },
            )
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    !vm.connected -> EmptyHint("Connect to your hub to load live models.")
                    vm.loadingModels && vm.models.isEmpty() -> CenterSpinner()
                    vm.models.isEmpty() -> EmptyHint(vm.modelsError ?: "No models from hub yet.")
                    vm.messages.isEmpty() -> Greeting()
                    else -> MessageList(vm.messages, vm.lastUsage, vm.streamError)
                }
            }
            if (vm.connected) {
                Composer(
                    value = vm.input,
                    enabled = vm.selectedModel.isNotBlank() && !vm.sending,
                    sending = vm.sending,
                    placeholder = if (vm.selectedModel.isBlank()) "Connect, then pick a model…"
                    else "Reply to ${shortModel(vm.selectedModel)}…",
                    onChange = { vm.input = it },
                    onSend = { vm.send() },
                )
            }
        }
    }

    if (vm.connectOpen) ConnectDialog(vm)
    if (vm.modelPickerOpen) ModelPicker(vm)
    if (vm.settingsOpen) SettingsSheet(vm)
}

@Composable
private fun TopBar(
    modelLabel: String,
    onMenu: () -> Unit,
    onModel: () -> Unit,
    onSettings: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onMenu) {
            Icon(Icons.Outlined.Menu, contentDescription = "Menu", tint = Ink)
        }
        Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
            Text(
                text = shortModel(modelLabel),
                color = Ink,
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .clickable(onClick = onModel)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
        IconButton(onClick = onSettings) {
            Icon(Icons.Outlined.Tune, contentDescription = "Chat settings", tint = Ink)
        }
    }
}

@Composable
private fun Greeting() {
    val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
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
        Text("✻", color = Coral, fontSize = 48.sp)
        Spacer(Modifier.height(16.dp))
        Text(
            line,
            color = Ink,
            fontSize = 26.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun EmptyHint(text: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, color = InkMuted, fontSize = 15.sp, textAlign = TextAlign.Center)
    }
}

@Composable
private fun CenterSpinner() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Coral, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
    }
}

@Composable
private fun MessageList(messages: List<UiMessage>, usage: Pair<Int, Int>?, error: String?) {
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
        items(messages.size) { i ->
            val m = messages[i]
            if (m.role == "user") UserBubble(m.content) else AssistantBlock(m.content, m.streaming)
        }
        if (usage != null) {
            item {
                Text(
                    "Tokens in ${usage.first} · out ${usage.second}",
                    color = InkMuted,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(start = 28.dp),
                )
            }
        }
        if (error != null) {
            item { Text(error, color = Coral, fontSize = 13.sp) }
        }
    }
}

@Composable
private fun UserBubble(text: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Text(
            text,
            color = Ink,
            fontSize = 16.sp,
            modifier = Modifier
                .widthIn(max = 320.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(CreamDeep)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun AssistantBlock(text: String, streaming: Boolean) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text("✻", color = Coral, fontSize = 16.sp, modifier = Modifier.padding(top = 2.dp, end = 10.dp))
        Text(
            text.ifBlank { if (streaming) "…" else "" },
            color = Ink,
            fontSize = 16.sp,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun Composer(
    value: String,
    enabled: Boolean,
    sending: Boolean,
    placeholder: String,
    onChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    Row(
        Modifier
            .padding(12.dp)
            .clip(RoundedCornerShape(28.dp))
            .background(White)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(CreamDeep),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Add, contentDescription = null, tint = InkMuted, modifier = Modifier.size(20.dp))
        }
        Box(Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 8.dp)) {
            if (value.isEmpty()) {
                Text(placeholder, color = InkMuted, fontSize = 16.sp)
            }
            BasicTextField(
                value = value,
                onValueChange = onChange,
                textStyle = TextStyle(color = Ink, fontSize = 16.sp),
                cursorBrush = SolidColor(Coral),
                modifier = Modifier.fillMaxWidth(),
                maxLines = 6,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { if (enabled && value.isNotBlank() && !sending) onSend() }),
            )
        }
        val canSend = enabled && value.isNotBlank() && !sending
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(if (canSend) Ink else CreamDeep)
                .clickable(enabled = canSend, onClick = onSend),
            contentAlignment = Alignment.Center,
        ) {
            if (sending) {
                CircularProgressIndicator(Modifier.size(16.dp), color = White, strokeWidth = 2.dp)
            } else {
                Icon(
                    Icons.Outlined.ArrowUpward,
                    contentDescription = "Send",
                    tint = if (canSend) White else InkMuted,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

@Composable
private fun DrawerBody(vm: HubViewModel, close: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .padding(20.dp),
    ) {
        Text("AI Hub", color = Ink, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        Text(
            if (vm.connected) vm.prefs.hubUrl else "Not connected",
            color = InkMuted,
            fontSize = 12.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(20.dp))
        DrawerRow("New chat") {
            vm.newChat()
            close()
        }
        DrawerRow("Refresh models") {
            vm.refreshModels()
            close()
        }
        DrawerRow("Reconnect hub") {
            vm.connectOpen = true
            close()
        }
        Spacer(Modifier.weight(1f))
        if (vm.connected) {
            TextButton(onClick = {
                vm.disconnect()
                close()
            }) {
                Text("Disconnect", color = Coral)
            }
        }
    }
}

@Composable
private fun DrawerRow(label: String, onClick: () -> Unit) {
    Text(
        label,
        color = Ink,
        fontSize = 16.sp,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp, horizontal = 4.dp),
    )
}

@Composable
private fun ConnectDialog(vm: HubViewModel) {
    Dialog(
        onDismissRequest = { if (vm.connected) vm.connectOpen = false },
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = vm.connected),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .background(Cream)
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(24.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Connect hub", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                if (vm.connected) {
                    IconButton(onClick = { vm.connectOpen = false }) {
                        Icon(Icons.Outlined.Close, contentDescription = "Close", tint = Ink)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "This app has no models of its own. Paste the live hub URL and a gateway key (ah-…) from the web app. Phone on Wi‑Fi: http://<pc-ip>:3000. Emulator: http://10.0.2.2:3000.",
                color = InkMuted,
                fontSize = 14.sp,
            )
            Spacer(Modifier.height(20.dp))
            FieldLabel("Hub URL")
            HubField(vm.hubUrl, "https://your-hub.example.com") { vm.hubUrl = it }
            Spacer(Modifier.height(12.dp))
            FieldLabel("Gateway key")
            HubField(vm.apiKey, "ah-…", secret = true) { vm.apiKey = it }
            vm.connectError?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, color = Coral, fontSize = 13.sp)
            }
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { vm.connect() },
                enabled = !vm.connecting,
                colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = White),
                shape = RoundedCornerShape(24.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                if (vm.connecting) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = White, strokeWidth = 2.dp)
                } else {
                    Text("Connect")
                }
            }
        }
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, color = InkMuted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 6.dp))
}

@Composable
private fun HubField(value: String, hint: String, secret: Boolean = false, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text(hint, color = InkMuted) },
        singleLine = true,
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        modifier = Modifier.fillMaxWidth(),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Coral,
            unfocusedBorderColor = Line,
            focusedTextColor = Ink,
            unfocusedTextColor = Ink,
            cursorColor = Coral,
            focusedContainerColor = White,
            unfocusedContainerColor = White,
        ),
        shape = RoundedCornerShape(14.dp),
    )
}

@Composable
private fun ModelPicker(vm: HubViewModel) {
    Dialog(onDismissRequest = { vm.modelPickerOpen = false }) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(Cream)
                .padding(8.dp)
                .height(420.dp),
        ) {
            Text(
                "Models from hub",
                fontWeight = FontWeight.SemiBold,
                color = Ink,
                modifier = Modifier.padding(16.dp),
            )
            if (vm.loadingModels) {
                CenterSpinner()
            } else if (vm.models.isEmpty()) {
                EmptyHint(vm.modelsError ?: "No models.")
            } else {
                LazyColumn {
                    items(vm.models, key = { it.id }) { m ->
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .clickable { vm.selectModel(m.id) }
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                        ) {
                            Text(m.id, color = Ink, fontSize = 15.sp)
                            Text(m.ownedBy, color = InkMuted, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsSheet(vm: HubViewModel) {
    Dialog(
        onDismissRequest = {
            vm.persistSettings()
            vm.settingsOpen = false
        },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .background(Cream)
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(20.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Chat settings", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Ink, modifier = Modifier.weight(1f))
                IconButton(onClick = {
                    vm.persistSettings()
                    vm.settingsOpen = false
                }) {
                    Icon(Icons.Outlined.Close, contentDescription = "Close", tint = Ink)
                }
            }
            Text("These options apply on-device before the request hits the hub gateway.", color = InkMuted, fontSize = 13.sp)
            Spacer(Modifier.height(16.dp))
            FieldLabel("Context prompt (system)")
            OutlinedTextField(
                value = vm.contextPrompt,
                onValueChange = { vm.contextPrompt = it },
                placeholder = { Text("Optional. Loaded from you — not a seeded catalog.", color = InkMuted) },
                modifier = Modifier.fillMaxWidth().height(120.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Coral,
                    unfocusedBorderColor = Line,
                    focusedContainerColor = White,
                    unfocusedContainerColor = White,
                    cursorColor = Coral,
                ),
                shape = RoundedCornerShape(14.dp),
            )
            Spacer(Modifier.height(16.dp))
            FieldLabel("Max tokens (0 = hub default)")
            HubField(if (vm.maxTokens == 0) "" else vm.maxTokens.toString(), "0") { s ->
                vm.maxTokens = s.filter { it.isDigit() }.toIntOrNull() ?: 0
            }
            Spacer(Modifier.height(16.dp))
            SettingSwitch("Prompt compress", vm.promptCompress) { vm.promptCompress = it }
            SettingSwitch("History token compress", vm.tokenCompress) { vm.tokenCompress = it }
            Spacer(Modifier.height(8.dp))
            FieldLabel("Compress mode: ${vm.compressMode}")
            Row {
                listOf("off", "light", "smart", "aggressive").forEach { mode ->
                    val on = vm.compressMode == mode
                    Text(
                        mode,
                        color = if (on) White else Ink,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .padding(end = 8.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(if (on) Ink else CreamDeep)
                            .clickable { vm.compressMode = mode }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            FieldLabel("Keep last turns: ${vm.keepLast}")
            Slider(
                value = vm.keepLast.toFloat(),
                onValueChange = { vm.keepLast = it.toInt().coerceIn(2, 24) },
                valueRange = 2f..24f,
                colors = SliderDefaults.colors(thumbColor = Coral, activeTrackColor = Coral),
            )
            FieldLabel("Budget threshold: ${(vm.threshold * 100).toInt()}%")
            Slider(
                value = vm.threshold,
                onValueChange = { vm.threshold = it },
                valueRange = 0.4f..0.95f,
                colors = SliderDefaults.colors(thumbColor = Coral, activeTrackColor = Coral),
            )
            Spacer(Modifier.height(12.dp))
            HorizontalDivider(color = Line)
            Spacer(Modifier.height(12.dp))
            Text(
                "Providers, custom models, combos, and gateway keys are managed in the web hub. This client only calls GET /v1/models and POST /v1/chat/completions.",
                color = InkMuted,
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun SettingSwitch(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = Ink, fontSize = 15.sp, modifier = Modifier.weight(1f))
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = Coral),
        )
    }
}

private fun shortModel(id: String): String {
    val tail = id.substringAfterLast('/')
    return tail.ifBlank { id.ifBlank { "Model" } }
}
