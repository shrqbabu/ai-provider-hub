package com.aihub.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Cream = Color(0xFFF6F1EA)
val CreamDeep = Color(0xFFEFE8DD)
val Ink = Color(0xFF1C1917)
val InkMuted = Color(0xFF6B6560)
val Coral = Color(0xFFD97757)
val Line = Color(0xFFE6E0D6)
val White = Color(0xFFFFFFFF)

private val scheme = lightColorScheme(
    primary = Coral,
    onPrimary = White,
    background = Cream,
    onBackground = Ink,
    surface = Cream,
    onSurface = Ink,
    surfaceVariant = CreamDeep,
    onSurfaceVariant = InkMuted,
    outline = Line,
)

@Composable
fun HubTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}
