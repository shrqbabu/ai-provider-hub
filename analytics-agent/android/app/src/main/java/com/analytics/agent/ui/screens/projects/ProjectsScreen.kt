package com.analytics.agent.ui.screens.projects

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.analytics.agent.data.model.Project
import com.analytics.agent.ui.UiState
import com.analytics.agent.ui.components.*
import com.analytics.agent.util.Formatters

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectsScreen(
    state: ProjectsUiState,
    isExpanded: Boolean,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onOpenProject: (Project) -> Unit,
    onNewProject: () -> Unit,
    onSignOut: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Projects")
                        if (state.email.isNotBlank()) {
                            Text(
                                state.email,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "Refresh projects")
                    }
                    IconButton(onClick = onSignOut) {
                        Icon(Icons.Outlined.Logout, contentDescription = "Sign out")
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onNewProject,
                icon = { Icon(Icons.Outlined.Add, contentDescription = null) },
                text = { Text("New project") },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (state.offline) OfflineBanner()

            OutlinedTextField(
                value = state.query,
                onValueChange = onQueryChange,
                placeholder = { Text("Search projects") },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            )

            when (val s = state.state) {
                is UiState.Loading -> LoadingState("Loading your projects…")
                is UiState.Failure -> ErrorState(s.error, onRetry = onRefresh)
                is UiState.Empty -> EmptyState(
                    title = s.title,
                    message = s.message,
                    icon = Icons.Outlined.FolderOpen,
                    actionLabel = "Create project",
                    onAction = onNewProject,
                )
                is UiState.Success -> {
                    val projects = state.visibleProjects
                    if (projects.isEmpty()) {
                        EmptyState(
                            "No matching projects",
                            "No project name or description matches \"${state.query}\".",
                            icon = Icons.Outlined.Search,
                        )
                    } else {
                        LazyVerticalGrid(
                            columns = if (isExpanded) GridCells.Adaptive(340.dp) else GridCells.Fixed(1),
                            contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 96.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            items(projects, key = { it.id }) { project ->
                                ProjectCard(project) { onOpenProject(project) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProjectCard(project: Project, onClick: () -> Unit) {
    val runStatus = project.latestRun?.status ?: project.status
    SectionCard(
        modifier = Modifier
            .clickable(onClick = onClick)
            .semantics { contentDescription = "Project ${project.name}, status $runStatus" },
        title = project.name,
        subtitle = project.description.takeIf { it.isNotBlank() },
        trailing = { RunStatusChip(runStatus) },
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Stat("Datasets", project.datasetCount.toString())
            Stat("Runs", project.runCount.toString())
            Stat("Source", project.sourceType.uppercase())
        }
        Text(
            "Updated ${Formatters.relativeTime(project.updatedAt ?: project.createdAt)}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column {
        Text(value, style = MaterialTheme.typography.titleMedium)
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
