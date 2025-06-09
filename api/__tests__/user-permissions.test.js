const UserPermissions = require('../user-permissions');

describe('UserPermissions', () => {
  let userPermissions;
  let mockAirtableIntegration;

  beforeEach(() => {
    // Mock Airtable integration
    mockAirtableIntegration = {
      getUsers: jest.fn()
    };
    
    userPermissions = new UserPermissions(mockAirtableIntegration);
    jest.clearAllMocks();
  });

  describe('getUserPermissions', () => {
    it('should return cached permissions if available', async () => {
      const userId = 'U123456';
      const cachedPermissions = {
        level: 2,
        projects: ['proj1'],
        departments: ['dev'],
        isContractor: false
      };

      // Set cache
      userPermissions.permissionCache.set(userId, {
        permissions: cachedPermissions,
        timestamp: Date.now()
      });

      const result = await userPermissions.getUserPermissions(userId);
      
      expect(result).toEqual(cachedPermissions);
      expect(mockAirtableIntegration.getUsers).not.toHaveBeenCalled();
    });

    it('should fetch from Airtable if cache is expired', async () => {
      const userId = 'U123456';
      const oldPermissions = { level: 1 };
      const airtableUser = {
        slackUserId: userId,
        accessLevel: 3,
        accessibleProjects: ['proj1', 'proj2'],
        departments: ['dev', 'product'],
        employmentType: 'employee',
        email: 'user@company.com',
        name: 'Test User',
        role: 'Manager'
      };

      // Set expired cache
      userPermissions.permissionCache.set(userId, {
        permissions: oldPermissions,
        timestamp: Date.now() - (31 * 60 * 1000) // 31 minutes ago
      });

      mockAirtableIntegration.getUsers.mockResolvedValue([airtableUser]);

      const result = await userPermissions.getUserPermissions(userId);
      
      expect(result.level).toBe(3);
      expect(result.projects).toEqual(['proj1', 'proj2']);
      expect(result.isContractor).toBe(false);
      expect(mockAirtableIntegration.getUsers).toHaveBeenCalled();
    });

    it('should return default permissions if user not found', async () => {
      const userId = 'U_UNKNOWN';
      mockAirtableIntegration.getUsers.mockResolvedValue([]);

      const result = await userPermissions.getUserPermissions(userId);
      
      expect(result).toEqual(userPermissions.defaultPermissions);
    });

    it('should handle contractor users correctly', async () => {
      const userId = 'U_CONTRACTOR';
      const airtableUser = {
        slackUserId: userId,
        accessLevel: 1,
        employmentType: 'contractor',
        accessibleProjects: [],
        departments: []
      };

      mockAirtableIntegration.getUsers.mockResolvedValue([airtableUser]);

      const result = await userPermissions.getUserPermissions(userId);
      
      expect(result.isContractor).toBe(true);
      expect(result.level).toBe(1);
    });

    it('should handle Airtable errors gracefully', async () => {
      const userId = 'U123456';
      mockAirtableIntegration.getUsers.mockRejectedValue(new Error('Airtable error'));

      const result = await userPermissions.getUserPermissions(userId);
      
      expect(result).toEqual(userPermissions.defaultPermissions);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('hasAccessToContent', () => {
    const basePermissions = {
      level: 2,
      projects: ['proj1'],
      departments: ['dev'],
      isContractor: false
    };

    it('should allow access to public content', () => {
      const content = { securityLevel: 'PUBLIC' };
      const result = userPermissions.hasAccessToContent(content, basePermissions);
      expect(result).toBe(true);
    });

    it('should deny access to confidential content for non-executives', () => {
      const content = { securityLevel: 'CONFIDENTIAL' };
      const result = userPermissions.hasAccessToContent(content, basePermissions);
      expect(result).toBe(false);
    });

    it('should allow executives to access confidential content', () => {
      const content = { securityLevel: 'CONFIDENTIAL' };
      const executivePermissions = { ...basePermissions, level: 4 };
      const result = userPermissions.hasAccessToContent(content, executivePermissions);
      expect(result).toBe(true);
    });

    it('should check project access for project-restricted content', () => {
      const content = { securityLevel: 'PUBLIC', projectId: 'proj2' };
      const result = userPermissions.hasAccessToContent(content, basePermissions);
      expect(result).toBe(false);
    });

    it('should allow project access if user has permission', () => {
      const content = { securityLevel: 'PUBLIC', projectId: 'proj1' };
      const result = userPermissions.hasAccessToContent(content, basePermissions);
      expect(result).toBe(true);
    });

    it('should deny internal content to contractors', () => {
      const content = { securityLevel: 'PUBLIC', internalOnly: true };
      const contractorPermissions = { ...basePermissions, isContractor: true };
      const result = userPermissions.hasAccessToContent(content, contractorPermissions);
      expect(result).toBe(false);
    });

    it('should check department restrictions', () => {
      const content = { 
        securityLevel: 'PUBLIC', 
        departmentRestricted: true, 
        department: 'finance' 
      };
      const result = userPermissions.hasAccessToContent(content, basePermissions);
      expect(result).toBe(false);
    });

    it('should allow department access if user belongs to department', () => {
      const content = { 
        securityLevel: 'PUBLIC', 
        departmentRestricted: true, 
        department: 'dev' 
      };
      const result = userPermissions.hasAccessToContent(content, basePermissions);
      expect(result).toBe(true);
    });
  });

  describe('hasSecurityLevelAccess', () => {
    it('should handle all security levels correctly', () => {
      expect(userPermissions.hasSecurityLevelAccess('PUBLIC', 1)).toBe(true);
      expect(userPermissions.hasSecurityLevelAccess('PROJECT_SENSITIVE', 1)).toBe(false);
      expect(userPermissions.hasSecurityLevelAccess('PROJECT_SENSITIVE', 2)).toBe(true);
      expect(userPermissions.hasSecurityLevelAccess('INTERNAL', 2)).toBe(true);
      expect(userPermissions.hasSecurityLevelAccess('CONFIDENTIAL', 3)).toBe(false);
      expect(userPermissions.hasSecurityLevelAccess('CONFIDENTIAL', 4)).toBe(true);
    });

    it('should default to PUBLIC for unknown security levels', () => {
      expect(userPermissions.hasSecurityLevelAccess('UNKNOWN', 1)).toBe(true);
    });
  });

  describe('hasProjectAccess', () => {
    it('should allow managers and above to access all projects', () => {
      const managerPermissions = { level: 3, projects: [] };
      expect(userPermissions.hasProjectAccess('any-project', managerPermissions)).toBe(true);
    });

    it('should check explicit project access for regular employees', () => {
      const employeePermissions = { level: 2, projects: ['proj1', 'proj2'] };
      expect(userPermissions.hasProjectAccess('proj1', employeePermissions)).toBe(true);
      expect(userPermissions.hasProjectAccess('proj3', employeePermissions)).toBe(false);
    });
  });

  describe('filterContentByPermission', () => {
    it('should filter content based on permissions', () => {
      const contentList = [
        { id: '1', securityLevel: 'PUBLIC' },
        { id: '2', securityLevel: 'CONFIDENTIAL' },
        { id: '3', securityLevel: 'INTERNAL' },
        { id: '4', securityLevel: 'PUBLIC', internalOnly: true }
      ];

      const employeePermissions = {
        level: 2,
        projects: [],
        departments: [],
        isContractor: false
      };

      const filtered = userPermissions.filterContentByPermission(contentList, employeePermissions);
      
      expect(filtered).toHaveLength(2);
      expect(filtered.map(c => c.id)).toEqual(['1', '3']);
    });

    it('should log access denials', () => {
      const contentList = [
        { id: '1', securityLevel: 'CONFIDENTIAL' }
      ];

      const employeePermissions = {
        level: 2,
        projects: [],
        departments: [],
        isContractor: false
      };

      userPermissions.filterContentByPermission(contentList, employeePermissions);
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Access denied for content: 1')
      );
    });
  });

  describe('generateDisclaimer', () => {
    it('should generate contractor disclaimer', () => {
      const contractorPermissions = { isContractor: true, level: 1 };
      const disclaimer = userPermissions.generateDisclaimer(contractorPermissions);
      expect(disclaimer).toContain('業務委託メンバー向け');
    });

    it('should generate employee disclaimer', () => {
      const employeePermissions = { isContractor: false, level: 2 };
      const disclaimer = userPermissions.generateDisclaimer(employeePermissions);
      expect(disclaimer).toContain('アクセス権限に応じた');
    });

    it('should generate manager disclaimer', () => {
      const managerPermissions = { isContractor: false, level: 3 };
      const disclaimer = userPermissions.generateDisclaimer(managerPermissions);
      expect(disclaimer).toContain('管理職レベル');
    });

    it('should return empty for executives', () => {
      const executivePermissions = { isContractor: false, level: 4 };
      const disclaimer = userPermissions.generateDisclaimer(executivePermissions);
      expect(disclaimer).toBe('');
    });
  });

  describe('getLevelName', () => {
    it('should return correct level names', () => {
      expect(userPermissions.getLevelName(1)).toBe('業務委託メンバー');
      expect(userPermissions.getLevelName(2)).toBe('正社員');
      expect(userPermissions.getLevelName(3)).toBe('管理職');
      expect(userPermissions.getLevelName(4)).toBe('役員');
      expect(userPermissions.getLevelName(99)).toBe('不明');
    });
  });

  describe('getAccessibleSecurityLevels', () => {
    it('should return correct security levels for each user level', () => {
      expect(userPermissions.getAccessibleSecurityLevels(1)).toEqual(['PUBLIC']);
      expect(userPermissions.getAccessibleSecurityLevels(2)).toEqual(['PUBLIC', 'PROJECT_SENSITIVE', 'INTERNAL']);
      expect(userPermissions.getAccessibleSecurityLevels(3)).toEqual(['PUBLIC', 'PROJECT_SENSITIVE', 'INTERNAL']);
      expect(userPermissions.getAccessibleSecurityLevels(4)).toEqual(['PUBLIC', 'PROJECT_SENSITIVE', 'INTERNAL', 'CONFIDENTIAL']);
    });
  });

  describe('clearPermissionCache', () => {
    it('should clear cache for specific user', () => {
      userPermissions.permissionCache.set('U123', { permissions: {}, timestamp: Date.now() });
      userPermissions.permissionCache.set('U456', { permissions: {}, timestamp: Date.now() });

      userPermissions.clearPermissionCache('U123');

      expect(userPermissions.permissionCache.has('U123')).toBe(false);
      expect(userPermissions.permissionCache.has('U456')).toBe(true);
    });

    it('should clear entire cache', () => {
      userPermissions.permissionCache.set('U123', { permissions: {}, timestamp: Date.now() });
      userPermissions.permissionCache.set('U456', { permissions: {}, timestamp: Date.now() });

      userPermissions.clearPermissionCache();

      expect(userPermissions.permissionCache.size).toBe(0);
    });
  });

  describe('getPermissionStats', () => {
    it('should return cache statistics', () => {
      userPermissions.permissionCache.set('U123', { permissions: {}, timestamp: Date.now() });
      userPermissions.permissionCache.set('U456', { permissions: {}, timestamp: Date.now() });

      const stats = userPermissions.getPermissionStats();

      expect(stats.cacheSize).toBe(2);
      expect(stats.cacheExpiry).toBe(30 * 60 * 1000);
      expect(stats.defaultLevel).toBe(1);
    });
  });
});