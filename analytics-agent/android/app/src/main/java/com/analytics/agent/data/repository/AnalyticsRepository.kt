package com.analytics.agent.data.repository

import android.content.Context
import android.net.Uri
import com.analytics.agent.data.SessionStore
import com.analytics.agent.data.model.*
import com.analytics.agent.data.remote.AnalyticsApi
import com.analytics.agent.data.remote.AppError
import com.analytics.agent.data.remote.SupabaseAuth
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Single repository the ViewModels talk to.
 *
 * Responsibilities:
 *  - hold the session and refresh it transparently;
 *  - cache project metadata so a dropped connection never blanks the UI;
 *  - expose analysis progress as a cold Flow the UI can collect.
 */
class AnalyticsRepository(
    private val auth: SupabaseAuth,
    private val api: AnalyticsApi,
    private val sessionStore: SessionStore,
) {

    private val refreshMutex = Mutex()

    private val _projects = MutableStateFlow<List<Project>>(emptyList())
    /** Last known project list. Survives network loss so the home screen is never empty. */
    val cachedProjects: StateFlow<List<Project>> = _projects.asStateFlow()

    private val _profile = MutableStateFlow<AdminProfile?>(null)
    val profile: StateFlow<AdminProfile?> = _profile.asStateFlow()

    val session: StateFlow<SessionStore.Session?> = sessionStore.session

    // -- auth ---------------------------------------------------------------
    val isAuthConfigured: Boolean get() = auth.isConfigured
    val isApiConfigured: Boolean get() = api.isConfigured

    suspend fun accessToken(): String? = refreshMutex.withLock {
        val current = sessionStore.session.value ?: return null
        if (!current.isExpired) return current.accessToken
        if (current.refreshToken.isBlank()) {
            sessionStore.clear()
            throw AppError.SessionExpired()
        }
        val refreshed = auth.refresh(current.refreshToken)
        val session = SessionStore.Session(
            accessToken = refreshed.accessToken,
            refreshToken = refreshed.refreshToken.ifBlank { current.refreshToken },
            expiresAtEpochSeconds = System.currentTimeMillis() / 1000 + refreshed.expiresIn,
            email = refreshed.user?.email ?: current.email,
            userId = refreshed.user?.id ?: current.userId,
        )
        sessionStore.save(session)
        session.accessToken
    }

    /**
     * Sign in, then confirm authorization **server-side**. A valid Supabase
     * account that is not registered as an admin is signed straight back out.
     */
    suspend fun signIn(email: String, password: String): AdminProfile {
        if (!auth.isConfigured) {
            throw AppError.NotConfigured(
                "This build has no Supabase configuration. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
            )
        }
        val token = auth.signIn(email, password)
        sessionStore.save(
            SessionStore.Session(
                accessToken = token.accessToken,
                refreshToken = token.refreshToken,
                expiresAtEpochSeconds = System.currentTimeMillis() / 1000 + token.expiresIn,
                email = token.user?.email ?: email,
                userId = token.user?.id.orEmpty(),
            ),
        )
        return try {
            api.me().also { _profile.value = it }
        } catch (e: AppError) {
            sessionStore.clear()
            _profile.value = null
            throw e
        }
    }

    suspend fun restoreSession(): AdminProfile? {
        sessionStore.session.value ?: return null
        return try {
            api.me().also { _profile.value = it }
        } catch (e: AppError.SessionExpired) {
            sessionStore.clear()
            null
        } catch (e: AppError.NotAuthorized) {
            sessionStore.clear()
            null
        } catch (e: AppError) {
            // Offline: keep the session, let the UI work from cache.
            null
        }
    }

    suspend fun signOut() {
        sessionStore.session.value?.let { auth.signOut(it.accessToken) }
        sessionStore.clear()
        _profile.value = null
        _projects.value = emptyList()
    }

    suspend fun publicConfig(): PublicConfig? = runCatching { api.publicConfig() }.getOrNull()

    // -- projects -----------------------------------------------------------
    suspend fun refreshProjects(): List<Project> = api.listProjects().also { _projects.value = it }

    suspend fun createProject(name: String, description: String, sourceType: String): Project =
        api.createProject(name, description, sourceType).also { refreshQuietly() }

    suspend fun projectDetail(projectId: String): ProjectDetail = api.projectDetail(projectId)

    suspend fun renameProject(projectId: String, name: String, description: String): Project =
        api.renameProject(projectId, name, description).also { refreshQuietly() }

    suspend fun deleteProject(projectId: String) {
        api.deleteProject(projectId)
        _projects.value = _projects.value.filterNot { it.id == projectId }
    }

    private suspend fun refreshQuietly() {
        runCatching { refreshProjects() }
    }

    // -- datasets -----------------------------------------------------------
    suspend fun uploadDataset(
        context: Context,
        projectId: String,
        uri: Uri,
        fileName: String,
        mimeType: String,
        sizeBytes: Long,
        onProgress: (Float) -> Unit,
    ): UploadResponse = api.uploadDataset(context, projectId, uri, fileName, mimeType, sizeBytes, onProgress)

    suspend fun datasetQuality(datasetId: String): QualityReport = api.datasetQuality(datasetId)

    // -- runs ---------------------------------------------------------------
    suspend fun startRun(projectId: String, prompt: String): AnalysisRun = api.startRun(projectId, prompt)

    suspend fun cancelRun(runId: String): AnalysisRun = api.cancelRun(runId)

    /**
     * Emits run state until it reaches a terminal status. Network hiccups are
     * tolerated: the last known state stays on screen and polling continues.
     */
    fun observeRun(runId: String, intervalMs: Long = 1_500): Flow<AnalysisRun> = flow {
        var consecutiveFailures = 0
        while (true) {
            try {
                val run = api.run(runId)
                consecutiveFailures = 0
                emit(run)
                if (!run.isActive) return@flow
            } catch (e: AppError.SessionExpired) {
                throw e
            } catch (e: AppError) {
                consecutiveFailures++
                if (consecutiveFailures >= 20) throw e
            }
            delay(intervalMs)
        }
    }

    suspend fun overview(runId: String): OverviewResponse = api.overview(runId)
    suspend fun insights(runId: String) = api.insights(runId)
    suspend fun metrics(runId: String, limit: Int = 100, offset: Int = 0) = api.metrics(runId, limit, offset)
    suspend fun report(runId: String) = api.report(runId)
    suspend fun dax(runId: String) = api.dax(runId)
    suspend fun dashboard(runId: String) = api.dashboard(runId)
    suspend fun quality(runId: String) = api.quality(runId)
    suspend fun artifacts(runId: String) = api.artifacts(runId)
    suspend fun artifactBytes(artifactId: String) = api.artifactBytes(artifactId)
    suspend fun artifactText(artifactId: String) = api.artifactText(artifactId)
    fun artifactUrl(artifactId: String) = api.artifactContentUrl(artifactId)

    // -- SQL ----------------------------------------------------------------
    suspend fun sqlConnections(): SqlConnectionsResponse = api.sqlConnections()

    suspend fun createSqlDataset(projectId: String, connectionId: String, schema: String?, tables: List<String>) =
        api.createSqlDataset(projectId, connectionId, schema, tables)
}
