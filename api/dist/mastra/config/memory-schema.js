/**
 * Mastra Memory Working Memory スキーマ定義
 *
 * mana AI PMのWorking Memoryで使用するZodスキーマ
 * - ユーザープロファイル（名前、役割、嗜好）
 * - 現在のコンテキスト（アクティブプロジェクト、目標、ブロッカー）
 * - 学習したファクト（昇華パス対応）
 */
import { z } from 'zod';
// 学習したファクトのスキーマ
export const learnedFactSchema = z.object({
    fact: z.string().describe('学習した事実'),
    confidence: z.number().min(0).max(1).describe('確度（0.0〜1.0）'),
    source: z.string().optional().describe('情報源（conversation:C123等）'),
    learnedAt: z.string().optional().describe('学習日時（ISO 8601形式）'),
    confirmedCount: z.number().int().min(0).optional().describe('確認回数（昇華判定用）'),
});
// 嗜好（Preferences）スキーマ
export const preferencesSchema = z.object({
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
export const currentContextSchema = z.object({
    activeProject: z.string().optional().describe('現在のアクティブプロジェクト'),
    currentGoal: z.string().optional().describe('現在の目標'),
    blockers: z.array(z.string()).optional().describe('ブロッカー一覧'),
});
// ユーザープロファイルスキーマ（Working Memory）
export const userProfileSchema = z.object({
    name: z.string().optional().describe('ユーザーの名前'),
    role: z.string().optional().describe('役割（PM、エンジニア等）'),
    preferences: preferencesSchema.optional().describe('嗜好設定'),
    currentContext: currentContextSchema.optional().describe('現在のコンテキスト'),
    learnedFacts: z.array(learnedFactSchema).optional().describe('学習したファクト一覧'),
});
// 昇華判定の閾値
export const PROMOTION_THRESHOLDS = {
    minConfidence: 0.9,
    minConfirmedCount: 3,
};
/**
 * 昇華対象かどうかを判定する
 *
 * 条件:
 * - confidence >= 0.9（高確度）
 * - confirmedCount >= 3（複数回確認済み）
 */
export function isEligibleForPromotion(fact) {
    if (!fact || typeof fact !== 'object') {
        return false;
    }
    const { confidence, confirmedCount } = fact;
    if (confirmedCount === undefined || typeof confirmedCount !== 'number') {
        return false;
    }
    return (confidence >= PROMOTION_THRESHOLDS.minConfidence &&
        confirmedCount >= PROMOTION_THRESHOLDS.minConfirmedCount);
}
/**
 * プロファイルから昇華候補のファクトを抽出する
 */
export function getPromotionCandidates(profile) {
    if (!profile || !profile.learnedFacts || !Array.isArray(profile.learnedFacts)) {
        return [];
    }
    return profile.learnedFacts.filter(isEligibleForPromotion);
}
//# sourceMappingURL=memory-schema.js.map