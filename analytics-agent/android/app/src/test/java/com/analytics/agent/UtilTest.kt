package com.analytics.agent

import com.analytics.agent.util.FileUtils
import com.analytics.agent.util.Formatters
import com.analytics.agent.util.PipelineStage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FileValidationTest {

    @Test
    fun `valid csv passes`() {
        assertNull(FileUtils.validate("sales.csv", 2_000_000, 128))
    }

    @Test
    fun `valid xlsx passes`() {
        assertNull(FileUtils.validate("q3.xlsx", 500_000, 128))
    }

    @Test
    fun `empty file is rejected`() {
        val message = FileUtils.validate("empty.csv", 0, 128)
        assertNotNull(message)
        assertTrue(message!!.contains("empty"))
    }

    @Test
    fun `unsupported extension is rejected by name`() {
        val message = FileUtils.validate("report.pdf", 1_000, 128)
        assertNotNull(message)
        assertTrue(message!!.contains(".pdf"))
    }

    @Test
    fun `missing extension is rejected`() {
        assertNotNull(FileUtils.validate("dataset", 1_000, 128))
    }

    @Test
    fun `oversized file is rejected with the limit in the message`() {
        val message = FileUtils.validate("huge.csv", 200L * 1024 * 1024, 128)
        assertNotNull(message)
        assertTrue(message!!.contains("128 MB"))
    }

    @Test
    fun `mime types cover every allowed extension`() {
        assertEquals("text/csv", FileUtils.mimeForExtension("csv"))
        assertEquals(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            FileUtils.mimeForExtension("xlsx"),
        )
        assertEquals("application/vnd.ms-excel", FileUtils.mimeForExtension("xls"))
    }

    @Test
    fun `byte formatting is human readable`() {
        assertEquals("512 B", FileUtils.formatBytes(512))
        assertEquals("1.0 KB", FileUtils.formatBytes(1024))
        assertEquals("1.0 MB", FileUtils.formatBytes(1024 * 1024))
    }
}

class FormattersTest {

    @Test
    fun `compact counts shorten large numbers`() {
        assertEquals("999", Formatters.compactCount(999))
        assertEquals("1.5K", Formatters.compactCount(1_500))
        assertEquals("2.3M", Formatters.compactCount(2_300_000))
    }

    @Test
    fun `durations read naturally`() {
        assertEquals("45s", Formatters.duration(45_000))
        assertEquals("2m 5s", Formatters.duration(125_000))
        assertEquals("1h 1m", Formatters.duration(3_660_000))
    }

    @Test
    fun `relative time handles recent and old timestamps`() {
        val now = Formatters.parseIsoMillis("2026-08-27T12:00:00Z")!!
        assertEquals("just now", Formatters.relativeTime("2026-08-27T11:59:30Z", now))
        assertEquals("30m ago", Formatters.relativeTime("2026-08-27T11:30:00Z", now))
        assertEquals("3h ago", Formatters.relativeTime("2026-08-27T09:00:00Z", now))
        assertEquals("2026-08-01", Formatters.relativeTime("2026-08-01T09:00:00Z", now))
    }

    @Test
    fun `unparseable timestamps never crash`() {
        assertEquals("not-a-date", Formatters.relativeTime("not-a-date"))
        assertEquals("—", Formatters.relativeTime(null))
    }

    @Test
    fun `title case normalises skill keys`() {
        assertEquals("Time Intelligence", Formatters.titleCase("time_intelligence"))
    }
}

class PipelineStageTest {

    @Test
    fun `stage order matches the backend contract`() {
        val expected = listOf(
            "VALIDATING_INPUT", "PROFILING", "DATA_QUALITY", "SCHEMA_MODELING", "ANALYSIS_PLANNING",
            "DETERMINISTIC_CALCULATIONS", "BUSINESS_ANALYSIS", "STATISTICS", "FORECASTING",
            "INSIGHT_GENERATION", "DAX_GENERATION", "DAX_VALIDATION", "REPORT_GENERATION",
            "DASHBOARD_PNG_GENERATION", "FINAL_VALIDATION", "COMPLETED",
        )
        assertEquals(expected, PipelineStage.entries.map { it.key })
    }

    @Test
    fun `progress is monotonically increasing and ends at 100`() {
        val progress = PipelineStage.entries.map { it.progress }
        assertEquals(progress.sorted(), progress)
        assertEquals(100, progress.last())
    }

    @Test
    fun `unknown stage keys fall back gracefully`() {
        assertEquals("Working", PipelineStage.labelFor("SOMETHING_NEW"))
        assertEquals("Custom", PipelineStage.labelFor("SOMETHING_NEW", "Custom"))
        assertEquals("Validating input", PipelineStage.labelFor("validating_input"))
    }
}
