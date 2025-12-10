#!/bin/bash
# Mana Slack E2E Test Script
# Usage: ./scripts/slack-e2e-test.sh [test_message]

set -e

# Configuration (from environment variables)
SLACK_USER_TOKEN="${SLACK_USER_TOKEN:?Error: SLACK_USER_TOKEN environment variable is required}"
SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:?Error: SLACK_BOT_TOKEN environment variable is required}"
MANA_BOT_ID="${MANA_BOT_ID:-U093QQ0NV5K}"
TEST_CHANNEL="C0A2L9FEKEJ"  # 9999-manaテスト
WAIT_TIME=20

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Default test message
TEST_MESSAGE="${1:-Working Memoryテスト。今の時刻を教えて}"

echo -e "${YELLOW}=== Mana Slack E2E Test ===${NC}"
echo "Channel: $TEST_CHANNEL"
echo "Message: $TEST_MESSAGE"
echo ""

# 1. Post message as user
echo -e "${YELLOW}[1/3] Posting message as user...${NC}"
RESPONSE=$(curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_USER_TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"channel\": \"$TEST_CHANNEL\", \"text\": \"<@$MANA_BOT_ID> $TEST_MESSAGE\"}")

if echo "$RESPONSE" | jq -e '.ok == true' > /dev/null; then
  TS=$(echo "$RESPONSE" | jq -r '.ts')
  echo -e "${GREEN}Posted successfully. TS: $TS${NC}"
else
  echo -e "${RED}Failed to post message${NC}"
  echo "$RESPONSE" | jq .
  exit 1
fi

# 2. Wait for mana to respond
echo -e "${YELLOW}[2/3] Waiting ${WAIT_TIME}s for mana to respond...${NC}"
sleep $WAIT_TIME

# 3. Check thread for reply
echo -e "${YELLOW}[3/3] Checking for reply...${NC}"
THREAD=$(curl -s -X GET "https://slack.com/api/conversations.replies?channel=$TEST_CHANNEL&ts=$TS" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN")

REPLY_COUNT=$(echo "$THREAD" | jq '.messages | length')

if [ "$REPLY_COUNT" -gt 1 ]; then
  echo -e "${GREEN}=== PASS: Mana replied ===${NC}"
  echo ""
  echo "--- Mana's Response ---"
  echo "$THREAD" | jq -r '.messages[1].text'
  echo ""
  exit 0
else
  echo -e "${RED}=== FAIL: No reply from mana ===${NC}"
  echo "Check CloudWatch logs for errors"
  exit 1
fi
