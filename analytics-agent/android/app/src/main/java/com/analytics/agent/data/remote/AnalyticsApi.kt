package com.analytics.agent.data.remote

import android.content.Context
import android.net.Uri
import com.analytics.agent.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.io.IOException

/**
 * Client for the analytics backend.
 *
 * The device never parses a spreadsheet, never runs a computation and never
 * downloads a full dataset: it streams the file up and reads back metadata,
 * paginated results and artifacts.
 */
class AnalyticsApi(
    private val baseUrl: String,
    private val tokenProvider: suspend () -> String?,
) {

    val isConfigured: Boolean get() = baseUrl.isNotBlank()

    // -- request helpers ----------------------------------------------------
    private fun url(path: String, query: Map<String, String> = emptyMap()): String {
        val builder = (baseUrl.trimEnd('/') + path).toHttpUrlOrNull()?.newBuilder()
            ?: throw AppError.NotConfigured("The analytics service URL is not valid. Check ANALYTICS_API_URL.")
        query.forEach { (k, v) -> builder.addQueryParameter(k, v) }
        return builder.build().toString()
    }

    private suspend fun authed(builder: Request.Builder): Request {
        val token = tokenProvider() ?: throw AppError.SessionExpired()
        return builder.addHeader("Authorization", "Bearer $token").build()
    }

    private suspend inline fun <reified T> get(path: String, query: Map<String, String> = emptyMap()): T {
        if (!isConfigured) throw AppError.NotConfigured("The analytics service is not configured in this build.")
        val request = authed(Request.Builder().url(url(path, query)).get())
        Http.execute(request).use { response ->
            val body = response.body?.string()
            if (!response.isSuccessful) throw Http.parseError(response.code, body)
            return AppJson.decodeFromString(body.orEmpty())
        }
    }

    private suspend inline fun <reified T> send(method: String, path: String, payload: String? = null): T {
        if (!isConfigured) throw AppError.NotConfigured("The analytics service is not configured in this build.")
        val body = payload?.let { Http.jsonBody(it) }
            ?: if (method == "DELETE") null else Http.jsonBody("{}")
        val request = authed(Request.Builder().url(url(path)).method(method, body))
        Http.execute(request).use { response ->
            val text = response.body?.string()
            if (!response.isSuccessful) throw Http.parseError(response.code, text)
            return AppJson.decodeFromString(text.orEmpty())
        }
    }

    // -- meta ---------------------------------------------------------------
    suspend fun publicConfig(): PublicConfig {
        val request = Request.Builder().url(url("/v1/config")).get().build()
        Http.execute(request).use { response ->
            val body = response.body?.string()
            if (!response.isSuccessful) throw Http.parseError(response.code, body)
            return AppJson.decodeFromString(body.orEmpty())
        }
    }

    suspend fun me(): AdminProfile = get("/v1/me")

    // -- projects -----------------------------------------------------------
    suspend fun listProjects(): List<Project> =
        get<ProjectListResponse>("/v1/projects").projects

    suspend fun createProject(name: String, description: String, sourceType: String): Project {
        val payload = buildJsonObject {
            put("name", name)
            put("description", description)
            put("source_type", sourceType)
        }.toString()
        return send("POST", "/v1/projects", payload)
    }

    suspend fun projectDetail(projectId: String): ProjectDetail = get("/v1/projects/$projectId")

    suspend fun renameProject(projectId: String, name: String, description: String): Project {
        val payload = buildJsonObject {
            put("name", name)
            put("description", description)
        }.toString()
        return send("PATCH", "/v1/projects/$projectId", payload)
    }

    suspend fun deleteProject(projectId: String) {
        if (!isConfigured) throw AppError.NotConfigured("The analytics service is not configured.")
        val request = authed(Request.Builder().url(url("/v1/projects/$projectId")).delete())
        Http.execute(request).use { response ->
            if (!response.isSuccessful) throw Http.parseError(response.code, response.body?.string())
        }
    }

    // -- datasets -----------------------------------------------------------
    /**
     * Streams the file straight from the content resolver to the backend.
     * The bytes are never buffered into a single in-memory array, so a 200 MB
     * CSV does not put the app anywhere near an OutOfMemoryError.
     */
    suspend fun uploadDataset(
        context: Context,
        projectId: String,
        uri: Uri,
        fileName: String,
        mimeType: String,
        sizeBytes: Long,
        onProgress: (Float) -> Unit = {},
    ): UploadResponse = withContext(Dispatchers.IO) {
        if (!isConfigured) throw AppError.NotConfigured("The analytics service is not configured.")

        val streamingBody = object : RequestBody() {
            override fun contentType() = mimeType.toMediaTypeOrNull()
            override fun contentLength(): Long = sizeBytes
            override fun writeTo(sink: BufferedSink) {
                val input = context.contentResolver.openInputStream(uri)
                    ?: throw IOException("The selected file could not be opened.")
                input.use { stream ->
                    stream.source().use { source ->
                        var written = 0L
                        val chunk = 128L * 1024L
                        while (true) {
                            val read = source.read(sink.buffer, chunk)
                            if (read == -1L) break
                            written += read
                            sink.flush()
                            if (sizeBytes > 0) onProgress((written.toFloat() / sizeBytes).coerceIn(0f, 1f))
                        }
                    }
                }
            }
        }

        val multipart = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, streamingBody)
            .addFormDataPart("declared_size", sizeBytes.toString())
            .build()

        val request = authed(Request.Builder().url(url("/v1/projects/$projectId/datasets")).post(multipart))
        try {
            Http.execute(request).use { response ->
                val body = response.body?.string()
                if (!response.isSuccessful) throw Http.parseError(response.code, body)
                onProgress(1f)
                AppJson.decodeFromString<UploadResponse>(body.orEmpty())
            }
        } catch (e: AppError) {
            throw e
        } catch (e: IOException) {
            throw AppError.UploadInterrupted(e)
        }
    }

    suspend fun dataset(datasetId: String): Dataset =
        get<Map<String, kotlinx.serialization.json.JsonElement>>("/v1/datasets/$datasetId")
            .let { AppJson.decodeFromJsonElement(Dataset.serializer(), it.getValue("dataset")) }

    suspend fun datasetQuality(datasetId: String): QualityReport =
        get<DatasetQualityResponse>("/v1/datasets/$datasetId/quality").quality

    // -- runs ---------------------------------------------------------------
    suspend fun startRun(projectId: String, prompt: String): AnalysisRun {
        val payload = buildJsonObject { put("prompt", prompt) }.toString()
        return send("POST", "/v1/projects/$projectId/runs", payload)
    }

    suspend fun run(runId: String): AnalysisRun = get("/v1/runs/$runId")

    suspend fun cancelRun(runId: String): AnalysisRun = send("POST", "/v1/runs/$runId/cancel")

    suspend fun overview(runId: String): OverviewResponse =
        get("/v1/runs/$runId/results", mapOf("section" to "overview"))

    suspend fun insights(runId: String, limit: Int = 50, offset: Int = 0): List<Insight> =
        get<InsightsResponse>(
            "/v1/runs/$runId/results",
            mapOf("section" to "insights", "limit" to "$limit", "offset" to "$offset"),
        ).insights

    suspend fun metrics(runId: String, limit: Int = 100, offset: Int = 0): List<Metric> =
        get<MetricsResponse>(
            "/v1/runs/$runId/results",
            mapOf("section" to "metrics", "limit" to "$limit", "offset" to "$offset"),
        ).metrics

    suspend fun report(runId: String): Report? =
        get<ReportResponse>("/v1/runs/$runId/results", mapOf("section" to "report")).report

    suspend fun dax(runId: String): DaxResponse =
        get("/v1/runs/$runId/results", mapOf("section" to "dax", "limit" to "500"))

    suspend fun dashboard(runId: String): Artifact? =
        get<DashboardResponse>("/v1/runs/$runId/results", mapOf("section" to "dashboard")).dashboard

    suspend fun quality(runId: String): DataQuality? =
        get<DataQualityResponse>("/v1/runs/$runId/results", mapOf("section" to "quality")).dataQuality

    // -- artifacts ----------------------------------------------------------
    suspend fun artifacts(runId: String): List<Artifact> =
        get<ArtifactsResponse>("/v1/runs/$runId/artifacts").artifacts

    /** Authenticated URL for Coil / the download manager. */
    fun artifactContentUrl(artifactId: String): String = url("/v1/artifacts/$artifactId/content")

    suspend fun artifactBytes(artifactId: String): ByteArray = withContext(Dispatchers.IO) {
        val request = authed(Request.Builder().url(url("/v1/artifacts/$artifactId/content")).get())
        Http.execute(request).use { response ->
            if (!response.isSuccessful) throw Http.parseError(response.code, response.body?.string())
            response.body?.bytes() ?: ByteArray(0)
        }
    }

    suspend fun artifactText(artifactId: String): String = withContext(Dispatchers.IO) {
        val request = authed(Request.Builder().url(url("/v1/artifacts/$artifactId/content")).get())
        Http.execute(request).use { response ->
            val text = response.body?.string()
            if (!response.isSuccessful) throw Http.parseError(response.code, text)
            text.orEmpty()
        }
    }

    // -- SQL ----------------------------------------------------------------
    suspend fun sqlConnections(): SqlConnectionsResponse = get("/v1/sql/connections")

    suspend fun createSqlDataset(projectId: String, connectionId: String, schema: String?, tables: List<String>): Dataset {
        val payload = buildJsonObject {
            put("connection_id", connectionId)
            schema?.let { put("schema_name", it) }
            put("tables", buildJsonArray { tables.forEach { add(it) } })
        }.toString()
        return send<Map<String, kotlinx.serialization.json.JsonElement>>(
            "POST", "/v1/projects/$projectId/sql-dataset", payload,
        ).let { AppJson.decodeFromJsonElement(Dataset.serializer(), it.getValue("dataset")) }
    }
}
