package com.analytics.agent.ui.screens.dax

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.analytics.agent.data.model.DaxMeasure
import com.analytics.agent.data.model.DaxResponse
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.UiState
import com.analytics.agent.ui.toAppError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Canonical group order; anything unexpected from the server is appended after these. */
val DAX_GROUP_ORDER = listOf(
    "Base Measures",
    "Sales Measures",
    "Customer Measures",
    "Product Measures",
    "Inventory Measures",
    "Time Intelligence",
    "Growth Measures",
    "Advanced Measures",
)

data class DaxUiState(
    val state: UiState<DaxResponse> = UiState.Loading,
    val query: String = "",
    val selectedGroup: String? = null,
    val expanded: Set<String> = emptySet(),
    val downloadUrl: String? = null,
    val downloadFileName: String = "measures.dax",
    val message: String? = null,
) {
    val response: DaxResponse? get() = (state as? UiState.Success)?.data

    val groupNames: List<String>
        get() {
            val present = response?.groups?.keys.orEmpty()
            return DAX_GROUP_ORDER.filter { it in present } + present.filter { it !in DAX_GROUP_ORDER }
        }

    val visibleGroups: List<Pair<String, List<DaxMeasure>>>
        get() {
            val groups = response?.groups.orEmpty()
            return groupNames
                .filter { selectedGroup == null || it == selectedGroup }
                .map { name ->
                    name to groups[name].orEmpty().filter { measure ->
                        query.isBlank() ||
                            measure.name.contains(query, true) ||
                            measure.daxCode.contains(query, true) ||
                            measure.purpose.contains(query, true)
                    }
                }
                .filter { it.second.isNotEmpty() }
        }

    val allCode: String
        get() = visibleGroups.joinToString("\n\n") { (group, measures) ->
            "// ===== $group =====\n\n" + measures.joinToString("\n\n") { it.daxCode }
        }
}

class DaxViewModel(
    private val repository: AnalyticsRepository,
    private val runId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(DaxUiState())
    val state: StateFlow<DaxUiState> = _state.asStateFlow()

    init { load() }

    fun load() {
        _state.update { it.copy(state = UiState.Loading) }
        viewModelScope.launch {
            try {
                val response = repository.dax(runId)
                _state.update {
                    it.copy(
                        state = if (response.measures.isEmpty()) {
                            UiState.Empty(
                                "No DAX measures",
                                "This run produced no measures. DAX is only generated from validated metrics.",
                            )
                        } else {
                            UiState.Success(response)
                        },
                    )
                }
            } catch (t: Throwable) {
                _state.update { it.copy(state = UiState.Failure(t.toAppError())) }
            }
            runCatching { repository.artifacts(runId) }.onSuccess { artifacts ->
                artifacts.firstOrNull { it.artifactType == "dax" }?.let { artifact ->
                    _state.update {
                        it.copy(
                            downloadUrl = repository.artifactUrl(artifact.id),
                            downloadFileName = artifact.fileName,
                        )
                    }
                }
            }
        }
    }

    fun onQueryChange(value: String) = _state.update { it.copy(query = value) }

    fun selectGroup(group: String?) = _state.update { it.copy(selectedGroup = group) }

    fun toggleExpanded(name: String) = _state.update {
        it.copy(expanded = if (name in it.expanded) it.expanded - name else it.expanded + name)
    }

    fun showMessage(message: String?) = _state.update { it.copy(message = message) }

    /** Loads the exact .dax export the backend generated, for share/save. */
    suspend fun exportText(): String? = _state.value.response?.let { _ ->
        runCatching {
            val artifact = repository.artifacts(runId).firstOrNull { it.artifactType == "dax" }
            artifact?.let { repository.artifactText(it.id) }
        }.getOrNull() ?: _state.value.allCode
    }
}
