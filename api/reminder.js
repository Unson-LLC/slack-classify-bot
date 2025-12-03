const TaskParser = require('./task-parser');
const { getSlackIdToBrainbaseName, getMembersMapping } = require('./slack-name-resolver');

class ReminderService {
  constructor(slackClient) {
    this.slackClient = slackClient;
    this.taskParser = new TaskParser();
  }

  async getOwnerSlackId(ownerName) {
    const mapping = await getMembersMapping();

    for (const [name, slackId] of mapping) {
      if (name.toLowerCase().includes(ownerName.toLowerCase()) ||
          ownerName.toLowerCase().includes(name.toLowerCase())) {
        return slackId;
      }
    }

    const normalizedOwner = ownerName.replace(/-/g, ' ');
    for (const [name, slackId] of mapping) {
      if (name.toLowerCase() === normalizedOwner.toLowerCase()) {
        return slackId;
      }
    }

    return null;
  }

  formatTaskMessage(task, type = 'reminder') {
    const priorityEmoji = {
      'high': '🔴',
      'medium': '🟡',
      'low': '🟢'
    };

    const emoji = priorityEmoji[task.priority] || '⚪';
    const dueText = task.due && task.due !== 'null' ? `📅 ${task.due}` : '';
    const projectText = task.project_id || 'general';

    if (type === 'overdue') {
      return {
        text: `⏰ 期限切れタスク: ${task.title}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `⏰ *期限切れタスク*\n\n*${task.title}*\n${emoji} 優先度: ${task.priority || 'medium'}\n📅 期限: ${task.due}\n📂 プロジェクト: ${projectText}`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "✅ 完了" },
                style: "primary",
                action_id: `task_complete_${task.id}`,
                value: JSON.stringify({ taskId: task.id })
              },
              {
                type: "button",
                text: { type: "plain_text", text: "⏰ リマインド" },
                action_id: `task_snooze_${task.id}`,
                value: JSON.stringify({ taskId: task.id })
              }
            ]
          }
        ]
      };
    }

    if (type === 'due_soon') {
      return {
        text: `📋 もうすぐ期限: ${task.title}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📋 *もうすぐ期限のタスク*\n\n*${task.title}*\n${emoji} 優先度: ${task.priority || 'medium'}\n📅 期限: ${task.due}\n📂 プロジェクト: ${projectText}`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "✅ 完了" },
                style: "primary",
                action_id: `task_complete_${task.id}`,
                value: JSON.stringify({ taskId: task.id })
              }
            ]
          }
        ]
      };
    }

    return {
      text: `📋 タスク: ${task.title}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📋 *タスク*\n\n*${task.title}*\n${emoji} 優先度: ${task.priority || 'medium'}\n${dueText}\n📂 プロジェクト: ${projectText}`
          }
        }
      ]
    };
  }

  async sendReminder(slackId, task, type = 'reminder') {
    const message = this.formatTaskMessage(task, type);

    try {
      const result = await this.slackClient.chat.postMessage({
        channel: slackId,
        text: `<@${slackId}> ${message.text}`,
        blocks: message.blocks
      });

      console.log(`Sent ${type} reminder to ${slackId} for task ${task.id}`);
      return { success: true, ts: result.ts };
    } catch (error) {
      console.error(`Failed to send reminder to ${slackId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async sendOverdueReminders() {
    const overdueTasks = await this.taskParser.getOverdueTasks();
    const results = [];

    for (const task of overdueTasks) {
      if (!task.owner) continue;

      const slackId = await this.getOwnerSlackId(task.owner);
      if (!slackId) {
        console.log(`No Slack ID found for owner: ${task.owner}`);
        continue;
      }

      const result = await this.sendReminder(slackId, task, 'overdue');
      results.push({ task: task.id, owner: task.owner, slackId, ...result });
    }

    return results;
  }

  async sendDueSoonReminders(days = 3) {
    const dueSoonTasks = await this.taskParser.getTasksDueSoon(days);
    const results = [];

    for (const task of dueSoonTasks) {
      if (!task.owner) continue;

      const slackId = await this.getOwnerSlackId(task.owner);
      if (!slackId) {
        console.log(`No Slack ID found for owner: ${task.owner}`);
        continue;
      }

      const result = await this.sendReminder(slackId, task, 'due_soon');
      results.push({ task: task.id, owner: task.owner, slackId, ...result });
    }

    return results;
  }

  async sendDailySummary(slackId) {
    const idToName = await getSlackIdToBrainbaseName();
    const ownerName = idToName.get(slackId);

    if (!ownerName) {
      return { success: false, error: 'Owner name not found' };
    }

    const allTasks = await this.taskParser.getTasksByOwner(ownerName);
    const overdue = allTasks.filter(t => {
      const today = new Date().toISOString().split('T')[0];
      return t.due && t.due !== 'null' && t.due < today;
    });
    const dueSoon = allTasks.filter(t => {
      const today = new Date();
      const threeDays = new Date(today);
      threeDays.setDate(threeDays.getDate() + 3);
      const todayStr = today.toISOString().split('T')[0];
      const futureStr = threeDays.toISOString().split('T')[0];
      return t.due && t.due !== 'null' && t.due >= todayStr && t.due <= futureStr;
    });
    const highPriority = allTasks.filter(t => t.priority === 'high');

    if (allTasks.length === 0) {
      return { success: true, message: 'No pending tasks' };
    }

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "📊 本日のタスクサマリー" }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${ownerName}さん、おはようございます！*\n\n📋 未完了タスク: ${allTasks.length}件\n⏰ 期限切れ: ${overdue.length}件\n📅 今後3日で期限: ${dueSoon.length}件\n🔴 高優先度: ${highPriority.length}件`
        }
      }
    ];

    if (overdue.length > 0) {
      blocks.push({ type: "divider" });
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*⏰ 期限切れタスク*\n${overdue.slice(0, 5).map(t => `• ${t.title} (${t.due})`).join('\n')}`
        }
      });
    }

    if (dueSoon.length > 0) {
      blocks.push({ type: "divider" });
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*📅 今後3日で期限のタスク*\n${dueSoon.slice(0, 5).map(t => `• ${t.title} (${t.due})`).join('\n')}`
        }
      });
    }

    try {
      await this.slackClient.chat.postMessage({
        channel: slackId,
        text: `📊 本日のタスクサマリー: ${allTasks.length}件の未完了タスク`,
        blocks: blocks
      });
      return { success: true };
    } catch (error) {
      console.error(`Failed to send daily summary to ${slackId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async runDailyReminders() {
    console.log('Running daily reminders...');

    const overdueResults = await this.sendOverdueReminders();
    console.log(`Sent ${overdueResults.filter(r => r.success).length} overdue reminders`);

    const dueSoonResults = await this.sendDueSoonReminders(3);
    console.log(`Sent ${dueSoonResults.filter(r => r.success).length} due-soon reminders`);

    return {
      overdue: overdueResults,
      dueSoon: dueSoonResults,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ReminderService;
