const axios = require('axios');
const { N8nIntegration, classifyMessage } = require('../n8n-integration');

// Mock axios
jest.mock('axios');

describe('N8nIntegration', () => {
  let n8nIntegration;
  const mockN8nEndpoint = 'https://n8n.example.com';

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Create new instance
    n8nIntegration = new N8nIntegration(mockN8nEndpoint);
  });

  describe('constructor', () => {
    it('should initialize with n8n endpoint', () => {
      expect(n8nIntegration.n8nEndpoint).toBe(mockN8nEndpoint);
    });
  });

  describe('sendClassification', () => {
    const mockSlackEvent = {
      type: 'message',
      text: 'This is an urgent bug report',
      user: 'U12345',
      channel: 'C12345',
      ts: '1234567890.123456'
    };

    it('should send classification data to n8n webhook', async () => {
      const mockResponse = { data: { success: true, id: 'msg123' } };
      axios.post.mockResolvedValueOnce(mockResponse);

      const result = await n8nIntegration.sendClassification(mockSlackEvent, 'urgent');

      expect(axios.post).toHaveBeenCalledWith(
        `${mockN8nEndpoint}/webhook/slack-classify`,
        {
          type: 'event_callback',
          event: mockSlackEvent,
          classification: 'urgent',
          timestamp: expect.any(String)
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      expect(result).toEqual(mockResponse.data);
    });

    it('should send event without classification when null', async () => {
      const mockResponse = { data: { success: true } };
      axios.post.mockResolvedValueOnce(mockResponse);

      await n8nIntegration.sendClassification(mockSlackEvent, null);

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          classification: null
        }),
        expect.any(Object)
      );
    });

    it('should handle n8n endpoint errors', async () => {
      const error = new Error('Connection timeout');
      axios.post.mockRejectedValueOnce(error);

      await expect(n8nIntegration.sendClassification(mockSlackEvent, 'bug')).rejects.toThrow(error);
    });

    it('should handle network timeouts', async () => {
      const timeoutError = new Error('timeout of 10000ms exceeded');
      timeoutError.code = 'ECONNABORTED';
      axios.post.mockRejectedValueOnce(timeoutError);

      await expect(n8nIntegration.sendClassification(mockSlackEvent)).rejects.toThrow(timeoutError);
    });

    it('should include proper timestamp in ISO format', async () => {
      const mockResponse = { data: { success: true } };
      axios.post.mockResolvedValueOnce(mockResponse);

      await n8nIntegration.sendClassification(mockSlackEvent);

      const callArgs = axios.post.mock.calls[0][1];
      expect(callArgs.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('sendAnalytics', () => {
    const mockAnalyticsData = {
      event_type: 'message_classified',
      classification: 'urgent',
      user_id: 'U12345',
      channel_id: 'C12345',
      confidence: 0.9
    };

    it('should send analytics data to n8n webhook', async () => {
      const mockResponse = { data: { success: true, analytics_id: 'an123' } };
      axios.post.mockResolvedValueOnce(mockResponse);

      const result = await n8nIntegration.sendAnalytics(mockAnalyticsData);

      expect(axios.post).toHaveBeenCalledWith(
        `${mockN8nEndpoint}/webhook/slack-analytics`,
        {
          type: 'analytics',
          data: mockAnalyticsData,
          timestamp: expect.any(String)
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      expect(result).toEqual(mockResponse.data);
    });

    it('should handle analytics endpoint errors', async () => {
      const error = new Error('Analytics service unavailable');
      axios.post.mockRejectedValueOnce(error);

      await expect(n8nIntegration.sendAnalytics(mockAnalyticsData)).rejects.toThrow(error);
    });

    it('should handle empty analytics data', async () => {
      const mockResponse = { data: { success: true } };
      axios.post.mockResolvedValueOnce(mockResponse);

      const result = await n8nIntegration.sendAnalytics({});

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          data: {}
        }),
        expect.any(Object)
      );

      expect(result).toEqual(mockResponse.data);
    });

    it('should handle HTTP error responses', async () => {
      const error = new Error('Request failed with status code 500');
      error.response = {
        status: 500,
        data: { error: 'Internal server error' }
      };
      axios.post.mockRejectedValueOnce(error);

      await expect(n8nIntegration.sendAnalytics(mockAnalyticsData)).rejects.toThrow(error);
    });
  });
});

describe('classifyMessage', () => {
  describe('category classification', () => {
    it('should classify urgent messages', () => {
      const testCases = [
        'This is urgent!',
        'Critical issue in production',
        'Emergency deployment needed',
        'Please fix ASAP',
        'URGENT: Server down'
      ];

      testCases.forEach(text => {
        const result = classifyMessage(text);
        expect(result.category).toBe('urgent');
        expect(result.confidence).toBe(0.9);
      });
    });

    it('should classify bug messages', () => {
      const testCases = [
        'Found a bug in the code',
        'System issue detected',
        'Application error occurred',
        'Login fails consistently',
        'The feature is broken'
      ];

      testCases.forEach(text => {
        const result = classifyMessage(text);
        expect(result.category).toBe('bug');
        expect(result.confidence).toBe(0.8);
      });
    });

    it('should classify feature request messages', () => {
      const testCases = [
        'Feature request: dark mode',
        'Can we add this enhancement?',
        'I have an idea for improvement',
        'New feature suggestion'
      ];

      testCases.forEach(text => {
        const result = classifyMessage(text);
        expect(result.category).toBe('feature-request');
        expect(result.confidence).toBe(0.7);
      });
    });

    it('should classify question messages', () => {
      const testCases = [
        'Question about the API',
        'Can you help me?',
        'How do I use this?',
        'What is the process?',
        'Why is this happening?'
      ];

      testCases.forEach(text => {
        const result = classifyMessage(text);
        expect(result.category).toBe('question');
        expect(result.confidence).toBe(0.7);
      });
    });

    it('should classify feedback messages', () => {
      const testCases = [
        'Here is my feedback',
        'My feedback about the system'
      ];

      testCases.forEach(text => {
        const result = classifyMessage(text);
        expect(result.category).toBe('feedback');
        expect(result.confidence).toBe(0.6);
      });

      // 'Suggestion for improvement' matches 'suggestion' which is feedback
      const result = classifyMessage('Suggestion for improvement');
      expect(result.category).toBe('feedback');
      expect(result.confidence).toBe(0.6);
      
      // 'My opinion on this feature' matches 'feature' which is feature-request
      const featureResult = classifyMessage('My opinion on this feature');
      expect(featureResult.category).toBe('feature-request');
      expect(featureResult.confidence).toBe(0.7);
    });

    it('should classify performance messages', () => {
      const testCases = [
        'Performance degradation detected',
        'Need optimization here'
      ];

      testCases.forEach(text => {
        const result = classifyMessage(text);
        expect(result.category).toBe('performance');
        expect(result.confidence).toBe(0.8);
      });

      // 'Performance issue detected' matches 'issue' which is bug (comes before performance in rules)
      // 'The app is running slow' matches 'slow' which is performance
      const slowResult = classifyMessage('The app is running slow');
      expect(slowResult.category).toBe('performance');
      expect(slowResult.confidence).toBe(0.8);

      const issueResult = classifyMessage('Performance issue detected');
      expect(issueResult.category).toBe('bug');
      expect(issueResult.confidence).toBe(0.8);
    });

    it('should classify security messages', () => {
      const testCases = [
        'Security vulnerability found',
        'Potential security breach',
        'Found a vulnerability'
      ];

      testCases.forEach(text => {
        const result = classifyMessage(text);
        expect(result.category).toBe('security');
        expect(result.confidence).toBe(0.9);
      });
    });

    it('should classify documentation messages', () => {
      const testCases = [
        'Documentation needs update',
        'Update the docs please',
        'README is outdated'
      ];

      testCases.forEach(text => {
        const result = classifyMessage(text);
        expect(result.category).toBe('documentation');
        expect(result.confidence).toBe(0.7);
      });

      // 'Need help with documentation' matches 'help' which is question (comes before documentation in rules)
      const helpResult = classifyMessage('Need help with documentation');
      expect(helpResult.category).toBe('question');
      expect(helpResult.confidence).toBe(0.7);
    });
  });

  describe('edge cases', () => {
    it('should return general category for empty or null text', () => {
      expect(classifyMessage('')).toEqual({ category: 'general', confidence: 0.5 });
      expect(classifyMessage(null)).toEqual({ category: 'general', confidence: 0.5 });
      expect(classifyMessage(undefined)).toEqual({ category: 'general', confidence: 0.5 });
    });

    it('should return general category for unmatched text', () => {
      const testCases = [
        'Hello world',
        'Good morning team',
        'Thanks for the update',
        'Meeting at 3pm',
        '12345'
      ];

      testCases.forEach(text => {
        const result = classifyMessage(text);
        expect(result.category).toBe('general');
        expect(result.confidence).toBe(0.5);
      });
    });

    it('should be case insensitive', () => {
      expect(classifyMessage('URGENT MESSAGE')).toEqual({ category: 'urgent', confidence: 0.9 });
      expect(classifyMessage('urgent message')).toEqual({ category: 'urgent', confidence: 0.9 });
      expect(classifyMessage('UrGeNt MeSsAgE')).toEqual({ category: 'urgent', confidence: 0.9 });
    });

    it('should match keywords within larger text', () => {
      const result = classifyMessage('The system has a critical bug that needs urgent attention');
      // Should match 'urgent' first as it appears in the rules before 'bug'
      expect(result.category).toBe('urgent');
      expect(result.confidence).toBe(0.9);
    });

    it('should prioritize first matching rule', () => {
      // Text contains both 'error' (bug) and 'help' (question)
      const result = classifyMessage('Error occurred, need help fixing it');
      expect(result.category).toBe('bug');
      expect(result.confidence).toBe(0.8);
    });

    it('should handle special characters', () => {
      const testCases = [
        'Bug! @#$%^&*()',
        '***URGENT***',
        'Question???',
        'Performance << slow >>',
        'Security [CRITICAL]'
      ];

      expect(classifyMessage(testCases[0]).category).toBe('bug');
      expect(classifyMessage(testCases[1]).category).toBe('urgent');
      expect(classifyMessage(testCases[2]).category).toBe('question');
      expect(classifyMessage(testCases[3]).category).toBe('performance');
      // 'Security [CRITICAL]' matches 'critical' which is urgent (comes before security in rules)
      expect(classifyMessage(testCases[4]).category).toBe('urgent');
    });

    it('should handle very long text', () => {
      const longText = 'This is a very long message '.repeat(100) + 'with a bug in it';
      const result = classifyMessage(longText);
      expect(result.category).toBe('bug');
      expect(result.confidence).toBe(0.8);
    });

    it('should handle unicode and emoji', () => {
      const testCases = [
        '🚨 Urgent issue 🚨',
        '🐛 Found a bug',
        '❓ Question about the feature',
        '💡 Feature idea'
      ];

      expect(classifyMessage(testCases[0]).category).toBe('urgent');
      expect(classifyMessage(testCases[1]).category).toBe('bug');
      // '❓ Question about the feature' matches 'feature' which is feature-request (comes before question in rules)
      expect(classifyMessage(testCases[2]).category).toBe('feature-request');
      expect(classifyMessage(testCases[3]).category).toBe('feature-request');
    });
  });

  describe('confidence levels', () => {
    it('should return correct confidence levels for each category', () => {
      const expectations = [
        { text: 'urgent matter', category: 'urgent', confidence: 0.9 },
        { text: 'security vulnerability', category: 'security', confidence: 0.9 },
        { text: 'bug found', category: 'bug', confidence: 0.8 },
        { text: 'performance problem', category: 'performance', confidence: 0.8 },
        { text: 'feature request', category: 'feature-request', confidence: 0.7 },
        { text: 'question here', category: 'question', confidence: 0.7 },
        { text: 'documentation update', category: 'documentation', confidence: 0.7 },
        { text: 'feedback provided', category: 'feedback', confidence: 0.6 },
        { text: 'random text', category: 'general', confidence: 0.5 }
      ];

      expectations.forEach(({ text, category, confidence }) => {
        const result = classifyMessage(text);
        expect(result.category).toBe(category);
        expect(result.confidence).toBe(confidence);
      });
    });
  });
});