# MCP Server for AI-BOSS-API

Model Context Protocol (MCP) server that exposes AI-BOSS-API REST endpoints as callable tools for AI assistants.

## Features

- ✅ **Auto-generated tools** from OpenAPI specification
- ✅ **Full API coverage** - All endpoints automatically available
- ✅ **Type-safe** - TypeScript implementation
- ✅ **Authentication** - Automatic API key injection
- ✅ **Error handling** - Comprehensive error responses

## Installation

```bash
cd mcp-ai-boss-api
npm install
npm run build
```

## Configuration

Create a `.env` file (or use environment variables):

```env
AI_BOSS_API_BASE_URL=https://boss-api.rockstar-automations.com
AI_BOSS_API_KEY=your-api-key-here
```

## Usage

### As MCP Server

The server communicates via stdio using JSON-RPC 2.0 protocol.

```bash
npm start
```

### With Claude Desktop

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "ai-boss-api": {
      "command": "node",
      "args": ["/path/to/mcp-ai-boss-api/dist/index.js"],
      "env": {
        "AI_BOSS_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Development

```bash
# Watch mode
npm run dev

# Build
npm run build

# Generate tools (for testing)
npm run generate-tools
```

## How It Works

1. **OpenAPI Parsing**: Reads `AI-BOSS-API/generated/openapi.json`
2. **Tool Generation**: Converts each endpoint to an MCP tool
3. **Schema Mapping**: Maps OpenAPI schemas to MCP input schemas
4. **API Execution**: Makes HTTP requests to AI-BOSS-API with authentication
5. **Response Formatting**: Returns structured responses to AI assistant

## Tool Naming

Tools are named based on OpenAPI `operationId` or generated from path + method:
- `GET /customer/{id}` → `get_customer_id`
- `POST /order` → `post_order`
- `PATCH /individual/{id}` → `patch_individual_id`

## Examples

### List All Tools
The AI assistant can discover all available tools automatically.

### Call a Tool
```json
{
  "name": "get_customer_id",
  "arguments": {
    "id": "67daea5d9879e6d8def39cc8"
  }
}
```

### Update Customer Email
```json
{
  "name": "patch_individual_id",
  "arguments": {
    "id": "68904115c0c71f5c7ef69881",
    "email": "newemail@example.com"
  }
}
```

## Architecture

```
┌─────────────────┐
│  AI Assistant   │
│  (Claude/Chat)  │
└────────┬────────┘
         │ MCP Protocol (JSON-RPC)
         │
┌────────▼────────┐
│   MCP Server   │
│  (This Server) │
└────────┬────────┘
         │ HTTP/REST
         │
┌────────▼────────┐
│  AI-BOSS-API    │
│  (Your APIs)    │
└─────────────────┘
```

## Project Structure

```
mcp-ai-boss-api/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── tools/
│   │   ├── generator.ts      # OpenAPI → MCP tools generator
│   │   └── executor.ts       # Tool execution handler
│   ├── handlers/
│   │   ├── apiClient.ts      # HTTP client for AI-BOSS-API
│   │   └── auth.ts           # API key management
│   └── utils/
│       ├── openapiParser.ts  # Parse OpenAPI spec
│       └── schemaMapper.ts   # Map OpenAPI → MCP schemas
├── package.json
└── tsconfig.json
```

## Troubleshooting

### Tools not loading
- Check that `AI-BOSS-API/generated/openapi.json` exists
- Verify OpenAPI spec is valid JSON
- Check console for parsing errors

### API calls failing
- Verify `AI_BOSS_API_KEY` is set correctly
- Check `AI_BOSS_API_BASE_URL` points to correct server
- Verify network connectivity

### Authentication errors
- Ensure API key is valid
- Check key has required permissions
- Verify key format is correct

## License

MIT


