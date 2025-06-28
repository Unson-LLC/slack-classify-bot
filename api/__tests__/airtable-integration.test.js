const Airtable = require('airtable');
const axios = require('axios');

// Mock Airtable and axios
jest.mock('airtable');
jest.mock('axios');

describe('AirtableIntegration', () => {
  let AirtableIntegration;
  let airtableIntegration;
  const mockAirtableBaseId = 'appTestXYZ';
  const mockAirtableApiKey = 'patTestXYZ';
  const mockTableName = 'TestTable';
  
  // Mock functions
  const mockSelect = jest.fn();
  const mockUpdate = jest.fn();
  const mockAll = jest.fn();
  const mockFirstPage = jest.fn();
  
  // Mock table instance
  let mockTableInstance;
  let mockBase;
  let mockAirtableInstance;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    jest.resetModules();
    
    // Set mock environment variables for each test
    process.env.AIRTABLE_TOKEN = mockAirtableApiKey;
    process.env.AIRTABLE_BASE = mockAirtableBaseId;
    process.env.AIRTABLE_TABLE_NAME = mockTableName;
    process.env.N8N_ENDPOINT = 'http://test-n8n.com/webhook';
    process.env.N8N_AIRTABLE_ENDPOINT = 'http://test-n8n.com/webhook/airtable';
    
    // Setup mock instances
    mockTableInstance = {
      select: mockSelect,
      update: mockUpdate
    };
    
    mockBase = jest.fn((tableName) => mockTableInstance);
    mockAirtableInstance = {
      base: jest.fn(() => mockBase)
    };
    
    // Setup Airtable mock
    Airtable.mockImplementation(() => mockAirtableInstance);
    
    // Reset mock function behaviors
    mockSelect.mockReturnValue({ all: mockAll });
    mockAll.mockResolvedValue([]);
    mockFirstPage.mockResolvedValue([]);
    mockUpdate.mockResolvedValue({});
    
    // Ensure console.error is mocked
    global.console.error = jest.fn();
    
    // Import the module after mocks are set up
    AirtableIntegration = require('../airtable-integration');
    airtableIntegration = new AirtableIntegration();
  });

  afterEach(() => {
    // Clear the mock environment variables after each test
    delete process.env.AIRTABLE_TOKEN;
    delete process.env.AIRTABLE_BASE;
    delete process.env.AIRTABLE_TABLE_NAME;
  });

  describe('constructor', () => {
    it('should initialize with Airtable configuration', () => {
      expect(Airtable).toHaveBeenCalledWith({ apiKey: mockAirtableApiKey });
      expect(airtableIntegration.tableName).toBe(mockTableName);
      expect(mockAirtableInstance.base).toHaveBeenCalledWith(mockAirtableBaseId);
      expect(airtableIntegration.airtable).toBe(mockBase);
    });
    
    it('should throw error if API key is missing', () => {
      delete process.env.AIRTABLE_TOKEN;
      jest.resetModules();
      
      const AirtableIntegration = require('../airtable-integration');
      expect(() => {
        new AirtableIntegration();
      }).toThrow('Airtable API Key or Base ID is not configured in environment variables.');
    });
    
    it('should throw error if Base ID is missing', () => {
      delete process.env.AIRTABLE_BASE;
      jest.resetModules();
      
      const AirtableIntegration = require('../airtable-integration');
      expect(() => {
        new AirtableIntegration();
      }).toThrow('Airtable API Key or Base ID is not configured in environment variables.');
    });
    
    it('should use default table name if not provided', () => {
      delete process.env.AIRTABLE_TABLE_NAME;
      jest.resetModules();
      
      const AirtableIntegration = require('../airtable-integration');
      const instance = new AirtableIntegration();
      expect(instance.tableName).toBe('Projects');
    });
  });

  describe('getProjectList', () => {
    const mockLogger = {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    };
    
    const mockRecords = [
      {
        get: jest.fn((field) => {
          if (field === 'Project Name') return 'Alpha Project';
          if (field === 'Project ID') return 'alpha-123';
        })
      },
      {
        get: jest.fn((field) => {
          if (field === 'Project Name') return 'Beta Project';
          if (field === 'Project ID') return 'beta-456';
        })
      }
    ];
    
    beforeEach(() => {
      mockSelect.mockReturnValue({
        all: jest.fn().mockResolvedValue(mockRecords)
      });
    });
    
    it('should fetch and transform projects from Airtable', async () => {
      const projects = await airtableIntegration.getProjectList(mockLogger);
      
      expect(mockBase).toHaveBeenCalledWith(mockTableName);
      expect(mockTableInstance.select).toHaveBeenCalledWith({
        fields: ['Project Name', 'Project ID'],
        sort: [{ field: 'Project Name', direction: 'asc' }]
      });
      
      expect(projects).toHaveLength(2);
      expect(projects[0]).toEqual({
        text: 'Alpha Project',
        value: 'alpha-123'
      });
      expect(projects[1]).toEqual({
        text: 'Beta Project',
        value: 'beta-456'
      });
    });
    
    it('should handle empty project list', async () => {
      mockSelect.mockReturnValue({
        all: jest.fn().mockResolvedValue([])
      });
      
      const projects = await airtableIntegration.getProjectList(mockLogger);
      
      expect(projects).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith('No projects found in Airtable.');
    });
    
    it('should handle Airtable API errors', async () => {
      mockSelect.mockReturnValue({
        all: jest.fn().mockRejectedValue(new Error('API Error'))
      });
      
      const projects = await airtableIntegration.getProjectList(mockLogger);
      
      expect(projects).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        'Error fetching project list from Airtable:',
        'API Error'
      );
    });
  });

  describe('processFileWithProject', () => {
    const mockLogger = {
      info: jest.fn(),
      error: jest.fn()
    };
    
    const mockClient = {
      chat: {
        postMessage: jest.fn(),
        postEphemeral: jest.fn(),
        update: jest.fn()
      }
    };
    
    const mockAction = {
      value: '{"projectId":"alpha-123","projectName":"Alpha Project","fileId":"F12345"}'
    };
    
    const mockBody = {
      message: { ts: '1234567890.123' },
      channel: { id: 'C12345' },
      user: { id: 'U12345' },
      team: { id: 'T12345' }
    };
    
    const mockFileDataStore = new Map();
    
    beforeEach(() => {
      mockFileDataStore.clear();
      mockFileDataStore.set('F12345_C12345', {
        fileId: 'F12345',
        fileName: 'test.txt',
        content: 'Test content',
        channelId: 'C12345',
        userId: 'U12345',
        threadTs: '1234567890.123'
      });
      
      mockSelect.mockReturnValue({
        firstPage: jest.fn().mockResolvedValue([
          {
            id: 'recXXXXXXXXXXXXX1',
            get: jest.fn((field) => {
              if (field === 'Attachments') return [];
            })
          }
        ])
      });
      
      mockUpdate.mockResolvedValue({});
    });
    
    it('should process file with selected project successfully', async () => {
      // Mock axios for API calls
      axios.get = jest.fn().mockResolvedValue({
        data: {
          records: [
            { id: 'alpha-123', fields: { Name: 'Alpha Project', owner: 'test', repo: 'test-repo' } }
          ]
        }
      });
      axios.post = jest.fn().mockResolvedValue({ data: { success: true } });
      
      await airtableIntegration.processFileWithProject(
        mockAction,
        mockBody,
        mockClient,
        mockLogger,
        mockFileDataStore
      );
      
      expect(mockBase).toHaveBeenCalledWith(mockTableName);
      expect(mockTableInstance.select).toHaveBeenCalledWith({
        filterByFormula: `{Project ID} = 'alpha-123'`,
        maxRecords: 1
      });
      
      expect(mockTableInstance.update).toHaveBeenCalled();
      expect(mockClient.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C12345',
          ts: '1234567890.123',
          text: expect.stringContaining('Alpha Project')
        })
      );
    });
    
    it('should handle project not found error', async () => {
      mockSelect.mockReturnValue({
        firstPage: jest.fn().mockResolvedValue([])
      });
      
      await airtableIntegration.processFileWithProject(
        mockAction,
        mockBody,
        mockClient,
        mockLogger,
        mockFileDataStore
      );
      
      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockClient.chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C12345',
          user: 'U12345',
          text: expect.stringContaining('Project with ID alpha-123 not found')
        })
      );
    });
    
    it('should handle missing file data', async () => {
      mockFileDataStore.clear(); // Clear the store
      
      await airtableIntegration.processFileWithProject(
        mockAction,
        mockBody,
        mockClient,
        mockLogger,
        mockFileDataStore
      );
      
      expect(console.error).toHaveBeenCalledWith(
        'File data not found in store for file ID:',
        'F12345'
      );
      expect(mockClient.chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C12345',
          user: 'U12345',
          text: expect.stringContaining('ファイルデータが見つかりませんでした')
        })
      );
    });
    
    it('should handle missing project ID', async () => {
      const actionWithoutProjectId = { value: '{}' };
      
      await airtableIntegration.processFileWithProject(
        actionWithoutProjectId,
        mockBody,
        mockClient,
        mockLogger,
        mockFileDataStore
      );
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid action value:',
        '{}'
      );
    });
    
    it('should append to existing attachments', async () => {
      const existingAttachments = [
        {
          url: 'https://slack.com/files/T12345/F99999/download',
          filename: 'existing.txt'
        }
      ];
      
      mockSelect.mockReturnValue({
        firstPage: jest.fn().mockResolvedValue([
          {
            id: 'recXXXXXXXXXXXXX1',
            get: jest.fn((field) => {
              if (field === 'Attachments') return existingAttachments;
            })
          }
        ])
      });
      
      await airtableIntegration.processFileWithProject(
        mockAction,
        mockBody,
        mockClient,
        mockLogger,
        mockFileDataStore
      );
      
      expect(mockTableInstance.update).toHaveBeenCalledWith(
        'recXXXXXXXXXXXXX1',
        expect.objectContaining({
          'Attachments': [
            existingAttachments[0],
            expect.objectContaining({
              filename: 'test.txt',
              url: 'https://slack.com/files/T12345/F12345/download'
            })
          ]
        })
      );
    });
    
    it('should handle update errors and send ephemeral message', async () => {
      mockUpdate.mockRejectedValue(new Error('Update failed'));
      
      await airtableIntegration.processFileWithProject(
        mockAction,
        mockBody,
        mockClient,
        mockLogger,
        mockFileDataStore
      );
      
      expect(mockClient.chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C12345',
          user: 'U12345',
          text: expect.stringContaining('Airtableレコードの更新中にエラーが発生しました')
        })
      );
    });
  });
});