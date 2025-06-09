const Airtable = require('airtable');

// Mock Airtable
jest.mock('airtable');

describe('AirtableIntegration - Simplified Tests', () => {
  let AirtableIntegration;
  const mockAirtableApiKey = 'patTestXYZ';
  const mockAirtableBaseId = 'appTestXYZ';
  const mockTableName = 'TestTable';
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    jest.resetModules();
    
    // Set environment variables
    process.env.AIRTABLE_TOKEN = mockAirtableApiKey;
    process.env.AIRTABLE_BASE = mockAirtableBaseId;
    process.env.AIRTABLE_TABLE_NAME = mockTableName;
    
    // Mock console.error
    global.console.error = jest.fn();
  });

  afterEach(() => {
    // Clear environment variables
    delete process.env.AIRTABLE_TOKEN;
    delete process.env.AIRTABLE_BASE;
    delete process.env.AIRTABLE_TABLE_NAME;
  });

  describe('constructor', () => {
    it('should throw error if API key is missing', () => {
      delete process.env.AIRTABLE_TOKEN;
      
      const AirtableIntegration = require('../airtable-integration');
      expect(() => new AirtableIntegration()).toThrow(
        'Airtable API Key or Base ID is not configured in environment variables.'
      );
    });
    
    it('should throw error if Base ID is missing', () => {
      delete process.env.AIRTABLE_BASE;
      
      const AirtableIntegration = require('../airtable-integration');
      expect(() => new AirtableIntegration()).toThrow(
        'Airtable API Key or Base ID is not configured in environment variables.'
      );
    });
    
    it('should use default table name if not provided', () => {
      delete process.env.AIRTABLE_TABLE_NAME;
      
      // Create a minimal mock
      const mockBase = jest.fn();
      Airtable.mockImplementation(() => ({
        base: jest.fn(() => mockBase)
      }));
      
      const AirtableIntegration = require('../airtable-integration');
      const instance = new AirtableIntegration();
      expect(instance.tableName).toBe('Projects');
    });
  });

  describe('error handling in methods', () => {
    let airtableIntegration;
    
    beforeEach(() => {
      // Create a minimal mock that will cause errors
      const mockBase = jest.fn(() => {
        throw new Error('Airtable connection error');
      });
      
      Airtable.mockImplementation(() => ({
        base: jest.fn(() => mockBase)
      }));
      
      const AirtableIntegration = require('../airtable-integration');
      airtableIntegration = new AirtableIntegration();
    });
    
    it('should handle errors in getProjectList', async () => {
      const mockLogger = { warn: jest.fn() };
      
      const result = await airtableIntegration.getProjectList(mockLogger);
      
      expect(result).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(
        'Error fetching project list from Airtable:',
        expect.any(String)
      );
    });
    
    it('should handle missing project ID in processFileWithProject', async () => {
      const mockAction = { value: undefined };
      const mockBody = { message: { ts: '123' }, user: { id: 'U123' }, team: { id: 'T123' } };
      const mockClient = { chat: { postMessage: jest.fn(), postEphemeral: jest.fn() } };
      const mockLogger = { info: jest.fn(), error: jest.fn() };
      const mockFileDataStore = new Map();
      
      await airtableIntegration.processFileWithProject(
        mockAction,
        mockBody,
        mockClient,
        mockLogger,
        mockFileDataStore
      );
      
      expect(console.error).toHaveBeenCalledWith('Project ID is not provided');
    });
    
    it('should handle missing file data in processFileWithProject', async () => {
      const mockAction = { value: 'project-123' };
      const mockBody = { message: { ts: '123' }, user: { id: 'U123' }, team: { id: 'T123' } };
      const mockClient = { chat: { postMessage: jest.fn(), postEphemeral: jest.fn() } };
      const mockLogger = { info: jest.fn(), error: jest.fn() };
      const mockFileDataStore = new Map(); // Empty store
      
      await airtableIntegration.processFileWithProject(
        mockAction,
        mockBody,
        mockClient,
        mockLogger,
        mockFileDataStore
      );
      
      expect(console.error).toHaveBeenCalledWith('File data is not found in the store');
    });
  });
});