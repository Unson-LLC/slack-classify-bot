/**
 * Mastra Memory Working Memory スキーマのテスト
 *
 * Phase 2: Working Memory Zodスキーマ
 * - ユーザープロファイルスキーマの定義
 * - 嗜好の構造化
 * - 学習したファクトの管理
 *
 * t_wada式TDD: Red → Green → Refactor
 */

const { z } = require('zod');

describe('UserProfileSchema', () => {
  let userProfileSchema;

  beforeAll(() => {
    // スキーマをインポート（まだ存在しない）
    const schemas = require('../mastra/config/memory-schema');
    userProfileSchema = schemas.userProfileSchema;
  });

  describe('基本情報', () => {
    it('nameとroleを保存できる', () => {
      // Arrange
      const profile = {
        name: '佐藤 圭吾',
        role: 'PM',
      };

      // Act
      const result = userProfileSchema.safeParse(profile);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.name).toBe('佐藤 圭吾');
      expect(result.data.role).toBe('PM');
    });

    it('空のオブジェクトでも有効（全てoptional）', () => {
      // Act
      const result = userProfileSchema.safeParse({});

      // Assert
      expect(result.success).toBe(true);
    });
  });

  describe('preferences（嗜好）', () => {
    it('reportingStyleを保存できる', () => {
      // Arrange
      const profile = {
        preferences: {
          reportingStyle: 'bullet_points',
        },
      };

      // Act
      const result = userProfileSchema.safeParse(profile);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.preferences.reportingStyle).toBe('bullet_points');
    });

    it('reportingStyleは定義された値のみ許可', () => {
      // Arrange
      const validStyles = ['bullet_points', 'prose', 'numbered_list'];
      const invalidProfile = {
        preferences: {
          reportingStyle: 'invalid_style',
        },
      };

      // Act & Assert
      for (const style of validStyles) {
        const result = userProfileSchema.safeParse({
          preferences: { reportingStyle: style },
        });
        expect(result.success).toBe(true);
      }

      const invalidResult = userProfileSchema.safeParse(invalidProfile);
      expect(invalidResult.success).toBe(false);
    });

    it('communicationToneを保存できる', () => {
      // Arrange
      const profile = {
        preferences: {
          communicationTone: 'concise',
        },
      };

      // Act
      const result = userProfileSchema.safeParse(profile);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.preferences.communicationTone).toBe('concise');
    });

    it('communicationToneは定義された値のみ許可', () => {
      // Arrange
      const validTones = ['formal', 'casual', 'concise'];

      // Act & Assert
      for (const tone of validTones) {
        const result = userProfileSchema.safeParse({
          preferences: { communicationTone: tone },
        });
        expect(result.success).toBe(true);
      }

      const invalidResult = userProfileSchema.safeParse({
        preferences: { communicationTone: 'invalid' },
      });
      expect(invalidResult.success).toBe(false);
    });

    it('reminderTimingを保存できる', () => {
      // Arrange
      const profile = {
        preferences: {
          reminderTiming: '09:00',
        },
      };

      // Act
      const result = userProfileSchema.safeParse(profile);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.preferences.reminderTiming).toBe('09:00');
    });

    it('includeDeadlineを保存できる', () => {
      // Arrange
      const profile = {
        preferences: {
          includeDeadline: true,
        },
      };

      // Act
      const result = userProfileSchema.safeParse(profile);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.preferences.includeDeadline).toBe(true);
    });
  });

  describe('currentContext（現在のコンテキスト）', () => {
    it('activeProjectを保存できる', () => {
      // Arrange
      const profile = {
        currentContext: {
          activeProject: 'salestailor',
        },
      };

      // Act
      const result = userProfileSchema.safeParse(profile);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.currentContext.activeProject).toBe('salestailor');
    });

    it('currentGoalを保存できる', () => {
      // Arrange
      const profile = {
        currentContext: {
          currentGoal: 'LP改善のA/Bテスト完了',
        },
      };

      // Act
      const result = userProfileSchema.safeParse(profile);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.currentContext.currentGoal).toBe('LP改善のA/Bテスト完了');
    });

    it('blockersを配列で保存できる', () => {
      // Arrange
      const profile = {
        currentContext: {
          blockers: ['API仕様待ち', 'デザイン確認中'],
        },
      };

      // Act
      const result = userProfileSchema.safeParse(profile);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.currentContext.blockers).toEqual(['API仕様待ち', 'デザイン確認中']);
    });
  });

  describe('learnedFacts（学習したファクト）', () => {
    it('ファクトを配列で保存できる', () => {
      // Arrange
      const profile = {
        learnedFacts: [
          {
            fact: '佐藤は箇条書き形式の報告を好む',
            confidence: 0.95,
            source: 'conversation:C123',
            learnedAt: '2025-12-10T10:00:00Z',
          },
        ],
      };

      // Act
      const result = userProfileSchema.safeParse(profile);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.learnedFacts).toHaveLength(1);
      expect(result.data.learnedFacts[0].fact).toBe('佐藤は箇条書き形式の報告を好む');
      expect(result.data.learnedFacts[0].confidence).toBe(0.95);
    });

    it('confidenceは0.0〜1.0の範囲', () => {
      // Arrange
      const validProfile = {
        learnedFacts: [{ fact: 'test', confidence: 0.5 }],
      };
      const tooLow = {
        learnedFacts: [{ fact: 'test', confidence: -0.1 }],
      };
      const tooHigh = {
        learnedFacts: [{ fact: 'test', confidence: 1.1 }],
      };

      // Act & Assert
      expect(userProfileSchema.safeParse(validProfile).success).toBe(true);
      expect(userProfileSchema.safeParse(tooLow).success).toBe(false);
      expect(userProfileSchema.safeParse(tooHigh).success).toBe(false);
    });

    it('factは必須、他はオプション', () => {
      // Arrange
      const minimalFact = {
        learnedFacts: [{ fact: '最小限のファクト', confidence: 0.5 }],
      };
      const missingFact = {
        learnedFacts: [{ confidence: 0.5 }],
      };

      // Act & Assert
      expect(userProfileSchema.safeParse(minimalFact).success).toBe(true);
      expect(userProfileSchema.safeParse(missingFact).success).toBe(false);
    });

    it('confirmedCountを保存できる（昇華判定用）', () => {
      // Arrange
      const profile = {
        learnedFacts: [
          {
            fact: '佐藤は期限を必ず含めることを好む',
            confidence: 0.92,
            confirmedCount: 6,
          },
        ],
      };

      // Act
      const result = userProfileSchema.safeParse(profile);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.learnedFacts[0].confirmedCount).toBe(6);
    });
  });

  describe('複合シナリオ', () => {
    it('フルプロファイルを保存できる', () => {
      // Arrange
      const fullProfile = {
        name: '佐藤 圭吾',
        role: 'PM',
        preferences: {
          reportingStyle: 'numbered_list',
          communicationTone: 'concise',
          reminderTiming: '09:00',
          includeDeadline: true,
        },
        currentContext: {
          activeProject: 'salestailor',
          currentGoal: 'Q1 KPI達成',
          blockers: [],
        },
        learnedFacts: [
          {
            fact: '番号付きリストを好む',
            confidence: 0.95,
            confirmedCount: 8,
            source: 'conversation:C789',
            learnedAt: '2025-12-10T10:00:00Z',
          },
          {
            fact: '期限を必ず含める',
            confidence: 0.92,
            confirmedCount: 6,
          },
        ],
      };

      // Act
      const result = userProfileSchema.safeParse(fullProfile);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject(fullProfile);
    });
  });
});

describe('isEligibleForPromotion（昇華判定）', () => {
  let isEligibleForPromotion;

  beforeAll(() => {
    const schemas = require('../mastra/config/memory-schema');
    isEligibleForPromotion = schemas.isEligibleForPromotion;
  });

  it('confidence >= 0.9 かつ confirmedCount >= 3 で昇華対象', () => {
    // Arrange
    const eligibleFact = {
      fact: '佐藤は箇条書きを好む',
      confidence: 0.95,
      confirmedCount: 5,
    };

    // Act & Assert
    expect(isEligibleForPromotion(eligibleFact)).toBe(true);
  });

  it('confidence < 0.9 は昇華対象外', () => {
    // Arrange
    const lowConfidence = {
      fact: 'テスト',
      confidence: 0.85,
      confirmedCount: 10,
    };

    // Act & Assert
    expect(isEligibleForPromotion(lowConfidence)).toBe(false);
  });

  it('confirmedCount < 3 は昇華対象外', () => {
    // Arrange
    const lowCount = {
      fact: 'テスト',
      confidence: 0.95,
      confirmedCount: 2,
    };

    // Act & Assert
    expect(isEligibleForPromotion(lowCount)).toBe(false);
  });

  it('confirmedCountが未定義は昇華対象外', () => {
    // Arrange
    const noCount = {
      fact: 'テスト',
      confidence: 0.95,
    };

    // Act & Assert
    expect(isEligibleForPromotion(noCount)).toBe(false);
  });
});

describe('getPromotionCandidates（昇華候補抽出）', () => {
  let getPromotionCandidates;

  beforeAll(() => {
    const schemas = require('../mastra/config/memory-schema');
    getPromotionCandidates = schemas.getPromotionCandidates;
  });

  it('昇華対象のファクトのみを抽出する', () => {
    // Arrange
    const profile = {
      learnedFacts: [
        { fact: '対象1', confidence: 0.95, confirmedCount: 5 },
        { fact: '対象外（低確度）', confidence: 0.80, confirmedCount: 10 },
        { fact: '対象2', confidence: 0.90, confirmedCount: 3 },
        { fact: '対象外（少回数）', confidence: 0.95, confirmedCount: 2 },
      ],
    };

    // Act
    const candidates = getPromotionCandidates(profile);

    // Assert
    expect(candidates).toHaveLength(2);
    expect(candidates[0].fact).toBe('対象1');
    expect(candidates[1].fact).toBe('対象2');
  });

  it('learnedFactsが空の場合は空配列を返す', () => {
    // Arrange
    const emptyProfile = { learnedFacts: [] };
    const noFacts = {};

    // Act & Assert
    expect(getPromotionCandidates(emptyProfile)).toEqual([]);
    expect(getPromotionCandidates(noFacts)).toEqual([]);
  });
});
