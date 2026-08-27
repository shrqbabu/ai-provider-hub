package com.analytics.agent.data.remote

import com.analytics.agent.data.model.ApiErrorBody

/**
 * Every failure the app can surface, each with a message that tells the admin
 * what happened and what is still safe. "Something went wrong" is never used.
 */
sealed class AppError(
    val userMessage: String,
    val code: String,
    val recoverable: Boolean = true,
    cause: Throwable? = null,
) : Exception(userMessage, cause) {

    class Offline(cause: Throwable? = null) : AppError(
        "No network connection. Your projects and uploads are safe on the server — reconnect and retry.",
        "OFFLINE", true, cause,
    )

    class Timeout(cause: Throwable? = null) : AppError(
        "The analytics service did not respond in time. Nothing was lost; retry when you have a stable connection.",
        "TIMEOUT", true, cause,
    )

    class UploadInterrupted(cause: Throwable? = null) : AppError(
        "The upload was interrupted before it completed. No partial file was saved — retry the upload.",
        "UPLOAD_INTERRUPTED", true, cause,
    )

    class SessionExpired : AppError(
        "Your session expired. Sign in again — your projects and analysis runs are saved.",
        "SESSION_EXPIRED", true,
    )

    class NotAuthorized(message: String? = null) : AppError(
        message ?: "This account is not authorized for the analytics workspace.",
        "NOT_AUTHORIZED", false,
    )

    class InvalidCredentials : AppError(
        "Incorrect email or password.",
        "INVALID_CREDENTIALS", true,
    )

    class NotFound(message: String? = null) : AppError(
        message ?: "That item no longer exists. It may have been deleted.",
        "NOT_FOUND", false,
    )

    class Validation(message: String, code: String = "VALIDATION", val hint: String = "") :
        AppError(message, code, true)

    class Conflict(message: String, code: String = "CONFLICT") : AppError(message, code, true)

    class RateLimited : AppError(
        "Too many requests. Wait a few seconds and try again.",
        "RATE_LIMITED", true,
    )

    class Server(message: String? = null, val requestId: String? = null) : AppError(
        message ?: "The analytics service hit an internal error. Your data is saved — retry the action.",
        "SERVER_ERROR", true,
    )

    class NotConfigured(message: String) : AppError(message, "NOT_CONFIGURED", false)

    class Unknown(message: String, cause: Throwable? = null) : AppError(message, "UNKNOWN", true, cause)

    companion object {
        fun fromApi(status: Int, body: ApiErrorBody?): AppError {
            val message = body?.message?.takeIf { it.isNotBlank() }
            val code = body?.code ?: ""
            return when {
                status == 401 && code == "SESSION_EXPIRED" -> SessionExpired()
                status == 401 -> SessionExpired()
                status == 403 -> NotAuthorized(message)
                status == 404 -> NotFound(message)
                status == 409 -> Conflict(message ?: "This action conflicts with the current state.", code)
                status == 413 -> Validation(message ?: "The file is too large.", code.ifBlank { "FILE_TOO_LARGE" })
                status == 422 -> Validation(message ?: "The request was rejected as invalid.", code.ifBlank { "VALIDATION" })
                status == 429 -> RateLimited()
                status in 400..499 -> Validation(
                    message ?: "The request was rejected.",
                    code.ifBlank { "BAD_REQUEST" },
                    body?.hint.orEmpty(),
                )
                else -> Server(message, body?.requestId)
            }
        }
    }
}
