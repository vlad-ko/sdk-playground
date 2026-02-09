# frozen_string_literal: true

require 'sinatra'
require 'json'

# Configure Sinatra for API mode
set :bind, '0.0.0.0'
set :port, 5004
set :environment, :production

# Disable all protection middleware for API usage
disable :protection

# Transform endpoint
# Receives an event and beforeSend code, applies the transformation
post '/transform' do
  content_type :json

  begin
    request.body.rewind
    data = JSON.parse(request.body.read)

    unless data['event'] && data['beforeSendCode']
      return [
        400,
        { success: false, error: 'Missing event or beforeSendCode' }.to_json
      ]
    end

    event = data['event']
    before_send_code = data['beforeSendCode']

    # Execute the beforeSend code
    begin
      # Evaluate the code to get the lambda/proc
      before_send_fn = eval(before_send_code)

      unless before_send_fn.respond_to?(:call)
        return [
          400,
          { success: false, error: 'beforeSend code must return a callable (lambda/proc)' }.to_json
        ]
      end
    rescue SyntaxError, StandardError => e
      return [
        400,
        { success: false, error: "Failed to parse beforeSend code: #{e.message}" }.to_json
      ]
    end

    # Apply the transformation
    begin
      # Clone the event to avoid mutation issues
      event_clone = JSON.parse(JSON.generate(event))

      # Execute the beforeSend function
      # Ruby lambdas enforce arity, so we need to check and call appropriately
      # beforeSend can accept (event, hint) or just (event)
      transformed_event = if before_send_fn.arity == 1
                            before_send_fn.call(event_clone)
                          else
                            before_send_fn.call(event_clone, {})
                          end

      { success: true, transformedEvent: transformed_event }.to_json
    rescue StandardError => e
      traceback = e.backtrace.join("\n")
      [
        500,
        {
          success: false,
          error: "Transformation error: #{e.message}",
          traceback: traceback,
          transformedEvent: nil
        }.to_json
      ]
    end
  rescue JSON::ParserError => e
    [
      400,
      { success: false, error: "Invalid JSON: #{e.message}" }.to_json
    ]
  rescue StandardError => e
    warn "Unexpected error: #{e.message}\n#{e.backtrace.join("\n")}"
    [
      500,
      { success: false, error: "Unexpected error: #{e.message}" }.to_json
    ]
  end
end

# Validate endpoint
# Validates beforeSend code for syntax errors without executing it
post '/validate' do
  content_type :json

  begin
    request.body.rewind
    data = JSON.parse(request.body.read)

    unless data['code']
      return [
        400,
        { valid: false, errors: [{ message: 'Missing code parameter' }] }.to_json
      ]
    end

    code = data['code']
    errors = []

    begin
      # Use RubyVM::InstructionSequence to compile without executing
      RubyVM::InstructionSequence.compile(code)

      { valid: true, errors: [] }.to_json
    rescue SyntaxError => e
      # Extract line number from error message if available
      line_match = e.message.match(/:(\d+):/)
      line = line_match ? line_match[1].to_i : nil

      errors << {
        line: line,
        message: e.message
      }

      { valid: false, errors: errors }.to_json
    end
  rescue JSON::ParserError => e
    [
      400,
      { valid: false, errors: [{ message: "Invalid JSON: #{e.message}" }] }.to_json
    ]
  rescue StandardError => e
    warn "Validation error: #{e.message}"
    [
      500,
      { valid: false, errors: [{ message: "Validation service error: #{e.message}" }] }.to_json
    ]
  end
end

# Validate config endpoint
# Executes Sentry.init with user's config code using a noop transport
post '/validate-config' do
  content_type :json

  begin
    request.body.rewind
    data = JSON.parse(request.body.read)

    unless data['configCode']
      return [
        400,
        { success: false, error: 'Missing configCode' }.to_json
      ]
    end

    config_code = data['configCode']
    captured_warnings = []
    sdk_version = 'unknown'

    begin
      require 'sentry-ruby'
      sdk_version = defined?(Sentry::VERSION) ? Sentry::VERSION : 'unknown'

      # Capture warnings by overriding Kernel.warn
      original_warn = method(:warn)
      define_method(:warn) do |*args|
        captured_warnings << args.join(' ')
      end

      # Execute the config code with Sentry available
      # Patch Sentry.init to inject noop transport
      original_init = Sentry.method(:init)
      resolved_options = {}

      Sentry.define_singleton_method(:init) do |&block|
        config_obj = nil
        original_init.call do |config|
          config.dsn = 'https://examplePublicKey@o0.ingest.sentry.io/0' unless config.dsn
          config.transport.transport_class = Class.new(Sentry::Transport) do
            def send_data(data); end
          end
          block.call(config) if block
          config_obj = config
        end

        # Extract resolved options
        if config_obj
          config_obj.instance_variables.each do |var|
            key = var.to_s.sub('@', '')
            next if key.start_with?('_')
            begin
              val = config_obj.instance_variable_get(var)
              JSON.generate(val) rescue val = val.to_s
              resolved_options[key] = val
            rescue StandardError
              # skip non-serializable
            end
          end
        end
      end

      begin
        eval(config_code)

        recognized_keys = resolved_options.keys

        # Clean up
        begin
          Sentry.close if Sentry.initialized?
        rescue StandardError
          # ignore
        end

        {
          success: true,
          sdk: 'ruby',
          sdkVersion: sdk_version,
          initSucceeded: true,
          warnings: captured_warnings,
          resolvedOptions: resolved_options,
          recognizedKeys: recognized_keys,
          ignoredKeys: []
        }.to_json
      rescue StandardError => e
        {
          success: true,
          sdk: 'ruby',
          sdkVersion: sdk_version,
          initSucceeded: false,
          error: e.message,
          warnings: captured_warnings,
          resolvedOptions: {},
          recognizedKeys: [],
          ignoredKeys: []
        }.to_json
      ensure
        # Restore original init and warn
        Sentry.define_singleton_method(:init, original_init)
        define_method(:warn, original_warn)
      end

    rescue LoadError => e
      {
        success: true,
        sdk: 'ruby',
        sdkVersion: sdk_version,
        initSucceeded: false,
        error: "sentry-ruby not available: #{e.message}",
        warnings: [],
        resolvedOptions: {},
        recognizedKeys: [],
        ignoredKeys: []
      }.to_json
    end

  rescue JSON::ParserError => e
    [400, { success: false, error: "Invalid JSON: #{e.message}" }.to_json]
  rescue StandardError => e
    warn "Validate-config error: #{e.message}"
    [500, { success: false, error: "Validation service error: #{e.message}" }.to_json]
  end
end

# Introspect endpoint
# Discovers available Sentry SDK configuration options via reflection
get '/introspect' do
  content_type :json

  begin
    require 'sentry-ruby'
    sdk_version = defined?(Sentry::VERSION) ? Sentry::VERSION : 'unknown'

    options = []

    # Use Sentry::Configuration to discover available options
    begin
      config_class = Sentry::Configuration
      # Get setter methods (which represent configurable options)
      setters = config_class.instance_methods(false).select { |m| m.to_s.end_with?('=') }

      setters.each do |setter|
        key = setter.to_s.chomp('=')
        next if key.start_with?('_')

        # Try to get the default value
        default_val = nil
        opt_type = 'any'
        begin
          temp_config = config_class.new
          val = temp_config.send(key)
          default_val = val
          opt_type = case val
                     when String then 'string'
                     when Integer then 'integer'
                     when Float then 'float'
                     when TrueClass, FalseClass then 'boolean'
                     when Array then 'array'
                     when Hash then 'object'
                     when NilClass then 'any'
                     when Proc then 'callable'
                     else 'any'
                     end
          # Ensure serializable
          JSON.generate(default_val) rescue default_val = default_val.to_s
        rescue StandardError
          # ignore
        end

        # Convert snake_case to camelCase for canonical key
        canonical = key.gsub(/_([a-z])/) { $1.upcase }

        options << {
          key: key,
          canonicalKey: canonical,
          type: opt_type,
          required: key == 'dsn',
          default: default_val,
          description: ''
        }
      end
    rescue StandardError => e
      warn "Introspection reflection error: #{e.message}"
    end

    {
      sdk: 'ruby',
      sdkVersion: sdk_version,
      sdkPackage: 'sentry-ruby',
      source: 'reflection',
      options: options,
      timestamp: Time.now.utc.iso8601
    }.to_json

  rescue LoadError => e
    [500, { success: false, error: "sentry-ruby not available: #{e.message}" }.to_json]
  rescue StandardError => e
    warn "Introspect error: #{e.message}"
    [500, { success: false, error: "Introspection service error: #{e.message}" }.to_json]
  end
end

# Health check endpoint
get '/health' do
  content_type :json
  { status: 'healthy', sdk: 'ruby' }.to_json
end
