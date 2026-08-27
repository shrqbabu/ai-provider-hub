package com.analytics.agent

import com.analytics.agent.data.model.ApiErrorBody
import com.analytics.agent.data.remote.AppError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppErrorTest {

    @Test
    fun `401 maps to session expired`() {
        val error = AppError.fromApi(401, ApiErrorBody(code = "SESSION_EXPIRED", message = "expired"))
        assertTrue(error is AppError.SessionExpired)
        assertTrue(error.recoverable)
    }

    @Test
    fun `403 maps to not authorized and is not recoverable`() {
        val error = AppError.fromApi(403, ApiErrorBody(code = "FORBIDDEN", message = "Admins only."))
        assertTrue(error is AppError.NotAuthorized)
        assertEquals("Admins only.", error.userMessage)
        assertFalse(error.recoverable)
    }

    @Test
    fun `409 run in progress keeps the backend code`() {
        val error = AppError.fromApi(409, ApiErrorBody(code = "RUN_IN_PROGRESS", message = "busy"))
        assertTrue(error is AppError.Conflict)
        assertEquals("RUN_IN_PROGRESS", error.code)
    }

    @Test
    fun `413 maps to a file size validation error`() {
        val error = AppError.fromApi(413, ApiErrorBody(code = "FILE_TOO_LARGE", message = "too big"))
        assertTrue(error is AppError.Validation)
        assertEquals("FILE_TOO_LARGE", error.code)
    }

    @Test
    fun `429 maps to rate limited`() {
        assertTrue(AppError.fromApi(429, ApiErrorBody(code = "RATE_LIMITED")) is AppError.RateLimited)
    }

    @Test
    fun `5xx maps to a server error that keeps the request id`() {
        val error = AppError.fromApi(500, ApiErrorBody(code = "INTERNAL", message = "boom", requestId = "req-9"))
        assertTrue(error is AppError.Server)
        assertEquals("req-9", (error as AppError.Server).requestId)
    }

    @Test
    fun `every error carries an actionable message`() {
        val errors = listOf(
            AppError.Offline(), AppError.Timeout(), AppError.UploadInterrupted(),
            AppError.SessionExpired(), AppError.InvalidCredentials(), AppError.RateLimited(),
            AppError.NotFound(), AppError.Server(),
        )
        errors.forEach { error ->
            assertTrue(
                "message too short for ${error.code}",
                error.userMessage.length > 20,
            )
            assertFalse(error.userMessage.contains("something went wrong", ignoreCase = true))
        }
    }
}
