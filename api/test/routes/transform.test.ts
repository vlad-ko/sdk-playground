import request from 'supertest';
import express from 'express';
import transformRouter from '../../src/routes/transform';
import * as javascriptClient from '../../src/sdk-clients/javascript';
import * as pythonClient from '../../src/sdk-clients/python';

// Mock SDK clients
jest.mock('../../src/sdk-clients/javascript');
jest.mock('../../src/sdk-clients/python');
jest.mock('fs'); // Mock fs for registry reading

const app = express();
app.use(express.json());
app.use('/api/transform', transformRouter);

describe('Transform API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock SDK registry
    const mockRegistry = {
      sdks: {
        javascript: {
          name: 'JavaScript',
          status: 'available',
        },
        python: {
          name: 'Python',
          status: 'available',
        },
      },
    };

    require('fs').readFileSync = jest.fn().mockReturnValue(JSON.stringify(mockRegistry));
  });

  describe('POST /api/transform', () => {
    it('should transform event using JavaScript SDK', async () => {
      const event = {
        exception: {
          values: [{
            type: 'Error',
            value: 'Test error',
          }],
        },
      };

      const beforeSendCode = '(event) => { event.transformed = true; return event; }';

      const mockResponse = {
        success: true,
        transformedEvent: { ...event, transformed: true },
      };

      jest.spyOn(javascriptClient, 'transformWithJavaScript').mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/transform')
        .send({
          sdk: 'javascript',
          event,
          beforeSendCode,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.originalEvent).toEqual(event);
      expect(response.body.transformedEvent?.transformed).toBe(true);
      expect(response.body.sdk).toBe('javascript');
    });

    it('should transform event using Python SDK', async () => {
      const event = {
        exception: {
          values: [{
            type: 'ValueError',
            value: 'Test error',
          }],
        },
      };

      const beforeSendCode = 'def before_send(event, hint): return event';

      const mockResponse = {
        success: true,
        transformedEvent: event,
      };

      jest.spyOn(pythonClient, 'transformWithPython').mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/transform')
        .send({
          sdk: 'python',
          event,
          beforeSendCode,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.transformedEvent).toEqual(event);
      expect(response.body.sdk).toBe('python');
    });

    it('should return 400 if sdk is missing', async () => {
      const response = await request(app)
        .post('/api/transform')
        .send({
          event: {},
          beforeSendCode: 'code',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Missing required fields');
    });

    it('should return 400 if event is missing', async () => {
      const response = await request(app)
        .post('/api/transform')
        .send({
          sdk: 'javascript',
          beforeSendCode: 'code',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Missing required fields');
    });

    it('should return 400 if beforeSendCode is missing', async () => {
      const response = await request(app)
        .post('/api/transform')
        .send({
          sdk: 'javascript',
          event: {},
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Missing required fields');
    });

    it('should validate JSON string event input', async () => {
      const eventString = '{"exception": {"values": [{"type": "Error", "value": "Test"}]}}';
      const beforeSendCode = '(event) => event';

      const mockResponse = {
        success: true,
        transformedEvent: JSON.parse(eventString),
      };

      jest.spyOn(javascriptClient, 'transformWithJavaScript').mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/transform')
        .send({
          sdk: 'javascript',
          event: eventString,
          beforeSendCode,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 400 for invalid JSON event string', async () => {
      const response = await request(app)
        .post('/api/transform')
        .send({
          sdk: 'javascript',
          event: '{invalid json}',
          beforeSendCode: 'code',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid JSON');
    });

    it('should return 400 for invalid Sentry event structure', async () => {
      const response = await request(app)
        .post('/api/transform')
        .send({
          sdk: 'javascript',
          event: { invalid: 'event' },
          beforeSendCode: 'code',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('valid Sentry event');
    });

    it('should return 400 for unknown SDK', async () => {
      const mockRegistry = {
        sdks: {
          javascript: { name: 'JavaScript', status: 'available' },
        },
      };

      require('fs').readFileSync = jest.fn().mockReturnValue(JSON.stringify(mockRegistry));

      const response = await request(app)
        .post('/api/transform')
        .send({
          sdk: 'unknown',
          event: { event_id: '123' },
          beforeSendCode: 'code',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Unknown SDK');
    });

    it('should return 400 for not-installed SDK', async () => {
      const mockRegistry = {
        sdks: {
          dotnet: {
            name: '.NET',
            status: 'not-installed',
          },
        },
      };

      require('fs').readFileSync = jest.fn().mockReturnValue(JSON.stringify(mockRegistry));

      const response = await request(app)
        .post('/api/transform')
        .send({
          sdk: 'dotnet',
          event: { event_id: '123' },
          beforeSendCode: 'code',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not installed');
    });

    it('should handle SDK service errors gracefully', async () => {
      const mockResponse = {
        success: false,
        error: 'SDK service error',
      };

      jest.spyOn(javascriptClient, 'transformWithJavaScript').mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/transform')
        .send({
          sdk: 'javascript',
          event: { event_id: '123' },
          beforeSendCode: 'code',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('SDK service error');
    });
  });

  describe('GET /api/transform/sdks', () => {
    it('should return list of available SDKs', async () => {
      const mockRegistry = {
        sdks: {
          javascript: {
            name: 'JavaScript',
            language: 'javascript',
            default: true,
            status: 'available',
          },
          python: {
            name: 'Python',
            language: 'python',
            default: true,
            status: 'available',
          },
          dotnet: {
            name: '.NET',
            language: 'csharp',
            default: false,
            status: 'not-installed',
          },
        },
      };

      require('fs').readFileSync = jest.fn().mockReturnValue(JSON.stringify(mockRegistry));

      const response = await request(app).get('/api/transform/sdks');

      expect(response.status).toBe(200);
      expect(response.body.sdks).toHaveLength(2); // Only available SDKs
      expect(response.body.sdks[0].key).toBe('javascript');
      expect(response.body.sdks[1].key).toBe('python');
      expect(response.body.sdks.find((s: any) => s.key === 'dotnet')).toBeUndefined();
    });

    it('should return empty array if no SDKs are available', async () => {
      const mockRegistry = {
        sdks: {
          dotnet: { name: '.NET', status: 'not-installed' },
        },
      };

      require('fs').readFileSync = jest.fn().mockReturnValue(JSON.stringify(mockRegistry));

      const response = await request(app).get('/api/transform/sdks');

      expect(response.status).toBe(200);
      expect(response.body.sdks).toHaveLength(0);
    });
  });
});
