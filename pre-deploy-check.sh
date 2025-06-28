#!/bin/bash

# ==============================================================================
# Pre-deployment Checklist Script
# Checks common issues before deploying slack-classify-bot
# ==============================================================================

set -e

echo "🔍 Pre-deployment checks for slack-classify-bot..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Function to print status
print_status() {
    if [ "$1" == "ok" ]; then
        echo -e "${GREEN}✓${NC} $2"
    elif [ "$1" == "warning" ]; then
        echo -e "${YELLOW}⚠️${NC}  $2"
        ((WARNINGS++))
    else
        echo -e "${RED}✗${NC} $2"
        ((ERRORS++))
    fi
}

# Check 1: env.json exists
echo "1. Checking environment configuration..."
if [ ! -f "api/env.json" ]; then
    print_status "error" "api/env.json not found! Create it from api/env.json.template"
else
    # Check for template values
    if grep -q "YOUR-SLACK-BOT-TOKEN\|YOUR-SLACK-SIGNING-SECRET\|YOUR-BOT-ID\|your-n8n-domain\|appXXXX\|patXXXX" "api/env.json"; then
        print_status "error" "api/env.json contains template values! Update with actual values."
    else
        # Check required keys
        REQUIRED_KEYS=("SLACK_BOT_TOKEN" "SLACK_SIGNING_SECRET" "SLACK_BOT_ID" "AIRTABLE_TOKEN" "AIRTABLE_BASE" "N8N_ENDPOINT")
        MISSING_KEYS=()
        
        for key in "${REQUIRED_KEYS[@]}"; do
            if ! grep -q "\"$key\"" "api/env.json"; then
                MISSING_KEYS+=("$key")
            fi
        done
        
        if [ ${#MISSING_KEYS[@]} -eq 0 ]; then
            print_status "ok" "api/env.json is properly configured"
        else
            print_status "error" "Missing required keys in env.json: ${MISSING_KEYS[*]}"
        fi
    fi
fi

# Check 2: AWS CLI and profile
echo ""
echo "2. Checking AWS configuration..."
if ! command -v aws &> /dev/null; then
    print_status "error" "AWS CLI not installed"
else
    if aws sts get-caller-identity --profile k.sato &> /dev/null; then
        print_status "ok" "AWS CLI configured with profile 'k.sato'"
    else
        print_status "error" "AWS profile 'k.sato' not configured or invalid credentials"
    fi
fi

# Check 3: Node.js and npm
echo ""
echo "3. Checking Node.js environment..."
if ! command -v node &> /dev/null; then
    print_status "error" "Node.js not installed"
else
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1)
    if [ "$MAJOR_VERSION" -ge 18 ]; then
        print_status "ok" "Node.js version $NODE_VERSION (18.x or higher required)"
    else
        print_status "error" "Node.js version $NODE_VERSION is too old (18.x or higher required)"
    fi
fi

# Check 4: Dependencies
echo ""
echo "4. Checking dependencies..."
if [ ! -d "api/node_modules" ]; then
    print_status "warning" "Dependencies not installed. Run 'cd api && npm install'"
elif [ "api/package.json" -nt "api/node_modules" ]; then
    print_status "warning" "package.json is newer than node_modules. Consider running 'npm install'"
else
    print_status "ok" "Dependencies are up to date"
fi

# Check 5: Test status
echo ""
echo "5. Checking test status..."
if command -v npm &> /dev/null && [ -d "api" ]; then
    cd api
    if npm test &> /dev/null; then
        print_status "ok" "All tests passing"
    else
        print_status "warning" "Some tests are failing"
    fi
    cd ..
else
    print_status "warning" "Cannot run tests"
fi

# Check 6: DynamoDB Table (if using Terraform)
echo ""
echo "6. Checking DynamoDB infrastructure..."
if [ -f "terraform/terraform.tfstate" ]; then
    if grep -q "slack-classify-bot-processed-events" "terraform/terraform.tfstate"; then
        print_status "ok" "DynamoDB table appears to be deployed"
    else
        print_status "warning" "DynamoDB table not found in Terraform state. Run 'terraform apply' if needed"
    fi
else
    print_status "warning" "Terraform not initialized. DynamoDB table status unknown"
fi

# Check 7: Git status
echo ""
echo "7. Checking Git status..."
if [ -d ".git" ]; then
    if [ -n "$(git status --porcelain api/env.json 2>/dev/null)" ]; then
        print_status "warning" "api/env.json has uncommitted changes (this is expected)"
    fi
    
    if [ -z "$(git status --porcelain --ignore-submodules 2>/dev/null | grep -v 'api/env.json')" ]; then
        print_status "ok" "Working directory is clean (except env.json)"
    else
        print_status "warning" "You have uncommitted changes"
    fi
fi

# Summary
echo ""
echo "========================================"
echo "Summary:"
echo "  Errors: $ERRORS"
echo "  Warnings: $WARNINGS"

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ Ready to deploy!${NC}"
    echo ""
    echo "Run './deploy.sh' to deploy"
    exit 0
else
    echo -e "${RED}✗ Fix errors before deploying${NC}"
    exit 1
fi