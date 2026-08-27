package com.analytics.agent

import com.analytics.agent.data.model.OverviewResponse
import com.analytics.agent.data.remote.AnalyticsApi
import com.analytics.agent.data.remote.AppError
import com.analytics.agent.data.remote.AppJson
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class AnalyticsApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: AnalyticsApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = AnalyticsApi(server.url("/").toString().trimEnd('/')) { "test-token" }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `project list is parsed and authenticated`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {"projects":[
                  {"id":"p1","name":"Q3 Retail","description":"desc","source_type":"csv",
                   "status":"ready","dataset_count":2,"run_count":3,
                   "updated_at":"2026-08-20T10:00:00Z"}
                ]}
                """.trimIndent(),
            ),
        )

        val projects = api.listProjects()
        assertEquals(1, projects.size)
        assertEquals("Q3 Retail", projects[0].name)
        assertEquals(2, projects[0].datasetCount)

        val request = server.takeRequest()
        assertEquals("Bearer test-token", request.getHeader("Authorization"))
        assertEquals("/v1/projects", request.path)
    }

    @Test
    fun `unknown response fields are ignored so old clients keep working`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {"projects":[{"id":"p1","name":"N","brand_new_field":{"nested":true}}],
                 "pagination":{"next":null}}
                """.trimIndent(),
            ),
        )
        assertEquals("p1", api.listProjects().first().id)
    }

    @Test
    fun `run results overview decodes validation and unsupported requests`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {"run":{"id":"r1","status":"completed","stage":"COMPLETED","stage_key":"COMPLETED",
                        "progress":100,"metric_count":12,"insight_count":5},
                 "validation":{"status":"passed","passed":true,"checks_passed":12,"checks_total":12,
                               "critical_count":0,"high_count":0,"issues":[],"summary":"All checks passed"},
                 "unsupported":[{"requested":"Churn rate","reason":"No contract dates",
                                 "alternative":"Repeat purchase rate","status":"not_supported"}],
                 "headline_metrics":[{"metric_id":"total_revenue","name":"Total Revenue",
                     "value":{"value":4660134.83,"unit":"currency","display":"4.66M"}}]}
                """.trimIndent(),
            ),
        )

        val overview = api.overview("r1")
        assertEquals(100, overview.run.progress)
        assertTrue(overview.validation!!.passed)
        assertEquals("Churn rate", overview.unsupported.first().requested)
        assertEquals("4.66M", overview.headlineMetrics.first().value?.display)
    }

    @Test
    fun `error envelopes surface the backend code`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(409).setBody(
                """{"detail":{"code":"RUN_IN_PROGRESS","message":"A run is already active."}}""",
            ),
        )
        try {
            api.startRun("p1", "Analyse revenue trend by month across regions")
            fail("expected a conflict")
        } catch (e: AppError) {
            assertTrue(e is AppError.Conflict)
            assertEquals("RUN_IN_PROGRESS", e.code)
            assertEquals("A run is already active.", e.userMessage)
        }
    }

    @Test
    fun `flat error bodies are also understood`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(413)
                .setBody("""{"code":"FILE_TOO_LARGE","message":"File exceeds 128 MB."}"""),
        )
        try {
            api.dataset("d1")
            fail("expected a validation error")
        } catch (e: AppError) {
            assertEquals("FILE_TOO_LARGE", e.code)
        }
    }

    @Test
    fun `non json error bodies still produce a typed error`() = runTest {
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>bad gateway</html>"))
        try {
            api.me()
            fail("expected a server error")
        } catch (e: AppError) {
            assertTrue(e is AppError.Server)
        }
    }

    @Test
    fun `missing token short circuits before any network call`() = runTest {
        val unauthenticated = AnalyticsApi(server.url("/").toString()) { null }
        try {
            unauthenticated.listProjects()
            fail("expected a session error")
        } catch (e: AppError) {
            assertTrue(e is AppError.SessionExpired)
        }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `public config endpoint is not authenticated`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"max_upload_mb":256,"sql_connectors_enabled":false,"llm_provider":"deterministic"}""",
            ),
        )
        val config = api.publicConfig()
        assertEquals(256, config.maxUploadMb)
        assertNull(server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `results requests pass the section as a query parameter`() = runTest {
        server.enqueue(MockResponse().setBody("""{"measures":[],"groups":{},"summary":null}"""))
        api.dax("r1")
        val request = server.takeRequest()
        assertTrue(request.path!!.contains("section=dax"))
        assertTrue(request.path!!.startsWith("/v1/runs/r1/results"))
    }

    @Test
    fun `unconfigured base url fails fast with a configuration error`() = runTest {
        val unconfigured = AnalyticsApi("") { "token" }
        try {
            unconfigured.me()
            fail("expected a configuration error")
        } catch (e: AppError) {
            assertTrue(e is AppError.NotConfigured)
        }
    }

    @Test
    fun `overview model round trips through json`() {
        val json = """{"run":{"id":"r1","status":"validation_failed","progress":99}}"""
        val overview = AppJson.decodeFromString<OverviewResponse>(json)
        assertEquals("validation_failed", overview.run.status)
        assertNotNull(overview.run)
        assertTrue(!overview.run.isActive)
        assertTrue(!overview.run.isDelivered)
    }
}
