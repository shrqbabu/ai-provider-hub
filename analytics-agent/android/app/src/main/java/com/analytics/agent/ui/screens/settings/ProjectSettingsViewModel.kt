package com.analytics.agent.ui.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.analytics.agent.data.model.AnalysisRun
import com.analytics.agent.data.model.Dataset
import com.analytics.agent.data.model.Project
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.toAppError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProjectSettingsUiState(
    val loading: Boolean = true,
    val project: Project? = null,
    val datasets: List<Dataset> = emptyList(),
    val runs: List<AnalysisRun> = emptyList(),
    val name: String = "",
    val description: String = "",
    val saving: Boolean = false,
    val deleting: Boolean = false,
    val deleteConfirmText: String = "",
    val showDeleteDialog: Boolean = false,
    val errorMessage: String? = null,
    val message: String? = null,
    val deleted: Boolean = false,
) {
    val dirty: Boolean
        get() = project != null &&
            (name.trim() != project.name || description.trim() != project.description)

    val deleteEnabled: Boolean
        get() = project != null && deleteConfirmText.trim() == project.name && !deleting
}

class ProjectSettingsViewModel(
    private val repository: AnalyticsRepository,
    private val projectId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(ProjectSettingsUiState())
    val state: StateFlow<ProjectSettingsUiState> = _state.asStateFlow()

    init { load() }

    fun load() {
        _state.update { it.copy(loading = true, errorMessage = null) }
        viewModelScope.launch {
            try {
                val detail = repository.projectDetail(projectId)
                _state.update {
                    it.copy(
                        loading = false,
                        project = detail.project,
                        datasets = detail.datasets,
                        runs = detail.runs,
                        name = detail.project.name,
                        description = detail.project.description,
                    )
                }
            } catch (t: Throwable) {
                _state.update { it.copy(loading = false, errorMessage = t.toAppError().userMessage) }
            }
        }
    }

    fun onNameChange(value: String) = _state.update { it.copy(name = value, errorMessage = null) }
    fun onDescriptionChange(value: String) = _state.update { it.copy(description = value) }
    fun onDeleteConfirmChange(value: String) = _state.update { it.copy(deleteConfirmText = value) }
    fun showDeleteDialog(show: Boolean) =
        _state.update { it.copy(showDeleteDialog = show, deleteConfirmText = "") }

    fun consumeMessage() = _state.update { it.copy(message = null) }

    fun save() {
        val current = _state.value
        if (current.name.trim().length < 3) {
            _state.update { it.copy(errorMessage = "Project names need at least 3 characters.") }
            return
        }
        _state.update { it.copy(saving = true, errorMessage = null) }
        viewModelScope.launch {
            try {
                val project = repository.renameProject(
                    projectId,
                    current.name.trim(),
                    current.description.trim(),
                )
                _state.update {
                    it.copy(saving = false, project = project, message = "Project details saved.")
                }
            } catch (t: Throwable) {
                _state.update { it.copy(saving = false, errorMessage = t.toAppError().userMessage) }
            }
        }
    }

    fun delete() {
        if (!_state.value.deleteEnabled) return
        _state.update { it.copy(deleting = true, errorMessage = null) }
        viewModelScope.launch {
            try {
                repository.deleteProject(projectId)
                _state.update { it.copy(deleting = false, showDeleteDialog = false, deleted = true) }
            } catch (t: Throwable) {
                _state.update {
                    it.copy(
                        deleting = false,
                        showDeleteDialog = false,
                        errorMessage = t.toAppError().userMessage,
                    )
                }
            }
        }
    }
}
