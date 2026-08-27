package com.analytics.agent.ui.screens.results

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.analytics.agent.data.model.*
import com.analytics.agent.ui.UiState
import com.analytics.agent.ui.components.*
import com.analytics.agent.ui.screens.quality.QualityContent
import com.analytics.agent.ui.theme.StatusColors
import com.analytics.agent.util.FileUtils
import com.analytics.agent.util.Formatters

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalysisResultsScreen(
    state: ResultsUiState,
    onBack: () -> Unit,
    onSelectTab: (ResultTab) -> Unit,
    onReload: () -> Unit,
    onMetricQueryChange: (String) -> Unit,
    onOpenDax: () -> Unit,
    onOpenDashboard: () -> Unit,
) {
    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = { Text("Analysis results") },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                        }
                    },
                    actions = {
                        IconButton(onClick = onReload) {
                            Icon(Icons.Outlined.Refresh, contentDescription = "Reload results")
                        }
                    },
                )
                ScrollableTabRow(
                    selectedTabIndex = state.tab.ordinal,
                    edgePadding = 12.dp,
                ) {
                    ResultTab.entries.forEach { tab ->
                        Tab(
                            selected = state.tab == tab,
                            onClick = { onSelectTab(tab) },
                            text = { Text(tab.title, maxLines = 1) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (state.tab) {
                ResultTab.OVERVIEW -> OverviewTab(state, onReload, onOpenDax, onOpenDashboard)
                ResultTab.INSIGHTS -> InsightsTab(state.insights, onReload)
                ResultTab.METRICS -> MetricsTab(state, onMetricQueryChange, onReload)
                ResultTab.REPORT -> ReportTab(state.report, onReload)
                ResultTab.DAX -> DaxSummaryTab(state.dax, onOpenDax, onReload)
                ResultTab.DASHBOARD -> DashboardTab(state.dashboard, onOpenDashboard, onReload)
                ResultTab.QUALITY -> QualityTab(state.quality, onReload)
            }
        }
    }
}

// -- Overview -----------------------------------------------------------------

@Composable
private fun OverviewTab(
    state: ResultsUiState,
    onReload: () -> Unit,
    onOpenDax: () -> Unit,
    onOpenDashboard: () -> Unit,
) {
    when (val s = state.overview) {
        is UiState.Loading -> LoadingState("Loading results…")
        is UiState.Failure -> ErrorState(s.error, onRetry = onReload)
        is UiState.Empty -> EmptyState(s.title, s.message)
        is UiState.Success -> {
            val data = s.data
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                SectionCard(
                    title = "Run status",
                    trailing = { RunStatusChip(data.run.status) },
                ) {
                    KeyValueRow("Stage", data.run.stageLabel ?: data.run.stage)
                    KeyValueRow(
                        "Duration",
                        data.run.durationMs?.let { Formatters.duration(it) } ?: "—",
                    )
                    KeyValueRow("Metrics", data.run.metricCount.toString())
                    KeyValueRow("Insights", data.run.insightCount.toString())
                    if (data.run.userPrompt.isNotBlank()) {
                        HorizontalDivider(Modifier.padding(vertical = 6.dp))
                        Text(
                            "Requested report",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(data.run.userPrompt, style = MaterialTheme.typography.bodySmall)
                    }
                }

                data.validation?.let { ValidationCard(it) }

                if (data.headlineMetrics.isNotEmpty()) {
                    SectionCard(title = "Headline metrics", subtitle = "Computed by the deterministic engine.") {
                        data.headlineMetrics.forEach { metric ->
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(metric.name, style = MaterialTheme.typography.bodyMedium)
                                    metric.value?.period?.let {
                                        Text(
                                            it,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                Text(
                                    metric.value?.display.orEmpty(),
                                    style = MaterialTheme.typography.titleMedium,
                                )
                            }
                            HorizontalDivider()
                        }
                    }
                }

                data.plan?.let { plan ->
                    if (plan.selectedSkillKeys.isNotEmpty()) {
                        SectionCard(
                            title = "Skills applied",
                            subtitle = "Chosen automatically from your data and your request.",
                        ) {
                            Row(
                                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                plan.selectedSkillKeys.forEach { skill ->
                                    StatusChip(
                                        Formatters.titleCase(skill),
                                        MaterialTheme.colorScheme.secondary,
                                        leadingDot = false,
                                    )
                                }
                            }
                        }
                    }
                }

                val unsupported = data.unsupported.ifEmpty { data.plan?.unsupportedRequests.orEmpty() }
                if (unsupported.isNotEmpty()) {
                    SectionCard(
                        title = "Not supported by this data",
                        subtitle = "These parts of your request were declined rather than guessed.",
                    ) {
                        unsupported.forEach { item ->
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Icon(
                                    Icons.Outlined.Block,
                                    contentDescription = null,
                                    tint = StatusColors.warning,
                                    modifier = Modifier.size(18.dp),
                                )
                                Column {
                                    Text(item.requested, style = MaterialTheme.typography.titleSmall)
                                    if (item.reason.isNotBlank()) {
                                        Text(item.reason, style = MaterialTheme.typography.bodySmall)
                                    }
                                    if (item.alternative.isNotBlank()) {
                                        Text(
                                            "Alternative: ${item.alternative}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                }
                            }
                            HorizontalDivider()
                        }
                    }
                }

                if (state.artifacts.isNotEmpty()) {
                    SectionCard(title = "Artifacts") {
                        state.artifacts.forEach { artifact ->
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(artifact.fileName, style = MaterialTheme.typography.bodySmall)
                                    Text(
                                        "${Formatters.titleCase(artifact.artifactType)} · " +
                                            FileUtils.formatBytes(artifact.fileSize),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                when (artifact.artifactType) {
                                    "dashboard_png" -> TextButton(onClick = onOpenDashboard) { Text("View") }
                                    "dax" -> TextButton(onClick = onOpenDax) { Text("Open") }
                                }
                            }
                            HorizontalDivider()
                        }
                    }
                }

                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun ValidationCard(validation: ValidationReport) {
    SectionCard(
        title = "Independent validation",
        subtitle = validation.summary.takeIf { it.isNotBlank() },
        trailing = { ValidationChip(if (validation.passed) "valid" else validation.status) },
    ) {
        LinearProgressIndicator(
            progress = {
                if (validation.checksTotal == 0) 0f
                else validation.checksPassed.toFloat() / validation.checksTotal
            },
            modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(50)),
            color = if (validation.passed) StatusColors.positive else StatusColors.critical,
        )
        Text(
            "${validation.checksPassed} of ${validation.checksTotal} checks passed · " +
                "${validation.criticalCount} critical · ${validation.highCount} high",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        validation.issues.take(12).forEach { issue ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatusChip(issue.severity.uppercase(), severityColor(issue.severity))
                Column {
                    Text(
                        Formatters.titleCase(issue.area),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(issue.message, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

// -- Insights -----------------------------------------------------------------

@Composable
private fun InsightsTab(state: UiState<List<Insight>>, onReload: () -> Unit) {
    when (state) {
        is UiState.Loading -> LoadingState("Loading insights…")
        is UiState.Failure -> ErrorState(state.error, onRetry = onReload)
        is UiState.Empty -> EmptyState(state.title, state.message)
        is UiState.Success -> LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(state.data, key = { it.id.ifBlank { it.title } }) { insight ->
                SectionCard(
                    title = insight.title,
                    trailing = { ValidationChip(insight.validationStatus) },
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatusChip(
                            "Priority: ${insight.priority}",
                            priorityColor(insight.priority),
                            leadingDot = false,
                        )
                        StatusChip(
                            "Confidence: ${insight.confidence}",
                            MaterialTheme.colorScheme.secondary,
                            leadingDot = false,
                        )
                    }
                    LabelledParagraph("Finding", insight.finding)
                    LabelledParagraph("What it means", insight.interpretation)
                    LabelledParagraph("Business impact", insight.businessImpact)
                    LabelledParagraph("Recommendation", insight.recommendation)
                    insight.evidence?.values?.takeIf { it.isNotEmpty() }?.let { values ->
                        HorizontalDivider()
                        Text(
                            "Evidence",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        values.forEach { value ->
                            KeyValueRow(value.name.ifBlank { value.metricId }, value.display)
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun LabelledParagraph(label: String, body: String) {
    if (body.isBlank()) return
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(body, style = MaterialTheme.typography.bodySmall)
    }
}

// -- Metrics ------------------------------------------------------------------

@Composable
private fun MetricsTab(
    state: ResultsUiState,
    onQueryChange: (String) -> Unit,
    onReload: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = state.metricQuery,
            onValueChange = onQueryChange,
            placeholder = { Text("Search metrics") },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().padding(16.dp, 12.dp, 16.dp, 4.dp),
        )
        when (val s = state.metrics) {
            is UiState.Loading -> LoadingState("Loading metric registry…")
            is UiState.Failure -> ErrorState(s.error, onRetry = onReload)
            is UiState.Empty -> EmptyState(s.title, s.message)
            is UiState.Success -> {
                val metrics = state.filteredMetrics
                if (metrics.isEmpty()) {
                    EmptyState("No matching metrics", "Nothing matches \"${state.metricQuery}\".")
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 24.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(metrics, key = { it.metricId }) { metric ->
                            SectionCard(
                                title = metric.name,
                                trailing = { ValidationChip(metric.validationStatus) },
                            ) {
                                Text(
                                    metric.value?.display.orEmpty(),
                                    style = MaterialTheme.typography.headlineSmall,
                                )
                                if (metric.definition.isNotBlank()) {
                                    Text(metric.definition, style = MaterialTheme.typography.bodySmall)
                                }
                                if (metric.formula.isNotBlank()) {
                                    Text(
                                        metric.formula,
                                        style = MaterialTheme.typography.labelSmall,
                                        fontFamily = FontFamily.Monospace,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Text(
                                    metric.metricId,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontFamily = FontFamily.Monospace,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

// -- Report -------------------------------------------------------------------

@Composable
private fun ReportTab(state: UiState<Report>, onReload: () -> Unit) {
    when (state) {
        is UiState.Loading -> LoadingState("Loading report…")
        is UiState.Failure -> ErrorState(state.error, onRetry = onReload)
        is UiState.Empty -> EmptyState(state.title, state.message)
        is UiState.Success -> LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(state.data.sections) { section ->
                SectionCard(title = section.title) {
                    Text(section.body, style = MaterialTheme.typography.bodyMedium)
                }
            }
            item {
                Text(
                    "Generated by: ${state.data.generator}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 24.dp),
                )
            }
        }
    }
}

// -- DAX / Dashboard / Quality previews ---------------------------------------

@Composable
private fun DaxSummaryTab(state: UiState<DaxResponse>, onOpenDax: () -> Unit, onReload: () -> Unit) {
    when (state) {
        is UiState.Loading -> LoadingState("Loading DAX…")
        is UiState.Failure -> ErrorState(state.error, onRetry = onReload)
        is UiState.Empty -> EmptyState(state.title, state.message)
        is UiState.Success -> Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            val summary = state.data.summary
            SectionCard(
                title = "DAX measures",
                subtitle = "${state.data.measures.size} generated across ${state.data.groups.size} groups",
                trailing = { ValidationChip(if (summary?.passed == true) "valid" else "warning") },
            ) {
                KeyValueRow("Valid", (summary?.valid ?: 0).toString())
                KeyValueRow("Warnings", (summary?.warning ?: 0).toString())
                KeyValueRow("Failed", (summary?.failed ?: 0).toString())
                Button(onClick = onOpenDax, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.OpenInNew, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Open DAX library")
                }
            }
            state.data.groups.forEach { (group, measures) ->
                SectionCard(title = group, subtitle = "${measures.size} measures") {
                    measures.take(6).forEach {
                        Text("• ${it.name}", style = MaterialTheme.typography.bodySmall)
                    }
                    if (measures.size > 6) {
                        Text(
                            "+ ${measures.size - 6} more",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun DashboardTab(state: UiState<Artifact>, onOpen: () -> Unit, onReload: () -> Unit) {
    when (state) {
        is UiState.Loading -> LoadingState("Loading dashboard…")
        is UiState.Failure -> ErrorState(state.error, onRetry = onReload)
        is UiState.Empty -> EmptyState(state.title, state.message)
        is UiState.Success -> Column(
            Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            SectionCard(title = "Dashboard image", subtitle = state.data.fileName) {
                KeyValueRow("Size", FileUtils.formatBytes(state.data.fileSize))
                KeyValueRow("Format", state.data.mimeType)
                Text(
                    "Rendered as a high-resolution PNG from validated metric values only.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.OpenInNew, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Open full dashboard")
                }
            }
        }
    }
}

@Composable
private fun QualityTab(state: UiState<DataQuality>, onReload: () -> Unit) {
    when (state) {
        is UiState.Loading -> LoadingState("Loading data quality…")
        is UiState.Failure -> ErrorState(state.error, onRetry = onReload)
        is UiState.Empty -> EmptyState(state.title, state.message)
        is UiState.Success -> QualityContent(
            QualityReport(
                score = state.data.score ?: 0.0,
                grade = gradeFor(state.data.score ?: 0.0),
                issues = state.data.issues,
            ),
        )
    }
}

private fun gradeFor(score: Double): String = when {
    score >= 90 -> "Excellent"
    score >= 75 -> "Good"
    score >= 60 -> "Fair"
    else -> "Poor"
}

@Composable
private fun severityColor(severity: String) = when (severity.lowercase()) {
    "critical", "high" -> StatusColors.critical
    "medium" -> StatusColors.warning
    else -> StatusColors.neutral
}

@Composable
private fun priorityColor(priority: String) = when (priority.lowercase()) {
    "high" -> StatusColors.critical
    "medium" -> StatusColors.warning
    else -> StatusColors.neutral
}
