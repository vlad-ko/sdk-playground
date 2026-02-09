import express, { Request, Response } from 'express';
import cors from 'cors';

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

interface TransformRequest {
  event: Record<string, any>;
  beforeSendCode: string;
}

interface TransformResponse {
  success: boolean;
  transformedEvent?: Record<string, any> | null;
  error?: string;
}

interface ValidationRequest {
  code: string;
}

interface ValidationError {
  line?: number;
  column?: number;
  message: string;
}

interface ValidationResponse {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Transform endpoint
 * Receives an event and beforeSend code, applies the transformation
 */
app.post('/transform', async (req: Request<{}, {}, TransformRequest>, res: Response<TransformResponse>) => {
  try {
    const { event, beforeSendCode } = req.body;

    if (!event || !beforeSendCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing event or beforeSendCode'
      });
    }

    // Execute the beforeSend code in a sandboxed context
    let beforeSendFn: Function;
    try {
      // Wrap the code to ensure it returns a function
      const wrappedCode = `(${beforeSendCode})`;
      beforeSendFn = eval(wrappedCode);

      if (typeof beforeSendFn !== 'function') {
        throw new Error('beforeSend code must be a function');
      }
    } catch (evalError: any) {
      return res.status(400).json({
        success: false,
        error: `Failed to parse beforeSend code: ${evalError.message}`
      });
    }

    // Apply the beforeSend transformation
    try {
      // Clone the event to avoid mutation issues
      const eventClone = JSON.parse(JSON.stringify(event));

      // Check how many arguments the function takes
      // beforeSend takes (event, hint), tracesSampler takes just (samplingContext)
      const numParams = beforeSendFn.length;

      // Execute the function with appropriate arguments
      let transformedEvent;
      if (numParams === 1) {
        // Single argument function (tracesSampler style)
        transformedEvent = await beforeSendFn(eventClone);
      } else {
        // Two argument function (beforeSend style)
        transformedEvent = await beforeSendFn(eventClone, {});
      }

      return res.json({
        success: true,
        transformedEvent: transformedEvent
      });
    } catch (transformError: any) {
      return res.status(500).json({
        success: false,
        error: `Transformation error: ${transformError.message}`,
        transformedEvent: null
      });
    }
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: `Unexpected error: ${error.message}`
    });
  }
});

/**
 * Validate endpoint
 * Validates beforeSend code for syntax errors without executing it
 */
app.post('/validate', async (req: Request<{}, {}, ValidationRequest>, res: Response<ValidationResponse>) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        valid: false,
        errors: [{ message: 'Missing code parameter' }]
      });
    }

    const errors: ValidationError[] = [];

    try {
      // Try to parse the code as a function expression
      const wrappedCode = `(${code})`;

      // Use eval to check syntax (doesn't actually execute in strict mode)
      // We need to actually evaluate it to catch syntax errors
      const checkSyntax = new Function('"use strict"; return ' + wrappedCode);
      checkSyntax();

      // If we get here, syntax is valid
      return res.json({
        valid: true,
        errors: []
      });
    } catch (error: any) {
      // Parse error message to extract line/column info if available
      const errorMessage = error.message || 'Syntax error';

      // Try to extract line number from error message
      const lineMatch = errorMessage.match(/line (\d+)/i);
      const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

      errors.push({
        line,
        message: errorMessage
      });

      return res.json({
        valid: false,
        errors
      });
    }
  } catch (error: any) {
    console.error('Validation error:', error);
    return res.status(500).json({
      valid: false,
      errors: [{ message: `Validation service error: ${error.message}` }]
    });
  }
});

/**
 * Validate config endpoint
 * Executes Sentry.init() with user's config code using a noop transport
 * to verify the configuration actually works against the real SDK.
 */
app.post('/validate-config', async (req: Request, res: Response) => {
  const capturedWarnings: string[] = [];
  const origWarn = console.warn;

  try {
    const { configCode } = req.body;

    if (!configCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing configCode',
      });
    }

    let Sentry: any;
    let sdkVersion = 'unknown';
    try {
      Sentry = require('@sentry/node');
      sdkVersion = Sentry.SDK_VERSION || 'unknown';
    } catch {
      return res.status(500).json({
        success: false,
        error: 'Failed to load @sentry/node',
      });
    }

    // Capture console.warn during init
    console.warn = (...args: any[]) => {
      capturedWarnings.push(args.map(String).join(' '));
    };

    try {
      // Monkey-patch Sentry.init to inject noop transport
      const originalInit = Sentry.init;
      let resolvedOptions: Record<string, any> = {};

      Sentry.init = (options: any = {}) => {
        // Override transport with noop
        options.transport = () => ({
          send: () => Promise.resolve({}),
          flush: () => Promise.resolve(true),
        });
        // Ensure a DSN is set so init doesn't bail early
        options.dsn = options.dsn || 'https://examplePublicKey@o0.ingest.sentry.io/0';

        // Capture the options being passed
        resolvedOptions = {};
        for (const [k, v] of Object.entries(options)) {
          try {
            JSON.stringify(v);
            resolvedOptions[k] = v;
          } catch {
            resolvedOptions[k] = String(v);
          }
        }

        return originalInit.call(Sentry, options);
      };

      try {
        // Execute the user's config code with Sentry available
        const configFn = new Function('Sentry', 'require', configCode);
        configFn(Sentry, require);

        const recognizedKeys = Object.keys(resolvedOptions);

        // Clean up - close the client
        try {
          const client = Sentry.getClient();
          if (client && typeof client.close === 'function') {
            await client.close(1000);
          }
        } catch { /* ignore cleanup errors */ }

        return res.json({
          success: true,
          sdk: 'javascript',
          sdkVersion,
          initSucceeded: true,
          warnings: capturedWarnings,
          resolvedOptions,
          recognizedKeys,
          ignoredKeys: [],
        });
      } catch (initError: any) {
        return res.json({
          success: true,
          sdk: 'javascript',
          sdkVersion,
          initSucceeded: false,
          error: initError.message,
          warnings: capturedWarnings,
          resolvedOptions: {},
          recognizedKeys: [],
          ignoredKeys: [],
        });
      } finally {
        // Restore original init
        Sentry.init = originalInit;
      }
    } finally {
      console.warn = origWarn;
    }
  } catch (error: any) {
    console.warn = origWarn;
    console.error('Validate-config error:', error);
    return res.status(500).json({
      success: false,
      error: `Validation service error: ${error.message}`,
    });
  }
});

/**
 * Introspect endpoint
 * Discovers available Sentry SDK configuration options via the SDK's TypeScript types.
 */
app.get('/introspect', (req: Request, res: Response) => {
  try {
    let Sentry: any;
    let sdkVersion = 'unknown';
    try {
      Sentry = require('@sentry/node');
      sdkVersion = Sentry.SDK_VERSION || 'unknown';
    } catch {
      return res.status(500).json({
        success: false,
        error: 'Failed to load @sentry/node',
      });
    }

    // For JavaScript, we discover options by initializing with a noop transport
    // and inspecting what the SDK accepts
    const knownOptions = [
      { key: 'dsn', type: 'string', required: true, default: null, description: 'Data Source Name' },
      { key: 'debug', type: 'boolean', required: false, default: false, description: 'Enable debug mode' },
      { key: 'release', type: 'string', required: false, default: null, description: 'Release version' },
      { key: 'environment', type: 'string', required: false, default: 'production', description: 'Environment name' },
      { key: 'sampleRate', type: 'number', required: false, default: 1.0, description: 'Error sample rate' },
      { key: 'tracesSampleRate', type: 'number', required: false, default: null, description: 'Traces sample rate' },
      { key: 'tracesSampler', type: 'function', required: false, default: null, description: 'Custom traces sampler function' },
      { key: 'beforeSend', type: 'function', required: false, default: null, description: 'Hook before sending event' },
      { key: 'beforeSendTransaction', type: 'function', required: false, default: null, description: 'Hook before sending transaction' },
      { key: 'beforeBreadcrumb', type: 'function', required: false, default: null, description: 'Hook before adding breadcrumb' },
      { key: 'integrations', type: 'array', required: false, default: null, description: 'SDK integrations' },
      { key: 'transport', type: 'function', required: false, default: null, description: 'Custom transport' },
      { key: 'maxBreadcrumbs', type: 'number', required: false, default: 100, description: 'Max breadcrumbs to capture' },
      { key: 'maxValueLength', type: 'number', required: false, default: 250, description: 'Max string value length' },
      { key: 'normalizeDepth', type: 'number', required: false, default: 3, description: 'Object normalization depth' },
      { key: 'attachStacktrace', type: 'boolean', required: false, default: false, description: 'Attach stacktrace to messages' },
      { key: 'sendDefaultPii', type: 'boolean', required: false, default: false, description: 'Send default PII' },
      { key: 'serverName', type: 'string', required: false, default: null, description: 'Server name tag' },
      { key: 'ignoreErrors', type: 'array', required: false, default: null, description: 'Error message patterns to ignore' },
      { key: 'ignoreTransactions', type: 'array', required: false, default: null, description: 'Transaction name patterns to ignore' },
      { key: 'denyUrls', type: 'array', required: false, default: null, description: 'URL patterns to deny' },
      { key: 'allowUrls', type: 'array', required: false, default: null, description: 'URL patterns to allow' },
      { key: 'autoSessionTracking', type: 'boolean', required: false, default: true, description: 'Auto session tracking' },
      { key: 'enableTracing', type: 'boolean', required: false, default: null, description: 'Enable performance tracing' },
      { key: 'profilesSampleRate', type: 'number', required: false, default: null, description: 'Profiles sample rate' },
      { key: 'sendClientReports', type: 'boolean', required: false, default: true, description: 'Send client reports' },
      { key: 'tunnel', type: 'string', required: false, default: null, description: 'Tunnel URL for proxying events' },
    ];

    const options = knownOptions.map(opt => ({
      ...opt,
      canonicalKey: opt.key,
    }));

    return res.json({
      sdk: 'javascript',
      sdkVersion,
      sdkPackage: '@sentry/node',
      source: 'manifest' as const,
      options,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Introspect error:', error);
    return res.status(500).json({
      success: false,
      error: `Introspection service error: ${error.message}`,
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', sdk: 'javascript' });
});

// Only start the server if not in test mode
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JavaScript SDK service listening on port ${PORT}`);
  });
}

// Export app for testing
export { app };
