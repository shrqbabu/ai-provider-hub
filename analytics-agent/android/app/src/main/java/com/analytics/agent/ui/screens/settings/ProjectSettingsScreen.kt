package com.analytics.agent.ui.screens.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.analytics.agent.ui.components.*
import com.analytics.agent.util.FileUtils
import com.analytics.agent.util.Formatters

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectSettingsScreen(
    state: ProjectSettingsUiState,
    onBack: () -> Unit,
    onNameChange: (String) -> Unit,
    onDescriptionChange: (String) -> Unit,
    onSave: () -> Unit,
    onShowDeleteDialog: (Boolean) -> Unit,
    onDeleteConfirmChange: (String) -> Unit,
    onDelete: () -> Unit,
    onOpenRun: (String) -> Unit,
    onConsumeMessage: () -> Unit,
) {
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(state.message) {
        state.message?.let {
            snackbarHostState.showSnackbar(it)
            onConsumeMessage()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Project settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                    }
                },
            )
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

            SectionCard(title = "Details") {
                OutlinedTextField(
                    value = state.name,
                    onValueChange = onNameChange,
                    label = { Text("Project name") },
                    singleLine = true,
                    enabled = !state.saving,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = state.description,
                    onValueChange = onDescriptionChange,
                    label = { Text("Description") },
                    minLines = 3,
                    enabled = !state.saving,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = onSave,
                    enabled = state.dirty && !state.saving,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (state.saving) "Saving…" else "Save changes") }
            }

            state.project?.let { project ->
                SectionCard(title = "Project") {
                    KeyValueRow("Source type", project.sourceType.uppercase())
                    KeyValueRow("Status", project.status.replaceFirstChar { it.uppercase() })
                    KeyValueRow("Created", Formatters.relativeTime(project.createdAt))
                    KeyValueRow("Last run", Formatters.relativeTime(project.lastRunAt))
                    KeyValueRow("Project ID", project.id)
                }
            }

            SectionCard(title = "Datasets", subtitle = "${state.datasets.size} uploaded") {
                if (state.datasets.isEmpty()) {
                    Text(
                        "No dataset has been uploaded to this project.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    state.datasets.forEach { dataset ->
                        KeyValueRow(
                            dataset.name,
                            "${Formatters.grouped(dataset.rowCount)} rows · " +
                                FileUtils.formatBytes(dataset.fileSize),
                        )
                    }
                }
            }

            SectionCard(
                title = "Analysis history",
                subtitle = "Runs are immutable — re-running never overwrites a previous result.",
            ) {
                if (state.runs.isEmpty()) {
                    Text(
                        "No analysis has been run yet.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    state.runs.forEach { run ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { onOpenRun(run.id) }
                                .padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    run.userPrompt.take(90).ifBlank { "Analysis run" },
                                    style = MaterialTheme.typography.bodySmall,
                                    maxLines = 2,
                                )
                                Text(
                                    "${Formatters.relativeTime(run.createdAt)} · " +
                                        "${run.metricCount} metrics · ${run.insightCount} insights",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    run.id,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontFamily = FontFamily.Monospace,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            RunStatusChip(run.status)
                        }
                        HorizontalDivider()
                    }
                }
            }

            SectionCard(title = "Danger zone") {
                Text(
                    "Deleting this project permanently removes its datasets, analysis runs, metrics, " +
                        "insights, DAX measures and every stored file, including the dashboard images. " +
                        "This cannot be undone.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(
                    onClick = { onShowDeleteDialog(true) },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Outlined.DeleteForever, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Delete project")
                }
            }

            Spacer(Modifier.height(24.dp))
        }

        if (state.showDeleteDialog && state.project != null) {
            AlertDialog(
                onDismissRequest = { onShowDeleteDialog(false) },
                title = { Text("Delete \"${state.project.name}\"?") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            "This removes every dataset, run, metric, insight, DAX measure and stored file " +
                                "for this project. Type the project name to confirm.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        OutlinedTextField(
                            value = state.deleteConfirmText,
                            onValueChange = onDeleteConfirmChange,
                            label = { Text("Project name") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = onDelete, enabled = state.deleteEnabled) {
                        Text(
                            if (state.deleting) "Deleting…" else "Delete permanently",
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                },
                dismissButton = {
                    TextButton(onClick = { onShowDeleteDialog(false) }) { Text("Cancel") }
                },
            )
        }
    }
}
