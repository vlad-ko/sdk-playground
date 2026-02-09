//! Rust SDK Backend for SDK Playground
//!
//! This service provides a REST API for executing Rust code transformations
//! in a sandboxed environment. It supports:
//!
//! - **beforeSend**: Transform or drop Sentry events (returns Value or None)
//! - **tracesSampler**: Return sample rates for transactions (returns f64 0.0-1.0)
//!
//! ## Endpoints
//!
//! - `POST /transform` - Execute user code against an event
//! - `POST /validate` - Validate code syntax without execution
//! - `GET /health` - Health check endpoint
//!
//! ## How It Works
//!
//! User code is compiled into a temporary Cargo project and executed.
//! The code is wrapped to support both event transformations and numeric returns:
//!
//! ```rust
//! // beforeSend - return modified event or None to drop
//! Some(event)  // Keep/modify event
//! None         // Drop event
//!
//! // tracesSampler - return sample rate
//! 0.5          // 50% sampling
//! ```

use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::process::Command;

/// Request body for the /transform endpoint
#[derive(Debug, Deserialize)]
struct TransformRequest {
    /// The Sentry event to transform
    event: Value,
    /// User's Rust code to execute
    #[serde(rename = "beforeSendCode")]
    before_send_code: String,
}

/// Response from the /transform endpoint
#[derive(Debug, Serialize)]
struct TransformResponse {
    /// Whether the transformation succeeded
    success: bool,
    /// The transformed event, sample rate, or null (if dropped)
    /// - For beforeSend: the modified event object or null
    /// - For tracesSampler: a number between 0.0 and 1.0
    #[serde(rename = "transformedEvent", skip_serializing_if = "Option::is_none")]
    transformed_event: Option<Value>,
    /// Error message if transformation failed
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    /// Full error traceback for debugging
    #[serde(skip_serializing_if = "Option::is_none")]
    traceback: Option<String>,
}

/// Request body for the /validate endpoint
#[derive(Debug, Deserialize)]
struct ValidationRequest {
    /// Code to validate
    code: String,
}

/// A single validation error
#[derive(Debug, Serialize)]
struct ValidationError {
    /// Line number where error occurred (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<usize>,
    /// Column number where error occurred (if available)
    #[serde(skip_serializing_if = "Option::is_none")]
    column: Option<usize>,
    /// Error message
    message: String,
}

/// Response from the /validate endpoint
#[derive(Debug, Serialize)]
struct ValidationResponse {
    /// Whether the code is valid
    valid: bool,
    /// List of validation errors
    errors: Vec<ValidationError>,
}

/// Response from the /health endpoint
#[derive(Debug, Serialize)]
struct HealthResponse {
    /// Service status
    status: String,
    /// SDK identifier
    sdk: String,
}

/// Execute user code transformation
///
/// Compiles and runs user-provided Rust code in a sandboxed Cargo project.
/// Supports both beforeSend (event transformation) and tracesSampler (sample rates).
async fn transform(req: web::Json<TransformRequest>) -> impl Responder {
    // Create a temporary directory for compilation
    let temp_dir = match tempfile::tempdir() {
        Ok(dir) => dir,
        Err(e) => {
            return HttpResponse::InternalServerError().json(TransformResponse {
                success: false,
                transformed_event: None,
                error: Some(format!("Failed to create temp directory: {}", e)),
                traceback: None,
            });
        }
    };

    let project_path = temp_dir.path();
    let src_path = project_path.join("src");

    // Create project structure
    if let Err(e) = fs::create_dir(&src_path) {
        return HttpResponse::InternalServerError().json(TransformResponse {
            success: false,
            transformed_event: None,
            error: Some(format!("Failed to create src directory: {}", e)),
            traceback: None,
        });
    }

    // Serialize event to JSON (escape for raw string literal)
    let event_json = match serde_json::to_string(&req.event) {
        Ok(json) => json,
        Err(e) => {
            return HttpResponse::BadRequest().json(TransformResponse {
                success: false,
                transformed_event: None,
                error: Some(format!("Failed to serialize event: {}", e)),
                traceback: None,
            });
        }
    };

    // Create Cargo.toml for the temporary project
    let cargo_toml = r#"[package]
name = "transform"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
"#;

    if let Err(e) = fs::write(project_path.join("Cargo.toml"), cargo_toml) {
        return HttpResponse::InternalServerError().json(TransformResponse {
            success: false,
            transformed_event: None,
            error: Some(format!("Failed to write Cargo.toml: {}", e)),
            traceback: None,
        });
    }

    // Write event JSON to a separate file to avoid escaping issues
    // This is cleaner than embedding JSON in a Rust string literal
    if let Err(e) = fs::write(project_path.join("event.json"), &event_json) {
        return HttpResponse::InternalServerError().json(TransformResponse {
            success: false,
            transformed_event: None,
            error: Some(format!("Failed to write event.json: {}", e)),
            traceback: None,
        });
    }

    // Create main.rs with user's code
    //
    // The generated code supports two return types:
    // 1. Option<Value> - for beforeSend (Some(event), None to drop)
    // 2. f64 - for tracesSampler (sample rate 0.0-1.0)
    //
    // We use a TransformResult enum to unify these at compile time,
    // and output JSON that the parent process can parse.
    let main_rs = format!(
        r##"#![allow(unused_imports)]
#![allow(unused_variables)]
#![allow(unused_mut)]

use serde_json::{{json, Value}};

/// Result type that supports both event transforms and sample rates
enum TransformResult {{
    Event(Option<Value>),
    SampleRate(f64),
}}

impl From<Option<Value>> for TransformResult {{
    fn from(v: Option<Value>) -> Self {{
        TransformResult::Event(v)
    }}
}}

impl From<Value> for TransformResult {{
    fn from(v: Value) -> Self {{
        TransformResult::Event(Some(v))
    }}
}}

impl From<f64> for TransformResult {{
    fn from(v: f64) -> Self {{
        TransformResult::SampleRate(v)
    }}
}}

impl From<f32> for TransformResult {{
    fn from(v: f32) -> Self {{
        TransformResult::SampleRate(v as f64)
    }}
}}

impl From<i32> for TransformResult {{
    fn from(v: i32) -> Self {{
        TransformResult::SampleRate(v as f64)
    }}
}}

impl From<i64> for TransformResult {{
    fn from(v: i64) -> Self {{
        TransformResult::SampleRate(v as f64)
    }}
}}

impl From<()> for TransformResult {{
    fn from(_: ()) -> Self {{
        TransformResult::Event(None)
    }}
}}

fn main() {{
    // Read event from file (avoids string escaping issues)
    let event_json = std::fs::read_to_string("event.json").expect("Failed to read event.json");
    let mut event: Value = serde_json::from_str(&event_json).expect("Failed to parse event JSON");

    // Execute user's code and convert result to TransformResult
    // The .into() call handles type conversion automatically
    let result: TransformResult = (|| {{
        {}
    }})().into();

    // Output result as JSON
    match result {{
        TransformResult::Event(Some(transformed)) => {{
            println!("{{}}", serde_json::to_string(&transformed).unwrap());
        }}
        TransformResult::Event(None) => {{
            println!("null");
        }}
        TransformResult::SampleRate(rate) => {{
            println!("{{}}", rate);
        }}
    }}
}}
"##,
        req.before_send_code
    );

    if let Err(e) = fs::write(src_path.join("main.rs"), main_rs) {
        return HttpResponse::InternalServerError().json(TransformResponse {
            success: false,
            transformed_event: None,
            error: Some(format!("Failed to write main.rs: {}", e)),
            traceback: None,
        });
    }

    // Compile the user's code
    let compile_output = Command::new("cargo")
        .args(["build", "--release", "--quiet"])
        .current_dir(project_path)
        .output();

    let compile_result = match compile_output {
        Ok(output) => output,
        Err(e) => {
            return HttpResponse::InternalServerError().json(TransformResponse {
                success: false,
                transformed_event: None,
                error: Some(format!("Failed to run cargo: {}", e)),
                traceback: None,
            });
        }
    };

    if !compile_result.status.success() {
        let error_msg = String::from_utf8_lossy(&compile_result.stderr).to_string();
        return HttpResponse::BadRequest().json(TransformResponse {
            success: false,
            transformed_event: None,
            error: Some(format!("Compilation error: {}", extract_error_summary(&error_msg))),
            traceback: Some(error_msg),
        });
    }

    // Execute the compiled binary from the project directory
    // This is needed so the binary can find event.json
    let exec_output = Command::new(project_path.join("target/release/transform"))
        .current_dir(project_path)
        .output();

    let exec_result = match exec_output {
        Ok(output) => output,
        Err(e) => {
            return HttpResponse::InternalServerError().json(TransformResponse {
                success: false,
                transformed_event: None,
                error: Some(format!("Failed to execute transform: {}", e)),
                traceback: None,
            });
        }
    };

    if !exec_result.status.success() {
        let error_msg = String::from_utf8_lossy(&exec_result.stderr).to_string();
        return HttpResponse::InternalServerError().json(TransformResponse {
            success: false,
            transformed_event: None,
            error: Some(format!("Runtime error: {}", error_msg)),
            traceback: Some(error_msg),
        });
    }

    // Parse output - can be JSON object, "null", or a number
    let output_str = String::from_utf8_lossy(&exec_result.stdout).trim().to_string();

    let transformed_event: Option<Value> = if output_str == "null" {
        None
    } else {
        // Try to parse as JSON (handles both objects and numbers)
        match serde_json::from_str(&output_str) {
            Ok(value) => Some(value),
            Err(e) => {
                return HttpResponse::InternalServerError().json(TransformResponse {
                    success: false,
                    transformed_event: None,
                    error: Some(format!("Failed to parse result '{}': {}", output_str, e)),
                    traceback: None,
                });
            }
        }
    };

    HttpResponse::Ok().json(TransformResponse {
        success: true,
        transformed_event,
        error: None,
        traceback: None,
    })
}

/// Extract a concise error summary from Rust compiler output
fn extract_error_summary(error_msg: &str) -> String {
    // Find the first "error[E...]:" line for a concise message
    for line in error_msg.lines() {
        if line.starts_with("error[E") || line.starts_with("error:") {
            return line.to_string();
        }
    }
    // Fallback to first non-empty line
    error_msg.lines().find(|l| !l.trim().is_empty())
        .unwrap_or("Unknown compilation error")
        .to_string()
}

/// Validate code syntax without execution
async fn validate(req: web::Json<ValidationRequest>) -> impl Responder {
    // Create a temporary directory for validation
    let temp_dir = match tempfile::tempdir() {
        Ok(dir) => dir,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ValidationResponse {
                valid: false,
                errors: vec![ValidationError {
                    line: None,
                    column: None,
                    message: format!("Validation service error: {}", e),
                }],
            });
        }
    };

    let project_path = temp_dir.path();
    let src_path = project_path.join("src");

    // Create project structure
    if let Err(e) = fs::create_dir(&src_path) {
        return HttpResponse::InternalServerError().json(ValidationResponse {
            valid: false,
            errors: vec![ValidationError {
                line: None,
                column: None,
                message: format!("Validation service error: {}", e),
            }],
        });
    }

    // Create minimal Cargo.toml
    let cargo_toml = r#"[package]
name = "validate"
version = "0.1.0"
edition = "2021"

[dependencies]
serde_json = "1.0"
"#;

    if let Err(e) = fs::write(project_path.join("Cargo.toml"), cargo_toml) {
        return HttpResponse::InternalServerError().json(ValidationResponse {
            valid: false,
            errors: vec![ValidationError {
                line: None,
                column: None,
                message: format!("Validation service error: {}", e),
            }],
        });
    }

    // Create main.rs with user's code for syntax checking
    let main_rs = format!(
        r#"#![allow(unused_imports)]
#![allow(unused_variables)]
#![allow(unused_mut)]

use serde_json::Value;

fn main() {{
    let mut event: Value = serde_json::json!({{}});
    let _result = (|| {{
        {}
    }})();
}}
"#,
        req.code
    );

    if let Err(e) = fs::write(src_path.join("main.rs"), main_rs) {
        return HttpResponse::InternalServerError().json(ValidationResponse {
            valid: false,
            errors: vec![ValidationError {
                line: None,
                column: None,
                message: format!("Validation service error: {}", e),
            }],
        });
    }

    // Check syntax without full compilation
    let check_output = Command::new("cargo")
        .args(["check", "--quiet"])
        .current_dir(project_path)
        .output();

    let check_result = match check_output {
        Ok(output) => output,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ValidationResponse {
                valid: false,
                errors: vec![ValidationError {
                    line: None,
                    column: None,
                    message: format!("Validation service error: {}", e),
                }],
            });
        }
    };

    if !check_result.status.success() {
        let error_msg = String::from_utf8_lossy(&check_result.stderr).to_string();
        let errors = parse_rust_errors(&error_msg);

        return HttpResponse::Ok().json(ValidationResponse {
            valid: false,
            errors: if errors.is_empty() {
                vec![ValidationError {
                    line: None,
                    column: None,
                    message: error_msg,
                }]
            } else {
                errors
            },
        });
    }

    HttpResponse::Ok().json(ValidationResponse {
        valid: true,
        errors: vec![],
    })
}

/// Parse Rust compiler errors to extract line/column information
fn parse_rust_errors(error_msg: &str) -> Vec<ValidationError> {
    let mut errors = vec![];

    // Rust errors look like: "error[E0308]: ... --> src/main.rs:10:5"
    for line in error_msg.lines() {
        if line.contains("error") && line.contains("-->") {
            // Try to extract line:column from " --> file:line:column"
            if let Some(pos) = line.find("-->") {
                let location = &line[pos + 4..];
                let parts: Vec<&str> = location.split(':').collect();
                if parts.len() >= 2 {
                    // Adjust line number to account for wrapper code (8 lines of boilerplate)
                    let line_num = parts[1].trim().parse::<usize>().ok()
                        .map(|n| n.saturating_sub(8));
                    let col_num = parts.get(2).and_then(|c| c.trim().parse::<usize>().ok());

                    errors.push(ValidationError {
                        line: line_num,
                        column: col_num,
                        message: extract_error_summary(error_msg),
                    });
                    break;  // Only report first error
                }
            }
        }
    }

    errors
}

/// Request body for the /validate-config endpoint
#[derive(Debug, Deserialize)]
struct ValidateConfigRequest {
    #[serde(rename = "configCode")]
    config_code: String,
}

/// Response from /validate-config
#[derive(Debug, Serialize)]
struct ConfigValidationResponse {
    success: bool,
    sdk: String,
    #[serde(rename = "sdkVersion")]
    sdk_version: String,
    #[serde(rename = "initSucceeded")]
    init_succeeded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    warnings: Vec<String>,
    #[serde(rename = "resolvedOptions")]
    resolved_options: serde_json::Map<String, Value>,
    #[serde(rename = "recognizedKeys")]
    recognized_keys: Vec<String>,
    #[serde(rename = "ignoredKeys")]
    ignored_keys: Vec<String>,
}

/// Validate config by compiling a temporary Cargo project that calls sentry::init()
async fn validate_config(req: web::Json<ValidateConfigRequest>) -> impl Responder {
    let temp_dir = match tempfile::tempdir() {
        Ok(dir) => dir,
        Err(e) => {
            return HttpResponse::InternalServerError().json(ConfigValidationResponse {
                success: false,
                sdk: "rust".to_string(),
                sdk_version: String::new(),
                init_succeeded: false,
                error: Some(format!("Failed to create temp directory: {}", e)),
                warnings: vec![],
                resolved_options: serde_json::Map::new(),
                recognized_keys: vec![],
                ignored_keys: vec![],
            });
        }
    };

    let project_path = temp_dir.path();
    let src_path = project_path.join("src");
    let _ = fs::create_dir(&src_path);

    let cargo_toml = r#"[package]
name = "validate-config"
version = "0.1.0"
edition = "2021"

[dependencies]
sentry = "0.34"
serde_json = "1.0"
"#;
    let _ = fs::write(project_path.join("Cargo.toml"), cargo_toml);

    let main_rs = format!(
        r##"use sentry::{{ClientOptions, init}};
use serde_json::json;

fn main() {{
    // User's config code
    let result = std::panic::catch_unwind(|| {{
        {config_code}
    }});

    match result {{
        Ok(_) => {{
            println!("{{}}", json!({{
                "success": true,
                "sdk": "rust",
                "sdkVersion": env!("CARGO_PKG_VERSION"),
                "initSucceeded": true,
                "warnings": [],
                "resolvedOptions": {{}},
                "recognizedKeys": [],
                "ignoredKeys": []
            }}));
        }}
        Err(e) => {{
            let msg = if let Some(s) = e.downcast_ref::<String>() {{
                s.clone()
            }} else if let Some(s) = e.downcast_ref::<&str>() {{
                s.to_string()
            }} else {{
                "Unknown panic".to_string()
            }};
            println!("{{}}", json!({{
                "success": true,
                "sdk": "rust",
                "sdkVersion": "unknown",
                "initSucceeded": false,
                "error": msg,
                "warnings": [],
                "resolvedOptions": {{}},
                "recognizedKeys": [],
                "ignoredKeys": []
            }}));
        }}
    }}
}}
"##,
        config_code = req.config_code
    );

    let _ = fs::write(src_path.join("main.rs"), main_rs);

    // Compile
    let compile_output = Command::new("cargo")
        .args(["build", "--release", "--quiet"])
        .current_dir(project_path)
        .output();

    match compile_output {
        Ok(output) if !output.status.success() => {
            let error_msg = String::from_utf8_lossy(&output.stderr).to_string();
            return HttpResponse::Ok().json(ConfigValidationResponse {
                success: true,
                sdk: "rust".to_string(),
                sdk_version: String::new(),
                init_succeeded: false,
                error: Some(format!("Compilation error: {}", extract_error_summary(&error_msg))),
                warnings: vec![],
                resolved_options: serde_json::Map::new(),
                recognized_keys: vec![],
                ignored_keys: vec![],
            });
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(ConfigValidationResponse {
                success: false,
                sdk: "rust".to_string(),
                sdk_version: String::new(),
                init_succeeded: false,
                error: Some(format!("Failed to compile: {}", e)),
                warnings: vec![],
                resolved_options: serde_json::Map::new(),
                recognized_keys: vec![],
                ignored_keys: vec![],
            });
        }
        _ => {}
    }

    // Execute
    let exec_output = Command::new(project_path.join("target/release/validate-config"))
        .current_dir(project_path)
        .output();

    match exec_output {
        Ok(output) if output.status.success() => {
            let output_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            match serde_json::from_str::<ConfigValidationResponse>(&output_str) {
                Ok(result) => HttpResponse::Ok().json(result),
                Err(e) => HttpResponse::InternalServerError().json(ConfigValidationResponse {
                    success: false,
                    sdk: "rust".to_string(),
                    sdk_version: String::new(),
                    init_succeeded: false,
                    error: Some(format!("Failed to parse result: {}", e)),
                    warnings: vec![],
                    resolved_options: serde_json::Map::new(),
                    recognized_keys: vec![],
                    ignored_keys: vec![],
                }),
            }
        }
        Ok(output) => {
            let error_msg = String::from_utf8_lossy(&output.stderr).to_string();
            HttpResponse::Ok().json(ConfigValidationResponse {
                success: true,
                sdk: "rust".to_string(),
                sdk_version: String::new(),
                init_succeeded: false,
                error: Some(format!("Runtime error: {}", error_msg)),
                warnings: vec![],
                resolved_options: serde_json::Map::new(),
                recognized_keys: vec![],
                ignored_keys: vec![],
            })
        }
        Err(e) => HttpResponse::InternalServerError().json(ConfigValidationResponse {
            success: false,
            sdk: "rust".to_string(),
            sdk_version: String::new(),
            init_succeeded: false,
            error: Some(format!("Execution failed: {}", e)),
            warnings: vec![],
            resolved_options: serde_json::Map::new(),
            recognized_keys: vec![],
            ignored_keys: vec![],
        }),
    }
}

/// Introspect endpoint - returns manifest-based options (no runtime reflection in Rust)
async fn introspect() -> impl Responder {
    // Try to load manifest from file, fall back to inline
    let manifest_path = std::path::Path::new("introspection-manifest.json");
    if manifest_path.exists() {
        if let Ok(content) = fs::read_to_string(manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<Value>(&content) {
                return HttpResponse::Ok().json(manifest);
            }
        }
    }

    // Fallback inline manifest for common Rust SDK options
    HttpResponse::Ok().json(serde_json::json!({
        "sdk": "rust",
        "sdkVersion": "0.34",
        "sdkPackage": "sentry",
        "source": "manifest",
        "options": [
            {"key": "dsn", "canonicalKey": "dsn", "type": "string", "required": true, "default": null, "description": "Data Source Name"},
            {"key": "debug", "canonicalKey": "debug", "type": "boolean", "required": false, "default": false, "description": "Enable debug mode"},
            {"key": "release", "canonicalKey": "release", "type": "string", "required": false, "default": null, "description": "Release version"},
            {"key": "environment", "canonicalKey": "environment", "type": "string", "required": false, "default": null, "description": "Environment name"},
            {"key": "sample_rate", "canonicalKey": "sampleRate", "type": "float", "required": false, "default": 1.0, "description": "Error sample rate"},
            {"key": "traces_sample_rate", "canonicalKey": "tracesSampleRate", "type": "float", "required": false, "default": null, "description": "Traces sample rate"},
            {"key": "before_send", "canonicalKey": "beforeSend", "type": "function", "required": false, "default": null, "description": "Hook before sending event"},
            {"key": "max_breadcrumbs", "canonicalKey": "maxBreadcrumbs", "type": "integer", "required": false, "default": 100, "description": "Max breadcrumbs"},
            {"key": "attach_stacktrace", "canonicalKey": "attachStacktrace", "type": "boolean", "required": false, "default": true, "description": "Attach stacktrace to messages"},
            {"key": "send_default_pii", "canonicalKey": "sendDefaultPii", "type": "boolean", "required": false, "default": false, "description": "Send default PII"},
            {"key": "server_name", "canonicalKey": "serverName", "type": "string", "required": false, "default": null, "description": "Server name"},
            {"key": "in_app_include", "canonicalKey": "inAppInclude", "type": "array", "required": false, "default": [], "description": "Modules to include as in-app"},
            {"key": "in_app_exclude", "canonicalKey": "inAppExclude", "type": "array", "required": false, "default": [], "description": "Modules to exclude from in-app"}
        ],
        "timestamp": format!("{:?}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs())
    }))
}

/// Health check endpoint
async fn health() -> impl Responder {
    HttpResponse::Ok().json(HealthResponse {
        status: "healthy".to_string(),
        sdk: "rust".to_string(),
    })
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    println!("Rust SDK service listening on port 5010");

    HttpServer::new(|| {
        App::new()
            .route("/transform", web::post().to(transform))
            .route("/validate", web::post().to(validate))
            .route("/validate-config", web::post().to(validate_config))
            .route("/introspect", web::get().to(introspect))
            .route("/health", web::get().to(health))
    })
    .bind(("0.0.0.0", 5010))?
    .run()
    .await
}
