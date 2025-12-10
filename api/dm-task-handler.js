/**
 * dm-task-handler.js
 * DM経由の個人タスク登録を処理するユーティリティ
 */

/**
 * チャンネルタイプがDM（ダイレクトメッセージ）かどうかを判定
 * @param {string} channelType - Slackのchannel_type
 * @returns {boolean} - DMならtrue
 */
function isDMChannel(channelType) {
  return channelType === 'im';
}

/**
 * Slack IDからユーザーID（brainbase形式）を取得
 * @param {string} slackId - Slack User ID
 * @param {Object} slackIdMap - Slack ID → ユーザーIDのマッピング
 * @returns {Promise<string|null>} - ユーザーID（見つからない場合はnull）
 */
async function getUserIdFromSlackId(slackId, slackIdMap) {
  if (!slackId || !slackIdMap) {
    return null;
  }
  return slackIdMap[slackId] || null;
}

/**
 * タスクの保存先を決定する
 * @param {Object} options - オプション
 * @param {string} options.channelType - Slackのchannel_type
 * @param {string} options.senderSlackId - 送信者のSlack ID
 * @param {Object} options.slackIdMap - Slack ID → ユーザーIDのマッピング
 * @returns {Promise<Object>} - 保存先情報
 */
async function determineTaskDestination({ channelType, senderSlackId, slackIdMap }) {
  // DMでない場合は共有タスク
  if (!isDMChannel(channelType)) {
    return {
      isPersonal: false,
      destination: '_tasks/index.md'
    };
  }

  // DMの場合はユーザーIDを解決
  const userId = await getUserIdFromSlackId(senderSlackId, slackIdMap);

  // ユーザーIDが解決できない場合は共有タスクにフォールバック
  if (!userId) {
    return {
      isPersonal: false,
      destination: '_tasks/index.md',
      fallbackReason: 'unknown_user'
    };
  }

  // 個人タスクとして登録
  return {
    isPersonal: true,
    userId,
    destination: `_tasks/personal/${userId}.md`
  };
}

module.exports = {
  isDMChannel,
  getUserIdFromSlackId,
  determineTaskDestination
};
