const axios = require('axios');

class AirtableIntegration {
  constructor(n8nEndpoint) {
    this.n8nEndpoint = n8nEndpoint;
    this.airtableBase = process.env.AIRTABLE_BASE;
    this.airtableToken = process.env.AIRTABLE_TOKEN;
  }

  /**
   * Get all projects from Airtable
   * @returns {Promise<Array>} - List of projects
   */
  async getProjects() {
    try {
      const response = await axios.get(
        `https://api.airtable.com/v0/${this.airtableBase}/project_id`,
        {
          headers: {
            'Authorization': `Bearer ${this.airtableToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      const projects = response.data.records.map(record => ({
        id: record.id,
        name: record.fields.Name,
        owner: record.fields.owner,
        repo: record.fields.repo,
        path_prefix: record.fields.path_prefix,
        description: record.fields.description || ''
      }));

      console.log(`Found ${projects.length} projects in Airtable`);
      return projects;
    } catch (error) {
      console.error('Error fetching projects from Airtable:', error.message);
      throw new Error(`Failed to fetch projects: ${error.message}`);
    }
  }

  /**
   * Create interactive buttons for project selection
   * @param {Array} projects - List of projects
   * @param {string} fileId - Slack file ID
   * @returns {Object} - Slack blocks for interactive message
   */
  createProjectSelectionBlocks(projects, fileId) {
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "📁 *プロジェクトを選択してください*\n\nアップロードされたファイルをどのプロジェクトに関連付けますか？"
        }
      },
      {
        type: "divider"
      }
    ];

    // Add project buttons (max 5 per action block)
    const projectChunks = this.chunkArray(projects, 5);
    
    projectChunks.forEach(chunk => {
      const actionBlock = {
        type: "actions",
        elements: chunk.map(project => ({
          type: "button",
          text: {
            type: "plain_text",
            text: `${project.name}`,
            emoji: true
          },
          value: JSON.stringify({
            projectId: project.id,
            projectName: project.name,
            fileId: fileId
          }),
          action_id: `select_project_${project.id}`,
          style: "primary"
        }))
      };
      blocks.push(actionBlock);
    });

    // Add cancel button
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "❌ キャンセル",
            emoji: true
          },
          value: JSON.stringify({ fileId: fileId }),
          action_id: "cancel_project_selection",
          style: "danger"
        }
      ]
    });

    return blocks;
  }

  /**
   * Helper function to chunk array into smaller arrays
   * @param {Array} array - Array to chunk
   * @param {number} size - Chunk size
   * @returns {Array} - Array of chunks
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Process file with selected project
   * @param {Object} params - Processing parameters
   * @returns {Promise<Object>} - Processing result
   */
  async processFileWithProject({ fileContent, fileName, projectId, userId, channelId, ts }) {
    try {
      // Get project details from Airtable
      const projectResponse = await axios.get(
        `https://api.airtable.com/v0/${this.airtableBase}/project_id/${projectId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.airtableToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const project = projectResponse.data.fields;

      // Prepare payload for n8n workflow
      const payload = {
        type: 'event_callback',
        event: {
          type: 'file_shared',
          file_id: `manual_${Date.now()}`,
          user: userId,
          channel: channelId,
          ts: ts,
          files: [{
            name: fileName,
            filetype: 'txt',
            content: fileContent
          }]
        },
        project: {
          id: projectId,
          name: project.Name,
          owner: project.owner,
          repo: project.repo,
          path_prefix: project.path_prefix,
          branch: project.branch || 'main'
        },
        timestamp: new Date().toISOString()
      };

      const response = await axios.post(
        `${this.n8nEndpoint}`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 seconds for file processing
        }
      );

      console.log('Successfully processed file with project:', response.data);
      return {
        success: true,
        data: response.data,
        project: project
      };
    } catch (error) {
      console.error('Error processing file with project:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send file upload event to n8n workflow
   * @param {Object} slackEvent - The Slack file upload event
   * @returns {Promise<Object>} - Response from n8n
   */
  async sendFileUpload(slackEvent) {
    try {
      const payload = {
        type: 'event_callback',
        event: slackEvent,
        timestamp: new Date().toISOString()
      };

      const response = await axios.post(
        `${this.n8nEndpoint}`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 15000 // 15 seconds timeout for file processing
        }
      );

      console.log('Successfully sent file upload to n8n:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error sending file upload to n8n:', error.message);
      throw error;
    }
  }

  /**
   * Check if file is supported for processing
   * @param {Object} file - Slack file object
   * @returns {boolean} - Whether file is supported
   */
  isSupportedFile(file) {
    if (!file || !file.filetype) {
      return false;
    }
    
    // Support only .txt files for now
    return file.filetype === 'txt';
  }

  /**
   * Extract project ID from filename
   * @param {string} filename - The filename
   * @returns {string} - Extracted project ID
   */
  extractProjectId(filename) {
    if (!filename) return '';
    
    // Remove .txt extension
    let projectId = filename.replace(/\.txt$/i, '');
    
    // Clean up the project ID
    projectId = projectId.trim();
    
    return projectId;
  }

  /**
   * Send analytics about file processing
   * @param {Object} analyticsData - Analytics data
   * @returns {Promise<Object>} - Response from n8n
   */
  async sendAnalytics(analyticsData) {
    try {
      const payload = {
        type: 'analytics',
        data: {
          ...analyticsData,
          source: 'airtable-integration'
        },
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

  /**
   * Validate Airtable project ID format
   * @param {string} projectId - Project ID to validate
   * @returns {boolean} - Whether project ID is valid
   */
  isValidProjectId(projectId) {
    if (!projectId || typeof projectId !== 'string') {
      return false;
    }
    
    // Expected format: "ORGANIZATION / OWNER / REPO / PATH"
    const parts = projectId.split('/').map(part => part.trim());
    
    // Should have at least 3 parts (org/owner/repo)
    return parts.length >= 3 && parts.every(part => part.length > 0);
  }

  /**
   * Get file processing status
   * @param {string} fileId - Slack file ID
   * @returns {Promise<Object>} - File processing status
   */
  async getFileStatus(fileId) {
    try {
      // This would typically query a database or cache
      // For now, return a mock response
      return {
        fileId: fileId,
        status: 'processing',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting file status:', error.message);
      throw error;
    }
  }
}

module.exports = AirtableIntegration;