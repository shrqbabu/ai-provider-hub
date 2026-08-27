package com.analytics.agent.ui.screens.prompt

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.analytics.agent.ui.components.InlineError
import com.analytics.agent.ui.components.LoadingState
import com.analytics.agent.ui.components.SectionCard
import com.analytics.agent.util.Formatters

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ReportPromptScreen(
    state: PromptUiState,
    onBack: () -> Unit,
    onPromptChange: (String) -> Unit,
    onSuggestion: (String) -> Unit,
    onStart: () -> Unit,
    onOpenActiveRun: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Define your report")
                        if (state.projectName.isNotBlank()) {
                            Text(
                                state.projectName,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        bottomBar = {
            Surface(tonalElevation = 3.dp) {
                Button(
                    onClick = onStart,
                    enabled = state.canSubmit,
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(16.dp)
                        .height(52.dp),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    if (state.submitting) {
                        CircularProgressIndicator(
                            Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                        Spacer(Modifier.width(12.dp))
                        Text("Starting analysis…")
                    } else {
                        Icon(Icons.Outlined.PlayArrow, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Run analysis")
                    }
                }
            }
        },
    ) { padding ->
        if (state.loading) {
            Box(Modifier.padding(padding).fillMaxSize()) { LoadingState() }
            return@Scaffold
        }

        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            state.errorMessage?.let { InlineError(it) }

            if (!state.hasDataset) {
                InlineError("This project has no dataset yet. Upload a file before running an analysis.")
            }

            state.activeRunId?.let { runId ->
                SectionCard(title = "An analysis is already running") {
                    Text(
                        "You can watch its progress instead of starting a second run.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    FilledTonalButton(onClick = { onOpenActiveRun(runId) }) { Text("Open running analysis") }
                }
            }

            SectionCard(
                title = "What should the report contain?",
                subtitle = "Describe the sections, metrics and breakdowns you want. " +
                    "The agent only reports what your data can actually support.",
            ) {
                OutlinedTextField(
                    value = state.prompt,
                    onValueChange = onPromptChange,
                    minLines = 8,
                    placeholder = {
                        Text(
                            "e.g. Revenue trend by month, top 10 products, regional breakdown, " +
                                "customer repeat rate, and a six-month forecast.",
                        )
                    },
                    supportingText = {
                        Text(
                            "${state.characterCount} / ${PromptUiState.MAX_PROMPT} characters " +
                                "(minimum ${PromptUiState.MIN_PROMPT})",
                        )
                    },
                    enabled = !state.submitting,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            SectionCard(title = "Starting points") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PROMPT_SUGGESTIONS.forEach { (label, text) ->
                        AssistChip(
                            onClick = { onSuggestion(text) },
                            label = { Text(label) },
                            enabled = !state.submitting,
                        )
                    }
                }
                Text(
                    "Anything the data cannot support is reported back as NOT SUPPORTED with an explanation " +
                        "and an alternative — never guessed.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (state.history.isNotEmpty()) {
                SectionCard(title = "Previous requests", subtitle = "Every run keeps its original prompt.") {
                    state.history.take(10).forEach { entry ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 6.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(
                                Icons.Outlined.History,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Column(Modifier.weight(1f)) {
                                Text(
                                    entry.prompt,
                                    style = MaterialTheme.typography.bodySmall,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    "${entry.status.orEmpty().replaceFirstChar { it.uppercase() }} · " +
                                        Formatters.relativeTime(entry.createdAt),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            TextButton(onClick = { onSuggestion(entry.prompt) }) { Text("Reuse") }
                        }
                        HorizontalDivider()
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
        }
    }
}
