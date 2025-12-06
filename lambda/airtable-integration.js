const axios = require('axios');

class AirtableIntegration {
  constructor(n8nEndpoint = 'https://n8n.unson.jp/webhook/webhook/slack-airtable') {
    this.n8nEndpoint = n8nEndpoint;
  }

  /**
   * Process file upload event from Slack
   * @param {Object} uploadData - The file upload data
   * @returns {Promise<Object>} - Response from n8n
   */
  async processFileUpload(uploadData) {
    try {
      console.log(`🔄 [${uploadData.instanceId}] Starting Airtable integration processing...`);
      
      // Prepare data for n8n workflow
      const payload = {
        type: 'file_upload',
        fileName: uploadData.fileName,
        fileContent: uploadData.fileContent,
        fileUrl: uploadData.fileUrl,
        channel: uploadData.channel,
        timestamp: uploadData.timestamp,
        instanceId: uploadData.instanceId,
        processedAt: new Date().toISOString()
      };

      console.log(`📦 [${uploadData.instanceId}] Sending to n8n workflow:`, this.n8nEndpoint);
      console.log(`📄 [${uploadData.instanceId}] Payload summary: fileName=${payload.fileName}, contentLength=${payload.fileContent?.length || 0}`);

      // Send to n8n workflow
      const response = await this.sendFileUpload(payload);
      
      console.log(`✅ [${uploadData.instanceId}] Airtable integration completed successfully`);
      return response;
      
    } catch (error) {
      console.error(`❌ [${uploadData.instanceId}] Airtable integration error:`, error.message);
      throw error;
    }
  }

  /**
   * Send file upload event to n8n workflow
   * @param {Object} slackEvent - The Slack file upload event
   * @returns {Promise<Object>} - Response from n8n
   */
  async sendFileUpload(slackEvent) {
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        const payload = {
          type: 'event_callback',
          event: slackEvent,
          timestamp: new Date().toISOString()
        };

        console.log(`🚀 Sending to n8n (attempt ${retryCount + 1}/${maxRetries}):`, this.n8nEndpoint);
        console.log('📦 Payload:', JSON.stringify(payload, null, 2));

        const response = await axios.post(
          this.n8nEndpoint,
          payload,
          {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 15000, // 15 seconds timeout for file processing
            // Add TLS-related options to help with connection issues
            httpsAgent: new (require('https').Agent)({
              rejectUnauthorized: false, // For testing - remove in production
              keepAlive: false
            })
          }
        );

        console.log('✅ Successfully sent file upload to n8n:', response.data);
        return response.data;
      } catch (error) {
        retryCount++;
        console.error(`❌ n8n send attempt ${retryCount}/${maxRetries} failed:`, {
          message: error.message,
          code: error.code,
          status: error.response?.status,
          statusText: error.response?.statusText
        });
        
        if (retryCount >= maxRetries) {
          console.error(`🚫 Max retries (${maxRetries}) reached for n8n send`);
          throw error;
        }
        
        // Wait before retry (exponential backoff)
        const waitTime = 1000 * retryCount;
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
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
    // Slack returns 'text' for .txt files
    return file.filetype === 'text' || file.filetype === 'txt';
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

  /**
   * Send raw Slack event to n8n workflow using Node.js fetch with retries.
   * @param {Object} eventData - The raw Slack event data
   * @returns {Promise<Object>} - Response from n8n
   */
  async sendRawEvent(eventData) {
    const maxRetries = 3;
    let retryCount = 0;
    const instanceId = eventData.instanceId || 'UNKNOWN_INSTANCE';
    const n8nEndpoint = this.n8nEndpoint;

    console.log(`[${instanceId}] sendRawEvent invoked. Target: ${n8nEndpoint}, Attempt: ${retryCount + 1}/${maxRetries}`);

    while (retryCount < maxRetries) {
      try {
        console.log(`[${instanceId}] FETCH_ATTEMPT ${retryCount + 1}/${maxRetries} to ${n8nEndpoint}`);
        
        const agent = new (require('https').Agent)({
          rejectUnauthorized: false, // For debugging self-signed certs; set to true in production if possible
          keepAlive: false, // Try disabling keepAlive for Vercel environment
          timeout: 7000 // Timeout for the https agent itself
        });
        console.log(`[${instanceId}] HTTPS Agent created for fetch.`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.log(`[${instanceId}] FETCH_ABORTING due to timeout (${7500}ms)`);
          controller.abort();
        }, 7500);

        console.log(`[${instanceId}] Executing fetch to ${n8nEndpoint}...`);
        const response = await fetch(n8nEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'mana/1.0 (fetch)'
          },
          body: JSON.stringify(eventData),
          agent: agent, // Apply the custom agent
          signal: controller.signal // Assign the abort signal
        });
        clearTimeout(timeoutId); // Clear the abort timeout if fetch completes/fails on its own
        console.log(`[${instanceId}] fetch executed. Response status: ${response.status}`);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ [${instanceId}] FETCH_HTTP_ERROR: ${response.status} ${response.statusText}. Body: ${errorText}`);
          // For 5xx errors, it might be a temporary server issue, so retry
          if (response.status >= 500 && response.status <= 599) {
            throw new Error(`HTTP ${response.status}: ${response.statusText} (Retryable)`); 
          }
          // For other errors (e.g. 4xx), don't retry as it's likely a client/config issue
          return { error: true, status: response.status, message: `Non-retryable HTTP error: ${response.statusText}`, body: errorText };
        }

        const responseData = await response.json();
        console.log(`✅ [${instanceId}] FETCH_SEND_SUCCESS. Response received.`);
        return responseData;

      } catch (error) {
        clearTimeout(timeoutId); // Ensure timeout is cleared on error too
        retryCount++;
        console.error(`❌ [${instanceId}] FETCH_ATTEMPT_FAILED ${retryCount}/${maxRetries}. Error: ${error.message}`);
        if (error.name === 'AbortError') {
          console.error(`❌ [${instanceId}] Fetch was aborted due to timeout.`);
        }

        if (retryCount >= maxRetries) {
          console.error(`🚫 [${instanceId}] FETCH_MAX_RETRIES_REACHED. Last error: ${error.message}`);
          throw error; // Throw last error after max retries
        }
        
        const waitTime = Math.min(1000 * Math.pow(2, retryCount - 1), 5000); // Exponential backoff
        console.log(`⏳ [${instanceId}] WAITING ${waitTime}ms before next fetch attempt.`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    // Should not be reached if maxRetries leads to an error throw
    console.error(`[${instanceId}] sendRawEvent finished all retries without success or throwing an error properly.`);
    throw new Error('sendRawEvent exhausted retries without a definitive outcome.');
  }

  /**
   * Get all available projects from Airtable
   * @param {string} parentInstanceId - Optional instanceId from the calling function for tracing
   * @returns {Promise<Array>} - Array of project objects
   */
  async getAvailableProjects(parentInstanceId) {
    const functionStartMs = Date.now();
    // Use a consistent way to log the initial call with the parent ID
    const initialLogId = parentInstanceId || 'GP_NO_PARENT_ID';
    console.log(`[${initialLogId}] GP_CALLED - Entry point of getAvailableProjects. Timestamp: ${functionStartMs}`);

    const instanceId = parentInstanceId || `generated_${Math.random().toString(36).substr(2, 5)}`;
    console.log(`[${instanceId}] GP_ID_ASSIGNED - Instance ID for this call.`);

    console.log(`[${instanceId}] GP_PRE_TRY - About to enter the main try block.`);
    try {
      console.log(`[${instanceId}] GP_TRY_START - Entered main try block.`);
      
      // Simulate some very light synchronous work
      const x = 1 + 1;
      console.log(`[${instanceId}] GP_SYNC_WORK_DONE - Simple calculation result: ${x}.`);

      // Simulate a short asynchronous delay (not calling any external API)
      console.log(`[${instanceId}] GP_PRE_MOCK_AWAIT - About to simulate async delay.`);
      await new Promise(resolve => setTimeout(() => {
        console.log(`[${instanceId}] GP_MOCK_AWAIT_CALLBACK - Simulated async delay finished.`);
        resolve();
      }, 100));
      console.log(`[${instanceId}] GP_POST_MOCK_AWAIT - Finished simulated async delay.`);

      // Return a simple fallback project list
      const fallbackProjects = [
        { id: 'test_fallback', name: 'Test Fallback Project', displayName: 'Test Fallback', icon: '🔧', description: 'This is a simple test project for debugging.' }
      ];
      console.log(`[${instanceId}] GP_RETURNING_FALLBACK - About to return ${fallbackProjects.length} test project(s).`);
      return fallbackProjects;

    } catch (error) {
      console.error(`[${instanceId}] GP_CATCH_ERROR - An error occurred: ${error.message}. Stack: ${error.stack}`);
      // Return an error-specific fallback or rethrow
      return [
        { id: 'error_fallback', name: 'Error Fallback Project', displayName: 'Error Fallback', icon: '❌', description: 'Fallback due to an error during execution.' }
      ];
    } finally {
      const functionEndMs = Date.now();
      console.log(`[${instanceId}] GP_FINALLY_END - Exiting getAvailableProjects. Duration: ${functionEndMs - functionStartMs}ms.`);
    }
  }

  /**
   * Get display name for project
   * @param {string} projectName - Project name from Airtable
   * @returns {string} - Display name
   */
  getProjectDisplayName(projectName) {
    const displayNames = {
      'aitle': 'Aitle',
      'senrigan': 'Senrigan',
      'zeims': 'Zeims',
      'postio': 'Postio'
    };
    return displayNames[projectName] || projectName;
  }

  /**
   * Get icon for project
   * @param {string} projectName - Project name from Airtable
   * @returns {string} - Icon emoji
   */
  getProjectIcon(projectName) {
    const icons = {
      'aitle': '🤖',
      'senrigan': '🔒',
      'zeims': '⚡',
      'postio': '📝'
    };
    return icons[projectName] || '📁';
  }

  /**
   * Get description for project
   * @param {string} projectName - Project name from Airtable
   * @param {string} owner - GitHub owner
   * @param {string} repo - GitHub repo
   * @returns {string} - Project description
   */
  getProjectDescription(projectName, owner, repo) {
    const descriptions = {
      'aitle': 'AIチャットボット開発プロジェクト',
      'senrigan': 'セキュリティ監視システム',
      'zeims': 'ゼイムスプロジェクト',
      'postio': 'ポスト管理システム'
    };
    return descriptions[projectName] || `${owner}/${repo} プロジェクト`;
  }
}

module.exports = AirtableIntegration; 