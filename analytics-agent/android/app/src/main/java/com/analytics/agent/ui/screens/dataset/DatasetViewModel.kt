package com.analytics.agent.ui.screens.dataset

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.analytics.agent.data.model.Dataset
import com.analytics.agent.data.model.Project
import com.analytics.agent.data.remote.AppError
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.toAppError
import com.analytics.agent.util.FileUtils
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DatasetUiState(
    val loading: Boolean = true,
    val project: Project? = null,
    val datasets: List<Dataset> = emptyList(),
    val activeDataset: Dataset? = null,
    val error: AppError? = null,
    val uploading: Boolean = false,
    val uploadProgress: Float = 0f,
    val uploadFileName: String = "",
    val uploadError: String? = null,
    val maxUploadMb: Int = 128,
    val hasActiveRun: Boolean = false,
) {
    val canContinue: Boolean get() = activeDataset != null && !uploading
}

class DatasetViewModel(
    private val repository: AnalyticsRepository,
    private val projectId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(DatasetUiState())
    val state: StateFlow<DatasetUiState> = _state.asStateFlow()

    private var uploadJob: Job? = null

    init {
        viewModelScope.launch {
            repository.publicConfig()?.let { config ->
                _state.update { it.copy(maxUploadMb = config.maxUploadMb) }
            }
        }
        load()
    }

    fun load() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val detail = repository.projectDetail(projectId)
                _state.update {
                    it.copy(
                        loading = false,
                        project = detail.project,
                        datasets = detail.datasets,
                        activeDataset = detail.datasets.lastOrNull(),
                        hasActiveRun = detail.runs.any { run -> run.isActive },
                    )
                }
            } catch (t: Throwable) {
                _state.update { it.copy(loading = false, error = t.toAppError()) }
            }
        }
    }

    fun selectDataset(dataset: Dataset) = _state.update { it.copy(activeDataset = dataset) }

    fun upload(context: Context, uri: Uri) {
        val picked = FileUtils.describe(context, uri)
        if (picked == null) {
            _state.update {
                it.copy(
                    uploadError = "That file could not be read from the app you picked it in. " +
                        "Download it to this device first, then select it again.",
                )
            }
            return
        }
        FileUtils.validate(picked, _state.value.maxUploadMb)?.let { message ->
            _state.update { it.copy(uploadError = message) }
            return
        }

        _state.update {
            it.copy(
                uploading = true,
                uploadProgress = 0f,
                uploadFileName = picked.name,
                uploadError = null,
            )
        }

        uploadJob = viewModelScope.launch {
            try {
                val response = repository.uploadDataset(
                    context = context,
                    projectId = projectId,
                    uri = picked.uri,
                    fileName = picked.name,
                    mimeType = picked.mimeType,
                    sizeBytes = picked.sizeBytes,
                    onProgress = { fraction ->
                        _state.update { it.copy(uploadProgress = fraction) }
                    },
                )
                _state.update {
                    it.copy(
                        uploading = false,
                        uploadProgress = 1f,
                        datasets = it.datasets + response.dataset,
                        activeDataset = response.dataset,
                    )
                }
            } catch (t: Throwable) {
                val error = t.toAppError()
                _state.update { it.copy(uploading = false, uploadError = error.userMessage) }
            }
        }
    }

    fun cancelUpload() {
        uploadJob?.cancel()
        uploadJob = null
        _state.update {
            it.copy(
                uploading = false,
                uploadProgress = 0f,
                uploadError = "Upload cancelled. Nothing was saved to the project.",
            )
        }
    }

    fun dismissUploadError() = _state.update { it.copy(uploadError = null) }
}
