/**
 * ユーザー権限管理システム
 * Slackユーザーの権限レベルとアクセス制御を管理
 */

class UserPermissions {
  constructor(airtableIntegration) {
    this.airtableIntegration = airtableIntegration;
    
    // デフォルト権限設定（Airtableから取得できない場合のフォールバック）
    this.defaultPermissions = {
      level: 1, // 業務委託レベル
      projects: [],
      departments: [],
      isContractor: true
    };
    
    // 権限キャッシュ（パフォーマンス向上のため）
    this.permissionCache = new Map();
    this.cacheExpiry = 30 * 60 * 1000; // 30分
  }

  /**
   * ユーザーの権限情報を取得
   * @param {string} userId - SlackユーザーID
   * @returns {object} 権限情報
   */
  async getUserPermissions(userId) {
    try {
      // キャッシュチェック
      const cached = this.permissionCache.get(userId);
      if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
        console.log(`Using cached permissions for user: ${userId}`);
        return cached.permissions;
      }

      // Airtableから権限情報を取得
      const userInfo = await this.fetchUserInfoFromAirtable(userId);
      
      if (!userInfo) {
        console.log(`User not found in Airtable, using default permissions: ${userId}`);
        return this.defaultPermissions;
      }

      const permissions = {
        level: userInfo.accessLevel || 1,
        projects: userInfo.accessibleProjects || [],
        departments: userInfo.departments || [],
        isContractor: userInfo.employmentType === 'contractor',
        email: userInfo.email,
        name: userInfo.name,
        role: userInfo.role
      };

      // キャッシュに保存
      this.permissionCache.set(userId, {
        permissions,
        timestamp: Date.now()
      });

      console.log(`Retrieved permissions for user ${userId}:`, permissions);
      return permissions;

    } catch (error) {
      console.error(`Error getting user permissions for ${userId}:`, error);
      return this.defaultPermissions;
    }
  }

  /**
   * Airtableからユーザー情報を取得
   */
  async fetchUserInfoFromAirtable(userId) {
    try {
      // Airtableのユーザー管理テーブルから情報を取得
      const users = await this.airtableIntegration.getUsers();
      const user = users.find(u => u.slackUserId === userId);
      
      return user;
    } catch (error) {
      console.error('Error fetching user info from Airtable:', error);
      return null;
    }
  }

  /**
   * コンテンツに対するアクセス権限をチェック
   * @param {object} content - チェック対象のコンテンツ
   * @param {object} userPermissions - ユーザー権限
   * @returns {boolean} アクセス可能かどうか
   */
  hasAccessToContent(content, userPermissions) {
    // 機密度レベルチェック
    if (!this.hasSecurityLevelAccess(content.securityLevel, userPermissions.level)) {
      return false;
    }

    // プロジェクトアクセス権チェック
    if (content.projectId && !this.hasProjectAccess(content.projectId, userPermissions)) {
      return false;
    }

    // 業務委託メンバーの追加制限
    if (userPermissions.isContractor && content.internalOnly) {
      return false;
    }

    // 部門制限チェック
    if (content.departmentRestricted && 
        !this.hasDepartmentAccess(content.department, userPermissions)) {
      return false;
    }

    return true;
  }

  /**
   * セキュリティレベルに対するアクセス権限をチェック
   */
  hasSecurityLevelAccess(securityLevel, userLevel) {
    const requiredLevels = {
      'PUBLIC': 1,
      'PROJECT_SENSITIVE': 2,
      'INTERNAL': 2,
      'CONFIDENTIAL': 4
    };

    const required = requiredLevels[securityLevel] || 1;
    return userLevel >= required;
  }

  /**
   * プロジェクトアクセス権をチェック
   */
  hasProjectAccess(projectId, userPermissions) {
    // 管理職以上は全プロジェクトにアクセス可能
    if (userPermissions.level >= 3) {
      return true;
    }

    // 明示的にアクセス権が付与されているプロジェクト
    return userPermissions.projects.includes(projectId);
  }

  /**
   * 部門アクセス権をチェック
   */
  hasDepartmentAccess(department, userPermissions) {
    // 役員は全部門にアクセス可能
    if (userPermissions.level >= 4) {
      return true;
    }

    return userPermissions.departments.includes(department);
  }

  /**
   * コンテンツリストを権限に応じてフィルタリング
   * @param {array} contentList - コンテンツリスト
   * @param {object} userPermissions - ユーザー権限
   * @returns {array} フィルタリング後のコンテンツリスト
   */
  filterContentByPermission(contentList, userPermissions) {
    return contentList.filter(content => {
      const hasAccess = this.hasAccessToContent(content, userPermissions);
      
      if (!hasAccess) {
        console.log(`Access denied for content: ${content.id || 'unknown'}, user level: ${userPermissions.level}, content security: ${content.securityLevel}`);
      }
      
      return hasAccess;
    });
  }

  /**
   * 権限レベルに応じた免責事項を生成
   */
  generateDisclaimer(userPermissions) {
    if (userPermissions.isContractor) {
      return '\n\n*注: 業務委託メンバー向けの情報のみ表示しています。社内機密情報は含まれていません。';
    } else if (userPermissions.level < 3) {
      return '\n\n*注: あなたのアクセス権限に応じた情報のみ表示しています。';
    } else if (userPermissions.level < 4) {
      return '\n\n*注: 管理職レベルの情報まで表示しています。役員限定情報は含まれていません。';
    }
    
    return ''; // 役員レベルは免責事項なし
  }

  /**
   * ユーザー権限の詳細情報を取得（デバッグ用）
   */
  async getUserPermissionDetails(userId) {
    const permissions = await this.getUserPermissions(userId);
    
    return {
      userId,
      level: permissions.level,
      levelName: this.getLevelName(permissions.level),
      isContractor: permissions.isContractor,
      projects: permissions.projects,
      departments: permissions.departments,
      accessibleSecurityLevels: this.getAccessibleSecurityLevels(permissions.level),
      restrictions: this.getRestrictions(permissions)
    };
  }

  /**
   * 権限レベル名を取得
   */
  getLevelName(level) {
    const levelNames = {
      1: '業務委託メンバー',
      2: '正社員',
      3: '管理職',
      4: '役員'
    };
    
    return levelNames[level] || '不明';
  }

  /**
   * アクセス可能なセキュリティレベルを取得
   */
  getAccessibleSecurityLevels(userLevel) {
    const levels = ['PUBLIC'];
    
    if (userLevel >= 2) {
      levels.push('PROJECT_SENSITIVE', 'INTERNAL');
    }
    
    if (userLevel >= 4) {
      levels.push('CONFIDENTIAL');
    }
    
    return levels;
  }

  /**
   * ユーザーの制限事項を取得
   */
  getRestrictions(permissions) {
    const restrictions = [];
    
    if (permissions.isContractor) {
      restrictions.push('社内機密情報へのアクセス不可');
      restrictions.push('人事・財務情報へのアクセス不可');
    }
    
    if (permissions.level < 3) {
      restrictions.push('他部門の詳細情報へのアクセス制限');
      restrictions.push('戦略的意思決定情報へのアクセス不可');
    }
    
    if (permissions.level < 4) {
      restrictions.push('役員限定情報へのアクセス不可');
    }
    
    return restrictions;
  }

  /**
   * 権限キャッシュをクリア
   */
  clearPermissionCache(userId = null) {
    if (userId) {
      this.permissionCache.delete(userId);
      console.log(`Cleared permission cache for user: ${userId}`);
    } else {
      this.permissionCache.clear();
      console.log('Cleared all permission cache');
    }
  }

  /**
   * 権限統計情報を取得
   */
  getPermissionStats() {
    return {
      cacheSize: this.permissionCache.size,
      cacheExpiry: this.cacheExpiry,
      defaultLevel: this.defaultPermissions.level
    };
  }
}

module.exports = UserPermissions; 