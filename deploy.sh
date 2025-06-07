#!/bin/bash
# Exit immediately if a command exits with a non-zero status.
set -e

# Define variables
FUNCTION_NAME="slack-classify-bot"
ROLE_NAME="${FUNCTION_NAME}-lambda-role"
REGION="us-east-1"
HANDLER="index.handler"
RUNTIME="nodejs18.x"
ZIP_FILE="lambda-function.zip"
API_DIR="api"
TIMEOUT=60
MEMORY_SIZE=256

echo "🚀 Starting deployment process..."

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
if [ -z "$ACCOUNT_ID" ]; then
    echo "❌ Error: Could not retrieve AWS Account ID. Please configure your AWS CLI."
    exit 1
fi
echo "✅ Using AWS Account ID: $ACCOUNT_ID"
echo "✅ Using Region: $REGION"

# Navigate to the API directory
cd "$API_DIR"

# Install dependencies
echo "📦 Installing npm dependencies in $API_DIR..."
npm install --production

# Create a zip file for deployment
echo "📦 Creating deployment package: $ZIP_FILE..."
# Make sure to exclude dev dependencies and unnecessary files
zip -r ../$ZIP_FILE . -x "node_modules/aws-sdk/*" "*.DS_Store" "*/.cache/*" "deploy.sh"

# Navigate back to the root directory
cd ..

# Check if IAM role exists
ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"
if ! aws iam get-role --role-name $ROLE_NAME --region $REGION > /dev/null 2>&1; then
    echo "🔐 IAM role '$ROLE_NAME' not found. Creating role..."
    
    TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
)
    
    aws iam create-role --role-name $ROLE_NAME --assume-role-policy-document "$TRUST_POLICY" --region $REGION
    echo "✅ Role '$ROLE_NAME' created."
    
    echo "📎 Attaching AWSLambdaBasicExecutionRole policy..."
    aws iam attach-role-policy --role-name $ROLE_NAME --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole --region $REGION
    # Wait for the role to be fully propagated
    sleep 10
else
    echo "✅ IAM role '$ROLE_NAME' already exists."
fi

# Add a policy for Lambda to invoke itself
echo "🔐 Creating or updating policy for self-invocation..."
INVOKE_POLICY=$(cat <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": "lambda:InvokeFunction",
            "Resource": "arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"
        }
    ]
}
EOF
)
aws iam put-role-policy --role-name $ROLE_NAME --policy-name "LambdaSelfInvokePolicy" --policy-document "$INVOKE_POLICY" --region $REGION
echo "✅ Self-invocation policy is set."

# Check if Lambda function exists
if ! aws lambda get-function --function-name $FUNCTION_NAME --region $REGION > /dev/null 2>&1; then
    echo "✨ Lambda function '$FUNCTION_NAME' not found. Creating function..."
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime $RUNTIME \
        --role "$ROLE_ARN" \
        --handler $HANDLER \
        --zip-file "fileb://$ZIP_FILE" \
        --timeout $TIMEOUT \
        --memory-size $MEMORY_SIZE \
        --region $REGION
    echo "✅ Lambda function '$FUNCTION_NAME' created."
else
    echo "🔄 Lambda function '$FUNCTION_NAME' already exists. Updating function code..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file "fileb://$ZIP_FILE" \
        --region $REGION
    
    echo "⏳ Waiting for function code update to complete..."
    aws lambda wait function-updated --function-name $FUNCTION_NAME --region $REGION

    echo "⚙️ Updating function configuration..."
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --runtime $RUNTIME \
        --role "$ROLE_ARN" \
        --handler $HANDLER \
        --timeout $TIMEOUT \
        --memory-size $MEMORY_SIZE \
        --region $REGION
fi

# Load environment variables from api/env-vars-update.json
if [ -f "$API_DIR/env-vars-update.json" ]; then
    echo "🔑 Updating environment variables from $API_DIR/env-vars-update.json..."
    ENV_VARS=$(cat "$API_DIR/env-vars-update.json")
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --environment "$ENV_VARS" \
        --region $REGION
    echo "✅ Environment variables updated."
else
    echo "⚠️  Skipping environment variable update: $API_DIR/env-vars-update.json not found."
fi

# Check and create/update Lambda Function URL
echo "🔗 Checking and creating/updating Function URL..."
URL_CONFIG=$(aws lambda get-function-url-config --function-name $FUNCTION_NAME --region $REGION 2>/dev/null || echo "{}")
FUNCTION_URL=$(echo "$URL_CONFIG" | jq -r .FunctionUrl 2>/dev/null)

if [ -z "$FUNCTION_URL" ] || [ "$FUNCTION_URL" == "null" ]; then
    echo "✨ Creating Lambda Function URL..."
    URL_CONFIG=$(aws lambda create-function-url-config --function-name $FUNCTION_NAME --auth-type "NONE" --region $REGION)
    FUNCTION_URL=$(echo "$URL_CONFIG" | jq -r .FunctionUrl)
else
    echo "✅ Function URL already exists."
fi

# Add permissions for the Function URL to be invoked publicly
echo "🔐 Granting public access permission to Function URL..."
# The "|| true" prevents the script from exiting if the permission already exists
aws lambda add-permission \
    --function-name $FUNCTION_NAME \
    --statement-id "FunctionURLAllowPublicAccess" \
    --action "lambda:InvokeFunctionUrl" \
    --principal "*" \
    --function-url-auth-type "NONE" \
    --region $REGION > /dev/null 2>&1 || true

echo "✅ Permission granted."

# Clean up the zip file
echo "🧹 Cleaning up deployment package..."
rm $ZIP_FILE

echo ""
echo "🎉 Deployment successful!"
echo "----------------------------------------"
echo "Function Name: $FUNCTION_NAME"
echo "Function URL:  $FUNCTION_URL"
echo "----------------------------------------"
echo "Next step: Update your Slack App's Event Subscription URL with the one above."
echo ""

exit 0 