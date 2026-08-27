package com.analytics.agent.ui.screens.prompt

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.analytics.agent.data.model.PromptHistoryEntry
import com.analytics.agent.data.remote.AppError
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.toAppError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PromptUiState(
    val prompt: String = "",
    val projectName: String = "",
    val history: List<PromptHistoryEntry> = emptyList(),
    val loading: Boolean = true,
    val submitting: Boolean = false,
    val errorMessage: String? = null,
    val startedRunId: String? = null,
    val hasDataset: Boolean = true,
    val activeRunId: String? = null,
) {
    val characterCount: Int get() = prompt.trim().length
    val canSubmit: Boolean get() = !submitting && characterCount >= MIN_PROMPT && hasDataset

    companion object {
        const val MIN_PROMPT = 20
        const val MAX_PROMPT = 4000
    }
}

/** Suggested report definitions. They are prompts, not templates — the engine still verifies feasibility. */
val PROMPT_SUGGESTIONS = listOf(
    "Executive summary" to
        "Give me an executive summary of overall performance: total revenue, order volume, average order value, " +
        "month-over-month growth, and the top and bottom performing segments. Highlight what changed most.",
    "Sales deep dive" to
        "Analyse sales performance over time. Include revenue trend, growth rates, seasonality, best and worst " +
        "months, and a breakdown by region and product category with a ranked contribution table.",
    "Customer analysis" to
        "Profile the customer base: unique customers, repeat versus one-time purchase behaviour, revenue " +
        "concentration among top customers, and average spend per customer with a segmentation section.",
    "Product & inventory" to
        "Rank products by revenue and units, identify slow movers, and summarise inventory coverage where the " +
        "data supports it. Include a Pareto view of which products drive most revenue.",
    "Forecast & statistics" to
        "Produce a statistical review with distributions, outliers and correlations between numeric drivers, " +
        "then forecast the next six periods of revenue with the confidence assumptions stated.",
)

class PromptViewModel(
    private val repository: AnalyticsRepository,
    private val projectId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(PromptUiState())
    val state: StateFlow<PromptUiState> = _state.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            try {
                val detail = repository.projectDetail(projectId)
                _state.update {
                    it.copy(
                        loading = false,
                        projectName = detail.project.name,
                        history = detail.promptHistory,
                        hasDataset = detail.datasets.isNotEmpty(),
                        activeRunId = detail.runs.firstOrNull { run -> run.isActive }?.id,
                    )
                }
            } catch (t: Throwable) {
                _state.update { it.copy(loading = false, errorMessage = t.toAppError().userMessage) }
            }
        }
    }

    fun onPromptChange(value: String) {
        if (value.length > PromptUiState.MAX_PROMPT) return
        _state.update { it.copy(prompt = value, errorMessage = null) }
    }

    fun applySuggestion(text: String) = _state.update { it.copy(prompt = text, errorMessage = null) }

    fun start() {
        val current = _state.value
        if (!current.hasDataset) {
            _state.update {
                it.copy(errorMessage = "Upload a dataset before running an analysis.")
            }
            return
        }
        if (current.characterCount < PromptUiState.MIN_PROMPT) {
            _state.update {
                it.copy(
                    errorMessage = "Describe the report in at least ${PromptUiState.MIN_PROMPT} characters " +
                        "so the agent can select the right analysis.",
                )
            }
            return
        }
        _state.update { it.copy(submitting = true, errorMessage = null) }
        viewModelScope.launch {
            try {
                val run = repository.startRun(projectId, current.prompt.trim())
                _state.update { it.copy(submitting = false, startedRunId = run.id) }
            } catch (t: Throwable) {
                val error = t.toAppError()
                val message = if (error is AppError.Conflict && error.code == "RUN_IN_PROGRESS") {
                    "An analysis is already running for this project. Open it, or cancel it before starting another."
                } else {
                    error.userMessage
                }
                _state.update { it.copy(submitting = false, errorMessage = message) }
            }
        }
    }

    fun consumeStarted() = _state.update { it.copy(startedRunId = null) }
}
