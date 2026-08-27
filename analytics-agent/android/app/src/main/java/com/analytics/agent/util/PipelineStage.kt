package com.analytics.agent.util

/**
 * The canonical pipeline, mirrored from the backend so the progress screen can
 * render every stage — including the ones not reached yet — with stable labels.
 */
enum class PipelineStage(
    val key: String,
    val label: String,
    val description: String,
    val progress: Int,
) {
    VALIDATING_INPUT("VALIDATING_INPUT", "Validating input", "Checking the dataset and your report request.", 5),
    PROFILING("PROFILING", "Profiling data", "Reading column types, ranges and cardinality.", 12),
    DATA_QUALITY("DATA_QUALITY", "Data quality", "Scoring completeness, validity, consistency and uniqueness.", 20),
    SCHEMA_MODELING("SCHEMA_MODELING", "Schema modeling", "Detecting keys, relationships and the date table.", 27),
    ANALYSIS_PLANNING("ANALYSIS_PLANNING", "Planning analysis", "Selecting the analytical skills your request needs.", 34),
    DETERMINISTIC_CALCULATIONS("DETERMINISTIC_CALCULATIONS", "Calculating metrics", "Computing every number with the deterministic engine.", 46),
    BUSINESS_ANALYSIS("BUSINESS_ANALYSIS", "Business analysis", "Applying sales, customer, product and inventory skills.", 56),
    STATISTICS("STATISTICS", "Statistical analysis", "Distributions, correlations, outliers and significance.", 63),
    FORECASTING("FORECASTING", "Forecasting", "Projecting future periods where the history supports it.", 70),
    INSIGHT_GENERATION("INSIGHT_GENERATION", "Generating insights", "Turning verified metrics into findings and recommendations.", 78),
    DAX_GENERATION("DAX_GENERATION", "Generating DAX", "Writing measures, calculated columns and date DAX.", 84),
    DAX_VALIDATION("DAX_VALIDATION", "Validating DAX", "Checking syntax and every table and column reference.", 88),
    REPORT_GENERATION("REPORT_GENERATION", "Building report", "Assembling the report sections you asked for.", 92),
    DASHBOARD_PNG_GENERATION("DASHBOARD_PNG_GENERATION", "Rendering dashboard", "Drawing the high-resolution dashboard image.", 96),
    FINAL_VALIDATION("FINAL_VALIDATION", "Final validation", "Independently re-checking data, metrics, insights, DAX and PNG.", 99),
    COMPLETED("COMPLETED", "Completed", "All stages finished and validated.", 100);

    companion object {
        fun fromKey(key: String?): PipelineStage? =
            entries.firstOrNull { it.key.equals(key?.trim(), ignoreCase = true) }

        fun labelFor(key: String?, fallback: String? = null): String =
            fromKey(key)?.label ?: fallback?.takeIf { it.isNotBlank() } ?: "Working"

        /** Stages up to and including the current one, for the timeline UI. */
        fun indexOfKey(key: String?): Int = entries.indexOfFirst { it.key.equals(key?.trim(), true) }
    }
}
