package com.analytics.agent.ui.screens.progress

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.analytics.agent.ui.components.InlineError
import com.analytics.agent.ui.components.LoadingState
import com.analytics.agent.ui.components.RunStatusChip
import com.analytics.agent.ui.components.SectionCard
import com.analytics.agent.ui.theme.StatusColors
import com.analytics.agent.util.Formatters
import com.analytics.agent.util.PipelineStage

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalysisProgressScreen(
    state: ProgressUiState,
    onBack: () -> Unit,
    onCancel: () -> Unit,
    onViewResults: () -> Unit,
    onRetryWatch: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Analysis in progress") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = { state.run?.let { RunStatusChip(it.status, Modifier.padding(end = 12.dp)) } },
            )
        },
        bottomBar = {
            val run = state.run
            Surface(tonalElevation = 3.dp) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (run != null && run.isActive) {
                        OutlinedButton(
                            onClick = onCancel,
                            enabled = !state.cancelling,
                            modifier = Modifier.weight(1f),
                        ) { Text(if (state.cancelling) "Cancelling…" else "Cancel run") }
                    }
                    if (run != null && !run.isActive) {
                        Button(
                            onClick = onViewResults,
                            modifier = Modifier.weight(1f),
                            enabled = run.status != "cancelled",
                        ) { Text("View results") }
                    }
                }
            }
        },
    ) { padding ->
        if (state.loading && state.run == null) {
            Box(Modifier.padding(padding).fillMaxSize()) { LoadingState("Connecting to the analysis…") }
            return@Scaffold
        }

        val run = state.run
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            state.errorMessage?.let {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    InlineError(it)
                    TextButton(onClick = onRetryWatch) { Text("Reconnect") }
                }
            }

            if (run != null) {
                val progress by animateFloatAsState(run.progress / 100f, label = "progress")
                SectionCard(
                    title = PipelineStage.labelFor(run.stageKey ?: run.stage, run.stageLabel),
                    subtitle = PipelineStage.fromKey(run.stageKey ?: run.stage)?.description,
                ) {
                    LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(10.dp)
                            .clip(RoundedCornerShape(50))
                            .semantics { contentDescription = "Analysis ${run.progress} percent complete" },
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("${run.progress}%", style = MaterialTheme.typography.titleMedium)
                        Text(
                            run.durationMs?.let { "Elapsed ${Formatters.duration(it)}" }
                                ?: Formatters.relativeTime(run.startedAt ?: run.createdAt),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (run.userPrompt.isNotBlank()) {
                        HorizontalDivider()
                        Text(
                            "Requested report",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(run.userPrompt, style = MaterialTheme.typography.bodySmall)
                    }
                }

                run.error?.let { error ->
                    SectionCard(title = "The run stopped") {
                        InlineError(error.message)
                        Text(
                            "Stage: ${PipelineStage.labelFor(error.stage, error.stage)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (error.recoverable) {
                            Text(
                                "Your dataset is untouched. Adjust the request or the data and run it again.",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }

                SectionCard(title = "Pipeline") {
                    val currentIndex = PipelineStage.indexOfKey(run.stageKey ?: run.stage)
                        .let { if (it < 0) stageIndexFromProgress(run.progress) else it }
                    PipelineStage.entries.forEachIndexed { index, stage ->
                        StageRow(
                            stage = stage,
                            done = index < currentIndex || run.status == "completed",
                            active = index == currentIndex && run.isActive,
                        )
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

private fun stageIndexFromProgress(progress: Int): Int =
    PipelineStage.entries.indexOfLast { it.progress <= progress }.coerceAtLeast(0)

@Composable
private fun StageRow(stage: PipelineStage, done: Boolean, active: Boolean) {
    val color = when {
        done -> StatusColors.positive
        active -> StatusColors.running
        else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp)
            .semantics {
                contentDescription = "${stage.label}: ${
                    when { done -> "done"; active -> "in progress"; else -> "pending" }
                }"
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (active) {
            Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = color)
            }
        } else {
            Icon(
                if (done) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(18.dp),
            )
        }
        Text(
            stage.label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
            color = if (done || active) MaterialTheme.colorScheme.onSurface
            else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Box(
            Modifier
                .size(6.dp)
                .clip(CircleShape)
                .background(if (done || active) color else androidx.compose.ui.graphics.Color.Transparent),
        )
    }
}
