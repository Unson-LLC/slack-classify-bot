const axios = require('axios');
const Airtable = require('airtable');
const ProjectRepository = require('./project-repository');
const GitHubIntegration = require('./github-integration');

class AirtableIntegration {
  constructor() {
    // Legacy Airtable support (optional, for migration period)
    if (process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE) {
      this.airtable = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(
        process.env.AIRTABLE_BASE
      );
      this.tableName = process.env.AIRTABLE_TABLE_NAME || 'Projects';
    }

    // New DynamoDB-based project repository
    this.projectRepository = new ProjectRepository();
    this.timeout = 10000; // 10秒のタイムアウト

    // Legacy cache (no longer used, kept for compatibility)
    this.projectsCache = null;
    this.projectsCacheTime = null;
    this.projectsCacheTTL = 300000; // 5分間キャッシュ
  }

  /**
   * Airtable呼び出しにタイムアウトを適用するヘルパー
   * @param {Promise} promise - 実行するPromise
   * @param {number} timeoutMs - タイムアウト時間（ミリ秒）
   * @returns {Promise} - タイムアウト付きのPromise
   */
  async withTimeout(promise, timeoutMs = this.timeout) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Airtable API call timed out')), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Get all projects (now from DynamoDB via ProjectRepository)
   * @returns {Promise<Array>} - List of projects
   */
  async getProjects() {
    try {
      const projects = await this.projectRepository.getAllProjects();

      // Transform to match legacy format (id -> project_id compatibility)
      return projects.map(project => ({
        id: project.project_id,           // Legacy compatibility
        project_id: project.project_id,   // New format
        name: project.name,
        owner: project.owner,
        repo: project.repo,
        path_prefix: project.path_prefix,
        description: project.description || '',
        emoji: project.emoji || '📁',
        branch: project.branch || 'main'
      }));

    } catch (error) {
      console.error('Error fetching projects:', error.message);
      throw new Error(`Failed to fetch projects: ${error.message}`);
    }
  }

  /**
   * Get Slack channels for a project (now from DynamoDB)
   * @param {string} projectId - Project ID
   * @param {string} projectName - Project name (optional, for fallback with old Airtable IDs)
   * @returns {Promise<Array>} - Array of channel IDs (for backward compatibility)
   */
  async getSlackChannelsForProject(projectId, projectName = null) {
    try {
      // Try to get project by ID first
      let project = await this.projectRepository.getProjectById(projectId);

      // Fallback: try to find by name (for old Airtable IDs)
      if (!project && projectName) {
        console.log(`Project not found by ID ${projectId}, trying by name: ${projectName}`);
        project = await this.projectRepository.getProjectByName(projectName);
      }

      if (!project) {
        console.warn(`Project not found: ${projectId}`);
        return [];
      }

      const channels = project.slack_channels || [];

      // For backward compatibility, return array of channel_id strings
      // (index.js will fetch channel names via Slack API)
      if (Array.isArray(channels)) {
        return channels.map(ch => typeof ch === 'string' ? ch : ch.channel_id);
      }

      return [];

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
              projectName: projectName,
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

    // Add "GitHub only" and cancel buttons
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "📦 GitHubのみ（Slack投稿しない）",
            emoji: true
          },
          value: JSON.stringify({
            projectId: projectId,
            projectName: projectName,
            fileId: fileId,
            fileName: fileData.fileName,
            channelId: fileData.channelId,
            classificationResult: fileData.classificationResult,
            summary: fileData.summary
          }),
          action_id: "skip_channel_github_only"
        },
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
      // minutes should already have Slack mentions applied by formatMinutesForSlack
      const minutesWithMentions = minutes;

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

      // Then post the detailed minutes as thread replies
      // Split long text into chunks to respect Slack's 3000 char limit per block
      const MAX_BLOCK_TEXT_LENGTH = 2900; // Leave some buffer
      const minutesChunks = [];
      let remainingText = minutesWithMentions;

      while (remainingText.length > 0) {
        if (remainingText.length <= MAX_BLOCK_TEXT_LENGTH) {
          minutesChunks.push(remainingText);
          break;
        }

        // Find a good breaking point (newline or space)
        let breakPoint = remainingText.lastIndexOf('\n', MAX_BLOCK_TEXT_LENGTH);
        if (breakPoint === -1 || breakPoint < MAX_BLOCK_TEXT_LENGTH / 2) {
          breakPoint = remainingText.lastIndexOf(' ', MAX_BLOCK_TEXT_LENGTH);
        }
        if (breakPoint === -1 || breakPoint < MAX_BLOCK_TEXT_LENGTH / 2) {
          breakPoint = MAX_BLOCK_TEXT_LENGTH;
        }

        minutesChunks.push(remainingText.substring(0, breakPoint));
        remainingText = remainingText.substring(breakPoint).trim();
      }

      // Post first chunk with header
      const firstChunkBlocks = [
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
            text: minutesChunks[0]
          }
        }
      ];

      // Add continuation notice if there are more chunks
      if (minutesChunks.length > 1) {
        firstChunkBlocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `📜 _続きがあります（${minutesChunks.length}件中 1件目）_`
            }
          ]
        });
      }

      const detailResponse = await client.chat.postMessage({
        channel: channelId,
        thread_ts: summaryResponse.ts,
        text: `📄 詳細議事録: ${fileName}`,
        blocks: firstChunkBlocks
      });

      // Post remaining chunks
      for (let i = 1; i < minutesChunks.length; i++) {
        const isLast = i === minutesChunks.length - 1;
        const chunkBlocks = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: minutesChunks[i]
            }
          }
        ];

        if (isLast) {
          chunkBlocks.push({
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `🤖 _この議事録はAIにより自動生成されました。必要に応じて内容をご確認ください。_`
              }
            ]
          });
        } else {
          chunkBlocks.push({
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `📜 _続き（${minutesChunks.length}件中 ${i + 1}件目）_`
              }
            ]
          });
        }

        await client.chat.postMessage({
          channel: channelId,
          thread_ts: summaryResponse.ts,
          text: `📄 詳細議事録（続き ${i + 1}/${minutesChunks.length}）`,
          blocks: chunkBlocks
        });
      }

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
      const response = await axios.get(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE}/${this.tableName}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json'
          },
          params: {
            maxRecords: 100,
            view: 'Grid view'
          },
          timeout: 10000
        }
      );

      const records = response.data.records || [];
      if (records.length === 0) {
        logger.warn('No projects found in Airtable.');
        return [];
      }

      // デバッグ用：最初のレコードのフィールドを確認
      if (records.length > 0) {
        logger.info('First record fields:', Object.keys(records[0].fields));
        logger.info('First record data:', records[0].fields);
      }

      const projectOptions = records.map(record => ({
        text: record.fields.Name || record.id,
        value: record.id,  // AirtableのレコードIDを使用
      }));

      return projectOptions;
    } catch (error) {
      console.error('Error fetching project list from Airtable:', error.message);
      if (error.response && error.response.data) {
        logger.error('Airtable API error:', error.response.data);
      }
      logger.error('Airtable error details:', {
        statusCode: error.response?.status,
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
    const { projectId, projectName, fileId, fileName, classificationResult, channelId, summary: actionSummary, previousCommits } = actionData;
    const originalMessageTs = body.message.ts;

    logger.info('Parsed action data:', actionData);

    if (!projectId) {
      logger.error('Project ID is not provided');
      return;
    }

    try {
      // Get project details from DynamoDB
      let project = await this.projectRepository.getProjectById(projectId);

      // Fallback: try to find by name (for old Airtable IDs)
      if (!project && projectName) {
        logger.info(`Project not found by ID ${projectId}, trying by name: ${projectName}`);
        project = await this.projectRepository.getProjectByName(projectName);
      }

      if (!project) {
        throw new Error(`Project with ID ${projectId} not found`);
      }

      logger.info('Retrieved project from DynamoDB:', project);
      
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

        // If summary not found in store, use summary from action value
        if (!summary && actionSummary) {
          summary = actionSummary;
          logger.info('Summary restored from action.value');
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
      
      // Create formatted filename base (without extension)
      const formattedBaseName = aiGeneratedName;

      // Generate detailed meeting minutes using AI
      let minutesData = null;
      let detailedMinutes = null;
      if (fileContent) {
        try {
          const { generateMeetingMinutes, formatMinutesForGitHub } = require('./llm-integration');
          minutesData = await generateMeetingMinutes(fileContent, projectName);
          // Format for GitHub (no Slack mentions, human-readable names)
          detailedMinutes = formatMinutesForGitHub(minutesData);
          logger.info('AI generated detailed meeting minutes (formatted for GitHub)');
        } catch (error) {
          logger.error('Failed to generate meeting minutes with AI:', error);
        }
      }

      logger.info('Committing to GitHub with two-layer structure (minutes + transcript)');

      // Commit to GitHub using two-layer structure
      let githubResponse = null;

      try {
        const github = new GitHubIntegration();
        githubResponse = await github.commitMeetingRecords({
          owner: project.owner,
          repo: project.repo,
          branch: project.branch || 'main',
          pathPrefix: project.path_prefix,
          dateStr: dateStr,
          baseName: formattedBaseName,
          transcript: fileContent,
          minutes: detailedMinutes,
          summary: summary
        });

        logger.info('GitHub commit response:', githubResponse);

        if (!githubResponse.success) {
          logger.warn('GitHub commit had errors:', githubResponse.errors);
        }
      } catch (githubError) {
        logger.error('Failed to commit to GitHub:', githubError.message);
        logger.error('GitHub error details:', {
          message: githubError.message,
          stack: githubError.stack
        });
      }

      // Update the original Slack message to show confirmation
      const isSuccess = githubResponse && githubResponse.success;
      const statusEmoji = isSuccess ? '✅' : '⚠️';
      let statusText = '';
      let additionalInfo = '';

      if (isSuccess) {
        statusText = 'ファイルをGitHubにコミットしました！';

        const minutesUrl = githubResponse.minutes?.fileUrl ||
          `https://github.com/${project.owner}/${project.repo}/blob/${project.branch || 'main'}/${githubResponse.paths.minutes}`;
        const transcriptUrl = githubResponse.transcript?.fileUrl ||
          `https://github.com/${project.owner}/${project.repo}/blob/${project.branch || 'main'}/${githubResponse.paths.transcript}`;

        additionalInfo = `\n\n📄 *二層構造で保存されました:*\n• <${minutesUrl}|📝 議事録 (minutes)>\n• <${transcriptUrl}|📜 トランスクリプト (transcript)>`;

        if (githubResponse.minutes?.commitUrl) {
          additionalInfo += `\n\n🔗 <${githubResponse.minutes.commitUrl}|コミットを確認>`;
        }
      } else if (githubResponse && githubResponse.errors.length > 0) {
        statusText = 'GitHubへの保存中に一部エラーが発生しました';
        additionalInfo = `\n\n⚠️ エラー:\n${githubResponse.errors.map(e => `• ${e.type}: ${e.error}`).join('\n')}`;

        // Show partial success
        if (githubResponse.minutes) {
          additionalInfo += `\n\n✅ 議事録は保存されました: <${githubResponse.minutes.fileUrl}|確認>`;
        }
        if (githubResponse.transcript) {
          additionalInfo += `\n✅ トランスクリプトは保存されました: <${githubResponse.transcript.fileUrl}|確認>`;
        }
      } else {
        statusText = 'GitHubへの保存に失敗しました';
        additionalInfo = '\n\n⚠️ GITHUB_TOKEN の設定を確認してください';
      }

      const confirmationBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${statusEmoji} ${statusText}${additionalInfo}\n\n🎯 プロジェクト: ${projectName}\n📂 ファイル: ${fileName}\n🔧 リポジトリ: ${project.owner}/${project.repo}\n📁 保存先: ${project.path_prefix}minutes/ & transcripts/`
          }
        }
      ];

      // Add commit details if available
      if (isSuccess) {
        confirmationBlocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🌿 ブランチ: ${project.branch || 'main'}\n📋 *二層構造*: 議事録はbrainbaseのアクティブデータ、トランスクリプトは原本アーカイブとして保存`
          }
        });
      }
      
      confirmationBlocks.push({
        type: "divider"
      });

      // Add re-commit button
      confirmationBlocks.push({
        type: "actions",
        elements: [{
          type: "button",
          text: {
            type: "plain_text",
            text: "🔄 別のプロジェクトに再コミット",
            emoji: true
          },
          value: JSON.stringify({
            fileId: fileId,
            fileName: fileName,
            summary: summary,
            previousCommits: [{
              project: projectName,
              repo: `${project.owner}/${project.repo}`,
              branch: project.branch || 'main'
            }]
          }),
          action_id: "reselect_project_for_recommit",
          style: "primary"
        }]
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