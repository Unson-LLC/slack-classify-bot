#!/bin/bash
# Setup infrastructure for source code reading feature

set -e

AWS_REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET_NAME="brainbase-source-${ACCOUNT_ID}"

echo "=== Source Code Infrastructure Setup ==="
echo "Region: ${AWS_REGION}"
echo "Account: ${ACCOUNT_ID}"
echo "Bucket: ${BUCKET_NAME}"
echo ""

# 1. Create S3 bucket
echo "1. Creating S3 bucket..."
if aws s3api head-bucket --bucket "${BUCKET_NAME}" 2>/dev/null; then
  echo "   Bucket already exists: ${BUCKET_NAME}"
else
  aws s3api create-bucket \
    --bucket "${BUCKET_NAME}" \
    --region "${AWS_REGION}" \
    --create-bucket-configuration LocationConstraint="${AWS_REGION}" 2>/dev/null || \
  aws s3api create-bucket \
    --bucket "${BUCKET_NAME}" \
    --region "${AWS_REGION}"
  echo "   Created: ${BUCKET_NAME}"
fi

# 2. Enable versioning (optional but recommended)
echo "2. Enabling versioning..."
aws s3api put-bucket-versioning \
  --bucket "${BUCKET_NAME}" \
  --versioning-configuration Status=Enabled
echo "   Versioning enabled"

# 3. Set lifecycle policy (delete old versions after 30 days)
echo "3. Setting lifecycle policy..."
aws s3api put-bucket-lifecycle-configuration \
  --bucket "${BUCKET_NAME}" \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "DeleteOldVersions",
        "Status": "Enabled",
        "NoncurrentVersionExpiration": {
          "NoncurrentDays": 30
        },
        "Filter": {
          "Prefix": ""
        }
      }
    ]
  }'
echo "   Lifecycle policy set"

# 4. Block public access
echo "4. Blocking public access..."
aws s3api put-public-access-block \
  --bucket "${BUCKET_NAME}" \
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
  }'
echo "   Public access blocked"

echo ""
echo "=== S3 Setup Complete ==="
echo "Bucket: s3://${BUCKET_NAME}/"
echo ""
echo "Next: Add IAM permissions to Lambda role"
echo ""

# 5. Output IAM policy for Lambda
echo "=== Required IAM Policy ==="
cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::${BUCKET_NAME}",
        "arn:aws:s3:::${BUCKET_NAME}/*"
      ]
    }
  ]
}
EOF
