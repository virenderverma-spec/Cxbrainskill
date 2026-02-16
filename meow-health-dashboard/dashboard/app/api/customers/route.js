import { NextResponse } from 'next/server';

// --- Zendesk API ---
const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;
const ZENDESK_AUTH = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64');

// Batch-lookup Zendesk user IDs by requester_ids (up to 100 per call)
async function lookupZendeskUsers(requesterIds) {
  if (!requesterIds.length || !ZENDESK_SUBDOMAIN) return {};
  const emailByRequesterId = {};
  // show_many supports up to 100 IDs per call
  for (let i = 0; i < requesterIds.length; i += 100) {
    const batch = requesterIds.slice(i, i + 100);
    try {
      const res = await fetch(
        `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/users/show_many.json?ids=${batch.join(',')}`,
        { headers: { 'Authorization': `Basic ${ZENDESK_AUTH}` }, cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        for (const user of (data.users || [])) {
          if (user.email) {
            emailByRequesterId[user.id] = user.email.toLowerCase();
          }
        }
      }
    } catch (err) {
      console.error('Zendesk user lookup error:', err.message);
    }
  }
  return emailByRequesterId;
}

// --- Databricks SQL Statement API ---
const DATABRICKS_HOST = process.env.DATABRICKS_HOST;
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN;
const DATABRICKS_WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID;

async function runSQL(sql) {
  const res = await fetch(`${DATABRICKS_HOST}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DATABRICKS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      warehouse_id: DATABRICKS_WAREHOUSE_ID,
      statement: sql,
      wait_timeout: '30s',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Databricks API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  // Handle async execution — poll if needed
  if (data.status?.state === 'PENDING' || data.status?.state === 'RUNNING') {
    return pollStatement(data.statement_id);
  }

  if (data.status?.state === 'FAILED') {
    throw new Error(`SQL failed: ${data.status.error?.message || 'Unknown error'}`);
  }

  return parseResult(data);
}

async function pollStatement(statementId) {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(`${DATABRICKS_HOST}/api/2.0/sql/statements/${statementId}`, {
      headers: { 'Authorization': `Bearer ${DATABRICKS_TOKEN}` },
    });
    const data = await res.json();
    if (data.status?.state === 'SUCCEEDED') return parseResult(data);
    if (data.status?.state === 'FAILED') {
      throw new Error(`SQL failed: ${data.status.error?.message || 'Unknown'}`);
    }
  }
  throw new Error('SQL query timed out after 30s of polling');
}

function parseResult(data) {
  const columns = data.manifest?.schema?.columns || [];
  const rows = data.result?.data_array || [];
  const colNames = columns.map(c => c.name);

  return rows.map(row => {
    const obj = {};
    // HTTP API returns flat arrays: ["val1", "val2", ...]
    // MCP returns: {values: [{string_value: "val1"}, ...]}
    if (Array.isArray(row)) {
      colNames.forEach((name, i) => {
        obj[name] = row[i] ?? null;
      });
    } else {
      const values = row.values || [];
      colNames.forEach((name, i) => {
        const cell = values[i];
        if (!cell || cell.null_value === 'NULL_VALUE') {
          obj[name] = null;
        } else {
          obj[name] = cell.string_value ?? cell;
        }
      });
    }
    return obj;
  });
}

// --- SQL Queries ---

const STUCK_CUSTOMERS_SQL = `
SELECT
  c.user_id,
  c.individual_id,
  c.customer_id,
  TRIM(CONCAT(COALESCE(c.given_name, ''), ' ', COALESCE(c.family_name, ''))) as name,
  c.phone_number,
  c.stripe_email as email,
  c.onboarding_status,
  c.telco_customer_status,
  c.onboarding_order_completed_at,
  c.onboarding_payment_completed_at,
  c.onboarding_number_selection_completed_at,
  c.onboarding_activation_completed_at,
  c.onboarding_pet_insurance_completed_at,
  c.onboarding_completed_at,
  c.latest_order_id,
  c.latest_order_status,
  c.latest_order_esim_status,
  c.latest_order_portin_status,
  c.latest_esim_status,
  c.is_airvet_activated,
  c.airvet_activated_at,
  c.certification_created_at,
  c.latest_order_created_at,
  c.city,
  c.state as region,
  c.is_s100_user,
  c.cat_count,
  -- MSISDN and IMEI from fact_order
  fo.msisdn,
  fo.imei,
  -- Determine stuck stage from onboarding_status
  CASE
    WHEN c.onboarding_status = 'COMPLETED' THEN 'completed'
    WHEN c.onboarding_status = 'FILLING_PET_INSURANCE' THEN 'airvet_account'
    WHEN c.onboarding_status = 'ACTIVATING' THEN 'esim_activation'
    WHEN c.onboarding_status = 'IMEI_CHECKING' THEN 'esim_activation'
    WHEN c.onboarding_status = 'SELECTING_NUMBER' THEN 'number_selection'
    WHEN c.onboarding_status = 'PAYING' THEN 'payment'
    WHEN c.onboarding_status = 'ORDERING' THEN 'order_created'
    ELSE 'order_created'
  END as stuck_stage,
  -- Calculate hours stuck at current stage
  ROUND(CAST(
    (UNIX_TIMESTAMP(CURRENT_TIMESTAMP()) - UNIX_TIMESTAMP(
      COALESCE(
        CASE
          WHEN c.onboarding_status = 'FILLING_PET_INSURANCE' THEN c.onboarding_activation_completed_at
          WHEN c.onboarding_status IN ('ACTIVATING', 'IMEI_CHECKING') THEN c.onboarding_number_selection_completed_at
          WHEN c.onboarding_status = 'SELECTING_NUMBER' THEN c.onboarding_payment_completed_at
          WHEN c.onboarding_status = 'PAYING' THEN c.onboarding_order_completed_at
          ELSE c.certification_created_at
        END,
        c.certification_created_at
      )
    )) / 3600.0
  AS DOUBLE), 1) as stuck_hours,
  -- Issue tags based on data
  CASE WHEN c.latest_order_esim_status = 'ERROR' THEN true ELSE false END as esim_error,
  CASE WHEN c.latest_order_portin_status IN ('CONFLICT', 'REVIEWING') THEN true ELSE false END as portin_stuck,
  CASE WHEN c.latest_order_portin_status = 'CONFLICT' THEN true ELSE false END as portin_conflict
FROM prod_catalog.silver.customer_360 c
LEFT JOIN prod_catalog.silver.fact_order fo
  ON c.latest_order_id = fo.order_id
WHERE (c.onboarding_status IS NULL OR c.onboarding_status != 'COMPLETED')
  AND c.certification_created_at >= DATE_SUB(CURRENT_DATE(), 90)
  AND c.latest_order_status IS NOT NULL
  AND c.latest_order_status NOT IN ('CANCELLED', 'PENDINGCANCELLATION')
  AND NOT (c.latest_order_status = 'DRAFT' AND c.onboarding_payment_completed_at IS NULL)
  AND NOT (c.latest_order_status = 'COMPLETED' AND c.telco_customer_status = 'Activated' AND c.onboarding_status != 'FILLING_PET_INSURANCE')
ORDER BY stuck_hours DESC NULLS LAST
LIMIT 500
`;

const ZENDESK_TICKETS_SQL = `
SELECT
  t.id as ticket_id,
  t.subject,
  t.status,
  t.priority,
  t.tags,
  t.created_at,
  t.updated_at,
  t.requester_id,
  t.assignee_id,
  t.group_id
FROM prod_catalog.customer_support.zendesk_tickets t
WHERE t.tags NOT LIKE '%pagerduty%'
  AND t.tags NOT LIKE '%sla_alert%'
  AND t.tags NOT LIKE '%slo%'
  AND t.tags NOT LIKE '%rca-auto%'
  AND t.tags NOT LIKE '%non_user%'
  AND t.created_at >= DATE_SUB(CURRENT_TIMESTAMP(), 90)
ORDER BY t.created_at DESC
LIMIT 500
`;

// --- Tag Parsing ---

function parseTags(tagsStr) {
  if (!tagsStr) return [];
  try {
    return JSON.parse(tagsStr);
  } catch {
    return [];
  }
}

function extractFromTags(tags) {
  let inquiryType = null;
  let intent = null;
  let sentiment = null;
  let language = null;

  for (const tag of tags) {
    if (tag.startsWith('inquiry____')) inquiryType = tag;
    else if (tag.startsWith('issue____')) inquiryType = inquiryType || tag;
    else if (tag.startsWith('request____')) inquiryType = inquiryType || tag;
    else if (tag.startsWith('intent__') && !tag.startsWith('intent_confidence')) intent = tag;
    else if (tag.startsWith('sentiment__') && !tag.startsWith('sentiment_confidence')) sentiment = tag;
    else if (tag.startsWith('language__') && !tag.startsWith('language_confidence')) language = tag;
  }

  return { inquiryType, intent, sentiment, language };
}

function formatInquiryType(value) {
  if (!value) return null;
  return value
    .replace(/____/g, ' > ')
    .replace(/___/g, ' > ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Classify inquiry/intent to signal code ---

const INQUIRY_SIGNAL_MAP = {
  'inquiry____sign_up': 'JOU', 'inquiry____waitlist': 'JOU', 'inquiry____promotions': 'JOU',
  'request____waitlist': 'JOU', 'issue____account': 'JOU', 'inquiry____account': 'JOU',
  'request____data': 'JOU', 'issue____meow_app': 'JOU', 'inquiry____non_responsive': 'JOU',
  'issue____esim': 'ESI', 'request____esim': 'ESI', 'inquiry____esim': 'ESI',
  'issue____network': 'ESI', 'inquiry____network': 'ESI', 'inquiry____roaming': 'ESI',
  'inquiry____plans': 'ESI',
  'inquiry____airvet': 'AIR', 'issue____airvet': 'AIR',
  'inquiry____payment': 'BIL', 'issue____payment': 'BIL', 'request____payment': 'BIL',
  'inquiry____portin': 'MNP', 'issue____portin': 'MNP', 'inquiry____number_selection': 'MNP',
  'inquiry____termination': 'BIL',
  'issue____referral': 'JOU', 'request____referral': 'JOU', 'inquiry____referral': 'JOU',
  'inquiry___voicemail': 'ESI', 'request___voicemail': 'ESI', 'issue____voicemail': 'ESI',
  'inquiry____suspension': 'BIL',
};

function classifyTicketSignal(inquiryType, intent, subject) {
  // 1. Inquiry type
  if (inquiryType) {
    const prefixes = Object.keys(INQUIRY_SIGNAL_MAP).sort((a, b) => b.length - a.length);
    for (const prefix of prefixes) {
      if (inquiryType.startsWith(prefix)) return INQUIRY_SIGNAL_MAP[prefix];
    }
  }
  // 2. Intent
  if (intent) {
    if (intent.includes('billing')) return 'BIL';
    if (intent.includes('software__connection') || intent.includes('service')) return 'ESI';
    if (intent.includes('account__activation') || intent.includes('order')) return 'JOU';
    if (intent.includes('software__login') || intent.includes('software__issue')) return 'JOU';
  }
  // 3. Subject keywords
  if (subject) {
    const sub = subject.toLowerCase();
    if (sub.includes('esim') || sub.includes('no service') || sub.includes('network')) return 'ESI';
    if (sub.includes('airvet') || sub.includes('vet care')) return 'AIR';
    if (sub.includes('refund') || sub.includes('charge') || sub.includes('payment')) return 'BIL';
    if (sub.includes('port') || sub.includes('mnp')) return 'MNP';
    if (sub.includes('activation') || sub.includes('setup')) return 'JOU';
  }
  return null;
}

// --- Journey stage mapping ---

const JOURNEY_STAGES = [
  { id: 'order_created', label: 'Order Created', order: 1 },
  { id: 'payment', label: 'Payment', order: 2 },
  { id: 'number_selection', label: 'Number Selection', order: 3 },
  { id: 'esim_activation', label: 'eSIM Activation', order: 4 },
  { id: 'nw_enabled', label: 'NW Enabled', order: 5 },
  { id: 'airvet_account', label: 'Airvet Account', order: 6 },
];

// --- Health scoring ---

function computeHealthScore(customer, tickets) {
  let score = 100;
  const stuckHours = customer.stuck_hours || 0;

  // Stuck duration penalty — inverted-U: recently stuck is most urgent,
  // very long stuck (>30 days) are likely abandoned and less urgent
  if (stuckHours > 720) score -= 15;        // > 30 days: probably abandoned
  else if (stuckHours > 336) score -= 25;   // 14-30 days: at risk
  else if (stuckHours > 168) score -= 35;   // 7-14 days: most urgent
  else if (stuckHours > 72) score -= 30;    // 3-7 days: high urgency
  else if (stuckHours > 48) score -= 25;    // 2-3 days: needs attention
  else if (stuckHours > 24) score -= 20;    // 1-2 days: moderate
  else if (stuckHours > 8) score -= 10;     // 8-24 hours: early

  // Technical blocker penalties — skip for completed orders (number is activated)
  const orderCompleted = customer.latest_order_status === 'COMPLETED';
  if (!orderCompleted) {
    if (customer.esim_error) score -= 25;     // eSIM ERROR
    if (customer.portin_stuck) score -= 15;   // Port-in stuck
    if (customer.portin_conflict) score -= 15; // Port-in conflict (additional)
    const esimStatus = customer.latest_order_esim_status;
    if (esimStatus === 'FAILED') score -= 20; // eSIM FAILED
  }

  // Stage position penalty (later stages = worse, more invested customer)
  const stageOrder = JOURNEY_STAGES.find(s => s.id === customer.stuck_stage)?.order || 1;
  if (stageOrder <= 1) score -= 5;         // stuck at order creation
  else if (stageOrder <= 2) score -= 8;    // stuck at payment
  else if (stageOrder >= 3) score -= 10;   // stuck at number selection or beyond

  // NULL onboarding status = no progress at all
  if (!customer.onboarding_status) score -= 12;

  // Ticket-based penalties
  if (tickets.length >= 5) score -= 20;
  else if (tickets.length >= 3) score -= 15;
  else if (tickets.length >= 2) score -= 10;
  else if (tickets.length >= 1) score -= 5;

  // Negative sentiment from tickets
  const negativeCount = tickets.filter(t =>
    t.sentiment === 'sentiment__very_negative' || t.sentiment === 'sentiment__negative'
  ).length;
  if (negativeCount >= 2) score -= 15;
  else if (negativeCount >= 1) score -= 10;

  // Urgent ticket
  if (tickets.some(t => t.priority === 'urgent')) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function categorize(score) {
  if (score <= 25) return 'critical';
  if (score <= 45) return 'high';
  if (score <= 65) return 'medium';
  if (score <= 80) return 'low';
  return 'healthy';
}

function computeSlaStatus(stuckHours, healthScore, tickets) {
  const hasUrgent = tickets.some(t => t.priority === 'urgent');
  if (healthScore <= 25 || hasUrgent) return 'breached';
  if (healthScore <= 45) return 'critical';
  if (healthScore <= 65) return 'warning';
  return 'ok';
}

function deriveIssueTags(customer, tickets) {
  const tags = new Set();

  const orderCompleted = customer.latest_order_status === 'COMPLETED';

  // From Databricks data (ground truth) — skip eSIM/MNP tags if order is completed (number is activated)
  if (!orderCompleted) {
    if (customer.esim_error) tags.add('eSIM Failed');
    if (customer.portin_stuck) tags.add('MNP Stuck');
    if (customer.portin_conflict) tags.add('MNP Conflict');
    if (customer.stuck_stage === 'payment') tags.add('Payment Stuck');
  }

  // Airvet-specific tag for completed orders stuck at pet insurance
  if (orderCompleted && customer.stuck_stage === 'airvet_account') {
    tags.add('Airvet Pending');
  }

  // From ticket analysis
  for (const t of tickets) {
    if (t.sentiment === 'sentiment__very_negative') tags.add('Unhappy');
    else if (t.sentiment === 'sentiment__negative') tags.add('Frustrated');

    const sub = (t.subject || '').toLowerCase();
    if (sub.includes('refund')) tags.add('Refund Pending');
    if (sub.includes('double charge') || sub.includes('duplicate')) tags.add('Double Charged');
    if (!orderCompleted && (sub.includes('no service') || sub.includes('no signal'))) tags.add('No Network');
    if (sub.includes('login') || sub.includes('unable to login')) tags.add('Login Issue');
    if (sub.includes('cancel') || sub.includes('churn') || sub.includes('termination')) tags.add('Churn Risk');
  }

  // Silent stuck customers (no tickets) — not applicable for completed orders with Airvet issue
  if (!orderCompleted && tickets.length === 0 && customer.stuck_hours > 48) tags.add('Silent Stuck');
  if (!orderCompleted && tickets.length === 0 && customer.stuck_hours > 168) tags.add('Churn Risk');

  return [...tags];
}

function getRecommendedAction(customer, tickets) {
  const stuckHours = customer.stuck_hours || 0;
  const prefix = stuckHours > 168 ? 'CRITICAL: ' : stuckHours > 72 ? 'URGENT: ' : '';

  if (customer.esim_error) {
    return `${prefix}eSIM provisioning failed. Re-send eSIM QR code or trigger SIM swap. Customer stuck for ${Math.round(stuckHours)}h.`;
  }
  if (customer.portin_conflict) {
    return `${prefix}Port-in has conflicts. Check with clearinghouse and verify account details with losing carrier.`;
  }
  if (customer.portin_stuck) {
    return `${prefix}Port-in under review. Follow up with ConnectX if stuck >24h.`;
  }

  switch (customer.stuck_stage) {
    case 'order_created':
      return `${prefix}Customer stuck at order creation for ${Math.round(stuckHours)}h. Verify order status and eligibility.`;
    case 'payment':
      return `${prefix}Payment not completed. Check payment method validity and retry.`;
    case 'number_selection':
      return `${prefix}Customer hasn't selected a number. Check inventory and contact customer.`;
    case 'esim_activation':
      return `${prefix}eSIM activation pending. Walk customer through installation or check provisioning.`;
    case 'nw_enabled':
      return `${prefix}Network not enabled. Run diagnostics and check APN settings.`;
    case 'airvet_account':
      return `${prefix}Airvet account not set up. Check integration logs and trigger manual registration.`;
    default:
      return `${prefix}Review customer journey status. Stuck for ${Math.round(stuckHours)}h.`;
  }
}

// --- Main API Handler ---

export async function GET() {
  try {
    // Run both queries in parallel
    const [stuckCustomers, ticketRows] = await Promise.all([
      runSQL(STUCK_CUSTOMERS_SQL),
      runSQL(ZENDESK_TICKETS_SQL),
    ]);

    // Deduplicate tickets (Databricks may have multiple rows per ticket from incremental syncs)
    const ticketMap = new Map();
    for (const row of ticketRows) {
      const existing = ticketMap.get(row.ticket_id);
      if (!existing || new Date(row.updated_at) > new Date(existing.updated_at)) {
        const tags = parseTags(row.tags);
        const extracted = extractFromTags(tags);
        ticketMap.set(row.ticket_id, {
          id: row.ticket_id,
          subject: row.subject,
          status: row.status,
          priority: row.priority,
          created_at: row.created_at,
          updated_at: row.updated_at,
          requester_id: row.requester_id,
          assignee_id: row.assignee_id,
          group_id: row.group_id,
          tags,
          inquiryType: extracted.inquiryType,
          inquiryTypeFormatted: formatInquiryType(extracted.inquiryType),
          intent: extracted.intent,
          sentiment: extracted.sentiment,
          language: extracted.language,
          signalCode: classifyTicketSignal(extracted.inquiryType, extracted.intent, row.subject),
        });
      }
    }
    const tickets = [...ticketMap.values()];

    // Look up Zendesk user emails for all unique requester_ids
    const uniqueRequesterIds = [...new Set(tickets.map(t => t.requester_id).filter(Boolean))];
    const emailByRequesterId = await lookupZendeskUsers(uniqueRequesterIds);

    // Index tickets by requester email (lowercase) for customer matching
    const ticketsByEmail = {};
    for (const t of tickets) {
      const email = emailByRequesterId[t.requester_id];
      if (!email) continue;
      if (!ticketsByEmail[email]) ticketsByEmail[email] = [];
      ticketsByEmail[email].push(t);
    }

    // Build customer records
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, healthy: 0 };
    const slaCounts = { breached: 0, critical: 0, warning: 0, ok: 0 };

    const customers = stuckCustomers.map(c => {
      const stuckHours = parseFloat(c.stuck_hours) || 0;
      const esimError = c.esim_error === 'true' || c.esim_error === true;
      const portinStuck = c.portin_stuck === 'true' || c.portin_stuck === true;
      const portinConflict = c.portin_conflict === 'true' || c.portin_conflict === true;

      const customerData = {
        ...c,
        stuck_hours: stuckHours,
        esim_error: esimError,
        portin_stuck: portinStuck,
        portin_conflict: portinConflict,
      };

      // Match tickets by customer email
      const customerEmail = (c.email || '').toLowerCase();
      const customerTickets = customerEmail ? (ticketsByEmail[customerEmail] || []) : [];

      const stageInfo = JOURNEY_STAGES.find(s => s.id === c.stuck_stage) || JOURNEY_STAGES[0];
      const healthScore = computeHealthScore(customerData, customerTickets);
      const healthCategory = categorize(healthScore);
      const slaStatus = computeSlaStatus(stuckHours, healthScore, customerTickets);
      const issueTags = deriveIssueTags(customerData, customerTickets);
      const recommendedAction = getRecommendedAction(customerData, customerTickets);

      severityCounts[healthCategory]++;
      slaCounts[slaStatus]++;

      return {
        id: c.user_id || c.individual_id || c.customer_id,
        name: c.name || 'Unknown',
        email: c.email,
        phone: c.phone_number,
        userId: c.user_id,
        individualId: c.individual_id,
        customerId: c.customer_id,
        // Onboarding data
        onboardingStatus: c.onboarding_status,
        telcoStatus: c.telco_customer_status,
        stuckAt: c.stuck_stage,
        stuckStage: stageInfo.label,
        stuckOrder: stageInfo.order,
        stuckHours: stuckHours,
        // Onboarding timestamps
        onboardingTimestamps: {
          order: c.onboarding_order_completed_at,
          payment: c.onboarding_payment_completed_at,
          numberSelection: c.onboarding_number_selection_completed_at,
          activation: c.onboarding_activation_completed_at,
          petInsurance: c.onboarding_pet_insurance_completed_at,
          completed: c.onboarding_completed_at,
        },
        // Order/eSIM/Port data
        latestOrderId: c.latest_order_id,
        latestOrderStatus: c.latest_order_status,
        esimStatus: c.latest_order_esim_status,
        portinStatus: c.latest_order_portin_status,
        latestEsimStatus: c.latest_esim_status,
        isAirvetActivated: c.is_airvet_activated === 'true' || c.is_airvet_activated === true,
        msisdn: c.msisdn,
        imei: c.imei,
        // Location
        city: c.city,
        region: c.region,
        // Health
        healthScore,
        healthCategory,
        slaStatus,
        issueTags,
        recommendedAction,
        // Enrichment
        isS100: c.is_s100_user === 'true' || c.is_s100_user === true,
        catCount: parseInt(c.cat_count) || 0,
        signedUpAt: c.certification_created_at,
        // Tickets (empty for now — no join key between ZD requester_id and customer_360)
        tickets: customerTickets,
        ticketCount: customerTickets.length,
        isSilent: customerTickets.length === 0,
        issueSince: c.certification_created_at,
        contacts: { agent: 0, mochi: 0 },
      };
    });

    // Sort by health score (worst first)
    customers.sort((a, b) => a.healthScore - b.healthScore);

    // Journey funnel summary
    const journeyFunnel = JOURNEY_STAGES.map(stage => {
      const stuckCustomers = customers.filter(c => c.stuckAt === stage.id);
      const breachedCount = stuckCustomers.filter(c => c.slaStatus === 'breached').length;
      return { ...stage, count: stuckCustomers.length, breachedCount };
    });

    // Unmatched tickets summary (tickets that aren't linked to stuck customers)
    const unmatchedTickets = tickets.slice(0, 50).map(t => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      created_at: t.created_at,
      sentiment: t.sentiment,
      inquiryType: t.inquiryTypeFormatted,
      signalCode: t.signalCode,
    }));

    return NextResponse.json({
      customers,
      total: customers.length,
      severityCounts,
      slaCounts,
      journeyFunnel,
      recentTickets: unmatchedTickets,
      ticketCount: tickets.length,
      fetchedAt: new Date().toISOString(),
      source: 'databricks',
    });
  } catch (err) {
    console.error('Customer Health API error:', err);
    return NextResponse.json(
      {
        error: err.message,
        customers: [],
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, healthy: 0 },
        slaCounts: { breached: 0, critical: 0, warning: 0, ok: 0 },
        journeyFunnel: [],
        recentTickets: [],
      },
      { status: 500 }
    );
  }
}
