package com.analytics.agent.ui.screens.quality

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.analytics.agent.data.model.QualityIssue
import com.analytics.agent.data.model.QualityReport
import com.analytics.agent.ui.UiState
import com.analytics.agent.ui.components.*
import com.analytics.agent.ui.theme.StatusColors

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DataQualityScreen(
    state: UiState<QualityReport>,
    onBack: () -> Unit,
    onRetry: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Data quality") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (state) {
                is UiState.Loading -> LoadingState("Scoring data quality…")
                is UiState.Failure -> ErrorState(state.error, onRetry = onRetry)
                is UiState.Empty -> EmptyState(state.title, state.message)
                is UiState.Success -> QualityContent(state.data)
            }
        }
    }
}

@Composable
fun QualityContent(report: QualityReport, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SectionCard(
            title = "Overall score",
            trailing = { StatusChip(report.grade.ifBlank { "—" }, gradeColor(report.score), leadingDot = false) },
        ) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    report.score.toInt().toString(),
                    style = MaterialTheme.typography.displaySmall,
                    color = gradeColor(report.score),
                )
                Text(
                    " / 100",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 6.dp),
                )
            }
            ScoreBar(report.score)
            Text(
                "Every dimension below is computed directly from your data. " +
                    "No benchmark or industry average is assumed.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        SectionCard(title = "Dimensions") {
            report.completeness?.let { ScoreBar(it.score, label = "Completeness") }
            report.validity?.let { ScoreBar(it.score, label = "Validity") }
            report.consistency?.let { ScoreBar(it.score, label = "Consistency") }
            report.uniqueness?.let { ScoreBar(it.score, label = "Uniqueness") }
            report.relationships?.let { ScoreBar(it.score, label = "Relationships") }
        }

        if (report.issues.isEmpty()) {
            SectionCard(title = "Issues") {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        Icons.Outlined.VerifiedUser,
                        contentDescription = null,
                        tint = StatusColors.positive,
                    )
                    Text("No quality issues were detected in this dataset.")
                }
            }
        } else {
            SectionCard(
                title = "Issues",
                subtitle = "${report.criticalIssueCount} critical · ${report.highIssueCount} high",
            ) {
                report.issues.forEach { issue -> IssueRow(issue) }
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun IssueRow(issue: QualityIssue) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            StatusChip(issue.severity.uppercase(), severityColor(issue.severity))
            Text(
                issue.dimension.replaceFirstChar { it.uppercase() },
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Text(issue.message, style = MaterialTheme.typography.bodySmall)
        val location = listOfNotNull(
            issue.table.takeIf { it.isNotBlank() },
            issue.column.takeIf { it.isNotBlank() },
        ).joinToString(" › ")
        if (location.isNotBlank()) {
            Text(
                location,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        HorizontalDivider(Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun gradeColor(score: Double) = when {
    score >= 85 -> StatusColors.positive
    score >= 60 -> StatusColors.warning
    else -> StatusColors.critical
}

@Composable
private fun severityColor(severity: String) = when (severity.lowercase()) {
    "critical" -> StatusColors.critical
    "high" -> StatusColors.critical
    "medium" -> StatusColors.warning
    else -> StatusColors.neutral
}
