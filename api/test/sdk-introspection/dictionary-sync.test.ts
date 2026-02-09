import { syncDictionary } from '../../src/sdk-introspection/dictionary-sync';
import { IntrospectionResponse } from '../../src/sdk-introspection/types';

describe('Dictionary Sync', () => {
  describe('syncDictionary', () => {
    it('should identify matched options between dictionary and SDK', () => {
      const introspection: IntrospectionResponse = {
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection',
        options: [
          { key: 'dsn', canonicalKey: 'dsn', type: 'string', required: true, default: null, description: '' },
          { key: 'traces_sample_rate', canonicalKey: 'tracesSampleRate', type: 'float', required: false, default: null, description: '' },
          { key: 'debug', canonicalKey: 'debug', type: 'boolean', required: false, default: false, description: '' },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      };

      const result = syncDictionary('python', introspection);

      expect(result.sdk).toBe('python');
      expect(result.matched.length).toBeGreaterThan(0);
      expect(result.matched).toContain('dsn');
      expect(result.dictionaryCount).toBeGreaterThan(0);
      expect(result.introspectedCount).toBe(3);
    });

    it('should identify dictionary-only options (possibly deprecated)', () => {
      // Introspection returns very few options - dictionary has more
      const introspection: IntrospectionResponse = {
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection',
        options: [
          { key: 'dsn', canonicalKey: 'dsn', type: 'string', required: true, default: null, description: '' },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      };

      const result = syncDictionary('python', introspection);

      // Dictionary has more options than just dsn, so dictionaryOnly should be non-empty
      expect(result.dictionaryOnly.length).toBeGreaterThan(0);
    });

    it('should identify SDK-only options (missing from dictionary)', () => {
      const introspection: IntrospectionResponse = {
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection',
        options: [
          { key: 'dsn', canonicalKey: 'dsn', type: 'string', required: true, default: null, description: '' },
          { key: 'some_new_option', canonicalKey: 'someNewOption', type: 'string', required: false, default: null, description: '' },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      };

      const result = syncDictionary('python', introspection);

      expect(result.sdkOnly).toContain('someNewOption');
    });

    it('should calculate sync score as percentage of matched options', () => {
      const introspection: IntrospectionResponse = {
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection',
        options: [
          { key: 'dsn', canonicalKey: 'dsn', type: 'string', required: true, default: null, description: '' },
          { key: 'debug', canonicalKey: 'debug', type: 'boolean', required: false, default: false, description: '' },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      };

      const result = syncDictionary('python', introspection);

      expect(result.syncScore).toBeGreaterThanOrEqual(0);
      expect(result.syncScore).toBeLessThanOrEqual(100);
    });

    it('should detect type conflicts between dictionary and SDK', () => {
      // Dictionary says dsn is "string", but introspection says "integer" (contrived)
      const introspection: IntrospectionResponse = {
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection',
        options: [
          { key: 'dsn', canonicalKey: 'dsn', type: 'integer', required: true, default: null, description: '' },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      };

      const result = syncDictionary('python', introspection);

      expect(result.typeConflicts.length).toBeGreaterThan(0);
      expect(result.typeConflicts[0].key).toBe('dsn');
    });

    it('should handle empty introspection options', () => {
      const introspection: IntrospectionResponse = {
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection',
        options: [],
        timestamp: '2024-01-01T00:00:00Z',
      };

      const result = syncDictionary('python', introspection);

      expect(result.matched).toHaveLength(0);
      expect(result.introspectedCount).toBe(0);
      expect(result.dictionaryOnly.length).toBeGreaterThan(0);
      expect(result.syncScore).toBe(0);
    });

    it('should normalize snake_case keys from Python SDK', () => {
      const introspection: IntrospectionResponse = {
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection',
        options: [
          { key: 'traces_sample_rate', canonicalKey: 'tracesSampleRate', type: 'float', required: false, default: null, description: '' },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      };

      const result = syncDictionary('python', introspection);

      // tracesSampleRate should be found in both dictionary and SDK
      expect(result.matched).toContain('tracesSampleRate');
    });
  });
});
