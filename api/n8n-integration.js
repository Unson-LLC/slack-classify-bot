const axios = require('axios');

class N8nIntegration {
  constructor(n8nEndpoint) {
    this.n8nEndpoint = n8nEndpoint;
  }

  /**
   * Send classified Slack message data to n8n workflow
   * @param {Object} slackEvent - The Slack event data
   * @param {string} classification - The classification category
   * @returns {Promise<Object>} - Response from n8n
   */
  async sendClassification(slackEvent, classification = null) {
    try {
      const payload = {
        type: 'event_callback',
        event: slackEvent,
        classification: classification,
        timestamp: new Date().toISOString()
      };

      const response = await axios.post(
        `${this.n8nEndpoint}/webhook/slack-classify`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 seconds timeout
        }
      );

      console.log('Successfully sent data to n8n:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error sending data to n8n:', error.message);
      throw error;
    }
  }

  /**
   * Send analytics data to n8n
   * @param {Object} analyticsData - Analytics data
   * @returns {Promise<Object>} - Response from n8n
   */
  async sendAnalytics(analyticsData) {
    try {
      const payload = {
        type: 'analytics',
        data: analyticsData,
        timestamp: new Date().toISOString()
      };

      const response = await axios.post(
        `${this.n8nEndpoint}/webhook/slack-analytics`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error sending analytics to n8n:', error.message);
      throw error;
    }
  }
}

/**
 * Classify Slack message content
 * @param {string} text - The message text
 * @returns {string} - Classification category
 */
function classifyMessage(text) {
  if (!text) return { category: 'general', confidence: 0.5 };
  
  const lowerText = text.toLowerCase();
  
  const rules = [
    { category: 'urgent', keywords: ['urgent', 'critical', 'emergency', 'asap'], confidence: 0.9 },
    { category: 'bug', keywords: ['bug', 'issue', 'error', 'fail', 'broken'], confidence: 0.8 },
    { category: 'feature-request', keywords: ['feature', 'request', 'enhancement', 'idea'], confidence: 0.7 },
    { category: 'question', keywords: ['question', 'help', 'how', 'what', 'why'], confidence: 0.7 },
    { category: 'feedback', keywords: ['feedback', 'suggestion', 'opinion'], confidence: 0.6 },
    { category: 'performance', keywords: ['performance', 'slow', 'optimization'], confidence: 0.8 },
    { category: 'security', keywords: ['security', 'vulnerability', 'breach'], confidence: 0.9 },
    { category: 'documentation', keywords: ['documentation', 'docs', 'readme', 'help'], confidence: 0.7 }
  ];

  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      if (lowerText.includes(keyword)) {
        return { category: rule.category, confidence: rule.confidence };
      }
    }
  }
  
  return { category: 'general', confidence: 0.5 };
}

module.exports = {
  N8nIntegration,
  classifyMessage
}; 