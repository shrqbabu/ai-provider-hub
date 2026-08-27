package com.analytics.agent.ui.screens.dax

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.analytics.agent.data.model.DaxMeasure
import com.analytics.agent.ui.UiState
import com.analytics.agent.ui.components.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DaxScreen(
    state: DaxUiState,
    onBack: () -> Unit,
    onQueryChange: (String) -> Unit,
    onSelectGroup: (String?) -> Unit,
    onToggleExpanded: (String) -> Unit,
    onReload: () -> Unit,
    onExport: suspend () -> String?,
    onMessage: (String?) -> Unit,
) {
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbarHostState.showSnackbar(it)
            onMessage(null)
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("DAX library") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(
                        onClick = {
                            copyToClipboard(context, state.allCode)
                            onMessage("All visible measures copied.")
                        },
                        enabled = state.response != null,
                    ) {
                        Icon(Icons.Outlined.ContentCopy, contentDescription = "Copy all measures")
                    }
                    IconButton(
                        onClick = {
                            scope.launch {
                                val text = onExport()
                                if (text.isNullOrBlank()) {
                                    onMessage("Nothing to export yet.")
                                } else {
                                    shareText(context, state.downloadFileName, text)
                                }
                            }
                        },
                        enabled = state.response != null,
                    ) {
                        Icon(Icons.Outlined.Download, contentDescription = "Export .dax file")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            when (val s = state.state) {
                is UiState.Loading -> LoadingState("Loading DAX measures…")
                is UiState.Failure -> ErrorState(s.error, onRetry = onReload)
                is UiState.Empty -> EmptyState(s.title, s.message)
                is UiState.Success -> {
                    OutlinedTextField(
                        value = state.query,
                        onValueChange = onQueryChange,
                        placeholder = { Text("Search measures or code") },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth().padding(16.dp, 12.dp, 16.dp, 8.dp),
                    )
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilterChip(
                            selected = state.selectedGroup == null,
                            onClick = { onSelectGroup(null) },
                            label = { Text("All") },
                        )
                        state.groupNames.forEach { group ->
                            FilterChip(
                                selected = state.selectedGroup == group,
                                onClick = { onSelectGroup(group) },
                                label = { Text(group.removeSuffix(" Measures")) },
                            )
                        }
                    }

                    val groups = state.visibleGroups
                    if (groups.isEmpty()) {
                        EmptyState("No matching measures", "Nothing matches \"${state.query}\".")
                    } else {
                        LazyColumn(
                            contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 32.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            groups.forEach { (group, measures) ->
                                item(key = "header-$group") {
                                    Text(
                                        "$group · ${measures.size}",
                                        style = MaterialTheme.typography.titleSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.padding(top = 8.dp),
                                    )
                                }
                                items(measures, key = { "${group}-${it.name}" }) { measure ->
                                    MeasureCard(
                                        measure = measure,
                                        expanded = measure.name in state.expanded,
                                        onToggle = { onToggleExpanded(measure.name) },
                                        onCopy = {
                                            copyToClipboard(context, measure.daxCode)
                                            onMessage("${measure.name} copied.")
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MeasureCard(
    measure: DaxMeasure,
    expanded: Boolean,
    onToggle: () -> Unit,
    onCopy: () -> Unit,
) {
    SectionCard(
        title = measure.name,
        subtitle = measure.purpose.takeIf { it.isNotBlank() },
        trailing = { ValidationChip(measure.validationStatus) },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            StatusChip(
                if (measure.kind == "calculated_column") "Calculated column" else "Measure",
                MaterialTheme.colorScheme.secondary,
                leadingDot = false,
            )
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onCopy) {
                Icon(Icons.Outlined.ContentCopy, contentDescription = "Copy ${measure.name}")
            }
            IconButton(onClick = onToggle) {
                Icon(
                    if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = if (expanded) "Collapse code" else "Expand code",
                )
            }
        }

        val code = if (expanded) measure.daxCode else measure.daxCode.lines().take(4).joinToString("\n")
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Box(Modifier.horizontalScroll(rememberScrollState()).padding(12.dp)) {
                Text(
                    code + if (!expanded && measure.daxCode.lines().size > 4) "\n…" else "",
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }

        if (measure.validationErrors.isNotEmpty()) {
            measure.validationErrors.forEach { InlineError(it) }
        }
    }
}

private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("DAX", text))
}

private fun shareText(context: Context, fileName: String, text: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TITLE, fileName)
        putExtra(Intent.EXTRA_SUBJECT, fileName)
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(intent, "Export $fileName"))
}
