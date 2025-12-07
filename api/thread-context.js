/**
 * スレッドコンテキスト取得モジュール
 *
 * Slackスレッド内の過去メッセージを取得し、
 * LLMに渡す文脈として整形する。
 *
 * Usage:
 *   const { getThreadContext } = require('./thread-context');
 *   const context = await getThreadContext({
 *     client: slackClient,
 *     channel: 'C123456',
 *     threadTs: '1234567890.000',
 *     currentTs: '1234567890.002',
 *     slackIdToName: new Map([['U001', '佐藤 圭吾']])
 *   });
 */

/**
 * スレッド内の過去メッセージを取得して文脈文字列を生成する
 *
 * @param {Object} options
 * @param {Object} options.client - Slack WebClient
 * @param {string} options.channel - チャンネルID
 * @param {string|null} options.threadTs - スレッドのタイムスタンプ（親メッセージのts）
 * @param {string} options.currentTs - 現在のメッセージのタイムスタンプ
 * @param {Map<string, string>} options.slackIdToName - Slack ID → 名前のマッピング
 * @param {number} [options.limit=10] - 取得するメッセージ数の上限
 * @returns {Promise<string>} フォーマットされた文脈文字列（空の場合は空文字）
 */
async function getThreadContext({
  client,
  channel,
  threadTs,
  currentTs,
  slackIdToName,
  limit = 10
}) {
  // スレッドでない場合は空文字を返す
  if (!threadTs) {
    return '';
  }

  try {
    const threadResult = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit
    });

    const messages = threadResult.messages || [];

    // メッセージが1つしかない場合（親メッセージのみ）は空文字を返す
    if (messages.length <= 1) {
      return '';
    }

    // 現在のメッセージを除外し、テキストを整形
    const contextMessages = [];
    for (const msg of messages) {
      // 現在のメッセージはスキップ
      if (msg.ts === currentTs) continue;

      // ユーザー名を解決
      const userName = slackIdToName.get(msg.user) || msg.user;

      // メンションを除去してテキストを整形
      const cleanedText = (msg.text || '')
        .replace(/<@[A-Z0-9]+>/g, '')
        .trim();

      if (cleanedText) {
        contextMessages.push({ user: userName, text: cleanedText });
      }
    }

    return formatThreadContext(contextMessages);
  } catch (error) {
    console.warn('Failed to get thread context:', error.message);
    return '';
  }
}

/**
 * メッセージ配列をフォーマットされた文脈文字列に変換する
 *
 * @param {Array<{user: string, text: string}>} messages
 * @returns {string}
 */
function formatThreadContext(messages) {
  if (!messages || messages.length === 0) {
    return '';
  }

  const formatted = messages
    .map(m => `${m.user}: ${m.text}`)
    .join('\n');

  return `\n\n【スレッドの文脈】\n${formatted}`;
}

module.exports = {
  getThreadContext,
  formatThreadContext
};
