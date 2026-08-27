package com.analytics.agent.ui.screens.results

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.analytics.agent.data.model.*
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.UiState
import com.analytics.agent.ui.toAppError
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ResultTab(val title: String) {
    OVERVIEW("Overview"),
    INSIGHTS("Insights"),
    METRICS("Metrics"),
    REPORT("Report"),
    DAX("DAX"),
    DASHBOARD("Dashboard"),
    QUALITY("Data quality"),
}

data class ResultsUiState(
    val tab: ResultTab = ResultTab.OVERVIEW,
    val overview: UiState<OverviewResponse> = UiState.Loading,
    val insights: UiState<List<Insight>> = UiState.Loading,
    val metrics: UiState<List<Metric>> = UiState.Loading,
    val report: UiState<Report> = UiState.Loading,
    val dax: UiState<DaxResponse> = UiState.Loading,
    val dashboard: UiState<Artifact> = UiState.Loading,
    val quality: UiState<DataQuality> = UiState.Loading,
    val artifacts: List<Artifact> = emptyList(),
    val metricQuery: String = "",
    val message: String? = null,
) {
    val filteredMetrics: List<Metric>
        get() = (metrics as? UiState.Success)?.data.orEmpty().let { list ->
            if (metricQuery.isBlank()) list
            else list.filter {
                it.name.contains(metricQuery, true) || it.metricId.contains(metricQuery, true)
            }
        }
}

class ResultsViewModel(
    private val repository: AnalyticsRepository,
    private val runId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(ResultsUiState())
    val state: StateFlow<ResultsUiState> = _state.asStateFlow()

    init { loadAll() }

    fun selectTab(tab: ResultTab) = _state.update { it.copy(tab = tab) }

    fun onMetricQueryChange(value: String) = _state.update { it.copy(metricQuery = value) }

    fun loadAll() {
        _state.update {
            it.copy(
                overview = UiState.Loading,
                insights = UiState.Loading,
                metrics = UiState.Loading,
                report = UiState.Loading,
                dax = UiState.Loading,
                dashboard = UiState.Loading,
                quality = UiState.Loading,
            )
        }
        viewModelScope.launch {
            // Sections load in parallel; a failure in one never blanks the others.
            val overviewJob = async { runCatching { repository.overview(runId) } }
            val insightsJob = async { runCatching { repository.insights(runId) } }
            val metricsJob = async { runCatching { repository.metrics(runId) } }
            val reportJob = async { runCatching { repository.report(runId) } }
            val daxJob = async { runCatching { repository.dax(runId) } }
            val dashboardJob = async { runCatching { repository.dashboard(runId) } }
            val qualityJob = async { runCatching { repository.quality(runId) } }
            val artifactsJob = async { runCatching { repository.artifacts(runId) } }

            overviewJob.await().fold(
                onSuccess = { value -> _state.update { it.copy(overview = UiState.Success(value)) } },
                onFailure = { t -> _state.update { it.copy(overview = UiState.Failure(t.toAppError())) } },
            )
            insightsJob.await().fold(
                onSuccess = { value ->
                    _state.update {
                        it.copy(
                            insights = if (value.isEmpty()) UiState.Empty(
                                "No insights were produced",
                                "The engine did not find findings it could support with verified metrics.",
                            ) else UiState.Success(value),
                        )
                    }
                },
                onFailure = { t -> _state.update { it.copy(insights = UiState.Failure(t.toAppError())) } },
            )
            metricsJob.await().fold(
                onSuccess = { value ->
                    _state.update {
                        it.copy(
                            metrics = if (value.isEmpty()) UiState.Empty(
                                "No metrics",
                                "This run produced no metric registry entries.",
                            ) else UiState.Success(value),
                        )
                    }
                },
                onFailure = { t -> _state.update { it.copy(metrics = UiState.Failure(t.toAppError())) } },
            )
            reportJob.await().fold(
                onSuccess = { value ->
                    _state.update {
                        it.copy(
                            report = value?.let { r -> UiState.Success(r) }
                                ?: UiState.Empty("No report", "This run did not produce a written report."),
                        )
                    }
                },
                onFailure = { t -> _state.update { it.copy(report = UiState.Failure(t.toAppError())) } },
            )
            daxJob.await().fold(
                onSuccess = { value ->
                    _state.update {
                        it.copy(
                            dax = if (value.measures.isEmpty()) UiState.Empty(
                                "No DAX generated",
                                "No measures could be derived from the validated metric registry.",
                            ) else UiState.Success(value),
                        )
                    }
                },
                onFailure = { t -> _state.update { it.copy(dax = UiState.Failure(t.toAppError())) } },
            )
            dashboardJob.await().fold(
                onSuccess = { value ->
                    _state.update {
                        it.copy(
                            dashboard = value?.let { a -> UiState.Success(a) }
                                ?: UiState.Empty(
                                    "No dashboard image",
                                    "The dashboard PNG is only produced from fully validated data.",
                                ),
                        )
                    }
                },
                onFailure = { t -> _state.update { it.copy(dashboard = UiState.Failure(t.toAppError())) } },
            )
            qualityJob.await().fold(
                onSuccess = { value ->
                    _state.update {
                        it.copy(
                            quality = value?.let { q -> UiState.Success(q) }
                                ?: UiState.Empty("No quality report", "This run has no stored data-quality record."),
                        )
                    }
                },
                onFailure = { t -> _state.update { it.copy(quality = UiState.Failure(t.toAppError())) } },
            )
            artifactsJob.await().onSuccess { value -> _state.update { it.copy(artifacts = value) } }
        }
    }

    fun artifactUrl(artifactId: String) = repository.artifactUrl(artifactId)

    fun showMessage(message: String?) = _state.update { it.copy(message = message) }
}
