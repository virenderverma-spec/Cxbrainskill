require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const path = require('path');
const { getSkillGuidance, skillsAvailable } = require('./server/lib/skill-loader');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ── API clients ──────────────────────────────────────────────

// Anthropic is optional — only initialize if key is provided
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    anthropic = new (Anthropic.default || Anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY });
  } catch (e) {
    console.warn('  ⚠ Could not initialize Anthropic client:', e.message);
  }
}

const BOSS_API_URL = process.env.BOSS_API_URL || 'https://prod-boss-api.rockstar-automations.com';
const BOSS_API_KEY = process.env.BOSS_API_KEY || '';

const DATABRICKS_HOST = process.env.DATABRICKS_HOST || 'https://dbc-b7af8d94-a7ba.cloud.databricks.com';
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN || '';
const DATABRICKS_WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID || '';

// ── Boss API helper ──────────────────────────────────────────

async function bossApi(method, endpoint, params) {
  const url = `${BOSS_API_URL}${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  if (BOSS_API_KEY) headers['X-API-Key'] = BOSS_API_KEY;

  try {
    const resp = await axios({ method, url, headers, params, timeout: 15000 });
    return resp.data;
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    return { error: true, status, message: data?.message || err.message };
  }
}

// ── Databricks SQL helper ────────────────────────────────────

async function databricksQuery(sql) {
  if (!DATABRICKS_TOKEN || !DATABRICKS_WAREHOUSE_ID) {
    return { error: true, message: 'Databricks not configured. Set DATABRICKS_TOKEN and DATABRICKS_WAREHOUSE_ID in .env' };
  }

  try {
    const resp = await axios.post(
      `${DATABRICKS_HOST}/api/2.0/sql/statements`,
      {
        warehouse_id: DATABRICKS_WAREHOUSE_ID,
        statement: sql,
        wait_timeout: '30s',
        disposition: 'INLINE',
        format: 'JSON_ARRAY',
      },
      {
        headers: {
          Authorization: `Bearer ${DATABRICKS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 45000,
      }
    );

    const result = resp.data;
    if (result.status?.state === 'FAILED') {
      return { error: true, message: result.status.error?.message || 'Query failed' };
    }
    if (result.status?.state === 'SUCCEEDED') {
      const columns = (result.manifest?.schema?.columns || []).map(c => c.name);
      const rows = result.result?.data_array || [];
      return { columns, rows, row_count: result.manifest?.total_row_count || rows.length };
    }
    // Still running
    return { status: result.status?.state, statement_id: result.statement_id };
  } catch (err) {
    return { error: true, message: err.response?.data?.message || err.message };
  }
}

// ── Zendesk API helper ───────────────────────────────────────

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || '';
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL || '';
const ZENDESK_TOKEN = process.env.ZENDESK_TOKEN || '';

async function zendeskSearch(query) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_TOKEN) {
    return { error: true, message: 'Zendesk not configured. Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_TOKEN in .env' };
  }

  const auth = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}`).toString('base64');
  try {
    const resp = await axios.get(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search.json`,
      {
        params: { query, sort_by: 'created_at', sort_order: 'desc' },
        headers: { Authorization: `Basic ${auth}` },
        timeout: 15000,
      }
    );
    const results = (resp.data.results || []).slice(0, 10).map(t => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      type: t.type,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));
    return { count: resp.data.count, tickets: results };
  } catch (err) {
    return { error: true, message: err.response?.data?.error || err.message };
  }
}

// ── Zendesk API: ticket comments ─────────────────────────────

async function zendeskTicketComments(ticketId) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_TOKEN) {
    return { error: true, message: 'Zendesk not configured' };
  }

  const auth = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}`).toString('base64');
  try {
    const resp = await axios.get(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}/comments.json`,
      {
        headers: { Authorization: `Basic ${auth}` },
        timeout: 15000,
      }
    );
    return (resp.data.comments || []).map(c => ({
      body: c.body,
      author_id: c.author_id,
      created_at: c.created_at,
      public: c.public,
    }));
  } catch (err) {
    return { error: true, message: err.response?.data?.error || err.message };
  }
}

// ── Zendesk API: Help Center search ──────────────────────────

async function zendeskHelpCenterSearch(query) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_TOKEN) {
    return { error: true, message: 'Zendesk not configured' };
  }

  const auth = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}`).toString('base64');
  try {
    const resp = await axios.get(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/help_center/articles/search.json`,
      {
        params: { query, per_page: 5 },
        headers: { Authorization: `Basic ${auth}` },
        timeout: 15000,
      }
    );
    return (resp.data.results || []).map(a => ({
      title: a.title,
      html_url: a.html_url,
      snippet: a.snippet,
    }));
  } catch (err) {
    return { error: true, message: err.response?.data?.error || err.message };
  }
}

// ── Claude tool definitions (read-only) ──────────────────────

const TOOLS = [
  {
    name: 'search_customer',
    description: 'Search for a customer by name, email, or MSISDN (phone number). Returns a list of matching customers.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term: name, email, or phone number' },
      },
      required: ['search'],
    },
  },
  {
    name: 'get_customer',
    description: 'Get full customer details by customer ID.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'The customer ID' },
      },
      required: ['customer_id'],
    },
  },
  {
    name: 'get_individual',
    description: 'Get individual (subscriber) details by individual ID. Includes MSISDN, IMSI, status.',
    input_schema: {
      type: 'object',
      properties: {
        individual_id: { type: 'string', description: 'The individual/subscriber ID' },
      },
      required: ['individual_id'],
    },
  },
  {
    name: 'list_individuals',
    description: 'Find an individual by MSISDN or IMSI. Use resourceType "msisdn" or "imsi" with the value.',
    input_schema: {
      type: 'object',
      properties: {
        resource_type: { type: 'string', description: 'Resource type: "msisdn" or "imsi"' },
        resource_value: { type: 'string', description: 'The MSISDN or IMSI value' },
      },
      required: ['resource_type', 'resource_value'],
    },
  },
  {
    name: 'get_sim_products',
    description: 'Get SIM products and services for an individual. Returns active SIM, plan, and service details.',
    input_schema: {
      type: 'object',
      properties: {
        individual_id: { type: 'string', description: 'The individual/subscriber ID' },
      },
      required: ['individual_id'],
    },
  },
  {
    name: 'get_orders',
    description: 'List all orders for a customer by customer ID.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'The customer ID' },
      },
      required: ['customer_id'],
    },
  },
  {
    name: 'get_order',
    description: 'Get details of a specific order by order ID.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'The order ID' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'get_order_execution',
    description: 'Get the execution timeline and status for an order. Shows each step (payment, provisioning, activation).',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'The order ID' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'get_order_rca',
    description: 'Run Root Cause Analysis (RCA) on an order. Shows why an order failed or is stuck.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'The order ID' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'get_payments',
    description: 'Get payment history for a customer. Note: amount fields may be NULL in some records.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'The customer ID' },
      },
      required: ['customer_id'],
    },
  },
  {
    name: 'get_esim_profile',
    description: 'Get eSIM profile status by ICCID resource ID. Shows provisioning status and QR code availability.',
    input_schema: {
      type: 'object',
      properties: {
        iccid_resource_id: { type: 'string', description: 'The ICCID resource ID' },
      },
      required: ['iccid_resource_id'],
    },
  },
  {
    name: 'get_network_outages',
    description: 'Check for network outages by ZIP code.',
    input_schema: {
      type: 'object',
      properties: {
        zip: { type: 'string', description: '5-digit ZIP code' },
      },
      required: ['zip'],
    },
  },
  {
    name: 'get_port_status',
    description: 'Get the port-in status for a phone number (MSISDN).',
    input_schema: {
      type: 'object',
      properties: {
        msisdn: { type: 'string', description: 'The phone number to check port status for' },
      },
      required: ['msisdn'],
    },
  },
  {
    name: 'search_zendesk_tickets',
    description: 'Search Zendesk tickets by customer email. Returns the 10 most recent tickets for a customer, sorted by newest first.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Customer email address to search tickets for' },
      },
      required: ['email'],
    },
  },
  {
    name: 'query_databricks',
    description: `Execute a read-only SQL query on Databricks. Use this for historical/aggregated data like ticket counts, Mochi conversations, onboarding metrics, order history, etc.

Key tables:
- prod_catalog.customer_support.zendesk_tickets (tickets: id, created_at, status, type, priority, tags)
- prod_catalog.customer_support.zendesk_ticket_metrics (ticket_id, solved_at, reply_time_in_minutes, reopens)
- prod_catalog.telco.customer (id, status, created_at)
- prod_catalog.telco.payment (id, name, payer_id, status, payment_date — amount fields are NULL)
- \`rds-prod_catalog\`.cj_prod.mvno_order (order_id, user_id, status, esim_status, select_number_type, portin_response, created_at)
- \`rds-prod_catalog\`.cj_prod.conversations (conversation_id, user_id, title, message_count, metadata JSON with human_escalated, main_category)
- \`rds-prod_catalog\`.cj_prod.stripe_customers (user_id, customer_email, customer_name, customer_phone)
- \`rds-prod_catalog\`.cj_prod.user_onboarding_flow (user_id, order_id, payment_completed_time, activation_completed_time)
- \`rds-prod_catalog\`.cj_prod.customer_airvet_info (user_id, is_airvet_activated, activated_at)

Important:
- rds-prod_catalog has a hyphen — ALWAYS wrap in backticks: \`rds-prod_catalog\`
- Dedup Zendesk snapshots: ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC) as rn, then WHERE rn = 1
- Exclude deleted tickets: WHERE status != 'deleted' AND tags NOT LIKE '%pagerduty%'
- Port-in filter: select_number_type = 'PORTIN' OR portin_response LIKE '%PortInMSISDN%'
- Escalation detection: get_json_object(metadata, '$.human_escalated') = 'true'
- Only SELECT queries allowed`,
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'The SQL SELECT query to execute' },
      },
      required: ['sql'],
    },
  },
];

// ── Tool execution ───────────────────────────────────────────

async function executeTool(name, input) {
  switch (name) {
    case 'search_customer':
      return await bossApi('get', `/customer/search/${encodeURIComponent(input.search)}`);

    case 'get_customer':
      return await bossApi('get', `/customer/${input.customer_id}`);

    case 'get_individual':
      return await bossApi('get', `/individual/${input.individual_id}`);

    case 'list_individuals':
      return await bossApi('get', '/individual', {
        resourceType: input.resource_type,
        resourceValue: input.resource_value,
      });

    case 'get_sim_products':
      return await bossApi('get', `/individual/${input.individual_id}/simProducts`);

    case 'get_orders':
      return await bossApi('get', '/order', { customerId: input.customer_id });

    case 'get_order':
      return await bossApi('get', `/order/${input.order_id}`);

    case 'get_order_execution':
      return await bossApi('get', `/order/execution/${input.order_id}`);

    case 'get_order_rca':
      return await bossApi('get', `/report/order/rca/${input.order_id}`);

    case 'get_payments':
      return await bossApi('get', '/payment', { customerId: input.customer_id });

    case 'get_esim_profile':
      return await bossApi('get', `/esimprofile/${input.iccid_resource_id}`);

    case 'get_network_outages':
      return await bossApi('get', '/networkOutages', { zip: input.zip });

    case 'get_port_status':
      return await bossApi('get', `/order/getportstatus/${input.msisdn}`);

    case 'search_zendesk_tickets':
      return await zendeskSearch(`type:ticket requester:${input.email}`);

    case 'query_databricks':
      // Safety: only allow SELECT
      if (!/^\s*SELECT\b/i.test(input.sql)) {
        return { error: true, message: 'Only SELECT queries are allowed' };
      }
      return await databricksQuery(input.sql);

    default:
      return { error: true, message: `Unknown tool: ${name}` };
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

app.post('/api/chat', async (req, res) => {
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

// ── POST /api/customer/search ────────────────────────────────

app.post('/api/customer/search', async (req, res) => {
  const { search } = req.body;
  if (!search) return res.status(400).json({ error: 'search term required' });

  try {
    const result = await bossApi('get', `/customer/search/${encodeURIComponent(search)}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Shared customer lookup logic ─────────────────────────────

async function performCustomerLookup(email) {
  const safeEmail = email.replace(/'/g, "''").trim().toLowerCase();
  console.log(`  → Customer lookup: ${safeEmail}`);

  // Step 1: Databricks — find customer, orders, onboarding, cohort, airvet
  const mainQuery = await databricksQuery(`
    SELECT sc.user_id, sc.customer_email, sc.customer_name, sc.customer_phone,
      sc.individual_id, sc.stripe_customer_id,
      o.order_id, o.status AS order_status, o.esim_status,
      o.select_number_type, o.portin_response, o.created_at AS order_created_at,
      uf.payment_completed_time, uf.activation_completed_time,
      uf.order_completed_time, uf.number_selection_completed_time,
      uf.imei_checking_completed_time, uf.pet_insurance_completed_time,
      uf.completed_time AS onboarding_completed_time,
      up.is_s100_user, up.is_lifetime_free,
      udf.deposit_payment_status, udf.deposit_flow_status,
      cai.is_airvet_activated, cai.activated_at AS airvet_activated_at
    FROM \`rds-prod_catalog\`.cj_prod.stripe_customers sc
    LEFT JOIN \`rds-prod_catalog\`.cj_prod.mvno_order o ON sc.user_id = o.user_id
    LEFT JOIN \`rds-prod_catalog\`.cj_prod.user_onboarding_flow uf
      ON sc.user_id = uf.user_id AND o.order_id = uf.order_id
    LEFT JOIN \`rds-prod_catalog\`.cj_prod.user_profile up ON sc.user_id = up.user_id
    LEFT JOIN (
      SELECT user_id,
        payment_status AS deposit_payment_status,
        flow_status AS deposit_flow_status,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
      FROM \`rds-prod_catalog\`.cj_prod.user_deposit_flow
    ) udf ON sc.user_id = udf.user_id AND udf.rn = 1
    LEFT JOIN \`rds-prod_catalog\`.cj_prod.customer_airvet_info cai ON sc.user_id = cai.user_id
    WHERE LOWER(sc.customer_email) = '${safeEmail}'
    ORDER BY o.created_at DESC
  `);

  if (mainQuery.error || (!mainQuery.rows && !mainQuery.columns)) {
    return { found: false, error: mainQuery.message || 'Query failed' };
  }
  if (!mainQuery.rows || mainQuery.rows.length === 0) {
    return { found: false };
  }

  const cols = mainQuery.columns;
  const toObj = (row) => { const o = {}; cols.forEach((c, i) => { o[c] = row[i]; }); return o; };
  const allRows = mainQuery.rows.map(toObj);
  const first = allRows[0];

  // Deduplicate orders
  const orderMap = new Map();
  for (const row of allRows) {
    if (row.order_id && !orderMap.has(row.order_id)) {
      orderMap.set(row.order_id, {
        orderId: row.order_id,
        status: row.order_status,
        esimStatus: row.esim_status,
        selectNumberType: row.select_number_type,
        portinResponse: row.portin_response,
        createdAt: row.order_created_at,
        paymentCompleted: row.payment_completed_time,
        activationCompleted: row.activation_completed_time,
        orderCompleted: row.order_completed_time,
        numberSelectionCompleted: row.number_selection_completed_time,
        imeiCheckingCompleted: row.imei_checking_completed_time,
        petInsuranceCompleted: row.pet_insurance_completed_time,
        onboardingCompleted: row.onboarding_completed_time,
      });
    }
  }

  // Determine cohort: S100, FDT (deposit paid), or Regular
  const isTruthy = (v) => v === true || v === 'true' || v === '1' || v === 1;
  let cohort = 'Regular';
  if (isTruthy(first.is_s100_user)) {
    cohort = 'S100';
  } else if (first.deposit_payment_status && first.deposit_payment_status.toUpperCase() === 'COMPLETED') {
    cohort = 'FDT';
  }

  const result = {
    found: true,
    customer: {
      userId: first.user_id,
      email: first.customer_email,
      name: first.customer_name,
      phone: first.customer_phone,
      individualId: first.individual_id,
      stripeCustomerId: first.stripe_customer_id,
      cohort,
    },
    orders: Array.from(orderMap.values()),
    airvet: {
      activated: isTruthy(first.is_airvet_activated),
      activatedAt: first.airvet_activated_at,
    },
    individual: null,
    simProducts: null,
    esimProfile: null,
    portStatus: null,
    mochi: null,
  };

  // Step 2: Parallel — Boss API (individual, SIM) + Databricks (Mochi)
  const tasks = [];

  if (first.individual_id) {
    tasks.push(
      bossApi('get', `/individual/${first.individual_id}`)
        .then(d => { if (!d.error) result.individual = d; })
        .catch(() => {})
    );
    tasks.push(
      bossApi('get', `/individual/${first.individual_id}/simProducts`)
        .then(d => { if (!d.error) result.simProducts = d; })
        .catch(() => {})
    );
  }

  if (first.user_id) {
    tasks.push(
      databricksQuery(`
        SELECT conversation_id, title, message_count, created_at,
          get_json_object(metadata, '$.human_escalated') AS escalated,
          get_json_object(metadata, '$.main_category') AS category
        FROM \`rds-prod_catalog\`.cj_prod.conversations
        WHERE user_id = '${first.user_id.replace(/'/g, "''")}'
        ORDER BY created_at DESC LIMIT 5
      `).then(d => {
        if (!d.error && d.rows && d.rows.length > 0) {
          result.mochi = d.rows.map(row => {
            const o = {}; d.columns.forEach((c, i) => { o[c] = row[i]; }); return o;
          });
        }
      }).catch(() => {})
    );
  }

  await Promise.allSettled(tasks);

  // Step 3: Extract MSISDN and ICCID resource ID from individual's nested products
  const ind = result.individual;
  let msisdn = ind?.msisdn;
  let iccidResourceId = null;
  if (ind?.products) {
    for (const prod of ind.products) {
      if (prod.realizingResource) {
        for (const r of prod.realizingResource) {
          if (r.type === 'MSISDN' && r.value && !msisdn) msisdn = r.value;
          if (r.type === 'ICCID' && (r.id || r._id) && !iccidResourceId) iccidResourceId = r.id || r._id;
        }
      }
    }
  }

  // Step 4: Parallel — eSIM profile from Boss API + port-in status
  const step4Tasks = [];
  if (iccidResourceId) {
    step4Tasks.push(
      bossApi('get', `/esimprofile/${iccidResourceId}`)
        .then(d => { if (!d.error) result.esimProfile = d; })
        .catch(() => {})
    );
  }
  if (msisdn) {
    result.msisdn = msisdn;
    const hasPortIn = result.orders.some(o =>
      o.selectNumberType === 'PORTIN' ||
      (o.portinResponse && o.portinResponse.includes('PortInMSISDN'))
    );
    if (hasPortIn) {
      step4Tasks.push(
        bossApi('get', `/order/getportstatus/${msisdn}`)
          .then(d => { if (!d.error) result.portStatus = d; })
          .catch(() => {})
      );
    }
  }
  if (step4Tasks.length > 0) await Promise.allSettled(step4Tasks);

  console.log(`  ✓ Lookup: ${result.orders.length} order(s), individual: ${!!result.individual}, esim: ${!!result.esimProfile}, cohort: ${result.customer.cohort}, mochi: ${result.mochi?.length || 0}`);
  return result;
}

// ── POST /api/customer/lookup (Databricks + Boss API) ────────

app.post('/api/customer/lookup', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    const result = await performCustomerLookup(email);
    res.json(result);
  } catch (err) {
    console.error('Customer lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Agent Brief: synthesis helpers ────────────────────────────

function deriveSearchTopic(mochi, tickets) {
  // Pick best Help Center query from Mochi category or ticket subject
  if (mochi && mochi.length > 0) {
    const cat = mochi[0].category;
    if (cat && cat !== 'null') return cat.replace(/_/g, ' ');
  }
  if (tickets && tickets.length > 0) {
    const subj = tickets[0].subject;
    if (subj) return subj.replace(/\[.*?\]/g, '').trim().slice(0, 60);
  }
  return 'Meow Mobile help';
}

function buildPreviousContacts(tickets, mochi) {
  const contacts = [];
  if (tickets) {
    for (const t of tickets) {
      contacts.push({
        channel: 'Email',
        reason: t.subject || 'Support ticket',
        date: t.created_at,
        id: t.id,
        status: t.status,
      });
    }
  }
  if (mochi) {
    for (const m of mochi) {
      contacts.push({
        channel: 'Mochi',
        reason: m.title || m.category || 'Chat conversation',
        date: m.created_at,
        escalated: m.escalated === 'true',
        category: m.category,
      });
    }
  }
  // Sort newest first
  contacts.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });
  return contacts;
}

function identifyCurrentProblem(lookup) {
  if (!lookup || !lookup.found) return null;

  const orders = lookup.orders || [];
  const mochi = lookup.mochi || [];
  const esim = lookup.esimProfile;

  // eSIM ERROR/FAILED
  if (esim) {
    const st = String(esim.status || '').toUpperCase();
    if (st === 'ERROR' || st === 'FAILED') {
      return { problem: 'eSIM provisioning issue — profile status is ' + esim.status, confidence: 'high', type: 'esim' };
    }
  }

  // Order with eSIM error
  for (const o of orders) {
    const es = String(o.esimStatus || '').toUpperCase();
    if (es === 'ERROR' || es === 'FAILED') {
      return { problem: 'eSIM activation failed on order ' + o.orderId, confidence: 'high', type: 'esim' };
    }
  }

  // Port-in FAILED
  for (const o of orders) {
    if (o.portinResponse && o.portinResponse.includes('FAILED')) {
      return { problem: 'Port-in failed for order ' + o.orderId, confidence: 'high', type: 'portin' };
    }
  }
  if (lookup.portStatus) {
    const ps = String(lookup.portStatus.status || lookup.portStatus.portStatus || '').toUpperCase();
    if (ps.includes('FAIL') || ps.includes('REJECT')) {
      return { problem: 'Port-in failed — status: ' + (lookup.portStatus.status || lookup.portStatus.portStatus), confidence: 'high', type: 'portin' };
    }
  }

  // Mochi escalated
  if (mochi.length > 0 && mochi[0].escalated === 'true') {
    return { problem: 'Escalated from Mochi chatbot — ' + (mochi[0].title || mochi[0].category || 'unresolved issue'), confidence: 'high', type: 'mochi_escalation' };
  }

  // Order FAILED
  for (const o of orders) {
    if (String(o.status || '').toUpperCase() === 'FAILED') {
      return { problem: 'Order processing failure — order ' + o.orderId + ' is FAILED', confidence: 'high', type: 'order_failure' };
    }
  }

  // Payment not completed + order exists
  if (orders.length > 0 && !orders[0].paymentCompleted) {
    const st = String(orders[0].status || '').toUpperCase();
    if (st !== 'COMPLETED' && st !== 'DONE') {
      return { problem: 'Payment not completed for latest order', confidence: 'medium', type: 'payment' };
    }
  }

  return null; // No clear pattern
}

function extractInfoFromComments(commentArrays) {
  const info = {};
  const allText = [];
  for (const comments of commentArrays) {
    if (Array.isArray(comments)) {
      for (const c of comments) {
        if (c.body) allText.push(c.body);
      }
    }
  }
  const text = allText.join('\n');

  // Device
  const deviceMatch = text.match(/\b(iPhone\s*\d{1,2}(?:\s*Pro(?:\s*Max)?)?|Samsung\s+Galaxy\s+\S+|Google\s+Pixel\s+\S+|iPad\s*(?:Pro|Air|Mini)?)/i);
  if (deviceMatch) info.Device = deviceMatch[0];
  else if (/android/i.test(text) && !/iphone|ipad/i.test(text)) info.Device = 'Android device';
  else if (/iphone/i.test(text)) info.Device = 'iPhone';

  // Browser
  const browserMatch = text.match(/\b(Chrome|Safari|Firefox|Edge|Opera)\b/i);
  if (browserMatch) info.Browser = browserMatch[0];

  // OS Version
  const iosMatch = text.match(/iOS\s*([\d.]+)/i);
  if (iosMatch) info['OS Version'] = 'iOS ' + iosMatch[1];
  const androidMatch = text.match(/Android\s*([\d.]+)/i);
  if (androidMatch) info['OS Version'] = 'Android ' + androidMatch[1];

  // Error messages
  const errorMatch = text.match(/(?:error|failed|failure)[:\s]+(.{10,80})/i);
  if (errorMatch) info['Error Message'] = errorMatch[1].trim();

  return info;
}

function buildEmailDraft(problemType, stepType, stepText, customerName) {
  const name = customerName || 'there';
  const greeting = `Hi ${name},\n\n`;
  const signoff = '\n\nIf you have any questions, just reply to this email.\n\nBest,\nMeow Mobile Support';

  const templates = {
    'esim:customer_action': `${greeting}We noticed your eSIM may need to be set up manually. Here's how:\n\n1. Go to Settings > Cellular > Add eSIM\n2. Select "Enter Details Manually"\n3. Enter the activation details from your confirmation email\n4. Restart your device after setup\n\nIf you need help finding your activation details, just let us know!${signoff}`,
    'esim:ask_info': `${greeting}To help resolve your eSIM issue, could you please reply with:\n\n- Your device model (e.g., iPhone 15, Samsung Galaxy S24)\n- Whether you tried scanning the QR code or entering details manually\n- Any error messages you saw\n\nThis will help us get things sorted quickly.${signoff}`,
    'payment:customer_action': `${greeting}It looks like your recent payment didn't go through. Here are a few things to try:\n\n1. Double-check your card details are up to date\n2. Try a different payment method\n3. Make sure your bank isn't blocking the transaction\n\nYou can retry your payment in the Meow Mobile app or on our website.${signoff}`,
    'portin:ask_info': `${greeting}To complete your number transfer, we need to verify a few details. Could you please confirm:\n\n- Your account number with your previous carrier\n- Your account PIN or password\n- The billing name on your previous account\n\nYou can usually find these in your old carrier's app or by calling them.${signoff}`,
    'portin:customer_action': `${greeting}Your number transfer needs a small update. Please contact your previous carrier and:\n\n1. Confirm your account number and PIN are correct\n2. Make sure your account is active (not suspended)\n3. Remove any port-out blocks on your line\n\nOnce that's done, let us know and we'll retry the transfer right away.${signoff}`,
    'mochi_escalation:customer_action': `${greeting}Thank you for your patience — I've reviewed your conversation with our chatbot and I'm here to personally help resolve this.\n\nI'm looking into your issue now and will follow up shortly with next steps.${signoff}`,
  };

  const key = `${problemType}:${stepType}`;
  if (templates[key]) return templates[key];

  // Generic fallback
  return `${greeting}${stepText}\n\nPlease let us know if you need any help with this.${signoff}`;
}

function buildNextSteps(problem, kbArticles, lookup, customerName) {
  const steps = [];
  if (!problem) {
    // Auto-resolve: show customer summary instead of generic investigate step
    const orderCount = (lookup && lookup.orders) ? lookup.orders.length : 0;
    const contactCount = (lookup && lookup.mochi) ? lookup.mochi.length : 0;
    const latestStatus = orderCount > 0 ? lookup.orders[0].status : 'none';
    steps.push({
      type: 'ai_done',
      text: 'Customer History',
      result: orderCount + ' order(s), ' + contactCount + ' Mochi chat(s), latest order: ' + (latestStatus || 'N/A'),
      status: orderCount > 0 ? 'info' : 'info',
    });
    if (kbArticles && kbArticles.length > 0) {
      steps.push({ type: 'kb_article', text: 'Relevant: ' + kbArticles[0].title, url: kbArticles[0].html_url });
    }
    return steps;
  }

  switch (problem.type) {
    case 'esim': {
      // Auto-resolve: show actual eSIM status from lookup
      const esimOrder = (lookup && lookup.orders) ? lookup.orders[0] : null;
      const esimStatus = esimOrder ? esimOrder.esimStatus : null;
      const simInfo = lookup && lookup.simProducts;
      let esimResult = esimStatus ? ('eSIM status: ' + esimStatus) : 'eSIM status unknown';
      if (simInfo) {
        const items = Array.isArray(simInfo) ? simInfo : (simInfo.content || [simInfo]);
        const first = items[0];
        if (first && first.status) esimResult += ' — SIM product: ' + first.status;
      }
      const esimOk = esimStatus && ['INSTALLED', 'ACTIVE', 'RELEASED'].includes(String(esimStatus).toUpperCase());
      steps.push({ type: 'ai_done', text: 'eSIM Profile Status', result: esimResult, status: esimOk ? 'ok' : 'issue' });
      steps.push({ type: 'ask_info', text: 'Ask customer for device model and whether they scanned the QR code', sla: { minutes: 15, label: 'Within 15 min' } });
      steps.push({ type: 'customer_action', text: 'Guide customer through manual eSIM installation if QR failed', sla: { minutes: 30, label: 'Within 30 min' } });
      break;
    }
    case 'payment': {
      // Auto-resolve: show payment status from lookup
      const payOrder = (lookup && lookup.orders) ? lookup.orders[0] : null;
      const payDone = payOrder ? payOrder.paymentCompleted : null;
      const payResult = payDone ? ('Payment completed at ' + payDone) : 'Payment NOT completed';
      steps.push({ type: 'ai_done', text: 'Payment Status', result: payResult, status: payDone ? 'ok' : 'issue' });
      steps.push({ type: 'customer_action', text: 'Suggest customer retry with a different payment method', sla: { minutes: 30, label: 'Within 30 min' } });
      break;
    }
    case 'portin': {
      // Auto-resolve: show port status from lookup
      const portData = lookup ? lookup.portStatus : null;
      let portResult = 'Port status unavailable';
      let portOk = 'info';
      if (portData) {
        const ps = portData.status || portData.portStatus || 'unknown';
        portResult = 'Port-in status: ' + ps;
        const upper = String(ps).toUpperCase();
        if (upper.includes('COMPLETE') || upper.includes('SUCCESS')) portOk = 'ok';
        else if (upper.includes('FAIL') || upper.includes('REJECT')) portOk = 'issue';
      }
      steps.push({ type: 'ai_done', text: 'Port-in Status', result: portResult, status: portOk });
      steps.push({ type: 'ask_info', text: 'Confirm account number and PIN with the customer', sla: { minutes: 15, label: 'Within 15 min' } });
      steps.push({ type: 'customer_action', text: 'If rejected, ask customer to contact previous carrier for correct details', sla: { minutes: 30, label: 'Within 30 min' } });
      break;
    }
    case 'mochi_escalation': {
      // Auto-resolve: show Mochi conversation details from lookup
      const mochiData = (lookup && lookup.mochi) ? lookup.mochi[0] : null;
      let mochiResult = 'No Mochi data available';
      if (mochiData) {
        mochiResult = (mochiData.category || 'Unknown category') + ' — ' + (mochiData.title || 'No title');
        if (mochiData.escalated === 'true') mochiResult += ' (escalated)';
      }
      steps.push({ type: 'ai_done', text: 'Mochi Conversation', result: mochiResult, status: 'info' });
      steps.push({ type: 'customer_action', text: 'Address the specific issue the chatbot could not resolve', sla: { minutes: 30, label: 'Within 30 min' } });
      break;
    }
    case 'order_failure': {
      // Auto-resolve: show order status and error info from lookup
      const failedOrder = (lookup && lookup.orders) ? lookup.orders.find(o => String(o.status || '').toUpperCase() === 'FAILED') || lookup.orders[0] : null;
      let orderResult = 'No order data available';
      if (failedOrder) {
        orderResult = 'Order ' + String(failedOrder.orderId).slice(0, 12) + '... — Status: ' + (failedOrder.status || 'unknown');
        if (failedOrder.esimStatus) orderResult += ', eSIM: ' + failedOrder.esimStatus;
        if (failedOrder.portinResponse && failedOrder.portinResponse.includes('FAILED')) orderResult += ', Port-in: FAILED';
      }
      steps.push({ type: 'ai_done', text: 'Order Status', result: orderResult, status: 'issue' });
      steps.push({ type: 'ai_done', text: 'Execution Timeline', result: failedOrder ? ('Created: ' + (failedOrder.createdAt || 'unknown') + ', Payment: ' + (failedOrder.paymentCompleted || 'not completed')) : 'No timeline data', status: 'info' });
      break;
    }
    default: {
      // Auto-resolve: show general customer summary
      const defOrders = (lookup && lookup.orders) ? lookup.orders.length : 0;
      const defMochi = (lookup && lookup.mochi) ? lookup.mochi.length : 0;
      steps.push({ type: 'ai_done', text: 'Customer Summary', result: defOrders + ' order(s), ' + defMochi + ' Mochi chat(s)', status: 'info' });
    }
  }

  // Append KB articles
  if (kbArticles && kbArticles.length > 0) {
    for (const a of kbArticles.slice(0, 2)) {
      steps.push({ type: 'kb_article', text: a.title, url: a.html_url });
    }
  }

  // Attach email drafts to customer-facing steps
  for (const step of steps) {
    if (step.type === 'customer_action' || step.type === 'ask_info') {
      step.emailDraft = buildEmailDraft(problem.type, step.type, step.text, customerName);
    }
  }

  return steps;
}

function buildTimeline(lookup, payments, tickets, mochi) {
  const events = [];

  // Onboarding milestones from the most recent order
  if (lookup && lookup.orders && lookup.orders.length > 0) {
    const o = lookup.orders[0];
    if (o.createdAt) events.push({ type: 'order', label: 'Order created', date: o.createdAt, status: o.status });
    if (o.paymentCompleted) events.push({ type: 'onboarding', label: 'Payment completed', date: o.paymentCompleted });
    if (o.numberSelectionCompleted) events.push({ type: 'onboarding', label: 'Number selected', date: o.numberSelectionCompleted });
    if (o.imeiCheckingCompleted) events.push({ type: 'onboarding', label: 'IMEI checked', date: o.imeiCheckingCompleted });
    if (o.activationCompleted) events.push({ type: 'onboarding', label: 'eSIM activated', date: o.activationCompleted });
    if (o.petInsuranceCompleted) events.push({ type: 'onboarding', label: 'Pet insurance step', date: o.petInsuranceCompleted });
    if (o.onboardingCompleted) events.push({ type: 'onboarding', label: 'Onboarding completed', date: o.onboardingCompleted });
  }

  // Payment attempts
  if (payments && Array.isArray(payments)) {
    for (const p of payments.slice(0, 10)) {
      const label = 'Payment: ' + (p.name || p.status || 'attempt');
      events.push({ type: 'payment', label, date: p.payment_date || p.paymentDate || p.created_at, status: p.status });
    }
  }

  // Mochi conversations
  if (mochi) {
    for (const m of mochi) {
      events.push({
        type: 'mochi',
        label: 'Mochi: ' + (m.category || m.title || 'conversation'),
        date: m.created_at,
        escalated: m.escalated === 'true',
      });
    }
  }

  // Zendesk tickets
  if (tickets && tickets.tickets) {
    for (const t of tickets.tickets) {
      events.push({
        type: 'zendesk',
        label: 'Ticket: ' + (t.subject || '#' + t.id),
        date: t.created_at,
        status: t.status,
      });
    }
  }

  // Sort newest first
  events.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  return events;
}

// ── Timer computation ────────────────────────────────────────

function computeTimers(lookup, previousContacts, zendeskTickets) {
  const timers = {};

  // 1. Onboarding stall timer
  if (lookup && lookup.orders && lookup.orders.length > 0) {
    const o = lookup.orders[0];
    const steps = [
      { name: 'Order', date: o.createdAt },
      { name: 'Payment', date: o.paymentCompleted },
      { name: 'Number selection', date: o.numberSelectionCompleted },
      { name: 'IMEI check', date: o.imeiCheckingCompleted },
      { name: 'eSIM activation', date: o.activationCompleted },
      { name: 'Pet insurance', date: o.petInsuranceCompleted },
      { name: 'Onboarding', date: o.onboardingCompleted },
    ];

    let lastCompleted = null;
    let nextPending = null;
    for (const step of steps) {
      if (step.date) {
        lastCompleted = step;
      } else if (!nextPending) {
        nextPending = step;
      }
    }

    if (lastCompleted && nextPending) {
      timers.onboarding = {
        label: nextPending.name + ' incomplete',
        since: lastCompleted.date,
        lastStep: lastCompleted.name,
      };
    } else if (lastCompleted && !nextPending) {
      timers.onboarding = {
        label: 'Onboarding complete',
        since: lastCompleted.date,
        complete: true,
      };
    }
  }

  // 2. Last correspondence timer
  if (previousContacts && previousContacts.length > 0) {
    const latest = previousContacts[0];
    timers.lastContact = {
      label: 'Last ' + latest.channel + ' contact',
      since: latest.date,
      channel: latest.channel,
    };
  }

  // 3. Ticket age timer — oldest open ticket
  if (zendeskTickets && zendeskTickets.length > 0) {
    const openTickets = zendeskTickets.filter(t =>
      t.status === 'open' || t.status === 'pending' || t.status === 'new'
    );
    if (openTickets.length > 0) {
      const oldest = openTickets[openTickets.length - 1];
      timers.ticketAge = {
        label: 'Ticket #' + oldest.id + ' open',
        since: oldest.created_at,
        status: oldest.status,
        ticketId: oldest.id,
      };
    }
  }

  return timers;
}

// ── POST /api/customer/agent-brief ───────────────────────────

app.post('/api/customer/agent-brief', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  console.log(`  → Agent brief: ${email}`);

  try {
    // Phase 1: parallel — customer lookup + Zendesk tickets
    const [lookup, zendeskResult] = await Promise.all([
      performCustomerLookup(email),
      zendeskSearch(`type:ticket requester:${email}`),
    ]);

    if (!lookup.found) {
      return res.json({ found: false });
    }

    // Phase 2: parallel — ticket comments (top 3) + Help Center search + Boss API payments
    const searchTopic = deriveSearchTopic(lookup.mochi, zendeskResult.tickets);
    const ticketIds = (zendeskResult.tickets || []).slice(0, 3).map(t => t.id);

    const phase2 = [];
    const commentArrays = [];
    for (const tid of ticketIds) {
      phase2.push(
        zendeskTicketComments(tid)
          .then(c => { if (!c.error) commentArrays.push(c); })
          .catch(() => {})
      );
    }

    let kbArticles = [];
    phase2.push(
      zendeskHelpCenterSearch(searchTopic)
        .then(a => { if (!a.error) kbArticles = a; })
        .catch(() => {})
    );

    let payments = null;
    if (lookup.customer.userId) {
      phase2.push(
        bossApi('get', '/payment', { customerId: lookup.customer.userId })
          .then(d => { if (!d.error) payments = d; })
          .catch(() => {})
      );
    }

    await Promise.allSettled(phase2);

    // Phase 3: synthesis (rule-based)
    const previousContacts = buildPreviousContacts(zendeskResult.tickets, lookup.mochi);
    let currentProblem = identifyCurrentProblem(lookup);
    const infoCollected = extractInfoFromComments(commentArrays);
    const timeline = buildTimeline(lookup, payments, zendeskResult, lookup.mochi);

    // Phase 4: Claude AI fallback if no clear problem
    if (!currentProblem && anthropic) {
      try {
        const contextSummary = [];
        if (lookup.orders.length > 0) contextSummary.push(`Latest order: ${lookup.orders[0].status}`);
        if (lookup.esimProfile) contextSummary.push(`eSIM: ${lookup.esimProfile.status}`);
        if (lookup.mochi && lookup.mochi.length > 0) contextSummary.push(`Last Mochi: ${lookup.mochi[0].title || lookup.mochi[0].category}`);
        if (zendeskResult.tickets && zendeskResult.tickets.length > 0) contextSummary.push(`Last ticket: ${zendeskResult.tickets[0].subject}`);

        const aiResp = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `A customer (${email}) is contacting support. Based on this data, what is likely their problem in one sentence?\n\n${contextSummary.join('\n')}\n\nRespond with ONLY the problem statement, nothing else.`,
          }],
        });

        const aiText = (aiResp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        if (aiText) {
          currentProblem = { problem: aiText.trim(), confidence: 'ai', type: 'ai_synthesized' };
        }
      } catch (e) {
        console.warn('  ⚠ AI fallback failed:', e.message);
      }
    }

    const customerName = lookup.customer.name ? lookup.customer.name.split(' ')[0] : null;
    const nextSteps = buildNextSteps(currentProblem, kbArticles, lookup, customerName);

    // Skill-based troubleshooting guidance
    let skillGuidance = [];
    if (skillsAvailable()) {
      try {
        skillGuidance = getSkillGuidance(currentProblem, lookup);
      } catch (e) {
        console.warn('  ⚠ Skill guidance failed:', e.message);
      }
    }

    // Compute elapsed-time timers
    const timers = computeTimers(lookup, previousContacts, zendeskResult.tickets);

    res.json({
      found: true,
      customerName,
      timers,
      previousContacts,
      currentProblem,
      infoCollected,
      nextSteps,
      skillGuidance,
      timeline,
      kbArticles,
    });
  } catch (err) {
    console.error('Agent brief error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/health ──────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    claude: !!process.env.ANTHROPIC_API_KEY,
    databricks: !!DATABRICKS_TOKEN,
    zendesk: !!ZENDESK_SUBDOMAIN,
    bossApi: !!BOSS_API_URL,
  });
});

// ── GET /api/network-outages ─────────────────────────────────

app.get('/api/network-outages', async (req, res) => {
  const { zip } = req.query;
  if (!zip) return res.status(400).json({ error: 'zip required' });

  try {
    const result = await bossApi('get', '/networkOutages', { zip });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Catch-all → serve index.html ─────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║   Zendesk Customer Intelligence — Running     ║');
  console.log(`  ║   http://localhost:${PORT}                       ║`);
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Claude API:    ${process.env.ANTHROPIC_API_KEY ? '✓ configured' : '○ not set — paste key in .env for AI mode'}`);
  console.log(`  Boss API:      ✓ ${BOSS_API_URL}`);
  console.log(`  Databricks:    ${DATABRICKS_TOKEN ? '✓ configured' : '○ not configured'}`);
  console.log(`  Zendesk:       ${ZENDESK_SUBDOMAIN ? '✓ configured' : '○ not configured'}`);
  console.log(`  Mode:          ${process.env.ANTHROPIC_API_KEY ? 'Claude AI (natural language)' : 'Direct (pattern matching)'}`);
  console.log('');
});
