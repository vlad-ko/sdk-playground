import { validateJSON, validateSentryEvent } from '../../src/parsers/json';

describe('JSON Parser', () => {
  describe('validateJSON', () => {
    it('should validate valid JSON string', () => {
      const input = '{"key": "value"}';
      const result = validateJSON(input);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual({ key: 'value' });
      expect(result.error).toBeUndefined();
    });

    it('should reject invalid JSON string', () => {
      const input = '{invalid json}';
      const result = validateJSON(input);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Invalid JSON');
      expect(result.data).toBeUndefined();
    });

    it('should validate JSON with nested objects', () => {
      const input = '{"outer": {"inner": "value"}}';
      const result = validateJSON(input);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual({ outer: { inner: 'value' } });
    });

    it('should validate JSON arrays', () => {
      const input = '[1, 2, 3]';
      const result = validateJSON(input);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual([1, 2, 3]);
    });

    it('should handle empty JSON object', () => {
      const input = '{}';
      const result = validateJSON(input);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual({});
    });
  });

  describe('validateSentryEvent', () => {
    it('should validate valid Sentry event with event_id', () => {
      const event = {
        event_id: '123e4567-e89b-12d3-a456-426614174000',
        timestamp: '2026-01-22T12:00:00.000Z',
      };
      const result = validateSentryEvent(event);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(event);
    });

    it('should validate valid Sentry event with exception', () => {
      const event = {
        exception: {
          values: [{
            type: 'Error',
            value: 'Test error',
          }],
        },
      };
      const result = validateSentryEvent(event);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(event);
    });

    it('should validate valid Sentry event with message', () => {
      const event = {
        message: 'Test message',
        level: 'info',
      };
      const result = validateSentryEvent(event);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(event);
    });

    it('should reject non-object event', () => {
      const event = 'not an object';
      const result = validateSentryEvent(event);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Event must be an object');
    });

    it('should reject null event', () => {
      const event = null;
      const result = validateSentryEvent(event);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject event without required fields', () => {
      const event = {
        timestamp: '2026-01-22T12:00:00.000Z',
      };
      const result = validateSentryEvent(event);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('valid Sentry event');
    });

    it('should validate event with all common fields', () => {
      const event = {
        event_id: '123e4567-e89b-12d3-a456-426614174000',
        timestamp: '2026-01-22T12:00:00.000Z',
        level: 'error',
        platform: 'javascript',
        exception: {
          values: [{
            type: 'Error',
            value: 'Test error',
          }],
        },
        contexts: {
          browser: {
            name: 'Chrome',
            version: '120.0.0',
          },
        },
      };
      const result = validateSentryEvent(event);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(event);
    });
  });
});
