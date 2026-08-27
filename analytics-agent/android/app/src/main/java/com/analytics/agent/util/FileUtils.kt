package com.analytics.agent.util

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.util.Locale

object FileUtils {

    val ALLOWED_EXTENSIONS = setOf("csv", "tsv", "txt", "xlsx", "xls")

    val PICKER_MIME_TYPES = arrayOf(
        "text/csv",
        "text/comma-separated-values",
        "text/tab-separated-values",
        "text/plain",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/octet-stream",
    )

    data class PickedFile(
        val uri: Uri,
        val name: String,
        val sizeBytes: Long,
        val mimeType: String,
    ) {
        val extension: String get() = name.substringAfterLast('.', "").lowercase(Locale.US)
    }

    fun describe(context: Context, uri: Uri): PickedFile? {
        val resolver = context.contentResolver
        var name = "dataset"
        var size = -1L
        resolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (cursor.moveToFirst()) {
                if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
            }
        }
        if (size < 0) {
            size = runCatching {
                resolver.openAssetFileDescriptor(uri, "r")?.use { it.length }
            }.getOrNull()?.takeIf { it >= 0 } ?: -1L
        }
        if (size < 0) return null
        val mime = resolver.getType(uri) ?: mimeForExtension(name.substringAfterLast('.', ""))
        return PickedFile(uri, name, size, mime)
    }

    fun mimeForExtension(extension: String): String = when (extension.lowercase(Locale.US)) {
        "csv" -> "text/csv"
        "tsv" -> "text/tab-separated-values"
        "txt" -> "text/plain"
        "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        "xls" -> "application/vnd.ms-excel"
        else -> "application/octet-stream"
    }

    /**
     * Client-side pre-check. The backend re-validates everything; this only
     * saves the admin from a doomed upload over a mobile connection.
     *
     * Takes plain values (not a [PickedFile]) so it is unit-testable on the JVM.
     */
    fun validate(fileName: String, sizeBytes: Long, maxUploadMb: Int): String? {
        val extension = fileName.substringAfterLast('.', "").lowercase(Locale.US)
        return when {
            extension.isBlank() ->
                "The file has no extension. Choose a .csv, .tsv, .xlsx or .xls file."
            extension !in ALLOWED_EXTENSIONS ->
                "\".$extension\" files are not supported. Choose a .csv, .tsv, .xlsx or .xls file."
            sizeBytes == 0L ->
                "\"$fileName\" is empty (0 bytes). Choose a file that contains data rows."
            sizeBytes > maxUploadMb.toLong() * 1024 * 1024 ->
                "\"$fileName\" is ${formatBytes(sizeBytes)}, over the $maxUploadMb MB limit. " +
                    "Split the file or upload a filtered extract."
            else -> null
        }
    }

    fun validate(file: PickedFile, maxUploadMb: Int): String? =
        validate(file.name, file.sizeBytes, maxUploadMb)

    fun formatBytes(bytes: Long): String = when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> String.format(Locale.US, "%.1f KB", bytes / 1024.0)
        bytes < 1024L * 1024 * 1024 -> String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024))
        else -> String.format(Locale.US, "%.2f GB", bytes / (1024.0 * 1024 * 1024))
    }
}
