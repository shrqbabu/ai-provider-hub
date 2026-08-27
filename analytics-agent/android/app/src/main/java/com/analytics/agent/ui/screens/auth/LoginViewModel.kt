package com.analytics.agent.ui.screens.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.analytics.agent.data.model.AdminProfile
import com.analytics.agent.data.remote.AppError
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.toAppError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val submitting: Boolean = false,
    val restoring: Boolean = true,
    val errorMessage: String? = null,
    val emailError: String? = null,
    val passwordError: String? = null,
    val configured: Boolean = true,
    val configurationMessage: String? = null,
    val profile: AdminProfile? = null,
) {
    val canSubmit: Boolean get() = !submitting && email.isNotBlank() && password.isNotBlank() && configured
}

/**
 * The one and only authentication surface in the app.
 * No registration, no social provider, no guest mode — by design.
 */
class LoginViewModel(private val repository: AnalyticsRepository) : ViewModel() {

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    init {
        val missing = buildList {
            if (!repository.isAuthConfigured) add("Supabase URL / publishable key")
            if (!repository.isApiConfigured) add("analytics service URL")
        }
        _state.update {
            it.copy(
                configured = missing.isEmpty(),
                configurationMessage = if (missing.isEmpty()) null else
                    "This build is missing its ${missing.joinToString(" and ")}. " +
                        "Rebuild with the values documented in local.defaults.properties.example.",
            )
        }
        restore()
    }

    private fun restore() {
        viewModelScope.launch {
            val profile = runCatching { repository.restoreSession() }.getOrNull()
            _state.update { it.copy(restoring = false, profile = profile) }
        }
    }

    fun onEmailChange(value: String) =
        _state.update { it.copy(email = value, emailError = null, errorMessage = null) }

    fun onPasswordChange(value: String) =
        _state.update { it.copy(password = value, passwordError = null, errorMessage = null) }

    fun signIn() {
        val current = _state.value
        val emailError = when {
            current.email.isBlank() -> "Enter your work email address."
            !current.email.contains('@') || !current.email.substringAfter('@').contains('.') ->
                "Enter a valid email address."
            else -> null
        }
        val passwordError = if (current.password.isBlank()) "Enter your password." else null
        if (emailError != null || passwordError != null) {
            _state.update { it.copy(emailError = emailError, passwordError = passwordError) }
            return
        }

        _state.update { it.copy(submitting = true, errorMessage = null) }
        viewModelScope.launch {
            try {
                val profile = repository.signIn(current.email, current.password)
                _state.update { it.copy(submitting = false, profile = profile, password = "") }
            } catch (t: Throwable) {
                val error = t.toAppError()
                val message = when (error) {
                    is AppError.NotAuthorized ->
                        "This account is not an administrator of the analytics workspace. " +
                            "Ask an operator to grant admin access, then sign in again."
                    else -> error.userMessage
                }
                _state.update { it.copy(submitting = false, errorMessage = message, password = "") }
            }
        }
    }

    fun consumeProfile() = _state.update { it.copy(profile = null) }
}
