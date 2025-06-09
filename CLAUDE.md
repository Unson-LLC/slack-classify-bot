# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Slack bot deployed on AWS Lambda that automatically processes text files uploaded to Slack channels. It integrates with Airtable for project mapping, uses AWS Bedrock (Claude AI) for text summarization, and connects to n8n workflows for automation.

## Key Architecture

- **Main handler**: `api/index.js` - Slack Bolt app running on AWS Lambda
- **AI Integration**: `api/llm-integration.js` - AWS Bedrock/Claude for summarization
- **Data Storage**: `api/airtable-integration.js` - Project database integration
- **Automation**: `api/n8n-integration.js` - Workflow automation
- **Deployment**: AWS SAM template in `api/template.yaml`

## Essential Commands

```bash
# Install dependencies
cd api && npm install

# Run tests
npm test

# Deploy to AWS Lambda
npm run deploy

# Package Lambda function
npm run package

# Test individual components
node api/test-bedrock.js
node api/test-airtable.js
node api/test-slack-auth.js
```

## Development Workflow

1. Make changes to code in `api/` directory
2. Test locally using the test scripts
3. Deploy using `npm run deploy` or `./deploy.sh`

## Environment Variables

Required environment variables for Lambda:
- `SLACK_BOT_TOKEN` - Slack bot OAuth token
- `SLACK_SIGNING_SECRET` - Slack App Signing Secret
- `N8N_ENDPOINT` - n8n webhook URL
- `N8N_AIRTABLE_ENDPOINT` - n8n Webhook URL for Airtable integration
- `AIRTABLE_BASE_ID` - Airtable base ID
- `AIRTABLE_API_KEY` - Airtable API token (Personal Access Token)
- `AIRTABLE_TABLE_NAME` - Airtable table name
- `BEDROCK_REGION` - AWS Region for Bedrock
- `BEDROCK_ACCESS_KEY_ID` - AWS Access Key for Bedrock
- `BEDROCK_SECRET_ACCESS_KEY` - AWS Secret Key for Bedrock

## Key Integration Points

1. **Slack Events**: Handles `file_share` events and interactive button clicks
2. **Airtable**: Projects table with columns: ID, name, owner, repo, type, description
3. **n8n Workflows**: Receives processed file data via webhook
4. **AWS Bedrock**: Uses Claude Sonnet 4 model for text summarization

## Testing

When testing changes:
1. Check Lambda logs in CloudWatch for debugging
2. Use test payloads in `api/test-*.json` files
3. Verify Slack signature validation is working
4. Test with actual file uploads in Slack test workspace