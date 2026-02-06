import request from 'supertest';
import express from 'express';
import sentryQueryRouter from '../../src/routes/sentry-query';

// Mock the sentry-api-client module
jest.mock('../../src/sentry-query/sentry-api-client', () => ({
  querySentryAPI: jest.fn(),
  buildApiUrl: jest.fn(),
  generateCurlCommand: jest.fn(),
}));

import { querySentryAPI, buildApiUrl, generateCurlCommand } from '../../src/sentry-query/sentry-api-client';

const mockedQuerySentryAPI = querySentryAPI as jest.MockedFunction<typeof querySentryAPI>;
const mockedBuildApiUrl = buildApiUrl as jest.MockedFunction<typeof buildApiUrl>;
const mockedGenerateCurlCommand = generateCurlCommand as jest.MockedFunction<typeof generateCurlCommand>;

const app = express();
app.use(express.json());
app.use('/api/sentry-query', sentryQueryRouter);

describe('Sentry Query Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/sentry-query/validate', () => {
    it('should validate correct query syntax', async () => {
      const response = await request(app)
        .post('/api/sentry-query/validate')
        .send({ query: 'level:error is:unresolved' })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.components).toHaveLength(2);
    });

    it('should return suggestions for invalid properties', async () => {
      const response = await request(app)
        .post('/api/sentry-query/validate')
        .send({ query: 'assignee:me' })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.suggestions).toHaveLength(1);
      expect(response.body.suggestions[0].suggested).toBe('assigned');
    });

    it('should validate property values', async () => {
      const response = await request(app)
        .post('/api/sentry-query/validate')
        .send({ query: 'level:critical' })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.components[0].error).toContain('Invalid value');
    });

    it('should return 400 for missing query parameter', async () => {
      const response = await request(app)
        .post('/api/sentry-query/validate')
        .send({})
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('query');
    });

    it('should handle empty query', async () => {
      const response = await request(app)
        .post('/api/sentry-query/validate')
        .send({ query: '' })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.components).toHaveLength(0);
    });

    it('should validate complex queries', async () => {
      const response = await request(app)
        .post('/api/sentry-query/validate')
        .send({
          query: 'is:unresolved level:error !user.email:*@internal.com age:>24h',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.components).toHaveLength(4);
    });
  });

  describe('POST /api/sentry-query/test', () => {
    it('should require org and authToken', async () => {
      const response = await request(app)
        .post('/api/sentry-query/test')
        .send({ query: 'level:error' })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should require org', async () => {
      const response = await request(app)
        .post('/api/sentry-query/test')
        .send({ authToken: 'test-token', endpoint: 'issues' })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('org');
    });

    it('should require authToken', async () => {
      const response = await request(app)
        .post('/api/sentry-query/test')
        .send({ org: 'team-se-oi', endpoint: 'issues' })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('authToken');
    });

    it('should return results with generated cURL', async () => {
      mockedQuerySentryAPI.mockResolvedValueOnce({
        success: true,
        data: [{ id: '1', title: 'Test Issue' }],
        count: 1,
        generatedUrl: 'https://sentry.io/api/0/organizations/team-se-oi/issues/?query=level%3Aerror',
        generatedCurl: 'curl -H "Authorization: Bearer ***" "https://sentry.io/..."',
      });

      const response = await request(app)
        .post('/api/sentry-query/test')
        .send({
          org: 'team-se-oi',
          authToken: 'test-token',
          endpoint: 'issues',
          query: 'level:error',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.generatedCurl).toBeDefined();
      expect(response.body.generatedUrl).toBeDefined();
    });

    it('should handle API errors gracefully', async () => {
      mockedQuerySentryAPI.mockResolvedValueOnce({
        success: false,
        error: 'Unauthorized: Invalid token',
        statusCode: 401,
        generatedUrl: 'https://sentry.io/...',
        generatedCurl: 'curl ...',
      });

      const response = await request(app)
        .post('/api/sentry-query/test')
        .send({
          org: 'team-se-oi',
          authToken: 'invalid-token',
          endpoint: 'issues',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200); // We return 200 with error in body
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Unauthorized');
    });

    it('should handle rate limiting', async () => {
      mockedQuerySentryAPI.mockResolvedValueOnce({
        success: false,
        error: 'Rate limit exceeded',
        statusCode: 429,
        rateLimited: true,
        generatedUrl: 'https://sentry.io/...',
        generatedCurl: 'curl ...',
      });

      const response = await request(app)
        .post('/api/sentry-query/test')
        .send({
          org: 'team-se-oi',
          authToken: 'test-token',
          endpoint: 'issues',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.rateLimited).toBe(true);
    });

    it('should default to issues endpoint', async () => {
      mockedQuerySentryAPI.mockResolvedValueOnce({
        success: true,
        data: [],
        count: 0,
        generatedUrl: 'https://sentry.io/...',
        generatedCurl: 'curl ...',
      });

      await request(app)
        .post('/api/sentry-query/test')
        .send({
          org: 'team-se-oi',
          authToken: 'test-token',
        })
        .set('Content-Type', 'application/json');

      expect(mockedQuerySentryAPI).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'issues' })
      );
    });

    it('should pass all parameters to API client', async () => {
      mockedQuerySentryAPI.mockResolvedValueOnce({
        success: true,
        data: [],
        count: 0,
        generatedUrl: 'https://sentry.io/...',
        generatedCurl: 'curl ...',
      });

      await request(app)
        .post('/api/sentry-query/test')
        .send({
          org: 'team-se-oi',
          authToken: 'test-token',
          endpoint: 'issues',
          query: 'level:error',
          environment: 'production',
          statsPeriod: '24h',
          project: '123',
        })
        .set('Content-Type', 'application/json');

      expect(mockedQuerySentryAPI).toHaveBeenCalledWith({
        org: 'team-se-oi',
        authToken: 'test-token',
        endpoint: 'issues',
        query: 'level:error',
        environment: 'production',
        statsPeriod: '24h',
        project: '123',
      });
    });
  });

  describe('POST /api/sentry-query/parse-url', () => {
    it('should extract query from Sentry issues URL', async () => {
      const response = await request(app)
        .post('/api/sentry-query/parse-url')
        .send({
          url: 'https://team-se-oi.sentry.io/issues/?query=level%3Aerror%20is%3Aunresolved',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.org).toBe('team-se-oi');
      expect(response.body.query).toBe('level:error is:unresolved');
      expect(response.body.endpoint).toBe('issues');
    });

    it('should extract environment from URL', async () => {
      const response = await request(app)
        .post('/api/sentry-query/parse-url')
        .send({
          url: 'https://team-se-oi.sentry.io/issues/?query=level%3Aerror&environment=production',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.environment).toBe('production');
    });

    it('should extract project from URL', async () => {
      const response = await request(app)
        .post('/api/sentry-query/parse-url')
        .send({
          url: 'https://team-se-oi.sentry.io/issues/?query=level%3Aerror&project=123456',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.project).toBe('123456');
    });

    it('should extract statsPeriod from URL', async () => {
      const response = await request(app)
        .post('/api/sentry-query/parse-url')
        .send({
          url: 'https://team-se-oi.sentry.io/issues/?statsPeriod=7d',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.statsPeriod).toBe('7d');
    });

    it('should return 400 for missing URL', async () => {
      const response = await request(app)
        .post('/api/sentry-query/parse-url')
        .send({})
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('url');
    });

    it('should return error for invalid URL', async () => {
      const response = await request(app)
        .post('/api/sentry-query/parse-url')
        .send({ url: 'not-a-valid-url' })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('should return error for non-Sentry URL', async () => {
      const response = await request(app)
        .post('/api/sentry-query/parse-url')
        .send({ url: 'https://google.com/search?q=test' })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Sentry');
    });

    it('should handle discover URL with warning', async () => {
      const response = await request(app)
        .post('/api/sentry-query/parse-url')
        .send({
          url: 'https://team-se-oi.sentry.io/discover/results/?query=level%3Aerror',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Discover URLs fall back to issues endpoint with a warning
      expect(response.body.endpoint).toBe('issues');
      expect(response.body.warning).toContain('Discover URLs are not fully supported');
    });

    it('should strip Unicode Private Use Area characters from query', async () => {
      // This URL contains %EF%80%8D (U+F00D) characters that Sentry UI uses for formatting
      const response = await request(app)
        .post('/api/sentry-query/parse-url')
        .send({
          url: 'https://demo.sentry.io/issues/?project=4508968134377472&query=is%3Aunresolved%20level%3A%EF%80%8DContains%EF%80%8Derror&referrer=issue-list&statsPeriod=14d',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.org).toBe('demo');
      expect(response.body.query).toBe('is:unresolved level:Containserror');
      expect(response.body.project).toBe('4508968134377472');
      expect(response.body.statsPeriod).toBe('14d');
    });

    it('should handle various Unicode Private Use Area characters in query', async () => {
      // Test with multiple PUA characters (U+E000 to U+F8FF range)
      const response = await request(app)
        .post('/api/sentry-query/parse-url')
        .send({
          url: 'https://team-se-oi.sentry.io/issues/?query=test%EE%80%80value%EF%A3%BFend',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // PUA characters should be stripped, leaving just the clean text
      expect(response.body.query).toBe('testvalueend');
    });
  });

  describe('GET /api/sentry-query/properties', () => {
    it('should return list of valid properties', async () => {
      const response = await request(app)
        .get('/api/sentry-query/properties')
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.properties).toBeDefined();
      expect(Array.isArray(response.body.properties)).toBe(true);
      expect(response.body.properties.length).toBeGreaterThan(0);
    });

    it('should include property metadata', async () => {
      const response = await request(app)
        .get('/api/sentry-query/properties')
        .set('Content-Type', 'application/json');

      const levelProp = response.body.properties.find(
        (p: any) => p.name === 'level'
      );
      expect(levelProp).toBeDefined();
      expect(levelProp.type).toBeDefined();
      expect(levelProp.values).toBeDefined();
    });
  });

  describe('GET /api/sentry-query/examples', () => {
    it('should return example queries', async () => {
      const response = await request(app)
        .get('/api/sentry-query/examples')
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.examples).toBeDefined();
      expect(Array.isArray(response.body.examples)).toBe(true);
      expect(response.body.examples.length).toBeGreaterThan(0);
    });

    it('should include example metadata', async () => {
      const response = await request(app)
        .get('/api/sentry-query/examples')
        .set('Content-Type', 'application/json');

      const example = response.body.examples[0];
      expect(example.name).toBeDefined();
      expect(example.description).toBeDefined();
      expect(example.query).toBeDefined();
    });
  });
});
