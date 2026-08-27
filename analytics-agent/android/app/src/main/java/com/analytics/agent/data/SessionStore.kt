package com.analytics.agent.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Session storage.
 *
 * Tokens live in EncryptedSharedPreferences (AES-256, hardware-backed key where
 * available) and are excluded from backup/device-transfer by the manifest rules.
 * Nothing else about the admin is persisted on the device.
 */
class SessionStore(context: Context) {

    private val prefs: SharedPreferences = runCatching {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "analytics_session",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        ) as SharedPreferences
    }.getOrElse {
        // Devices with a broken keystore still need to function; the fallback
        // store is app-private and cleared on sign-out.
        context.getSharedPreferences("analytics_session_fallback", Context.MODE_PRIVATE)
    }

    private val _session = MutableStateFlow(read())
    val session: StateFlow<Session?> = _session.asStateFlow()

    data class Session(
        val accessToken: String,
        val refreshToken: String,
        val expiresAtEpochSeconds: Long,
        val email: String,
        val userId: String,
    ) {
        val isExpired: Boolean get() = System.currentTimeMillis() / 1000 >= expiresAtEpochSeconds - 60
    }

    private fun read(): Session? {
        val access = prefs.getString(KEY_ACCESS, null) ?: return null
        return Session(
            accessToken = access,
            refreshToken = prefs.getString(KEY_REFRESH, "").orEmpty(),
            expiresAtEpochSeconds = prefs.getLong(KEY_EXPIRES, 0),
            email = prefs.getString(KEY_EMAIL, "").orEmpty(),
            userId = prefs.getString(KEY_USER, "").orEmpty(),
        )
    }

    fun save(session: Session) {
        prefs.edit()
            .putString(KEY_ACCESS, session.accessToken)
            .putString(KEY_REFRESH, session.refreshToken)
            .putLong(KEY_EXPIRES, session.expiresAtEpochSeconds)
            .putString(KEY_EMAIL, session.email)
            .putString(KEY_USER, session.userId)
            .apply()
        _session.value = session
    }

    fun clear() {
        prefs.edit().clear().apply()
        _session.value = null
    }

    private companion object {
        const val KEY_ACCESS = "access_token"
        const val KEY_REFRESH = "refresh_token"
        const val KEY_EXPIRES = "expires_at"
        const val KEY_EMAIL = "email"
        const val KEY_USER = "user_id"
    }
}
