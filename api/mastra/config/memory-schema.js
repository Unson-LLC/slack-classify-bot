/**
 * Mastra Memory Working Memory スキーマ定義
 *
 * Phase 2: Working Memory Zodスキーマ
 * - ユーザープロファイルスキーマの定義
 * - 嗜好の構造化
 * - 学習したファクトの管理
 * - 昇華（Promotion）判定ロジック
 */

const { z } = require('zod');

// 学習したファクトのスキーマ
const learnedFactSchema = z.object({
  fact: z.string().describe('学習した事実'),
  confidence: z.number().min(0).max(1).describe('確度（0.0〜1.0）'),
  source: z.string().optional().describe('情報源（conversation:C123等）'),
  learnedAt: z.string().optional().describe('学習日時（ISO 8601形式）'),
  confirmedCount: z.number().int().min(0).optional().describe('確認回数（昇華判定用）'),
});

// 嗜好（Preferences）スキーマ
const preferencesSchema = z.object({
  reportingStyle: z
    .enum(['bullet_points', 'prose', 'numbered_list'])
    .optional()
    .describe('報告形式'),
  communicationTone: z
    .enum(['formal', 'casual', 'concise'])
    .optional()
    .describe('コミュニケーションのトーン'),
  reminderTiming: z.string().optional().describe('リマインドの希望時間（HH:mm形式）'),
  includeDeadline: z.boolean().optional().describe('期限を含めるか'),
});

// 現在のコンテキストスキーマ
const currentContextSchema = z.object({
  activeProject: z.string().optional().describe('現在のアクティブプロジェクト'),
  currentGoal: z.string().optional().describe('現在の目標'),
  blockers: z.array(z.string()).optional().describe('ブロッカー一覧'),
});

// ユーザープロファイルスキーマ（Working Memory）
const userProfileSchema = z.object({
  name: z.string().optional().describe('ユーザーの名前'),
  role: z.string().optional().describe('役割（PM、エンジニア等）'),
  preferences: preferencesSchema.optional().describe('嗜好設定'),
  currentContext: currentContextSchema.optional().describe('現在のコンテキスト'),
  learnedFacts: z.array(learnedFactSchema).optional().describe('学習したファクト一覧'),
});

/**
 * 昇華対象かどうかを判定する
 *
 * 条件:
 * - confidence >= 0.9（高確度）
 * - confirmedCount >= 3（複数回確認済み）
 *
 * @param {Object} fact - learnedFactオブジェクト
 * @returns {boolean} 昇華対象ならtrue
 */
function isEligibleForPromotion(fact) {
  if (!fact || typeof fact !== 'object') {
    return false;
  }

  const confidence = fact.confidence;
  const confirmedCount = fact.confirmedCount;

  // confirmedCountが未定義または数値でない場合は対象外
  if (confirmedCount === undefined || typeof confirmedCount !== 'number') {
    return false;
  }

  return confidence >= 0.9 && confirmedCount >= 3;
}

/**
 * プロファイルから昇華候補のファクトを抽出する
 *
 * @param {Object} profile - userProfileオブジェクト
 * @returns {Array} 昇華対象のファクト配列
 */
function getPromotionCandidates(profile) {
  if (!profile || !profile.learnedFacts || !Array.isArray(profile.learnedFacts)) {
    return [];
  }

  return profile.learnedFacts.filter(isEligibleForPromotion);
}

module.exports = {
  userProfileSchema,
  preferencesSchema,
  currentContextSchema,
  learnedFactSchema,
  isEligibleForPromotion,
  getPromotionCandidates,
};
