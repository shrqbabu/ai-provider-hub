package com.analytics.agent.ui.screens.quality

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.analytics.agent.data.model.QualityReport
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.UiState
import com.analytics.agent.ui.toAppError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class DataQualityViewModel(
    private val repository: AnalyticsRepository,
    private val datasetId: String,
) : ViewModel() {

    private val _state = MutableStateFlow<UiState<QualityReport>>(UiState.Loading)
    val state: StateFlow<UiState<QualityReport>> = _state.asStateFlow()

    init { load() }

    fun load() {
        _state.value = UiState.Loading
        viewModelScope.launch {
            _state.value = try {
                UiState.Success(repository.datasetQuality(datasetId))
            } catch (t: Throwable) {
                UiState.Failure(t.toAppError())
            }
        }
    }
}
