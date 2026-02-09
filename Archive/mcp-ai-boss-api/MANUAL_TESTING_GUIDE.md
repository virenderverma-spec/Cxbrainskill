# Manual Testing Guide for MCP Server

## What Was Built

### MCP Server for AI-BOSS-API
- **Purpose:** Exposes all your AI-BOSS-API endpoints as MCP tools
- **How it works:** Reads OpenAPI spec → Generates 74 tools → Makes API calls
- **Protocol:** JSON-RPC 2.0 over stdio

### Components Built:
1. **OpenAPI Parser** - Reads and parses your OpenAPI spec
2. **Tool Generator** - Converts each API endpoint to an MCP tool
3. **Schema Mapper** - Maps OpenAPI schemas to MCP tool schemas
4. **API Client** - Makes HTTP requests to your AI-BOSS-API
5. **Tool Executor** - Executes tools and returns responses
6. **MCP Server** - Handles JSON-RPC protocol

---

## Manual Testing

### Method 1: Using echo/printf (Simple)

#### Step 1: Start the server
```bash
cd mcp-ai-boss-api
npm start
```

The server will wait for JSON-RPC requests on stdin.

#### Step 2: Send requests manually

**Test 1: Initialize**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' | npm start
```

**Test 2: List Tools**
```bash
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | npm start
```

**Test 3: Call Health Tool**
```bash
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_health","arguments":{}}}' | npm start
```

---

### Method 2: Using a Test Script (Better)

Create a file `test-manual.sh`:

```bash
#!/bin/bash

# Start server in background
node dist/index.js > server.log 2>&1 &
SERVER_PID=$!

# Wait for server to start
sleep 2

# Test 1: Initialize
echo "🧪 Test 1: Initialize"
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0.0"}}}' > /proc/$SERVER_PID/fd/0

# Test 2: List Tools
echo "🧪 Test 2: List Tools"
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' > /proc/$SERVER_PID/fd/0

# Cleanup
kill $SERVER_PID
```

---

### Method 3: Using Node.js Script (Best)

Create `test-manual.js`:

```javascript
import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, 'dist', 'index.js');

const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    AI_BOSS_API_KEY: process.env.AI_BOSS_API_KEY || 'your-api-key',
  },
});

// Handle responses
server.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  for (const line of lines) {
    if (line.startsWith('{')) {
      try {
        const response = JSON.parse(line);
        console.log('📥 Response:', JSON.stringify(response, null, 2));
      } catch (e) {
        // Not JSON
      }
    }
  }
});

// Send requests
function sendRequest(method, params, id = 1) {
  const request = {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
  server.stdin.write(JSON.stringify(request) + '\n');
}

// Wait for server to start
setTimeout(() => {
  console.log('1️⃣ Testing initialize...');
  sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'manual-test', version: '1.0.0' },
  }, 1);

  setTimeout(() => {
    console.log('2️⃣ Testing list tools...');
    sendRequest('tools/list', {}, 2);
  }, 1000);

  setTimeout(() => {
    console.log('3️⃣ Testing health check...');
    sendRequest('tools/call', {
      name: 'get_health',
      arguments: {},
    }, 3);
  }, 2000);

  setTimeout(() => {
    server.stdin.end();
    server.kill();
    process.exit(0);
  }, 5000);
}, 1000);
```

Run it:
```bash
node test-manual.js
```

---

## Example JSON Requests

### 1. Initialize Request
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "my-client",
      "version": "1.0.0"
    }
  }
}
```

**Expected Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "ai-boss-api",
      "version": "1.0.0"
    }
  }
}
```

---

### 2. List Tools Request
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

**Expected Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "get_health",
        "description": "Get API health status",
        "inputSchema": {
          "type": "object",
          "properties": {}
        }
      },
      // ... 73 more tools
    ]
  }
}
```

---

### 3. Call Tool - Health Check
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_health",
    "arguments": {}
  }
}
```

**Expected Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"status\":\"healthy\",\"timestamp\":\"...\",\"service\":\"ai-boss-api\",...}"
      }
    ]
  }
}
```

---

### 4. Call Tool - Get Customer by ID
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "get_customer_id",
    "arguments": {
      "id": "67daea5d9879e6d8def39cc8"
    }
  }
}
```

**What happens:**
- MCP server calls `GET /customer/67daea5d9879e6d8def39cc8`
- Includes API key in header
- Returns customer data

---

### 5. Call Tool - Search Customers
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "get_customer_search_search",
    "arguments": {
      "search": "john"
    }
  }
}
```

**What happens:**
- MCP server calls `GET /customer/search/john`
- Returns matching customers

---

### 6. Call Tool - Update Individual Email
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "patch_individual_id",
    "arguments": {
      "id": "68904115c0c71f5c7ef69881",
      "email": "newemail@example.com"
    }
  }
}
```

**What happens:**
- MCP server calls `PATCH /individual/68904115c0c71f5c7ef69881`
- Sends body: `{"email": "newemail@example.com"}`
- Updates the individual's email

---

## Quick Manual Test Commands

### Using netcat or similar:
```bash
# Start server
cd mcp-ai-boss-api
npm start &

# Send request
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node dist/index.js
```

### Using Python:
```python
import subprocess
import json

server = subprocess.Popen(
    ['node', 'dist/index.js'],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True
)

# Send initialize
request = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "1.0.0"}
    }
}
server.stdin.write(json.dumps(request) + '\n')
server.stdin.flush()

# Read response
response = server.stdout.readline()
print(json.loads(response))
```

---

## All Available Tools

Run this to see all 74 tools:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js | jq '.result.tools[].name'
```

Or use the test script:
```bash
npm run test-mcp
```

---

## Summary

**What was built:**
- ✅ MCP server that exposes 74 API endpoints as tools
- ✅ Auto-generated from OpenAPI spec
- ✅ Handles authentication automatically
- ✅ Makes real API calls

**How to test manually:**
1. Start server: `npm start`
2. Send JSON-RPC requests via stdin
3. Read JSON-RPC responses from stdout
4. Use any tool that can write to stdin and read from stdout

**Example tools you can call:**
- `get_health` - Health check
- `get_customer_id` - Get customer
- `get_customer_search_search` - Search customers
- `patch_individual_id` - Update individual (including email)
- `get_order_id` - Get order
- `get_report_order_rca_orderid` - Get RCA
- And 68 more...


