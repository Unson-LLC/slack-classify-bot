# Slack Classify Bot - AWS Lambda Version

This is the AWS Lambda version of the Slack Classify Bot that processes Slack messages and files using n8n workflows.

## Features

- **Message Classification**: Automatically classifies Slack messages into categories (bug, feature-request, question, etc.)
- **File Processing**: Processes uploaded .txt files and sends them to Airtable via n8n
- **Slash Commands**: Supports `/classify` and `/process-file` commands
- **AWS Lambda**: Serverless deployment using AWS Lambda

## Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 18+ installed locally
- Slack app with Bot Token and Signing Secret
- n8n instance with webhook endpoints

## Environment Variables

Set these environment variables in your Lambda function:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
N8N_ENDPOINT=https://your-n8n-instance.com
N8N_AIRTABLE_ENDPOINT=https://your-n8n-instance.com (optional, defaults to N8N_ENDPOINT)
```

## Installation

1. Install dependencies:
```bash
npm install
```

2. Package the Lambda function:
```bash
npm run package
```

3. Deploy to AWS Lambda:
```bash
# Create Lambda function (first time)
aws lambda create-function \
  --function-name slack-classify-bot \
  --runtime nodejs18.x \
  --role arn:aws:iam::YOUR-ACCOUNT:role/lambda-execution-role \
  --handler lambda-handler.handler \
  --zip-file fileb://lambda-deployment.zip \
  --timeout 30 \
  --memory-size 256

# Update existing function
npm run deploy
```

## AWS Lambda Configuration

### IAM Role

Create an IAM role with the following policies:
- `AWSLambdaBasicExecutionRole`
- Custom policy for any additional AWS services you need

### Function Configuration

- **Runtime**: Node.js 18.x
- **Handler**: `lambda-handler.handler`
- **Timeout**: 30 seconds (adjust based on your needs)
- **Memory**: 256 MB (adjust based on your needs)

### API Gateway (Optional)

If you need HTTP endpoints, create an API Gateway and connect it to your Lambda function.

## Slack App Configuration

Configure your Slack app with the following:

### Event Subscriptions
- **Request URL**: Your Lambda function URL (via API Gateway or Function URL)
- **Subscribe to bot events**:
  - `message.channels`
  - `message.groups`
  - `message.im`
  - `file_shared`

### Slash Commands
- `/classify` - Classify a message manually
- `/process-file` - Process a file manually
- `/hello-bolt-app` - Test command

### OAuth & Permissions
Required scopes:
- `chat:write`
- `files:read`
- `commands`

## n8n Webhook Endpoints

Ensure your n8n instance has these webhook endpoints:
- `/webhook/slack-classify` - For message classifications
- `/webhook/slack-airtable` - For file processing

## File Structure

```
api/
├── lambda-handler.js      # Main Lambda handler
├── n8n-integration.js     # n8n integration logic
├── airtable-integration.js # Airtable/file processing logic
├── package.json           # Dependencies and scripts
└── README-Lambda.md       # This file
```

## Development

### Local Testing

You can test the Lambda function locally using AWS SAM or similar tools:

```bash
# Install AWS SAM CLI
# Create sam-template.yaml
sam local start-api
```

### Debugging

Enable CloudWatch logs for your Lambda function to monitor execution and debug issues.

## Deployment Scripts

### Package and Deploy
```bash
# Package the function
npm run package

# Deploy to Lambda
npm run deploy
```

### Environment Variables Update
```bash
aws lambda update-function-configuration \
  --function-name slack-classify-bot \
  --environment Variables='{
    "SLACK_BOT_TOKEN":"xoxb-your-token",
    "SLACK_SIGNING_SECRET":"your-secret",
    "N8N_ENDPOINT":"https://your-n8n.com"
  }'
```

## Monitoring

- Use CloudWatch Logs to monitor function execution
- Set up CloudWatch Alarms for error rates and duration
- Use AWS X-Ray for distributed tracing (optional)

## Troubleshooting

### Common Issues

1. **Timeout errors**: Increase Lambda timeout or optimize code
2. **Memory errors**: Increase Lambda memory allocation
3. **Permission errors**: Check IAM role permissions
4. **Slack verification**: Ensure signing secret is correct

### Logs

Check CloudWatch Logs for detailed error messages:
```bash
aws logs tail /aws/lambda/slack-classify-bot --follow
```

## Cost Optimization

- Use appropriate memory allocation
- Optimize cold start times
- Consider using Provisioned Concurrency for high-traffic scenarios
- Monitor costs using AWS Cost Explorer

## Security

- Store sensitive environment variables in AWS Systems Manager Parameter Store or AWS Secrets Manager
- Use least privilege IAM policies
- Enable VPC if needed for network isolation
- Regularly update dependencies 