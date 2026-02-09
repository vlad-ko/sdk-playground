/**
 * Validate-Config Integration Tests
 *
 * These tests verify that the /validate-config endpoint on each SDK container
 * works correctly — proper response structure, warning capture, noop transport
 * (no real events sent), and resource cleanup.
 *
 * PREREQUISITES:
 * - All containers must be running: docker-compose up -d
 * - Wait for services to be healthy before running tests
 *
 * RUN:
 * - npm run test:integration
 */

import axios from 'axios';

const API_BASE = process.env.API_URL || 'http://localhost:4000';

jest.setTimeout(30000);

// Direct SDK container URLs for testing endpoints that bypass the API gateway
const SDK_CONTAINERS: Record<string, { port: number; initCode: string; invalidCode: string }> = {
  javascript: {
    port: 5000,
    initCode: `Sentry.init({ dsn: "https://examplePublicKey@o0.ingest.sentry.io/0" });`,
    invalidCode: `Sentry.init({ dsn: {{{ invalid }}}`,
  },
  python: {
    port: 5001,
    initCode: `sentry_sdk.init(dsn="https://examplePublicKey@o0.ingest.sentry.io/0")`,
    invalidCode: `sentry_sdk.init(dsn=`,
  },
  ruby: {
    port: 5004,
    initCode: `Sentry.init do |config|\n  config.dsn = "https://examplePublicKey@o0.ingest.sentry.io/0"\nend`,
    invalidCode: `Sentry.init do |config|\n  raise "test error"\nend`,
  },
  php: {
    port: 5005,
    initCode: `\\Sentry\\init(["dsn" => "https://examplePublicKey@o0.ingest.sentry.io/0"]);`,
    invalidCode: `\\Sentry\\init(["dsn" => {{{ invalid ]);`,
  },
  go: {
    port: 5006,
    initCode: `err := sentry.Init(sentry.ClientOptions{Dsn: "https://examplePublicKey@o0.ingest.sentry.io/0"})\nif err != nil { panic(err) }`,
    invalidCode: `sentry.Init({{{ invalid`,
  },
  dotnet: {
    port: 5002,
    initCode: `SentrySdk.Init(o => { o.Dsn = "https://examplePublicKey@o0.ingest.sentry.io/0"; });`,
    invalidCode: `SentrySdk.Init(o => { o.Dsn = {{{ invalid; });`,
  },
  java: {
    port: 5007,
    initCode: `io.sentry.Sentry.init(options -> { options.setDsn("https://examplePublicKey@o0.ingest.sentry.io/0"); })`,
    invalidCode: `io.sentry.Sentry.init({{{ invalid`,
  },
  android: {
    port: 5008,
    initCode: `io.sentry.Sentry.init { options -> options.dsn = "https://examplePublicKey@o0.ingest.sentry.io/0" }`,
    invalidCode: `io.sentry.Sentry.init {{{ invalid`,
  },
  cocoa: {
    port: 5009,
    initCode: `SentrySDK.start { options in options.dsn = "https://examplePublicKey@o0.ingest.sentry.io/0" }`,
    invalidCode: `SentrySDK.start {{{ invalid`,
  },
  rust: {
    port: 5010,
    initCode: `let _guard = sentry::init(("https://examplePublicKey@o0.ingest.sentry.io/0", sentry::ClientOptions { release: Some("test@1.0".into()), ..Default::default() }));`,
    invalidCode: `let _guard = sentry::init({{{ invalid`,
  },
  elixir: {
    port: 5011,
    initCode: `:ok`,
    invalidCode: `raise "test error"`,
  },
};

// Helper: call /validate-config directly on SDK container
async function validateConfig(sdk: string, configCode: string) {
  const port = SDK_CONTAINERS[sdk].port;
  try {
    const response = await axios.post(
      `http://localhost:${port}/validate-config`,
      { configCode },
      { timeout: 15000 }
    );
    return response.data;
  } catch (error: any) {
    if (error.response) {
      return error.response.data;
    }
    throw error;
  }
}

// Helper: call /validate-config via API gateway
async function validateConfigViaGateway(sdk: string, configCode: string) {
  try {
    const response = await axios.post(
      `${API_BASE}/api/config/validate-live`,
      { sdk, configCode },
      { timeout: 15000 }
    );
    return response.data;
  } catch (error: any) {
    if (error.response) {
      return error.response.data;
    }
    throw error;
  }
}

// Helper: check if SDK container is reachable
async function isContainerUp(port: number): Promise<boolean> {
  try {
    await axios.get(`http://localhost:${port}/health`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Helper: check if /validate-config endpoint exists on SDK container
async function hasValidateConfigEndpoint(port: number): Promise<boolean> {
  try {
    // Send a request with empty body — we expect 400 (missing field) not 404
    const response = await axios.post(
      `http://localhost:${port}/validate-config`,
      {},
      { timeout: 5000, validateStatus: () => true }
    );
    return response.status !== 404;
  } catch {
    return false;
  }
}

describe('Validate-Config Integration Tests', () => {
  describe('Response Structure', () => {
    Object.entries(SDK_CONTAINERS).forEach(([sdk, config]) => {
      it(`${sdk}: should return correct response fields for valid config`, async () => {
        if (!(await isContainerUp(config.port))) {
          console.warn(`⚠️  ${sdk} SDK not running on port ${config.port}, skipping`);
          return;
        }
        if (!(await hasValidateConfigEndpoint(config.port))) {
          console.warn(`⚠️  ${sdk} SDK does not have /validate-config endpoint, skipping`);
          return;
        }

        const result = await validateConfig(sdk, config.initCode);

        // Every SDK must return these fields
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('sdk', sdk);
        expect(result).toHaveProperty('sdkVersion');
        expect(result).toHaveProperty('initSucceeded');
        expect(result).toHaveProperty('warnings');
        expect(Array.isArray(result.warnings)).toBe(true);
        expect(result).toHaveProperty('resolvedOptions');
        expect(result).toHaveProperty('recognizedKeys');
        expect(result).toHaveProperty('ignoredKeys');
      });
    });
  });

  describe('Error Handling: Invalid Config', () => {
    Object.entries(SDK_CONTAINERS).forEach(([sdk, config]) => {
      it(`${sdk}: should handle invalid config code gracefully`, async () => {
        if (!(await isContainerUp(config.port))) {
          console.warn(`⚠️  ${sdk} SDK not running on port ${config.port}, skipping`);
          return;
        }
        if (!(await hasValidateConfigEndpoint(config.port))) {
          console.warn(`⚠️  ${sdk} SDK does not have /validate-config endpoint, skipping`);
          return;
        }

        const result = await validateConfig(sdk, config.invalidCode);

        // Should NOT crash — must return a structured response
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('sdk', sdk);
        // initSucceeded should be false for bad code
        expect(result.initSucceeded).toBe(false);
        // Should have an error message
        expect(result.error).toBeTruthy();
      });
    });
  });

  describe('Warning Capture', () => {
    // These tests verify that warnings emitted during Sentry.init() are
    // actually captured and returned in the warnings array.
    // This was a bug in Ruby, PHP, .NET, and Java — the warnings collection
    // was declared but never wired up to capture anything.

    it('python: should capture deprecation warnings from SDK', async () => {
      if (!(await isContainerUp(SDK_CONTAINERS.python.port))) {
        console.warn('⚠️  Python SDK not running, skipping');
        return;
      }

      // Python's warnings module captures warnings during init
      // Using a config that triggers a deprecation warning
      const code = `
import warnings
warnings.warn("test deprecation warning", DeprecationWarning)
sentry_sdk.init(dsn="https://examplePublicKey@o0.ingest.sentry.io/0")
`;
      const result = await validateConfig('python', code);

      expect(result.success).toBe(true);
      expect(result.initSucceeded).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w: string) => w.includes('test deprecation warning'))).toBe(true);
    });

    it('javascript: should capture console.warn during init', async () => {
      if (!(await isContainerUp(SDK_CONTAINERS.javascript.port))) {
        console.warn('⚠️  JavaScript SDK not running, skipping');
        return;
      }

      // JavaScript captures console.warn calls
      const code = `
console.warn("test warning from init");
Sentry.init({ dsn: "https://examplePublicKey@o0.ingest.sentry.io/0" });
`;
      const result = await validateConfig('javascript', code);

      expect(result.success).toBe(true);
      expect(result.initSucceeded).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w: string) => w.includes('test warning from init'))).toBe(true);
    });

    it('ruby: should capture Kernel.warn during init', async () => {
      if (!(await isContainerUp(SDK_CONTAINERS.ruby.port))) {
        console.warn('⚠️  Ruby SDK not running, skipping');
        return;
      }

      // Ruby captures Kernel.warn calls
      const code = `
warn "test ruby warning"
Sentry.init do |config|
  config.dsn = "https://examplePublicKey@o0.ingest.sentry.io/0"
end
`;
      const result = await validateConfig('ruby', code);

      expect(result.success).toBe(true);
      expect(result.initSucceeded).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w: string) => w.includes('test ruby warning'))).toBe(true);
    });

    it('php: should capture PHP warnings during init', async () => {
      if (!(await isContainerUp(SDK_CONTAINERS.php.port))) {
        console.warn('⚠️  PHP SDK not running, skipping');
        return;
      }

      // PHP captures E_WARNING/E_NOTICE/E_DEPRECATED via set_error_handler
      const code = `
trigger_error("test php warning", E_USER_WARNING);
\\Sentry\\init(["dsn" => "https://examplePublicKey@o0.ingest.sentry.io/0"]);
`;
      const result = await validateConfig('php', code);

      expect(result.success).toBe(true);
      expect(result.initSucceeded).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w: string) => w.includes('test php warning'))).toBe(true);
    });
  });

  describe('Resource Cleanup: No Leaks on Repeated Calls', () => {
    // These tests verify that calling /validate-config multiple times in
    // succession doesn't cause resource exhaustion (leaked threads, unclosed
    // clients). This was a bug in Python (missing client.close() in error path)
    // and Java/Android (no Sentry.close() at all).

    const SDKS_TO_TEST = ['python', 'javascript', 'ruby', 'java'];

    SDKS_TO_TEST.forEach((sdk) => {
      it(`${sdk}: should handle 5 sequential validate-config calls without failure`, async () => {
        const config = SDK_CONTAINERS[sdk];
        if (!(await isContainerUp(config.port))) {
          console.warn(`⚠️  ${sdk} SDK not running on port ${config.port}, skipping`);
          return;
        }

        // Call validate-config 5 times in sequence — if resources leak,
        // later calls may fail or timeout
        for (let i = 0; i < 5; i++) {
          const result = await validateConfig(sdk, config.initCode);
          expect(result.success).toBe(true);
          expect(result.sdk).toBe(sdk);
        }
      });
    });

    SDKS_TO_TEST.forEach((sdk) => {
      it(`${sdk}: should handle 5 sequential error calls without failure`, async () => {
        const config = SDK_CONTAINERS[sdk];
        if (!(await isContainerUp(config.port))) {
          console.warn(`⚠️  ${sdk} SDK not running on port ${config.port}, skipping`);
          return;
        }

        // Error path is where client.close() was missing in Python
        for (let i = 0; i < 5; i++) {
          const result = await validateConfig(sdk, config.invalidCode);
          expect(result).toHaveProperty('success');
          expect(result).toHaveProperty('sdk', sdk);
        }
      });
    });
  });

  describe('API Gateway: validate-live Endpoint', () => {
    it('should proxy validate-config through the API gateway', async () => {
      const result = await validateConfigViaGateway(
        'javascript',
        'Sentry.init({ dsn: "https://examplePublicKey@o0.ingest.sentry.io/0" });'
      );

      // Gateway wraps in { success, data }
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('sdk', 'javascript');
      expect(result.data).toHaveProperty('initSucceeded');
    });

    it('should return 400 for missing configCode', async () => {
      const result = await validateConfigViaGateway('python', '');

      // Gateway returns error for missing fields
      expect(result.error).toBeTruthy();
    });

    it('should return 400 for missing sdk', async () => {
      try {
        const response = await axios.post(
          `${API_BASE}/api/config/validate-live`,
          { configCode: 'test' },
          { timeout: 15000 }
        );
        expect(response.data.error).toBeTruthy();
      } catch (error: any) {
        expect(error.response.status).toBe(400);
      }
    });
  });

  describe('Noop Transport: No Events Sent', () => {
    // These tests verify that validate-config uses a noop transport (or
    // equivalent safety mechanism) so that no real events are sent to Sentry.
    // We test this by using a DSN that would fail if actually contacted,
    // and verifying the validation still succeeds.

    const INTERPRETED_SDKS = ['python', 'javascript', 'ruby', 'php'];

    INTERPRETED_SDKS.forEach((sdk) => {
      it(`${sdk}: should succeed with fake DSN (no real transport)`, async () => {
        const config = SDK_CONTAINERS[sdk];
        if (!(await isContainerUp(config.port))) {
          console.warn(`⚠️  ${sdk} SDK not running on port ${config.port}, skipping`);
          return;
        }

        // Use the standard init code which uses a fake DSN
        // If the transport were real, it would try to POST to o0.ingest.sentry.io
        // and either timeout or fail — but validation should succeed instantly
        const result = await validateConfig(sdk, config.initCode);

        expect(result.success).toBe(true);
        expect(result.initSucceeded).toBe(true);
      });
    });
  });
});
