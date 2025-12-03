function formatDueDate(dueString) {
  if (!dueString) return null;

  const date = new Date(dueString);
  if (isNaN(date.getTime())) return dueString;

  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = weekdays[date.getDay()];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${month}/${String(day).padStart(2, '0')}(${weekday}) ${hours}:${minutes}`;
}

function createTaskMessageBlocks(task) {
  const {
    taskId,
    title,
    requester,
    requesterSlackId,
    assignee,
    assigneeSlackId,
    priority,
    due,
    slackLink
  } = task;

  const blocks = [];

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `🎯 *${title}*`
    }
  });

  const formattedDue = formatDueDate(due);
  if (formattedDue) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `期限: ${formattedDue}`
      }
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '期限: ???'
      }
    });
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `依頼: <@${requesterSlackId}>\n担当: <@${assigneeSlackId}>`
    }
  });

  const actionElements = [];

  if (!due) {
    actionElements.push({
      type: 'static_select',
      placeholder: {
        type: 'plain_text',
        text: '期限を決める'
      },
      action_id: `task_set_due_${taskId}`,
      options: [
        { text: { type: 'plain_text', text: '2時間後' }, value: '2hours' },
        { text: { type: 'plain_text', text: '今日中' }, value: 'today_end' },
        { text: { type: 'plain_text', text: '明日まで' }, value: 'tomorrow' },
        { text: { type: 'plain_text', text: '明後日まで' }, value: 'day_after' },
        { text: { type: 'plain_text', text: '今週末まで' }, value: 'this_weekend' },
        { text: { type: 'plain_text', text: '週明けまで' }, value: 'next_monday' },
        { text: { type: 'plain_text', text: '来週末まで' }, value: 'next_weekend' },
        { text: { type: 'plain_text', text: '今月末まで' }, value: 'month_end' },
        { text: { type: 'plain_text', text: '期限をなくして保留にする' }, value: 'no_due' }
      ]
    });
  }

  actionElements.push({
    type: 'button',
    text: {
      type: 'plain_text',
      text: '編集✏️'
    },
    action_id: `task_edit_${taskId}`,
    value: JSON.stringify({ taskId, title, requesterSlackId, assigneeSlackId, due })
  });

  actionElements.push({
    type: 'button',
    text: {
      type: 'plain_text',
      text: '完了✨'
    },
    action_id: `task_complete_${taskId}`,
    style: 'primary',
    value: JSON.stringify({ taskId, title, requesterSlackId, assigneeSlackId })
  });

  blocks.push({
    type: 'actions',
    elements: actionElements
  });

  return blocks;
}

function calculateDueDate(option) {
  const now = new Date();
  const jstOffset = 9 * 60;
  const jstNow = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000);

  switch (option) {
    case '2hours':
      return new Date(jstNow.getTime() + 2 * 60 * 60000);
    case 'today_end':
      return new Date(jstNow.getFullYear(), jstNow.getMonth(), jstNow.getDate(), 23, 59);
    case 'tomorrow':
      return new Date(jstNow.getFullYear(), jstNow.getMonth(), jstNow.getDate() + 1, 18, 0);
    case 'day_after':
      return new Date(jstNow.getFullYear(), jstNow.getMonth(), jstNow.getDate() + 2, 18, 0);
    case 'this_weekend': {
      const daysUntilSunday = (7 - jstNow.getDay()) % 7 || 7;
      return new Date(jstNow.getFullYear(), jstNow.getMonth(), jstNow.getDate() + daysUntilSunday, 18, 0);
    }
    case 'next_monday': {
      const daysUntilMonday = (8 - jstNow.getDay()) % 7 || 7;
      return new Date(jstNow.getFullYear(), jstNow.getMonth(), jstNow.getDate() + daysUntilMonday, 10, 0);
    }
    case 'next_weekend': {
      const daysUntilNextSunday = ((7 - jstNow.getDay()) % 7 || 7) + 7;
      return new Date(jstNow.getFullYear(), jstNow.getMonth(), jstNow.getDate() + daysUntilNextSunday, 18, 0);
    }
    case 'month_end': {
      const lastDay = new Date(jstNow.getFullYear(), jstNow.getMonth() + 1, 0);
      return new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 18, 0);
    }
    case 'no_due':
      return null;
    default:
      return null;
  }
}

function generateTimeOptions() {
  const options = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hour = String(h).padStart(2, '0');
      const min = String(m).padStart(2, '0');
      const timeStr = `${hour}:${min}`;
      options.push({
        text: { type: 'plain_text', text: timeStr },
        value: timeStr
      });
    }
  }
  return options;
}

function createEditModalBlocks(taskData) {
  const { title, requesterSlackId, assigneeSlackId, due } = taskData;
  const blocks = [];

  blocks.push({
    type: 'input',
    block_id: 'title_block',
    element: {
      type: 'plain_text_input',
      action_id: 'title_input',
      placeholder: { type: 'plain_text', text: 'タスクの内容' },
      max_length: 30,
      initial_value: title || ''
    },
    label: { type: 'plain_text', text: '内容' },
    hint: { type: 'plain_text', text: '30文字以内' }
  });

  blocks.push({
    type: 'input',
    block_id: 'requester_block',
    element: {
      type: 'users_select',
      action_id: 'requester_input',
      placeholder: { type: 'plain_text', text: 'メンバーを選択' },
      ...(requesterSlackId && { initial_user: requesterSlackId })
    },
    label: { type: 'plain_text', text: '依頼者' },
    hint: { type: 'plain_text', text: '最大で20人のメンバーを選択できます。' }
  });

  blocks.push({
    type: 'input',
    block_id: 'assignee_block',
    element: {
      type: 'users_select',
      action_id: 'assignee_input',
      placeholder: { type: 'plain_text', text: 'メンバーを選択' },
      ...(assigneeSlackId && { initial_user: assigneeSlackId })
    },
    label: { type: 'plain_text', text: '担当者' },
    hint: { type: 'plain_text', text: '最大で20人のメンバーを選択できます。' }
  });

  blocks.push({
    type: 'section',
    block_id: 'start_section',
    text: { type: 'mrkdwn', text: '*開始* (任意)' }
  });

  blocks.push({
    type: 'actions',
    block_id: 'start_block',
    elements: [
      {
        type: 'datepicker',
        action_id: 'start_date_input',
        placeholder: { type: 'plain_text', text: '日付を選択' }
      },
      {
        type: 'static_select',
        action_id: 'start_time_input',
        placeholder: { type: 'plain_text', text: '時間' },
        options: generateTimeOptions()
      }
    ]
  });

  let initialDueDate = null;
  let initialDueTime = null;
  if (due) {
    const dueDate = new Date(due);
    if (!isNaN(dueDate.getTime())) {
      initialDueDate = dueDate.toISOString().split('T')[0];
      initialDueTime = `${String(dueDate.getHours()).padStart(2, '0')}:${String(Math.floor(dueDate.getMinutes() / 30) * 30).padStart(2, '0')}`;
    }
  }

  blocks.push({
    type: 'section',
    block_id: 'due_section',
    text: { type: 'mrkdwn', text: '*期限* (任意)' }
  });

  const dueDateElement = {
    type: 'datepicker',
    action_id: 'due_date_input',
    placeholder: { type: 'plain_text', text: '日付を選択' }
  };
  if (initialDueDate) {
    dueDateElement.initial_date = initialDueDate;
  }

  const dueTimeOptions = generateTimeOptions();
  const dueTimeElement = {
    type: 'static_select',
    action_id: 'due_time_input',
    placeholder: { type: 'plain_text', text: '時間' },
    options: dueTimeOptions
  };
  if (initialDueTime) {
    const matchingOption = dueTimeOptions.find(o => o.value === initialDueTime);
    if (matchingOption) {
      dueTimeElement.initial_option = matchingOption;
    }
  }

  blocks.push({
    type: 'actions',
    block_id: 'due_block',
    elements: [dueDateElement, dueTimeElement]
  });

  blocks.push({
    type: 'context',
    elements: [
      { type: 'plain_text', text: 'タイムゾーン：大阪、札幌、東京' }
    ]
  });

  return blocks;
}

function createCompletedTaskBlocks(task) {
  const {
    taskId,
    title,
    requesterSlackId,
    assigneeSlackId,
    completedAt
  } = task;

  const blocks = [];

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `✅ *${title}*`
    }
  });

  const formattedCompletedAt = formatDueDate(completedAt);
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `完了: ${formattedCompletedAt || '不明'}`
    }
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `依頼: <@${requesterSlackId}>\n担当: <@${assigneeSlackId}>`
    }
  });

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '未完了に戻す'
        },
        action_id: `task_uncomplete_${taskId}`,
        value: JSON.stringify({ taskId, title, requesterSlackId, assigneeSlackId })
      }
    ]
  });

  return blocks;
}

module.exports = { createTaskMessageBlocks, formatDueDate, calculateDueDate, createEditModalBlocks, createCompletedTaskBlocks };
