import { NextResponse } from 'next/server';
import { runSQL } from '../../lib/databricks';

// --- Zendesk API ---
const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;
const ZENDESK_AUTH = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString('base64');

// Fetch active tickets from Zendesk API (catches tickets not yet synced to Databricks)
// Searches for all open, pending, hold, and solved tickets from the last 90 days
async function fetchActiveZendeskTickets() {
  if (!ZENDESK_SUBDOMAIN) return [];
  const allTickets = [];
  // Fetch all ticket statuses so we can override stale Databricks data
  const queries = [
    'type:ticket status:open status:pending status:hold created>90days',
    'type:ticket status:solved created>30days',
    'type:ticket status:closed created>30days',
    'type:ticket tags:proactive_outreach created>30days',
  ];
  for (const query of queries) {
    try {
      const res = await fetch(
        `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search.json?query=${encodeURIComponent(query)}&per_page=100`,
        { headers: { 'Authorization': `Basic ${ZENDESK_AUTH}` }, cache: 'no-store' }
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const t of (data.results || [])) {
        allTickets.push({
          id: String(t.id),
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          created_at: t.created_at,
          updated_at: t.updated_at,
          requester_id: String(t.requester_id),
          assignee_id: t.assignee_id ? String(t.assignee_id) : null,
          group_id: t.group_id ? String(t.group_id) : null,
          tags: t.tags || [],
          inquiryType: null,
          inquiryTypeFormatted: null,
          intent: null,
          sentiment: null,
          language: null,
          signalCode: null,
        });
      }
    } catch (err) {
      console.error('Zendesk ticket search error:', err.message);
    }
  }
  return allTickets;
}

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
  AND t.tags NOT LIKE '%"slo"%'
  AND t.tags NOT LIKE '%rca-auto%'
  AND t.tags NOT LIKE '%non_user%'
  AND t.created_at >= DATE_SUB(CURRENT_TIMESTAMP(), 90)
ORDER BY t.created_at DESC
LIMIT 500
`;

const POST_ONBOARDING_SQL = `
SELECT
  c.user_id, c.individual_id, c.customer_id,
  TRIM(CONCAT(COALESCE(c.given_name, ''), ' ', COALESCE(c.family_name, ''))) as name,
  c.phone_number, c.stripe_email as email,
  c.onboarding_status, c.telco_customer_status,
  c.onboarding_completed_at,
  c.latest_order_id, c.latest_order_status,
  c.latest_order_esim_status, c.latest_order_portin_status,
  c.latest_esim_status,
  c.is_airvet_activated, c.airvet_activated_at,
  c.city, c.state as region,
  c.is_s100_user, c.cat_count,
  c.certification_created_at,
  fo.msisdn, fo.imei,
  DATEDIFF(CURRENT_DATE(), c.onboarding_completed_at) as days_since_completed,
  CASE
    WHEN DATEDIFF(CURRENT_DATE(), c.onboarding_completed_at) <= 7 THEN 'first_week'
    WHEN DATEDIFF(CURRENT_DATE(), c.onboarding_completed_at) <= 30 THEN 'first_month'
    ELSE 'established'
  END as lifecycle_phase,
  ROUND(CAST(
    (UNIX_TIMESTAMP(CURRENT_TIMESTAMP()) - UNIX_TIMESTAMP(c.onboarding_completed_at)) / 3600.0
  AS DOUBLE), 1) as stuck_hours,
  'completed' as stuck_stage,
  false as esim_error, false as portin_stuck, false as portin_conflict
FROM prod_catalog.silver.customer_360 c
LEFT JOIN prod_catalog.silver.fact_order fo ON c.latest_order_id = fo.order_id
WHERE c.onboarding_status = 'COMPLETED'
  AND c.onboarding_completed_at >= DATE_SUB(CURRENT_DATE(), 90)
  AND (
    c.telco_customer_status IN ('Suspended', 'Cancelled')
    OR c.telco_customer_status IS NULL
    OR (c.is_airvet_activated = false
        AND DATEDIFF(CURRENT_DATE(), c.onboarding_completed_at) > 3)
  )
  AND NOT (
    c.stripe_email LIKE '%@rockstar-automations.com'
    OR c.stripe_email LIKE '%@gatherat.ai'
    OR c.stripe_email LIKE '%@meow-mobile.co'
    OR c.stripe_email LIKE 'cjrunner%'
    OR c.stripe_email LIKE 'care.helpoff%'
    OR c.stripe_email LIKE 'tester%@gatherat.ai'
    OR LOWER(COALESCE(c.family_name, '')) = 'meow'
  )
ORDER BY c.onboarding_completed_at DESC
LIMIT 200
`;

const PAYMENT_FAILURES_SQL = `
SELECT
  fc.stripe_customer_id,
  fc.failure_code,
  fc.outcome_type,
  fc.charge_amount,
  fc.charge_created_at,
  fc.customer_delinquent,
  fc.intent_status
FROM prod_catalog.silver.fact_charges fc
WHERE fc.is_latest_charge = true
  AND fc.charge_status = 'failed'
  AND fc.charge_created_at >= DATE_SUB(CURRENT_DATE(), 30)
`;

// --- Call Drop Detection (CIS #24) ---
// Tier 1: Detect from Zendesk ticket subjects/tags (customers who *report* call drops)
const CALL_DROP_KEYWORDS = ['call drop', 'calls dropping', 'dropped call', 'call keeps dropping', 'calls keep dropping', 'call disconnects', 'call cuts off', 'call cut off'];

function hasCallDropSignal(tickets) {
  return tickets.some(t => {
    const sub = (t.subject || '').toLowerCase();
    return CALL_DROP_KEYWORDS.some(kw => sub.includes(kw));
  });
}

// Tier 2 (Future): CDR-based detection — uncomment when prod_catalog.silver.fact_calls exists
// const CALL_DROPS_SQL = `
// SELECT
//   fc.msisdn,
//   fc.call_id,
//   fc.call_start_time,
//   fc.call_end_time,
//   fc.call_duration_seconds,
//   fc.disconnect_reason,         -- e.g. 'ABNORMAL_RELEASE', 'RADIO_LINK_FAILURE'
//   fc.cell_id,
//   fc.signal_strength_dbm,
//   fc.call_type                  -- 'VOLTE', 'CS_FALLBACK'
// FROM prod_catalog.silver.fact_calls fc
// WHERE fc.disconnect_reason IN ('ABNORMAL_RELEASE', 'RADIO_LINK_FAILURE', 'BEARER_LOST')
//   AND fc.call_duration_seconds > 5        -- ignore sub-5s failed setup
//   AND fc.call_start_time >= DATE_SUB(CURRENT_DATE(), 7)
// `;

// Stuck thresholds per stage (hours) — below this, customers are still progressing normally
const STUCK_THRESHOLDS = {
  number_selection: 1,
  esim_activation: 1,
  nw_enabled: 1,
  airvet_account: 3,
};

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

// --- CIS (Customer Issue Scenarios) assignment ---

function assignCisScenario(customer) {
  const stuckAt = customer.stuckAt;
  const stuckHours = customer.stuckHours || 0;
  const esimStatus = customer.esimStatus;
  const portinStatus = customer.portinStatus;
  const telcoStatus = customer.telcoStatus;
  const issueTags = customer.issueTags || [];
  const isSilent = issueTags.includes('Silent Stuck') || (customer.isSilent && stuckHours > 720);

  // Post-onboarding customers
  if (stuckAt === 'completed') {
    if (!telcoStatus || telcoStatus === 'NULL') {
      return { journeyStage: 'post_onboarding', milestone: 'activation', issueBucket: 'Incomplete Activation', cisNumber: 31 };
    }
    if (telcoStatus === 'Suspended') {
      return { journeyStage: 'post_onboarding', milestone: 'service_issues', issueBucket: 'Service Resumed but Not Working', cisNumber: 27 };
    }
    if (telcoStatus === 'Cancelled') {
      return { journeyStage: 'post_onboarding', milestone: 'service_issues', issueBucket: 'Service Resumed but Not Working', cisNumber: 28 };
    }
    if (issueTags.includes('Call Drops')) {
      return { journeyStage: 'post_onboarding', milestone: 'service_issues', issueBucket: 'Call Drops', cisNumber: 24 };
    }
    return { journeyStage: 'others', milestone: null, issueBucket: 'Uncategorized', cisNumber: null };
  }

  if (stuckAt === 'order_created') {
    if (isSilent || stuckHours > 720) {
      return { journeyStage: 'onboarding', milestone: 'order_created', issueBucket: 'Silent Churn', cisNumber: 30 };
    }
    return { journeyStage: 'onboarding', milestone: 'order_created', issueBucket: 'Order Abandoned', cisNumber: 29 };
  }

  if (stuckAt === 'payment') {
    return { journeyStage: 'onboarding', milestone: 'payment', issueBucket: 'Payment not completed', cisNumber: 6 };
  }

  if (stuckAt === 'number_selection') {
    if (portinStatus === 'CONFLICT' || portinStatus === 'REVIEWING') {
      return { journeyStage: 'onboarding', milestone: 'number_selection', issueBucket: 'New Number / Port-In', cisNumber: 10 };
    }
    return { journeyStage: 'onboarding', milestone: 'number_selection', issueBucket: 'New Number / Port-In', cisNumber: 11 };
  }

  if (stuckAt === 'esim_activation') {
    if (portinStatus === 'CONFLICT') {
      return { journeyStage: 'onboarding', milestone: 'number_selection', issueBucket: 'New Number / Port-In', cisNumber: 10 };
    }
    if (esimStatus === 'ERROR' || esimStatus === 'FAILED') {
      return { journeyStage: 'onboarding', milestone: 'esim_activation', issueBucket: 'eSIM Activation Stuck', cisNumber: 16 };
    }
    return { journeyStage: 'onboarding', milestone: 'esim_activation', issueBucket: 'eSIM not Downloaded', cisNumber: 14 };
  }

  if (stuckAt === 'nw_enabled') {
    return { journeyStage: 'onboarding', milestone: 'esim_activation', issueBucket: 'eSIM Activation Stuck', cisNumber: 16 };
  }

  if (stuckAt === 'airvet_account') {
    if (esimStatus === 'ERROR' || esimStatus === 'FAILED') {
      return { journeyStage: 'onboarding', milestone: 'esim_activation', issueBucket: 'eSIM Activation Stuck', cisNumber: 16 };
    }
    return { journeyStage: 'others', milestone: null, issueBucket: 'Uncategorized', cisNumber: null };
  }

  return { journeyStage: 'others', milestone: null, issueBucket: 'Uncategorized', cisNumber: null };
}

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

  // Call drop reports — moderate penalty (service degradation)
  if (hasCallDropSignal(tickets)) score -= 15;

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
    if (CALL_DROP_KEYWORDS.some(kw => sub.includes(kw))) tags.add('Call Drops');
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

// --- Ticket Funnel: Unresponded ticket detection ---

async function fetchTicketComments(ticketId) {
  try {
    const res = await fetch(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}/comments.json?sort_order=desc&per_page=10`,
      { headers: { 'Authorization': `Basic ${ZENDESK_AUTH}` }, cache: 'no-store' }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.comments || [];
  } catch (err) {
    console.error(`Failed to fetch comments for ticket ${ticketId}:`, err.message);
    return [];
  }
}

async function findUnrespondedTickets(tickets, emailByRequesterId) {
  // Exclude internal/automated tickets
  const INTERNAL_DOMAINS = ['rockstar-automations.com'];
  const SYSTEM_TAGS = ['sla_alert', 'sla_alert2', 'pagerduty', 'slo', 'rca-auto', 'non_user'];

  // Only look at new, open, hold tickets from real customers
  const activeTickets = tickets.filter(t => {
    if (!['new', 'open', 'hold'].includes(t.status)) return false;
    // Exclude tickets with system tags
    const tags = Array.isArray(t.tags) ? t.tags : [];
    if (tags.some(tag => SYSTEM_TAGS.includes(tag))) return false;
    // Exclude internal requester emails
    const email = emailByRequesterId[t.requester_id];
    if (email && INTERNAL_DOMAINS.some(d => email.endsWith('@' + d))) return false;
    return true;
  });

  // Fetch comments with concurrency limit of 10
  const results = [];
  for (let i = 0; i < activeTickets.length; i += 10) {
    const batch = activeTickets.slice(i, i + 10);
    const commentResults = await Promise.allSettled(
      batch.map(t => fetchTicketComments(t.id))
    );
    for (let j = 0; j < batch.length; j++) {
      const ticket = batch[j];
      const comments = commentResults[j].status === 'fulfilled' ? commentResults[j].value : [];
      results.push({ ticket, comments });
    }
  }

  const unresponded = [];
  const now = Date.now();

  for (const { ticket, comments } of results) {
    // Find the last public comment
    const publicComments = comments.filter(c => c.public);

    let waitingSinceDate;
    let hasAgentResponse = false;

    if (publicComments.length === 0) {
      // No public comments at all — agent needs to respond
      waitingSinceDate = new Date(ticket.created_at);
    } else {
      // Comments are sorted desc (newest first)
      const lastPublic = publicComments[0];
      if (String(lastPublic.author_id) === String(ticket.requester_id)) {
        // Customer spoke last — agent needs to respond
        waitingSinceDate = new Date(lastPublic.created_at);
        hasAgentResponse = publicComments.some(c => String(c.author_id) !== String(ticket.requester_id));
      } else {
        // Agent spoke last — customer needs to respond, skip
        continue;
      }
    }

    const waitingSinceHours = (now - waitingSinceDate.getTime()) / (1000 * 60 * 60);

    if (waitingSinceHours >= 24) {
      unresponded.push({
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        created_at: ticket.created_at,
        updated_at: ticket.updated_at,
        requester_id: ticket.requester_id,
        assignee_id: ticket.assignee_id,
        tags: ticket.tags || [],
        inquiryTypeFormatted: ticket.inquiryTypeFormatted || null,
        sentiment: ticket.sentiment || null,
        waitingSinceHours: Math.round(waitingSinceHours * 10) / 10,
        lastCustomerMessageAt: waitingSinceDate.toISOString(),
        hasAgentResponse,
        requesterEmail: emailByRequesterId[ticket.requester_id] || null,
      });
    }
  }

  // Sort by waiting time descending (oldest/longest waiting first)
  unresponded.sort((a, b) => b.waitingSinceHours - a.waitingSinceHours);
  return unresponded;
}

// --- Proactive Ticket Auto-Creation ---

const PROACTIVE_BATCH_SIZE = 5;

function proactivePriorityFromCategory(healthCategory) {
  switch (healthCategory) {
    case 'critical': return 'urgent';
    case 'high': return 'high';
    case 'medium': return 'normal';
    case 'low': return 'low';
    default: return 'normal';
  }
}

function proactiveSubject(customer) {
  const firstName = (customer.name || 'Customer').split(' ')[0];
  const subjects = {
    order_created: `${firstName}, we noticed your Meow Mobile order needs attention`,
    payment: `${firstName}, let's get your Meow Mobile payment sorted`,
    number_selection: `${firstName}, your number transfer is in progress`,
    esim_activation: `${firstName}, we're working on your eSIM activation`,
    nw_enabled: `${firstName}, let's get your network up and running`,
    airvet_account: `${firstName}, one last step — setting up your Airvet account`,
  };
  if (customer.issueTags?.includes('Call Drops')) {
    return `${firstName}, we noticed call quality issues on your Meow Mobile line`;
  }
  return subjects[customer.stuckAt] || `${firstName}, we're here to help with your Meow Mobile setup`;
}

function proactiveTags(customer) {
  const tags = ['proactive_outreach', 'internal_ticket_created'];
  if (customer.stuckAt) tags.push(`stuck_${customer.stuckAt}`);
  if (customer.esimStatus === 'ERROR' || customer.esimStatus === 'FAILED') tags.push('esim_error');
  if (customer.portinStatus === 'CONFLICT') tags.push('portin_conflict');
  if (customer.portinStatus === 'REVIEWING') tags.push('portin_reviewing');
  const issueTags = customer.issueTags || [];
  if (issueTags.includes('Churn Risk')) tags.push('churn_risk');
  if (issueTags.includes('Silent Stuck')) tags.push('silent_stuck');
  if (issueTags.includes('Payment Stuck')) tags.push('payment_stuck');
  if (issueTags.includes('MNP Conflict')) tags.push('mnp_conflict');
  if (issueTags.includes('MNP Stuck')) tags.push('mnp_stuck');
  if (issueTags.includes('eSIM Failed')) tags.push('esim_failed');
  if (issueTags.includes('Airvet Pending')) tags.push('airvet_pending');
  if (issueTags.includes('Call Drops')) tags.push('call_drops');
  if (customer.healthCategory) tags.push(`health_${customer.healthCategory}`);
  return tags;
}

function proactiveInternalNote(customer) {
  const stuckDays = customer.stuckHours ? Math.round(customer.stuckHours / 24) : 0;
  let note = `## Proactive Health Alert\n`;
  note += `**Customer:** ${customer.name || 'Unknown'} (${customer.email || 'no email'})\n`;
  note += `**Health Score:** ${customer.healthScore}/100 (${customer.healthCategory})\n`;
  note += `**Stuck at:** ${customer.stuckStage || customer.stuckAt} for ${stuckDays}d (${Math.round(customer.stuckHours || 0)}h)\n\n`;
  note += `### Customer Journey Snapshot\n`;
  note += `- **Order:** ${customer.latestOrderId || 'N/A'} — ${customer.latestOrderStatus || 'N/A'}\n`;
  note += `- **eSIM:** ${customer.esimStatus || 'N/A'}\n`;
  note += `- **Port-in:** ${customer.portinStatus || 'N/A'}\n`;
  note += `- **Telco:** ${customer.telcoStatus || 'N/A'}\n`;
  note += `- **MSISDN:** ${customer.msisdn || 'N/A'}\n\n`;
  if (customer.issueTags?.length > 0) {
    note += `### Issue Signals\n`;
    for (const tag of customer.issueTags) note += `- ${tag}\n`;
    note += '\n';
  }
  if (customer.recommendedAction) {
    note += `### Recommended Action\n${customer.recommendedAction}\n\n`;
  }
  note += `### ConnectX Actions Available\n`;
  if (customer.esimStatus === 'ERROR' || customer.esimStatus === 'FAILED') note += `- [ ] Re-issue eSIM (SIM Swap) via BOSS API\n`;
  if (customer.portinStatus === 'CONFLICT' || customer.portinStatus === 'REVIEWING') note += `- [ ] Retry Port-In after obtaining correct details\n`;
  if (customer.stuckHours > 48) note += `- [ ] Cancel Order if customer unresponsive\n`;
  note += `- [ ] Contact customer to assist with ${customer.stuckStage || 'setup'}\n`;
  return note;
}

async function zendeskSearchOpenTickets(email) {
  if (!ZENDESK_SUBDOMAIN || !email) return [];
  try {
    const query = encodeURIComponent(`type:ticket requester:${email} -status:solved -status:closed`);
    const res = await fetch(
      `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search.json?query=${query}&sort_by=created_at&sort_order=desc`,
      { headers: { 'Authorization': `Basic ${ZENDESK_AUTH}` }, cache: 'no-store' }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error(`Zendesk open ticket search error for ${email}:`, err.message);
    return [];
  }
}

async function zendeskCreateTicketWithNote({ email, name, subject, internalNote, tags, priority }) {
  if (!ZENDESK_SUBDOMAIN) return null;
  const ticket = {
    subject,
    priority: priority || 'normal',
    status: 'open',
    tags: tags || [],
    comment: { body: internalNote, public: false, suppress_notifications: true },
    requester: { email, name: name || email },
  };
  const res = await fetch(
    `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets.json`,
    {
      method: 'POST',
      headers: { 'Authorization': `Basic ${ZENDESK_AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Zendesk ticket creation failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.ticket;
}

async function autoCreateProactiveTickets(customers) {
  // Filter: no active (non-solved, non-closed) tickets and has email
  const eligible = customers.filter(c => c.activeTicketCount === 0 && c.email);
  const created = [];
  const skipped = [];
  const errors = [];

  // Dedup: per-customer Zendesk search for any open ticket (catches pagination gaps)
  const dedupResults = await Promise.allSettled(
    eligible.map(async (c) => {
      const openTickets = await zendeskSearchOpenTickets(c.email);
      if (openTickets.length > 0) {
        return { customer: c, skip: true, reason: 'Existing open ticket #' + openTickets[0].id, latestTicketId: String(openTickets[0].id), latestTicketSubject: openTickets[0].subject };
      }
      return { customer: c, skip: false };
    })
  );

  const toCreate = [];
  for (const result of dedupResults) {
    if (result.status === 'fulfilled') {
      if (result.value.skip) {
        skipped.push({ email: result.value.customer.email, name: result.value.customer.name, reason: result.value.reason, latestTicketId: result.value.latestTicketId, latestTicketSubject: result.value.latestTicketSubject });
      } else {
        toCreate.push(result.value.customer);
      }
    }
  }

  // Create tickets in batches
  for (let i = 0; i < toCreate.length; i += PROACTIVE_BATCH_SIZE) {
    const batch = toCreate.slice(i, i + PROACTIVE_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (customer) => {
        const ticket = await zendeskCreateTicketWithNote({
          email: customer.email,
          name: customer.name,
          subject: proactiveSubject(customer),
          internalNote: proactiveInternalNote(customer),
          tags: proactiveTags(customer),
          priority: proactivePriorityFromCategory(customer.healthCategory),
        });
        return { customer, ticket };
      })
    );
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        created.push({ ticketId: results[j].value.ticket.id, email: results[j].value.customer.email, name: results[j].value.customer.name, healthCategory: results[j].value.customer.healthCategory });
      } else {
        errors.push({ email: batch[j]?.email, name: batch[j]?.name, error: results[j].reason?.message || 'Unknown error' });
      }
    }
  }

  console.log(`Proactive tickets: ${created.length} created, ${skipped.length} skipped, ${errors.length} errors`);
  return { created, skipped, errors };
}

// --- Main API Handler ---

export async function GET() {
  try {
    // Run Databricks queries + Zendesk live ticket search in parallel
    const [stuckCustomers, ticketRows, liveZendeskTickets, postOnboardingCustomers, paymentFailures] = await Promise.all([
      runSQL(STUCK_CUSTOMERS_SQL),
      runSQL(ZENDESK_TICKETS_SQL),
      fetchActiveZendeskTickets(),
      runSQL(POST_ONBOARDING_SQL).catch(err => { console.error('Post-onboarding SQL error:', err.message); return []; }),
      runSQL(PAYMENT_FAILURES_SQL).catch(err => { console.error('Payment failures SQL error:', err.message); return []; }),
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
    // Merge live Zendesk tickets (catches recent tickets not yet in Databricks,
    // tickets filtered by tag exclusions, and gets real-time ticket status)
    for (const zt of liveZendeskTickets) {
      const existing = ticketMap.get(zt.id);
      if (!existing) {
        // Ticket not in Databricks at all — add it
        ticketMap.set(zt.id, zt);
      } else if (new Date(zt.updated_at) > new Date(existing.updated_at)) {
        // Ticket exists but Zendesk has newer status — update status & tags
        existing.status = zt.status;
        existing.tags = zt.tags;
        existing.updated_at = zt.updated_at;
        existing.priority = zt.priority;
      }
    }

    // Exclude closed tickets — Databricks may have stale statuses for tickets
    // that were closed after the last sync
    const tickets = [...ticketMap.values()].filter(t => t.status !== 'closed');

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

    // Build solved proactive ticket lookup for stale data override
    const solvedProactiveByEmail = {};
    for (const t of tickets) {
      if ((t.status === 'solved' || t.status === 'closed') && (t.tags || []).includes('proactive_outreach')) {
        const email = emailByRequesterId[t.requester_id];
        if (!email) continue;
        if (!solvedProactiveByEmail[email]) solvedProactiveByEmail[email] = [];
        solvedProactiveByEmail[email].push(t);
      }
    }

    // Build payment failure lookup by stripe_customer_id
    const paymentFailureMap = {};
    for (const pf of paymentFailures) {
      if (pf.stripe_customer_id) {
        paymentFailureMap[pf.stripe_customer_id] = pf;
      }
    }

    // Build customer records
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, healthy: 0 };
    const slaCounts = { breached: 0, critical: 0, warning: 0, ok: 0 };

    const customers = stuckCustomers.map(c => {
      const stuckHours = parseFloat(c.stuck_hours) || 0;
      const esimError = c.esim_error === 'true' || c.esim_error === true;
      const portinStuck = c.portin_stuck === 'true' || c.portin_stuck === true;
      const portinConflict = c.portin_conflict === 'true' || c.portin_conflict === true;

      // Stale data override: suppress eSIM error if solved proactive ticket with esim tag exists
      let effectiveEsimError = esimError;
      const custEmail = (c.email || '').toLowerCase();
      if (esimError && custEmail) {
        const solvedTickets = solvedProactiveByEmail[custEmail] || [];
        if (solvedTickets.some(t => (t.tags || []).some(tag => tag.includes('esim')))) {
          effectiveEsimError = false;
        }
      }

      // Error vs stuck classification
      const hasError = effectiveEsimError || portinConflict || portinStuck || c.latest_order_esim_status === 'FAILED';
      const stuckThreshold = STUCK_THRESHOLDS[c.stuck_stage];
      const isPrePayment = ['order_created', 'payment'].includes(c.stuck_stage);
      let customerType = null; // null = exclude (not actionable)
      if (isPrePayment) {
        // Pre-payment: only show if there's a payment failure or error ticket
        if (paymentFailureMap[c.customer_id]) customerType = 'error';
      } else {
        if (hasError) customerType = 'error';
        else if (stuckThreshold && stuckHours > stuckThreshold) customerType = 'stuck';
      }

      const customerData = {
        ...c,
        stuck_hours: stuckHours,
        esim_error: effectiveEsimError,
        portin_stuck: portinStuck,
        portin_conflict: portinConflict,
      };

      // Match tickets by customer email — only active tickets (open, pending, hold, solved)
      const customerEmail = (c.email || '').toLowerCase();
      const allCustomerTickets = customerEmail ? (ticketsByEmail[customerEmail] || []) : [];
      const customerTickets = allCustomerTickets
        .filter(t => ['new', 'open', 'pending', 'hold', 'solved'].includes(t.status))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

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
        // Classification
        customerType,
        // Enrichment
        isS100: c.is_s100_user === 'true' || c.is_s100_user === true,
        catCount: parseInt(c.cat_count) || 0,
        signedUpAt: c.certification_created_at,
        // Tickets
        tickets: customerTickets,
        ticketCount: customerTickets.length,
        activeTicketCount: customerTickets.filter(t => ['new', 'open', 'pending', 'hold'].includes(t.status)).length,
        latestTicketId: customerTickets.length > 0 ? customerTickets[0].id : null,
        latestTicketSubject: customerTickets.length > 0 ? customerTickets[0].subject : null,
        isSilent: customerTickets.length === 0,
        issueSince: c.certification_created_at,
        contacts: { agent: 0, mochi: 0 },
      };
    });

    // Assign CIS scenario to each customer (needs issueTags to be set first)
    for (const c of customers) {
      c.cisScenario = assignCisScenario(c);
    }

    // Sort by health score (worst first)
    customers.sort((a, b) => a.healthScore - b.healthScore);

    // Process post-onboarding at-risk customers
    const postOnboarding = postOnboardingCustomers.map(c => {
      const custEmail = (c.email || '').toLowerCase();
      const allCustTickets = custEmail ? (ticketsByEmail[custEmail] || []) : [];
      const custTickets = allCustTickets
        .filter(t => ['new', 'open', 'pending', 'hold', 'solved'].includes(t.status))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      const stuckHours = parseFloat(c.stuck_hours) || 0;
      const customerData = { ...c, stuck_hours: stuckHours, esim_error: false, portin_stuck: false, portin_conflict: false };
      const healthScore = computeHealthScore(customerData, custTickets);
      const healthCategory = categorize(healthScore);
      const hasPaymentFailure = !!paymentFailureMap[c.customer_id];
      const pf = paymentFailureMap[c.customer_id];

      const issueTags = [];
      if (c.telco_customer_status === 'Suspended') issueTags.push('Suspended');
      else if (c.telco_customer_status === 'Cancelled') issueTags.push('Cancelled');
      else if (!c.telco_customer_status) issueTags.push('Incomplete Activation');
      if (hasPaymentFailure) issueTags.push(pf.failure_code ? `Payment Failed (${pf.failure_code})` : 'Payment Failed');
      if (pf?.customer_delinquent === 'true' || pf?.customer_delinquent === true) issueTags.push('Delinquent');
      if ((c.is_airvet_activated === 'false' || c.is_airvet_activated === false) && (parseInt(c.days_since_completed) || 0) > 3) issueTags.push('Airvet Pending');
      if (hasCallDropSignal(custTickets)) issueTags.push('Call Drops');

      let recommendedAction = 'Review post-onboarding status.';
      if (hasPaymentFailure) recommendedAction = 'Contact customer to update payment method.';
      else if (c.telco_customer_status === 'Suspended') recommendedAction = 'Review suspension reason and contact customer.';
      else if (!c.telco_customer_status) recommendedAction = 'Investigate why telco account not activated.';
      else if (issueTags.includes('Call Drops')) recommendedAction = 'Customer reporting call drops. Check VoLTE, signal strength, network outages in customer area.';

      return {
        id: c.user_id || c.individual_id || c.customer_id,
        name: c.name || 'Unknown',
        email: c.email,
        phone: c.phone_number,
        telcoStatus: c.telco_customer_status,
        stuckAt: 'completed',
        stuckStage: 'Post-Onboarding',
        stuckHours,
        healthScore,
        healthCategory,
        issueTags,
        recommendedAction,
        customerType: (c.telco_customer_status === 'Suspended' || c.telco_customer_status === 'Cancelled' || hasPaymentFailure) ? 'error' : 'stuck',
        lifecyclePhase: c.lifecycle_phase,
        daysSinceCompleted: parseInt(c.days_since_completed) || 0,
        tickets: custTickets,
        ticketCount: custTickets.length,
        activeTicketCount: custTickets.filter(t => ['new', 'open', 'pending', 'hold'].includes(t.status)).length,
        latestTicketId: custTickets.length > 0 ? custTickets[0].id : null,
        latestTicketSubject: custTickets.length > 0 ? custTickets[0].subject : null,
        latestOrderId: c.latest_order_id,
        latestOrderStatus: c.latest_order_status,
        esimStatus: c.latest_order_esim_status,
        portinStatus: c.latest_order_portin_status,
        msisdn: c.msisdn,
      };
    });

    // Assign CIS scenario to each post-onboarding customer
    for (const c of postOnboarding) {
      c.cisScenario = assignCisScenario(c);
    }

    // Auto-create proactive tickets for ALL customers (onboarding + post-onboarding) with no active tickets
    const allForTickets = [...customers, ...postOnboarding];
    let proactiveTickets = { created: [], skipped: [], errors: [] };
    if (ZENDESK_SUBDOMAIN) {
      try {
        proactiveTickets = await autoCreateProactiveTickets(allForTickets);
        // Mark customers with newly created tickets
        const createdEmails = new Set(proactiveTickets.created.map(t => t.email?.toLowerCase()));
        for (const c of customers) {
          if (createdEmails.has(c.email?.toLowerCase())) {
            c.proactiveTicketCreated = true;
          }
        }
      } catch (err) {
        console.error('Proactive ticket creation error:', err.message);
      }
    }

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

    // Ticket Funnel: find unresponded tickets (>24h without agent reply)
    const unrespondedTickets = await findUnrespondedTickets(tickets, emailByRequesterId);

    return NextResponse.json({
      customers,
      total: customers.length,
      severityCounts,
      slaCounts,
      journeyFunnel,
      recentTickets: unmatchedTickets,
      unrespondedTickets,
      proactiveTickets,
      postOnboarding: postOnboarding.length > 0 ? postOnboarding : undefined,
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
