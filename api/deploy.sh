#!/bin/bash

# Slack Classify Bot Lambda Deployment Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
FUNCTION_NAME="slack-classify-bot"
REGION="us-east-1"  # Change this to your preferred region
RUNTIME="nodejs18.x"
HANDLER="index.handler"
TIMEOUT=30
MEMORY_SIZE=256

echo -e "${GREEN}🚀 Starting Slack Classify Bot Lambda Deployment${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured. Please run 'aws configure' first.${NC}"
    exit 1
fi

# Check if required environment variables are set
if [ -z "$SLACK_BOT_TOKEN" ] || [ -z "$SLACK_SIGNING_SECRET" ] || [ -z "$N8N_ENDPOINT" ]; then
    echo -e "${YELLOW}⚠️  Environment variables not set. Please set:${NC}"
    echo "export SLACK_BOT_TOKEN=xoxb-your-bot-token"
    echo "export SLACK_SIGNING_SECRET=your-signing-secret"
    echo "export N8N_ENDPOINT=https://your-n8n-instance.com"
    echo ""
    echo -e "${YELLOW}You can also set these directly in the Lambda function after deployment.${NC}"
fi

# Install dependencies
echo -e "${GREEN}📦 Installing dependencies...${NC}"
npm install

# Create deployment package
echo -e "${GREEN}📦 Creating deployment package...${NC}"
if [ -f "lambda-deployment.zip" ]; then
    rm lambda-deployment.zip
fi

zip -r lambda-deployment.zip . -x \
    "*.git*" \
    "node_modules/.cache/*" \
    "*.DS_Store*" \
    "deploy.sh" \
    "README-Lambda.md" \
    "template.yaml" \
    "*.md"

echo -e "${GREEN}✅ Deployment package created: lambda-deployment.zip${NC}"

# Check if Lambda function exists
if aws lambda get-function --function-name $FUNCTION_NAME --region $REGION &> /dev/null; then
    echo -e "${GREEN}🔄 Updating existing Lambda function...${NC}"
    
    # Update function code
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://lambda-deployment.zip \
        --region $REGION
    
    # Update function configuration if environment variables are set
    if [ ! -z "$SLACK_BOT_TOKEN" ] && [ ! -z "$SLACK_SIGNING_SECRET" ] && [ ! -z "$N8N_ENDPOINT" ]; then
        echo -e "${GREEN}🔧 Updating environment variables...${NC}"
        aws lambda update-function-configuration \
            --function-name $FUNCTION_NAME \
            --environment Variables="{
                \"SLACK_BOT_TOKEN\":\"$SLACK_BOT_TOKEN\",
                \"SLACK_SIGNING_SECRET\":\"$SLACK_SIGNING_SECRET\",
                \"N8N_ENDPOINT\":\"$N8N_ENDPOINT\"
            }" \
            --region $REGION
    fi
    
    echo -e "${GREEN}✅ Lambda function updated successfully!${NC}"
else
    echo -e "${GREEN}🆕 Creating new Lambda function...${NC}"
    
    # Get AWS account ID
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    
    # Create IAM role if it doesn't exist
    ROLE_NAME="slack-classify-bot-lambda-role"
    ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"
    
    if ! aws iam get-role --role-name $ROLE_NAME &> /dev/null; then
        echo -e "${GREEN}🔐 Creating IAM role...${NC}"
        
        # Create trust policy
        cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
        
        # Create role
        aws iam create-role \
            --role-name $ROLE_NAME \
            --assume-role-policy-document file://trust-policy.json
        
        # Attach basic execution policy
        aws iam attach-role-policy \
            --role-name $ROLE_NAME \
            --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
        
        # Clean up
        rm trust-policy.json
        
        echo -e "${GREEN}✅ IAM role created: $ROLE_ARN${NC}"
        
        # Wait for role to be available
        echo -e "${YELLOW}⏳ Waiting for IAM role to be available...${NC}"
        sleep 10
    fi
    
    # Create Lambda function
    ENV_VARS="{}"
    if [ ! -z "$SLACK_BOT_TOKEN" ] && [ ! -z "$SLACK_SIGNING_SECRET" ] && [ ! -z "$N8N_ENDPOINT" ]; then
        ENV_VARS="{
            \"SLACK_BOT_TOKEN\":\"$SLACK_BOT_TOKEN\",
            \"SLACK_SIGNING_SECRET\":\"$SLACK_SIGNING_SECRET\",
            \"N8N_ENDPOINT\":\"$N8N_ENDPOINT\"
        }"
    fi
    
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime $RUNTIME \
        --role $ROLE_ARN \
        --handler $HANDLER \
        --zip-file fileb://lambda-deployment.zip \
        --timeout $TIMEOUT \
        --memory-size $MEMORY_SIZE \
        --environment Variables="$ENV_VARS" \
        --region $REGION
    
    echo -e "${GREEN}✅ Lambda function created successfully!${NC}"
fi

# Get function URL if it exists, or create one
echo -e "${GREEN}🔗 Setting up Function URL...${NC}"
FUNCTION_URL=$(aws lambda get-function-url-config --function-name $FUNCTION_NAME --region $REGION --query 'FunctionUrl' --output text 2>/dev/null || echo "")

if [ -z "$FUNCTION_URL" ]; then
    echo -e "${GREEN}🆕 Creating Function URL...${NC}"
    FUNCTION_URL=$(aws lambda create-function-url-config \
        --function-name $FUNCTION_NAME \
        --auth-type NONE \
        --cors '{
            "AllowCredentials": false,
            "AllowHeaders": ["content-type", "x-slack-signature", "x-slack-request-timestamp"],
            "AllowMethods": ["POST", "GET"],
            "AllowOrigins": ["*"],
            "ExposeHeaders": [],
            "MaxAge": 86400
        }' \
        --region $REGION \
        --query 'FunctionUrl' \
        --output text)
else
    echo -e "${GREEN}🔄 Updating Function URL configuration...${NC}"
    aws lambda update-function-url-config \
        --function-name $FUNCTION_NAME \
        --auth-type NONE \
        --cors '{
            "AllowCredentials": false,
            "AllowHeaders": ["content-type", "x-slack-signature", "x-slack-request-timestamp"],
            "AllowMethods": ["POST", "GET"],
            "AllowOrigins": ["*"],
            "ExposeHeaders": [],
            "MaxAge": 86400
        }' \
        --region $REGION > /dev/null
    FUNCTION_URL=$(aws lambda get-function-url-config --function-name $FUNCTION_NAME --region $REGION --query 'FunctionUrl' --output text)
fi

# Add permission for Function URL access
echo -e "${GREEN}🔐 Setting up Function URL permissions...${NC}"
aws lambda add-permission \
    --function-name $FUNCTION_NAME \
    --statement-id FunctionURLAllowPublicAccess \
    --action lambda:InvokeFunctionUrl \
    --principal "*" \
    --function-url-auth-type NONE \
    --region $REGION \
    2>/dev/null || echo "Permission already exists or updated"

# Clean up deployment package
rm lambda-deployment.zip

echo ""
echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo ""
echo -e "${YELLOW}📋 Function Details:${NC}"
echo "Function Name: $FUNCTION_NAME"
echo "Region: $REGION"
echo "Function URL: $FUNCTION_URL"
echo ""
echo -e "${YELLOW}🔧 Next Steps:${NC}"
echo "1. Configure your Slack app Event Subscriptions URL: $FUNCTION_URL"
echo "2. Set up Slash Commands to point to: $FUNCTION_URL"
echo "3. Test your bot in Slack!"
echo ""
if [ -z "$SLACK_BOT_TOKEN" ] || [ -z "$SLACK_SIGNING_SECRET" ] || [ -z "$N8N_ENDPOINT" ]; then
    echo -e "${YELLOW}⚠️  Don't forget to set environment variables in the Lambda console if not set already.${NC}"
fi 