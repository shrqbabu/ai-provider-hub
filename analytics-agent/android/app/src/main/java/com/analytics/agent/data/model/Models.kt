package com.analytics.agent.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Wire models for the analytics backend.
 *
 * Deliberately tolerant: unknown JSON keys are ignored (see [com.analytics.agent.data.remote.AppJson])
 * so a backend deploy never crashes an installed client.
 */

@Serializable
data class AdminProfile(
    val id: String,
    val email: String = "",
    val role: String = "admin",
)

@Serializable
data class PublicConfig(
    @SerialName("supabase_url") val supabaseUrl: String = "",
    @SerialName("supabase_publishable_key") val supabasePublishableKey: String = "",
    @SerialName("max_upload_mb") val maxUploadMb: Int = 128,
    @SerialName("sql_connectors_enabled") val sqlConnectorsEnabled: Boolean = false,
    @SerialName("supported_sources") val supportedSources: List<String> = listOf("csv", "excel"),
    @SerialName("llm_provider") val llmProvider: String = "deterministic",
)

@Serializable
data class Project(
    val id: String,
    val name: String,
    val description: String = "",
    @SerialName("owner_id") val ownerId: String = "",
    @SerialName("source_type") val sourceType: String = "csv",
    val status: String = "draft",
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("last_run_at") val lastRunAt: String? = null,
    @SerialName("dataset_count") val datasetCount: Int = 0,
    @SerialName("run_count") val runCount: Int = 0,
    @SerialName("latest_run") val latestRun: AnalysisRun? = null,
)

@Serializable
data class ProjectListResponse(val projects: List<Project> = emptyList())

@Serializable
data class ProjectDetail(
    val project: Project,
    val datasets: List<Dataset> = emptyList(),
    val runs: List<AnalysisRun> = emptyList(),
    @SerialName("prompt_history") val promptHistory: List<PromptHistoryEntry> = emptyList(),
)

@Serializable
data class PromptHistoryEntry(
    @SerialName("run_id") val runId: String,
    val prompt: String = "",
    @SerialName("created_at") val createdAt: String? = null,
    val status: String? = null,
)

@Serializable
data class Dataset(
    val id: String,
    @SerialName("project_id") val projectId: String = "",
    val name: String = "",
    @SerialName("source_type") val sourceType: String = "csv",
    @SerialName("file_size") val fileSize: Long = 0,
    @SerialName("row_count") val rowCount: Long = 0,
    @SerialName("column_count") val columnCount: Int = 0,
    @SerialName("mime_type") val mimeType: String? = null,
    val schema: DatasetProfile? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class DatasetProfile(
    val encoding: String = "",
    val delimiter: String = "",
    @SerialName("table_count") val tableCount: Int = 0,
    @SerialName("total_rows") val totalRows: Long = 0,
    @SerialName("total_columns") val totalColumns: Int = 0,
    val warnings: List<String> = emptyList(),
    val tables: List<TableProfile> = emptyList(),
)

@Serializable
data class TableProfile(
    @SerialName("table_name") val tableName: String,
    @SerialName("source_sheet") val sourceSheet: String? = null,
    @SerialName("row_count") val rowCount: Long = 0,
    @SerialName("column_count") val columnCount: Int = 0,
    @SerialName("duplicate_row_count") val duplicateRowCount: Long = 0,
    @SerialName("malformed_rows") val malformedRows: Int = 0,
    val columns: List<ColumnProfile> = emptyList(),
    @SerialName("date_columns") val dateColumns: List<String> = emptyList(),
    @SerialName("numeric_columns") val numericColumns: List<String> = emptyList(),
    @SerialName("category_columns") val categoryColumns: List<String> = emptyList(),
    @SerialName("date_range") val dateRange: DateRange? = null,
    val notes: List<String> = emptyList(),
)

@Serializable
data class ColumnProfile(
    val name: String,
    val dtype: String = "",
    @SerialName("semantic_type") val semanticType: String = "",
    @SerialName("null_count") val nullCount: Long = 0,
    @SerialName("null_pct") val nullPct: Double = 0.0,
    @SerialName("distinct_count") val distinctCount: Long = 0,
)

@Serializable
data class DateRange(
    val column: String = "",
    val min: String = "",
    val max: String = "",
)

@Serializable
data class UploadResponse(
    val dataset: Dataset,
    val profile: DatasetProfile,
)

@Serializable
data class AnalysisRun(
    val id: String,
    @SerialName("project_id") val projectId: String = "",
    val status: String = "queued",
    val stage: String = "",
    @SerialName("stage_key") val stageKey: String? = null,
    @SerialName("stage_label") val stageLabel: String? = null,
    val progress: Int = 0,
    @SerialName("user_prompt") val userPrompt: String = "",
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("metric_count") val metricCount: Int = 0,
    @SerialName("insight_count") val insightCount: Int = 0,
    @SerialName("duration_ms") val durationMs: Long? = null,
    @SerialName("validation_status") val validationStatus: String? = null,
    @SerialName("validation_summary") val validationSummary: String? = null,
    @SerialName("dax_summary") val daxSummary: DaxSummary? = null,
    val error: RunError? = null,
) {
    val isActive: Boolean get() = status == "queued" || status == "running"
    val isDelivered: Boolean get() = status == "completed"
}

@Serializable
data class RunError(
    val stage: String = "",
    val message: String = "",
    val recoverable: Boolean = true,
)

@Serializable
data class DaxSummary(
    val total: Int = 0,
    val valid: Int = 0,
    val warning: Int = 0,
    val failed: Int = 0,
    val passed: Boolean = false,
)

@Serializable
data class UnsupportedRequest(
    val requested: String,
    val reason: String = "",
    val alternative: String = "",
    val status: String = "not_supported",
)

@Serializable
data class ValidationReport(
    val status: String = "unknown",
    val passed: Boolean = false,
    val summary: String = "",
    @SerialName("checks_passed") val checksPassed: Int = 0,
    @SerialName("checks_total") val checksTotal: Int = 0,
    @SerialName("critical_count") val criticalCount: Int = 0,
    @SerialName("high_count") val highCount: Int = 0,
    val issues: List<ValidationIssue> = emptyList(),
)

@Serializable
data class ValidationIssue(
    val severity: String = "medium",
    val area: String = "",
    val message: String = "",
)

@Serializable
data class AnalysisPlan(
    val sections: List<String> = emptyList(),
    @SerialName("selected_skill_keys") val selectedSkillKeys: List<String> = emptyList(),
    @SerialName("unsupported_requests") val unsupportedRequests: List<UnsupportedRequest> = emptyList(),
    val planner: String = "deterministic",
)

@Serializable
data class OverviewResponse(
    val run: AnalysisRun,
    val validation: ValidationReport? = null,
    val plan: AnalysisPlan? = null,
    val unsupported: List<UnsupportedRequest> = emptyList(),
    @SerialName("headline_metrics") val headlineMetrics: List<Metric> = emptyList(),
    val artifacts: List<Artifact> = emptyList(),
)

@Serializable
data class Metric(
    val id: String = "",
    @SerialName("metric_id") val metricId: String,
    val name: String,
    val definition: String = "",
    val formula: String = "",
    val value: MetricValue? = null,
    val source: JsonObject? = null,
    @SerialName("validation_status") val validationStatus: String = "unverified",
)

@Serializable
data class MetricValue(
    val value: JsonElement? = null,
    val unit: String = "number",
    @SerialName("value_type") val valueType: String = "scalar",
    val display: String = "",
    val period: String? = null,
)

@Serializable
data class MetricsResponse(val metrics: List<Metric> = emptyList())

@Serializable
data class Insight(
    val id: String = "",
    val title: String,
    val finding: String = "",
    val interpretation: String = "",
    @SerialName("business_impact") val businessImpact: String = "",
    val recommendation: String = "",
    val confidence: String = "medium",
    val priority: String = "medium",
    @SerialName("validation_status") val validationStatus: String = "unverified",
    val evidence: Evidence? = null,
)

@Serializable
data class Evidence(
    @SerialName("metric_ids") val metricIds: List<String> = emptyList(),
    val values: List<EvidenceValue> = emptyList(),
)

@Serializable
data class EvidenceValue(
    @SerialName("metric_id") val metricId: String = "",
    val name: String = "",
    val display: String = "",
)

@Serializable
data class InsightsResponse(val insights: List<Insight> = emptyList())

@Serializable
data class ReportSection(val title: String, val body: String = "")

@Serializable
data class Report(
    val sections: List<ReportSection> = emptyList(),
    val markdown: String = "",
    val generator: String = "deterministic",
    val prompt: String = "",
)

@Serializable
data class ReportResponse(val report: Report? = null)

@Serializable
data class DaxMeasure(
    val id: String = "",
    val name: String,
    @SerialName("dax_code") val daxCode: String,
    val purpose: String = "",
    @SerialName("group_name") val groupName: String = "Advanced Measures",
    val kind: String = "measure",
    @SerialName("validation_status") val validationStatus: String = "unverified",
    @SerialName("validation_errors") val validationErrors: List<String> = emptyList(),
)

@Serializable
data class DaxResponse(
    val measures: List<DaxMeasure> = emptyList(),
    val groups: Map<String, List<DaxMeasure>> = emptyMap(),
    val summary: DaxSummary? = null,
)

@Serializable
data class Artifact(
    val id: String,
    @SerialName("project_id") val projectId: String = "",
    @SerialName("analysis_run_id") val analysisRunId: String? = null,
    @SerialName("artifact_type") val artifactType: String,
    @SerialName("file_name") val fileName: String,
    @SerialName("mime_type") val mimeType: String = "application/octet-stream",
    @SerialName("file_size") val fileSize: Long = 0,
    @SerialName("storage_path") val storagePath: String = "",
)

@Serializable
data class ArtifactsResponse(val artifacts: List<Artifact> = emptyList())

@Serializable
data class DashboardResponse(val dashboard: Artifact? = null)

@Serializable
data class DataQuality(
    val id: String = "",
    val score: Double? = null,
    val completeness: JsonObject? = null,
    val validity: JsonObject? = null,
    val consistency: JsonObject? = null,
    val uniqueness: JsonObject? = null,
    val relationships: JsonObject? = null,
    val issues: List<QualityIssue> = emptyList(),
)

@Serializable
data class QualityIssue(
    val severity: String = "medium",
    val dimension: String = "",
    val message: String = "",
    val table: String = "",
    val column: String = "",
)

@Serializable
data class DataQualityResponse(
    @SerialName("data_quality") val dataQuality: DataQuality? = null,
)

@Serializable
data class DatasetQualityResponse(
    val quality: QualityReport,
)

@Serializable
data class QualityReport(
    val score: Double = 0.0,
    val grade: String = "",
    val issues: List<QualityIssue> = emptyList(),
    val completeness: DimensionScore? = null,
    val validity: DimensionScore? = null,
    val consistency: DimensionScore? = null,
    val uniqueness: DimensionScore? = null,
    val relationships: DimensionScore? = null,
    @SerialName("high_issue_count") val highIssueCount: Int = 0,
    @SerialName("critical_issue_count") val criticalIssueCount: Int = 0,
)

@Serializable
data class DimensionScore(val score: Double = 0.0)

@Serializable
data class SqlConnectionsResponse(
    val enabled: Boolean = false,
    val connections: List<SqlConnection> = emptyList(),
)

@Serializable
data class SqlConnection(
    val id: String,
    val label: String = "",
    val driver: String = "",
    @SerialName("default_schema") val defaultSchema: String = "public",
    val configured: Boolean = false,
    val access: String = "read_only",
)

@Serializable
data class ApiErrorBody(
    val code: String = "UNKNOWN",
    val message: String = "",
    val hint: String = "",
    @SerialName("request_id") val requestId: String? = null,
)

@Serializable
data class ApiErrorEnvelope(val detail: ApiErrorBody? = null)
