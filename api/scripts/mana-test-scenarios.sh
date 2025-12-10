#!/bin/bash
# Mana E2E Test Scenarios
# manaの主要機能をテストするシナリオ集
#
# Usage:
#   ./scripts/mana-test-scenarios.sh          # 全テスト実行
#   ./scripts/mana-test-scenarios.sh basic    # 基本応答のみ
#   ./scripts/mana-test-scenarios.sh web      # Web検索のみ
#   ./scripts/mana-test-scenarios.sh memory   # Working Memoryのみ
#   ./scripts/mana-test-scenarios.sh format   # 出力フォーマットのみ

set -e

# Configuration (from environment variables)
SLACK_USER_TOKEN="${SLACK_USER_TOKEN:?Error: SLACK_USER_TOKEN environment variable is required}"
SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:?Error: SLACK_BOT_TOKEN environment variable is required}"
MANA_BOT_ID="${MANA_BOT_ID:-U093QQ0NV5K}"
TEST_CHANNEL="C0A2L9FEKEJ"  # 9999-manaテスト
WAIT_TIME=25

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
PASS_COUNT=0
FAIL_COUNT=0

# Post message and get reply
post_and_check() {
  local test_name="$1"
  local message="$2"
  local expected_pattern="$3"

  echo -e "${BLUE}--- Test: $test_name ---${NC}"
  echo "Message: $message"

  # Post message
  RESPONSE=$(curl -s -X POST https://slack.com/api/chat.postMessage \
    -H "Authorization: Bearer $SLACK_USER_TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "{\"channel\": \"$TEST_CHANNEL\", \"text\": \"<@$MANA_BOT_ID> $message\"}")

  if ! echo "$RESPONSE" | jq -e '.ok == true' > /dev/null; then
    echo -e "${RED}FAIL: Could not post message${NC}"
    ((FAIL_COUNT++))
    return 1
  fi

  TS=$(echo "$RESPONSE" | jq -r '.ts')
  echo "Posted. Waiting ${WAIT_TIME}s..."
  sleep $WAIT_TIME

  # Get reply
  THREAD=$(curl -s -X GET "https://slack.com/api/conversations.replies?channel=$TEST_CHANNEL&ts=$TS" \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN")

  REPLY_COUNT=$(echo "$THREAD" | jq '.messages | length')

  if [ "$REPLY_COUNT" -le 1 ]; then
    echo -e "${RED}FAIL: No reply from mana${NC}"
    ((FAIL_COUNT++))
    return 1
  fi

  REPLY_TEXT=$(echo "$THREAD" | jq -r '.messages[1].text')
  echo "Reply: ${REPLY_TEXT:0:100}..."

  # Check expected pattern (if provided)
  if [ -n "$expected_pattern" ]; then
    if echo "$REPLY_TEXT" | grep -qiE "$expected_pattern"; then
      echo -e "${GREEN}PASS: Pattern matched${NC}"
      ((PASS_COUNT++))
    else
      echo -e "${RED}FAIL: Expected pattern not found: $expected_pattern${NC}"
      ((FAIL_COUNT++))
      return 1
    fi
  else
    echo -e "${GREEN}PASS: Got reply${NC}"
    ((PASS_COUNT++))
  fi

  echo ""
  return 0
}

# Test scenarios
run_basic_tests() {
  echo -e "${YELLOW}=== Basic Response Tests ===${NC}"
  echo ""

  post_and_check \
    "基本応答" \
    "こんにちは。簡単に自己紹介して" \
    "Mana|AI PM|アシスタント"

  post_and_check \
    "タスク詳細確認" \
    "レポート作成をお願い" \
    "詳細|情報|目的|テーマ|何について"
}

run_web_search_tests() {
  echo -e "${YELLOW}=== Web Search Tests ===${NC}"
  echo ""

  post_and_check \
    "天気検索" \
    "東京の今日の天気を教えて" \
    "天気|気温|晴|雨|曇"

  post_and_check \
    "ニュース検索" \
    "最新のAI関連ニュースを1つ教えて" \
    "AI|人工知能|ニュース|発表"
}

run_memory_tests() {
  echo -e "${YELLOW}=== Working Memory Tests ===${NC}"
  echo ""

  # 1. 好みを伝える
  post_and_check \
    "好み設定" \
    "これから私への回答は必ず3行以内の箇条書きでお願いします" \
    "了解|承知|箇条書き|3行"

  # 2. 好みが反映されるか確認
  post_and_check \
    "好み反映確認" \
    "プロジェクト管理のコツを教えて" \
    "•|・|-"  # 箇条書きの記号
}

run_format_tests() {
  echo -e "${YELLOW}=== Output Format Tests ===${NC}"
  echo ""

  post_and_check \
    "Slack mrkdwn形式" \
    "太字と箇条書きを使って、AIの利点を3つ教えて" \
    "\*.*\*|•|・|-"  # 太字 or 箇条書き

  # 禁止フォーマットのチェック（**や#が含まれていないこと）
  echo -e "${BLUE}--- Test: 禁止フォーマット確認 ---${NC}"
  echo "Message: Markdownの見出しを使わずにタイトルを付けて回答して"

  RESPONSE=$(curl -s -X POST https://slack.com/api/chat.postMessage \
    -H "Authorization: Bearer $SLACK_USER_TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "{\"channel\": \"$TEST_CHANNEL\", \"text\": \"<@$MANA_BOT_ID> Markdownの見出しを使わずにタイトルを付けて回答して。テスト用の短い回答でOK\"}")

  TS=$(echo "$RESPONSE" | jq -r '.ts')
  sleep $WAIT_TIME

  THREAD=$(curl -s -X GET "https://slack.com/api/conversations.replies?channel=$TEST_CHANNEL&ts=$TS" \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN")

  REPLY_TEXT=$(echo "$THREAD" | jq -r '.messages[1].text // ""')

  if echo "$REPLY_TEXT" | grep -qE '^\*\*|^#{1,3} '; then
    echo -e "${RED}FAIL: Contains forbidden format (**bold** or # heading)${NC}"
    ((FAIL_COUNT++))
  else
    echo -e "${GREEN}PASS: No forbidden format found${NC}"
    ((PASS_COUNT++))
  fi
  echo ""
}

run_conversation_tests() {
  echo -e "${YELLOW}=== Conversation Context Tests ===${NC}"
  echo ""

  # 文脈を維持できるか
  post_and_check \
    "文脈設定" \
    "私の名前は田中です。覚えておいて" \
    "田中|覚え|承知"

  post_and_check \
    "文脈確認" \
    "私の名前は何でしたか？" \
    "田中"
}

# Main
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}     Mana E2E Test Scenarios${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo "Channel: $TEST_CHANNEL (9999-manaテスト)"
echo "Wait time: ${WAIT_TIME}s per test"
echo ""

# Parse arguments
TEST_SET="${1:-all}"

case $TEST_SET in
  basic)
    run_basic_tests
    ;;
  web)
    run_web_search_tests
    ;;
  memory)
    run_memory_tests
    ;;
  format)
    run_format_tests
    ;;
  context)
    run_conversation_tests
    ;;
  all)
    run_basic_tests
    run_format_tests
    run_memory_tests
    run_web_search_tests
    run_conversation_tests
    ;;
  *)
    echo "Unknown test set: $TEST_SET"
    echo "Available: basic, web, memory, format, context, all"
    exit 1
    ;;
esac

# Summary
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}     Test Summary${NC}"
echo -e "${YELLOW}========================================${NC}"
echo -e "Passed: ${GREEN}$PASS_COUNT${NC}"
echo -e "Failed: ${RED}$FAIL_COUNT${NC}"

if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed${NC}"
  exit 1
fi
