const axios = require('axios');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TASKS_REPO = 'sintariran/brainbase';
const TASKS_PATH = '_tasks/index.md';

class TaskParser {
  constructor(token = GITHUB_TOKEN) {
    this.token = token;
    this.baseUrl = 'https://api.github.com';
  }

  async fetchTasksFile() {
    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    try {
      const response = await axios.get(
        `${this.baseUrl}/repos/${TASKS_REPO}/contents/${TASKS_PATH}`,
        { headers }
      );
      return Buffer.from(response.data.content, 'base64').toString('utf-8');
    } catch (error) {
      console.error('Failed to fetch tasks file:', error.message);
      throw error;
    }
  }

  parseTasksFromContent(content) {
    const tasks = [];
    const taskBlocks = content.split(/^---$/m).filter(block => block.trim());

    for (let i = 0; i < taskBlocks.length; i += 2) {
      const frontMatter = taskBlocks[i];
      const body = taskBlocks[i + 1] || '';

      const task = this.parseFrontMatter(frontMatter);
      if (task && task.id) {
        task.body = body.trim();
        tasks.push(task);
      }
    }

    return tasks;
  }

  parseFrontMatter(block) {
    const task = {};
    const lines = block.trim().split('\n');

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        if (value.startsWith('[') && value.endsWith(']')) {
          task[key] = value.slice(1, -1).split(',').map(v => v.trim());
        } else if (value === 'null') {
          task[key] = null;
        } else {
          task[key] = value.trim();
        }
      }
    }

    return task;
  }

  async getTasks() {
    const content = await this.fetchTasksFile();
    return this.parseTasksFromContent(content);
  }

  async getOverdueTasks() {
    const tasks = await this.getTasks();
    const today = new Date().toISOString().split('T')[0];

    return tasks.filter(task => {
      if (task.status === 'done' || task.status === 'completed') {
        return false;
      }
      if (task.due && task.due !== 'null' && task.due < today) {
        return true;
      }
      return false;
    });
  }

  async getPendingTasks() {
    const tasks = await this.getTasks();
    return tasks.filter(task =>
      task.status === 'todo' || task.status === 'pending'
    );
  }

  async getTasksDueSoon(days = 3) {
    const tasks = await this.getTasks();
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + days);

    const todayStr = today.toISOString().split('T')[0];
    const futureStr = futureDate.toISOString().split('T')[0];

    return tasks.filter(task => {
      if (task.status === 'done' || task.status === 'completed') {
        return false;
      }
      if (task.due && task.due !== 'null' && task.due >= todayStr && task.due <= futureStr) {
        return true;
      }
      return false;
    });
  }

  async getHighPriorityTasks() {
    const tasks = await this.getTasks();
    return tasks.filter(task =>
      task.priority === 'high' &&
      task.status !== 'done' &&
      task.status !== 'completed'
    );
  }

  async getTasksByOwner(owner) {
    const tasks = await this.getTasks();
    const ownerLower = owner.toLowerCase().replace(/\s+/g, '-');
    return tasks.filter(task =>
      task.owner &&
      task.owner.toLowerCase() === ownerLower &&
      task.status !== 'done' &&
      task.status !== 'completed'
    );
  }

  async getTasksByRequester(requester) {
    const tasks = await this.getTasks();
    const requesterLower = requester.toLowerCase().replace(/\s+/g, '-');
    return tasks.filter(task =>
      task.requester &&
      task.requester.toLowerCase() === requesterLower &&
      task.status !== 'done' &&
      task.status !== 'completed'
    );
  }
}

module.exports = TaskParser;
