const { bossApi } = require('./lib/boss-api');
const { databricksQuery } = require('./lib/databricks');
const { zendeskSearch } = require('./lib/zendesk-api');

// ── Claude tool definitions (aligned with MCP schemas) ──────

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

module.exports = { TOOLS, executeTool };
