const TaskParser = require('./task-parser');
const { getMembersMapping } = require('./slack-name-resolver');

class SlackThreadReminderService {
  constructor(slackClient) {
    this.slackClient = slackClient;
    this.taskParser = new TaskParser();
  }

  filterSlackTasks(tasks) {
    return tasks.filter(task => {
      if (task.source !== 'slack') return false;
      if (task.status === 'done' || task.status === 'completed') return false;
      if (!task.channel_id || !task.thread_ts) return false;
      return true;
    });
  }

  getTasksToRemind(tasks, now, intervalMs) {
    const nowTime = now.getTime();

    return tasks.filter(task => {
      if (!task.created_at) return false;

      const createdAt = new Date(task.created_at).getTime();
      const elapsed = nowTime - createdAt;

      return elapsed >= intervalMs;
    });
  }

  getTasksToRemindWithIntervals(tasks, now, intervals) {
    const result = [];
    const nowTime = now.getTime();

    for (const task of tasks) {
      if (!task.created_at) continue;

      const createdAt = new Date(task.created_at).getTime();
      const elapsed = nowTime - createdAt;
      const reminderCount = task.reminder_count || 0;

      for (let i = 0; i < intervals.length; i++) {
        if (elapsed >= intervals[i] && reminderCount <= i) {
          result.push(task);
          break;
        }
      }
    }

    return result;
  }

  formatReminderMessage(task) {
    const ownerMention = task.owner_slack_id ? `<@${task.owner_slack_id}>` : task.owner;

    return {
      text: `${ownerMention} タスクのリマインドです: ${task.title}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🔔 *タスクリマインド*\n\n${ownerMention} さん、以下のタスクの進捗はいかがですか？\n\n*${task.title}*`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ 完了' },
              style: 'primary',
              action_id: `task_complete_${task.id}`,
              value: JSON.stringify({ taskId: task.id })
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '⏰ 後で' },
              action_id: `task_snooze_${task.id}`,
              value: JSON.stringify({ taskId: task.id })
            }
          ]
        }
      ]
    };
  }

  async sendThreadReminder(task) {
    const message = this.formatReminderMessage(task);

    try {
      const result = await this.slackClient.chat.postMessage({
        channel: task.channel_id,
        thread_ts: task.thread_ts,
        text: message.text,
        blocks: message.blocks
      });

      return { success: true, ts: result.ts };
    } catch (error) {
      console.error(`Failed to send thread reminder for task ${task.id}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async runSlackReminders(now = new Date()) {
    const allTasks = await this.taskParser.getTasks();
    const slackTasks = this.filterSlackTasks(allTasks);

    const intervalMs = 24 * 60 * 60 * 1000;
    const tasksToRemind = this.getTasksToRemind(slackTasks, now, intervalMs);

    let sent = 0;
    let skipped = allTasks.length - slackTasks.length;
    const results = [];

    for (const task of tasksToRemind) {
      const result = await this.sendThreadReminder(task);
      if (result.success) {
        sent++;
      }
      results.push({ task: task.id, ...result });
    }

    return {
      sent,
      skipped,
      total: allTasks.length,
      slackTasks: slackTasks.length,
      results,
      timestamp: now.toISOString()
    };
  }
}

module.exports = SlackThreadReminderService;
