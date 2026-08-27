package com.analytics.agent

import com.analytics.agent.data.model.DaxMeasure
import com.analytics.agent.data.model.DaxResponse
import com.analytics.agent.data.model.DaxSummary
import com.analytics.agent.data.remote.AppError
import com.analytics.agent.data.remote.SupabaseAuth
import com.analytics.agent.ui.UiState
import com.analytics.agent.ui.screens.dax.DAX_GROUP_ORDER
import com.analytics.agent.ui.screens.dax.DaxUiState
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class SupabaseAuthTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() = server.shutdown()

    private fun auth() = SupabaseAuth(server.url("/").toString().trimEnd('/'), "pk_publishable")

    @Test
    fun `password grant returns tokens and sends only the publishable key`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {"access_token":"at","refresh_token":"rt","expires_in":3600,
                 "user":{"id":"u1","email":"admin@corp.com"}}
                """.trimIndent(),
            ),
        )
        val token = auth().signIn("admin@corp.com", "secret")
        assertEquals("at", token.accessToken)
        assertEquals("u1", token.user?.id)

        val request = server.takeRequest()
        assertEquals("pk_publishable", request.getHeader("apikey"))
        assertTrue(request.path!!.contains("grant_type=password"))
        val body = request.body.readUtf8()
        assertTrue(body.contains("admin@corp.com"))
        // The client must never send a service-role key or any privileged header.
        assertFalse(body.contains("service_role"))
    }

    @Test
    fun `bad credentials map to a precise message`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(400)
                .setBody("""{"error":"invalid_grant","error_description":"Invalid login credentials"}"""),
        )
        try {
            auth().signIn("admin@corp.com", "wrong")
            fail("expected invalid credentials")
        } catch (e: AppError) {
            assertTrue(e is AppError.InvalidCredentials)
            assertEquals("Incorrect email or password.", e.userMessage)
        }
    }

    @Test
    fun `refresh failure forces re-authentication`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"invalid_grant"}"""))
        try {
            auth().refresh("stale")
            fail("expected session expired")
        } catch (e: AppError) {
            assertTrue(e is AppError.SessionExpired)
        }
    }

    @Test
    fun `unconfigured supabase is reported as such`() {
        assertFalse(SupabaseAuth("", "").isConfigured)
        assertTrue(SupabaseAuth("https://x.supabase.co", "pk").isConfigured)
    }
}

class DaxUiStateTest {

    private fun measure(name: String, group: String, code: String = "$name = SUM(Sales[Revenue])") =
        DaxMeasure(
            name = name,
            daxCode = code,
            purpose = "Purpose of $name",
            groupName = group,
            validationStatus = "valid",
        )

    private fun state(query: String = "", group: String? = null): DaxUiState {
        val groups = mapOf(
            "Growth Measures" to listOf(measure("Revenue MoM %", "Growth Measures")),
            "Base Measures" to listOf(
                measure("Total Revenue", "Base Measures"),
                measure("Total Orders", "Base Measures"),
            ),
            "Custom Group" to listOf(measure("Odd One", "Custom Group")),
            "Time Intelligence" to listOf(measure("Revenue YTD", "Time Intelligence")),
        )
        return DaxUiState(
            state = UiState.Success(
                DaxResponse(
                    measures = groups.values.flatten(),
                    groups = groups,
                    summary = DaxSummary(total = 5, valid = 5, passed = true),
                ),
            ),
            query = query,
            selectedGroup = group,
        )
    }

    @Test
    fun `groups follow the canonical order with unknown groups appended`() {
        val names = state().groupNames
        assertEquals(listOf("Base Measures", "Time Intelligence", "Growth Measures", "Custom Group"), names)
        assertTrue(DAX_GROUP_ORDER.contains("Base Measures"))
    }

    @Test
    fun `search filters by name and by code`() {
        val byName = state(query = "orders").visibleGroups.flatMap { it.second }
        assertEquals(listOf("Total Orders"), byName.map { it.name })

        val byCode = state(query = "Sales[Revenue]").visibleGroups.flatMap { it.second }
        assertEquals(5, byCode.size)
    }

    @Test
    fun `group filter narrows the list`() {
        val filtered = state(group = "Base Measures").visibleGroups
        assertEquals(1, filtered.size)
        assertEquals(2, filtered.first().second.size)
    }

    @Test
    fun `copy all emits grouped headers and every measure`() {
        val text = state().allCode
        assertTrue(text.contains("// ===== Base Measures ====="))
        assertTrue(text.contains("Total Revenue = SUM(Sales[Revenue])"))
        assertTrue(text.contains("Revenue YTD"))
    }

    @Test
    fun `no pbix or power bi publishing surface exists in the dax export`() {
        val text = state().allCode.lowercase()
        assertFalse(text.contains(".pbix"))
        assertFalse(text.contains(".pbit"))
        assertFalse(text.contains("publish to power bi"))
    }
}
