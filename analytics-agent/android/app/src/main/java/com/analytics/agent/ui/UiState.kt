package com.analytics.agent.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.analytics.agent.data.remote.AppError
import com.analytics.agent.data.repository.AnalyticsRepository

/** Generic screen state: every screen renders exactly one of these four. */
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Success<T>(val data: T, val stale: Boolean = false) : UiState<T>
    data class Empty(val title: String, val message: String) : UiState<Nothing>
    data class Failure(val error: AppError) : UiState<Nothing>
}

fun Throwable.toAppError(): AppError = when (this) {
    is AppError -> this
    is kotlinx.serialization.SerializationException -> AppError.Server(
        "The analytics service returned a response this app version cannot read. Update the app.",
    )
    else -> AppError.Unknown(message ?: "Unexpected failure.", this)
}

/** Minimal factory so ViewModels can take the repository without a DI framework. */
@Suppress("UNCHECKED_CAST")
class VmFactory(
    private val repository: AnalyticsRepository,
    private val creator: (AnalyticsRepository) -> ViewModel,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T = creator(repository) as T
}
