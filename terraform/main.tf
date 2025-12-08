# Terraform configuration for mana
terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Provider configuration
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

# Variables
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS profile"
  type        = string
  default     = "k.sato"
}

variable "environment_variables" {
  description = "Environment variables for Lambda function"
  type        = map(string)
  sensitive   = true
}

# DynamoDB Table for Event Deduplication
resource "aws_dynamodb_table" "processed_events" {
  name         = "mana-processed-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "event_key"

  attribute {
    name = "event_key"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Application = "mana"
    Purpose     = "Event deduplication"
  }
}

# Lambda Function
resource "aws_lambda_function" "slack_classify_bot" {
  filename      = "../api/lambda-package.zip"
  function_name = "mana"
  role          = aws_iam_role.lambda_execution_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  timeout       = 30
  memory_size   = 256

  environment {
    variables = merge(
      var.environment_variables,
      {
        DEDUP_TABLE_NAME = aws_dynamodb_table.processed_events.name
        AWS_REGION       = var.aws_region
      }
    )
  }

  depends_on = [
    aws_iam_role_policy.lambda_dynamodb_policy,
    aws_iam_role_policy.lambda_bedrock_policy,
    aws_cloudwatch_log_group.lambda_logs
  ]

  tags = {
    Application = "mana"
  }
}

# Lambda Function URL
resource "aws_lambda_function_url" "slack_classify_bot_url" {
  function_name      = aws_lambda_function.slack_classify_bot.function_name
  authorization_type = "NONE"

  cors {
    allow_credentials = false
    allow_headers     = ["content-type", "x-slack-signature", "x-slack-request-timestamp"]
    allow_methods     = ["POST"]
    allow_origins     = ["*"]
  }
}

# IAM Role for Lambda
resource "aws_iam_role" "lambda_execution_role" {
  name = "mana-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = {
    Application = "mana"
  }
}

# CloudWatch Logs
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/mana"
  retention_in_days = 14

  tags = {
    Application = "mana"
  }
}

# Basic Lambda Execution Policy
resource "aws_iam_role_policy" "lambda_logs_policy" {
  name = "mana-lambda-logs"
  role = aws_iam_role.lambda_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "arn:aws:logs:*:*:*"
    }]
  })
}

# DynamoDB Access Policy
resource "aws_iam_role_policy" "lambda_dynamodb_policy" {
  name = "mana-lambda-dynamodb"
  role = aws_iam_role.lambda_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:DescribeTable"
      ]
      Resource = aws_dynamodb_table.processed_events.arn
    }]
  })
}

# Bedrock Access Policy
resource "aws_iam_role_policy" "lambda_bedrock_policy" {
  name = "mana-lambda-bedrock"
  role = aws_iam_role.lambda_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:InvokeModel"
      ]
      Resource = "arn:aws:bedrock:us-east-1:*:inference-profile/us.anthropic.claude-sonnet-4-*"
    }]
  })
}

# EventBridge Rule for Daily DM Summary (9:00 AM JST = 0:00 UTC)
resource "aws_cloudwatch_event_rule" "daily_reminder" {
  name                = "mana-daily-reminder"
  description         = "Trigger daily DM summary at 9:00 AM JST"
  schedule_expression = "cron(0 0 * * ? *)"

  tags = {
    Application = "mana"
  }
}

resource "aws_cloudwatch_event_target" "daily_reminder_target" {
  rule      = aws_cloudwatch_event_rule.daily_reminder.name
  target_id = "mana-daily-reminder"
  arn       = aws_lambda_function.slack_classify_bot.arn
  input     = jsonencode({ action = "run_reminders" })
}

resource "aws_lambda_permission" "allow_eventbridge_daily" {
  statement_id  = "AllowExecutionFromEventBridgeDaily"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.slack_classify_bot.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_reminder.arn
}

# EventBridge Rule for Thread Reminders (every hour)
resource "aws_cloudwatch_event_rule" "thread_reminder" {
  name                = "mana-thread-reminder"
  description         = "Trigger thread reminders for Slack-created tasks"
  schedule_expression = "rate(1 hour)"

  tags = {
    Application = "mana"
  }
}

resource "aws_cloudwatch_event_target" "thread_reminder_target" {
  rule      = aws_cloudwatch_event_rule.thread_reminder.name
  target_id = "mana-thread-reminder"
  arn       = aws_lambda_function.slack_classify_bot.arn
  input     = jsonencode({ action = "run_thread_reminders" })
}

resource "aws_lambda_permission" "allow_eventbridge_thread" {
  statement_id  = "AllowExecutionFromEventBridgeThread"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.slack_classify_bot.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.thread_reminder.arn
}

# Outputs
output "lambda_function_url" {
  description = "Lambda Function URL for Slack events"
  value       = aws_lambda_function_url.slack_classify_bot_url.function_url
}

output "dynamodb_table_name" {
  description = "DynamoDB table name for event deduplication"
  value       = aws_dynamodb_table.processed_events.name
}

output "lambda_function_arn" {
  description = "Lambda function ARN"
  value       = aws_lambda_function.slack_classify_bot.arn
}