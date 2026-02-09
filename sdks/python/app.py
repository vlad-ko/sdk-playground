from flask import Flask, request, jsonify
import json
import sys
import traceback
import inspect
import warnings
import importlib

app = Flask(__name__)


def _get_sdk_version():
    """Get the installed sentry-sdk version"""
    try:
        import sentry_sdk
        return sentry_sdk.VERSION
    except Exception:
        return 'unknown'


def _snaketo_camel(name):
    """Convert snake_case to camelCase"""
    parts = name.split('_')
    return parts[0] + ''.join(p.capitalize() for p in parts[1:])

@app.route('/transform', methods=['POST'])
def transform():
    """
    Transform endpoint
    Receives an event and beforeSend code, applies the transformation
    """
    try:
        data = request.get_json()

        if not data or 'event' not in data or 'beforeSendCode' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing event or beforeSendCode'
            }), 400

        event = data['event']
        before_send_code = data['beforeSendCode']

        # Execute the beforeSend code
        try:
            # Create a namespace with common imports available
            # This allows beforeSend code to use re, json, etc.
            import re
            global_namespace = {
                're': re,
                'json': json,
                '__builtins__': __builtins__
            }
            local_namespace = {}

            # Execute the code to define the beforeSend function
            exec(before_send_code, global_namespace, local_namespace)

            # Find the function (usually named 'before_send' or similar)
            before_send_fn = None
            for key, value in local_namespace.items():
                if callable(value) and not key.startswith('__'):
                    before_send_fn = value
                    break

            if before_send_fn is None:
                return jsonify({
                    'success': False,
                    'error': 'Could not find a callable function in beforeSend code'
                }), 400
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'Failed to parse beforeSend code: {str(e)}'
            }), 400

        # Apply the transformation
        try:
            # Clone the event to avoid mutation issues
            event_clone = json.loads(json.dumps(event))

            # Check how many arguments the function takes
            # beforeSend takes (event, hint), tracesSampler takes just (sampling_context)
            sig = inspect.signature(before_send_fn)
            num_params = len(sig.parameters)

            # Execute the function with appropriate arguments
            if num_params == 1:
                # Single argument function (tracesSampler style)
                transformed_event = before_send_fn(event_clone)
            else:
                # Two argument function (beforeSend style)
                transformed_event = before_send_fn(event_clone, {})

            return jsonify({
                'success': True,
                'transformedEvent': transformed_event
            })
        except Exception as e:
            error_trace = traceback.format_exc()
            return jsonify({
                'success': False,
                'error': f'Transformation error: {str(e)}',
                'traceback': error_trace,
                'transformedEvent': None
            }), 500

    except Exception as e:
        error_trace = traceback.format_exc()
        print(f'Unexpected error: {error_trace}', file=sys.stderr)
        return jsonify({
            'success': False,
            'error': f'Unexpected error: {str(e)}'
        }), 500

@app.route('/validate', methods=['POST'])
def validate():
    """
    Validate endpoint
    Validates beforeSend code for syntax errors without executing it
    """
    try:
        data = request.get_json()

        if not data or 'code' not in data:
            return jsonify({
                'valid': False,
                'errors': [{'message': 'Missing code parameter'}]
            }), 400

        code = data['code']
        errors = []

        try:
            # Use compile() to check syntax without executing
            compile(code, '<string>', 'exec')

            # If we get here, syntax is valid
            return jsonify({
                'valid': True,
                'errors': []
            })
        except SyntaxError as e:
            # Extract error details
            error_info = {
                'line': e.lineno,
                'column': e.offset,
                'message': str(e.msg)
            }
            errors.append(error_info)

            return jsonify({
                'valid': False,
                'errors': errors
            })
        except Exception as e:
            # Other compilation errors
            errors.append({'message': str(e)})
            return jsonify({
                'valid': False,
                'errors': errors
            })

    except Exception as e:
        print(f'Validation error: {str(e)}', file=sys.stderr)
        return jsonify({
            'valid': False,
            'errors': [{'message': f'Validation service error: {str(e)}'}]
        }), 500

@app.route('/validate-config', methods=['POST'])
def validate_config():
    """
    Validate config endpoint
    Executes Sentry.init() with user's config code using a noop transport
    to verify the configuration actually works against the real SDK.
    """
    try:
        data = request.get_json()

        if not data or 'configCode' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing configCode'
            }), 400

        config_code = data['configCode']
        captured_warnings = []
        sdk_version = _get_sdk_version()

        try:
            import sentry_sdk
            from sentry_sdk.transport import Transport

            # Noop transport - sends nothing
            class NoopTransport(Transport):
                def capture_envelope(self, *args, **kwargs):
                    pass

            # Capture warnings during init
            with warnings.catch_warnings(record=True) as w:
                warnings.simplefilter("always")

                # Build namespace for exec with sentry_sdk available
                exec_globals = {
                    'sentry_sdk': sentry_sdk,
                    '__builtins__': __builtins__,
                }
                exec_locals = {}

                # Inject noop transport into the config code
                # We wrap the user's init call to intercept and add transport override
                wrapper_code = f"""
import sentry_sdk
from sentry_sdk.transport import Transport

class _NoopTransport(Transport):
    def capture_envelope(self, *args, **kwargs):
        pass

_original_init = sentry_sdk.init

def _patched_init(*args, **kwargs):
    kwargs['transport'] = _NoopTransport
    kwargs.setdefault('dsn', 'https://examplePublicKey@o0.ingest.sentry.io/0')
    return _original_init(*args, **kwargs)

sentry_sdk.init = _patched_init

try:
    {config_code}
finally:
    sentry_sdk.init = _original_init
"""
                exec(wrapper_code, exec_globals, exec_locals)

                # Collect warnings
                for warning in w:
                    captured_warnings.append(str(warning.message))

            # Extract resolved options from the current client
            resolved_options = {}
            recognized_keys = []
            try:
                client = sentry_sdk.get_client()
                if client and hasattr(client, 'options'):
                    opts = client.options
                    if isinstance(opts, dict):
                        for k, v in opts.items():
                            try:
                                json.dumps(v)
                                resolved_options[k] = v
                            except (TypeError, ValueError):
                                resolved_options[k] = str(v)
                            recognized_keys.append(k)
                    elif hasattr(opts, '__dict__'):
                        for k, v in vars(opts).items():
                            if not k.startswith('_'):
                                try:
                                    json.dumps(v)
                                    resolved_options[k] = v
                                except (TypeError, ValueError):
                                    resolved_options[k] = str(v)
                                recognized_keys.append(k)
            except Exception:
                pass

            # Clean up - close the client
            try:
                client = sentry_sdk.get_client()
                if client:
                    client.close()
            except Exception:
                pass

            return jsonify({
                'success': True,
                'sdk': 'python',
                'sdkVersion': sdk_version,
                'initSucceeded': True,
                'warnings': captured_warnings,
                'resolvedOptions': resolved_options,
                'recognizedKeys': recognized_keys,
                'ignoredKeys': [],
            })

        except Exception as e:
            error_trace = traceback.format_exc()
            return jsonify({
                'success': True,
                'sdk': 'python',
                'sdkVersion': sdk_version,
                'initSucceeded': False,
                'error': str(e),
                'warnings': captured_warnings,
                'resolvedOptions': {},
                'recognizedKeys': [],
                'ignoredKeys': [],
            })

    except Exception as e:
        print(f'Validate-config error: {str(e)}', file=sys.stderr)
        return jsonify({
            'success': False,
            'error': f'Validation service error: {str(e)}'
        }), 500


@app.route('/introspect', methods=['GET'])
def introspect():
    """
    Introspect endpoint
    Uses reflection to discover available Sentry SDK configuration options.
    """
    try:
        import sentry_sdk

        sdk_version = _get_sdk_version()
        options = []

        # Method 1: Inspect sentry_sdk.init signature
        try:
            sig = inspect.signature(sentry_sdk.init)
            for name, param in sig.parameters.items():
                if name in ('args', 'kwargs', 'self'):
                    continue

                opt_type = 'any'
                if param.annotation != inspect.Parameter.empty:
                    opt_type = str(param.annotation).replace('typing.', '')

                default_val = None
                required = True
                if param.default != inspect.Parameter.empty:
                    default_val = param.default
                    required = False
                    # Try to serialize, fall back to str
                    try:
                        json.dumps(default_val)
                    except (TypeError, ValueError):
                        default_val = str(default_val)

                options.append({
                    'key': name,
                    'canonicalKey': _snaketo_camel(name),
                    'type': opt_type,
                    'required': required,
                    'default': default_val,
                    'description': '',
                })
        except Exception:
            pass

        # Method 2: Inspect Client class options for more comprehensive list
        try:
            from sentry_sdk.client import Client
            # Look at __init__ parameters
            sig = inspect.signature(Client.__init__)
            existing_keys = {o['key'] for o in options}
            for name, param in sig.parameters.items():
                if name in ('self', 'args', 'kwargs') or name in existing_keys:
                    continue

                opt_type = 'any'
                if param.annotation != inspect.Parameter.empty:
                    opt_type = str(param.annotation).replace('typing.', '')

                default_val = None
                required = True
                if param.default != inspect.Parameter.empty:
                    default_val = param.default
                    required = False
                    try:
                        json.dumps(default_val)
                    except (TypeError, ValueError):
                        default_val = str(default_val)

                options.append({
                    'key': name,
                    'canonicalKey': _snaketo_camel(name),
                    'type': opt_type,
                    'required': required,
                    'default': default_val,
                    'description': '',
                })
        except Exception:
            pass

        return jsonify({
            'sdk': 'python',
            'sdkVersion': sdk_version,
            'sdkPackage': 'sentry-sdk',
            'source': 'reflection',
            'options': options,
            'timestamp': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
        })

    except Exception as e:
        print(f'Introspect error: {str(e)}', file=sys.stderr)
        return jsonify({
            'success': False,
            'error': f'Introspection service error: {str(e)}'
        }), 500


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'sdk': 'python'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
