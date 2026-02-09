defmodule SdkPlayground.Router do
  use Plug.Router
  use Plug.ErrorHandler

  plug(CORSPlug)
  plug(Plug.Logger)
  plug(:match)
  plug(Plug.Parsers, parsers: [:json], json_decoder: Jason)
  plug(:dispatch)

  post "/transform" do
    case conn.body_params do
      %{"event" => event, "beforeSendCode" => before_send_code} ->
        transform(conn, event, before_send_code)

      _ ->
        send_error(conn, 400, "Missing required fields: event, beforeSendCode")
    end
  end

  post "/validate" do
    case conn.body_params do
      %{"code" => code} ->
        validate(conn, code)

      _ ->
        send_error(conn, 400, "Missing required field: code")
    end
  end

  post "/validate-config" do
    case conn.body_params do
      %{"configCode" => config_code} ->
        validate_config(conn, config_code)

      _ ->
        send_error(conn, 400, "Missing required field: configCode")
    end
  end

  get "/introspect" do
    introspect_sdk(conn)
  end

  get "/health" do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(200, Jason.encode!(%{status: "healthy", sdk: "elixir"}))
  end

  match _ do
    send_resp(conn, 404, "Not found")
  end

  defp transform(conn, event, before_send_code) do
    try do
      # Clone the event to prevent mutation
      event_clone = event |> Jason.encode!() |> Jason.decode!()

      # Compile and execute the beforeSend function
      {result, _binding} =
        Code.eval_string(before_send_code, [event: event_clone, hint: %{}])

      # Check if result is a function
      transformed_event =
        cond do
          is_function(result, 2) ->
            # Call the function with event and hint
            apply(result, [event_clone, %{}])

          is_function(result, 1) ->
            # Call the function with just event
            apply(result, [event_clone])

          true ->
            # If not a function, assume it's the result itself
            result
        end

      conn
      |> put_resp_content_type("application/json")
      |> send_resp(
        200,
        Jason.encode!(%{
          success: true,
          transformedEvent: transformed_event
        })
      )
    rescue
      e in SyntaxError ->
        send_error(conn, 400, "Syntax error: #{Exception.message(e)}")

      e in CompileError ->
        send_error(conn, 400, "Compilation error: #{Exception.message(e)}")

      e in ArgumentError ->
        send_error(conn, 400, "Argument error: #{Exception.message(e)}")

      e ->
        stacktrace = Exception.format(:error, e, __STACKTRACE__)
        send_error(conn, 500, "Runtime error: #{Exception.message(e)}", stacktrace)
    end
  end

  defp validate(conn, code) do
    try do
      # Try to compile the code to check for syntax errors
      Code.compile_string(code)

      conn
      |> put_resp_content_type("application/json")
      |> send_resp(
        200,
        Jason.encode!(%{
          valid: true,
          errors: []
        })
      )
    rescue
      e in SyntaxError ->
        errors = [
          %{
            line: e.line,
            column: e.column,
            message: Exception.message(e)
          }
        ]

        conn
        |> put_resp_content_type("application/json")
        |> send_resp(
          200,
          Jason.encode!(%{
            valid: false,
            errors: errors
          })
        )

      e in CompileError ->
        errors = [
          %{
            line: e.line,
            column: nil,
            message: Exception.message(e)
          }
        ]

        conn
        |> put_resp_content_type("application/json")
        |> send_resp(
          200,
          Jason.encode!(%{
            valid: false,
            errors: errors
          })
        )

      e ->
        errors = [
          %{
            line: nil,
            column: nil,
            message: Exception.message(e)
          }
        ]

        conn
        |> put_resp_content_type("application/json")
        |> send_resp(
          200,
          Jason.encode!(%{
            valid: false,
            errors: errors
          })
        )
    end
  end

  defp validate_config(conn, config_code) do
    try do
      {_result, _binding} = Code.eval_string(config_code)

      conn
      |> put_resp_content_type("application/json")
      |> send_resp(
        200,
        Jason.encode!(%{
          success: true,
          sdk: "elixir",
          sdkVersion: "unknown",
          initSucceeded: true,
          warnings: [],
          resolvedOptions: %{},
          recognizedKeys: [],
          ignoredKeys: []
        })
      )
    rescue
      e ->
        conn
        |> put_resp_content_type("application/json")
        |> send_resp(
          200,
          Jason.encode!(%{
            success: true,
            sdk: "elixir",
            sdkVersion: "unknown",
            initSucceeded: false,
            error: Exception.message(e),
            warnings: [],
            resolvedOptions: %{},
            recognizedKeys: [],
            ignoredKeys: []
          })
        )
    end
  end

  defp introspect_sdk(conn) do
    # Manifest-based introspection for Elixir SDK
    manifest_path = Path.join(:code.priv_dir(:sdk_playground), "introspection-manifest.json")

    response =
      if File.exists?(manifest_path) do
        case File.read(manifest_path) do
          {:ok, content} ->
            case Jason.decode(content) do
              {:ok, manifest} -> manifest
              _ -> default_introspection_manifest()
            end

          _ ->
            default_introspection_manifest()
        end
      else
        default_introspection_manifest()
      end

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(200, Jason.encode!(response))
  end

  defp default_introspection_manifest do
    %{
      sdk: "elixir",
      sdkVersion: "unknown",
      sdkPackage: "sentry",
      source: "manifest",
      options: [
        %{key: "dsn", canonicalKey: "dsn", type: "string", required: true, default: nil, description: "Data Source Name"},
        %{key: "environment_name", canonicalKey: "environment", type: "string", required: false, default: nil, description: "Environment name"},
        %{key: "release", canonicalKey: "release", type: "string", required: false, default: nil, description: "Release version"},
        %{key: "sample_rate", canonicalKey: "sampleRate", type: "float", required: false, default: 1.0, description: "Error sample rate"},
        %{key: "traces_sample_rate", canonicalKey: "tracesSampleRate", type: "float", required: false, default: nil, description: "Traces sample rate"},
        %{key: "before_send", canonicalKey: "beforeSend", type: "function", required: false, default: nil, description: "Hook before sending event"},
        %{key: "included_environments", canonicalKey: "includedEnvironments", type: "array", required: false, default: nil, description: "Environments to send events for"},
        %{key: "max_breadcrumbs", canonicalKey: "maxBreadcrumbs", type: "integer", required: false, default: 100, description: "Max breadcrumbs"},
        %{key: "enable_source_code_context", canonicalKey: "enableSourceCodeContext", type: "boolean", required: false, default: false, description: "Include source code in events"},
        %{key: "root_source_code_paths", canonicalKey: "rootSourceCodePaths", type: "array", required: false, default: nil, description: "Paths for source code context"},
        %{key: "context_lines", canonicalKey: "contextLines", type: "integer", required: false, default: 3, description: "Number of context lines"},
        %{key: "tags", canonicalKey: "tags", type: "object", required: false, default: %{}, description: "Default tags"},
        %{key: "filter", canonicalKey: "filter", type: "function", required: false, default: nil, description: "Event filter module"}
      ],
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp send_error(conn, status, message, traceback \\ nil) do
    response =
      case traceback do
        nil -> %{success: false, error: message}
        _ -> %{success: false, error: message, traceback: traceback}
      end

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(response))
  end

  @impl Plug.ErrorHandler
  def handle_errors(conn, %{kind: _kind, reason: reason, stack: _stack}) do
    send_error(conn, conn.status, "Internal server error: #{inspect(reason)}")
  end
end
