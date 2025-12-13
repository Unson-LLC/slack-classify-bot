const TaskParser = require('./task-parser');
const { getSlackIdToBrainbaseName, getMembersMapping } = require('./slack-name-resolver');
const { getUserReminderTiming } = require('./memory-helper.cjs');

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

  formatDueDate(due) {
    if (!due || due === 'null') {
      return '';
    }
    const date = new Date(due + 'T00:00:00+09:00');
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = weekdays[date.getDay()];
    return `${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}(${weekday}) まで`;
  }

  formatDateHeader(now) {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const weekday = weekdays[now.getDay()];
    return `${month}月${day}日(${weekday})`;
  }

  formatDailySummaryBlocks(ownedTasks, requestedTasks, now) {
    const totalCount = ownedTasks.length + requestedTasks.length;
    const dateHeader = this.formatDateHeader(now);

    if (totalCount === 0) {
      return [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${dateHeader}の要確認タスク: 0件` }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '✨ 確認が必要なタスクはありません' }
        }
      ];
    }

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${dateHeader}の要確認タスク: ${totalCount}件` }
      }
    ];

    if (ownedTasks.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*📋 担当中* (${ownedTasks.length}件)` }
      });

      for (const task of ownedTasks.slice(0, 5)) {
        const dueText = this.formatDueDate(task.due);
        const projectText = task.project_id ? `#${task.project_id}` : '';

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${task.title}*\n${dueText}${projectText ? ` | ${projectText}` : ''}`
          }
        });

        blocks.push({
          type: 'actions',
          elements: [
            {
              type: 'static_select',
              placeholder: { type: 'plain_text', text: '期限を見直す' },
              action_id: `task_reschedule_${task.id}`,
              options: [
                { text: { type: 'plain_text', text: '明日' }, value: JSON.stringify({ taskId: task.id, offset: 1 }) },
                { text: { type: 'plain_text', text: '3日後' }, value: JSON.stringify({ taskId: task.id, offset: 3 }) },
                { text: { type: 'plain_text', text: '1週間後' }, value: JSON.stringify({ taskId: task.id, offset: 7 }) }
              ]
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ 完了' },
              style: 'primary',
              action_id: `task_complete_${task.id}`,
              value: JSON.stringify({ taskId: task.id })
            }
          ]
        });
      }

      if (ownedTasks.length > 5) {
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `他 ${ownedTasks.length - 5} 件のタスクがあります` }]
        });
      }
    }

    if (requestedTasks.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*📤 依頼中* (${requestedTasks.length}件)` }
      });

      for (const task of requestedTasks.slice(0, 5)) {
        const dueText = this.formatDueDate(task.due);
        const ownerText = task.owner ? `担当: ${task.owner}` : '';

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${task.title}*\n${dueText}${ownerText ? ` | ${ownerText}` : ''}`
          }
        });
      }

      if (requestedTasks.length > 5) {
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `他 ${requestedTasks.length - 5} 件の依頼があります` }]
        });
      }
    }

    return blocks;
  }

  async sendDailySummary(slackId, now = new Date()) {
    // Slack IDで直接検索（owner_slack_id / requester_slack_id フィールドを使用）
    const ownedTasks = await this.taskParser.getTasksByOwnerSlackId(slackId);
    const requestedTasks = await this.taskParser.getTasksByRequesterSlackId(slackId);

    const blocks = this.formatDailySummaryBlocks(ownedTasks, requestedTasks, now);

    const totalCount = ownedTasks.length + requestedTasks.length;
    if (totalCount === 0) {
      return { success: true, message: 'No pending tasks' };
    }

    try {
      await this.slackClient.chat.postMessage({
        channel: slackId,
        text: `📊 ${this.formatDateHeader(now)}の要確認タスク: ${totalCount}件`,
        blocks: blocks
      });
      return { success: true };
    } catch (error) {
      console.error(`Failed to send daily summary to ${slackId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * ユーザーのリマインド時刻がcurrentHourと一致するか判定
   * @param {string} slackId - Slack User ID
   * @param {string} currentHour - 現在時刻のHH形式（JST）
   * @param {string} defaultHour - デフォルトの送信時刻（デフォルト: '09'）
   * @returns {Promise<boolean>} 送信すべきならtrue
   */
  async shouldSendReminderNow(slackId, currentHour, defaultHour = '09') {
    try {
      const reminderTiming = await getUserReminderTiming(slackId);

      if (!reminderTiming) {
        // Working Memoryに設定がなければデフォルト時刻で送信
        return currentHour === defaultHour;
      }

      // HH:mm形式からHHを取得
      const preferredHour = reminderTiming.split(':')[0];
      return currentHour === preferredHour;
    } catch (error) {
      console.error(`Failed to check reminder timing for ${slackId}:`, error.message);
      // エラー時はデフォルト時刻で送信
      return currentHour === defaultHour;
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

  /**
   * 全メンバーへの日次サマリーを送信（Working Memoryのリマインド時刻を考慮）
   * @param {string} triggerHour - トリガーされた時刻のHH形式（JST）
   * @returns {Promise<object>} 送信結果
   */
  async runDailySummaries(triggerHour) {
    console.log(`Running daily summaries for hour ${triggerHour}...`);

    const mapping = await getMembersMapping();
    const results = [];

    for (const [name, slackId] of mapping) {
      // ユーザーのリマインド時刻をチェック
      const shouldSend = await this.shouldSendReminderNow(slackId, triggerHour);

      if (!shouldSend) {
        console.log(`Skipping ${name} (${slackId}) - not their preferred time`);
        results.push({ name, slackId, skipped: true, reason: 'not_preferred_time' });
        continue;
      }

      const result = await this.sendDailySummary(slackId);
      results.push({ name, slackId, ...result });
    }

    const sent = results.filter(r => r.success === true).length;
    const skipped = results.filter(r => r.skipped).length;
    console.log(`Daily summaries: ${sent} sent, ${skipped} skipped`);

    return {
      results,
      summary: { sent, skipped, total: results.length },
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ReminderService;
