const SecurityClassifier = require('../security-classifier');

describe('SecurityClassifier', () => {
  let classifier;

  beforeEach(() => {
    classifier = new SecurityClassifier();
    jest.clearAllMocks();
  });

  describe('classifySecurityLevel', () => {
    it('should classify content as CONFIDENTIAL when budget keywords are present', () => {
      const content = '今期の予算は5000万円で、売上目標は1億円です。';
      const result = classifier.classifySecurityLevel(content);

      expect(result.level).toBe('CONFIDENTIAL');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result.reasoning).toContain('予算');
      expect(result.reasoning).toContain('売上');
      expect(result.recommendedRepository).toBe('company-confidential-minutes');
      expect(result.accessLevels).toEqual([4]);
    });

    it('should classify content as INTERNAL when internal process keywords are present', () => {
      const content = '社内システムの更新と組織変更について話し合いました。新しい内部プロセスを導入します。';
      const result = classifier.classifySecurityLevel(content);

      expect(result.level).toBe('INTERNAL');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.reasoning).toContain('社内システム');
      expect(result.recommendedRepository).toBe('company-internal-minutes');
      expect(result.accessLevels).toEqual([2, 3, 4]);
    });

    it('should classify content as PROJECT_SENSITIVE when project keywords are present', () => {
      const content = 'クライアント名：ABC商事、納期調整が必要です。';
      const result = classifier.classifySecurityLevel(content);

      expect(result.level).toBe('PROJECT_SENSITIVE');
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
      expect(result.reasoning).toContain('クライアント名');
      expect(result.recommendedRepository).toBe('company-internal-minutes');
      expect(result.accessLevels).toEqual([2, 3, 4]);
    });

    it('should classify content as PUBLIC when no sensitive keywords are present', () => {
      const content = '技術共有会を開催しました。オープンソースの最新トレンドについて議論しました。';
      const result = classifier.classifySecurityLevel(content);

      expect(result.level).toBe('PUBLIC');
      expect(result.reasoning).toContain('技術共有');
      expect(result.recommendedRepository).toBe('company-public-minutes');
      expect(result.accessLevels).toEqual([1, 2, 3, 4]);
    });

    it('should apply channel bonus for executive channels', () => {
      const content = '今日の会議内容です。';
      const metadata = { channel: 'executive-meeting' };
      const result = classifier.classifySecurityLevel(content, metadata);

      expect(result.level).toBe('CONFIDENTIAL');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('should apply channel bonus for internal channels', () => {
      const content = '技術的な議論をしました。';
      const metadata = { channel: 'internal-dev' };
      const result = classifier.classifySecurityLevel(content, metadata);

      expect(result.level).toBe('INTERNAL');
    });

    it('should handle empty content', () => {
      const content = '';
      const result = classifier.classifySecurityLevel(content);

      expect(result.level).toBe('PUBLIC');
      expect(result.confidence).toBeLessThanOrEqual(0.6);
    });

    it('should handle content with multiple security levels', () => {
      const content = '予算の話もありましたが、主に技術共有について議論しました。';
      const result = classifier.classifySecurityLevel(content);

      // CONFIDENTIAL should take precedence
      expect(result.level).toBe('CONFIDENTIAL');
      expect(result.reasoning).toContain('予算');
    });
  });

  describe('calculateScore', () => {
    it('should count keyword occurrences correctly', () => {
      const content = '予算について話しました。予算の見直しが必要です。';
      const keywords = ['予算', '売上'];
      const result = classifier.calculateScore(content, keywords);

      expect(result.score).toBe(2); // '予算' appears twice
      expect(result.matchedKeywords).toContain('予算');
      expect(result.matchedKeywords).not.toContain('売上');
    });

    it('should be case-insensitive', () => {
      const content = 'BUDGET and Budget and budget';
      const keywords = ['budget'];
      const result = classifier.calculateScore(content.toLowerCase(), keywords);

      expect(result.score).toBe(3);
    });
  });

  describe('getChannelSecurityBonus', () => {
    it('should return high confidential bonus for executive channels', () => {
      const bonus = classifier.getChannelSecurityBonus('executive-board');
      expect(bonus).toEqual({ confidential: 3, internal: 0 });
    });

    it('should return internal bonus for private channels', () => {
      const bonus = classifier.getChannelSecurityBonus('private-discussion');
      expect(bonus).toEqual({ confidential: 0, internal: 2 });
    });

    it('should return zero bonus for regular channels', () => {
      const bonus = classifier.getChannelSecurityBonus('general');
      expect(bonus).toEqual({ confidential: 0, internal: 0 });
    });

    it('should handle null channel names', () => {
      const bonus = classifier.getChannelSecurityBonus(null);
      expect(bonus).toEqual({ confidential: 0, internal: 0 });
    });
  });

  describe('determineClassification', () => {
    it('should prioritize CONFIDENTIAL over other levels', () => {
      const scores = {
        confidential: { score: 1, matchedKeywords: ['予算'] },
        internal: { score: 3, matchedKeywords: ['社内システム'] },
        projectSensitive: { score: 2, matchedKeywords: ['クライアント名'] },
        public: { score: 0, matchedKeywords: [] }
      };

      const result = classifier.determineClassification(scores);
      expect(result.level).toBe('CONFIDENTIAL');
    });

    it('should calculate confidence scores within valid range', () => {
      const scores = {
        confidential: { score: 10, matchedKeywords: ['予算'] },
        internal: { score: 0, matchedKeywords: [] },
        projectSensitive: { score: 0, matchedKeywords: [] },
        public: { score: 0, matchedKeywords: [] }
      };

      const result = classifier.determineClassification(scores);
      expect(result.confidence).toBeLessThanOrEqual(0.9);
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('getRecommendedRepository', () => {
    it('should return correct repository for each level', () => {
      expect(classifier.getRecommendedRepository('CONFIDENTIAL')).toBe('company-confidential-minutes');
      expect(classifier.getRecommendedRepository('INTERNAL')).toBe('company-internal-minutes');
      expect(classifier.getRecommendedRepository('PROJECT_SENSITIVE')).toBe('company-internal-minutes');
      expect(classifier.getRecommendedRepository('PUBLIC')).toBe('company-public-minutes');
    });

    it('should return default repository for unknown levels', () => {
      expect(classifier.getRecommendedRepository('UNKNOWN')).toBe('company-public-minutes');
    });
  });

  describe('getAccessLevels', () => {
    it('should return correct access levels for each security level', () => {
      expect(classifier.getAccessLevels('CONFIDENTIAL')).toEqual([4]);
      expect(classifier.getAccessLevels('INTERNAL')).toEqual([2, 3, 4]);
      expect(classifier.getAccessLevels('PROJECT_SENSITIVE')).toEqual([2, 3, 4]);
      expect(classifier.getAccessLevels('PUBLIC')).toEqual([1, 2, 3, 4]);
    });

    it('should return all access levels for unknown security levels', () => {
      expect(classifier.getAccessLevels('UNKNOWN')).toEqual([1, 2, 3, 4]);
    });
  });

  describe('logClassification', () => {
    it('should log classification details', () => {
      const consoleSpy = jest.spyOn(console, 'log');
      const content = 'Test content';
      const result = {
        level: 'INTERNAL',
        confidence: 0.7,
        reasoning: 'Test reasoning',
        recommendedRepository: 'test-repo',
        accessLevels: [2, 3, 4],
        scores: {}
      };
      const metadata = { channel: 'test-channel', user: 'test-user' };

      classifier.logClassification(content, result, metadata);

      expect(consoleSpy).toHaveBeenCalledWith('=== Security Classification ===');
      expect(consoleSpy).toHaveBeenCalledWith('Content length:', 12);
      expect(consoleSpy).toHaveBeenCalledWith('Channel:', 'test-channel');
      expect(consoleSpy).toHaveBeenCalledWith('User:', 'test-user');
      expect(consoleSpy).toHaveBeenCalledWith('Classification:', 'INTERNAL');
    });
  });
});