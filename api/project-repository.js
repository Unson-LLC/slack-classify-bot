/**
 * Design References:
 * - See docs/airtable-to-dynamodb-gap-analysis.md for migration design
 *
 * Related Classes:
 * - processFileUpload.js: Uses this repository to get projects
 * - index.js: Uses this repository for interactive UI
 * - airtable-integration.js: Being replaced by this class
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

class ProjectRepository {
  constructor() {
    const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = process.env.PROJECTS_TABLE_NAME || 'slack-classify-bot-projects';

    // In-memory cache (per Lambda instance)
    this.projectsCache = null;
    this.projectsCacheTime = null;
    this.projectsCacheTTL = 600000; // 10 minutes
  }

  /**
   * Get all active projects with caching
   * @returns {Promise<Array>} - List of projects
   */
  async getAllProjects() {
    // Check cache first
    const now = Date.now();
    if (this.projectsCache && this.projectsCacheTime && (now - this.projectsCacheTime < this.projectsCacheTTL)) {
      console.log(`Using cached projects (${this.projectsCache.length} projects, age: ${Math.round((now - this.projectsCacheTime) / 1000)}s)`);
      return this.projectsCache;
    }

    console.log('Fetching projects from DynamoDB...');

    try {
      const params = {
        TableName: this.tableName,
        FilterExpression: 'attribute_not_exists(is_active) OR is_active = :true',
        ExpressionAttributeValues: {
          ':true': true
        }
      };

      const result = await this.docClient.send(new ScanCommand(params));
      const projects = result.Items || [];

      // Sort by name
      projects.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      // Update cache
      this.projectsCache = projects;
      this.projectsCacheTime = now;

      console.log(`Found ${projects.length} projects in DynamoDB`);
      return projects;

    } catch (error) {
      console.error('Error fetching projects from DynamoDB:', error.message);
      throw new Error(`Failed to fetch projects: ${error.message}`);
    }
  }

  /**
   * Get a single project by ID
   * @param {string} projectId - Project ID
   * @returns {Promise<Object|null>} - Project or null if not found
   */
  async getProjectById(projectId) {
    try {
      // Check cache first
      if (this.projectsCache) {
        const cached = this.projectsCache.find(p => p.project_id === projectId);
        if (cached) {
          console.log(`Using cached project: ${projectId}`);
          return cached;
        }
      }

      console.log(`Fetching project from DynamoDB: ${projectId}`);

      const params = {
        TableName: this.tableName,
        Key: {
          project_id: projectId
        }
      };

      const result = await this.docClient.send(new GetCommand(params));
      return result.Item || null;

    } catch (error) {
      console.error(`Error fetching project ${projectId}:`, error.message);
      throw new Error(`Failed to fetch project: ${error.message}`);
    }
  }

  /**
   * Get a single project by name
   * @param {string} projectName - Project name
   * @returns {Promise<Object|null>} - Project or null if not found
   */
  async getProjectByName(projectName) {
    try {
      // Check cache first
      if (this.projectsCache) {
        const cached = this.projectsCache.find(p => p.name === projectName);
        if (cached) {
          console.log(`Using cached project by name: ${projectName}`);
          return cached;
        }
      }

      console.log(`Fetching project by name from DynamoDB: ${projectName}`);

      // Need to scan to find by name (name is not a key)
      const params = {
        TableName: this.tableName,
        FilterExpression: '#name = :name AND (attribute_not_exists(is_active) OR is_active = :true)',
        ExpressionAttributeNames: {
          '#name': 'name'
        },
        ExpressionAttributeValues: {
          ':name': projectName,
          ':true': true
        }
      };

      const result = await this.docClient.send(new ScanCommand(params));
      return result.Items && result.Items.length > 0 ? result.Items[0] : null;

    } catch (error) {
      console.error(`Error fetching project by name ${projectName}:`, error.message);
      throw new Error(`Failed to fetch project by name: ${error.message}`);
    }
  }

  /**
   * Get Slack channels for a project
   * @param {string} projectId - Project ID
   * @returns {Promise<Array>} - Array of channel objects
   */
  async getChannelsForProject(projectId) {
    try {
      const project = await this.getProjectById(projectId);

      if (!project) {
        console.warn(`Project not found: ${projectId}`);
        return [];
      }

      return project.slack_channels || [];

    } catch (error) {
      console.error(`Error getting channels for project ${projectId}:`, error.message);
      return [];
    }
  }

  /**
   * Save or update a project
   * @param {Object} projectData - Project data
   * @returns {Promise<Object>} - Saved project
   */
  async saveProject(projectData) {
    try {
      const now = Math.floor(Date.now() / 1000);

      const project = {
        ...projectData,
        updated_at: now,
        created_at: projectData.created_at || now,
        is_active: projectData.is_active !== undefined ? projectData.is_active : true
      };

      // Validate required fields
      if (!project.project_id || !project.name) {
        throw new Error('project_id and name are required');
      }

      const params = {
        TableName: this.tableName,
        Item: project
      };

      await this.docClient.send(new PutCommand(params));

      // Invalidate cache
      this.projectsCache = null;
      this.projectsCacheTime = null;

      console.log(`Project saved: ${project.project_id}`);
      return project;

    } catch (error) {
      console.error('Error saving project:', error.message);
      throw new Error(`Failed to save project: ${error.message}`);
    }
  }

  /**
   * Delete a project (logical delete)
   * @param {string} projectId - Project ID
   * @returns {Promise<boolean>} - Success
   */
  async deleteProject(projectId) {
    try {
      const params = {
        TableName: this.tableName,
        Key: {
          project_id: projectId
        },
        UpdateExpression: 'SET is_active = :false, updated_at = :now',
        ExpressionAttributeValues: {
          ':false': false,
          ':now': Math.floor(Date.now() / 1000)
        }
      };

      await this.docClient.send(new UpdateCommand(params));

      // Invalidate cache
      this.projectsCache = null;
      this.projectsCacheTime = null;

      console.log(`Project deleted (logical): ${projectId}`);
      return true;

    } catch (error) {
      console.error(`Error deleting project ${projectId}:`, error.message);
      throw new Error(`Failed to delete project: ${error.message}`);
    }
  }

  /**
   * Clear cache (for testing)
   */
  clearCache() {
    this.projectsCache = null;
    this.projectsCacheTime = null;
  }
}

module.exports = ProjectRepository;
