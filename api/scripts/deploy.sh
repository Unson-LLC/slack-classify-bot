#!/bin/bash
# Mana Lambda Deploy Script
# S3経由のデプロイ + Layer管理を自動化
#
# Usage:
#   ./scripts/deploy.sh              # コードのみデプロイ
#   ./scripts/deploy.sh --with-deps  # 依存関係Layerも更新
#   ./scripts/deploy.sh --help       # ヘルプ表示

set -e

# Configuration
FUNCTION_NAME="mana"
S3_BUCKET="brainbase-source-593793022993"
S3_KEY="mana/lambda-code.zip"
REGION="us-east-1"
AWS_PROFILE="${AWS_PROFILE:-k.sato}"
LAYER_NAME="mana-all-deps"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_help() {
  echo "Mana Lambda Deploy Script"
  echo ""
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  --with-deps    依存関係Layerも更新（時間がかかります）"
  echo "  --layer-only   Layerのみ更新（コードはデプロイしない）"
  echo "  --help         このヘルプを表示"
  echo ""
  echo "Environment variables:"
  echo "  AWS_PROFILE    AWSプロファイル名（デフォルト: k.sato）"
}

# Build TypeScript
build_typescript() {
  log_info "TypeScriptをビルド中..."
  cd "$PROJECT_DIR"
  npm run build:mastra
  log_success "ビルド完了"
}

# Create code-only ZIP
create_code_zip() {
  log_info "コードZIPを作成中..."
  cd "$PROJECT_DIR"
  rm -f lambda-code.zip

  zip -r lambda-code.zip . \
    -x "node_modules/*" \
    -x ".git/*" \
    -x "*.zip" \
    -x "layer/*" \
    -x "mastra/*.ts" \
    -x "scripts/mana-*.sh" \
    -x "*.md" \
    -x "jest.*" \
    -x "tsconfig.*" \
    -x "__tests__/*" \
    > /dev/null

  local size=$(ls -lh lambda-code.zip | awk '{print $5}')
  log_success "コードZIP作成完了: $size"
}

# Upload to S3 and deploy
deploy_code() {
  log_info "S3にアップロード中..."
  aws s3 cp "$PROJECT_DIR/lambda-code.zip" "s3://$S3_BUCKET/$S3_KEY" \
    --profile "$AWS_PROFILE" \
    --region "$REGION" \
    --quiet
  log_success "S3アップロード完了"

  log_info "Lambdaコードを更新中..."
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --s3-bucket "$S3_BUCKET" \
    --s3-key "$S3_KEY" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --output text \
    --query 'LastModified' > /dev/null

  # Wait for update to complete
  log_info "更新完了を待機中..."
  aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --profile "$AWS_PROFILE"

  log_success "Lambdaコード更新完了"
}

# Create/Update dependencies layer (split into multiple layers)
update_deps_layer() {
  log_info "依存関係Layerを作成中..."

  local layer_dir="/tmp/mana-layer-$$"
  local layer_arns=()

  # Layer 1: Core dependencies (@slack/bolt, ai-sdk, etc)
  log_info "Layer 1: Core dependencies を作成中..."
  mkdir -p "$layer_dir/layer1/nodejs"
  cd "$layer_dir/layer1/nodejs"
  cat > package.json << 'EOF'
{
  "dependencies": {
    "@slack/bolt": "^3.17.1",
    "@ai-sdk/amazon-bedrock": "^2.2.1",
    "@ai-sdk/anthropic": "^1.2.1",
    "ai": "^4.2.6",
    "zod": "^3.24.1",
    "axios": "^1.6.2",
    "dotenv": "^16.5.0"
  },
  "overrides": {
    "@slack/web-api": {
      "p-retry": "4.6.2"
    }
  }
}
EOF
  npm install --omit=dev 2>&1 | tail -5
  cd "$layer_dir/layer1"
  zip -r layer1.zip nodejs > /dev/null
  local size1=$(ls -lh layer1.zip | awk '{print $5}')
  log_info "Layer 1 size: $size1"

  aws s3 cp layer1.zip "s3://$S3_BUCKET/mana/layer1.zip" \
    --profile "$AWS_PROFILE" --region "$REGION" --quiet

  local layer1_arn=$(aws lambda publish-layer-version \
    --layer-name "mana-core-deps" \
    --description "Mana core dependencies $(date +%Y-%m-%d)" \
    --content S3Bucket="$S3_BUCKET",S3Key="mana/layer1.zip" \
    --compatible-runtimes nodejs20.x \
    --region "$REGION" --profile "$AWS_PROFILE" \
    --query 'LayerVersionArn' --output text)
  layer_arns+=("$layer1_arn")
  log_success "Layer 1完了: $layer1_arn"

  # Layer 2: AWS SDK + Mastra
  log_info "Layer 2: AWS SDK + Mastra を作成中..."
  mkdir -p "$layer_dir/layer2/nodejs"
  cd "$layer_dir/layer2/nodejs"
  cat > package.json << 'EOF'
{
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.600.0",
    "@aws-sdk/client-dynamodb": "^3.600.0",
    "@aws-sdk/client-lambda": "^3.947.0",
    "@aws-sdk/client-s3": "^3.943.0",
    "@aws-sdk/lib-dynamodb": "^3.600.0",
    "@mastra/core": "^1.0.0-beta.8",
    "@mastra/dynamodb": "^1.0.0-beta.5",
    "@mastra/memory": "^1.0.0-beta.4"
  },
  "overrides": {
    "p-retry": "4.6.2"
  }
}
EOF
  npm install --omit=dev --quiet 2>/dev/null
  cd "$layer_dir/layer2"
  zip -r layer2.zip nodejs > /dev/null
  local size2=$(ls -lh layer2.zip | awk '{print $5}')
  log_info "Layer 2 size: $size2"

  aws s3 cp layer2.zip "s3://$S3_BUCKET/mana/layer2.zip" \
    --profile "$AWS_PROFILE" --region "$REGION" --quiet

  local layer2_arn=$(aws lambda publish-layer-version \
    --layer-name "mana-aws-mastra-deps" \
    --description "Mana AWS SDK + Mastra $(date +%Y-%m-%d)" \
    --content S3Bucket="$S3_BUCKET",S3Key="mana/layer2.zip" \
    --compatible-runtimes nodejs20.x \
    --region "$REGION" --profile "$AWS_PROFILE" \
    --query 'LayerVersionArn' --output text)
  layer_arns+=("$layer2_arn")
  log_success "Layer 2完了: $layer2_arn"

  # Layer 3: Other dependencies
  log_info "Layer 3: Other dependencies を作成中..."
  mkdir -p "$layer_dir/layer3/nodejs"
  cd "$layer_dir/layer3/nodejs"
  cat > package.json << 'EOF'
{
  "dependencies": {
    "@googleapis/gmail": "^16.1.0",
    "google-auth-library": "^10.5.0",
    "@tavily/core": "^0.5.14",
    "airtable": "^0.12.2"
  }
}
EOF
  npm install --omit=dev --quiet 2>/dev/null
  cd "$layer_dir/layer3"
  zip -r layer3.zip nodejs > /dev/null
  local size3=$(ls -lh layer3.zip | awk '{print $5}')
  log_info "Layer 3 size: $size3"

  aws s3 cp layer3.zip "s3://$S3_BUCKET/mana/layer3.zip" \
    --profile "$AWS_PROFILE" --region "$REGION" --quiet

  local layer3_arn=$(aws lambda publish-layer-version \
    --layer-name "mana-other-deps" \
    --description "Mana other dependencies $(date +%Y-%m-%d)" \
    --content S3Bucket="$S3_BUCKET",S3Key="mana/layer3.zip" \
    --compatible-runtimes nodejs20.x \
    --region "$REGION" --profile "$AWS_PROFILE" \
    --query 'LayerVersionArn' --output text)
  layer_arns+=("$layer3_arn")
  log_success "Layer 3完了: $layer3_arn"

  # Update function with all layers (max 5 layers allowed)
  log_info "LambdaにLayerを設定中..."
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --layers "${layer_arns[@]}" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --output text \
    --query 'LastModified' > /dev/null

  aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --profile "$AWS_PROFILE"

  # Cleanup
  rm -rf "$layer_dir"

  log_success "全Layer更新完了"
}

# Main
main() {
  local with_deps=false
  local layer_only=false

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      --with-deps)
        with_deps=true
        shift
        ;;
      --layer-only)
        layer_only=true
        shift
        ;;
      --help|-h)
        show_help
        exit 0
        ;;
      *)
        log_error "Unknown option: $1"
        show_help
        exit 1
        ;;
    esac
  done

  echo -e "${YELLOW}╔════════════════════════════════════════╗${NC}"
  echo -e "${YELLOW}║        Mana Lambda Deploy              ║${NC}"
  echo -e "${YELLOW}╚════════════════════════════════════════╝${NC}"
  echo ""
  echo "Function: $FUNCTION_NAME"
  echo "Region: $REGION"
  echo "Profile: $AWS_PROFILE"
  echo ""

  # Layer update
  if $with_deps || $layer_only; then
    update_deps_layer
    if $layer_only; then
      log_success "Layer更新のみ完了"
      exit 0
    fi
  fi

  # Code deploy
  build_typescript
  create_code_zip
  deploy_code

  # Cleanup
  rm -f "$PROJECT_DIR/lambda-code.zip"

  echo ""
  log_success "デプロイ完了!"
  echo ""
  echo "テスト実行: ./scripts/mana-llm-test.sh basic"
}

main "$@"
