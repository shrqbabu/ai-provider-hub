package com.analytics.agent.ui.screens.newproject

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.analytics.agent.ui.components.InlineError
import com.analytics.agent.ui.components.SectionCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewProjectScreen(
    state: NewProjectUiState,
    onNameChange: (String) -> Unit,
    onDescriptionChange: (String) -> Unit,
    onSourceTypeChange: (SourceType) -> Unit,
    onCreate: () -> Unit,
    onBack: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("New project") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            state.errorMessage?.let { InlineError(it) }

            SectionCard(title = "Project details") {
                OutlinedTextField(
                    value = state.name,
                    onValueChange = onNameChange,
                    label = { Text("Project name") },
                    singleLine = true,
                    isError = state.nameError != null,
                    supportingText = {
                        Text(state.nameError ?: "For example: Q3 Retail Performance")
                    },
                    enabled = !state.submitting,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = state.description,
                    onValueChange = onDescriptionChange,
                    label = { Text("Description (optional)") },
                    minLines = 3,
                    supportingText = { Text("Business context helps the agent choose the right analysis skills.") },
                    enabled = !state.submitting,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            SectionCard(
                title = "Data source",
                subtitle = "You can upload the file on the next screen.",
            ) {
                Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SourceType.entries.forEach { type ->
                        val enabled = type != SourceType.SQL || state.sqlEnabled
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .selectable(
                                    selected = state.sourceType == type,
                                    onClick = { onSourceTypeChange(type) },
                                    role = Role.RadioButton,
                                    enabled = enabled && !state.submitting,
                                )
                                .padding(vertical = 10.dp, horizontal = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(
                                selected = state.sourceType == type,
                                onClick = null,
                                enabled = enabled && !state.submitting,
                            )
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    type.label,
                                    style = MaterialTheme.typography.titleSmall,
                                    color = if (enabled) MaterialTheme.colorScheme.onSurface
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    if (enabled) type.description
                                    else "No SQL connection is enabled for this deployment.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                if (state.sourceType == SourceType.SQL && state.sqlEnabled) {
                    Text(
                        "SQL access is read-only and runs entirely on the server. " +
                            "Write statements are rejected before they reach the database.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Button(
                onClick = onCreate,
                enabled = state.canSubmit,
                modifier = Modifier
                    .fillMaxWidth()
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
                    Text("Creating…")
                } else {
                    Text("Create project")
                }
            }
        }
    }
}
