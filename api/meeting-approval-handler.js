/**
 * meeting-approval-handler.js
 * Slack UIの承認/却下ボタン押下を処理する
 */

const { registerMeetingTasks } = require('./meeting-task-registration');
const { commitDecisions } = require('./meeting-decision-commit');

/**
 * ボタンのvalueをパースする
 * @param {string} value - JSON文字列
 * @returns {Object | null}
 */
function parseActionValue(value) {
  try {
    return JSON.parse(value);
  } catch (e) {
    return null;
  }
}

/**
 * 個別承認アクションを処理
 * @param {{ type: string, index: number, content?: string, task?: string, assignee?: string, deadline?: string }} actionValue
 * @param {{ projectId: string, meetingDate: string, decisions: Array, actions: Array }} context
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function handleApprovalAction(actionValue, context) {
  const { type, index } = actionValue;
  const { projectId, meetingDate, decisions, actions } = context;

  try {
    if (type === 'decision') {
      const decision = decisions[index];
      if (!decision) {
        return { success: false, error: `Decision at index ${index} not found` };
      }

      const result = await commitDecisions([decision], projectId, meetingDate);
      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, committed: result.committed };
    }

    if (type === 'action') {
      const action = actions[index];
      if (!action) {
        return { success: false, error: `Action at index ${index} not found` };
      }

      const result = await registerMeetingTasks([action], projectId, meetingDate);
      if (!result.success) {
        return { success: false, error: result.error };
      }

      return { success: true, registered: result.registered };
    }

    return { success: false, error: `Unknown type: ${type}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 個別却下アクションを処理
 * @param {{ type: string, index: number }} actionValue
 * @returns {Promise<{ success: boolean, rejected: boolean }>}
 */
async function handleRejectAction(actionValue) {
  // 却下時は何も登録せず成功を返す
  return { success: true, rejected: true, type: actionValue.type, index: actionValue.index };
}

/**
 * 全承認アクションを処理
 * @param {{ projectId: string, meetingDate: string, decisions: Array, actions: Array }} context
 * @returns {Promise<{ success: boolean, decisionsCommitted: number, actionsRegistered: number, errors?: Array }>}
 */
async function handleApproveAll(context) {
  const { projectId, meetingDate, decisions, actions } = context;
  const errors = [];

  let decisionsCommitted = 0;
  let actionsRegistered = 0;

  // 決定事項をコミット
  if (decisions && decisions.length > 0) {
    const decisionResult = await commitDecisions(decisions, projectId, meetingDate);
    if (decisionResult.success) {
      decisionsCommitted = decisionResult.committed;
    } else {
      errors.push({ type: 'decisions', error: decisionResult.error });
    }
  }

  // タスクを登録
  if (actions && actions.length > 0) {
    const actionResult = await registerMeetingTasks(actions, projectId, meetingDate);
    if (actionResult.success) {
      actionsRegistered = actionResult.registered;
    } else {
      errors.push({ type: 'actions', error: actionResult.error });
    }
  }

  return {
    success: errors.length === 0,
    decisionsCommitted,
    actionsRegistered,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * 全却下アクションを処理
 * @param {{ projectId: string, meetingDate: string, decisions: Array, actions: Array }} context
 * @returns {Promise<{ success: boolean, rejected: boolean, decisionsRejected: number, actionsRejected: number }>}
 */
async function handleRejectAll(context) {
  const { decisions, actions } = context;

  return {
    success: true,
    rejected: true,
    decisionsRejected: decisions?.length || 0,
    actionsRejected: actions?.length || 0
  };
}

module.exports = {
  handleApprovalAction,
  handleRejectAction,
  handleApproveAll,
  handleRejectAll,
  parseActionValue
};
