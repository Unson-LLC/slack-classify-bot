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
   * Classify Slack message content
   * @param {string} text - The message text
   * @returns {string} - Classification category
   */
  classifyMessage(text) {
    if (!text) return 'general';
    
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('bug') || lowerText.includes('issue') || lowerText.includes('error')) {
      return 'bug';
    } else if (lowerText.includes('feature') || lowerText.includes('request') || lowerText.includes('enhancement')) {
      return 'feature-request';
    } else if (lowerText.includes('question') || lowerText.includes('help') || lowerText.includes('how')) {
      return 'question';
    } else if (lowerText.includes('feedback') || lowerText.includes('suggestion')) {
      return 'feedback';
    } else if (lowerText.includes('urgent') || lowerText.includes('critical') || lowerText.includes('emergency')) {
      return 'urgent';
    } else if (lowerText.includes('performance') || lowerText.includes('slow') || lowerText.includes('optimization')) {
      return 'performance';
    } else if (lowerText.includes('security') || lowerText.includes('vulnerability') || lowerText.includes('breach')) {
      return 'security';
    } else if (lowerText.includes('documentation') || lowerText.includes('docs') || lowerText.includes('readme')) {
      return 'documentation';
    }
    
    return 'general';
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

module.exports = N8nIntegration; 