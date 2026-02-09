package io.sentry.playground.controller;

import io.sentry.playground.dto.TransformRequest;
import io.sentry.playground.dto.TransformResponse;
import io.sentry.playground.service.TransformService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.lang.reflect.Method;
import java.lang.reflect.Field;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;

@RestController
public class TransformController {

    @Autowired
    private TransformService transformService;

    @PostMapping("/transform")
    public ResponseEntity<TransformResponse> transform(@RequestBody TransformRequest request) {
        // Validate request
        if (request.getEvent() == null || request.getBeforeSendCode() == null ||
            request.getBeforeSendCode().trim().isEmpty()) {
            TransformResponse response = new TransformResponse(
                false,
                null,
                "Missing event or beforeSendCode",
                null
            );
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
        }

        // Transform the event
        TransformService.TransformResult result = transformService.transform(
            request.getEvent(),
            request.getBeforeSendCode()
        );

        // Build response
        TransformResponse response = new TransformResponse(
            result.isSuccess(),
            result.getTransformedEvent(),
            result.getError(),
            result.getTraceback()
        );

        // Return appropriate status code
        if (result.isSuccess()) {
            return ResponseEntity.ok(response);
        } else if (result.getTraceback() != null) {
            // Runtime error
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        } else {
            // Compilation error or validation error
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
        }
    }

    @PostMapping("/validate-config")
    public ResponseEntity<Map<String, Object>> validateConfig(@RequestBody Map<String, String> request) {
        String configCode = request.get("configCode");
        if (configCode == null || configCode.trim().isEmpty()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                "success", false,
                "error", "Missing configCode"
            ));
        }

        String sdkVersion = "unknown";
        try {
            Class<?> sentryClass = Class.forName("io.sentry.Sentry");
            // Try to get the SDK version
            try {
                Class<?> buildConfig = Class.forName("io.sentry.BuildConfig");
                Field versionField = buildConfig.getField("VERSION_NAME");
                sdkVersion = (String) versionField.get(null);
            } catch (Exception e) {
                sdkVersion = sentryClass.getPackage().getImplementationVersion() != null
                    ? sentryClass.getPackage().getImplementationVersion() : "unknown";
            }
        } catch (Exception e) {
            // ignore
        }

        List<String> warnings = new ArrayList<>();
        Map<String, Object> result = new HashMap<>();
        result.put("success", true);
        result.put("sdk", "java");
        result.put("sdkVersion", sdkVersion);
        result.put("resolvedOptions", new HashMap<>());
        result.put("recognizedKeys", new ArrayList<>());
        result.put("ignoredKeys", new ArrayList<>());

        // Capture System.err to detect warnings during init
        PrintStream originalErr = System.err;
        ByteArrayOutputStream capturedErr = new ByteArrayOutputStream();
        System.setErr(new PrintStream(capturedErr));

        try {
            // Use Groovy to execute the config code
            groovy.lang.GroovyShell shell = new groovy.lang.GroovyShell();
            shell.evaluate(configCode);
            result.put("initSucceeded", true);
        } catch (Exception e) {
            result.put("initSucceeded", false);
            result.put("error", e.getMessage());
        } finally {
            System.setErr(originalErr);
            String errOutput = capturedErr.toString().trim();
            if (!errOutput.isEmpty()) {
                for (String line : errOutput.split("\n")) {
                    if (!line.trim().isEmpty()) {
                        warnings.add(line.trim());
                    }
                }
            }
            // Close Sentry to release background threads and shutdown hooks
            try {
                io.sentry.Sentry.close();
            } catch (Exception e) {
                // ignore
            }
        }

        result.put("warnings", warnings);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/introspect")
    public ResponseEntity<Map<String, Object>> introspect() {
        try {
            String sdkVersion = "unknown";
            List<Map<String, Object>> options = new ArrayList<>();

            try {
                Class<?> sentryOptionsClass = Class.forName("io.sentry.SentryOptions");
                sdkVersion = sentryOptionsClass.getPackage().getImplementationVersion() != null
                    ? sentryOptionsClass.getPackage().getImplementationVersion() : "unknown";

                // Use reflection to discover setter methods (which represent configurable options)
                Method[] methods = sentryOptionsClass.getMethods();
                for (Method method : methods) {
                    String name = method.getName();
                    if (!name.startsWith("set") || method.getParameterCount() != 1) continue;

                    String optionName = name.substring(3);
                    // Convert PascalCase to camelCase
                    String canonicalKey = Character.toLowerCase(optionName.charAt(0)) + optionName.substring(1);

                    Class<?> paramType = method.getParameterTypes()[0];
                    String typeStr;
                    if (paramType == String.class) typeStr = "string";
                    else if (paramType == boolean.class || paramType == Boolean.class) typeStr = "boolean";
                    else if (paramType == double.class || paramType == Double.class || paramType == float.class || paramType == Float.class) typeStr = "float";
                    else if (paramType == int.class || paramType == Integer.class || paramType == long.class || paramType == Long.class) typeStr = "integer";
                    else if (paramType.isArray() || List.class.isAssignableFrom(paramType)) typeStr = "array";
                    else typeStr = paramType.getSimpleName().toLowerCase();

                    Map<String, Object> opt = new HashMap<>();
                    opt.put("key", optionName);
                    opt.put("canonicalKey", canonicalKey);
                    opt.put("type", typeStr);
                    opt.put("required", canonicalKey.equals("dsn"));
                    opt.put("default", null);
                    opt.put("description", "");
                    options.add(opt);
                }
            } catch (Exception e) {
                // SentryOptions not on classpath - return empty
            }

            Map<String, Object> result = new HashMap<>();
            result.put("sdk", "java");
            result.put("sdkVersion", sdkVersion);
            result.put("sdkPackage", "io.sentry:sentry");
            result.put("source", "reflection");
            result.put("options", options);
            result.put("timestamp", java.time.Instant.now().toString());

            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                "success", false,
                "error", "Introspection service error: " + e.getMessage()
            ));
        }
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of(
            "status", "healthy",
            "sdk", "java"
        ));
    }
}
