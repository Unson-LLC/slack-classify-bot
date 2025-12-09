#!/bin/bash

# ==============================================================================
# AWS Lambda Deployment Script
# Deploys mana (AI PM agent) to AWS Lambda.
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
FUNCTION_NAME="mana"
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
echo "[2/6] Installing production dependencies..."
(cd "$API_DIR" && npm install --omit=dev)
echo "      - Done."

# 2.5 Module Load Check
echo "[2.5/6] Checking Mastra modules..."
if [ -f "$API_DIR/dist/mastra/tools/source-code.js" ]; then
  (cd "$API_DIR" && node -e "import('./dist/mastra/tools/source-code.js')" 2>&1) || {
    echo "      ❌ ERROR: Mastra source-code module failed to load!"
    echo "      Fix the module before deploying."
    exit 1
  }
  echo "      - source-code.js: OK"
fi
if [ -f "$API_DIR/dist/mastra/bridge.js" ]; then
  (cd "$API_DIR" && node -e "import('./dist/mastra/bridge.js')" 2>&1) || {
    echo "      ❌ ERROR: Mastra bridge module failed to load!"
    echo "      Fix the module before deploying."
    exit 1
  }
  echo "      - bridge.js: OK"
fi
echo "      - Done."

# 2.6 Tool Execution Test
echo "[2.6/6] Testing tool execution..."
if [ -f "$API_DIR/scripts/test-tools-execution.mjs" ]; then
  (cd "$API_DIR" && node scripts/test-tools-execution.mjs 2>&1) || {
    echo "      ❌ ERROR: Tool execution test failed!"
    echo "      Fix the issues before deploying."
    exit 1
  }
else
  echo "      ⚠️  Skipping (test script not found)"
fi

# 3. Create Zip Package
echo "[3/6] Creating deployment package..."
# Create the zip file in a subshell.
(cd "$API_DIR" && zip -r "../function.zip" . \
  -x "./package.json" \
  -x "./package-lock.json" \
  -x "./jest.config.js" \
  -x "./jest.setup.js" \
  -x "./__tests__/*" \
  -x "./.git/*" \
  -x "./.gitignore" \
  -x "./.env" \
  -x "./.DS_Store" \
  -x "./coverage/*" \
  -x "./__MACOSX/*" \
  -x "*/README.md" \
  -x "*/README*" \
  -x "*/CHANGELOG*" \
  -x "*/LICENSE*" \
  -x "*/.eslintrc*" \
  -x "*/.prettierrc*" \
  -x "*/test/*" \
  -x "*/tests/*" \
  -x "*/__tests__/*" \
  -x "*/docs/*" \
  -x "*.md" \
  -x "*.ts" \
  -x "*.map" \
  -x "./node_modules/@types/*" \
  -x "./node_modules/aws-sdk/dist/*" \
  -x "./node_modules/aws-sdk/scripts/*" \
  -x "./node_modules/@mastra/*" \
  -x "./node_modules/@ai-sdk/*" \
  -x "./node_modules/ai/*" \
  -x "./node_modules/zod/*" \
  -x "./node_modules/zod-to-json-schema/*" \
  -x "./node_modules/@opentelemetry/*" \
  -x "./node_modules/onnxruntime-node/*" \
  -x "./node_modules/cohere-ai/*" \
  -x "./node_modules/js-tiktoken/*" \
  -x "./node_modules/@modelcontextprotocol/*" \
  -x "./node_modules/@libsql/*" \
  -x "./node_modules/@redis/*" \
  -x "./node_modules/@anush008/*" \
  -x "./mastra/*" \
  -x "./layer/*" \
  -x "./*.zip")
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
# Check if env.json exists
if [ ! -f "$API_DIR/env.json" ]; then
  echo "      ⚠️  Warning: env.json not found. Skipping environment variable update."
  echo "      To update environment variables, create $API_DIR/env.json from env.json.template"
else
  # Check if env.json contains template values
  if grep -q "YOUR-SLACK-BOT-TOKEN\|YOUR-SLACK-SIGNING-SECRET\|YOUR-BOT-ID" "$API_DIR/env.json"; then
    echo "      ⚠️  ERROR: env.json contains template values!"
    echo "      Please update env.json with actual values before deploying."
    exit 1
  fi
  
  echo "      - Updating environment variables from env.json..."
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --environment "file://$API_DIR/env.json" \
    --profile k.sato \
    --no-cli-pager
  echo "      - Done."
fi

# --- Finalization ---
FUNCTION_URL=$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" --profile k.sato --query "FunctionUrl" --output text)
echo ""
echo "✅ Deployment Successful!"
echo "Function URL: $FUNCTION_URL"
echo ""

echo "[6/6] Waiting for deployment to finalize..."
sleep 10 # Wait for the deployment to finalize
echo "      - Done." 