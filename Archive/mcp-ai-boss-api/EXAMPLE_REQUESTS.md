# Example JSON-RPC Requests for Manual Testing

## How MCP Works

MCP uses **JSON-RPC 2.0** protocol over **stdio** (standard input/output).

- **Request:** Send JSON to server's stdin
- **Response:** Read JSON from server's stdout
- **Format:** One JSON object per line

---

## Example Requests

### 1. Initialize

**Request:**
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

**Response:**
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

### 2. List All Tools

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

**Response:**
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
      {
        "name": "get_customer_id",
        "description": "Get customer by ID",
        "inputSchema": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "description": "Customer unique identifier"
            }
          },
          "required": ["id"]
        }
      }
      // ... 72 more tools
    ]
  }
}
```

---

### 3. Call Tool - Health Check

**Request:**
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

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"status\":\"healthy\",\"timestamp\":\"2025-11-27T09:28:59.230Z\",\"service\":\"ai-boss-api\",\"downstream\":{...}}"
      }
    ]
  }
}
```

---

### 4. Call Tool - Get Customer by ID

**Request:**
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
- MCP server calls: `GET /customer/67daea5d9879e6d8def39cc8`
- Includes `X-API-Key` header
- Returns customer data

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"id\":\"67daea5d9879e6d8def39cc8\",\"name\":\"...\",...}"
      }
    ]
  }
}
```

---

### 5. Call Tool - Search Customers

**Request:**
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
- MCP server calls: `GET /customer/search/john`
- Returns matching customers

---

### 6. Call Tool - Update Individual Email

**Request:**
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
- MCP server calls: `PATCH /individual/68904115c0c71f5c7ef69881`
- Sends body: `{"email": "newemail@example.com"}`
- Updates the email

---

### 7. Call Tool - Get Order RCA

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "get_report_order_rca_orderid",
    "arguments": {
      "orderId": "120930"
    }
  }
}
```

**What happens:**
- MCP server calls: `GET /report/order/rca/120930`
- Returns full RCA analysis

---

### 8. Call Tool - Get Order Statistics

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "tools/call",
  "params": {
    "name": "get_report_order_rca_statistics",
    "arguments": {
      "fromDate": "2025-11-20",
      "toDate": "2025-11-25"
    }
  }
}
```

**What happens:**
- MCP server calls: `GET /report/order/rca/statistics?fromDate=2025-11-20&toDate=2025-11-25`
- Returns order statistics

---

## How to Test Manually

### Option 1: Use the Manual Test Script
```bash
npm run test-manual
```

This will:
- Start the server
- Send 4 example requests
- Show all responses
- Keep server running for more tests

### Option 2: Use echo/printf
```bash
# Start server
cd mcp-ai-boss-api
npm start

# In another terminal, send request:
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node dist/index.js
```

### Option 3: Use Node.js REPL
```javascript
const { spawn } = require('child_process');
const server = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });

server.stdout.on('data', (d) => console.log(d.toString()));
server.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n');
```

---

## All Available Tool Names

Run this to get all tool names:
```bash
npm run test-mcp | grep "name:"
```

Or check the test output - it shows sample tools.

Common tools:
- `get_health` - Health check
- `get_customer_id` - Get customer
- `get_customer_search_search` - Search customers
- `patch_individual_id` - Update individual (email, etc.)
- `get_order_id` - Get order
- `get_report_order_rca_orderid` - Get RCA
- `get_report_order_rca_statistics` - Get statistics
- `post_order` - Create order
- And 66 more...

---

## Testing Tips

1. **Always initialize first** - Send `initialize` request before other requests
2. **Send initialized notification** - After initialize, send `notifications/initialized`
3. **Use unique IDs** - Each request needs a unique `id`
4. **One request per line** - Each JSON object must be on its own line
5. **Read responses** - Responses come back with matching `id`

---

## Error Responses

If something goes wrong, you'll get:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32601,
    "message": "Method not found"
  }
}
```

Common errors:
- `Method not found` - Invalid method name
- `Tool not found` - Tool name doesn't exist
- `Invalid params` - Missing required parameters
- `API error` - Your API returned an error

