#!/usr/bin/env node

/**
 * Manual Testing Script
 * Send JSON-RPC requests manually and see responses
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const serverPath = path.join(__dirname, '..', 'dist', 'index.js');

console.log('🚀 Starting MCP Server for manual testing...\n');

const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    AI_BOSS_API_KEY: process.env.AI_BOSS_API_KEY || process.env.AMDOCS_API_KEY || 'a9ade4d9bf59784b96bd012f65539ea21a91ab589aa6a73a94699d663c04e763',
  },
});

let requestId = 1;
let stdoutBuffer = '';

// Handle server responses
server.stdout.on('data', (data) => {
  stdoutBuffer += data.toString();
  
  // Parse complete JSON lines
  let newlineIndex;
  while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
    const line = stdoutBuffer.substring(0, newlineIndex).trim();
    stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);
    
    if (!line || !line.startsWith('{')) continue;
    
    try {
      const response = JSON.parse(line);
      console.log('\n📥 RESPONSE:');
      console.log(JSON.stringify(response, null, 2));
      console.log('');
    } catch (e) {
      // Not JSON, might be server log
    }
  }
});

// Handle server logs
server.stderr.on('data', (data) => {
  const output = data.toString();
  if (output.includes('[MCP Server]')) {
    console.log('📡', output.trim());
  }
});

// Function to send request
function sendRequest(method, params) {
  const request = {
    jsonrpc: '2.0',
    id: requestId++,
    method,
    params,
  };
  
  console.log(`\n📤 SENDING REQUEST #${request.id}:`);
  console.log(JSON.stringify(request, null, 2));
  
  server.stdin.write(JSON.stringify(request) + '\n');
}

// Wait for server to start, then send test requests
setTimeout(() => {
  console.log('='.repeat(60));
  console.log('MANUAL TEST - Sending requests...');
  console.log('='.repeat(60));
  
  // Test 1: Initialize
  console.log('\n1️⃣ TEST: Initialize');
  sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'manual-test', version: '1.0.0' },
  });
  
  setTimeout(() => {
    // Test 2: List Tools
    console.log('\n2️⃣ TEST: List Tools');
    sendRequest('tools/list', {});
  }, 1500);
  
  setTimeout(() => {
    // Test 3: Call Health Tool
    console.log('\n3️⃣ TEST: Call Health Check Tool');
    sendRequest('tools/call', {
      name: 'get_health',
      arguments: {},
    });
  }, 3000);
  
  setTimeout(() => {
    // Test 4: Call Customer Search
    console.log('\n4️⃣ TEST: Call Customer Search Tool');
    sendRequest('tools/call', {
      name: 'get_customer_search_search',
      arguments: {
        search: 'test',
      },
    });
  }, 4500);
  
  setTimeout(() => {
    console.log('\n' + '='.repeat(60));
    console.log('✅ Manual testing complete!');
    console.log('='.repeat(60));
    console.log('\n💡 To test more tools, modify this script or send requests manually.');
    console.log('   Server is still running. Press Ctrl+C to stop.\n');
    
    // Keep server running for manual testing
    // Uncomment below to auto-close:
    // server.stdin.end();
    // setTimeout(() => {
    //   server.kill();
    //   process.exit(0);
    // }, 1000);
  }, 6000);
  
}, 2000);

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping server...');
  server.stdin.end();
  setTimeout(() => {
    server.kill();
    process.exit(0);
  }, 500);
});


