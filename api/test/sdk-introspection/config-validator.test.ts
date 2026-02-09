import { validateConfigLive } from '../../src/sdk-introspection/config-validator';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Config Validator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateConfigLive', () => {
    it('should return success when SDK validates config successfully', async () => {
      const mockResponse = {
        success: true,
        sdk: 'python',
        sdkVersion: '2.0.0',
        initSucceeded: true,
        warnings: [],
        resolvedOptions: { dsn: 'https://key@o0.ingest.sentry.io/0', traces_sample_rate: 0.1 },
        recognizedKeys: ['dsn', 'traces_sample_rate'],
        ignoredKeys: [],
      };

      mockedAxios.post.mockResolvedValueOnce({ data: mockResponse });

      const result = await validateConfigLive(
        'python',
        'sentry_sdk.init(dsn="https://key@o0.ingest.sentry.io/0", traces_sample_rate=0.1)'
      );

      expect(result.success).toBe(true);
      expect(result.initSucceeded).toBe(true);
      expect(result.sdk).toBe('python');
      expect(result.recognizedKeys).toContain('dsn');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/validate-config'),
        expect.objectContaining({ configCode: expect.any(String) }),
        expect.objectContaining({ timeout: 15000 })
      );
    });

    it('should return initSucceeded=false when config has errors', async () => {
      const mockResponse = {
        success: true,
        sdk: 'python',
        sdkVersion: '2.0.0',
        initSucceeded: false,
        error: 'Invalid DSN format',
        warnings: [],
        resolvedOptions: {},
        recognizedKeys: [],
        ignoredKeys: [],
      };

      mockedAxios.post.mockResolvedValueOnce({ data: mockResponse });

      const result = await validateConfigLive('python', 'sentry_sdk.init(dsn="invalid")');

      expect(result.success).toBe(true);
      expect(result.initSucceeded).toBe(false);
      expect(result.error).toBe('Invalid DSN format');
    });

    it('should return error for unsupported SDK', async () => {
      const result = await validateConfigLive('unsupported', 'some code');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not supported');
    });

    it('should handle connection errors gracefully', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await validateConfigLive('python', 'sentry_sdk.init()');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to connect');
    });

    it('should handle HTTP error responses', async () => {
      const errorResponse = {
        response: {
          data: {
            success: false,
            error: 'Internal server error',
          },
        },
      };

      mockedAxios.post.mockRejectedValueOnce(errorResponse);

      const result = await validateConfigLive('python', 'bad code');

      expect(result.success).toBe(false);
    });

    it('should capture warnings from SDK', async () => {
      const mockResponse = {
        success: true,
        sdk: 'javascript',
        sdkVersion: '8.0.0',
        initSucceeded: true,
        warnings: ['Deprecation: enableTracing is deprecated'],
        resolvedOptions: {},
        recognizedKeys: ['dsn'],
        ignoredKeys: [],
      };

      mockedAxios.post.mockResolvedValueOnce({ data: mockResponse });

      const result = await validateConfigLive(
        'javascript',
        'Sentry.init({ dsn: "https://key@sentry.io/1" })'
      );

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Deprecation');
    });

    it('should call the correct SDK URL for each SDK', async () => {
      const sdks = ['javascript', 'python', 'ruby', 'php', 'go', 'dotnet', 'java'];

      for (const sdk of sdks) {
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            success: true,
            sdk,
            sdkVersion: '1.0.0',
            initSucceeded: true,
            warnings: [],
            resolvedOptions: {},
            recognizedKeys: [],
            ignoredKeys: [],
          },
        });

        await validateConfigLive(sdk, 'test code');
      }

      expect(mockedAxios.post).toHaveBeenCalledTimes(sdks.length);
    });
  });
});
