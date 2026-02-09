import request from 'supertest';
import express from 'express';
import configRouter from '../../src/routes/config';

// Mock the SDK introspection modules
jest.mock('../../src/sdk-introspection/config-validator');
jest.mock('../../src/sdk-introspection/sdk-introspector');
jest.mock('../../src/sdk-introspection/dictionary-sync');

const { validateConfigLive } = require('../../src/sdk-introspection/config-validator');
const { introspectSDK } = require('../../src/sdk-introspection/sdk-introspector');
const { syncDictionary } = require('../../src/sdk-introspection/dictionary-sync');

const app = express();
app.use(express.json());
app.use('/api/config', configRouter);

describe('Config API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/config/analyze', () => {
    it('should analyze JavaScript config code', async () => {
      const response = await request(app)
        .post('/api/config/analyze')
        .send({
          configCode: 'Sentry.init({ dsn: "https://key@o0.ingest.sentry.io/0" })',
          sdk: 'javascript',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.sdk).toBe('javascript');
    });

    it('should return 400 when configCode is missing', async () => {
      const response = await request(app)
        .post('/api/config/analyze')
        .send({ sdk: 'javascript' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/config/validate-live', () => {
    it('should call validateConfigLive and return result', async () => {
      validateConfigLive.mockResolvedValueOnce({
        success: true,
        sdk: 'python',
        sdkVersion: '2.0.0',
        initSucceeded: true,
        warnings: [],
        resolvedOptions: { dsn: 'https://key@o0.ingest.sentry.io/0' },
        recognizedKeys: ['dsn'],
        ignoredKeys: [],
      });

      const response = await request(app)
        .post('/api/config/validate-live')
        .send({
          sdk: 'python',
          configCode: 'sentry_sdk.init(dsn="https://key@o0.ingest.sentry.io/0")',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.initSucceeded).toBe(true);
      expect(validateConfigLive).toHaveBeenCalledWith('python', expect.any(String));
    });

    it('should return 400 when configCode is missing', async () => {
      const response = await request(app)
        .post('/api/config/validate-live')
        .send({ sdk: 'python' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('configCode');
    });

    it('should return 400 when sdk is missing', async () => {
      const response = await request(app)
        .post('/api/config/validate-live')
        .send({ configCode: 'test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('sdk');
    });
  });

  describe('GET /api/config/introspect/:sdk', () => {
    it('should return introspection data for a valid SDK', async () => {
      introspectSDK.mockResolvedValueOnce({
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection',
        options: [
          { key: 'dsn', canonicalKey: 'dsn', type: 'string', required: true, default: null, description: '' },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      });

      const response = await request(app).get('/api/config/introspect/python');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.sdk).toBe('python');
      expect(response.body.data.options).toHaveLength(1);
      expect(introspectSDK).toHaveBeenCalledWith('python');
    });

    it('should return 500 when introspection fails', async () => {
      introspectSDK.mockRejectedValueOnce(new Error('Connection refused'));

      const response = await request(app).get('/api/config/introspect/python');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/config/dictionary/sync/:sdk', () => {
    it('should return dictionary sync results', async () => {
      introspectSDK.mockResolvedValueOnce({
        sdk: 'python',
        sdkVersion: '2.0.0',
        sdkPackage: 'sentry-sdk',
        source: 'reflection',
        options: [
          { key: 'dsn', canonicalKey: 'dsn', type: 'string', required: true, default: null, description: '' },
        ],
        timestamp: '2024-01-01T00:00:00Z',
      });

      syncDictionary.mockReturnValueOnce({
        sdk: 'python',
        dictionaryCount: 63,
        introspectedCount: 1,
        matched: ['dsn'],
        dictionaryOnly: ['debug', 'release'],
        sdkOnly: [],
        typeConflicts: [],
        syncScore: 2,
      });

      const response = await request(app).get('/api/config/dictionary/sync/python');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.matched).toContain('dsn');
      expect(response.body.data.syncScore).toBeDefined();
      expect(introspectSDK).toHaveBeenCalledWith('python');
    });

    it('should return 500 when SDK is unreachable', async () => {
      introspectSDK.mockRejectedValueOnce(new Error('Failed to connect'));

      const response = await request(app).get('/api/config/dictionary/sync/python');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/config/options', () => {
    it('should return all available options', async () => {
      const response = await request(app).get('/api/config/options');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.options).toBeDefined();
      expect(response.body.data.totalCount).toBeGreaterThan(0);
    });
  });
});
