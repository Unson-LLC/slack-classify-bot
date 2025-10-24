#!/bin/bash
# DynamoDB Projects テーブル作成スクリプト

set -e

REGION="us-east-1"
TABLE_NAME="slack-classify-bot-projects"
PROFILE="k.sato"

echo "🚀 Creating DynamoDB table: $TABLE_NAME in $REGION..."

aws dynamodb create-table \
  --table-name "$TABLE_NAME" \
  --attribute-definitions \
    AttributeName=project_id,AttributeType=S \
  --key-schema \
    AttributeName=project_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --tags \
    Key=Application,Value=slack-classify-bot \
    Key=Environment,Value=production \
  --region "$REGION" \
  --profile "$PROFILE" \
  --no-cli-pager

echo "⏳ Waiting for table to become active..."
aws dynamodb wait table-exists \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --profile "$PROFILE"

echo "✅ Table created successfully!"

# テーブル情報表示
aws dynamodb describe-table \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query 'Table.{Name: TableName, Status: TableStatus, ItemCount: ItemCount, BillingMode: BillingModeSummary.BillingMode}' \
  --output table \
  --no-cli-pager

echo ""
echo "📊 Table ARN:"
aws dynamodb describe-table \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query 'Table.TableArn' \
  --output text \
  --no-cli-pager
