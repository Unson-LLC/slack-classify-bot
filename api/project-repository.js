/**
 * Design References:
 * - See docs/airtable-to-dynamodb-gap-analysis.md for migration design
 *
 * Related Classes:
 * - processFileUpload.js: Uses this repository to get projects
 * - index.js: Uses this repository for interactive UI
 * - airtable-integration.js: Being replaced by this class
 */

const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

class ProjectRepository {
  constructor() {
    this.tableName = process.env.PROJECTS_TABLE_NAME || 'mana-projects';

    // In-memory cache (per Lambda instance)
    this.projectsCache = null;
    this.projectsCacheTime = null;
    this.projectsCacheTTL = 600000; // 10 minutes
  }

  async getAllProjects() {
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

      const result = await dynamodb.scan(params).promise();
      const projects = result.Items || [];

      projects.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      this.projectsCache = projects;
      this.projectsCacheTime = now;

      console.log(`Found ${projects.length} projects in DynamoDB`);
      return projects;

    } catch (error) {
      console.error('Error fetching projects from DynamoDB:', error.message);
      throw new Error(`Failed to fetch projects: ${error.message}`);
    }
  }

  async getProjectById(projectId) {
    try {
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

      const result = await dynamodb.get(params).promise();
      return result.Item || null;

    } catch (error) {
      console.error(`Error fetching project ${projectId}:`, error.message);
      throw new Error(`Failed to fetch project: ${error.message}`);
    }
  }

  async getProjectByName(projectName) {
    try {
      if (this.projectsCache) {
        const cached = this.projectsCache.find(p => p.name === projectName);
        if (cached) {
          console.log(`Using cached project by name: ${projectName}`);
          return cached;
        }
      }

      console.log(`Fetching project by name from DynamoDB: ${projectName}`);

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

      const result = await dynamodb.scan(params).promise();
      return result.Items && result.Items.length > 0 ? result.Items[0] : null;

    } catch (error) {
      console.error(`Error fetching project by name ${projectName}:`, error.message);
      throw new Error(`Failed to fetch project by name: ${error.message}`);
    }
  }

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

  async saveProject(projectData) {
    try {
      const now = Math.floor(Date.now() / 1000);

      const project = {
        ...projectData,
        updated_at: now,
        created_at: projectData.created_at || now,
        is_active: projectData.is_active !== undefined ? projectData.is_active : true
      };

      if (!project.project_id || !project.name) {
        throw new Error('project_id and name are required');
      }

      const params = {
        TableName: this.tableName,
        Item: project
      };

      await dynamodb.put(params).promise();

      this.projectsCache = null;
      this.projectsCacheTime = null;

      console.log(`Project saved: ${project.project_id}`);
      return project;

    } catch (error) {
      console.error('Error saving project:', error.message);
      throw new Error(`Failed to save project: ${error.message}`);
    }
  }

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

      await dynamodb.update(params).promise();

      this.projectsCache = null;
      this.projectsCacheTime = null;

      console.log(`Project deleted (logical): ${projectId}`);
      return true;

    } catch (error) {
      console.error(`Error deleting project ${projectId}:`, error.message);
      throw new Error(`Failed to delete project: ${error.message}`);
    }
  }

  clearCache() {
    this.projectsCache = null;
    this.projectsCacheTime = null;
  }
}

module.exports = ProjectRepository;
