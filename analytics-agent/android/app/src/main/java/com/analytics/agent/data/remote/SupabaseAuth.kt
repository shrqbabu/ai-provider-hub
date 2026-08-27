package com.analytics.agent.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request

/**
 * Supabase Auth — password sign-in and refresh only.
 *
 * There is intentionally NO sign-up, NO magic link, NO OAuth and NO anonymous
 * session: an account must be provisioned out-of-band and registered as an
 * admin in `public.profiles` by an operator. Whether the account is authorized
 * is decided by the backend (`GET /v1/me`), never by this client.
 */
class SupabaseAuth(
    private val supabaseUrl: String,
    private val publishableKey: String,
) {

    @Serializable
    data class TokenResponse(
        @SerialName("access_token") val accessToken: String = "",
        @SerialName("refresh_token") val refreshToken: String = "",
        @SerialName("expires_in") val expiresIn: Long = 3600,
        @SerialName("token_type") val tokenType: String = "bearer",
        val user: AuthUser? = null,
    )

    @Serializable
    data class AuthUser(val id: String = "", val email: String? = null)

    @Serializable
    private data class AuthErrorBody(
        val error: String? = null,
        @SerialName("error_description") val errorDescription: String? = null,
        val msg: String? = null,
        val message: String? = null,
    )

    val isConfigured: Boolean
        get() = supabaseUrl.isNotBlank() && publishableKey.isNotBlank()

    suspend fun signIn(email: String, password: String): TokenResponse {
        require(isConfigured) { "Supabase is not configured" }
        val payload = buildJsonObject {
            put("email", email.trim())
            put("password", password)
        }.toString()

        val request = Request.Builder()
            .url("${supabaseUrl.trimEnd('/')}/auth/v1/token?grant_type=password")
            .addHeader("apikey", publishableKey)
            .addHeader("Content-Type", "application/json")
            .post(Http.jsonBody(payload))
            .build()

        Http.execute(request).use { response ->
            val body = response.body?.string()
            if (!response.isSuccessful) {
                val parsed = body?.let {
                    runCatching { AppJson.decodeFromString<AuthErrorBody>(it) }.getOrNull()
                }
                val detail = parsed?.errorDescription ?: parsed?.msg ?: parsed?.message
                throw when (response.code) {
                    400, 401 -> AppError.InvalidCredentials()
                    422 -> AppError.Validation(detail ?: "Enter a valid email address and password.")
                    429 -> AppError.RateLimited()
                    else -> AppError.Server(detail)
                }
            }
            return AppJson.decodeFromString(TokenResponse.serializer(), body.orEmpty())
        }
    }

    suspend fun refresh(refreshToken: String): TokenResponse {
        val payload = buildJsonObject { put("refresh_token", refreshToken) }.toString()
        val request = Request.Builder()
            .url("${supabaseUrl.trimEnd('/')}/auth/v1/token?grant_type=refresh_token")
            .addHeader("apikey", publishableKey)
            .addHeader("Content-Type", "application/json")
            .post(Http.jsonBody(payload))
            .build()

        Http.execute(request).use { response ->
            val body = response.body?.string()
            if (!response.isSuccessful) throw AppError.SessionExpired()
            return AppJson.decodeFromString(TokenResponse.serializer(), body.orEmpty())
        }
    }

    suspend fun signOut(accessToken: String) {
        if (!isConfigured) return
        val request = Request.Builder()
            .url("${supabaseUrl.trimEnd('/')}/auth/v1/logout")
            .addHeader("apikey", publishableKey)
            .addHeader("Authorization", "Bearer $accessToken")
            .post(Http.jsonBody("{}"))
            .build()
        runCatching { Http.execute(request).use { } }
    }
}
