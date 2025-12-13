/**
 * memory-helper.cjs
 * Working Memory取得のCJSラッパー
 * ReminderService（CJS）からMastra Memory（ESM）を呼び出すためのブリッジ
 */

let memoryModule = null;

/**
 * ESMモジュールを動的にインポートする
 * @returns {Promise<object>} memoryモジュール
 */
async function getMemoryModule() {
  if (!memoryModule) {
    memoryModule = await import('./dist/mastra/config/memory.js');
  }
  return memoryModule;
}

/**
 * ユーザーのWorking Memoryを取得する
 * @param {string} resourceId - Slack User ID（例: U07LNUP582X）
 * @returns {Promise<object|null>} UserProfileまたはnull
 */
async function getUserWorkingMemory(resourceId) {
  const memory = await getMemoryModule();
  return memory.getUserWorkingMemory(resourceId);
}

/**
 * ユーザーのリマインド希望時刻を取得する
 * @param {string} resourceId - Slack User ID
 * @returns {Promise<string|null>} HH:mm形式の時刻文字列、または未設定の場合null
 */
async function getUserReminderTiming(resourceId) {
  const memory = await getMemoryModule();
  return memory.getUserReminderTiming(resourceId);
}

module.exports = {
  getUserWorkingMemory,
  getUserReminderTiming,
};
