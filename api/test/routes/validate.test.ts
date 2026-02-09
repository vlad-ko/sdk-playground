import request from 'supertest';
import express from 'express';
import validateRouter from '../../src/routes/validate';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const app = express();
app.use(express.json());
app.use('/api/validate', validateRouter);

describe('POST /api/validate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('JavaScript validation', () => {
    it('should return valid for correct JavaScript code', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { valid: true, errors: [] },
      });

      const response = await request(app)
        .post('/api/validate')
        .send({
          sdk: 'javascript',
          beforeSendCode: '(event, hint) => { return event; }',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        valid: true,
        errors: [],
      });
    });

    it('should return errors for invalid JavaScript syntax', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          valid: false,
          errors: [{ line: 1, column: 32, message: 'Unexpected end of input' }],
        },
      });

      const response = await request(app)
        .post('/api/validate')
        .send({
          sdk: 'javascript',
          beforeSendCode: '(event, hint) => { return event',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.errors).toBeDefined();
      expect(response.body.errors.length).toBeGreaterThan(0);
      expect(response.body.errors[0]).toHaveProperty('message');
    });

    it('should return errors for missing closing brace', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          valid: false,
          errors: [{ line: 1, message: 'Unexpected end of input' }],
        },
      });

      const response = await request(app)
        .post('/api/validate')
        .send({
          sdk: 'javascript',
          beforeSendCode: 'function test() { console.log("test")',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Python validation', () => {
    it('should return valid for correct Python code', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { valid: true, errors: [] },
      });

      const response = await request(app)
        .post('/api/validate')
        .send({
          sdk: 'python',
          beforeSendCode: 'def before_send(event, hint):\n    return event',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        valid: true,
        errors: [],
      });
    });

    it('should return errors for invalid Python syntax', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          valid: false,
          errors: [{ line: 1, message: 'SyntaxError: invalid syntax' }],
        },
      });

      const response = await request(app)
        .post('/api/validate')
        .send({
          sdk: 'python',
          beforeSendCode: 'def before_send(event, hint)\n    return event',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.errors).toBeDefined();
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it('should return errors for indentation errors', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          valid: false,
          errors: [{ line: 2, message: 'IndentationError: expected an indented block' }],
        },
      });

      const response = await request(app)
        .post('/api/validate')
        .send({
          sdk: 'python',
          beforeSendCode: 'def before_send(event, hint):\nreturn event',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Input validation', () => {
    it('should return 400 for missing sdk parameter', async () => {
      const response = await request(app)
        .post('/api/validate')
        .send({
          beforeSendCode: 'some code',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should return 400 for missing beforeSendCode parameter', async () => {
      const response = await request(app)
        .post('/api/validate')
        .send({
          sdk: 'javascript',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should return 400 for unsupported SDK', async () => {
      const response = await request(app)
        .post('/api/validate')
        .send({
          sdk: 'cobol',
          beforeSendCode: 'some code',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Unsupported SDK');
    });
  });

  describe('Error object structure', () => {
    it('should return errors with line and message properties', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          valid: false,
          errors: [{ line: 1, column: 32, message: 'Unexpected end of input' }],
        },
      });

      const response = await request(app)
        .post('/api/validate')
        .send({
          sdk: 'javascript',
          beforeSendCode: '(event, hint) => { return event',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.errors[0]).toHaveProperty('message');
      expect(typeof response.body.errors[0].message).toBe('string');
    });
  });

  describe('SDK container fallback', () => {
    it('should return valid when SDK container is unreachable', async () => {
      const error = new Error('connect ECONNREFUSED');
      (error as any).code = 'ECONNREFUSED';
      mockedAxios.post.mockRejectedValueOnce(error);

      const response = await request(app)
        .post('/api/validate')
        .send({
          sdk: 'javascript',
          beforeSendCode: '(event) => event',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ valid: true, errors: [] });
    });

    it('should return valid when SDK container returns 404', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 404 },
      });

      const response = await request(app)
        .post('/api/validate')
        .send({
          sdk: 'python',
          beforeSendCode: 'def f(): pass',
        })
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ valid: true, errors: [] });
    });
  });
});
