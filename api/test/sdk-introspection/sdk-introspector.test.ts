import { introspectSDK, clearCache, getCacheSize } from '../../src/sdk-introspection/sdk-introspector';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SDK Introspector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
  });

  describe('introspectSDK', () => {
    it('should return introspection data from SDK container', async () => {
      const mockResponse = {
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection' as const,
        options: [
          {
            key: 'dsn',
            canonicalKey: 'dsn',
            type: 'string',
            required: true,
            default: null,
            description: 'Data Source Name',
          },
          {
            key: 'traces_sample_rate',
            canonicalKey: 'tracesSampleRate',
            type: 'float',
            required: false,
            default: null,
            description: '',
          },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockedAxios.get.mockResolvedValueOnce({ data: mockResponse });

      const result = await introspectSDK('python');

      expect(result.sdk).toBe('python');
      expect(result.sdkVersion).toBe('2.0.0');
      expect(result.source).toBe('reflection');
      expect(result.options).toHaveLength(2);
      expect(result.options[0].key).toBe('dsn');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/introspect'),
        expect.objectContaining({ timeout: 10000 })
      );
    });

    it('should cache introspection results', async () => {
      const mockResponse = {
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection' as const,
        options: [],
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockedAxios.get.mockResolvedValueOnce({ data: mockResponse });

      // First call - hits the API
      await introspectSDK('python');
      // Second call - should use cache
      await introspectSDK('python');

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(getCacheSize()).toBe(1);
    });

    it('should bypass cache when TTL expires', async () => {
      const mockResponse = {
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection' as const,
        options: [],
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockedAxios.get.mockResolvedValue({ data: mockResponse });

      // Call with 0ms TTL (always expires)
      await introspectSDK('python', 0);
      await introspectSDK('python', 0);

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('should throw for unsupported SDK', async () => {
      await expect(introspectSDK('unsupported')).rejects.toThrow('not supported');
    });

    it('should throw on connection error', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(introspectSDK('python')).rejects.toThrow('Failed to connect');
    });

    it('should throw on HTTP error response', async () => {
      mockedAxios.get.mockRejectedValueOnce({
        response: {
          data: { error: 'Service unavailable' },
        },
      });

      await expect(introspectSDK('python')).rejects.toThrow('Introspection failed');
    });

    it('should clearCache successfully', async () => {
      const mockResponse = {
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection' as const,
        options: [],
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockedAxios.get.mockResolvedValue({ data: mockResponse });

      await introspectSDK('python');
      expect(getCacheSize()).toBe(1);

      clearCache();
      expect(getCacheSize()).toBe(0);

      // Next call should hit the API again
      await introspectSDK('python');
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('should cache different SDKs independently', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { sdk: 'python', sdkVersion: '2.0.0', sdkPackage: 'sentry-sdk', source: 'reflection', options: [], timestamp: '' },
      });
      mockedAxios.get.mockResolvedValueOnce({
        data: { sdk: 'javascript', sdkVersion: '8.0.0', sdkPackage: '@sentry/node', source: 'manifest', options: [], timestamp: '' },
      });

      await introspectSDK('python');
      await introspectSDK('javascript');

      expect(getCacheSize()).toBe(2);
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });
});
