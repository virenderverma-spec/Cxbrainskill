#!/usr/bin/env node

/**
 * Test script for MCP server
 * Tests tool generation and basic functionality
 */

import { ToolGenerator } from './tools/generator.js';
import { ToolExecutor } from './tools/executor.js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function testMCP() {
  console.log('🧪 Testing MCP Server...\n');

  try {
    // Test 1: Load OpenAPI spec
    console.log('1️⃣ Testing OpenAPI Parser...');
    const openAPIPath = path.join(__dirname, '..', '..', 'AI-BOSS-API', 'generated', 'openapi.json');
    const generator = new ToolGenerator(openAPIPath);
    console.log('   ✅ OpenAPI spec loaded\n');

    // Test 2: Generate tools
    console.log('2️⃣ Testing Tool Generation...');
    const tools = generator.generateAllTools();
    console.log(`   ✅ Generated ${tools.length} tools`);
    
    // Show sample tools
    console.log('\n   Sample tools:');
    tools.slice(0, 5).forEach(tool => {
      const desc = tool.description || 'No description';
      console.log(`   - ${tool.name}: ${desc.split('\n')[0]}`);
    });
    console.log('');

    // Test 3: Test tool by tag
    console.log('3️⃣ Testing Tool Grouping...');
    const tags = generator.getTags();
    console.log(`   ✅ Found ${tags.length} tags: ${tags.join(', ')}\n`);

    // Test 4: Test API client (if API key is set)
    if (process.env.AI_BOSS_API_KEY) {
      console.log('4️⃣ Testing API Client...');
      const executor = new ToolExecutor();
      
      // Find a simple GET endpoint to test
      const getTool = tools.find(t => 
        t.endpoint.method === 'GET' && 
        t.endpoint.path === '/health'
      );

      if (getTool) {
        console.log(`   Testing: ${getTool.name}`);
        try {
          const result = await executor.execute(getTool, {});
          if (result.success) {
            console.log('   ✅ API call successful');
            console.log(`   Response status: OK`);
          } else {
            console.log('   ⚠️  API call failed:', result.error?.message);
          }
        } catch (error: any) {
          console.log('   ⚠️  API call error:', error.message);
        }
      } else {
        console.log('   ⚠️  No /health endpoint found to test');
      }
      console.log('');
    } else {
      console.log('4️⃣ Skipping API Client test (no API key)\n');
    }

    // Test 5: Schema mapping
    console.log('5️⃣ Testing Schema Mapping...');
    const customerTool = tools.find(t => t.name.includes('customer') && t.name.includes('get'));
    if (customerTool) {
      console.log(`   ✅ Tool schema: ${JSON.stringify(customerTool.inputSchema, null, 2).substring(0, 200)}...`);
    }
    console.log('');

    console.log('✅ All tests completed!\n');
    console.log(`📊 Summary:`);
    console.log(`   - Tools generated: ${tools.length}`);
    console.log(`   - Tags: ${tags.length}`);
    console.log(`   - API Key configured: ${process.env.AI_BOSS_API_KEY ? 'Yes' : 'No'}`);
    console.log('');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testMCP();

