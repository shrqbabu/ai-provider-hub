package com.analytics.agent.ui.screens.dashboard

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.SaveAlt
import androidx.compose.material.icons.outlined.ZoomOutMap
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import com.analytics.agent.ui.UiState
import com.analytics.agent.ui.components.EmptyState
import com.analytics.agent.ui.components.ErrorState
import com.analytics.agent.ui.components.LoadingState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    state: DashboardUiState,
    onBack: () -> Unit,
    onSave: () -> Unit,
    onReload: () -> Unit,
    onConsumeMessage: () -> Unit,
) {
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbarHostState.showSnackbar(it)
            onConsumeMessage()
        }
    }

    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }

    val bitmap: ImageBitmap? = remember(state.imageBytes?.size) {
        state.imageBytes?.let { bytes ->
            runCatching {
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }.getOrNull()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Dashboard") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(
                        onClick = { scale = 1f; offset = Offset.Zero },
                        enabled = bitmap != null,
                    ) {
                        Icon(Icons.Outlined.ZoomOutMap, contentDescription = "Reset zoom")
                    }
                    IconButton(onClick = onSave, enabled = state.imageBytes != null && !state.downloading) {
                        Icon(Icons.Outlined.SaveAlt, contentDescription = "Save PNG to device")
                    }
                },
            )
        },
        bottomBar = {
            (state.state as? UiState.Success)?.data?.let { artifact ->
                Surface(tonalElevation = 3.dp) {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(artifact.fileName, style = MaterialTheme.typography.titleSmall)
                        Text(
                            bitmap?.let { "${it.width} × ${it.height} px · pinch to zoom, drag to pan" }
                                ?: "Loading full-resolution image…",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .background(Color(0xFF0B1120)),
            contentAlignment = Alignment.Center,
        ) {
            when (val s = state.state) {
                is UiState.Loading -> LoadingState("Loading dashboard…")
                is UiState.Failure -> ErrorState(s.error, onRetry = onReload)
                is UiState.Empty -> EmptyState(s.title, s.message)
                is UiState.Success -> {
                    if (bitmap == null) {
                        LoadingState("Downloading the high-resolution PNG…")
                    } else {
                        Image(
                            bitmap = bitmap,
                            contentDescription =
                            "Generated analytics dashboard image, ${bitmap.width} by ${bitmap.height} pixels",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier
                                .fillMaxSize()
                                .pointerInput(Unit) {
                                    detectTransformGestures { _, pan, zoom, _ ->
                                        scale = (scale * zoom).coerceIn(1f, 8f)
                                        offset = if (scale <= 1f) Offset.Zero else offset + pan
                                    }
                                }
                                .pointerInput(Unit) {
                                    detectTapGestures(
                                        onDoubleTap = {
                                            if (scale > 1f) {
                                                scale = 1f
                                                offset = Offset.Zero
                                            } else {
                                                scale = 3f
                                            }
                                        },
                                    )
                                }
                                .graphicsLayer(
                                    scaleX = scale,
                                    scaleY = scale,
                                    translationX = offset.x,
                                    translationY = offset.y,
                                ),
                        )
                    }
                }
            }

            if (state.downloading) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            }
        }
    }
}
