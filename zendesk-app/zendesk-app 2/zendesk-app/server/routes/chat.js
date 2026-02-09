const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { TOOLS, executeTool } = require('../tools');
const { databricksQuery } = require('../lib/databricks');
const { bossApi } = require('../lib/boss-api');
const { zendeskSearch } = require('../lib/zendesk-api');

const router = express.Router();

// ── Anthropic client (optional) ──────────────────────────────

let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    anthropic = new (Anthropic.default || Anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY });
  } catch (e) {
    console.warn('  ⚠ Could not initialize Anthropic client:', e.message);
  }
}

// ── System prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a customer support intelligence assistant for Gather (also known as Meow Mobile), an MVNO telecom company.

You help CS agents by looking up customer data, diagnosing issues, and providing actionable answers.

## Data Sources

**Boss API (real-time):** Use for individual customer lookups — get customer/subscriber details, orders, eSIM profiles, payment status, network outages, port-in status, and order RCA.

**Databricks SQL (historical, ~24h delay):** Use for customer profile lookups by email/name/phone, aggregated queries, ticket counts, onboarding flow metrics, and cross-table joins.

**Zendesk API (real-time):** Use search_zendesk_tickets to find recent support tickets by customer email.

## When to use which:
- **Searching for a customer by email/name/phone** → query_databricks using \`rds-prod_catalog\`.cj_prod.stripe_customers (Boss API search is BLOCKED — do NOT use search_customer)
- Looking up a SPECIFIC customer by ID/order/eSIM → Boss API tools (get_customer, get_order, etc.)
- Counting tickets, calculating rates, finding trends → query_databricks
- "How many X in the last N days?" → query_databricks
- "What's the status of order X?" → get_order / get_order_execution
- "Check network outages" → get_network_outages
- Finding a customer's support tickets → search_zendesk_tickets

## Customer Email Lookup — FOLLOW THESE 3 STEPS:

When an agent provides a customer email, ALWAYS execute all 3 steps to build a complete profile:

**Step 1: Databricks multi-join query** (customer profile + orders + onboarding + airvet)
\`\`\`sql
SELECT
  sc.user_id, sc.customer_email, sc.customer_name, sc.customer_phone,
  sc.individual_id, sc.stripe_customer_id,
  o.order_id, o.status as order_status, o.select_number_type, o.portin_failure_info,
  FROM_UTC_TIMESTAMP(o.created_at, 'America/Los_Angeles') as order_date_pst,
  FROM_UTC_TIMESTAMP(uof.payment_completed_time, 'America/Los_Angeles') as payment_completed_pst,
  FROM_UTC_TIMESTAMP(uof.activation_completed_time, 'America/Los_Angeles') as esim_activated_pst,
  FROM_UTC_TIMESTAMP(uof.completed_time, 'America/Los_Angeles') as onboarding_completed_pst,
  cai.is_airvet_activated,
  FROM_UTC_TIMESTAMP(cai.activated_at, 'America/Los_Angeles') as airvet_activated_pst
FROM \`rds-prod_catalog\`.cj_prod.stripe_customers sc
LEFT JOIN \`rds-prod_catalog\`.cj_prod.mvno_order o ON sc.user_id = o.user_id
LEFT JOIN \`rds-prod_catalog\`.cj_prod.user_onboarding_flow uof ON o.order_id = uof.order_id
LEFT JOIN \`rds-prod_catalog\`.cj_prod.customer_airvet_info cai ON sc.user_id = cai.user_id
WHERE sc.customer_email = 'user@example.com'
ORDER BY o.created_at DESC
\`\`\`

**Step 2: Boss API real-time status** — Use get_individual with the individual_id from Step 1 to get current subscriber status and MSISDN.

**Step 3: Zendesk ticket search** — Use search_zendesk_tickets with the email to find recent support history.

## Display Format for Customer Lookup:

Format the response EXACTLY like this:

**CUSTOMER PROFILE**
- Name: [name]
- Email: [email]
- Phone: [phone]
- Subscriber Status: [from Boss API get_individual — Activated/Suspended/etc.]
- MSISDN: [phone number on network, from Boss API]

**ORDER HISTORY**
For each order (newest first):
- Order #[id] | [STATUS] | [Port-in/New] | [date PST]
  - If FAILED: show failure reason from portin_failure_info

**ONBOARDING FUNNEL** (for the most recent/relevant order)
Show each milestone with checkmark/pending:
- Payment completed: [timestamp PST or "Pending"]
- eSIM activated: [timestamp PST or "Pending"]
- Onboarding complete: [timestamp PST or "Pending"]
- Airvet activated: [Yes/No]

**RECENT SUPPORT TICKETS**
For each ticket (up to 5):
- #[id] | [status] | [subject] | [date]

If any section has no data, say "None found" rather than omitting it.

## Important SQL patterns:
- Always backtick: \`rds-prod_catalog\`
- Dedup Zendesk: WITH deduped AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) as rn FROM ... ) SELECT * FROM deduped WHERE rn = 1
- Exclude noise: WHERE status != 'deleted' AND tags NOT LIKE '%pagerduty%'
- Port-in: select_number_type = 'PORTIN' OR portin_response LIKE '%PortInMSISDN%'
- Mochi escalation: get_json_object(metadata, '$.human_escalated') = 'true'
- Timezone: All Databricks timestamps are UTC. Convert to PST in queries: FROM_UTC_TIMESTAMP(column, 'America/Los_Angeles')
- When showing Boss API timestamps (orderDate, etc.), convert from UTC to PST before displaying

## Response style:
- Be concise and direct — agents are busy
- Always mention which data source you used
- If data is from Databricks, note it may not include the last 24 hours
- Format key data points clearly (status, dates, IDs)
- When something looks wrong, suggest next steps
- If you can't find data, say so clearly and suggest alternatives
- Always display times in PST (Pacific Time)`;

// ── Conversation memory (per session, in-memory) ─────────────

const conversations = new Map();

// ── Direct mode: pattern-match questions → API calls ─────────

function detectDirectAction(text) {
  const t = text.toLowerCase();

  // Customer search — use Databricks stripe_customers (Boss API search is blocked 403)
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) {
    const email = emailMatch[0];
    return {
      action: 'query_databricks',
      params: {
        sql: `SELECT sc.user_id, sc.customer_email, sc.customer_name, sc.customer_phone, sc.individual_id, sc.stripe_customer_id, o.order_id, o.status as order_status, o.select_number_type, o.portin_failure_info, FROM_UTC_TIMESTAMP(o.created_at, 'America/Los_Angeles') as order_date_pst, FROM_UTC_TIMESTAMP(uof.payment_completed_time, 'America/Los_Angeles') as payment_completed_pst, FROM_UTC_TIMESTAMP(uof.activation_completed_time, 'America/Los_Angeles') as esim_activated_pst, FROM_UTC_TIMESTAMP(uof.completed_time, 'America/Los_Angeles') as onboarding_completed_pst, cai.is_airvet_activated, FROM_UTC_TIMESTAMP(cai.activated_at, 'America/Los_Angeles') as airvet_activated_pst FROM \`rds-prod_catalog\`.cj_prod.stripe_customers sc LEFT JOIN \`rds-prod_catalog\`.cj_prod.mvno_order o ON sc.user_id = o.user_id LEFT JOIN \`rds-prod_catalog\`.cj_prod.user_onboarding_flow uof ON o.order_id = uof.order_id LEFT JOIN \`rds-prod_catalog\`.cj_prod.customer_airvet_info cai ON sc.user_id = cai.user_id WHERE sc.customer_email = '${email.replace(/'/g, "''")}' ORDER BY o.created_at DESC`,
      },
    };
  }

  const phoneMatch = text.match(/\+?1?\s*[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (phoneMatch) {
    const phone = phoneMatch[0].replace(/\D/g, '');
    return {
      action: 'query_databricks',
      params: {
        sql: `SELECT sc.user_id, sc.customer_email, sc.customer_name, sc.customer_phone, sc.individual_id, sc.stripe_customer_id, o.order_id, o.status as order_status, o.select_number_type, o.created_at as order_date FROM \`rds-prod_catalog\`.cj_prod.stripe_customers sc LEFT JOIN \`rds-prod_catalog\`.cj_prod.mvno_order o ON sc.user_id = o.user_id WHERE sc.customer_phone LIKE '%${phone.slice(-10)}%' ORDER BY o.created_at DESC`,
      },
    };
  }

  if (/search.*customer|find.*customer|look\s*up.*customer/i.test(t)) {
    const term = text.replace(/^.*(?:search|find|look\s*up)\s*(?:for\s+)?(?:customer\s+)?/i, '').trim();
    if (term) {
      return {
        action: 'query_databricks',
        params: {
          sql: `SELECT sc.user_id, sc.customer_email, sc.customer_name, sc.customer_phone, sc.individual_id, sc.stripe_customer_id FROM \`rds-prod_catalog\`.cj_prod.stripe_customers sc WHERE sc.customer_email LIKE '%${term.replace(/'/g, "''")}%' OR sc.customer_name LIKE '%${term.replace(/'/g, "''")}%' OR sc.customer_phone LIKE '%${term.replace(/'/g, "''")}%' LIMIT 10`,
        },
      };
    }
  }

  // Network outages
  const zipMatch = text.match(/\b(\d{5})\b/);
  if (/outage|network/i.test(t) && zipMatch) {
    return { action: 'get_network_outages', params: { zip: zipMatch[1] } };
  }

  // Port status
  if (/port.*status|porting/i.test(t) && phoneMatch) {
    return { action: 'get_port_status', params: { msisdn: phoneMatch[0].replace(/\D/g, '') } };
  }

  // Order by ID
  const orderIdMatch = text.match(/order\s*(?:#|id)?\s*([a-f0-9-]{8,}|\d{4,})/i);
  if (orderIdMatch) return { action: 'get_order', params: { order_id: orderIdMatch[1] } };

  // RCA
  if (/rca|root\s*cause/i.test(t) && orderIdMatch) {
    return { action: 'get_order_rca', params: { order_id: orderIdMatch[1] } };
  }

  // Customer by ID
  const custIdMatch = text.match(/customer\s*(?:id)?\s*([a-f0-9-]{20,})/i);
  if (custIdMatch) return { action: 'get_customer', params: { customer_id: custIdMatch[1] } };

  // eSIM by ICCID
  const iccidMatch = text.match(/(?:iccid|esim)\s*(?:profile)?\s*(\d{15,}|[a-f0-9-]{15,})/i);
  if (iccidMatch) return { action: 'get_esim_profile', params: { iccid_resource_id: iccidMatch[1] } };

  // Databricks queries — ticket count
  if (/how many.*ticket|ticket.*count|open.*ticket/i.test(t)) {
    return {
      action: 'query_databricks',
      params: {
        sql: `SELECT status, COUNT(DISTINCT id) as cnt FROM (SELECT id, status, ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) as rn FROM prod_catalog.customer_support.zendesk_tickets WHERE status != 'deleted' AND tags NOT LIKE '%pagerduty%' AND created_at >= current_date()) deduped WHERE rn = 1 GROUP BY status ORDER BY cnt DESC`,
      },
    };
  }

  // Port-in success rate
  if (/port.?in.*(?:success|rate)|porting.*rate/i.test(t)) {
    return {
      action: 'query_databricks',
      params: {
        sql: "SELECT COUNT(DISTINCT CASE WHEN status = 'COMPLETED' THEN id END) as completed, COUNT(DISTINCT CASE WHEN status = 'FAILED' THEN id END) as failed, ROUND(COUNT(DISTINCT CASE WHEN status = 'COMPLETED' THEN id END) * 100.0 / NULLIF(COUNT(DISTINCT CASE WHEN status IN ('COMPLETED','FAILED') THEN id END), 0), 1) as success_rate FROM `rds-prod_catalog`.cj_prod.mvno_order WHERE (select_number_type = 'PORTIN' OR portin_response LIKE '%PortInMSISDN%') AND created_at >= current_date() - interval 7 day",
      },
    };
  }

  // Mochi escalation rate
  if (/mochi.*escalat|escalation.*rate/i.test(t)) {
    return {
      action: 'query_databricks',
      params: {
        sql: "SELECT COUNT(*) as total_classified, SUM(CASE WHEN get_json_object(metadata, '$.human_escalated') = 'true' THEN 1 ELSE 0 END) as escalated, ROUND(SUM(CASE WHEN get_json_object(metadata, '$.human_escalated') = 'true' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) as escalation_rate FROM `rds-prod_catalog`.cj_prod.conversations WHERE get_json_object(metadata, '$.classified_at') IS NOT NULL AND created_at >= current_date() - interval 7 day",
      },
    };
  }

  // eSIM install rate
  if (/esim.*(?:install|activation).*rate/i.test(t)) {
    return {
      action: 'query_databricks',
      params: {
        sql: "SELECT ROUND(COUNT(DISTINCT CASE WHEN activation_completed_time IS NOT NULL THEN user_id END) * 100.0 / NULLIF(COUNT(DISTINCT CASE WHEN payment_completed_time IS NOT NULL THEN user_id END), 0), 1) AS esim_install_rate FROM `rds-prod_catalog`.cj_prod.user_onboarding_flow WHERE created_at >= current_date() - interval 7 day",
      },
    };
  }

  return null;
}

async function handleDirectMode(message) {
  const action = detectDirectAction(message);
  if (!action) {
    return {
      response: "I can help with:\n- **Customer search**: Type an email, phone, or name\n- **Order lookup**: \"order #12345\"\n- **eSIM status**: \"eSIM profile 890126...\"\n- **Network outages**: \"outages in ZIP 90210\"\n- **Port-in status**: \"port status for 555-123-4567\"\n- **Ticket count**: \"how many open tickets today?\"\n- **Port-in rate**: \"port-in success rate\"\n- **Mochi escalation rate**: \"mochi escalation rate\"\n- **eSIM install rate**: \"eSIM installation rate\"\n\nFor natural language queries, add an ANTHROPIC_API_KEY to .env.",
      toolsUsed: [],
    };
  }

  console.log(`  → Direct: ${action.action}(${JSON.stringify(action.params).slice(0, 100)})`);
  const result = await executeTool(action.action, action.params);
  const toolsUsed = [{ tool: action.action, input: action.params }];

  // Format the result
  let response;
  if (result.error) {
    response = `**Error from ${action.action}:** ${result.message || 'Unknown error'}`;
  } else if (result.columns && result.rows) {
    // Databricks result
    const rows = result.rows.slice(0, 20);
    let table = '| ' + result.columns.join(' | ') + ' |\n';
    table += '| ' + result.columns.map(() => '---').join(' | ') + ' |\n';
    rows.forEach(r => { table += '| ' + r.join(' | ') + ' |\n'; });
    response = `**Query result** (${result.row_count} rows):\n\n${table}\n\n*Source: Databricks SQL (data may not include last 24 hours)*`;
  } else {
    response = '**Result from ' + action.action + ':**\n\n```json\n' + JSON.stringify(result, null, 2).slice(0, 5000) + '\n```';
  }

  return { response, toolsUsed };
}

// ── POST /api/chat ───────────────────────────────────────────

router.post('/', async (req, res) => {
  const { message, sessionId = 'default', customerContext } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  // If no Anthropic key, use direct mode (pattern matching → API calls)
  if (!anthropic) {
    try {
      const result = await handleDirectMode(message);
      return res.json(result);
    } catch (err) {
      console.error('Direct mode error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Claude-powered mode ──────────────────────────────────

  // Get or create conversation history
  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, []);
  }
  const history = conversations.get(sessionId);

  // Build user message with optional context
  let userContent = message;
  if (customerContext) {
    userContent = `[Customer Context: ${JSON.stringify(customerContext)}]\n\n${message}`;
  }
  history.push({ role: 'user', content: userContent });

  // Keep history manageable (last 20 messages)
  while (history.length > 20) {
    history.shift();
  }

  try {
    const toolsUsed = [];
    let messages = [...history];

    // Tool use loop — Claude may call multiple tools
    let response;
    for (let i = 0; i < 10; i++) {
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      // If no tool use, we're done
      if (response.stop_reason !== 'tool_use') break;

      // Execute all tool calls
      const assistantContent = response.content;
      messages.push({ role: 'assistant', content: assistantContent });

      const toolResults = [];
      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          console.log(`  → Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);
          const result = await executeTool(block.name, block.input);
          toolsUsed.push({ tool: block.name, input: block.input });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result).slice(0, 50000),
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // Extract text response
    const textBlocks = (response.content || []).filter(b => b.type === 'text');
    const text = textBlocks.map(b => b.text).join('\n');

    // Save assistant response to history
    history.push({ role: 'assistant', content: text });

    res.json({ response: text, toolsUsed });
  } catch (err) {
    console.error('Claude API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function isAnthropicConfigured() {
  return !!anthropic;
}

module.exports = router;
module.exports.isAnthropicConfigured = isAnthropicConfigured;
