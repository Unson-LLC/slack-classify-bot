#!/bin/bash
# Mana E2E Test with LLM Evaluation
# LLMで回答品質を評価するテストスクリプト
#
# Usage:
#   ./scripts/mana-llm-test.sh          # 全テスト実行
#   ./scripts/mana-llm-test.sh basic    # 基本応答のみ
#   ./scripts/mana-llm-test.sh web      # Web検索のみ
#   ./scripts/mana-llm-test.sh memory   # Working Memoryのみ

set -e

# Configuration (from environment variables)
SLACK_USER_TOKEN="${SLACK_USER_TOKEN:?Error: SLACK_USER_TOKEN environment variable is required}"
SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:?Error: SLACK_BOT_TOKEN environment variable is required}"
MANA_BOT_ID="${MANA_BOT_ID:-U093QQ0NV5K}"
TEST_CHANNEL="C0A2L9FEKEJ"  # 9999-manaテスト
WAIT_TIME=30
# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
PASS_COUNT=0
FAIL_COUNT=0

# AWS Profile
AWS_PROFILE="${AWS_PROFILE:-k.sato}"

# LLM評価関数（AWS Bedrock使用）
evaluate_with_llm() {
  local question="$1"
  local answer="$2"
  local criteria="$3"

  # Create temp files
  local tmp_body=$(mktemp)
  local tmp_response=$(mktemp)

  # Truncate long answers (keep first 500 chars to avoid token limits)
  local truncated_answer="${answer:0:500}"

  # Build JSON using jq for proper escaping (handles Japanese automatically)
  jq -n \
    --arg q "$question" \
    --arg a "$truncated_answer" \
    --arg c "$criteria" \
    '{
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: "You are evaluating an AI assistant response quality.\n\n## Target\nQuestion: \($q)\n\nAnswer: \($a)\n\n## Criteria\n\($c)\n\n## Output Format (JSON only)\n{\"pass\": true/false, \"score\": 1-10, \"reason\": \"Brief reason\"}\n\nEvaluate and output JSON only. No markdown."
      }]
    }' > "$tmp_body"

  # AWS Bedrock invoke with fileb:// for binary-safe file input
  # Using inference profile ID for Claude 3.5 Sonnet v2
  aws bedrock-runtime invoke-model \
    --model-id us.anthropic.claude-3-5-sonnet-20241022-v2:0 \
    --body "fileb://$tmp_body" \
    --content-type "application/json" \
    --accept "application/json" \
    --region us-east-1 \
    --profile "$AWS_PROFILE" \
    "$tmp_response" 2>&1 | grep -v "contentType" >&2

  local result=""
  if [ -f "$tmp_response" ] && [ -s "$tmp_response" ]; then
    result=$(cat "$tmp_response" | jq -r '.content[0].text' 2>/dev/null)
  fi

  # Cleanup
  rm -f "$tmp_body" "$tmp_response"

  # Return result or error
  if [ -n "$result" ] && [ "$result" != "null" ]; then
    echo "$result"
  else
    echo '{"pass": false, "score": 0, "reason": "LLM API error"}'
  fi
}

# Post message and evaluate with LLM
post_and_evaluate() {
  local test_name="$1"
  local message="$2"
  local evaluation_criteria="$3"

  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}Test: $test_name${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo "Question: $message"
  echo ""

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
  echo "Posted. Waiting ${WAIT_TIME}s for response..."
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
  echo "Answer: ${REPLY_TEXT:0:200}..."
  echo ""

  # Evaluate with LLM
  echo "Evaluating with LLM..."
  EVAL_RESULT=$(evaluate_with_llm "$message" "$REPLY_TEXT" "$evaluation_criteria")

  # Extract JSON from response (handle markdown code blocks or raw JSON)
  EVAL_JSON=$(echo "$EVAL_RESULT" | grep -o '{[^}]*}' | head -1)

  # Parse result
  PASS=$(echo "$EVAL_JSON" | jq -r '.pass // false' 2>/dev/null || echo "false")
  SCORE=$(echo "$EVAL_JSON" | jq -r '.score // 0' 2>/dev/null || echo "0")
  REASON=$(echo "$EVAL_JSON" | jq -r '.reason // "Parse error"' 2>/dev/null || echo "Parse error")

  echo "Score: $SCORE/10"
  echo "Reason: $REASON"

  # Score 7 or above is considered passing
  if [ "$PASS" = "true" ] || [ "${SCORE:-0}" -ge 7 ]; then
    echo -e "${GREEN}PASS${NC}"
    ((PASS_COUNT++))
  else
    echo -e "${RED}FAIL${NC}"
    ((FAIL_COUNT++))
  fi

  echo ""
  return 0
}

# Test scenarios
run_basic_tests() {
  echo -e "${YELLOW}╔════════════════════════════════════════╗${NC}"
  echo -e "${YELLOW}║       Basic Response Tests             ║${NC}"
  echo -e "${YELLOW}╚════════════════════════════════════════╝${NC}"
  echo ""

  post_and_evaluate \
    "基本応答・自己紹介" \
    "こんにちは。簡単に自己紹介して" \
    "1. 自分がAIアシスタント/PMであることを明示しているか
2. 適切な挨拶があるか
3. Slack mrkdwn形式（*太字*、箇条書き）を使用しているか
4. **markdown**や#見出しなどSlack非対応の形式を使っていないか
5. 回答が簡潔で読みやすいか"

  post_and_evaluate \
    "曖昧な依頼への対応" \
    "レポート作成をお願い" \
    "1. 詳細確認のための質問をしているか（何についてのレポートか、目的、期間など）
2. 一方的に作業を始めず、まず要件を確認しているか
3. 建設的で前向きな対応ができているか"
}

run_web_search_tests() {
  echo -e "${YELLOW}╔════════════════════════════════════════╗${NC}"
  echo -e "${YELLOW}║       Web Search Tests                 ║${NC}"
  echo -e "${YELLOW}╚════════════════════════════════════════╝${NC}"
  echo ""

  post_and_evaluate \
    "リアルタイム情報検索" \
    "東京の今日の天気を教えて" \
    "1. Web検索ツールを使用して実際の天気情報を取得したか
2. 具体的な天気情報（晴れ/曇り/雨、気温など）が含まれているか
3. 「取得できません」「検索機能がありません」などの回避回答ではないこと
4. 情報源や日時が明示されているとベター"

  post_and_evaluate \
    "最新ニュース検索" \
    "最新のAI関連ニュースを1つ教えて" \
    "1. Web検索ツールを使用して実際のニュースを取得したか
2. 具体的なニュース内容（タイトル、概要）が含まれているか
3. 「最新情報は取得できません」などの回避回答ではないこと
4. 情報源URLが含まれているとベター"
}

run_memory_tests() {
  echo -e "${YELLOW}╔════════════════════════════════════════╗${NC}"
  echo -e "${YELLOW}║       Working Memory Tests             ║${NC}"
  echo -e "${YELLOW}╚════════════════════════════════════════╝${NC}"
  echo ""

  post_and_evaluate \
    "好み設定" \
    "これから私への回答は必ず3行以内の箇条書きでお願いします" \
    "1. ユーザーの好みを理解・承認しているか
2. 今後の回答形式について確認/了解の意を示しているか"

  # Wait a bit for memory to be saved
  sleep 5

  post_and_evaluate \
    "好み反映確認" \
    "プロジェクト管理のコツを教えて" \
    "1. 回答が3行以内の箇条書き形式になっているか（これが最重要）
2. 箇条書きの記号（・、•、-）を使用しているか
3. 簡潔な内容になっているか
4. 長文や段落形式ではないこと"
}

run_format_tests() {
  echo -e "${YELLOW}╔════════════════════════════════════════╗${NC}"
  echo -e "${YELLOW}║       Output Format Tests              ║${NC}"
  echo -e "${YELLOW}╚════════════════════════════════════════╝${NC}"
  echo ""

  post_and_evaluate \
    "Slack mrkdwn形式" \
    "太字と箇条書きを使って、AIの利点を3つ教えて" \
    "1. Slack mrkdwn形式の太字（*太字*）を使用しているか
2. 箇条書き（・、•、-）を使用しているか
3. **markdown形式の太字**を使用していないこと
4. # や ## などの見出しを使用していないこと
5. 3つの利点が明確に列挙されているか"
}

run_context_tests() {
  echo -e "${YELLOW}╔════════════════════════════════════════╗${NC}"
  echo -e "${YELLOW}║       Conversation Context Tests       ║${NC}"
  echo -e "${YELLOW}╚════════════════════════════════════════╝${NC}"
  echo ""

  post_and_evaluate \
    "文脈記憶" \
    "私の名前は山田太郎です。覚えておいて" \
    "1. 名前を覚えたことを確認しているか
2. 適切な返答ができているか"

  sleep 5

  post_and_evaluate \
    "文脈呼び出し" \
    "私の名前を覚えていますか？" \
    "1. 山田太郎という名前を覚えているか
2. 正しく名前を返答できているか
3. 「覚えていません」ではなく記憶を活用できているか"
}

# Main
echo -e "${YELLOW}╔════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║     Mana E2E Test with LLM Evaluation          ║${NC}"
echo -e "${YELLOW}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo "Channel: $TEST_CHANNEL (9999-manaテスト)"
echo "Wait time: ${WAIT_TIME}s per test"
echo "Evaluator: Claude Sonnet 3.5 v2 (Bedrock)"
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
    run_context_tests
    ;;
  all)
    run_basic_tests
    run_format_tests
    run_memory_tests
    run_web_search_tests
    run_context_tests
    ;;
  *)
    echo "Unknown test set: $TEST_SET"
    echo "Available: basic, web, memory, format, context, all"
    exit 1
    ;;
esac

# Summary
echo -e "${YELLOW}╔════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║                Test Summary                    ║${NC}"
echo -e "${YELLOW}╚════════════════════════════════════════════════╝${NC}"
echo -e "Passed: ${GREEN}$PASS_COUNT${NC}"
echo -e "Failed: ${RED}$FAIL_COUNT${NC}"

if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed${NC}"
  exit 1
fi
