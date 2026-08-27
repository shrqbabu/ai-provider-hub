package com.analytics.agent.ui.screens.newproject

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.analytics.agent.data.model.SqlConnection
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.toAppError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class SourceType(val wire: String, val label: String, val description: String) {
    CSV("csv", "CSV / TSV", "Delimited text export from any system."),
    EXCEL("excel", "Excel workbook", "One or more sheets from .xlsx or .xls."),
    SQL("sql", "SQL database", "Read-only query against a pre-approved connection."),
}

data class NewProjectUiState(
    val name: String = "",
    val description: String = "",
    val sourceType: SourceType = SourceType.CSV,
    val nameError: String? = null,
    val submitting: Boolean = false,
    val errorMessage: String? = null,
    val sqlEnabled: Boolean = false,
    val sqlConnections: List<SqlConnection> = emptyList(),
    val createdProjectId: String? = null,
) {
    val canSubmit: Boolean get() = !submitting && name.trim().length >= 3
}

class NewProjectViewModel(private val repository: AnalyticsRepository) : ViewModel() {

    private val _state = MutableStateFlow(NewProjectUiState())
    val state: StateFlow<NewProjectUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            runCatching { repository.sqlConnections() }.onSuccess { response ->
                _state.update {
                    it.copy(sqlEnabled = response.enabled, sqlConnections = response.connections)
                }
            }
        }
    }

    fun onNameChange(value: String) =
        _state.update { it.copy(name = value, nameError = null, errorMessage = null) }

    fun onDescriptionChange(value: String) = _state.update { it.copy(description = value) }

    fun onSourceTypeChange(value: SourceType) = _state.update { it.copy(sourceType = value) }

    fun create() {
        val current = _state.value
        val trimmed = current.name.trim()
        if (trimmed.length < 3) {
            _state.update { it.copy(nameError = "Give the project a name of at least 3 characters.") }
            return
        }
        if (trimmed.length > 120) {
            _state.update { it.copy(nameError = "Project names are limited to 120 characters.") }
            return
        }
        _state.update { it.copy(submitting = true, errorMessage = null) }
        viewModelScope.launch {
            try {
                val project = repository.createProject(
                    trimmed,
                    current.description.trim(),
                    current.sourceType.wire,
                )
                _state.update { it.copy(submitting = false, createdProjectId = project.id) }
            } catch (t: Throwable) {
                _state.update { it.copy(submitting = false, errorMessage = t.toAppError().userMessage) }
            }
        }
    }

    fun consumeCreated() = _state.update { it.copy(createdProjectId = null) }
}
