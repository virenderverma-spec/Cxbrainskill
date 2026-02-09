# Manual Deployment to AWS Lambda via Console

## Step-by-Step Guide

### Step 1: Prepare the Deployment Package

### Option A: Optimized Package (Recommended - Smaller Size)

```bash
cd mcp-ai-boss-api

# Use the optimized script (reduces size significantly)
chmod +x scripts/create-optimized-package.sh
./scripts/create-optimized-package.sh
```

This creates a smaller package by:
- Installing ONLY production dependencies (excludes devDependencies)
- Excluding test files, TypeScript source files, docs, examples
- Using maximum compression
- Removing unnecessary files from node_modules

**If still > 50 MB**, the script will show what's taking space.

### Option B: Manual Package Creation

```bash
cd mcp-ai-boss-api

# 1. Install ONLY production dependencies
npm install --production

# 2. Copy OpenAPI spec
npm run copy-openapi

# 3. Build TypeScript
npm run build

# 4. Create deployment package
cd dist
zip -r ../lambda-package.zip .
cd ..
zip -r lambda-package.zip openapi.json package.json package-lock.json
zip -r lambda-package.zip node_modules/
```

**Note:** If package is still > 50 MB, use **Option C: S3 Upload** below.

---

## Step 1B: If Package is Too Large (>50 MB) - Upload via S3

If you get error: *"The selected file is too large. The maximum size is 50 MB"*

### Upload to S3 via AWS Console:

#### 1. Go to S3 Console
1. Open AWS Console: https://console.aws.amazon.com
2. Search for "S3" in the search bar
3. Click on **S3** service

#### 2. Create Bucket (if doesn't exist)
1. Click **"Create bucket"** button
2. **Bucket name**: `mcp-lambda-deployments` (or any unique name)
3. **AWS Region**: Select your region (e.g., `us-east-1`)
4. **Block Public Access**: Keep default settings (all checked)
5. Click **"Create bucket"** at bottom

#### 3. Upload Your Zip File
1. Click on your bucket name (`mcp-lambda-deployments`)
2. Click **"Upload"** button
3. Click **"Add files"** or drag and drop your `lambda-package.zip`
4. Click **"Upload"** button (wait for upload to complete)
5. After upload, click on the file name to see details

#### 4. Copy S3 URL
1. In the file details page, you'll see **"Object URL"** or **"S3 URI"**
2. Copy the **S3 URI** - it looks like:
   ```
   s3://mcp-lambda-deployments/lambda-package.zip
   ```
   OR copy the **Object URL**:
   ```
   https://mcp-lambda-deployments.s3.us-east-1.amazonaws.com/lambda-package.zip
   ```

#### 5. Use S3 URL in Lambda
1. Go back to Lambda function → **Code** tab
2. Click **"Upload from"** → **"Amazon S3"**
3. Paste the **S3 URI** (starts with `s3://`) in the field
   - Example: `s3://mcp-lambda-deployments/lambda-package.zip`
4. Click **"Save"**
5. Wait for deployment to complete

---

## Step 2: Create Lambda Function in AWS Console

### 2.1 Go to AWS Lambda Console
1. Open AWS Console: https://console.aws.amazon.com
2. Search for "Lambda" in the search bar
3. Click on **Lambda** service

### 2.2 Create Function
1. Click **"Create function"** button (orange button, top right)

### 2.3 Configure Function
Select **"Author from scratch"** (default option)

**Basic Information:**
- **Function name**: `mcp-ai-boss-api`
- **Runtime**: Select **Node.js 20.x** (or latest Node.js version)
- **Architecture**: Select **x86_64** (default)

**Permissions:**
- **Execution role**: 
  - Select **"Create a new role with basic Lambda permissions"**
  - OR if you have a role already, select **"Use an existing role"**

Click **"Create function"** button

---

## Step 3: Upload Deployment Package

### 3.1 Upload Code

**If package < 50 MB:**
1. In your Lambda function page, scroll to **"Code"** section
2. Click **"Upload from"** dropdown
3. Select **".zip file"**
4. Click **"Upload"** button
5. Select your `lambda-package.zip` file
6. Wait for upload to complete (may take 1-2 minutes)

**If package > 50 MB (Upload via S3):**
1. First upload to S3 via AWS Console (see **Step 1B** above for detailed steps)
2. In Lambda function → **Code** tab
3. Click **"Upload from"** → **"Amazon S3"**
4. Enter S3 URI (starts with `s3://`)
   - Example: `s3://mcp-lambda-deployments/lambda-package.zip`
5. Click **"Save"**

---

## Step 4: Configure Function Settings

### 4.1 General Configuration
1. Click **"Configuration"** tab
2. Click **"General configuration"** on left sidebar
3. Click **"Edit"** button

**Settings:**
- **Description**: `MCP Server for AI-BOSS-API`
- **Timeout**: 
  - Click **"Edit"** next to Timeout
  - Set to **30 seconds** (or 1 minute if you prefer)
  - Click **"Save"**
- **Memory**: 
  - Click **"Edit"** next to Memory
  - Set to **512 MB** (or 256 MB minimum)
  - Click **"Save"**

### 4.2 Environment Variables
1. Still in **"Configuration"** tab
2. Click **"Environment variables"** on left sidebar
3. Click **"Edit"** button
4. Click **"Add environment variable"**

Add these variables:

**Variable 1:**
- **Key**: `AI_BOSS_API_KEY`
- **Value**: `your-api-key-here` (your actual API key)

**Variable 2:**
- **Key**: `OPENAPI_SPEC_PATH`
- **Value**: `/var/task/openapi.json`

**Variable 3 (Optional):**
- **Key**: `AI_BOSS_API_BASE_URL`
- **Value**: `https://boss-api.rockstar-automations.com`

5. Click **"Save"** after adding all variables

### 4.3 Handler Configuration
1. In **"Code"** tab, scroll to **"Runtime settings"**
2. Click **"Edit"**
3. **Handler**: Set to `lambda.handler`
   - This tells Lambda to run the `handler` function from `lambda.js` file
4. Click **"Save"**

---

## Step 5: Create API Gateway

### 5.1 Add API Gateway Trigger
1. In your Lambda function page, click **"Add trigger"** button
2. Select **"API Gateway"** from the list

### 5.2 Configure API Gateway
**Trigger configuration:**
- **API**: Select **"Create an API"** (if you don't have one)
- **API type**: Select **"HTTP API"** (recommended, cheaper)
  - OR **"REST API"** if you need more features
- **Security**: Select **"Open"** (for testing)
  - For production, use **"AWS IAM"** or **"API Key"**
- **CORS**: Check **"Enable CORS"** checkbox ✅

Click **"Add"** button

### 5.3 Get API Endpoint URL
1. After creating the trigger, you'll see **"API endpoint"** URL
2. Copy this URL - it looks like:
   ```
   https://abc123xyz.execute-api.us-east-1.amazonaws.com/
   ```
3. This is your MCP server endpoint!

---

## Step 6: Test the Deployment

### 6.1 Test via AWS Console
1. In Lambda function page, click **"Test"** tab
2. Click **"Create new event"**
3. **Event name**: `test-mcp-list-tools`
4. **Event JSON**: Paste this:
```json
{
  "httpMethod": "POST",
  "path": "/",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}"
}
```
5. Click **"Save"**
6. Click **"Test"** button
7. Check **"Execution result"** - should show success with 74 tools

### 6.2 Test via curl (from your computer)
```bash
# Replace YOUR_API_URL with your actual API Gateway URL
curl -X POST https://YOUR_API_URL.execute-api.us-east-1.amazonaws.com/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

You should get a response with all 74 tools!

---

## Step 7: Test Tool Execution

```bash
# Test health check tool
curl -X POST https://YOUR_API_URL.execute-api.us-east-1.amazonaws.com/ \
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

---

## Troubleshooting

### Error: "Cannot find module"
- Make sure `node_modules/` is included in the zip
- Check that `package.json` is in the zip root

### Error: "OpenAPI spec not found"
- Verify `openapi.json` is in the zip root
- Check `OPENAPI_SPEC_PATH` environment variable is set to `/var/task/openapi.json`

### Error: "AI_BOSS_API_KEY not found"
- Check environment variables in Lambda Configuration
- Verify the key name is exactly `AI_BOSS_API_KEY`

### Error: "Timeout"
- Increase Lambda timeout to 1 minute
- Check CloudWatch logs for detailed errors

### View Logs
1. In Lambda function page, click **"Monitor"** tab
2. Click **"View CloudWatch logs"**
3. Check **"Log streams"** for execution logs

---

## Update Deployment

When you make code changes:

1. Rebuild and repackage:
```bash
npm run build
cd dist
zip -r ../lambda-package.zip .
cd ..
zip -r lambda-package.zip openapi.json package.json package-lock.json
zip -r lambda-package.zip node_modules/
```

2. In AWS Console:
   - Go to Lambda function
   - Click **"Code"** tab
   - Click **"Upload from"** → **".zip file"**
   - Upload new `lambda-package.zip`
   - Wait for deployment

---

## Cost Estimate

- **Lambda**: Free tier includes 1M requests/month
- **API Gateway HTTP API**: $1.00 per 1M requests (first 1M free)
- **Total**: ~$0-1/month for typical usage

---

## Security Recommendations

1. **API Keys**: Use AWS Secrets Manager instead of environment variables
2. **API Gateway**: Enable API key or IAM authentication
3. **VPC**: Deploy Lambda in VPC if accessing private resources
4. **CORS**: Restrict CORS origins in production

---

## Summary

✅ **Function Name**: `mcp-ai-boss-api`  
✅ **Runtime**: Node.js 20.x  
✅ **Handler**: `lambda.handler`  
✅ **Timeout**: 30 seconds  
✅ **Memory**: 512 MB  
✅ **Environment Variables**: `AI_BOSS_API_KEY`, `OPENAPI_SPEC_PATH`  
✅ **API Gateway**: HTTP API with CORS enabled  

Your MCP server is now live and accessible via HTTP! 🚀

