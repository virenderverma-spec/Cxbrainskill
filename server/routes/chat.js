/**
 * Chat Route for Zendesk Copilot
 *
 * Handles agent questions and returns AI-powered responses
 * using Claude with loaded skills and MCP tools.
 */

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { loadAllSkills, detectRelevantSkills, loadSelectedSkills } = require('../lib/skill-loader');

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Base system prompt (skills get appended)
const BASE_SYSTEM_PROMPT = `You are a customer service AI assistant for Meow Mobile, helping support agents resolve customer issues.

## Your Role
- Help agents diagnose and resolve customer problems
- Provide step-by-step guidance based on the skills and knowledge provided
- Use available tools to fetch real-time customer data
- Draft responses agents can send to customers
- Recommend escalation when appropriate

## Guidelines
- Always verify information with tools before making recommendations
- Adjust response style based on channel (email = detailed, chat = conversational)
- Never share internal notes or error codes directly with customers
- Be thorough for email responses, concise for chat
- When unsure, recommend escalation rather than guessing
- When drafting customer responses: write like a real person. No em dashes, no semicolons, no overly formal language. Use contractions. Keep it casual and helpful.

## Available Tools
You have access to these tools via MCP:
- Boss API: Real-time customer data (profile, orders, eSIM, payments, port-in)
- Databricks: Historical data and analytics
- Zendesk: Ticket search and management

## Current Context
`;

// Cache for loaded skills (reload on server restart or manually)
let cachedSkills = null;
let skillsLoadedAt = null;
const SKILL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load skills with caching
 */
function getSkills(forceReload = false) {
  const now = Date.now();

  if (forceReload || !cachedSkills || (now - skillsLoadedAt) > SKILL_CACHE_TTL) {
    console.log('Loading skills...');
    cachedSkills = loadAllSkills();
    skillsLoadedAt = now;
    console.log('Skills loaded successfully');
  }

  return cachedSkills;
}

/**
 * Build the full system prompt with context
 */
function buildSystemPrompt(ticketContext = {}) {
  const skills = getSkills();

  let contextSection = '';

  if (ticketContext.ticketId) {
    contextSection += `Ticket ID: ${ticketContext.ticketId}\n`;
  }
  if (ticketContext.customerEmail) {
    contextSection += `Customer Email: ${ticketContext.customerEmail}\n`;
  }
  if (ticketContext.channel) {
    contextSection += `Channel: ${ticketContext.channel}\n`;
  }
  if (ticketContext.subject) {
    contextSection += `Subject: ${ticketContext.subject}\n`;
  }
  if (ticketContext.status) {
    contextSection += `Status: ${ticketContext.status}\n`;
  }

  return BASE_SYSTEM_PROMPT + contextSection + '\n\n' + skills;
}

/**
 * Define available tools for Claude
 */
const TOOLS = [
  {
    name: 'get_customer_by_email',
    description: 'Fetch customer profile including account status, funnel stage, and basic info',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Customer email address'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'get_orders_by_email',
    description: 'Get all orders for a customer including status, payment, and line items',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Customer email address'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'get_esim_status',
    description: 'Check eSIM provisioning state (PENDING, ACTIVE, FAILED, etc.)',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Customer email address'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'get_payment_status',
    description: 'Get payment history including failed attempts and decline codes',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Customer email address'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'get_portin_status',
    description: 'Check port-in request status and rejection reasons',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Customer email address'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'get_network_outages',
    description: 'Check for active network outages in a ZIP code area',
    input_schema: {
      type: 'object',
      properties: {
        zip_code: {
          type: 'string',
          description: '5-digit ZIP code'
        }
      },
      required: ['zip_code']
    }
  },
  {
    name: 'search_zendesk_tickets',
    description: 'Search for related Zendesk tickets for a customer',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (email, ticket ID, or keywords)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'trigger_sim_swap',
    description: 'Initiate a SIM swap to reprovision eSIM. ALWAYS confirm with agent before using.',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Customer email address'
        },
        reason: {
          type: 'string',
          description: 'Reason for SIM swap'
        }
      },
      required: ['email', 'reason']
    }
  },
  {
    name: 'send_esim_instructions',
    description: 'Send eSIM installation instructions to customer via app notification',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Customer email address'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'run_databricks_query',
    description: 'Run a SQL query against Databricks for historical data (24h delay)',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL query to execute'
        }
      },
      required: ['query']
    }
  }
];

/**
 * Execute a tool call (connect to your actual APIs)
 */
async function executeTool(toolName, toolInput) {
  // TODO: Replace with actual API calls to Boss API, Databricks, Zendesk
  // This is a placeholder that you'll connect to your MCP servers

  console.log(`Executing tool: ${toolName}`, toolInput);

  switch (toolName) {
    case 'get_customer_by_email':
      // Call Boss API: GET /customer?email={email}
      return await callBossAPI(`/customer?email=${encodeURIComponent(toolInput.email)}`);

    case 'get_orders_by_email':
      // Call Boss API: GET /orders?email={email}
      return await callBossAPI(`/orders?email=${encodeURIComponent(toolInput.email)}`);

    case 'get_esim_status':
      // Call Boss API: GET /esim?email={email}
      return await callBossAPI(`/esim?email=${encodeURIComponent(toolInput.email)}`);

    case 'get_payment_status':
      // Call Boss API: GET /payments?email={email}
      return await callBossAPI(`/payments?email=${encodeURIComponent(toolInput.email)}`);

    case 'get_portin_status':
      // Call Boss API: GET /portin?email={email}
      return await callBossAPI(`/portin?email=${encodeURIComponent(toolInput.email)}`);

    case 'get_network_outages':
      // Call Boss API: GET /outages?zip={zip}
      return await callBossAPI(`/outages?zip=${encodeURIComponent(toolInput.zip_code)}`);

    case 'search_zendesk_tickets':
      // Call Zendesk API
      return await callZendeskAPI(`/api/v2/search.json?query=${encodeURIComponent(toolInput.query)}`);

    case 'trigger_sim_swap':
      // Call Boss API: POST /simswap
      return await callBossAPI('/simswap', 'POST', toolInput);

    case 'send_esim_instructions':
      // Call Boss API: POST /notifications/esim-help
      return await callBossAPI('/notifications/esim-help', 'POST', toolInput);

    case 'run_databricks_query':
      // Call Databricks SQL API
      return await callDatabricksSQL(toolInput.query);

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

/**
 * Placeholder API call functions - replace with actual implementations
 */
async function callBossAPI(endpoint, method = 'GET', body = null) {
  // TODO: Implement actual Boss API call
  // const response = await fetch(`${process.env.BOSS_API_URL}${endpoint}`, {
  //   method,
  //   headers: { 'Authorization': `Bearer ${process.env.BOSS_API_TOKEN}` },
  //   body: body ? JSON.stringify(body) : null
  // });
  // return response.json();

  return { message: 'Boss API not yet connected', endpoint };
}

async function callZendeskAPI(endpoint) {
  // TODO: Implement actual Zendesk API call
  return { message: 'Zendesk API not yet connected', endpoint };
}

async function callDatabricksSQL(query) {
  // TODO: Implement actual Databricks SQL call
  return { message: 'Databricks not yet connected', query };
}

/**
 * Main chat endpoint
 * POST /api/chat
 */
router.post('/', async (req, res) => {
  try {
    const {
      message,          // Agent's question
      ticketId,         // Current Zendesk ticket ID
      customerEmail,    // Customer's email from ticket
      channel,          // Ticket channel (email, chat, etc.)
      subject,          // Ticket subject
      status,           // Ticket status
      conversationHistory = [] // Previous messages in this session
    } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Build system prompt with context
    const systemPrompt = buildSystemPrompt({
      ticketId,
      customerEmail,
      channel,
      subject,
      status
    });

    // Build messages array
    const messages = [
      ...conversationHistory,
      { role: 'user', content: message }
    ];

    // Initial Claude call
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      messages: messages
    });

    // Handle tool calls in a loop
    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(toolUse.name, toolUse.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      // Continue conversation with tool results
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        messages: messages
      });
    }

    // Extract text response
    const textContent = response.content.find(block => block.type === 'text');
    const assistantMessage = textContent ? textContent.text : 'No response generated';

    // Return response
    res.json({
      response: assistantMessage,
      conversationHistory: [
        ...conversationHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: assistantMessage }
      ]
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      error: 'Failed to process message',
      details: error.message
    });
  }
});

/**
 * Reload skills endpoint (for manual refresh)
 * POST /api/chat/reload-skills
 */
router.post('/reload-skills', (req, res) => {
  try {
    getSkills(true); // Force reload
    res.json({ success: true, message: 'Skills reloaded' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reload skills' });
  }
});

/**
 * List available skills
 * GET /api/chat/skills
 */
router.get('/skills', (req, res) => {
  const { listAvailableSkills } = require('../lib/skill-loader');
  const skills = listAvailableSkills();
  res.json({ skills });
});

module.exports = router;
