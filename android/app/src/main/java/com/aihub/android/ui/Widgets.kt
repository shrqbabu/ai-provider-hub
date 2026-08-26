package com.aihub.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aihub.android.ui.theme.Coral
import com.aihub.android.ui.theme.LocalHubColors

@Composable
fun HubField(
    value: String,
    hint: String,
    secret: Boolean = false,
    singleLine: Boolean = true,
    onChange: (String) -> Unit,
) {
    val c = LocalHubColors.current
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text(hint, color = c.muted) },
        singleLine = singleLine,
        minLines = if (singleLine) 1 else 5,
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        modifier = Modifier.fillMaxWidth(),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Coral,
            unfocusedBorderColor = c.line,
            focusedTextColor = c.ink,
            unfocusedTextColor = c.ink,
            cursorColor = Coral,
            focusedContainerColor = c.pill,
            unfocusedContainerColor = c.pill,
        ),
        shape = RoundedCornerShape(14.dp),
    )
}

@Composable
fun FieldLabel(text: String) {
    val c = LocalHubColors.current
    Text(text, color = c.muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 6.dp, top = 10.dp))
}

@Composable
fun SettingSwitch(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val c = LocalHubColors.current
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = c.ink, fontSize = 15.sp, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange, colors = SwitchDefaults.colors(checkedTrackColor = Coral))
    }
}

@Composable
fun EmptyHint(text: String) {
    val c = LocalHubColors.current
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, color = c.muted, fontSize = 15.sp, textAlign = TextAlign.Center)
    }
}

@Composable
fun CenterSpinner() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Coral, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
    }
}

@Composable
fun PageHeader(title: String, onBack: () -> Unit) {
    val c = LocalHubColors.current
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack, modifier = Modifier.size(44.dp)) {
            Icon(Icons.Outlined.ArrowBack, contentDescription = "Back", tint = c.ink)
        }
        Text(title, color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun QuietRow(title: String, subtitle: String = "", onClick: () -> Unit) {
    val c = LocalHubColors.current
    androidx.compose.foundation.layout.Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 12.dp),
    ) {
        Text(title, color = c.ink, fontSize = 16.sp)
        if (subtitle.isNotBlank()) Text(subtitle, color = c.muted, fontSize = 12.sp)
    }
}

@Composable
fun ModeChips(selected: String, modes: List<String>, onPick: (String) -> Unit) {
    val c = LocalHubColors.current
    Row(Modifier.fillMaxWidth()) {
        modes.forEach { mode ->
            val on = selected == mode
            Text(
                mode,
                color = if (on) c.pill else c.ink,
                fontSize = 13.sp,
                modifier = Modifier
                    .padding(end = 8.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(if (on) c.ink else c.surface)
                    .clickable { onPick(mode) }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
    }
}

fun shortModel(id: String): String {
    val tail = id.substringAfterLast('/')
    return tail.ifBlank { id.ifBlank { "Model" } }
}
