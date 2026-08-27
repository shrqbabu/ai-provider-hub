package com.analytics.agent.ui.screens.projects

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.analytics.agent.data.model.Project
import com.analytics.agent.data.remote.AppError
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.UiState
import com.analytics.agent.ui.toAppError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProjectsUiState(
    val state: UiState<List<Project>> = UiState.Loading,
    val query: String = "",
    val refreshing: Boolean = false,
    val offline: Boolean = false,
    val email: String = "",
) {
    val visibleProjects: List<Project>
        get() = (state as? UiState.Success)?.data.orEmpty().let { list ->
            if (query.isBlank()) list
            else list.filter {
                it.name.contains(query, true) || it.description.contains(query, true)
            }
        }
}

class ProjectsViewModel(private val repository: AnalyticsRepository) : ViewModel() {

    private val _state = MutableStateFlow(ProjectsUiState())
    val state: StateFlow<ProjectsUiState> = _state.asStateFlow()

    init {
        _state.update { it.copy(email = repository.session.value?.email.orEmpty()) }
        load()
    }

    fun load(showSpinner: Boolean = true) {
        if (showSpinner) _state.update { it.copy(state = UiState.Loading) }
        viewModelScope.launch {
            try {
                val projects = repository.refreshProjects()
                _state.update {
                    it.copy(
                        offline = false,
                        refreshing = false,
                        state = if (projects.isEmpty()) {
                            UiState.Empty(
                                "No projects yet",
                                "Create your first analytics project to upload a dataset and run an analysis.",
                            )
                        } else {
                            UiState.Success(projects)
                        },
                    )
                }
            } catch (t: Throwable) {
                val error = t.toAppError()
                val cached = repository.cachedProjects.value
                _state.update {
                    it.copy(
                        refreshing = false,
                        offline = error is AppError.Offline,
                        state = if (cached.isNotEmpty()) UiState.Success(cached, stale = true)
                        else UiState.Failure(error),
                    )
                }
            }
        }
    }

    fun refresh() {
        _state.update { it.copy(refreshing = true) }
        load(showSpinner = false)
    }

    fun onQueryChange(value: String) = _state.update { it.copy(query = value) }

    fun signOut(onDone: () -> Unit) {
        viewModelScope.launch {
            repository.signOut()
            onDone()
        }
    }
}
