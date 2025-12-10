# mana Memory DynamoDBテーブルセットアップ

## 概要

Mastra Memoryの永続化にDynamoDBを使用。Single-table designパターンを採用。

## テーブル作成

### AWS CLI

```bash
aws dynamodb create-table \
  --table-name mana-memory \
  --attribute-definitions \
    AttributeName=pk,AttributeType=S \
    AttributeName=sk,AttributeType=S \
    AttributeName=gsi1pk,AttributeType=S \
    AttributeName=gsi1sk,AttributeType=S \
  --key-schema \
    AttributeName=pk,KeyType=HASH \
    AttributeName=sk,KeyType=RANGE \
  --global-secondary-indexes \
    '[
      {
        "IndexName": "gsi1",
        "KeySchema": [
          {"AttributeName": "gsi1pk", "KeyType": "HASH"},
          {"AttributeName": "gsi1sk", "KeyType": "RANGE"}
        ],
        "Projection": {"ProjectionType": "ALL"}
      }
    ]' \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### CloudFormation

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  ManaMemoryTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: mana-memory
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: pk
          AttributeType: S
        - AttributeName: sk
          AttributeType: S
        - AttributeName: gsi1pk
          AttributeType: S
        - AttributeName: gsi1sk
          AttributeType: S
      KeySchema:
        - AttributeName: pk
          KeyType: HASH
        - AttributeName: sk
          KeyType: RANGE
      GlobalSecondaryIndexes:
        - IndexName: gsi1
          KeySchema:
            - AttributeName: gsi1pk
              KeyType: HASH
            - AttributeName: gsi1sk
              KeyType: RANGE
          Projection:
            ProjectionType: ALL
```

## 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `MANA_MEMORY_TABLE` | DynamoDBテーブル名 | `mana-memory` |
| `AWS_REGION` | AWSリージョン | `us-east-1` |

## Lambda IAMポリシー

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:*:table/mana-memory",
        "arn:aws:dynamodb:us-east-1:*:table/mana-memory/index/*"
      ]
    }
  ]
}
```

## 確認

```bash
# テーブル確認
aws dynamodb describe-table --table-name mana-memory --region us-east-1

# テストデータ書き込み
aws dynamodb put-item \
  --table-name mana-memory \
  --item '{"pk": {"S": "test"}, "sk": {"S": "test"}}' \
  --region us-east-1

# テストデータ読み取り
aws dynamodb get-item \
  --table-name mana-memory \
  --key '{"pk": {"S": "test"}, "sk": {"S": "test"}}' \
  --region us-east-1

# テストデータ削除
aws dynamodb delete-item \
  --table-name mana-memory \
  --key '{"pk": {"S": "test"}, "sk": {"S": "test"}}' \
  --region us-east-1
```
