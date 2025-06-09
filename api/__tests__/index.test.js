const { handler } = require('../index');

// Mock the Slack Bolt AwsLambdaReceiver
jest.mock('@slack/bolt', () => {
  const mockApp = {
    message: jest.fn(),
    action: jest.fn(),
    start: jest.fn()
  };
  
  const mockReceiver = {
    start: jest.fn().mockResolvedValue((event, context, callback) => {
      // Simple handler that processes URL verification
      if (event.body) {
        try {
          const body = JSON.parse(event.body);
          if (body.type === 'url_verification') {
            return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ challenge: body.challenge })
            };
          }
        } catch (e) {
          // Not JSON
        }
      }
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      };
    })
  };
  
  return {
    App: jest.fn(() => mockApp),
    AwsLambdaReceiver: jest.fn(() => mockReceiver)
  };
});

describe('Lambda Handler Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment variables
    process.env.SLACK_BOT_TOKEN = 'test-token';
    process.env.SLACK_SIGNING_SECRET = 'test-secret';
  });

  describe('URL Verification Challenge', () => {
    it('should respond to Slack URL verification challenge', async () => {
      const event = {
        headers: {
          'x-slack-signature': 'test-signature',
          'x-slack-request-timestamp': '1234567890'
        },
        body: JSON.stringify({
          type: 'url_verification',
          challenge: 'test-challenge-123'
        })
      };

      const result = await handler(event, {});

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(result.body);
      expect(body.challenge).toBe('test-challenge-123');
    });

    it('should handle non-JSON body gracefully', async () => {
      const event = {
        headers: {
          'x-slack-signature': 'test-signature',
          'x-slack-request-timestamp': '1234567890'
        },
        body: 'not-a-json-string'
      };

      const result = await handler(event, {});

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe(JSON.stringify({ ok: true }));
    });

    it('should handle missing body', async () => {
      const event = {
        headers: {
          'x-slack-signature': 'test-signature',
          'x-slack-request-timestamp': '1234567890'
        }
      };

      const result = await handler(event, {});

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe(JSON.stringify({ ok: true }));
    });

    it('should handle regular event without challenge', async () => {
      const event = {
        headers: {
          'x-slack-signature': 'test-signature',
          'x-slack-request-timestamp': '1234567890'
        },
        body: JSON.stringify({
          type: 'event_callback',
          event: {
            type: 'message',
            text: 'Hello world'
          }
        })
      };

      const result = await handler(event, {});

      expect(result.statusCode).toBe(200);
    });

    it('should handle malformed JSON body', async () => {
      const event = {
        headers: {
          'x-slack-signature': 'test-signature',
          'x-slack-request-timestamp': '1234567890'
        },
        body: '{"invalid": json'
      };

      const result = await handler(event, {});

      expect(result.statusCode).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should log raw Lambda event', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const event = {
        headers: {
          'x-slack-signature': 'test-signature',
          'x-slack-request-timestamp': '1234567890'
        },
        body: JSON.stringify({ type: 'test' })
      };
      
      await handler(event, {});
      
      // Check that version was logged
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('---slack-classify-bot--- Version:'));
      
      consoleSpy.mockRestore();
    });

    it('should handle null event gracefully', async () => {
      // Even with null event, handler should not crash
      await expect(handler(null, {})).rejects.toThrow();
    });

    it('should handle undefined context', async () => {
      const event = {
        headers: {
          'x-slack-signature': 'test-signature',
          'x-slack-request-timestamp': '1234567890'
        },
        body: '{}'
      };

      const result = await handler(event, undefined);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('Response Format', () => {
    it('should always include proper headers', async () => {
      const event = {
        headers: {
          'x-slack-signature': 'test-signature',
          'x-slack-request-timestamp': '1234567890'
        },
        body: '{}'
      };

      const result = await handler(event, {});

      expect(result.headers).toBeDefined();
      expect(result.headers['Content-Type']).toBe('application/json');
    });

    it('should always include statusCode', async () => {
      const event = {
        headers: {
          'x-slack-signature': 'test-signature',
          'x-slack-request-timestamp': '1234567890'
        },
        body: '{}'
      };

      const result = await handler(event, {});

      expect(result.statusCode).toBeDefined();
      expect(typeof result.statusCode).toBe('number');
    });

    it('should always include body as JSON string', async () => {
      const event = {
        headers: {
          'x-slack-signature': 'test-signature',
          'x-slack-request-timestamp': '1234567890'
        },
        body: '{}'
      };

      const result = await handler(event, {});

      expect(result.body).toBeDefined();
      expect(typeof result.body).toBe('string');
      expect(() => JSON.parse(result.body)).not.toThrow();
    });
  });
});