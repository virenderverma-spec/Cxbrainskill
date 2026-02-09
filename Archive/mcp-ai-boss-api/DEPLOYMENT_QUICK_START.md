# Quick Deployment Guide - AWS Lambda

## Prerequisites Checklist

- [ ] AWS Account with CLI configured
- [ ] Node.js 20.x installed
- [ ] OpenAPI spec generated (`AI-BOSS-API/generated/openapi.json`)
- [ ] API key for AI-BOSS-API

## Quick Deploy (5 Steps)

### 1. Install Dependencies
```bash
cd mcp-ai-boss-api
npm install
```

### 2. Set Environment Variables
Create `.env` file:
```bash
AI_BOSS_API_KEY=your-api-key-here
```

### 3. Copy OpenAPI Spec
```bash
npm run copy-openapi
```

### 4. Build
```bash
npm run build
```

### 5. Deploy
```bash
# Install Serverless Framework globally (first time only)
npm install -g serverless

# Deploy
npm run deploy
```

## Manual Deployment (Without Serverless Framework)

### Step 1: Prepare Package
```bash
npm run prepare-lambda
```

### Step 2: Create Zip
```bash
cd dist
zip -r ../lambda-package.zip . ../openapi.json ../package.json ../package-lock.json
cd ..
zip -r lambda-package.zip node_modules/
```

### Step 3: Create Lambda Function
1. Go to AWS Lambda Console
2. Create function → Author from scratch
3. Configure:
   - **Name**: `mcp-ai-boss-api`
   - **Runtime**: Node.js 20.x
   - **Handler**: `lambda.handler`
   - **Timeout**: 30 seconds
   - **Memory**: 512 MB

### Step 4: Upload Package
1. Upload `lambda-package.zip`
2. Set environment variables:
   - `AI_BOSS_API_KEY`
   - `AI_BOSS_API_BASE_URL` (optional)
   - `OPENAPI_SPEC_PATH=/var/task/openapi.json`

### Step 5: Create API Gateway
1. Create HTTP API
2. Add Lambda integration
3. Deploy and get endpoint URL

## Test Deployment

```bash
# List tools
curl -X POST https://your-api-id.execute-api.us-east-1.amazonaws.com/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

## Full Documentation

See `DEPLOYMENT.md` for detailed instructions, troubleshooting, and best practices.


