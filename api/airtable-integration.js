const axios = require('axios');
const Airtable = require('airtable');

class AirtableIntegration {
  constructor() {
    if (!process.env.AIRTABLE_TOKEN || !process.env.AIRTABLE_BASE) {
      throw new Error("Airtable API Key or Base ID is not configured in environment variables.");
    }
    this.airtable = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(
      process.env.AIRTABLE_BASE
    );
    this.tableName = process.env.AIRTABLE_TABLE_NAME || 'Projects';
  }

  /**
   * Get all projects from Airtable
   * @returns {Promise<Array>} - List of projects
   */
  async getProjects() {
    try {
      const response = await axios.get(
        `https://api.airtable.com/v0/${this.airtable.base}/project_id`,
        {
          headers: {
            'Authorization': `Bearer ${this.airtable.apiKey}`,
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
        description: record.fields.description || '',
        emoji: record.fields.emoji || '📁' // デフォルト絵文字
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
  createProjectSelectionBlocks(projects, fileId, fileData) {
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "🎯 *プロジェクトを選択してください* 🎯\n\n📂 アップロードされたファイルをどのプロジェクトに関連付けますか？\n各プロジェクトの絵文字を参考にしてください！"
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
            text: `${project.emoji} ${project.name}`,
            emoji: true
          },
          value: JSON.stringify({
            projectId: project.id,
            projectName: project.name,
            fileId: fileId,
            fileName: fileData.fileName,
            channelId: fileData.channelId,
            classificationResult: fileData.classificationResult
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
            text: "閉じる",
            emoji: true
          },
          value: JSON.stringify({ fileId: fileId }),
          action_id: "cancel_project_selection"
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
   * @param {string} params.fileContent - File content
   * @param {string} params.fileName - File name
   * @param {string} params.projectId - Selected project ID
   * @param {string} params.userId - User ID who uploaded the file
   * @param {string} params.channelId - Channel ID
   * @param {string} params.ts - Timestamp
   * @returns {Promise<Object>} - Processing result
   */
  async processFileWithProject({ fileContent, fileName, projectId, userId, channelId, ts }) {
    try {
      console.log(`Processing file ${fileName} with project ${projectId}`);

      // Get project details
      const projects = await this.getProjects();
      const selectedProject = projects.find(p => p.id === projectId);
      
      if (!selectedProject) {
        throw new Error(`Project with ID ${projectId} not found`);
      }

      console.log('Selected project:', selectedProject);

      // Prepare payload for n8n workflow
      const payload = {
        type: 'file_processing',
        file: {
          name: fileName,
          content: fileContent,
          uploaded_by: userId,
          channel: channelId,
          timestamp: ts
        },
        project: {
          id: projectId,
          name: selectedProject.name,
          owner: selectedProject.owner,
          repo: selectedProject.repo,
          path_prefix: selectedProject.path_prefix,
          branch: selectedProject.branch || 'main'
        },
        timestamp: new Date().toISOString()
      };

      console.log('Sending payload to n8n:', JSON.stringify(payload, null, 2));

      // Send to n8n workflow
      const response = await axios.post(
        this.n8nEndpoint,
        payload,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 seconds timeout for file processing
        }
      );

      console.log('n8n response:', response.data);

      return {
        success: true,
        project: selectedProject,
        n8nResponse: response.data
      };

    } catch (error) {
      console.error('Error processing file with project:', error.message);
      return {
        success: false,
        error: error.message,
        project: null
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

  // Method to get the list of projects from Airtable
  async getProjectList(logger) {
    try {
      logger.info(`Fetching projects from Airtable table: ${this.tableName}`);
      const records = await this.airtable(this.tableName).select({
        // すべてのフィールドを取得してデバッグ
        maxRecords: 100,
        view: 'Grid view'
      }).all();

      if (!records || records.length === 0) {
        logger.warn('No projects found in Airtable.');
        return [];
      }

      // デバッグ用：最初のレコードのフィールドを確認
      if (records.length > 0) {
        logger.info('First record fields:', Object.keys(records[0].fields));
        logger.info('First record data:', records[0].fields);
      }

      const projectOptions = records.map(record => ({
        text: record.get('Name') || record.id,
        value: record.id,  // AirtableのレコードIDを使用
      }));

      return projectOptions;
    } catch (error) {
      console.error('Error fetching project list from Airtable:', error.message);
      logger.error('Airtable error details:', {
        statusCode: error.statusCode,
        error: error.error,
        message: error.message,
        tableName: this.tableName,
        baseId: process.env.AIRTABLE_BASE
      });
      return [];
    }
  }

  // Method to process the file with the selected project
  async processFileWithProject(action, body, client, logger, fileDataStore) {
    logger.info('processFileWithProject called with action.value:', action.value);
    
    const actionData = JSON.parse(action.value);
    const { projectId, projectName, fileId, fileName, classificationResult, channelId } = actionData;
    const originalMessageTs = body.message.ts;

    logger.info('Parsed action data:', actionData);

    if (!projectId) {
      logger.error('Project ID is not provided');
      return;
    }

    try {
      // Find the Airtable record for the selected project
      // projectIdはAirtableのレコードIDなので、直接取得
      const projectRecord = await this.airtable(this.tableName).find(projectId);

      if (!projectRecord) {
        throw new Error(`Project with ID ${projectId} not found in Airtable.`);
      }

      // Get project details from Airtable
      const projectFields = projectRecord.fields;
      
      // Try to get file content from fileDataStore or re-download it
      let fileContent = null;
      try {
        // First try fileDataStore
        const fileData = fileDataStore.get(fileId) || fileDataStore.get(`${fileId}_${channelId}`);
        if (fileData && fileData.content) {
          fileContent = fileData.content;
          logger.info('File content retrieved from store');
        } else {
          // If not in store, re-download the file
          logger.info('File not in store, re-downloading from Slack');
          const fileInfo = await client.files.info({ file: fileId });
          
          if (fileInfo.file.content) {
            fileContent = fileInfo.file.content;
          } else if (fileInfo.file.url_private_download) {
            const axios = require('axios');
            const response = await axios.get(fileInfo.file.url_private_download, {
              headers: {
                'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
              },
              responseType: 'text'
            });
            fileContent = response.data;
          }
          logger.info('File content re-downloaded successfully');
        }
      } catch (error) {
        logger.error('Failed to get file content:', error);
      }
      
      // Prepare payload for n8n workflow
      const n8nPayload = {
        type: 'file_processing',
        file: {
          id: fileId,
          name: fileName,
          channel: channelId,
          content: fileContent  // Include the actual file content
        },
        project: {
          id: projectId,
          name: projectName,
          owner: projectFields.owner,
          repo: projectFields.repo,
          path_prefix: projectFields.path_prefix,
          branch: projectFields.branch || 'main'
        },
        classification: classificationResult,
        timestamp: new Date().toISOString()
      };

      logger.info('Sending to n8n workflow:', n8nPayload);

      // Send to n8n workflow
      const n8nEndpoint = process.env.N8N_AIRTABLE_ENDPOINT || process.env.N8N_ENDPOINT;
      let n8nResponse = null;
      
      try {
        const response = await axios.post(
          `${n8nEndpoint}/slack-airtable`,
          n8nPayload,
          {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );
        n8nResponse = response.data;
        logger.info('n8n workflow response:', n8nResponse);
      } catch (n8nError) {
        logger.error('Failed to send to n8n workflow:', n8nError.message);
        logger.info('n8n endpoint attempted:', `${n8nEndpoint}/slack-airtable`);
        // Continue execution even if n8n fails
      }

      // Update the original Slack message to show confirmation
      const isSuccess = n8nResponse && n8nResponse.status === 'success';
      const statusEmoji = isSuccess ? '✅' : '⚠️';
      let statusText = '';
      let additionalInfo = '';
      
      if (isSuccess && n8nResponse.data) {
        // n8n returned successful response with GitHub data
        statusText = 'ファイルをGitHubにコミットしました！';
        // Construct GitHub URL from the data
        const githubUrl = `https://github.com/${n8nResponse.data.owner}/${n8nResponse.data.repo}/blob/${projectFields.branch || 'main'}/${n8nResponse.data.filePath}`;
        additionalInfo = `\n🔗 <${githubUrl}|GitHubで確認>`;
      } else if (n8nResponse) {
        // n8n returned but with error or different format
        statusText = n8nResponse.message || 'ファイルをn8nワークフローに送信しました！';
      } else {
        statusText = 'プロジェクトを選択しました（n8nへの送信は失敗しました）';
      }
      
      const confirmationBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${statusEmoji} ${statusText}${additionalInfo}\n\n🎯 プロジェクト: ${projectName}\n📂 ファイル: ${fileName}\n🔧 リポジトリ: ${projectFields.owner}/${projectFields.repo}\n📁 保存先: ${n8nResponse?.data?.filePath || projectFields.path_prefix + fileName}`
          }
        }
      ];
      
      // Add commit details if available
      if (n8nResponse?.data?.commitMessage) {
        confirmationBlocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `💬 コミットメッセージ: ${n8nResponse.data.commitMessage}\n🌿 ブランチ: ${projectFields.branch || 'main'}`
          }
        });
      }
      
      confirmationBlocks.push({
        type: "divider"
      });

      // Send confirmation blocks to the channel
      await client.chat.postMessage({
        channel: channelId,
        blocks: confirmationBlocks,
        text: `ファイルをn8nワークフローに送信しました: ${fileName} → ${projectName}`
      });
    } catch (error) {
      logger.error('Error updating Airtable or Slack:', error);
      // Try to send an ephemeral message to the user on failure
      try {
        await client.chat.postEphemeral({
          channel: channelId,
          user: body.user.id,
          text: `n8nワークフローへの送信中にエラーが発生しました: ${error.message}`,
        });
      } catch (ephemeralError) {
        logger.error('Failed to send ephemeral error message:', ephemeralError);
      }
    } finally {
      // Clean up the in-memory store (not needed anymore since we don't use it)
      // fileDataStore.delete(originalMessageTs);
    }
  }
}

module.exports = AirtableIntegration;