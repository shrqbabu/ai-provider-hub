package com.aihub.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

val Cream = Color(0xFFF6F1EA)
val CreamDeep = Color(0xFFEFE8DD)
val Ink = Color(0xFF1C1917)
val InkMuted = Color(0xFF6B6560)
val Coral = Color(0xFFD97757)
val CoralPress = Color(0xFFC96442)
val Line = Color(0xFFE6E0D6)
val White = Color(0xFFFFFFFF)
val Charcoal = Color(0xFF262624)
val CharcoalLift = Color(0xFF30302E)
val DarkInk = Color(0xFFE8E4DC)
val DarkMuted = Color(0xFF9A958C)
val DarkLine = Color(0xFF3A3936)
val UserDark = Color(0xFF3A3936)

data class HubColors(
    val canvas: Color,
    val surface: Color,
    val ink: Color,
    val muted: Color,
    val line: Color,
    val pill: Color,
    val userBubble: Color,
    val onPill: Color,
)

val LightHub = HubColors(Cream, CreamDeep, Ink, InkMuted, Line, White, Color(0xFFE8E0D4), Ink)
val DarkHub = HubColors(Charcoal, CharcoalLift, DarkInk, DarkMuted, DarkLine, CharcoalLift, UserDark, DarkInk)

val LocalHubColors = staticCompositionLocalOf { LightHub }

@Composable
fun HubTheme(theme: String = "light", content: @Composable () -> Unit) {
    val dark = when (theme) {
        "dark" -> true
        "system" -> isSystemInDarkTheme()
        else -> false
    }
    val hub = if (dark) DarkHub else LightHub
    val scheme = if (dark) {
        darkColorScheme(
            primary = Coral,
            onPrimary = White,
            background = Charcoal,
            onBackground = DarkInk,
            surface = Charcoal,
            onSurface = DarkInk,
            surfaceVariant = CharcoalLift,
            onSurfaceVariant = DarkMuted,
            outline = DarkLine,
        )
    } else {
        lightColorScheme(
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
    }
    CompositionLocalProvider(LocalHubColors provides hub) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
