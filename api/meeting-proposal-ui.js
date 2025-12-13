/**
 * meeting-proposal-ui.js
 * 抽出した決定事項・タスクを人間に確認させるSlack UIを生成する
 */

/**
 * 決定事項を表示するブロックを生成
 * @param {{ content: string, context?: string, date: string }} decision
 * @param {number} index
 * @returns {Array}
 */
function buildDecisionBlock(decision, index) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*決定事項 #${index + 1}*\n${decision.content}${decision.context ? `\n_背景: ${decision.context}_` : ''}`
      }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✅ 承認',
            emoji: true
          },
          style: 'primary',
          action_id: `approve_decision_${index}`,
          value: JSON.stringify({ type: 'decision', index, content: decision.content })
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '❌ 却下',
            emoji: true
          },
          style: 'danger',
          action_id: `reject_decision_${index}`,
          value: JSON.stringify({ type: 'decision', index, content: decision.content })
        }
      ]
    },
    {
      type: 'divider'
    }
  ];

  return blocks;
}

/**
 * タスクを表示するブロックを生成
 * @param {{ task: string, assignee: string, deadline: string }} action
 * @param {number} index
 * @returns {Array}
 */
function buildActionBlock(action, index) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*タスク #${index + 1}*\n📋 ${action.task}\n👤 担当: ${action.assignee}\n📅 期限: ${action.deadline}`
      }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✅ 承認',
            emoji: true
          },
          style: 'primary',
          action_id: `approve_action_${index}`,
          value: JSON.stringify({ type: 'action', index, task: action.task, assignee: action.assignee, deadline: action.deadline })
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '❌ 却下',
            emoji: true
          },
          style: 'danger',
          action_id: `reject_action_${index}`,
          value: JSON.stringify({ type: 'action', index, task: action.task })
        }
      ]
    },
    {
      type: 'divider'
    }
  ];

  return blocks;
}

/**
 * サマリーブロックを生成
 * @param {string} projectId
 * @param {string} meetingDate
 * @param {number} decisionsCount
 * @param {number} actionsCount
 * @returns {Array}
 */
function buildSummaryBlock(projectId, meetingDate, decisionsCount, actionsCount) {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📋 会議内容の確認 - ${projectId}`,
        emoji: true
      }
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `📅 ${meetingDate} | 決定事項: ${decisionsCount}件 | タスク: ${actionsCount}件`
        }
      ]
    },
    {
      type: 'divider'
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✅ 全て承認',
            emoji: true
          },
          style: 'primary',
          action_id: 'approve_all',
          value: JSON.stringify({ projectId, meetingDate })
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '❌ 全て却下',
            emoji: true
          },
          style: 'danger',
          action_id: 'reject_all',
          value: JSON.stringify({ projectId, meetingDate })
        }
      ]
    },
    {
      type: 'divider'
    }
  ];
}

/**
 * 全体のブロック配列を生成
 * @param {{ decisions: Array, actions: Array }} extractionResult
 * @param {string} projectId
 * @param {string} meetingDate
 * @returns {Array}
 */
function buildProposalBlocks(extractionResult, projectId, meetingDate) {
  const blocks = [];

  const decisions = extractionResult.decisions || [];
  const actions = extractionResult.actions || [];

  // サマリーブロック
  blocks.push(...buildSummaryBlock(projectId, meetingDate, decisions.length, actions.length));

  // 決定事項セクション
  if (decisions.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📌 決定事項*'
      }
    });

    decisions.forEach((decision, index) => {
      blocks.push(...buildDecisionBlock(decision, index));
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📌 決定事項*\n_決定事項なし_'
      }
    });
  }

  // タスクセクション
  if (actions.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📋 タスク*'
      }
    });

    actions.forEach((action, index) => {
      blocks.push(...buildActionBlock(action, index));
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📋 タスク*\n_タスクなし_'
      }
    });
  }

  return blocks;
}

module.exports = {
  buildProposalBlocks,
  buildDecisionBlock,
  buildActionBlock,
  buildSummaryBlock
};
