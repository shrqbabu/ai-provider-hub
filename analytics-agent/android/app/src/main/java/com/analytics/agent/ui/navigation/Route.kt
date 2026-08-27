package com.analytics.agent.ui.navigation

sealed class Route(val path: String) {
    data object Login : Route("login")
    data object Projects : Route("projects")
    data object NewProject : Route("projects/new")

    data object Dataset : Route("projects/{projectId}/dataset") {
        fun of(projectId: String) = "projects/$projectId/dataset"
    }

    data object DataQuality : Route("projects/{projectId}/datasets/{datasetId}/quality") {
        fun of(projectId: String, datasetId: String) = "projects/$projectId/datasets/$datasetId/quality"
    }

    data object ReportPrompt : Route("projects/{projectId}/prompt") {
        fun of(projectId: String) = "projects/$projectId/prompt"
    }

    data object Progress : Route("projects/{projectId}/runs/{runId}/progress") {
        fun of(projectId: String, runId: String) = "projects/$projectId/runs/$runId/progress"
    }

    data object Results : Route("projects/{projectId}/runs/{runId}/results") {
        fun of(projectId: String, runId: String) = "projects/$projectId/runs/$runId/results"
    }

    data object Dax : Route("runs/{runId}/dax") {
        fun of(runId: String) = "runs/$runId/dax"
    }

    data object Dashboard : Route("runs/{runId}/dashboard") {
        fun of(runId: String) = "runs/$runId/dashboard"
    }

    data object ProjectSettings : Route("projects/{projectId}/settings") {
        fun of(projectId: String) = "projects/$projectId/settings"
    }

    companion object {
        const val ARG_PROJECT_ID = "projectId"
        const val ARG_DATASET_ID = "datasetId"
        const val ARG_RUN_ID = "runId"
    }
}
