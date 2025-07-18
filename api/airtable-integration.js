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
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE}/project_id`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
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
   * Get Slack channels for a project
   * @param {string} projectId - Project ID
   * @returns {Promise<Array>} - Array of channel IDs
   */
  async getSlackChannelsForProject(projectId) {
    try {
      const record = await this.airtable(this.tableName).find(projectId);
      if (!record) {
        return [];
      }
      
      const channelRecordIds = record.fields.slack_channels || [];
      if (!Array.isArray(channelRecordIds) || channelRecordIds.length === 0) {
        return [];
      }
      
      // Get the actual channel IDs from linked records
      const channelIds = [];
      for (const channelRecordId of channelRecordIds) {
        try {
          const channelRecord = await this.airtable('slack_channels').find(channelRecordId);
          if (channelRecord && channelRecord.fields.channel_id) {
            channelIds.push(channelRecord.fields.channel_id);
          }
        } catch (channelError) {
          console.error(`Error getting channel record ${channelRecordId}:`, channelError.message);
        }
      }
      
      return channelIds;
    } catch (error) {
      console.error('Error getting Slack channels for project:', error.message);
      return [];
    }
  }

  /**
   * Create interactive buttons for channel selection
   * @param {Array} channels - List of channels
   * @param {string} projectId - Project ID
   * @param {string} fileId - Slack file ID
   * @param {Object} fileData - File data
   * @returns {Object} - Slack blocks for interactive message
   */
  createChannelSelectionBlocks(channels, projectId, fileId, fileData, projectName = null) {
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📝 *アップロードされたファイル*\n📄 ファイル名: \`${fileData.fileName}\`\n📅 処理日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
        }
      },
      {
        type: "divider"
      }
    ];

    // 要約がある場合は表示
    if (fileData.summary) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📋 *要約*\n${fileData.summary}`
        }
      });
      blocks.push({
        type: "divider"
      });
    }

    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `✅ *選択されたプロジェクト*\n📂 プロジェクト: *${projectName || projectId}*`
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "変更",
            emoji: true
          },
          value: JSON.stringify({
            fileId: fileId,
            fileName: fileData.fileName,
            channelId: fileData.channelId,
            classificationResult: fileData.classificationResult,
            summary: fileData.summary
          }),
          action_id: "change_project_selection"
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: (channels.length > 0 ? 
            "📢 *チャネルを選択してください* 📢\n\n🎯 議事録を投稿するチャネルを選んでください:" :
            "⚠️ *利用可能なチャネルがありません* ⚠️\n\nこのプロジェクトにはSlackチャネルが設定されていません。")
        }
      },
      {
        type: "divider"
      }
    );

    if (channels.length > 0) {
      // Add channel buttons with max 5 per row
      const channelChunks = this.chunkArray(channels, 5);
      
      channelChunks.forEach(chunk => {
        const actionBlock = {
          type: "actions",
          elements: chunk.map(channel => ({
            type: "button",
            text: {
              type: "plain_text",
              text: `#${channel.name}`,
              emoji: true
            },
            value: JSON.stringify({
              projectId: projectId,
              channelId: channel.id,
              fileId: fileId,
              fileName: fileData.fileName,
              classificationResult: fileData.classificationResult,
              summary: fileData.summary
            }),
            action_id: `select_channel_${channel.id}`,
            style: "primary"
          }))
        };
        blocks.push(actionBlock);
      });
    }

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
          action_id: "cancel_channel_selection"
        }
      ]
    });

    return blocks;
  }

  /**
   * Post meeting minutes to selected Slack channel (summary first, then detailed minutes in thread)
   * @param {Object} client - Slack client
   * @param {string} channelId - Channel ID
   * @param {string} minutes - Meeting minutes content
   * @param {string} fileName - Original file name
   * @param {string} summary - Meeting summary (optional)
   * @returns {Promise<Object>} - Result object
   */
  async postMinutesToChannel(client, channelId, minutes, fileName, summary = null) {
    try {
      // First, post the summary as the main message
      const summaryBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📝 *会議要約: ${fileName}*\n\n_AI生成による要約です_`
          }
        },
        {
          type: "divider"
        }
      ];

      if (summary) {
        summaryBlocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: summary
          }
        });
      } else {
        summaryBlocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: "📋 要約データが利用できません。詳細な議事録は下記のスレッドをご確認ください。"
          }
        });
      }

      summaryBlocks.push(
        {
          type: "divider"
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `💬 _詳細な議事録はこの投稿のスレッドに投稿されます_`
            }
          ]
        }
      );

      // Post the summary first
      const summaryResponse = await client.chat.postMessage({
        channel: channelId,
        text: `📝 会議要約: ${fileName}`,
        blocks: summaryBlocks
      });

      // Then post the detailed minutes as a thread reply
      const detailBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📄 *詳細議事録: ${fileName}*\n\n_AI生成による詳細な議事録です_`
          }
        },
        {
          type: "divider"
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: minutes
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `🤖 _この議事録はAIにより自動生成されました。必要に応じて内容をご確認ください。_`
            }
          ]
        }
      ];

      const detailResponse = await client.chat.postMessage({
        channel: channelId,
        thread_ts: summaryResponse.ts, // Post as thread reply
        text: `📄 詳細議事録: ${fileName}`,
        blocks: detailBlocks
      });

      return {
        success: true,
        summaryMessageTs: summaryResponse.ts,
        detailMessageTs: detailResponse.ts
      };
    } catch (error) {
      console.error('Error posting minutes to channel:', error.message);
      return {
        success: false,
        error: error.message
      };
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
            classificationResult: fileData.classificationResult,
            summary: fileData.summary // Include summary in button value
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
      const n8nEndpoint = process.env.N8N_AIRTABLE_ENDPOINT || process.env.N8N_ENDPOINT;
      if (!n8nEndpoint) {
        throw new Error('N8N_AIRTABLE_ENDPOINT or N8N_ENDPOINT environment variable is not set');
      }
      
      const response = await axios.post(
        n8nEndpoint,
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

      const n8nEndpoint = process.env.N8N_ENDPOINT;
      if (!n8nEndpoint) {
        throw new Error('N8N_ENDPOINT environment variable is not set');
      }
      
      const response = await axios.post(
        n8nEndpoint,
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

      const n8nEndpoint = process.env.N8N_ENDPOINT;
      if (!n8nEndpoint) {
        throw new Error('N8N_ENDPOINT environment variable is not set');
      }
      
      const response = await axios.post(
        `${n8nEndpoint}/webhook/slack-analytics`,
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
      let summary = null;
      try {
        // First try fileDataStore
        const fileData = fileDataStore.get(fileId) || fileDataStore.get(`${fileId}_${channelId}`);
        if (fileData && fileData.content) {
          fileContent = fileData.content;
          summary = fileData.summary; // Get stored summary if available
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
      
      // Generate a formatted filename for GitHub
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Get a meaningful filename from AI based on transcript content
      let aiGeneratedName = '';
      if (fileContent) {
        try {
          const { generateFilename } = require('./llm-integration');
          aiGeneratedName = await generateFilename(fileContent);
          if (aiGeneratedName) {
            logger.info(`AI generated filename: ${aiGeneratedName}`);
          }
        } catch (error) {
          logger.error('Failed to generate filename with AI:', error);
        }
      }
      
      // If AI couldn't generate a good name, use original filename
      if (!aiGeneratedName) {
        const baseFileName = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_');
        aiGeneratedName = baseFileName;
      }
      
      // Create formatted filename: YYYY-MM-DD_meaningful-name.md
      const formattedFileName = `${dateStr}_${aiGeneratedName}.md`;
      
      // Create formatted content with summary at the top
      let formattedContent = fileContent;
      if (summary) {
        // Prepend summary to the content
        formattedContent = `# 議事録: ${aiGeneratedName}\n\n${summary}\n\n---\n\n## 議事録原文\n\n${fileContent}`;
      }
      
      // Prepare payload for n8n workflow
      const n8nPayload = {
        type: 'file_processing',
        file: {
          id: fileId,
          name: fileName,
          formattedName: formattedFileName,  // Add formatted filename
          channel: channelId,
          content: formattedContent,  // Include formatted content with summary
          originalContent: fileContent,  // Keep original content too
          summary: summary  // Include summary separately
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
      // Check for both new format (status: success) and old format (message: Workflow was started)
      const isWorkflowStarted = n8nResponse && (n8nResponse.message === 'Workflow was started' || n8nResponse.message === 'workflow started');
      const isSuccess = n8nResponse && (n8nResponse.status === 'success' || isWorkflowStarted);
      const statusEmoji = isSuccess ? '✅' : '⚠️';
      let statusText = '';
      let additionalInfo = '';
      
      // Check if we got a detailed response with GitHub info
      if (n8nResponse && n8nResponse.data && n8nResponse.status === 'success') {
        // Check if data contains actual values or template expressions
        const hasTemplateExpressions = n8nResponse.data.owner && n8nResponse.data.owner.includes('{{');
        
        if (!hasTemplateExpressions && n8nResponse.data.owner && n8nResponse.data.repo) {
          // Real data from n8n
          const githubUrl = n8nResponse.data.commitUrl || 
            `https://github.com/${n8nResponse.data.owner}/${n8nResponse.data.repo}/blob/${projectFields.branch || 'main'}/${n8nResponse.data.filePath}`;
          
          statusText = 'ファイルをGitHubにコミットしました！';
          additionalInfo = `\n\n📄 GitHubに保存されました:\n• <${githubUrl}|${n8nResponse.data.filePath || formattedFileName}>`;
          
          if (n8nResponse.data.commitMessage) {
            additionalInfo += `\n💬 ${n8nResponse.data.commitMessage}`;
          }
        } else {
          // n8n returned template expressions - show success but warn about configuration
          statusText = 'ファイルをGitHubに送信しました！';
          additionalInfo = '\n\n⚠️ n8nのWebhookレスポンス設定を確認してください（テンプレート変数が評価されていません）';
          logger.warn('n8n returned unevaluated template expressions:', n8nResponse.data);
        }
      } else if (n8nResponse && n8nResponse.github && n8nResponse.github.commit) {
        // Old format with GitHub info
        const githubInfo = n8nResponse.github;
        const commitUrl = `https://github.com/${githubInfo.owner}/${githubInfo.repo}/commit/${githubInfo.commit.sha}`;
        const fileUrl = `https://github.com/${githubInfo.owner}/${githubInfo.repo}/blob/${githubInfo.commit.sha}/${githubInfo.file_path}`;
        
        statusText = 'ファイルをGitHubにコミットしました！';
        additionalInfo = `\n\n📄 GitHubに保存されました:\n• <${fileUrl}|${githubInfo.file_path}>\n• <${commitUrl}|コミット: ${githubInfo.commit.sha.substring(0, 7)}>`;
      } else if (n8nResponse && n8nResponse.error) {
        // Handle error responses from n8n
        logger.error('n8n returned error:', n8nResponse.error);
        statusText = 'GitHubへの保存中にエラーが発生しました';
        additionalInfo = `\n\n⚠️ エラー: ${n8nResponse.error.message || 'Unknown error'}`;
        if (n8nResponse.error.details) {
          additionalInfo += `\n詳細: ${n8nResponse.error.details}`;
        }
      } else if (isWorkflowStarted) {
        // n8n returned old format but workflow started successfully
        statusText = 'ファイルをn8nワークフローに送信しました！';
        // Construct estimated GitHub URL
        const estimatedGithubUrl = `https://github.com/${projectFields.owner}/${projectFields.repo}/tree/${projectFields.branch || 'main'}/${projectFields.path_prefix}`;
        additionalInfo = `\n🔗 <${estimatedGithubUrl}|GitHubリポジトリを確認>`;
      } else if (n8nResponse) {
        // n8n returned but with error or unknown format
        statusText = n8nResponse.message || 'ファイルをn8nワークフローに送信しました！';
      } else {
        statusText = 'プロジェクトを選択しました（n8nへの送信は失敗しました）';
      }
      
      const confirmationBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${statusEmoji} ${statusText}${additionalInfo}\n\n🎯 プロジェクト: ${projectName}\n📂 ファイル: ${fileName}\n🔧 リポジトリ: ${projectFields.owner}/${projectFields.repo}\n📁 保存先: ${n8nResponse?.data?.filePath || projectFields.path_prefix + formattedFileName}`
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

      // Get thread timestamp from file data store or body
      let threadTs = null;
      const storedFileData = fileDataStore.get(fileId) || fileDataStore.get(`${fileId}_${channelId}`);
      if (storedFileData && storedFileData.threadTs) {
        threadTs = storedFileData.threadTs;
        logger.info(`Using thread timestamp from fileDataStore: ${threadTs}`);
      } else if (body.message && body.message.thread_ts) {
        threadTs = body.message.thread_ts;
        logger.info(`Using thread timestamp from body.message: ${threadTs}`);
      } else if (body.message && body.message.ts) {
        threadTs = body.message.ts;
        logger.info(`Using message timestamp as thread: ${threadTs}`);
      }
      
      if (!threadTs) {
        logger.warn('No thread timestamp found, message will be posted to channel');
      }
      
      // Send confirmation blocks to the thread
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs, // Post in the same thread as the original file
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