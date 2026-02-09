# Claude Desktop MCP Server Setup Guide

## JSON Configuration

Here's the exact JSON configuration for `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ai-boss-api": {
      "command": "node",
      "args": [
        "/Users/vinaysingh/Documents/RockStar-Automation/mcp-ai-boss-api/dist/index.js"
      ],
      "env": {
        "AI_BOSS_API_KEY": "a9ade4d9bf59784b96bd012f65539ea21a91ab589aa6a73a94699d663c04e763",
        "AI_BOSS_API_BASE_URL": "https://boss-api.rockstar-automations.com",
        "OPENAPI_SPEC_PATH": "/Users/vinaysingh/Documents/RockStar-Automation/AI-BOSS-API/generated/openapi.json"
      }
    }
  }
}
```

## Setup Instructions for Another Machine

### Prerequisites

1. **Node.js** (v18 or higher)
   ```bash
   node --version  # Should be v18.x or higher
   ```

2. **Claude Desktop** installed and running

3. **Access to the project files**:
   - `mcp-ai-boss-api` directory
   - `AI-BOSS-API/generated/openapi.json` file

### Step 1: Clone/Copy the Project

On the new machine, ensure you have:
- The `mcp-ai-boss-api` directory
- The `AI-BOSS-API/generated/openapi.json` file

**Option A: If using Git**
```bash
git clone <your-repo-url>
cd RockStar-Automation
```

**Option B: If copying manually**
- Copy the entire `mcp-ai-boss-api` directory
- Copy `AI-BOSS-API/generated/openapi.json` to the same relative location

### Step 2: Install Dependencies and Build

```bash
cd mcp-ai-boss-api
npm install
npm run build
```

Verify the build:
```bash
ls -la dist/index.js  # Should exist
```

### Step 3: Locate Claude Desktop Config File

The config file location depends on your OS:

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux:**
```
~/.config/Claude/claude_desktop_config.json
```

### Step 4: Create/Update the Config File

1. **Create the directory if it doesn't exist:**
   ```bash
   # macOS
   mkdir -p ~/Library/Application\ Support/Claude
   
   # Windows (PowerShell)
   New-Item -ItemType Directory -Force -Path "$env:APPDATA\Claude"
   
   # Linux
   mkdir -p ~/.config/Claude
   ```

2. **Create or edit the config file:**

   **macOS/Linux:**
   ```bash
   nano ~/Library/Application\ Support/Claude/claude_desktop_config.json
   # or
   nano ~/.config/Claude/claude_desktop_config.json
   ```

   **Windows:**
   ```powershell
   notepad "$env:APPDATA\Claude\claude_desktop_config.json"
   ```

3. **Paste this JSON (update the paths!):**

   ```json
   {
     "mcpServers": {
       "ai-boss-api": {
         "command": "node",
         "args": [
           "/FULL/PATH/TO/mcp-ai-boss-api/dist/index.js"
         ],
         "env": {
           "AI_BOSS_API_KEY": "a9ade4d9bf59784b96bd012f65539ea21a91ab589aa6a73a94699d663c04e763",
           "AI_BOSS_API_BASE_URL": "https://boss-api.rockstar-automations.com",
           "OPENAPI_SPEC_PATH": "/FULL/PATH/TO/AI-BOSS-API/generated/openapi.json"
         }
       }
     }
   }
   ```

4. **Update the paths:**
   - Replace `/FULL/PATH/TO/mcp-ai-boss-api/dist/index.js` with the actual absolute path
   - Replace `/FULL/PATH/TO/AI-BOSS-API/generated/openapi.json` with the actual absolute path

   **Example for macOS:**
   ```json
   {
     "mcpServers": {
       "ai-boss-api": {
         "command": "node",
         "args": [
           "/Users/john/Documents/RockStar-Automation/mcp-ai-boss-api/dist/index.js"
         ],
         "env": {
           "AI_BOSS_API_KEY": "a9ade4d9bf59784b96bd012f65539ea21a91ab589aa6a73a94699d663c04e763",
           "AI_BOSS_API_BASE_URL": "https://boss-api.rockstar-automations.com",
           "OPENAPI_SPEC_PATH": "/Users/john/Documents/RockStar-Automation/AI-BOSS-API/generated/openapi.json"
         }
       }
     }
   }
   ```

   **Example for Windows:**
   ```json
   {
     "mcpServers": {
       "ai-boss-api": {
         "command": "node",
         "args": [
           "C:\\Users\\John\\Documents\\RockStar-Automation\\mcp-ai-boss-api\\dist\\index.js"
         ],
         "env": {
           "AI_BOSS_API_KEY": "a9ade4d9bf59784b96bd012f65539ea21a91ab589aa6a73a94699d663c04e763",
           "AI_BOSS_API_BASE_URL": "https://boss-api.rockstar-automations.com",
           "OPENAPI_SPEC_PATH": "C:\\Users\\John\\Documents\\RockStar-Automation\\AI-BOSS-API\\generated\\openapi.json"
         }
       }
     }
   }
   ```

### Step 5: Verify Paths

**macOS/Linux:**
```bash
# Check if the MCP server file exists
ls -la /FULL/PATH/TO/mcp-ai-boss-api/dist/index.js

# Check if OpenAPI spec exists
ls -la /FULL/PATH/TO/AI-BOSS-API/generated/openapi.json

# Check if Node.js is accessible
which node
```

**Windows:**
```powershell
# Check if the MCP server file exists
Test-Path "C:\Users\John\Documents\RockStar-Automation\mcp-ai-boss-api\dist\index.js"

# Check if OpenAPI spec exists
Test-Path "C:\Users\John\Documents\RockStar-Automation\AI-BOSS-API\generated\openapi.json"

# Check if Node.js is accessible
where.exe node
```

### Step 6: Validate JSON

**macOS/Linux:**
```bash
python3 -m json.tool ~/Library/Application\ Support/Claude/claude_desktop_config.json > /dev/null && echo "✅ Valid JSON"
```

**Windows (PowerShell):**
```powershell
Get-Content "$env:APPDATA\Claude\claude_desktop_config.json" | ConvertFrom-Json | Out-Null; if ($?) { Write-Host "✅ Valid JSON" }
```

### Step 7: Restart Claude Desktop

1. **Quit Claude Desktop completely:**
   - macOS: Cmd+Q or right-click dock icon → Quit
   - Windows: Close all windows, check system tray
   - Linux: Close all windows

2. **Reopen Claude Desktop**

3. **Verify MCP Server:**
   - Go to **Settings → Developer → Local MCP servers**
   - You should see "ai-boss-api" listed
   - No error messages should appear

### Step 8: Test the Integration

Ask Claude:
```
What tools do you have from AI-BOSS-API?
```

Or test a specific tool:
```
Get customer details for ID 69281e2fd7b35a94126592c4
```

## Troubleshooting

### Error: "Unexpected token 'A', "[API Reques"... is not valid JSON"
- ✅ **Fixed!** This was caused by console.log statements writing to stdout
- Make sure you have the latest build: `npm run build`

### Error: "Command not found: node"
- Install Node.js: https://nodejs.org/
- Or use full path to node in the config:
  ```json
  "command": "/usr/local/bin/node"
  ```

### Error: "OpenAPI spec not found"
- Verify `OPENAPI_SPEC_PATH` points to the correct file
- Use absolute path, not relative
- Check file permissions

### MCP Server not showing in Claude Desktop
- Verify config file is in the correct location
- Check JSON is valid (no trailing commas, proper quotes)
- Restart Claude Desktop completely
- Check Claude Desktop version (needs 1.5+)

### Path Issues on Windows
- Use double backslashes: `C:\\Users\\...`
- Or use forward slashes: `C:/Users/...`
- Use absolute paths, not relative

## Quick Setup Script (macOS/Linux)

Save this as `setup-claude-mcp.sh`:

```bash
#!/bin/bash

# Get the current directory
PROJECT_DIR=$(pwd)
MCP_DIR="$PROJECT_DIR/mcp-ai-boss-api"
OPENAPI_PATH="$PROJECT_DIR/AI-BOSS-API/generated/openapi.json"

# Check if directories exist
if [ ! -d "$MCP_DIR" ]; then
  echo "❌ mcp-ai-boss-api directory not found!"
  exit 1
fi

if [ ! -f "$OPENAPI_PATH" ]; then
  echo "❌ OpenAPI spec not found at $OPENAPI_PATH"
  exit 1
fi

# Build the MCP server
echo "📦 Building MCP server..."
cd "$MCP_DIR"
npm install
npm run build

# Create config directory
CONFIG_DIR="$HOME/Library/Application Support/Claude"
mkdir -p "$CONFIG_DIR"

# Create config file
CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"
cat > "$CONFIG_FILE" << EOF
{
  "mcpServers": {
    "ai-boss-api": {
      "command": "node",
      "args": [
        "$MCP_DIR/dist/index.js"
      ],
      "env": {
        "AI_BOSS_API_KEY": "a9ade4d9bf59784b96bd012f65539ea21a91ab589aa6a73a94699d663c04e763",
        "AI_BOSS_API_BASE_URL": "https://boss-api.rockstar-automations.com",
        "OPENAPI_SPEC_PATH": "$OPENAPI_PATH"
      }
    }
  }
}
EOF

echo "✅ Configuration created at: $CONFIG_FILE"
echo ""
echo "🔄 Next steps:"
echo "1. Restart Claude Desktop"
echo "2. Go to Settings → Developer → Local MCP servers"
echo "3. Verify 'ai-boss-api' is listed"
```

Make it executable and run:
```bash
chmod +x setup-claude-mcp.sh
./setup-claude-mcp.sh
```

## Security Note

⚠️ **Important:** The API key is stored in plain text in the config file. Make sure:
- The config file has proper permissions (not world-readable)
- Don't commit the config file to Git
- Use environment variables if possible (though Claude Desktop config doesn't support this directly)

