#!/bin/bash

# ==============================================================================
# EventBridge Rule Setup Script
# Sets up scheduled triggers for mana Lambda functions.
#
# Rules:
# 1. mana-slack-history-sync: Daily Slack history backup at AM 3:00 JST
# 2. mana-daily-reminders: Daily task reminders at AM 9:00 JST
# ==============================================================================

set -e

REGION="us-east-1"
FUNCTION_NAME="mana"
PROFILE="k.sato"
ACCOUNT_ID="593793022993"

# --- Slack History Sync Rule ---
RULE_NAME="mana-slack-history-sync"
# AM 3:00 JST = 18:00 UTC (previous day)
SCHEDULE="cron(0 18 * * ? *)"

echo "🔧 Setting up EventBridge rule: $RULE_NAME"
echo "   Schedule: $SCHEDULE (AM 3:00 JST)"
echo ""

# 1. Create or update the EventBridge rule
echo "[1/3] Creating EventBridge rule..."
aws events put-rule \
  --name "$RULE_NAME" \
  --schedule-expression "$SCHEDULE" \
  --state ENABLED \
  --description "Daily Slack history sync for all workspaces (AM 3:00 JST)" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --no-cli-pager

echo "      - Done."

# 2. Add Lambda permission for EventBridge to invoke
echo "[2/3] Adding Lambda permission for EventBridge..."
# Remove existing permission if exists (ignore error)
aws lambda remove-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id "${RULE_NAME}-permission" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --no-cli-pager 2>/dev/null || true

aws lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id "${RULE_NAME}-permission" \
  --action "lambda:InvokeFunction" \
  --principal "events.amazonaws.com" \
  --source-arn "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${RULE_NAME}" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --no-cli-pager

echo "      - Done."

# 3. Add the Lambda target to the rule
echo "[3/3] Adding Lambda target to rule..."
aws events put-targets \
  --rule "$RULE_NAME" \
  --targets "[{
    \"Id\": \"mana-lambda-target\",
    \"Arn\": \"arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}\",
    \"Input\": \"{\\\"action\\\": \\\"sync_slack_history\\\", \\\"daysToSync\\\": 7}\"
  }]" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --no-cli-pager

echo "      - Done."

echo ""
echo "✅ EventBridge rule setup complete!"
echo ""
echo "Rule Details:"
echo "  - Name: $RULE_NAME"
echo "  - Schedule: AM 3:00 JST (18:00 UTC)"
echo "  - Target: $FUNCTION_NAME Lambda"
echo "  - Payload: {\"action\": \"sync_slack_history\", \"daysToSync\": 7}"
echo ""
echo "To test manually:"
echo "  aws lambda invoke --function-name $FUNCTION_NAME \\"
echo "    --payload '{\"action\": \"sync_slack_history\", \"daysToSync\": 1}' \\"
echo "    --cli-binary-format raw-in-base64-out \\"
echo "    --region $REGION --profile $PROFILE \\"
echo "    /dev/stdout"

# ==============================================================================
# Rule 2: Daily Task Reminders
# ==============================================================================

REMINDER_RULE_NAME="mana-daily-reminders"
# AM 9:00 JST = 0:00 UTC
REMINDER_SCHEDULE="cron(0 0 * * ? *)"

echo ""
echo "🔧 Setting up EventBridge rule: $REMINDER_RULE_NAME"
echo "   Schedule: $REMINDER_SCHEDULE (AM 9:00 JST)"
echo ""

# 1. Create or update the EventBridge rule
echo "[1/3] Creating EventBridge rule..."
aws events put-rule \
  --name "$REMINDER_RULE_NAME" \
  --schedule-expression "$REMINDER_SCHEDULE" \
  --state ENABLED \
  --description "Daily task reminders - overdue and due-soon tasks (AM 9:00 JST)" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --no-cli-pager

echo "      - Done."

# 2. Add Lambda permission for EventBridge to invoke
echo "[2/3] Adding Lambda permission for EventBridge..."
# Remove existing permission if exists (ignore error)
aws lambda remove-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id "${REMINDER_RULE_NAME}-permission" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --no-cli-pager 2>/dev/null || true

aws lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id "${REMINDER_RULE_NAME}-permission" \
  --action "lambda:InvokeFunction" \
  --principal "events.amazonaws.com" \
  --source-arn "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${REMINDER_RULE_NAME}" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --no-cli-pager

echo "      - Done."

# 3. Add the Lambda target to the rule
echo "[3/3] Adding Lambda target to rule..."
aws events put-targets \
  --rule "$REMINDER_RULE_NAME" \
  --targets "[{
    \"Id\": \"mana-reminder-target\",
    \"Arn\": \"arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}\",
    \"Input\": \"{\\\"action\\\": \\\"run_reminders\\\"}\"
  }]" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --no-cli-pager

echo "      - Done."

echo ""
echo "✅ Daily reminders rule setup complete!"
echo ""
echo "Rule Details:"
echo "  - Name: $REMINDER_RULE_NAME"
echo "  - Schedule: AM 9:00 JST (0:00 UTC)"
echo "  - Target: $FUNCTION_NAME Lambda"
echo "  - Payload: {\"action\": \"run_reminders\"}"
echo ""
echo "To test manually:"
echo "  aws lambda invoke --function-name $FUNCTION_NAME \\"
echo "    --payload '{\"action\": \"run_reminders\"}' \\"
echo "    --cli-binary-format raw-in-base64-out \\"
echo "    --region $REGION --profile $PROFILE \\"
echo "    /dev/stdout"
