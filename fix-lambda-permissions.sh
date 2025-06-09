#!/bin/bash

# Lambda関数が自身を呼び出せるようにIAMポリシーを追加

ROLE_NAME="slack-classify-bot-lambda-role"
POLICY_NAME="slack-classify-bot-self-invoke"
REGION="us-east-1"
ACCOUNT_ID="593793022993"

echo "Creating IAM policy for Lambda self-invocation..."

# ポリシーを作成
aws iam create-policy \
  --policy-name $POLICY_NAME \
  --policy-document file://lambda-invoke-policy.json \
  --region $REGION

# ポリシーをロールにアタッチ
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}" \
  --region $REGION

echo "IAM policy attached successfully!"
echo "Lambda function can now invoke itself for async processing."