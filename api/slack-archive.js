const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const S3_BUCKET = process.env.S3_BUCKET || 'brainbase-context-593793022993';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const WORKSPACE_ID = process.env.SLACK_WORKSPACE_ID || 'unson';

class SlackArchive {
  constructor(workspaceId = WORKSPACE_ID) {
    this.s3Client = new S3Client({ region: AWS_REGION });
    this.bucket = S3_BUCKET;
    this.workspaceId = workspaceId;
  }

  getDateStr(ts) {
    const date = new Date(parseFloat(ts) * 1000);
    return date.toISOString().split('T')[0];
  }

  getMonthStr(ts) {
    const date = new Date(parseFloat(ts) * 1000);
    return date.toISOString().slice(0, 7);
  }

  getS3Key(channelId, dateStr) {
    const monthStr = dateStr.slice(0, 7);
    return `slack/${this.workspaceId}/messages/${channelId}/${monthStr}/${dateStr}.json`;
  }

  getLatestS3Key(channelId) {
    return `slack/${this.workspaceId}/messages/${channelId}/latest.json`;
  }

  async getExistingMessages(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      const response = await this.s3Client.send(command);
      const jsonStr = await response.Body.transformToString();
      return JSON.parse(jsonStr);
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return { messages: [], last_updated: null };
      }
      throw error;
    }
  }

  async saveMessages(key, data) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json'
    });
    await this.s3Client.send(command);
  }

  async archiveMessage(message, channelName = null, userName = null) {
    if (!message || !message.ts || !message.channel) {
      console.warn('Invalid message for archiving:', message);
      return false;
    }

    const dateStr = this.getDateStr(message.ts);
    const key = this.getS3Key(message.channel, dateStr);

    try {
      const existing = await this.getExistingMessages(key);

      if (existing.messages.some(m => m.ts === message.ts)) {
        console.log(`Message ${message.ts} already archived`);
        return true;
      }

      const archivedMessage = {
        ts: message.ts,
        user: message.user,
        user_name: userName || message.user,
        text: message.text || '',
        channel: message.channel,
        channel_name: channelName || message.channel,
        thread_ts: message.thread_ts || null,
        reactions: message.reactions || [],
        files: (message.files || []).map(f => ({
          id: f.id,
          name: f.name,
          mimetype: f.mimetype,
          url: f.permalink || f.url_private
        })),
        subtype: message.subtype || null,
        archived_at: new Date().toISOString()
      };

      existing.messages.push(archivedMessage);
      existing.messages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
      existing.last_updated = new Date().toISOString();

      await this.saveMessages(key, existing);
      console.log(`Archived message ${message.ts} to ${key}`);

      await this.updateLatest(message.channel, archivedMessage);

      return true;
    } catch (error) {
      console.error('Failed to archive message:', error);
      return false;
    }
  }

  async updateLatest(channelId, message) {
    const key = this.getLatestS3Key(channelId);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    try {
      const existing = await this.getExistingMessages(key);

      existing.messages = existing.messages.filter(
        m => parseFloat(m.ts) * 1000 > cutoff
      );

      if (!existing.messages.some(m => m.ts === message.ts)) {
        existing.messages.push(message);
      }

      existing.messages.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));

      if (existing.messages.length > 100) {
        existing.messages = existing.messages.slice(0, 100);
      }

      existing.last_updated = new Date().toISOString();

      await this.saveMessages(key, existing);
    } catch (error) {
      console.error('Failed to update latest:', error);
    }
  }

  async getMessages(channelId, dateStr) {
    const key = this.getS3Key(channelId, dateStr);
    const data = await this.getExistingMessages(key);
    return data.messages;
  }

  async getLatestMessages(channelId) {
    const key = this.getLatestS3Key(channelId);
    const data = await this.getExistingMessages(key);
    return data.messages;
  }
}

module.exports = SlackArchive;
