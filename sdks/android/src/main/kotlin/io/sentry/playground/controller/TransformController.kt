package io.sentry.playground.controller

import io.sentry.playground.dto.TransformRequest
import io.sentry.playground.dto.TransformResponse
import io.sentry.playground.service.TransformService
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
class TransformController(private val transformService: TransformService) {

    @PostMapping("/transform")
    fun transform(@RequestBody request: TransformRequest): ResponseEntity<TransformResponse> {
        // Validate request
        if (request.beforeSendCode.trim().isEmpty()) {
            val response = TransformResponse(
                success = false,
                error = "Missing event or beforeSendCode",
                traceback = null
            )
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response)
        }

        // Transform the event
        val result = transformService.transform(
            request.event,
            request.beforeSendCode
        )

        // Build response
        val response = TransformResponse(
            success = result.success,
            transformedEvent = result.transformedEvent,
            error = result.error,
            traceback = result.traceback
        )

        // Return appropriate status code
        return when {
            result.success -> ResponseEntity.ok(response)
            result.traceback != null -> ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response)
            else -> ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response)
        }
    }

    @PostMapping("/validate-config")
    fun validateConfig(@RequestBody request: Map<String, String>): ResponseEntity<Map<String, Any?>> {
        val configCode = request["configCode"]
        if (configCode.isNullOrBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(
                mapOf("success" to false, "error" to "Missing configCode")
            )
        }

        val result = mutableMapOf<String, Any?>(
            "success" to true,
            "sdk" to "android",
            "sdkVersion" to "unknown",
            "warnings" to emptyList<String>(),
            "resolvedOptions" to emptyMap<String, Any>(),
            "recognizedKeys" to emptyList<String>(),
            "ignoredKeys" to emptyList<String>()
        )

        try {
            val shell = groovy.lang.GroovyShell()
            shell.evaluate(configCode)
            result["initSucceeded"] = true
        } catch (e: Exception) {
            result["initSucceeded"] = false
            result["error"] = e.message
        }

        return ResponseEntity.ok(result)
    }

    @GetMapping("/introspect")
    fun introspect(): ResponseEntity<Map<String, Any>> {
        val options = listOf(
            mapOf("key" to "dsn", "canonicalKey" to "dsn", "type" to "string", "required" to true, "default" to null, "description" to "Data Source Name"),
            mapOf("key" to "debug", "canonicalKey" to "debug", "type" to "boolean", "required" to false, "default" to false, "description" to "Enable debug mode"),
            mapOf("key" to "release", "canonicalKey" to "release", "type" to "string", "required" to false, "default" to null, "description" to "Release version"),
            mapOf("key" to "environment", "canonicalKey" to "environment", "type" to "string", "required" to false, "default" to null, "description" to "Environment name"),
            mapOf("key" to "sampleRate", "canonicalKey" to "sampleRate", "type" to "float", "required" to false, "default" to 1.0, "description" to "Error sample rate"),
            mapOf("key" to "tracesSampleRate", "canonicalKey" to "tracesSampleRate", "type" to "float", "required" to false, "default" to null, "description" to "Traces sample rate"),
            mapOf("key" to "beforeSend", "canonicalKey" to "beforeSend", "type" to "function", "required" to false, "default" to null, "description" to "Hook before sending event"),
            mapOf("key" to "maxBreadcrumbs", "canonicalKey" to "maxBreadcrumbs", "type" to "integer", "required" to false, "default" to 100, "description" to "Max breadcrumbs"),
            mapOf("key" to "attachStacktrace", "canonicalKey" to "attachStacktrace", "type" to "boolean", "required" to false, "default" to true, "description" to "Attach stacktrace to messages"),
            mapOf("key" to "sendDefaultPii", "canonicalKey" to "sendDefaultPii", "type" to "boolean", "required" to false, "default" to false, "description" to "Send default PII"),
            mapOf("key" to "enableAutoSessionTracking", "canonicalKey" to "enableAutoSessionTracking", "type" to "boolean", "required" to false, "default" to true, "description" to "Enable auto session tracking"),
            mapOf("key" to "sessionTrackingIntervalMillis", "canonicalKey" to "sessionTrackingIntervalMillis", "type" to "integer", "required" to false, "default" to 30000, "description" to "Session tracking interval"),
            mapOf("key" to "anrEnabled", "canonicalKey" to "anrEnabled", "type" to "boolean", "required" to false, "default" to true, "description" to "Enable ANR detection"),
            mapOf("key" to "anrTimeoutIntervalMillis", "canonicalKey" to "anrTimeoutIntervalMillis", "type" to "integer", "required" to false, "default" to 5000, "description" to "ANR timeout interval")
        )

        return ResponseEntity.ok(mapOf(
            "sdk" to "android",
            "sdkVersion" to "unknown",
            "sdkPackage" to "io.sentry:sentry-android",
            "source" to "manifest",
            "options" to options,
            "timestamp" to java.time.Instant.now().toString()
        ))
    }

    @GetMapping("/health")
    fun health(): ResponseEntity<Map<String, String>> {
        return ResponseEntity.ok(
            mapOf(
                "status" to "healthy",
                "sdk" to "android"
            )
        )
    }
}
