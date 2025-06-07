/**
 * セキュリティ分類エンジン
 * 議事録コンテンツの機密度を自動判定
 */

class SecurityClassifier {
  constructor() {
    // 機密度判定用キーワード
    this.confidentialKeywords = [
      '予算', '売上', '利益', '損失', '収益',
      '人事評価', '給与', '賞与', '昇進', '降格',
      '戦略', '買収', '合併', '機密', '秘密',
      '競合分析', '市場戦略', '価格戦略',
      '契約金額', '取引条件', '財務情報'
    ];
    
    this.internalKeywords = [
      '社内システム', '内部プロセス', '組織変更', '組織再編',
      'リソース配分', '人員配置', '技術仕様', '開発計画',
      '社内規定', '内部監査', '品質管理', 'セキュリティ対策',
      '採用計画', '研修計画', '評価制度'
    ];
    
    this.projectSensitiveKeywords = [
      'クライアント名', '顧客情報', '契約条件', '価格情報',
      '納期調整', 'トラブル対応', '課題', '問題',
      '要件変更', 'スコープ変更', 'リスク', '遅延',
      '品質問題', 'バグ', '障害', 'インシデント'
    ];
    
    this.publicKeywords = [
      '技術共有', '勉強会', '研修', '一般的な進捗',
      'ツール紹介', 'ベストプラクティス', '業界動向',
      '技術トレンド', 'オープンソース', '公開情報'
    ];
  }

  /**
   * コンテンツの機密度を判定
   * @param {string} content - 判定対象のコンテンツ
   * @param {object} metadata - メタデータ（チャンネル、ユーザー等）
   * @returns {object} 分類結果
   */
  classifySecurityLevel(content, metadata = {}) {
    const lowerContent = content.toLowerCase();
    
    // スコア計算
    const scores = {
      confidential: this.calculateScore(lowerContent, this.confidentialKeywords),
      internal: this.calculateScore(lowerContent, this.internalKeywords),
      projectSensitive: this.calculateScore(lowerContent, this.projectSensitiveKeywords),
      public: this.calculateScore(lowerContent, this.publicKeywords)
    };
    
    // チャンネル名による追加判定
    const channelBonus = this.getChannelSecurityBonus(metadata.channel);
    scores.confidential += channelBonus.confidential;
    scores.internal += channelBonus.internal;
    
    // 分類決定
    const classification = this.determineClassification(scores);
    
    return {
      level: classification.level,
      confidence: classification.confidence,
      scores: scores,
      reasoning: classification.reasoning,
      recommendedRepository: this.getRecommendedRepository(classification.level),
      accessLevels: this.getAccessLevels(classification.level)
    };
  }

  /**
   * キーワードスコアを計算
   */
  calculateScore(content, keywords) {
    let score = 0;
    let matchedKeywords = [];
    
    keywords.forEach(keyword => {
      const regex = new RegExp(keyword, 'gi');
      const matches = content.match(regex);
      if (matches) {
        score += matches.length;
        matchedKeywords.push(keyword);
      }
    });
    
    return { score, matchedKeywords };
  }

  /**
   * チャンネル名による機密度ボーナス
   */
  getChannelSecurityBonus(channelName) {
    if (!channelName) return { confidential: 0, internal: 0 };
    
    const lowerChannel = channelName.toLowerCase();
    
    // 機密チャンネル
    if (lowerChannel.includes('executive') || 
        lowerChannel.includes('board') || 
        lowerChannel.includes('confidential') ||
        lowerChannel.includes('management')) {
      return { confidential: 3, internal: 0 };
    }
    
    // 社内チャンネル
    if (lowerChannel.includes('internal') || 
        lowerChannel.includes('private') ||
        lowerChannel.includes('staff')) {
      return { confidential: 0, internal: 2 };
    }
    
    return { confidential: 0, internal: 0 };
  }

  /**
   * 最終的な分類を決定
   */
  determineClassification(scores) {
    const confidentialScore = scores.confidential.score;
    const internalScore = scores.internal.score;
    const projectSensitiveScore = scores.projectSensitive.score;
    const publicScore = scores.public.score;
    
    // 機密情報の判定（閾値: 1以上）
    if (confidentialScore >= 1) {
      return {
        level: 'CONFIDENTIAL',
        confidence: Math.min(0.9, 0.6 + (confidentialScore * 0.1)),
        reasoning: `機密キーワード検出: ${scores.confidential.matchedKeywords.join(', ')}`
      };
    }
    
    // 社内情報の判定（閾値: 2以上）
    if (internalScore >= 2) {
      return {
        level: 'INTERNAL',
        confidence: Math.min(0.8, 0.5 + (internalScore * 0.1)),
        reasoning: `社内キーワード検出: ${scores.internal.matchedKeywords.join(', ')}`
      };
    }
    
    // プロジェクト機密の判定（閾値: 1以上）
    if (projectSensitiveScore >= 1) {
      return {
        level: 'PROJECT_SENSITIVE',
        confidence: Math.min(0.7, 0.4 + (projectSensitiveScore * 0.1)),
        reasoning: `プロジェクト機密キーワード検出: ${scores.projectSensitive.matchedKeywords.join(', ')}`
      };
    }
    
    // パブリック情報
    return {
      level: 'PUBLIC',
      confidence: Math.max(0.3, 0.6 - (internalScore + projectSensitiveScore) * 0.1),
      reasoning: publicScore > 0 ? 
        `パブリックキーワード検出: ${scores.public.matchedKeywords.join(', ')}` : 
        '機密キーワードが検出されませんでした'
    };
  }

  /**
   * 推奨リポジトリを取得
   */
  getRecommendedRepository(level) {
    const repositories = {
      'CONFIDENTIAL': 'company-confidential-minutes',
      'INTERNAL': 'company-internal-minutes',
      'PROJECT_SENSITIVE': 'company-internal-minutes',
      'PUBLIC': 'company-public-minutes'
    };
    
    return repositories[level] || 'company-public-minutes';
  }

  /**
   * アクセス可能な権限レベルを取得
   */
  getAccessLevels(securityLevel) {
    const accessMatrix = {
      'CONFIDENTIAL': [4], // 役員のみ
      'INTERNAL': [2, 3, 4], // 正社員以上
      'PROJECT_SENSITIVE': [2, 3, 4], // 正社員以上（プロジェクト参加者）
      'PUBLIC': [1, 2, 3, 4] // 全員
    };
    
    return accessMatrix[securityLevel] || [1, 2, 3, 4];
  }

  /**
   * 分類結果をログ出力
   */
  logClassification(content, result, metadata = {}) {
    console.log('=== Security Classification ===');
    console.log('Content length:', content.length);
    console.log('Channel:', metadata.channel || 'unknown');
    console.log('User:', metadata.user || 'unknown');
    console.log('Classification:', result.level);
    console.log('Confidence:', result.confidence);
    console.log('Reasoning:', result.reasoning);
    console.log('Recommended Repository:', result.recommendedRepository);
    console.log('Access Levels:', result.accessLevels);
    console.log('Scores:', JSON.stringify(result.scores, null, 2));
    console.log('===============================');
  }
}

module.exports = SecurityClassifier; 