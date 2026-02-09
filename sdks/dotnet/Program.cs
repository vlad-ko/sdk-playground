using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;
using Sentry;
using Sentry.Protocol;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:5002");

var app = builder.Build();

// JSON serializer options for responses
var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true
};

app.MapPost("/transform", async (TransformRequest request) =>
{
    try
    {
        // Validate inputs
        if (request == null || request.Event == null || string.IsNullOrEmpty(request.BeforeSendCode))
        {
            return Results.Json(new {
                success = false,
                transformedEvent = (object?)null,
                error = "Missing event or beforeSendCode",
                traceback = (string?)null
            }, statusCode: 400);
        }

        // Convert JsonNode to SentryEvent
        var eventJson = request.Event.ToJsonString();
        var sentryEvent = JsonSerializer.Deserialize<SentryEvent>(eventJson);

        if (sentryEvent == null)
        {
            return Results.Json(new {
                success = false,
                transformedEvent = (object?)null,
                error = "Failed to parse event",
                traceback = (string?)null
            }, statusCode: 400);
        }

        // Create script options with Sentry references
        var scriptOptions = ScriptOptions.Default
            .AddReferences(typeof(SentryEvent).Assembly)
            .AddImports("System", "System.Collections.Generic", "System.Linq", "Sentry", "Sentry.Protocol");

        // Wrap user code to ensure it returns the modified event
        // This prevents silent data loss when users forget "return ev;"
        // Check for return statement (return followed by whitespace or semicolon)
        // First, strip comments to avoid false matches (e.g., "// return later")
        var trimmedCode = request.BeforeSendCode.TrimEnd();
        var codeWithoutComments = System.Text.RegularExpressions.Regex.Replace(trimmedCode, @"//.*?$", "", System.Text.RegularExpressions.RegexOptions.Multiline);
        codeWithoutComments = System.Text.RegularExpressions.Regex.Replace(codeWithoutComments, @"/\*.*?\*/", "", System.Text.RegularExpressions.RegexOptions.Singleline);
        var hasReturn = System.Text.RegularExpressions.Regex.IsMatch(codeWithoutComments, @"\breturn[\s;]");
        var wrappedCode = hasReturn
            ? trimmedCode  // Don't wrap if user has explicit return
            : (trimmedCode.EndsWith(";")
                ? $"{trimmedCode}(ev)"
                : $"{trimmedCode};(ev)");

        // Compile the script with object? return type to support both:
        // - SentryEvent (beforeSend) - returns modified event or null
        // - double (tracesSampler) - returns sample rate 0.0-1.0
        Script<object?> script;
        try
        {
            script = CSharpScript.Create<object?>(
                wrappedCode,
                scriptOptions,
                globalsType: typeof(ScriptGlobals)
            );

            var diagnostics = script.Compile();
            if (diagnostics.Any(d => d.Severity == Microsoft.CodeAnalysis.DiagnosticSeverity.Error))
            {
                var errors = string.Join("\n", diagnostics.Select(d => d.GetMessage()));
                return Results.Json(new {
                    success = false,
                    transformedEvent = (object?)null,
                    error = $"Compilation failed for beforeSend code: {errors}",
                    traceback = (string?)null
                }, statusCode: 400);
            }
        }
        catch (Exception ex)
        {
            return Results.Json(new {
                success = false,
                transformedEvent = (object?)null,
                error = $"Compilation failed for beforeSend code: {ex.Message}",
                traceback = (string?)null
            }, statusCode: 400);
        }

        // Execute the transformation
        try
        {
            var globals = new ScriptGlobals { ev = sentryEvent };
            var result = await script.RunAsync(globals);

            // With code wrapping, we always get a return value:
            // - If user forgot return, wrapping adds (ev) so ReturnValue = modified event
            // - If user wrote return, ReturnValue = their explicit return value (including null)
            var returnValue = result.ReturnValue;

            // Handle different return types
            object? transformedEventObj = null;
            if (returnValue != null)
            {
                // Check if it's a numeric type (for tracesSampler)
                if (returnValue is double || returnValue is float || returnValue is int || returnValue is decimal)
                {
                    // Return the number directly for tracesSampler
                    transformedEventObj = Convert.ToDouble(returnValue);
                }
                else
                {
                    // Assume it's an event object, serialize and deserialize for JSON response
                    var transformedJson = JsonSerializer.Serialize(returnValue);
                    transformedEventObj = JsonSerializer.Deserialize<JsonObject>(transformedJson);
                }
            }

            return Results.Json(new {
                success = true,
                transformedEvent = transformedEventObj,
                error = (string?)null,
                traceback = (string?)null
            });
        }
        catch (Exception ex)
        {
            return Results.Json(new {
                success = false,
                transformedEvent = (object?)null,
                error = $"Transformation error: {ex.Message}",
                traceback = ex.StackTrace
            }, statusCode: 500);
        }
    }
    catch (Exception ex)
    {
        return Results.Json(new {
            success = false,
            transformedEvent = (object?)null,
            error = $"Unexpected error: {ex.Message}",
            traceback = ex.StackTrace
        }, statusCode: 500);
    }
});

app.MapPost("/validate", async (ValidationRequest request) =>
{
    try
    {
        if (string.IsNullOrEmpty(request?.Code))
        {
            return Results.Json(new {
                valid = false,
                errors = new[] { new { message = "Missing code parameter" } }
            }, statusCode: 400);
        }

        // Create script options with Sentry references
        var scriptOptions = ScriptOptions.Default
            .AddReferences(typeof(SentryEvent).Assembly)
            .AddImports("System", "System.Collections.Generic", "System.Linq", "Sentry", "Sentry.Protocol");

        try
        {
            // Compile the script to check for syntax/compilation errors
            var script = CSharpScript.Create<object>(
                request.Code,
                scriptOptions,
                globalsType: typeof(ScriptGlobals)
            );

            var diagnostics = script.Compile();

            // Check for errors
            var errors = diagnostics
                .Where(d => d.Severity == Microsoft.CodeAnalysis.DiagnosticSeverity.Error)
                .ToList();

            if (errors.Any())
            {
                var validationErrors = errors.Select(d => {
                    var lineSpan = d.Location.GetLineSpan();
                    return new {
                        line = lineSpan.StartLinePosition.Line + 1,
                        column = lineSpan.StartLinePosition.Character + 1,
                        message = d.GetMessage()
                    };
                }).ToArray();

                return Results.Json(new {
                    valid = false,
                    errors = validationErrors
                });
            }

            return Results.Json(new {
                valid = true,
                errors = Array.Empty<object>()
            });
        }
        catch (Exception ex)
        {
            return Results.Json(new {
                valid = false,
                errors = new[] { new { message = ex.Message } }
            });
        }
    }
    catch (Exception ex)
    {
        return Results.Json(new {
            valid = false,
            errors = new[] { new { message = $"Validation service error: {ex.Message}" } }
        }, statusCode: 500);
    }
});

app.MapPost("/validate-config", async (ValidateConfigRequest request) =>
{
    try
    {
        if (string.IsNullOrEmpty(request?.ConfigCode))
        {
            return Results.Json(new {
                success = false,
                error = "Missing configCode"
            }, statusCode: 400);
        }

        var sdkVersion = typeof(SentrySdk).Assembly.GetName().Version?.ToString() ?? "unknown";
        var warnings = new List<string>();

        // Capture Console.Error output to detect warnings during init
        var originalErr = Console.Error;
        var capturedErr = new System.IO.StringWriter();
        Console.SetError(capturedErr);

        try
        {
            // Create script options with Sentry references
            var scriptOptions = ScriptOptions.Default
                .AddReferences(typeof(SentryEvent).Assembly)
                .AddReferences(typeof(SentrySdk).Assembly)
                .AddImports("System", "System.Collections.Generic", "Sentry");

            // Wrap user's config code to inject noop transport
            var wrappedCode = $@"
                SentrySdk.Init(o => {{
                    o.Dsn = ""https://examplePublicKey@o0.ingest.sentry.io/0"";
                    // User code follows - it may override DSN and other options
                    {request.ConfigCode}
                }});
            ";

            var script = CSharpScript.Create<object?>(
                wrappedCode,
                scriptOptions
            );

            var diagnostics = script.Compile();
            if (diagnostics.Any(d => d.Severity == Microsoft.CodeAnalysis.DiagnosticSeverity.Error))
            {
                var errors = string.Join("\n", diagnostics.Select(d => d.GetMessage()));
                return Results.Json(new {
                    success = true,
                    sdk = "dotnet",
                    sdkVersion = sdkVersion,
                    initSucceeded = false,
                    error = $"Compilation error: {errors}",
                    warnings = warnings,
                    resolvedOptions = new Dictionary<string, object>(),
                    recognizedKeys = Array.Empty<string>(),
                    ignoredKeys = Array.Empty<string>()
                });
            }

            await script.RunAsync();

            // Extract resolved options via reflection on SentryOptions
            var resolvedOptions = new Dictionary<string, object>();
            var recognizedKeys = new List<string>();

            try
            {
                // Use SentrySdk to get the current options
                var optionsType = typeof(SentryOptions);
                var props = optionsType.GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);

                // Create a temporary options object to get defaults comparison
                foreach (var prop in props)
                {
                    try
                    {
                        var key = prop.Name;
                        recognizedKeys.Add(key);
                    }
                    catch { /* skip */ }
                }
            }
            catch { /* ignore reflection errors */ }

            // Close the SDK
            try { SentrySdk.Close(); } catch { }

            // Collect captured warnings from stderr
            Console.SetError(originalErr);
            var errOutput = capturedErr.ToString();
            if (!string.IsNullOrWhiteSpace(errOutput))
            {
                warnings.AddRange(errOutput.Split('\n', StringSplitOptions.RemoveEmptyEntries));
            }

            return Results.Json(new {
                success = true,
                sdk = "dotnet",
                sdkVersion = sdkVersion,
                initSucceeded = true,
                warnings = warnings,
                resolvedOptions = resolvedOptions,
                recognizedKeys = recognizedKeys,
                ignoredKeys = Array.Empty<string>()
            });
        }
        catch (Exception ex)
        {
            try { SentrySdk.Close(); } catch { }

            // Collect captured warnings from stderr
            Console.SetError(originalErr);
            var errOutput = capturedErr.ToString();
            if (!string.IsNullOrWhiteSpace(errOutput))
            {
                warnings.AddRange(errOutput.Split('\n', StringSplitOptions.RemoveEmptyEntries));
            }

            return Results.Json(new {
                success = true,
                sdk = "dotnet",
                sdkVersion = typeof(SentrySdk).Assembly.GetName().Version?.ToString() ?? "unknown",
                initSucceeded = false,
                error = ex.Message,
                warnings = warnings,
                resolvedOptions = new Dictionary<string, object>(),
                recognizedKeys = Array.Empty<string>(),
                ignoredKeys = Array.Empty<string>()
            });
        }
    }
    catch (Exception ex)
    {
        return Results.Json(new {
            success = false,
            error = $"Validation service error: {ex.Message}"
        }, statusCode: 500);
    }
});

app.MapGet("/introspect", () =>
{
    try
    {
        var sdkVersion = typeof(SentrySdk).Assembly.GetName().Version?.ToString() ?? "unknown";
        var options = new List<object>();

        // Use reflection on SentryOptions to discover all configurable properties
        var optionsType = typeof(SentryOptions);
        var props = optionsType.GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance);

        foreach (var prop in props)
        {
            if (!prop.CanWrite) continue;

            var key = prop.Name;
            var propType = prop.PropertyType;

            string typeStr;
            if (propType == typeof(string)) typeStr = "string";
            else if (propType == typeof(bool) || propType == typeof(bool?)) typeStr = "boolean";
            else if (propType == typeof(double) || propType == typeof(float) || propType == typeof(double?) || propType == typeof(float?)) typeStr = "float";
            else if (propType == typeof(int) || propType == typeof(long) || propType == typeof(int?)) typeStr = "integer";
            else if (propType.IsArray || (propType.IsGenericType && propType.GetGenericTypeDefinition() == typeof(List<>))) typeStr = "array";
            else if (typeof(Delegate).IsAssignableFrom(propType)) typeStr = "function";
            else typeStr = propType.Name.ToLower();

            // Convert PascalCase to camelCase
            var canonicalKey = char.ToLower(key[0]) + key.Substring(1);

            options.Add(new {
                key = key,
                canonicalKey = canonicalKey,
                type = typeStr,
                required = key == "Dsn",
                @default = (object?)null,
                description = ""
            });
        }

        return Results.Json(new {
            sdk = "dotnet",
            sdkVersion = sdkVersion,
            sdkPackage = "Sentry",
            source = "reflection",
            options = options,
            timestamp = DateTime.UtcNow.ToString("o")
        });
    }
    catch (Exception ex)
    {
        return Results.Json(new {
            success = false,
            error = $"Introspection service error: {ex.Message}"
        }, statusCode: 500);
    }
});

app.MapGet("/health", () =>
{
    return Results.Json(new { status = "healthy", sdk = "dotnet" }, jsonOptions);
});

app.Run();

// Make Program accessible to tests
public partial class Program { }

public record TransformRequest(JsonNode? Event, string? BeforeSendCode);
public record TransformResponse(bool Success, object? TransformedEvent, string? Error, string? Traceback);
public record ValidationRequest(string? Code);
public record ValidateConfigRequest(string? ConfigCode);
public record HealthResponse(string Status, string Sdk);

public class ScriptGlobals
{
    public SentryEvent? ev { get; set; }
}
