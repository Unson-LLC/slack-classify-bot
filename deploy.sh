#!/bin/bash

# ==============================================================================
# AWS Lambda Deployment Script
# Deploys the slack-classify-bot to AWS Lambda.
#
# Process:
# 1. Deletes any old deployment package.
# 2. Installs production Node.js dependencies.
# 3. Creates a new .zip deployment package.
# 4. Updates the Lambda function's code.
# 5. Updates the function's environment variables from a JSON file.
# ==============================================================================

# --- Configuration ---
set -e # Exit immediately if a command fails

REGION="us-east-1"
FUNCTION_NAME="slack-classify-bot"
ZIP_FILE="lambda-package.zip"
API_DIR="api"
ENV_FILE="env-vars-update.json"
VERSION=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# --- Deployment Logic ---
echo "🚀 Starting deployment of '$FUNCTION_NAME' to $REGION..."

# 0. Create Version File
echo "[0/6] Creating version file..."
echo "$VERSION" > "$API_DIR/version.txt"
echo "      - Version: $VERSION"

# 1. Clean up
echo "[1/6] Cleaning up old package..."
rm -f "$API_DIR/$ZIP_FILE"
echo "      - Done."

# 2. Install Dependencies
echo "[2/6] Installing dependencies..."
(cd "$API_DIR" && npm install)
echo "      - Done."

# 3. Create Zip Package
echo "[3/6] Creating deployment package..."
# Create the zip file in a subshell.
(cd "$API_DIR" && zip -r "../function.zip" . -x "package.json" -x "package-lock.json" -x "jest.config.js" -x "jest.setup.js" -x "__tests__/*" -x ".*" -x "__MACOSX")
echo "      - Done."

# 4. Update Function Code
echo "[4/6] Updating Lambda function code..."
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb://function.zip" \
  --region "$REGION" \
  --profile k.sato \
  --no-cli-pager
echo "      - Done."

echo "--> Waiting for function code to be updated..."
aws lambda wait function-updated \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --profile k.sato \
  --no-cli-pager
echo "      - Done."

# --- Environment Variables ---
echo "[5/6] Updating environment variables..."
aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --environment "file://$API_DIR/env.json" \
  --profile k.sato \
  --no-cli-pager
echo "      - Done."

# --- Finalization ---
FUNCTION_URL=$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" --profile k.sato --query "FunctionUrl" --output text)
echo ""
echo "✅ Deployment Successful!"
echo "Function URL: $FUNCTION_URL"
echo ""

echo "[6/6] Waiting for deployment to finalize..."
sleep 10 # Wait for the deployment to finalize
echo "      - Done." 