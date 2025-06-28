# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 言語設定 / Language Setting

**重要**: このプロジェクトで作業する際は、必ず日本語で応答してください。
**IMPORTANT**: When working on this project, always respond in Japanese.

## Project Overview

This is a Slack bot deployed on AWS Lambda that automatically processes text files uploaded to Slack channels, particularly meeting notes and transcripts. It integrates with Airtable for project mapping, uses AWS Bedrock (Claude AI) for text summarization and action item extraction, and connects to n8n workflows for GitHub automation.

## Key Architecture

- **Main handler**: `api/index.js` - Slack Bolt app running on AWS Lambda with event deduplication
- **AI Integration**: `api/llm-integration.js` - AWS Bedrock/Claude Sonnet 4 for summarization and filename generation
- **File Processing**: `api/processFileUpload.js` - Handles file uploads with project selection UI
- **Data Storage**: `api/airtable-integration.js` - Project database integration for repository mapping
- **Automation**: `api/n8n-integration.js` - Workflow automation for GitHub commits
- **Deployment**: AWS SAM template in `api/template.yaml` and bash script `deploy.sh`

## Essential Commands

```bash
# Install dependencies
npm run install-deps  # or cd api && npm install

# Run tests
cd api && npm test
npm run test:watch    # Watch mode
npm run test:coverage # With coverage

# Deploy to AWS Lambda
npm run deploy        # From root directory
# or
./deploy.sh           # Direct deployment script

# Package Lambda function
npm run package       # From root directory
# or
cd api && npm run package

# Test individual components
node api/test-bedrock.js
node api/test-airtable.js
node api/test-slack-auth.js

# View Lambda logs
aws logs tail /aws/lambda/slack-classify-bot --follow --profile k.sato --region us-east-1

# Update environment variables
aws lambda update-function-configuration \
  --function-name slack-classify-bot \
  --environment "file://api/env.json" \
  --profile k.sato \
  --region us-east-1
```

## Development Workflow

1. Make changes to code in `api/` directory
2. Test locally using the test scripts
3. Create/update test files in `api/__tests__/`
4. Deploy using `npm run deploy` from root or `./deploy.sh`
5. Monitor CloudWatch logs for debugging
6. Version is automatically tracked in `api/version.txt` during deployment

## Environment Variables

Required environment variables for Lambda (set in `api/env.json`):
- `SLACK_BOT_TOKEN` - Slack bot OAuth token (xoxb-...)
- `SLACK_SIGNING_SECRET` - Slack App Signing Secret
- `SLACK_BOT_ID` - Bot user ID to prevent self-response loops
- `N8N_ENDPOINT` - n8n webhook URL for message classification
- `N8N_AIRTABLE_ENDPOINT` - n8n Webhook URL for Airtable/GitHub integration
- `AIRTABLE_BASE_ID` - Airtable base ID (app...)
- `AIRTABLE_API_KEY` - Airtable Personal Access Token (pat...)
- `AIRTABLE_TABLE_NAME` - Airtable table name (default: "Projects")
- `BEDROCK_REGION` - AWS Region for Bedrock (hardcoded to us-east-1)
- `BEDROCK_ACCESS_KEY_ID` - AWS Access Key for Bedrock (optional, uses Lambda role by default)
- `BEDROCK_SECRET_ACCESS_KEY` - AWS Secret Key for Bedrock (optional)

## Key Integration Points

### 1. Slack Events
- **file_share**: Detects when files are uploaded
- **Interactive buttons**: Project selection for file processing
- **Event deduplication**: Prevents duplicate processing with 5-minute TTL cache
- **Required OAuth Scopes**:
  - `channels:history`
  - `chat:write`
  - `commands`
  - `files:read`
  - `groups:history`
  - `im:history`
  - `mpim:history`

### 2. Airtable Structure
Projects table schema:
- `ID` - Project identifier
- `name` - Project display name
- `owner` - GitHub organization/user
- `repo` - GitHub repository name
- `type` - Project type
- `description` - Project description
- `path_prefix` - File storage path in GitHub

### 3. n8n Workflows
Two main workflows:
- `/webhook/slack-classify` - Message classification workflow
- `/webhook/slack-airtable` - File processing to GitHub workflow

### 4. AWS Bedrock
- Model: Claude Sonnet 4 (`us.anthropic.claude-sonnet-4-20250514-v1:0`)
- Region: Forced to `us-east-1` for model availability
- Features:
  - Meeting summary generation
  - Action item extraction
  - Intelligent filename generation

## File Processing Flow

1. User uploads .txt file to Slack
2. Bot detects file_share event (with deduplication)
3. Downloads and processes file content
4. Uses AI to generate summary and extract action items
5. Shows project selection buttons from Airtable
6. User selects target project
7. Sends to n8n workflow with all metadata
8. n8n commits formatted Markdown to GitHub
9. Bot confirms with checkmark in thread

## Data Flow Examples

### Meeting Notes Processing
```
Slack File Upload → Lambda Function → AI Summarization → Project Selection UI → n8n Webhook → GitHub Commit
```

### Generated Markdown Structure
```markdown
# [AI-generated-filename]-YYYY-MM-DD.md

**Summary**: [AI-generated meeting summary]

**Action Items**:
- [ ] [Extracted action item 1]
- [ ] [Extracted action item 2]

---

## Original Content

[Full transcript content]

---

*Uploaded from Slack by @username on YYYY-MM-DD*
*File: original-filename.txt*
```

## Testing

### Unit Tests
- Located in `api/__tests__/`
- Mock Slack client and AWS services
- Run with `npm test` in api directory

### Integration Testing
1. Check Lambda logs in CloudWatch
2. Use test payloads in `api/test-*.json` files
3. Verify Slack signature validation
4. Test with actual file uploads in Slack workspace
5. Monitor n8n execution history

### Common Test Scenarios
- File upload with various content types
- Project selection and processing
- Error handling for missing projects
- AI summarization edge cases
- Duplicate event handling

## Deployment Details

### Deployment Script (`deploy.sh`)
1. Creates version timestamp
2. Cleans old packages
3. Installs production dependencies
4. Creates deployment zip (excludes tests, configs)
5. Updates Lambda function code
6. Updates environment variables from `env.json`
7. Waits for deployment completion
8. Shows function URL

### AWS Configuration
- **Runtime**: Node.js 18.x
- **Handler**: `index.handler`
- **Timeout**: 30 seconds
- **Memory**: 256MB
- **Architecture**: x86_64
- **Profile**: k.sato (configured in deploy script)

## Security Considerations

1. **Slack Verification**: All requests verified using signing secret
2. **Event Deduplication**: Prevents replay attacks and duplicate processing
3. **AWS IAM**: Lambda uses execution role with minimal permissions
4. **Secrets Management**: Sensitive data in environment variables
5. **Private URLs**: Slack file URLs are private and temporary

## Troubleshooting

### Common Issues

1. **Lambda timeout**
   - Increase timeout in SAM template or AWS console
   - Check file size and processing time

2. **Slack verification failed**
   - Verify SLACK_SIGNING_SECRET is correct
   - Check request timestamps

3. **n8n connection error**
   - Verify webhook URLs are accessible
   - Check n8n workflow is active

4. **Airtable errors**
   - Verify API key and base ID
   - Check table permissions

5. **Bedrock errors**
   - Region is forced to us-east-1
   - Check Lambda execution role has Bedrock permissions

6. **Duplicate processing**
   - Event deduplication cache has 5-minute TTL
   - Check SLACK_BOT_ID is set correctly

### Debug Commands
```bash
# Check recent logs
aws logs tail /aws/lambda/slack-classify-bot --follow --profile k.sato --region us-east-1

# Get function configuration
aws lambda get-function-configuration --function-name slack-classify-bot --profile k.sato --region us-east-1

# Test invoke (with test event)
aws lambda invoke --function-name slack-classify-bot --payload file://test-event.json response.json --profile k.sato --region us-east-1
```

## Future Enhancements (from SECURITY-ARCHITECTURE.md)

The project is designed to support:
- Multi-level access control for contractors vs employees
- Content classification engine for security levels
- Encrypted storage for sensitive meeting notes
- AI-powered permission-based information filtering
- Automated audit logging and compliance

## Important Development Guidelines

### Documentation Comments for Major Classes

When working with or creating major classes/modules, ALWAYS add comments at the beginning that include:
1. **Design Document References**: Link to relevant architecture documents (e.g., SECURITY-ARCHITECTURE.md, README-Airtable.md)
2. **Related Classes Notes**: List other classes/modules that interact with this one

Example format:
```javascript
/**
 * Design References:
 * - See SECURITY-ARCHITECTURE.md for access control design
 * - See README-Airtable.md for database schema
 * 
 * Related Classes:
 * - airtable-integration.js: Fetches project data
 * - n8n-integration.js: Sends processed data to workflows
 * - llm-integration.js: Provides AI summarization
 */
```

This helps maintain clear relationships between components and ensures design decisions are traceable.