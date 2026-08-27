package com.analytics.agent.ui.screens.dataset

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Assessment
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Dataset as DatasetIcon
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.analytics.agent.data.model.Dataset
import com.analytics.agent.data.model.TableProfile
import com.analytics.agent.ui.components.*
import com.analytics.agent.util.FileUtils
import com.analytics.agent.util.Formatters

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DatasetScreen(
    state: DatasetUiState,
    onBack: () -> Unit,
    onUpload: (android.net.Uri) -> Unit,
    onSelectDataset: (Dataset) -> Unit,
    onCancelUpload: () -> Unit,
    onDismissError: () -> Unit,
    onRetry: () -> Unit,
    onOpenQuality: (Dataset) -> Unit,
    onContinue: (Dataset) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenLatestRun: (String) -> Unit,
) {
    val context = LocalContext.current
    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri -> uri?.let(onUpload) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Dataset")
                        state.project?.let {
                            Text(
                                it.name,
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
                actions = {
                    state.project?.latestRun?.let { run ->
                        IconButton(onClick = { onOpenLatestRun(run.id) }) {
                            Icon(Icons.Outlined.Assessment, contentDescription = "Open latest analysis")
                        }
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Outlined.Settings, contentDescription = "Project settings")
                    }
                },
            )
        },
        bottomBar = {
            state.activeDataset?.let { dataset ->
                Surface(tonalElevation = 3.dp) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        OutlinedButton(
                            onClick = { onOpenQuality(dataset) },
                            modifier = Modifier.weight(1f),
                        ) { Text("Data quality") }
                        Button(
                            onClick = { onContinue(dataset) },
                            enabled = state.canContinue,
                            modifier = Modifier.weight(1f),
                        ) { Text("Define report") }
                    }
                }
            }
        },
    ) { padding ->
        when {
            state.loading -> Box(Modifier.padding(padding).fillMaxSize()) {
                LoadingState("Loading dataset…")
            }
            state.error != null && state.datasets.isEmpty() ->
                Box(Modifier.padding(padding).fillMaxSize()) {
                    ErrorState(state.error, onRetry = onRetry)
                }
            else -> Column(
                Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                state.uploadError?.let {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        InlineError(it)
                        TextButton(onClick = onDismissError) { Text("Dismiss") }
                    }
                }

                if (state.uploading) {
                    UploadProgressCard(state, onCancelUpload)
                } else {
                    UploadCard(state.maxUploadMb) {
                        picker.launch(FileUtils.PICKER_MIME_TYPES)
                    }
                }

                if (state.datasets.isEmpty() && !state.uploading) {
                    EmptyState(
                        "No dataset uploaded yet",
                        "Upload a CSV, TSV or Excel file to profile its structure and start an analysis.",
                        icon = Icons.Outlined.DatasetIcon,
                    )
                } else {
                    state.datasets.forEach { dataset ->
                        DatasetCard(
                            dataset = dataset,
                            selected = dataset.id == state.activeDataset?.id,
                            onClick = { onSelectDataset(dataset) },
                        )
                    }
                }

                state.activeDataset?.schema?.tables?.forEach { table ->
                    TableProfileCard(table)
                }

                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun UploadCard(maxUploadMb: Int, onPick: () -> Unit) {
    SectionCard(title = "Upload data") {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .clickable(onClick = onPick)
                .padding(vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                Icons.Outlined.CloudUpload,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
            Text("Choose a file", style = MaterialTheme.typography.titleSmall)
            Text(
                ".csv, .tsv, .xlsx or .xls — up to $maxUploadMb MB",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        Text(
            "Files stream directly to the analytics service; nothing large is held in the phone's memory.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun UploadProgressCard(state: DatasetUiState, onCancel: () -> Unit) {
    SectionCard(title = "Uploading", subtitle = state.uploadFileName) {
        LinearProgressIndicator(
            progress = { state.uploadProgress },
            modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(50)),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                "${(state.uploadProgress * 100).toInt()}%",
                style = MaterialTheme.typography.labelMedium,
            )
            TextButton(onClick = onCancel) { Text("Cancel") }
        }
    }
}

@Composable
private fun DatasetCard(dataset: Dataset, selected: Boolean, onClick: () -> Unit) {
    SectionCard(
        modifier = Modifier.clickable(onClick = onClick),
        title = dataset.name,
        subtitle = "${dataset.sourceType.uppercase()} · ${FileUtils.formatBytes(dataset.fileSize)} · " +
            "uploaded ${Formatters.relativeTime(dataset.createdAt)}",
        trailing = {
            if (selected) StatusChip("Selected", MaterialTheme.colorScheme.primary)
        },
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            Metric("Rows", Formatters.grouped(dataset.rowCount))
            Metric("Columns", dataset.columnCount.toString())
            Metric("Tables", (dataset.schema?.tableCount ?: 1).toString())
        }
        dataset.schema?.warnings?.takeIf { it.isNotEmpty() }?.let { warnings ->
            warnings.forEach { warning ->
                Text(
                    "• $warning",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun Metric(label: String, value: String) {
    Column {
        Text(value, style = MaterialTheme.typography.titleMedium)
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun TableProfileCard(table: TableProfile) {
    SectionCard(
        title = table.tableName,
        subtitle = "${Formatters.grouped(table.rowCount)} rows · ${table.columnCount} columns",
        trailing = {
            if (table.dateRange != null) {
                StatusChip(
                    "${table.dateRange.min.take(10)} → ${table.dateRange.max.take(10)}",
                    MaterialTheme.colorScheme.secondary,
                    leadingDot = false,
                )
            }
        },
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "${table.numericColumns.size} numeric · ${table.dateColumns.size} date · " +
                    "${table.categoryColumns.size} categorical",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        HorizontalDivider()
        table.columns.take(40).forEach { column ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    column.name,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.weight(1.4f),
                )
                Text(
                    column.semanticType.ifBlank { column.dtype },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    if (column.nullPct > 0) "${Formatters.percent(column.nullPct)} null" else "complete",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.End,
                    modifier = Modifier.weight(0.8f),
                )
            }
        }
        if (table.columns.size > 40) {
            Text(
                "+ ${table.columns.size - 40} more columns",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
