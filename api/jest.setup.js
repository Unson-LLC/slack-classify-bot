// Jest setup file for global test configurations
process.env.NODE_ENV = 'test';

// Mock console methods to reduce noise during tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Set test environment variables
process.env.SLACK_BOT_TOKEN = 'test-token';
process.env.SLACK_SIGNING_SECRET = 'test-secret';
process.env.N8N_ENDPOINT = 'https://test.n8n.io/webhook/test';
process.env.N8N_AIRTABLE_ENDPOINT = 'https://test.n8n.io/webhook/airtable';
process.env.AIRTABLE_BASE = 'appTest123';
process.env.AIRTABLE_TOKEN = 'patTest123';
process.env.AIRTABLE_TABLE_NAME = 'TestProjects';
process.env.BEDROCK_REGION = 'us-east-1';
process.env.BEDROCK_ACCESS_KEY_ID = 'test-key-id';
process.env.BEDROCK_SECRET_ACCESS_KEY = 'test-secret-key';