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
# 全ワークスペース用のLambda関数をデプロイ
FUNCTION_NAMES=("mana" "mana-salestailor" "mana-techknight")
ZIP_FILE="lambda-package.zip"
API_DIR="api"
ENV_FILE="env-vars-update.json"
VERSION=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# --- Deployment Logic ---
echo "🚀 Starting deployment to $REGION..."
echo "   Target functions: ${FUNCTION_NAMES[*]}"

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
# Note: node_modules is excluded because dependencies are provided via Lambda Layers
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
  -x "node_modules/*" \
  -x "./node_modules/*" \
  -x "*/node_modules/*" \
  -x "./mastra/*" \
  -x "./layer/*" \
  -x "./*.zip")
echo "      - Done."

# 4. Update Function Code (全Lambda関数にデプロイ)
echo "[4/6] Updating Lambda function code..."
for FUNC_NAME in "${FUNCTION_NAMES[@]}"; do
  echo "      - Deploying to $FUNC_NAME..."
  aws lambda update-function-code \
    --function-name "$FUNC_NAME" \
    --zip-file "fileb://function.zip" \
    --region "$REGION" \
    --profile k.sato \
    --no-cli-pager > /dev/null
done
echo "      - Done."

echo "--> Waiting for function code to be updated..."
for FUNC_NAME in "${FUNCTION_NAMES[@]}"; do
  echo "      - Waiting for $FUNC_NAME..."
  aws lambda wait function-updated \
    --function-name "$FUNC_NAME" \
    --region "$REGION" \
    --profile k.sato \
    --no-cli-pager
done
echo "      - Done."

# --- Environment Variables ---
# 注意: 環境変数はワークスペースごとに異なるため、manaのみ更新
# salestailor/techknightはAWSコンソールで個別に設定
echo "[5/6] Updating environment variables (mana only)..."
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
    --function-name "mana" \
    --region "$REGION" \
    --environment "file://$API_DIR/env.json" \
    --profile k.sato \
    --no-cli-pager
  echo "      - Done."
fi

# --- Finalization ---
echo ""
echo "✅ Deployment Successful!"
echo "   Deployed to: ${FUNCTION_NAMES[*]}"
for FUNC_NAME in "${FUNCTION_NAMES[@]}"; do
  FUNC_URL=$(aws lambda get-function-url-config --function-name "$FUNC_NAME" --region "$REGION" --profile k.sato --query "FunctionUrl" --output text 2>/dev/null || echo "N/A")
  echo "   - $FUNC_NAME: $FUNC_URL"
done
echo ""

echo "[6/6] Waiting for deployment to finalize..."
sleep 5 # Wait for the deployment to finalize
echo "      - Done." 