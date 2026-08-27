package com.analytics.agent.ui.screens.dashboard

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.analytics.agent.data.model.Artifact
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.UiState
import com.analytics.agent.ui.toAppError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

data class DashboardUiState(
    val state: UiState<Artifact> = UiState.Loading,
    val imageBytes: ByteArray? = null,
    val downloading: Boolean = false,
    val message: String? = null,
) {
    override fun equals(other: Any?): Boolean =
        other is DashboardUiState &&
            state == other.state &&
            downloading == other.downloading &&
            message == other.message &&
            (imageBytes?.size ?: 0) == (other.imageBytes?.size ?: 0)

    override fun hashCode(): Int =
        (state.hashCode() * 31 + (imageBytes?.size ?: 0)) * 31 + downloading.hashCode()
}

class DashboardViewModel(
    private val repository: AnalyticsRepository,
    private val runId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(DashboardUiState())
    val state: StateFlow<DashboardUiState> = _state.asStateFlow()

    init { load() }

    fun load() {
        _state.update { it.copy(state = UiState.Loading, imageBytes = null) }
        viewModelScope.launch {
            try {
                val artifact = repository.dashboard(runId)
                if (artifact == null) {
                    _state.update {
                        it.copy(
                            state = UiState.Empty(
                                "No dashboard image",
                                "A dashboard PNG is only produced once every metric on it has been validated.",
                            ),
                        )
                    }
                    return@launch
                }
                _state.update { it.copy(state = UiState.Success(artifact)) }
                val bytes = repository.artifactBytes(artifact.id)
                _state.update { it.copy(imageBytes = bytes) }
            } catch (t: Throwable) {
                _state.update { it.copy(state = UiState.Failure(t.toAppError())) }
            }
        }
    }

    /** Saves the exact PNG the backend rendered — no re-encoding, no downscaling. */
    fun saveToGallery(context: Context) {
        val artifact = (_state.value.state as? UiState.Success)?.data ?: return
        val bytes = _state.value.imageBytes ?: return
        _state.update { it.copy(downloading = true) }
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { writePng(context, artifact.fileName, bytes) }
            }
            _state.update {
                it.copy(
                    downloading = false,
                    message = result.fold(
                        onSuccess = { path -> "Dashboard saved to $path" },
                        onFailure = { "The image could not be saved to this device's storage." },
                    ),
                )
            }
        }
    }

    private fun writePng(context: Context, fileName: String, bytes: ByteArray): String {
        val safeName = fileName.ifBlank { "dashboard.png" }.let {
            if (it.endsWith(".png", true)) it else "$it.png"
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, safeName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Analytics Agent")
            }
            val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: error("insert failed")
            context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("stream failed")
            "Pictures/Analytics Agent"
        } else {
            val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "Analytics Agent")
            dir.mkdirs()
            File(dir, safeName).writeBytes(bytes)
            dir.absolutePath
        }
    }

    fun consumeMessage() = _state.update { it.copy(message = null) }
}
