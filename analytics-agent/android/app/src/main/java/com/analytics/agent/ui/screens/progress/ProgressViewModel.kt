package com.analytics.agent.ui.screens.progress

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.analytics.agent.data.model.AnalysisRun
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.toAppError
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProgressUiState(
    val run: AnalysisRun? = null,
    val loading: Boolean = true,
    val errorMessage: String? = null,
    val cancelling: Boolean = false,
    val elapsedLabel: String = "",
    val finished: Boolean = false,
)

class ProgressViewModel(
    private val repository: AnalyticsRepository,
    private val runId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(ProgressUiState())
    val state: StateFlow<ProgressUiState> = _state.asStateFlow()

    private var watchJob: Job? = null

    init { watch() }

    fun watch() {
        watchJob?.cancel()
        _state.update { it.copy(loading = true, errorMessage = null) }
        watchJob = viewModelScope.launch {
            repository.observeRun(runId)
                .catch { t ->
                    _state.update {
                        it.copy(loading = false, errorMessage = t.toAppError().userMessage)
                    }
                }
                .collect { run ->
                    _state.update {
                        it.copy(
                            loading = false,
                            run = run,
                            errorMessage = null,
                            finished = !run.isActive,
                        )
                    }
                }
        }
    }

    fun cancel() {
        _state.update { it.copy(cancelling = true) }
        viewModelScope.launch {
            try {
                val run = repository.cancelRun(runId)
                _state.update { it.copy(cancelling = false, run = run, finished = !run.isActive) }
            } catch (t: Throwable) {
                _state.update { it.copy(cancelling = false, errorMessage = t.toAppError().userMessage) }
            }
        }
    }

    override fun onCleared() {
        watchJob?.cancel()
        super.onCleared()
    }
}
