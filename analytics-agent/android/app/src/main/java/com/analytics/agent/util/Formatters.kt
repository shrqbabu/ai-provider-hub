package com.analytics.agent.util

import java.util.Locale

/**
 * Presentation-only formatting. Every analytical number the app shows comes
 * pre-formatted from the backend metric registry — these helpers are used for
 * counts, sizes, durations and timestamps the client owns.
 */
object Formatters {

    fun compactCount(value: Long): String = when {
        value < 1_000 -> value.toString()
        value < 1_000_000 -> String.format(Locale.US, "%.1fK", value / 1_000.0).replace(".0K", "K")
        value < 1_000_000_000 -> String.format(Locale.US, "%.1fM", value / 1_000_000.0).replace(".0M", "M")
        else -> String.format(Locale.US, "%.1fB", value / 1_000_000_000.0)
    }

    fun grouped(value: Long): String = String.format(Locale.US, "%,d", value)

    fun percent(value: Double, decimals: Int = 1): String =
        String.format(Locale.US, "%.${decimals}f%%", value)

    fun duration(millis: Long): String {
        val totalSeconds = millis / 1000
        return when {
            totalSeconds < 60 -> "${totalSeconds}s"
            totalSeconds < 3600 -> "${totalSeconds / 60}m ${totalSeconds % 60}s"
            else -> "${totalSeconds / 3600}h ${(totalSeconds % 3600) / 60}m"
        }
    }

    /**
     * Turns an ISO-8601 UTC timestamp into a short relative label.
     * Returns the raw date when it is older than a week, and the input
     * unchanged when it cannot be parsed (never throws in the UI).
     */
    fun relativeTime(isoTimestamp: String?, nowMillis: Long = System.currentTimeMillis()): String {
        if (isoTimestamp.isNullOrBlank()) return "—"
        val millis = parseIsoMillis(isoTimestamp) ?: return isoTimestamp
        val delta = nowMillis - millis
        if (delta < 0) return "just now"
        val minutes = delta / 60_000
        val hours = minutes / 60
        val days = hours / 24
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "${minutes}m ago"
            hours < 24 -> "${hours}h ago"
            days < 7 -> "${days}d ago"
            else -> isoTimestamp.take(10)
        }
    }

    fun parseIsoMillis(iso: String): Long? {
        val normalized = iso.trim().let {
            when {
                it.endsWith("Z") -> it.dropLast(1)
                else -> it.substringBeforeLast('+')
            }
        }
        val datePart = normalized.substringBefore('T')
        val timePart = normalized.substringAfter('T', "00:00:00").substringBefore('.')
        val dateBits = datePart.split('-')
        val timeBits = timePart.split(':')
        if (dateBits.size != 3) return null
        val year = dateBits[0].toIntOrNull() ?: return null
        val month = dateBits[1].toIntOrNull() ?: return null
        val day = dateBits[2].toIntOrNull() ?: return null
        val hour = timeBits.getOrNull(0)?.toIntOrNull() ?: 0
        val minute = timeBits.getOrNull(1)?.toIntOrNull() ?: 0
        val second = timeBits.getOrNull(2)?.toIntOrNull() ?: 0
        val calendar = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"))
        calendar.clear()
        calendar.set(year, month - 1, day, hour, minute, second)
        return calendar.timeInMillis
    }

    fun titleCase(raw: String): String = raw
        .replace('_', ' ')
        .split(' ')
        .filter { it.isNotBlank() }
        .joinToString(" ") { word ->
            word.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
        }
}
