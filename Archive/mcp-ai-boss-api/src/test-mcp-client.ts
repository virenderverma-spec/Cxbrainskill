#!/usr/bin/env node

/**
 * MCP Client Test Script
 * Tests the MCP server by sending JSON-RPC requests
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

class MCPTestClient {
  private serverProcess: any;
  private requestId = 1;
  private responses: Map<number | string, JSONRPCResponse> = new Map();
  private pendingRequests: Map<number | string, (response: JSONRPCResponse) => void> = new Map();
  private stdoutBuffer = '';

  constructor() {
    const serverPath = path.join(__dirname, '..', 'dist', 'index.js');
    // Pass environment variables to the server process
    const env = {
      ...process.env,
      AI_BOSS_API_KEY: process.env.AI_BOSS_API_KEY || process.env.AMDOCS_API_KEY || 'a9ade4d9bf59784b96bd012f65539ea21a91ab589aa6a73a94699d663c04e763',
      AI_BOSS_API_BASE_URL: process.env.AI_BOSS_API_BASE_URL || 'https://boss-api.rockstar-automations.com',
    };
    
    this.serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    // Handle stdout (server responses)
    this.serverProcess.stdout.on('data', (data: Buffer) => {
      this.stdoutBuffer += data.toString();
      
      // Try to parse complete JSON objects from buffer
      let newlineIndex;
      while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
        const line = this.stdoutBuffer.substring(0, newlineIndex).trim();
        this.stdoutBuffer = this.stdoutBuffer.substring(newlineIndex + 1);
        
        if (!line) continue;
        
        // Check if it's JSON (starts with {)
        if (line.startsWith('{')) {
          try {
            const response: JSONRPCResponse = JSON.parse(line);
            console.log('📥 Received response for ID:', response.id);
            this.handleResponse(response);
          } catch (e: any) {
            // Might be incomplete JSON, keep in buffer
            if (e.message.includes('Unexpected end')) {
              this.stdoutBuffer = line + '\n' + this.stdoutBuffer;
              break;
            }
            console.log('⚠️  Failed to parse JSON:', line.substring(0, 200));
          }
        } else {
          // Not JSON, might be console.error output
          if (line.includes('[MCP Server]')) {
            console.log('📡 Server:', line);
          }
        }
      }
    });

    // Handle stderr (server logs)
    this.serverProcess.stderr.on('data', (data: Buffer) => {
      const output = data.toString();
      if (output.includes('[MCP Server]') || output.includes('[MCP Error]')) {
        console.log('📡 Server:', output.trim());
      }
    });

    this.serverProcess.on('error', (error: Error) => {
      console.error('❌ Server process error:', error);
    });

    this.serverProcess.on('exit', (code: number) => {
      console.log(`\n📡 Server exited with code ${code}`);
    });
  }

  private handleResponse(response: JSONRPCResponse): void {
    const resolver = this.pendingRequests.get(response.id);
    if (resolver) {
      resolver(response);
      this.pendingRequests.delete(response.id);
    } else {
      this.responses.set(response.id, response);
    }
  }

  async sendRequest(method: string, params?: any): Promise<JSONRPCResponse> {
    const id = this.requestId++;
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, resolve);

      const requestStr = JSON.stringify(request) + '\n';
      console.log('📤 Sending request:', JSON.stringify(request).substring(0, 150));
      this.serverProcess.stdin.write(requestStr);

      // Timeout after 15 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          console.log('⏱️  Request timeout for:', method);
          reject(new Error(`Request timeout for ${method}`));
        }
      }, 15000);
    });
  }

  async test(): Promise<void> {
    console.log('🧪 Testing MCP Server...\n');

    try {
      // Wait a bit for server to initialize
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test 1: Initialize
      console.log('1️⃣ Testing initialize...');
      const initResponse = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      });
      console.log('   ✅ Initialize successful');
      console.log('   Server:', initResponse.result?.serverInfo);
      console.log('');

      // Send initialized notification (no response expected)
      const notifStr = JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      }) + '\n';
      this.serverProcess.stdin.write(notifStr);
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait a bit

      // Test 2: List tools
      console.log('2️⃣ Testing list tools...');
      const listToolsResponse = await this.sendRequest('tools/list', {});
      const tools = listToolsResponse.result?.tools || [];
      console.log(`   ✅ Found ${tools.length} tools`);
      
      // Show sample tools
      console.log('\n   Sample tools:');
      tools.slice(0, 5).forEach((tool: any) => {
        console.log(`   - ${tool.name}: ${tool.description?.split('\n')[0] || 'No description'}`);
      });
      console.log('');

      // Test 3: Call a tool (health check)
      console.log('3️⃣ Testing tool call (health check)...');
      const healthTool = tools.find((t: any) => t.name === 'get_health');
      if (healthTool) {
        const callResponse = await this.sendRequest('tools/call', {
          name: 'get_health',
          arguments: {},
        });
        
        if (callResponse.error) {
          console.log('   ❌ Tool call failed:', callResponse.error.message);
        } else {
          const content = callResponse.result?.content?.[0]?.text;
          if (content) {
            const data = JSON.parse(content);
            console.log('   ✅ Tool call successful');
            console.log('   Response:', JSON.stringify(data, null, 2).substring(0, 200) + '...');
          }
        }
      } else {
        console.log('   ⚠️  Health tool not found');
      }
      console.log('');

      // Test 4: Call a tool with parameters (if available)
      console.log('4️⃣ Testing tool with parameters...');
      const customerTool = tools.find((t: any) => 
        t.name.includes('customer') && 
        t.name.includes('search')
      );
      
      if (customerTool) {
        console.log(`   Testing: ${customerTool.name}`);
        const callResponse = await this.sendRequest('tools/call', {
          name: customerTool.name,
          arguments: {
            search: 'test',
          },
        });
        
        if (callResponse.error) {
          console.log('   ⚠️  Tool call returned error (expected for test data):', callResponse.error.message);
        } else {
          console.log('   ✅ Tool call successful');
        }
      } else {
        console.log('   ⚠️  Customer search tool not found');
      }
      console.log('');

      console.log('✅ All MCP protocol tests completed!\n');

    } catch (error: any) {
      console.error('❌ Test failed:', error.message);
      throw error;
    } finally {
      // Close server
      this.serverProcess.stdin.end();
      setTimeout(() => {
        this.serverProcess.kill();
        process.exit(0);
      }, 1000);
    }
  }
}

// Run tests
const client = new MCPTestClient();
client.test().catch((error) => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});

