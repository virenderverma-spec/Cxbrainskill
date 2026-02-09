#!/usr/bin/env node

// Load environment variables first
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MCPServerCore } from './mcpServerCore.js';

// Start server with stdio transport (for local/Claude Desktop)
const server = new MCPServerCore();
server.initialize().then(async () => {
  const transport = new StdioServerTransport();
  await server.getServer().connect(transport);
  // Don't log to stdout/stderr in stdio mode - it breaks JSON-RPC protocol
}).catch((error) => {
  // Only log critical errors to stderr
  process.stderr.write(`[MCP Server] Failed to start: ${error}\n`);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await server.getServer().close();
  process.exit(0);
});
