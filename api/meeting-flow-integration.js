/**
 * meeting-flow-integration.js
 * 議事録生成フローにAI提案+人間承認機能を統合するエントリーポイント
 *
 * 使い方:
 * 1. 議事録投稿後に sendProposalMessage() を呼ぶ
 * 2. Slack action handler で handleMeetingApprovalAction() を登録
 */

const { extractDecisionsAndActions } = require('./meeting-decision-extractor');
const { buildProposalBlocks } = require('./meeting-proposal-ui');
const {
  handleApprovalAction,
  handleRejectAction,
  handleApproveAll,
  handleRejectAll,
  parseActionValue
} = require('./meeting-approval-handler');

// 提案メッセージの状態を一時保存（Lambda環境ではDynamoDBに移行推奨）
const proposalContextStore = new Map();

/**
 * 議事録から決定事項・タスクを抽出して提案UIをSlackに送信
 * @param {Object} client - Slack client
 * @param {string} channelId - 送信先チャンネル
 * @param {string} transcript - 議事録テキスト（または文字起こし）
 * @param {string} projectId - プロジェクトID
 * @param {string} projectName - プロジェクト名
 * @param {string} meetingDate - YYYY-MM-DD形式
 * @param {Object} existingActions - 既存の議事録生成で抽出されたactions（あれば）
 * @returns {Promise<{ success: boolean, messageTs?: string, error?: string }>}
 */
async function sendProposalMessage(client, channelId, transcript, projectId, projectName, meetingDate, existingActions = null) {
  try {
    // 決定事項を抽出（タスクは既存のものを使用するか、なければ抽出）
    const extractionResult = await extractDecisionsAndActions(transcript, projectName, meetingDate);

    // 既存のactionsがあればそちらを優先
    if (existingActions && existingActions.length > 0) {
      extractionResult.actions = existingActions;
    }

    // 抽出結果が空なら提案UIは不要
    if (extractionResult.decisions.length === 0 && extractionResult.actions.length === 0) {
      console.log('[meeting-flow] No decisions or actions found, skipping proposal UI');
      return { success: true, skipped: true };
    }

    // Slack Block Kit UIを生成
    const blocks = buildProposalBlocks(extractionResult, projectId, meetingDate);

    // Slackに送信
    const result = await client.chat.postMessage({
      channel: channelId,
      blocks,
      text: `📋 会議内容の確認 - ${projectId} (${meetingDate})`
    });

    // コンテキストを保存（後の承認アクションで使用）
    const contextKey = result.ts;
    proposalContextStore.set(contextKey, {
      projectId,
      projectName,
      meetingDate,
      decisions: extractionResult.decisions,
      actions: extractionResult.actions,
      channelId,
      createdAt: Date.now()
    });

    // 古いコンテキストを削除（1時間以上前のもの）
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [key, ctx] of proposalContextStore.entries()) {
      if (ctx.createdAt < oneHourAgo) {
        proposalContextStore.delete(key);
      }
    }

    console.log(`[meeting-flow] Proposal message sent: ${result.ts}, decisions: ${extractionResult.decisions.length}, actions: ${extractionResult.actions.length}`);

    return {
      success: true,
      messageTs: result.ts,
      decisions: extractionResult.decisions.length,
      actions: extractionResult.actions.length
    };
  } catch (error) {
    console.error('[meeting-flow] Error sending proposal message:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Slack action handler - 承認/却下ボタン押下時に呼び出す
 * @param {Object} payload - Slack action payload
 * @param {Object} client - Slack client
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function handleMeetingApprovalAction(payload, client) {
  const { action, message, channel } = payload;
  const actionId = action.action_id;
  const messageTs = message.ts;

  // コンテキストを取得
  const context = proposalContextStore.get(messageTs);
  if (!context) {
    console.error(`[meeting-flow] Context not found for message: ${messageTs}`);
    return { success: false, error: 'コンテキストが見つかりません。再度議事録を処理してください。' };
  }

  try {
    let result;
    let statusMessage;

    // アクション種別に応じて処理
    if (actionId === 'approve_all') {
      result = await handleApproveAll(context);
      statusMessage = `✅ 全て承認しました\n- 決定事項: ${result.decisionsCommitted || 0}件 → GitHub\n- タスク: ${result.actionsRegistered || 0}件 → Airtable`;
    } else if (actionId === 'reject_all') {
      result = await handleRejectAll(context);
      statusMessage = `❌ 全て却下しました\n- 決定事項: ${result.decisionsRejected || 0}件\n- タスク: ${result.actionsRejected || 0}件`;
    } else if (actionId.startsWith('approve_decision_') || actionId.startsWith('approve_action_')) {
      const actionValue = parseActionValue(action.value);
      result = await handleApprovalAction(actionValue, context);
      statusMessage = `✅ 承認しました: ${actionValue.content || actionValue.task}`;
    } else if (actionId.startsWith('reject_decision_') || actionId.startsWith('reject_action_')) {
      const actionValue = parseActionValue(action.value);
      result = await handleRejectAction(actionValue);
      statusMessage = `❌ 却下しました: ${actionValue.content || actionValue.task}`;
    } else {
      return { success: false, error: `Unknown action: ${actionId}` };
    }

    // UIを更新
    if (actionId === 'approve_all' || actionId === 'reject_all') {
      // 一括処理の場合はメッセージ全体を更新
      await client.chat.update({
        channel: channel.id,
        ts: messageTs,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📋 *会議内容の処理完了*\n\n${statusMessage}`
            }
          }
        ],
        text: statusMessage
      });

      // コンテキストを削除
      proposalContextStore.delete(messageTs);
    } else {
      // 個別処理の場合はボタンを無効化（簡易実装：メッセージは更新しない）
      // TODO: 該当ボタンのみ無効化する高度な実装
    }

    return { success: true, message: statusMessage };
  } catch (error) {
    console.error('[meeting-flow] Error handling approval action:', error);
    return { success: false, error: error.message };
  }
}

/**
 * index.jsのSlack Boltアプリに登録するアクションハンドラを返す
 * @returns {Object} { actionIds: string[], handler: Function }
 */
function getSlackActionHandlers() {
  const actionIds = [
    'approve_all',
    'reject_all',
    /^approve_decision_\d+$/,
    /^reject_decision_\d+$/,
    /^approve_action_\d+$/,
    /^reject_action_\d+$/
  ];

  return {
    actionIds,
    handler: handleMeetingApprovalAction
  };
}

module.exports = {
  sendProposalMessage,
  handleMeetingApprovalAction,
  getSlackActionHandlers,
  // テスト用
  proposalContextStore
};
