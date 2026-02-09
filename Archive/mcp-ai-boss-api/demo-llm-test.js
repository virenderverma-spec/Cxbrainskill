#!/usr/bin/env node

/**
 * Demo: Simulating an LLM using the MCP server
 * This shows how an AI assistant would interact with your MCP server
 */

import https from 'https';
import http from 'http';

// Your Lambda Function URL
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'https://z7kg55cyq6lx25rkhklmnc6rse0dpzvn.lambda-url.us-east-2.on.aws/';

// Helper to make HTTP requests
function makeRequest(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          resolve({ error: 'Invalid JSON', body });
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

// Simulate LLM conversation
async function simulateLLMConversation() {
  console.log('🤖 Simulating LLM using MCP Server...\n');
  console.log('=' .repeat(60));
  console.log('');

  try {
    // Step 1: LLM discovers available tools
    console.log('📋 LLM: "Let me see what tools are available..."\n');
    const toolsResponse = await makeRequest(MCP_SERVER_URL, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });

    if (toolsResponse.result && toolsResponse.result.tools) {
      const tools = toolsResponse.result.tools;
      console.log(`✅ Found ${tools.length} tools available\n`);
      
      // Show some example tools
      console.log('📌 Sample tools:');
      tools.slice(0, 5).forEach((tool) => {
        console.log(`   - ${tool.name}: ${tool.description?.split('\n')[0] || 'No description'}`);
      });
      console.log('');
    } else {
      console.log('❌ Failed to get tools');
      return;
    }

    // Step 2: LLM wants to get customer information
    console.log('🤖 LLM: "I need to get customer information. Let me call get_customer_id..."\n');
    
    const customerTool = toolsResponse.result.tools.find(t => t.name === 'get_customer_id');
    if (customerTool) {
      const customerResponse = await makeRequest(MCP_SERVER_URL, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_customer_id',
          arguments: {
            id: '67daea5d9879e6d8def39cc8', // Example customer ID
          },
        },
      });

      if (customerResponse.result) {
        const content = customerResponse.result.content?.[0]?.text;
        if (content) {
          const data = JSON.parse(content);
          console.log('✅ Customer data retrieved:');
          console.log(JSON.stringify(data, null, 2).substring(0, 300) + '...\n');
        } else {
          console.log('⚠️  Response:', JSON.stringify(customerResponse.result, null, 2).substring(0, 200));
        }
      } else if (customerResponse.error) {
        console.log(`⚠️  Error: ${customerResponse.error.message}`);
        console.log('   (This is expected if the customer ID doesn\'t exist)\n');
      }
    }

    // Step 3: LLM wants to search for customers
    console.log('🤖 LLM: "Let me search for customers..."\n');
    
    const searchTool = toolsResponse.result.tools.find(t => t.name.includes('customer') && t.name.includes('search'));
    if (searchTool) {
      const searchResponse = await makeRequest(MCP_SERVER_URL, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: searchTool.name,
          arguments: {
            search: 'test',
          },
        },
      });

      if (searchResponse.result) {
        const content = searchResponse.result.content?.[0]?.text;
        if (content) {
          const data = JSON.parse(content);
          console.log('✅ Search results retrieved');
          console.log(`   Found ${Array.isArray(data) ? data.length : 'data'} result(s)\n`);
        }
      } else if (searchResponse.error) {
        console.log(`⚠️  Error: ${searchResponse.error.message}\n`);
      }
    }

    // Step 4: LLM wants to get order statistics
    console.log('🤖 LLM: "Let me check order statistics for today..."\n');
    
    const statsTool = toolsResponse.result.tools.find(t => t.name.includes('statistics'));
    if (statsTool) {
      const statsResponse = await makeRequest(MCP_SERVER_URL, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: statsTool.name,
          arguments: {
            date: '2025-11-24',
          },
        },
      });

      if (statsResponse.result) {
        const content = statsResponse.result.content?.[0]?.text;
        if (content) {
          const data = JSON.parse(content);
          console.log('✅ Order statistics retrieved:');
          if (data.summary) {
            console.log(`   Total Orders: ${data.summary.total}`);
            console.log(`   Completed: ${data.summary.completed}`);
            console.log(`   Failed: ${data.summary.failed}`);
            console.log(`   In Progress: ${data.summary.inProgress}\n`);
          } else {
            console.log(JSON.stringify(data, null, 2).substring(0, 200) + '...\n');
          }
        }
      } else if (statsResponse.error) {
        console.log(`⚠️  Error: ${statsResponse.error.message}\n`);
      }
    }

    console.log('=' .repeat(60));
    console.log('');
    console.log('✅ Demo completed! The MCP server is working correctly.');
    console.log('');
    console.log('💡 This simulates how an LLM would:');
    console.log('   1. Discover available tools');
    console.log('   2. Call tools with appropriate parameters');
    console.log('   3. Use the results to answer user questions');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run demo
console.log('🚀 Starting MCP Server LLM Demo...\n');
console.log(`📍 MCP Server URL: ${MCP_SERVER_URL}\n`);
simulateLLMConversation();

