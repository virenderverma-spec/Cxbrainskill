# AWS Lambda Deployment Guide

This guide explains how to deploy the MCP server to AWS Lambda for remote/team access.

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** installed and configured
3. **Node.js 20.x** installed
4. **Serverless Framework** (will be installed via npm)
5. **OpenAPI Spec** from AI-BOSS-API (`AI-BOSS-API/generated/openapi.json`)

## Step 1: Install Dependencies

```bash
cd mcp-ai-boss-api
npm install
```

## Step 2: Configure Environment Variables

Create a `.env` file in the `mcp-ai-boss-api` directory:

```bash
# Required: API key for AI-BOSS-API
AI_BOSS_API_KEY=your-api-key-here
# OR
AMDOCS_API_KEY=your-api-key-here

# Optional: Override API base URL (defaults to production)
AI_BOSS_API_BASE_URL=https://boss-api.rockstar-automations.com
```

**For Lambda deployment**, these will also need to be set in AWS Lambda environment variables (see Step 5).

## Step 3: Copy OpenAPI Spec

The OpenAPI spec needs to be bundled with the Lambda package:

```bash
npm run copy-openapi
```

This copies `AI-BOSS-API/generated/openapi.json` to `mcp-ai-boss-api/openapi.json`.

**Note:** Make sure the OpenAPI spec is generated first:
```bash
cd ../AI-BOSS-API
npm run generate:openapi
```

## Step 4: Build the Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

## Step 5: Configure AWS Credentials

Ensure AWS CLI is configured:

```bash
aws configure
```

Or set environment variables:
```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_DEFAULT_REGION=us-east-1
```

## Step 6: Deploy to Lambda

### Option A: Using Serverless Framework (Recommended)

```bash
# Deploy to default stage
npm run deploy

# Or deploy to specific stage
npm run deploy:dev
npm run deploy:prod
```

### Option B: Manual Deployment

#### 6.1: Prepare Package

```bash
npm run prepare-lambda
```

This:
- Builds TypeScript
- Copies OpenAPI spec
- Prepares the package

#### 6.2: Create Deployment Package

```bash
# Create a zip file with all dependencies
zip -r lambda-package.zip dist/ openapi.json package.json package-lock.json node_modules/
```

#### 6.3: Create Lambda Function via AWS Console

1. Go to AWS Lambda Console
2. Click "Create function"
3. Choose "Author from scratch"
4. Configure:
   - **Function name**: `mcp-ai-boss-api`
   - **Runtime**: Node.js 20.x
   - **Architecture**: x86_64
   - **Handler**: `dist/lambda.handler`
   - **Timeout**: 30 seconds
   - **Memory**: 512 MB

#### 6.4: Upload Deployment Package

1. In Lambda function, go to "Code" tab
2. Click "Upload from" → ".zip file"
3. Upload `lambda-package.zip`

#### 6.5: Configure Environment Variables

In Lambda function → Configuration → Environment variables, add:

```
AI_BOSS_API_KEY=your-api-key-here
AI_BOSS_API_BASE_URL=https://boss-api.rockstar-automations.com
OPENAPI_SPEC_PATH=/var/task/openapi.json
```

#### 6.6: Create API Gateway

1. Go to API Gateway Console
2. Create new HTTP API
3. Add integration:
   - **Integration type**: Lambda
   - **Lambda function**: `mcp-ai-boss-api`
   - **Method**: ANY
   - **Path**: `/{proxy+}` and `/`
4. Enable CORS
5. Deploy API
6. Note the API endpoint URL

## Step 7: Test the Deployment

### Test List Tools

```bash
curl -X POST https://your-api-id.execute-api.us-east-1.amazonaws.com/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

### Test Tool Execution

```bash
curl -X POST https://your-api-id.execute-api.us-east-1.amazonaws.com/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get_health",
      "arguments": {}
    }
  }'
```

## Step 8: Update Client Configuration

For clients to use the HTTP endpoint instead of stdio:

```json
{
  "mcpServers": {
    "ai-boss-api": {
      "url": "https://your-api-id.execute-api.us-east-1.amazonaws.com/",
      "transport": "http"
    }
  }
}
```

## Troubleshooting

### Error: "OpenAPI spec not found"

- Ensure `openapi.json` is in the Lambda package root
- Check `OPENAPI_SPEC_PATH` environment variable
- Verify the file is included in the deployment package

### Error: "AI_BOSS_API_KEY not found"

- Set environment variable in Lambda configuration
- Verify the key is correct and has access to AI-BOSS-API

### Error: "Timeout"

- Increase Lambda timeout (default is 30 seconds)
- Check if API calls to AI-BOSS-API are slow
- Monitor CloudWatch logs

### Error: "Module not found"

- Ensure `node_modules` is included in deployment package
- Run `npm install --production` before packaging
- Check that all dependencies are listed in `package.json`

### Cold Start Issues

- First request may take 2-5 seconds (cold start)
- Consider using Lambda Provisioned Concurrency for production
- Or use API Gateway caching for frequently accessed endpoints

## Monitoring

### CloudWatch Logs

Lambda automatically logs to CloudWatch. View logs:

```bash
aws logs tail /aws/lambda/mcp-ai-boss-api --follow
```

### Metrics

Monitor in CloudWatch:
- Invocations
- Duration
- Errors
- Throttles

## Cost Estimation

- **Free Tier**: 1M requests/month, 400K GB-seconds
- **Beyond Free Tier**: ~$0.20 per 1M requests + compute time
- **API Gateway**: $3.50 per 1M requests (first 1M free)

For typical usage (1000 requests/day):
- **Lambda**: ~$0.10/month
- **API Gateway**: ~$0.10/month
- **Total**: ~$0.20/month

## Security Best Practices

1. **API Keys**: Store in AWS Secrets Manager, not environment variables
2. **IAM Roles**: Use least-privilege IAM roles for Lambda
3. **VPC**: Deploy Lambda in VPC if accessing private resources
4. **Rate Limiting**: Configure API Gateway throttling
5. **CORS**: Restrict CORS origins in production

## Updating the Deployment

### Using Serverless Framework

```bash
npm run deploy
```

### Manual Update

1. Make code changes
2. Run `npm run prepare-lambda`
3. Create new zip: `zip -r lambda-package.zip dist/ openapi.json package.json package-lock.json node_modules/`
4. Upload to Lambda function

## Rollback

If deployment fails:

1. Go to Lambda function → Versions
2. Select previous working version
3. Click "Set as current version"

Or use Serverless Framework:

```bash
serverless rollback --timestamp <timestamp>
```


