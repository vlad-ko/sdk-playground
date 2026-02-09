/**
 * Tests for Configuration Analyzer
 *
 * These tests verify that the analyzer correctly handles both
 * JavaScript camelCase and Python snake_case option names,
 * and uses introspection as fallback for unknown options.
 */

import { ConfigAnalyzer, IntrospectFn } from '../../src/config-analyzer/analyzer';
import { PythonConfigParser } from '../../src/config-parsers/python';
import { JavaScriptConfigParser } from '../../src/config-parsers/javascript';
import { CocoaConfigParser } from '../../src/config-parsers/cocoa';
import { DotNetConfigParser } from '../../src/config-parsers/dotnet';
import { GoConfigParser } from '../../src/config-parsers/go';
import { IntrospectionResponse } from '../../src/sdk-introspection/types';

describe('ConfigAnalyzer', () => {
  describe('Python snake_case key normalization', () => {
    let analyzer: ConfigAnalyzer;

    beforeEach(() => {
      analyzer = new ConfigAnalyzer(new PythonConfigParser());
    });

    it('should recognize traces_sample_rate as tracesSampleRate', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    traces_sample_rate=0.1
)`;

      const result = await analyzer.analyze(config, 'python');

      const traceOption = result.options.find(o => o.key === 'traces_sample_rate');
      expect(traceOption).toBeDefined();
      expect(traceOption?.recognized).toBe(true);
      expect(traceOption?.displayName).toBe('Traces Sample Rate');
    });

    it('should recognize send_default_pii as sendDefaultPii', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    send_default_pii=True
)`;

      const result = await analyzer.analyze(config, 'python');

      const piiOption = result.options.find(o => o.key === 'send_default_pii');
      expect(piiOption).toBeDefined();
      expect(piiOption?.recognized).toBe(true);
    });

    it('should validate traces_sample_rate value', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    traces_sample_rate=1.0
)`;

      const result = await analyzer.analyze(config, 'python');

      // Should have a warning about 100% sampling
      const samplingWarning = result.warnings.find(
        w => w.message.includes('100% transaction sampling')
      );
      expect(samplingWarning).toBeDefined();
    });

    it('should validate invalid sample rate values', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    traces_sample_rate=1.5
)`;

      const result = await analyzer.analyze(config, 'python');

      // Should have an error about invalid range
      const rangeError = result.warnings.find(
        w => w.severity === 'error' && w.message.includes('between 0.0 and 1.0')
      );
      expect(rangeError).toBeDefined();
    });

    it('should warn about send_default_pii=True', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    send_default_pii=True
)`;

      const result = await analyzer.analyze(config, 'python');

      const piiWarning = result.warnings.find(
        w => w.message.includes('PII') || w.message.includes('privacy')
      );
      expect(piiWarning).toBeDefined();
    });

    it('should warn about debug=True', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    debug=True
)`;

      const result = await analyzer.analyze(config, 'python');

      const debugWarning = result.warnings.find(
        w => w.message.includes('Debug mode')
      );
      expect(debugWarning).toBeDefined();
    });

    it('should not recommend tracesSampleRate if traces_sample_rate is set', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    environment="production",
    release="1.0.0",
    traces_sample_rate=0.1
)`;

      const result = await analyzer.analyze(config, 'python');

      const tracesRec = result.recommendations.find(
        r => r.optionKey === 'tracesSampleRate'
      );
      expect(tracesRec).toBeUndefined();
    });

    it('should not recommend environment if it is already set (snake_case)', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    environment="production"
)`;

      const result = await analyzer.analyze(config, 'python');

      const envRec = result.recommendations.find(
        r => r.optionKey === 'environment'
      );
      expect(envRec).toBeUndefined();
    });

    it('should recognize before_send as beforeSend', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    before_send=lambda event, hint: event
)`;

      const result = await analyzer.analyze(config, 'python');

      const beforeSendOption = result.options.find(o => o.key === 'before_send');
      expect(beforeSendOption).toBeDefined();
      expect(beforeSendOption?.recognized).toBe(true);
    });

    it('should give bonus score for snake_case options', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    environment="production",
    release="1.0.0",
    before_send=lambda event, hint: event
)`;

      const result = await analyzer.analyze(config, 'python');

      // Should get bonus points for having environment, release, and beforeSend
      expect(result.score).toBeGreaterThan(50);
    });

    it('should recognize profiles_sample_rate as profilesSampleRate', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    profiles_sample_rate=0.1
)`;

      const result = await analyzer.analyze(config, 'python');

      const profilesOption = result.options.find(o => o.key === 'profiles_sample_rate');
      expect(profilesOption).toBeDefined();
      expect(profilesOption?.recognized).toBe(true);
    });

    it('should recognize max_breadcrumbs as maxBreadcrumbs', async () => {
      const config = `sentry_sdk.init(
    dsn="https://test@o0.ingest.sentry.io/0",
    max_breadcrumbs=50
)`;

      const result = await analyzer.analyze(config, 'python');

      const breadcrumbsOption = result.options.find(o => o.key === 'max_breadcrumbs');
      expect(breadcrumbsOption).toBeDefined();
      expect(breadcrumbsOption?.recognized).toBe(true);
    });
  });

  describe('JavaScript camelCase keys', () => {
    let analyzer: ConfigAnalyzer;

    beforeEach(() => {
      analyzer = new ConfigAnalyzer(new JavaScriptConfigParser());
    });

    it('should recognize camelCase options', async () => {
      const config = `Sentry.init({
  dsn: "https://test@o0.ingest.sentry.io/0",
  tracesSampleRate: 0.1
});`;

      const result = await analyzer.analyze(config, 'javascript');

      const traceOption = result.options.find(o => o.key === 'tracesSampleRate');
      expect(traceOption).toBeDefined();
      expect(traceOption?.recognized).toBe(true);
    });

    it('should validate camelCase sample rate', async () => {
      const config = `Sentry.init({
  dsn: "https://test@o0.ingest.sentry.io/0",
  tracesSampleRate: 1.0
});`;

      const result = await analyzer.analyze(config, 'javascript');

      const samplingWarning = result.warnings.find(
        w => w.message.includes('100% transaction sampling')
      );
      expect(samplingWarning).toBeDefined();
    });
  });

  describe('Cocoa SDK options', () => {
    let analyzer: ConfigAnalyzer;

    beforeEach(() => {
      analyzer = new ConfigAnalyzer(new CocoaConfigParser());
    });

    it('should recognize releaseName option', async () => {
      const config = `SentrySDK.start { options in
    options.dsn = "https://test@o0.ingest.sentry.io/0"
    options.releaseName = "my-app@1.0.0"
}`;

      const result = await analyzer.analyze(config, 'cocoa');

      const releaseOption = result.options.find(o => o.key === 'releaseName');
      expect(releaseOption).toBeDefined();
      expect(releaseOption?.recognized).toBe(true);
    });

    it('should recognize enableAutoSessionTracking option', async () => {
      const config = `SentrySDK.start { options in
    options.dsn = "https://test@o0.ingest.sentry.io/0"
    options.enableAutoSessionTracking = true
}`;

      const result = await analyzer.analyze(config, 'cocoa');

      const sessionOption = result.options.find(o => o.key === 'enableAutoSessionTracking');
      expect(sessionOption).toBeDefined();
      expect(sessionOption?.recognized).toBe(true);
    });

    it('should recognize enableUIViewControllerTracing option', async () => {
      const config = `SentrySDK.start { options in
    options.dsn = "https://test@o0.ingest.sentry.io/0"
    options.enableUIViewControllerTracing = true
}`;

      const result = await analyzer.analyze(config, 'cocoa');

      const tracingOption = result.options.find(o => o.key === 'enableUIViewControllerTracing');
      expect(tracingOption).toBeDefined();
      expect(tracingOption?.recognized).toBe(true);
    });

    it('should recognize enableSwizzling option', async () => {
      const config = `SentrySDK.start { options in
    options.dsn = "https://test@o0.ingest.sentry.io/0"
    options.enableSwizzling = true
}`;

      const result = await analyzer.analyze(config, 'cocoa');

      const swizzlingOption = result.options.find(o => o.key === 'enableSwizzling');
      expect(swizzlingOption).toBeDefined();
      expect(swizzlingOption?.recognized).toBe(true);
    });

    it('should recognize enableNetworkBreadcrumbs option', async () => {
      const config = `SentrySDK.start { options in
    options.dsn = "https://test@o0.ingest.sentry.io/0"
    options.enableNetworkBreadcrumbs = true
}`;

      const result = await analyzer.analyze(config, 'cocoa');

      const breadcrumbsOption = result.options.find(o => o.key === 'enableNetworkBreadcrumbs');
      expect(breadcrumbsOption).toBeDefined();
      expect(breadcrumbsOption?.recognized).toBe(true);
    });

    it('should recognize enableCaptureFailedRequests option', async () => {
      const config = `SentrySDK.start { options in
    options.dsn = "https://test@o0.ingest.sentry.io/0"
    options.enableCaptureFailedRequests = true
}`;

      const result = await analyzer.analyze(config, 'cocoa');

      const failedReqOption = result.options.find(o => o.key === 'enableCaptureFailedRequests');
      expect(failedReqOption).toBeDefined();
      expect(failedReqOption?.recognized).toBe(true);
    });

    it('should give high score for well-configured Cocoa app', async () => {
      const config = `SentrySDK.start { options in
    options.dsn = "https://test@o0.ingest.sentry.io/0"
    options.environment = "production"
    options.releaseName = "my-app@1.0.0"
    options.tracesSampleRate = 0.1
    options.enableAutoSessionTracking = true
}`;

      const result = await analyzer.analyze(config, 'cocoa');

      // Should have no unknown option warnings
      const unknownWarnings = result.warnings.filter(
        w => w.message.includes('Unknown option')
      );
      expect(unknownWarnings.length).toBe(0);
      expect(result.score).toBeGreaterThanOrEqual(70);
    });
  });

  describe('.NET PascalCase key normalization', () => {
    let analyzer: ConfigAnalyzer;

    beforeEach(() => {
      analyzer = new ConfigAnalyzer(new DotNetConfigParser());
    });

    it('should recognize Dsn as dsn', async () => {
      const config = `SentrySdk.Init(o => {
    o.Dsn = "https://test@o0.ingest.sentry.io/0";
});`;

      const result = await analyzer.analyze(config, 'dotnet');

      const dsnOption = result.options.find(o => o.key === 'Dsn');
      expect(dsnOption).toBeDefined();
      expect(dsnOption?.recognized).toBe(true);
    });

    it('should recognize TracesSampleRate as tracesSampleRate', async () => {
      const config = `SentrySdk.Init(o => {
    o.Dsn = "https://test@o0.ingest.sentry.io/0";
    o.TracesSampleRate = 0.1;
});`;

      const result = await analyzer.analyze(config, 'dotnet');

      const traceOption = result.options.find(o => o.key === 'TracesSampleRate');
      expect(traceOption).toBeDefined();
      expect(traceOption?.recognized).toBe(true);
      expect(traceOption?.displayName).toBe('Traces Sample Rate');
    });

    it('should recognize Debug as debug', async () => {
      const config = `SentrySdk.Init(o => {
    o.Dsn = "https://test@o0.ingest.sentry.io/0";
    o.Debug = true;
});`;

      const result = await analyzer.analyze(config, 'dotnet');

      const debugOption = result.options.find(o => o.key === 'Debug');
      expect(debugOption).toBeDefined();
      expect(debugOption?.recognized).toBe(true);
    });

    it('should recognize SendDefaultPii as sendDefaultPii', async () => {
      const config = `SentrySdk.Init(o => {
    o.Dsn = "https://test@o0.ingest.sentry.io/0";
    o.SendDefaultPii = true;
});`;

      const result = await analyzer.analyze(config, 'dotnet');

      const piiOption = result.options.find(o => o.key === 'SendDefaultPii');
      expect(piiOption).toBeDefined();
      expect(piiOption?.recognized).toBe(true);
    });

    it('should validate TracesSampleRate value', async () => {
      const config = `SentrySdk.Init(o => {
    o.Dsn = "https://test@o0.ingest.sentry.io/0";
    o.TracesSampleRate = 1.0;
});`;

      const result = await analyzer.analyze(config, 'dotnet');

      // Should have a warning about 100% sampling
      const samplingWarning = result.warnings.find(
        w => w.message.includes('100% transaction sampling')
      );
      expect(samplingWarning).toBeDefined();
    });

    it('should warn about Debug = true', async () => {
      const config = `SentrySdk.Init(o => {
    o.Dsn = "https://test@o0.ingest.sentry.io/0";
    o.Debug = true;
});`;

      const result = await analyzer.analyze(config, 'dotnet');

      const debugWarning = result.warnings.find(
        w => w.message.includes('Debug mode')
      );
      expect(debugWarning).toBeDefined();
    });

    it('should give high score for well-configured .NET app', async () => {
      const config = `SentrySdk.Init(o => {
    o.Dsn = "https://test@o0.ingest.sentry.io/0";
    o.Environment = "production";
    o.Release = "1.0.0";
    o.TracesSampleRate = 0.1;
});`;

      const result = await analyzer.analyze(config, 'dotnet');

      // Should have no unknown option warnings
      const unknownWarnings = result.warnings.filter(
        w => w.message.includes('Unknown option')
      );
      expect(unknownWarnings.length).toBe(0);
      expect(result.score).toBeGreaterThanOrEqual(70);
    });
  });

  describe('Go PascalCase key normalization', () => {
    let analyzer: ConfigAnalyzer;

    beforeEach(() => {
      analyzer = new ConfigAnalyzer(new GoConfigParser());
    });

    it('should recognize Dsn as dsn', async () => {
      const config = `sentry.Init(sentry.ClientOptions{
    Dsn: "https://test@o0.ingest.sentry.io/0",
})`;

      const result = await analyzer.analyze(config, 'go');

      const dsnOption = result.options.find(o => o.key === 'Dsn');
      expect(dsnOption).toBeDefined();
      expect(dsnOption?.recognized).toBe(true);
    });

    it('should recognize TracesSampleRate as tracesSampleRate', async () => {
      const config = `sentry.Init(sentry.ClientOptions{
    Dsn: "https://test@o0.ingest.sentry.io/0",
    TracesSampleRate: 0.1,
})`;

      const result = await analyzer.analyze(config, 'go');

      const traceOption = result.options.find(o => o.key === 'TracesSampleRate');
      expect(traceOption).toBeDefined();
      expect(traceOption?.recognized).toBe(true);
    });

    it('should give high score for well-configured Go app', async () => {
      const config = `sentry.Init(sentry.ClientOptions{
    Dsn: "https://test@o0.ingest.sentry.io/0",
    Environment: "production",
    Release: "1.0.0",
    TracesSampleRate: 0.1,
})`;

      const result = await analyzer.analyze(config, 'go');

      // Should have no unknown option warnings
      const unknownWarnings = result.warnings.filter(
        w => w.message.includes('Unknown option')
      );
      expect(unknownWarnings.length).toBe(0);
      expect(result.score).toBeGreaterThanOrEqual(70);
    });
  });

  describe('Introspection-first fallback', () => {
    let analyzer: ConfigAnalyzer;

    beforeEach(() => {
      analyzer = new ConfigAnalyzer(new JavaScriptConfigParser());
    });

    const mockIntrospection: IntrospectionResponse = {
      sdk: 'javascript',
      sdkVersion: '8.0.0',
      sdkPackage: '@sentry/browser',
      source: 'reflection',
      options: [
        { key: 'dsn', canonicalKey: 'dsn', type: 'string', required: true, default: null, description: 'Data Source Name' },
        { key: 'customNewOption', canonicalKey: 'customNewOption', type: 'string', required: false, default: null, description: 'A new SDK option' },
        { key: 'anotherNewOption', canonicalKey: 'anotherNewOption', type: 'boolean', required: false, default: false, description: 'Another new option' },
      ],
      timestamp: '2024-01-01T00:00:00Z',
    };

    it('should resolve unknown option via introspection', async () => {
      const mockIntrospect: IntrospectFn = jest.fn().mockResolvedValue(mockIntrospection);

      const config = `Sentry.init({
  dsn: "https://test@o0.ingest.sentry.io/0",
  customNewOption: "hello"
});`;

      const result = await analyzer.analyze(config, 'javascript', mockIntrospect);

      const customOpt = result.options.find(o => o.key === 'customNewOption');
      expect(customOpt).toBeDefined();
      expect(customOpt?.recognized).toBe(true);
      expect(customOpt?.source).toBe('introspection');
    });

    it('should warn about unknown option not in introspection either', async () => {
      const mockIntrospect: IntrospectFn = jest.fn().mockResolvedValue(mockIntrospection);

      const config = `Sentry.init({
  dsn: "https://test@o0.ingest.sentry.io/0",
  totallyFakeOption: "test"
});`;

      const result = await analyzer.analyze(config, 'javascript', mockIntrospect);

      const fakeOpt = result.options.find(o => o.key === 'totallyFakeOption');
      expect(fakeOpt).toBeDefined();
      expect(fakeOpt?.recognized).toBe(false);
      const unknownWarning = result.warnings.find(
        w => w.message.includes('Unknown option') && w.message.includes('totallyFakeOption')
      );
      expect(unknownWarning).toBeDefined();
    });

    it('should degrade gracefully when introspection fails', async () => {
      const mockIntrospect: IntrospectFn = jest.fn().mockRejectedValue(new Error('Connection refused'));

      const config = `Sentry.init({
  dsn: "https://test@o0.ingest.sentry.io/0",
  customNewOption: "hello"
});`;

      const result = await analyzer.analyze(config, 'javascript', mockIntrospect);

      // Should still work, just with unknown option warning
      const customOpt = result.options.find(o => o.key === 'customNewOption');
      expect(customOpt).toBeDefined();
      expect(customOpt?.recognized).toBe(false);
    });

    it('should set source=dictionary for dictionary options', async () => {
      const mockIntrospect: IntrospectFn = jest.fn().mockResolvedValue(mockIntrospection);

      const config = `Sentry.init({
  dsn: "https://test@o0.ingest.sentry.io/0"
});`;

      const result = await analyzer.analyze(config, 'javascript', mockIntrospect);

      const dsnOpt = result.options.find(o => o.key === 'dsn');
      expect(dsnOpt?.recognized).toBe(true);
      expect(dsnOpt?.source).toBe('dictionary');
      // Introspection should NOT be called since all options are in dictionary
      expect(mockIntrospect).not.toHaveBeenCalled();
    });

    it('should call introspection only once for multiple unknowns', async () => {
      const mockIntrospect: IntrospectFn = jest.fn().mockResolvedValue(mockIntrospection);

      const config = `Sentry.init({
  dsn: "https://test@o0.ingest.sentry.io/0",
  customNewOption: "hello",
  anotherNewOption: true
});`;

      const result = await analyzer.analyze(config, 'javascript', mockIntrospect);

      expect(mockIntrospect).toHaveBeenCalledTimes(1);

      const opt1 = result.options.find(o => o.key === 'customNewOption');
      const opt2 = result.options.find(o => o.key === 'anotherNewOption');
      expect(opt1?.recognized).toBe(true);
      expect(opt1?.source).toBe('introspection');
      expect(opt2?.recognized).toBe(true);
      expect(opt2?.source).toBe('introspection');
    });

    it('should work without introspectFn (backward compatible)', async () => {
      const config = `Sentry.init({
  dsn: "https://test@o0.ingest.sentry.io/0",
  customNewOption: "hello"
});`;

      // No introspectFn passed
      const result = await analyzer.analyze(config, 'javascript');

      const customOpt = result.options.find(o => o.key === 'customNewOption');
      expect(customOpt).toBeDefined();
      expect(customOpt?.recognized).toBe(false);
    });

    it('should emit info message for introspection-only options', async () => {
      const mockIntrospect: IntrospectFn = jest.fn().mockResolvedValue(mockIntrospection);

      const config = `Sentry.init({
  dsn: "https://test@o0.ingest.sentry.io/0",
  customNewOption: "hello"
});`;

      const result = await analyzer.analyze(config, 'javascript', mockIntrospect);

      const infoWarning = result.warnings.find(
        w => w.severity === 'info' && w.message.includes('recognized via SDK introspection')
      );
      expect(infoWarning).toBeDefined();
    });
  });
});
