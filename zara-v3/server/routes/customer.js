const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { bossApi } = require('../lib/boss-api');
const { databricksQuery } = require('../lib/databricks');
const { zendeskSearch, zendeskTicketComments, zendeskHelpCenterSearch, zendeskGetTicket, zendeskGet } = require('../lib/zendesk-api');
const { getSkillGuidance, skillsAvailable, resolveSla, loadSkill } = require('../lib/skill-loader');
const { getKBContext } = require('../lib/kb-context');
const { resolveLob } = require('../lib/lob-resolver');
const { getLob, getDefaultLob } = require('../config/lob-registry');

const router = express.Router();

// Anthropic (optional — for AI fallback in agent brief)
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    anthropic = new (Anthropic.default || Anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY });
  } catch (e) { /* skip */ }
}

// ── humanizeText — strip AI writing patterns (ref: humanize-ai-text.md) ──

function humanizeText(text) {
  if (!text || typeof text !== 'string') return text;
  let t = text;

  // Section A: patterns removed entirely
  const removePatterns = [
    // "I understand" openers
    /I want to assure you that\s*/gi,
    /I want to assure you\s*/gi,
    /I understand your frustration\.?\s*/gi,
    /I understand your concern\.?\s*/gi,
    /I understand how (?:frustrating|difficult|challenging|inconvenient) this (?:can be|is|must be)\.?\s*/gi,
    /I completely understand\.?\s*/gi,
    /I totally understand\.?\s*/gi,
    // "Don't hesitate" closers
    /Please (?:don't|do not) hesitate to (?:reach out|contact us)\.?\s*/gi,
    /Don't hesitate to reach out\.?\s*/gi,
    /Feel free to (?:reach out|contact us)\.?\s*/gi,
    // Robotic enthusiasm
    /Rest assured,?\s*/gi,
    /Certainly!\s*/gi,
    /Absolutely!\s*/gi,
    /Of course!\s*/gi,
    /Great question!\s*/gi,
    /Great news!\s*/gi,
    /Good news!\s*/gi,
    // "Happy to help"
    /I'?d be happy to (?:help|assist)(?: you)?(?:\s+with that)?\.?\s*/gi,
    /I'?m happy to (?:help|assist)\.?\s*/gi,
    /I'?m here to help\.?\s*/gi,
    // Empty closers
    /I hope (?:this|that) (?:helps|resolves your issue|information is helpful)\.?\s*/gi,
    /Hope (?:this|that) helps\.?\s*/gi,
    // Filler openers & corporate padding
    /Thank you for your patience and understanding\.?\s*/gi,
    /Thank you for your understanding\.?\s*/gi,
    /Thank you for bringing this to our attention\.?\s*/gi,
    /Thank you for contacting us\.?\s*/gi,
    /Thank you for reaching out to us\.?\s*/gi,
    /I appreciate your patience\.?\s*/gi,
    /I appreciate you reaching out\.?\s*/gi,
    /We appreciate your patience\.?\s*/gi,
    /We value you as a customer\.?\s*/gi,
    /We value your (?:business|loyalty)\.?\s*/gi,
    /Your satisfaction is (?:our|my)(?: top)? priority\.?\s*/gi,
    // Wordy padding
    /Please be advised that\s*/gi,
    /I wanted to let you know that\s*/gi,
    /I just wanted to follow up and\s*/gi,
    /I'?m writing to inform you that\s*/gi,
    /As per our (?:conversation|discussion|records),?\s*/gi,
    /As mentioned (?:earlier|previously|above),?\s*/gi,
  ];
  for (const pat of removePatterns) {
    t = t.replace(pat, '');
  }

  // Section B: formal-to-casual replacements
  const replacements = [
    // Apologies
    [/I sincerely apologize/gi, "I'm really sorry"],
    [/I deeply apologize/gi, "I'm really sorry"],
    [/I apologize for (?:the |any )?(?:inconvenience|issues|trouble|difficulties)/gi, 'sorry about that'],
    [/We apologize for the inconvenience/gi, 'sorry about that'],
    [/We sincerely apologize/gi, "we're really sorry"],
    // Transition words
    [/Furthermore,/g, 'Also,'],
    [/Additionally,/g, 'Also,'],
    [/Moreover,/g, 'Also,'],
    [/However,/g, 'But'],
    [/Nevertheless,/g, 'Still,'],
    [/Consequently,/g, 'So'],
    [/Therefore,/g, 'So'],
    // Wordy phrases
    [/I(?:'ve| have) gone ahead and\s*/gi, "I've "],
    [/In the meantime,/gi, 'For now,'],
    [/At this (?:time|point in time),/gi, 'Right now,'],
    [/I(?:'d| would) be (?:happy|glad) to/gi, 'I can'],
    [/I can confirm that\s*/gi, ''],
    [/I can assure you that\s*/gi, ''],
    [/Please note that\s*/gi, 'Just so you know, '],
    [/Please be aware that\s*/gi, 'Just so you know, '],
    [/Kindly\b/gi, 'Please'],
    [/Regarding\b/gi, 'About'],
    [/(?:In|With) regards? to\b/gi, 'About'],
    [/In order to\b/gi, 'To'],
    [/Due to the fact that\b/gi, 'Because'],
    [/At your earliest convenience/gi, 'When you get a chance'],
    [/Moving forward/gi, 'Going forward'],
    [/Prior to\b/gi, 'Before'],
    // Formal vocabulary
    [/\butilizing\b/gi, 'using'],
    [/\butilize\b/gi, 'use'],
    [/\bfacilitate\b/gi, 'help with'],
    [/\bendeavor\b/gi, 'try'],
    [/\bcommence\b/gi, 'start'],
  ];
  for (const [pat, rep] of replacements) {
    t = t.replace(pat, rep);
  }

  // Section C: punctuation fixes
  // Em dashes → spaced hyphens
  t = t.replace(/\u2014/g, ' - ');
  t = t.replace(/\u2013/g, ' - ');
  // Semicolons → periods
  t = t.replace(/;\s*/g, '. ');
  // Exclamation marks: keep only the first one
  let exclamationCount = 0;
  t = t.replace(/!/g, () => {
    exclamationCount++;
    return exclamationCount <= 1 ? '!' : '.';
  });

  // Cleanup
  t = t.replace(/ {2,}/g, ' ');           // double spaces
  t = t.replace(/^ +/gm, '');             // leading spaces on lines
  t = t.replace(/\.\.\s/g, '. ');         // stray double periods
  t = t.replace(/\n{3,}/g, '\n\n');       // excessive blank lines
  // Re-capitalize after removals (lowercase letter after ". " or start of line)
  t = t.replace(/\.\s+([a-z])/g, (_, c) => '. ' + c.toUpperCase());
  t = t.replace(/^([a-z])/gm, (_, c) => c.toUpperCase());

  return t.trim();
}

// ── PostHog Integration ──────────────────────────────────────

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || '';
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID || '';

/**
 * Query PostHog for recent events by customer email.
 * Uses HogQL to query by person property $email.
 */
async function queryPostHog(email) {
  if (!POSTHOG_API_KEY || !POSTHOG_PROJECT_ID) {
    return { events: [], error: 'PostHog not configured' };
  }

  const safeEmail = email.replace(/'/g, "''").trim().toLowerCase();

  try {
    const resp = await axios.post(
      `https://us.posthog.com/api/projects/${POSTHOG_PROJECT_ID}/query`,
      {
        query: {
          kind: 'HogQLQuery',
          query: `SELECT event, timestamp, properties FROM events WHERE person.properties.$email = '${safeEmail}' ORDER BY timestamp DESC LIMIT 50`,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${POSTHOG_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const results = resp.data?.results || [];
    const events = results.map(row => ({
      event: row[0],
      timestamp: row[1],
      properties: typeof row[2] === 'string' ? JSON.parse(row[2]) : (row[2] || {}),
    }));

    return { events };
  } catch (err) {
    console.warn('  ⚠ PostHog query failed:', err.response?.data?.detail || err.message);
    return { events: [], error: err.message };
  }
}

/**
 * Detect friction signals from PostHog event stream.
 * Returns an array of friction signals with type, severity, and context.
 */
function detectPostHogFriction(events) {
  const signals = [];

  // 1. Payment failed, no purchase after
  const paymentFailed = events.find(e => e.event === 'payment_failed');
  const purchased = events.find(e => e.event === 'purchase');
  if (paymentFailed && !purchased) {
    signals.push({
      type: 'payment_failed_no_retry',
      severity: 'high',
      label: 'Payment failed — no successful purchase',
      event: paymentFailed,
    });
  }

  // 2. eSIM activation failed
  const esimFailed = events.find(e => e.event === 'af_esim_activation_failed');
  if (esimFailed) {
    const device = esimFailed.properties?.$browser || esimFailed.properties?.$os || 'unknown device';
    signals.push({
      type: 'esim_activation_failed',
      severity: 'high',
      label: 'eSIM activation failed (' + device + ')',
      event: esimFailed,
    });
  }

  // 3. eSIM page viewed but no attempt (stalled >2hrs)
  const esimView = events.find(e => e.event === 'af_esim_activation_attempt_view');
  const esimAttempt = events.find(e => e.event === 'af_esim_activation_attempt');
  if (esimView && !esimAttempt) {
    const viewAge = Date.now() - new Date(esimView.timestamp).getTime();
    if (viewAge > 2 * 3600000) {
      signals.push({
        type: 'esim_view_no_attempt',
        severity: 'medium',
        label: 'Viewed eSIM install page but never attempted — stalled',
        event: esimView,
      });
    }
  }

  // 4. Repeated login failures (3+)
  const loginFails = events.filter(e => e.event === 'af_auto_login_failed');
  if (loginFails.length >= 3) {
    signals.push({
      type: 'repeated_login_failure',
      severity: 'medium',
      label: 'Repeated login failures (' + loginFails.length + ' attempts)',
      count: loginFails.length,
    });
  }

  // 5. Mochi failed
  const mochiFailed = events.find(e => e.event === 'af_mochi_failed');
  if (mochiFailed) {
    signals.push({
      type: 'mochi_failed',
      severity: 'low',
      label: 'Mochi chatbot interaction failed',
      event: mochiFailed,
    });
  }

  // 6. Survey abandoned (if they come back later)
  const surveyAbandoned = events.find(e => e.event === 'survey_step_1_abandoned');
  const orderCreated = events.find(e => e.event === 'survey_order_created');
  if (surveyAbandoned && !orderCreated) {
    signals.push({
      type: 'survey_abandoned',
      severity: 'low',
      label: 'Survey abandoned at step 1 — never completed order',
      event: surveyAbandoned,
    });
  }

  return signals;
}

// ── POST /api/customer/search ────────────────────────────────

router.post('/search', async (req, res) => {
  const { search } = req.body;
  if (!search) return res.status(400).json({ error: 'search term required' });

  try {
    const result = await bossApi('get', `/customer/search/${encodeURIComponent(search)}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cohort Detection (demo — replace with prod table lookup) ─

const COHORT_PLAYBOOKS = {
  SSC: { hint: 'Super Secret Club — free for life, concierge handling' },
  FDT: { hint: 'First Day Tribe — deposit paid, first month free' },
  Referral: { hint: 'Referred customer — great experience is critical' },
  DraftConversion: { hint: 'Converted via walkthrough call — high intent, support activation' },
  Regular: { hint: null },
};

/**
 * Detect customer cohort from available data signals.
 * DEMO: Uses heuristics. In production, replace with a single table lookup.
 */
function detectCohort(rows, orders) {
  // 1. Check stripe metadata for cohort marker (if present)
  const first = rows[0] || {};
  const metadata = first.metadata || first.stripe_metadata || '';
  const metaStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);

  if (/ssc|super.?secret/i.test(metaStr)) {
    return { cohort: 'SSC', ...COHORT_PLAYBOOKS.SSC };
  }
  if (/fdt|first.?day.?tribe|waitlist/i.test(metaStr)) {
    return { cohort: 'FDT', ...COHORT_PLAYBOOKS.FDT };
  }
  if (/referr/i.test(metaStr)) {
    return { cohort: 'Referral', ...COHORT_PLAYBOOKS.Referral };
  }

  // 2. Draft→Conversion: requires explicit marker (walkthrough call booking data).
  //    Cannot be inferred from order status alone — DRAFT→COMPLETED is normal flow.
  //    Detected via Zendesk tags in enrichCohortFromTags() or future prod table.
  if (/draft.?convert|walkthrough/i.test(metaStr)) {
    return { cohort: 'DraftConversion', ...COHORT_PLAYBOOKS.DraftConversion };
  }

  return { cohort: 'Regular', ...COHORT_PLAYBOOKS.Regular };
}

/**
 * Enrich cohort from Zendesk ticket tags (called during agent-brief when we have ticket data).
 * If cohort is already non-Regular from data signals, keep it. Tags override Regular.
 */
function enrichCohortFromTags(customer, tickets) {
  if (customer.cohort && customer.cohort !== 'Regular') return; // already detected

  const allTags = [];
  const allTickets = (tickets && tickets.tickets) || [];
  for (const t of allTickets) {
    if (t.tags) allTags.push(...t.tags);
  }
  const tagStr = allTags.join(' ').toLowerCase();

  if (/\bssc\b|super.?secret/.test(tagStr)) {
    customer.cohort = 'SSC';
    customer.cohortHint = COHORT_PLAYBOOKS.SSC.hint;
  } else if (/\bfdt\b|first.?day/.test(tagStr)) {
    customer.cohort = 'FDT';
    customer.cohortHint = COHORT_PLAYBOOKS.FDT.hint;
  } else if (/\breferr/.test(tagStr)) {
    customer.cohort = 'Referral';
    customer.cohortHint = COHORT_PLAYBOOKS.Referral.hint;
  } else if (/\bdraft.?convert|\bwalkthrough/.test(tagStr)) {
    customer.cohort = 'DraftConversion';
    customer.cohortHint = COHORT_PLAYBOOKS.DraftConversion.hint;
  }
}

// ── Shared customer lookup logic ─────────────────────────────

async function performCustomerLookup(email) {
  const safeEmail = email.replace(/'/g, "''").trim().toLowerCase();
  console.log(`  → Customer lookup: ${safeEmail}`);

  const mainQuery = await databricksQuery(`
    SELECT sc.user_id, sc.customer_email, sc.customer_name, sc.customer_phone,
      sc.individual_id, sc.stripe_customer_id,
      o.order_id, o.status AS order_status, o.esim_status,
      o.select_number_type, o.portin_response, o.created_at AS order_created_at,
      uf.payment_completed_time, uf.activation_completed_time,
      uf.order_completed_time, uf.number_selection_completed_time,
      uf.imei_checking_completed_time, uf.pet_insurance_completed_time,
      uf.completed_time AS onboarding_completed_time
    FROM \`rds-prod_catalog\`.cj_prod.stripe_customers sc
    LEFT JOIN \`rds-prod_catalog\`.cj_prod.mvno_order o ON sc.user_id = o.user_id
    LEFT JOIN \`rds-prod_catalog\`.cj_prod.user_onboarding_flow uf
      ON sc.user_id = uf.user_id AND o.order_id = uf.order_id
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

  // ── Cohort detection ──
  const cohortInfo = detectCohort(allRows, Array.from(orderMap.values()));

  const result = {
    found: true,
    customer: {
      userId: first.user_id,
      email: first.customer_email,
      name: first.customer_name,
      phone: first.customer_phone,
      individualId: first.individual_id,
      stripeCustomerId: first.stripe_customer_id,
      cohort: cohortInfo.cohort,
      cohortHint: cohortInfo.hint,
    },
    orders: Array.from(orderMap.values()),
    individual: null,
    simProducts: null,
    portStatus: null,
    mochi: null,
    brazeEmails: null,
    journeyRetries: null,
  };

  // Parallel — Boss API (individual, SIM) + Databricks (Mochi)
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

  // Braze email campaign history
  tasks.push(
    databricksQuery(`
      SELECT campaign_name, message_variation_id, FROM_UNIXTIME(time) AS sent_at
      FROM prod_catalog.marketing.braze_email_events
      WHERE email_address = '${safeEmail}'
      ORDER BY time DESC LIMIT 10
    `).then(d => {
      if (!d.error && d.rows && d.rows.length > 0) {
        result.brazeEmails = d.rows.map(row => {
          const o = {}; d.columns.forEach((c, i) => { o[c] = row[i]; }); return o;
        });
      }
    }).catch(() => {})
  );

  // PostHog journey retries — events that occurred more than once (friction signals)
  tasks.push(
    databricksQuery(`
      SELECT a.event, count(*) AS attempts
      FROM prod_catalog.silver.posthog_customer_journey a
      JOIN \`rds-prod_catalog\`.cj_prod.certification b ON a.af_user_id = b.user_id
      WHERE b.user_name = '${safeEmail}'
        AND a.event NOT IN (
          'af_page_view', 'Application Became Active', 'af_app_opened',
          'Application Installed', 'af_sentry', 'af_app_foreground',
          'af_app_background', 'af_cold_start', 'Application Backgrounded',
          'af_auto_login_attempt', 'af_auto_login', 'Application Opened',
          '\\$identify', 'af_page_exit'
        )
      AND a.event NOT RLIKE '(?i)(_view$|_viewed$|_screen$|_page$|_opened$|_started$|_loaded$|_displayed$|^tutorial|^mochi$|^af_mochi$|_status$|_check$)'
      GROUP BY a.event
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 20
    `).then(d => {
      if (!d.error && d.rows && d.rows.length > 0) {
        result.journeyRetries = d.rows.map(row => {
          const o = {}; d.columns.forEach((c, i) => { o[c] = row[i]; }); return o;
        });
      }
    }).catch(() => {})
  );

  await Promise.allSettled(tasks);

  // Port-in check (needs MSISDN from individual)
  const ind = result.individual;
  const msisdn = ind?.msisdn || (Array.isArray(ind) ? ind[0]?.msisdn : null);
  if (msisdn) {
    result.msisdn = msisdn;
    const hasPortIn = result.orders.some(o =>
      o.selectNumberType === 'PORTIN' ||
      (o.portinResponse && o.portinResponse.includes('PortInMSISDN'))
    );
    if (hasPortIn) {
      try {
        const p = await bossApi('get', `/order/getportstatus/${msisdn}`);
        if (!p.error) result.portStatus = p;
      } catch (e) { /* skip */ }
    }
  }

  // Fetch order execution + RCA for most recent order (used by AI escalation package)
  if (result.orders.length > 0) {
    const primaryOrderId = result.orders[0].orderId;
    const execTasks = [];
    execTasks.push(
      bossApi('get', `/order/execution/${primaryOrderId}`)
        .then(d => { if (!d.error) result.orderExecution = d; })
        .catch(() => {})
    );
    execTasks.push(
      bossApi('get', `/report/order/rca/${primaryOrderId}`)
        .then(d => { if (!d.error) result.orderRca = d; })
        .catch(() => {})
    );
    await Promise.allSettled(execTasks);
  }

  // v3.1: Optional Databricks brand lookup (table may not exist yet)
  const brandTable = process.env.DATABRICKS_BRAND_TABLE || 'rds-prod_catalog.cj_prod.customer_brand_mapping';
  const brandCol = process.env.DATABRICKS_BRAND_COLUMN || 'brand';
  try {
    const brandQuery = await databricksQuery(`
      SELECT ${brandCol} FROM \`${brandTable.replace(/\./g, '`.`')}\`
      WHERE LOWER(customer_email) = '${safeEmail}' LIMIT 1
    `);
    if (!brandQuery.error && brandQuery.rows && brandQuery.rows.length > 0) {
      const brandValue = brandQuery.rows[0][0];
      if (brandValue) result.databricksBrand = brandValue;
    }
  } catch (e) {
    // Table/column doesn't exist yet — silently continue
  }

  // v3.0: Resolve LOB from Boss API plan data + Databricks brand
  const lobResult = resolveLob(result, null);
  result.lob = lobResult;

  console.log(`  ✓ Lookup: ${result.orders.length} order(s), individual: ${!!result.individual}, mochi: ${result.mochi?.length || 0}, lob: ${lobResult ? lobResult.lobId : 'undetected'}`);
  return result;
}

// ── POST /api/customer/lookup ────────────────────────────────

router.post('/lookup', async (req, res) => {
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
  if (mochi && mochi.length > 0) {
    const cat = mochi[0].category;
    if (cat && cat !== 'null') return cat.replace(/_/g, ' ');
  }
  if (tickets && tickets.length > 0) {
    const subj = tickets[0].subject;
    if (subj) return subj.replace(/\[.*?\]/g, '').trim().slice(0, 60);
  }
  return 'help';
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
  contacts.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });
  return contacts;
}

function identifyCurrentProblem(lookup, tickets, commentArrays, posthogFriction) {
  // 1. Ticket-based detection — parse Zendesk intent tags + ticket content (highest priority)
  const allTickets = (tickets && tickets.tickets) || [];
  if (allTickets.length > 0) {
    const recent = allTickets[0]; // most recent ticket
    const tags = (recent.tags || []).join(' ').toLowerCase();
    const subject = (recent.subject || '').toLowerCase();
    const desc = (recent.description || '').toLowerCase();

    // Also check ticket comments for richer context
    let commentText = '';
    if (commentArrays && commentArrays.length > 0) {
      for (const comments of commentArrays) {
        if (Array.isArray(comments)) {
          for (const c of comments) {
            if (c.body) commentText += ' ' + c.body.toLowerCase();
          }
        }
      }
    }
    const fullText = (subject + ' ' + desc + ' ' + commentText).toLowerCase();

    // 0. Structured intent tag (from Mochi/Zendesk classification) — most reliable signal
    const intentTag = (recent.tags || []).find(t => /^(inquiry|issue|request)____/.test(t));
    if (intentTag) {
      const parts = intentTag.split('____').filter(Boolean);
      const category = parts[0]; // inquiry, issue, request
      const area = (parts[1] || '').replace(/_/g, ' ').trim();
      const detail = (parts[2] || '').replace(/_/g, ' ').trim();
      const tagLower = intentTag.toLowerCase();

      // Let refund/billing/cancellation fall through to their specialized handlers
      if (!tagLower.includes('refund') && !tagLower.includes('billing') &&
          !tagLower.includes('payment') && !tagLower.includes('cancellation') &&
          !tagLower.includes('termination')) {

        const typeMap = {
          'sign up': 'signup', 'new account': 'signup', 'eligibility': 'signup',
          'account / app': 'account', 'account/app': 'account', 'meow app': 'account',
          'portin': 'portin', 'number selection': 'portin',
          'network/connectivity': 'network', 'network / connectivity': 'network',
          'roaming': 'network',
          'esim': 'esim',
          'plans & services': 'plans', 'plans   services': 'plans',
          'referral': 'referral',
          'airvet': 'airvet', 'televet': 'airvet',
          'suspension': 'suspension',
          'data/privacy': 'privacy',
          'promotions': 'promotions', 'waitlist': 'promotions',
        };

        const areaLower = area.toLowerCase();
        let problemType = 'general';
        for (const [key, val] of Object.entries(typeMap)) {
          if (areaLower.includes(key) || (detail && detail.toLowerCase().includes(key))) {
            problemType = val; break;
          }
        }

        const capitalize = s => s.replace(/\b\w/g, c => c.toUpperCase());
        let label = capitalize(area);
        if (detail) label += ' — ' + capitalize(detail);
        if (category === 'issue') label += ' (reported issue)';
        else if (category === 'request') label += ' (request)';
        else if (category === 'inquiry') label += ' (inquiry)';

        return { problem: label, confidence: 'high', type: problemType };
      }
    }

    // Refund request — from intent tags, request tags, or text
    if (tags.includes('intent__billing__refund') || tags.includes('refund_request') ||
        /request____.*refund/.test(tags) ||
        /\b(refund|money back|give me my money|return my money)\b/.test(fullText)) {
      const amount = fullText.match(/\$[\d.]+|\d+\s*cents?/);
      const amountStr = amount ? ' (' + amount[0] + ')' : '';
      let detail = 'Customer requesting refund' + amountStr;
      if (/\b(cancel|terminat)\b/.test(fullText)) detail += ' and wants to cancel service';
      return { problem: detail, confidence: 'high', type: 'refund' };
    }

    // Cancellation / account removal
    if (tags.includes('intent__cancellation') || tags.includes('cancel') ||
        /\b(cancel|remove me|unsubscribe|stop|don't want|do not want)\b/.test(fullText)) {
      if (/\b(refund|money)\b/.test(fullText)) {
        return { problem: 'Customer wants to cancel and get a refund', confidence: 'high', type: 'refund' };
      }
      return { problem: 'Customer requesting account cancellation', confidence: 'high', type: 'cancellation' };
    }

    // Billing dispute (not just refund)
    if (tags.includes('intent__billing') || /\b(overcharg|double.?charg|wrong.?amount|billing.?issue|unauthorized.?charge)\b/.test(fullText)) {
      let detail = 'Billing dispute';
      if (/double.?charg/.test(fullText)) detail += ' — double charge reported';
      else if (/overcharg/.test(fullText)) detail += ' — customer reports overcharge';
      else if (/unauthorized/.test(fullText)) detail += ' — unauthorized charge reported';
      else detail += ' — customer reports incorrect charges';
      return { problem: detail, confidence: 'high', type: 'billing_dispute' };
    }

    // Coverage / network issues from ticket — with specific sub-type
    if (tags.includes('intent__network') || tags.includes('intent__coverage') ||
        /\b(no signal|no service|no coverage|can't make calls|dropped call|can't send|can't receive|sms|text message|outgoing|incoming|data|wifi calling|voicemail|mms)\b/.test(fullText)) {
      let detail = 'Network or coverage issue';
      if (/\b(can't send|can't receive|outgoing).*(sms|text|message)\b/.test(fullText)) detail = 'Outgoing SMS/text messages not working';
      else if (/\b(sms|text message).*(not|can't|unable|fail)\b/.test(fullText)) detail = 'SMS/text messaging issue';
      else if (/\b(incoming).*(call|sms|text)\b/.test(fullText)) detail = 'Not receiving incoming calls or texts';
      else if (/\bcan't make calls\b/.test(fullText)) detail = 'Unable to make outgoing calls';
      else if (/\bdropped call\b/.test(fullText)) detail = 'Experiencing dropped calls';
      else if (/\b(no signal|no service)\b/.test(fullText)) detail = 'No signal or service';
      else if (/\bno coverage\b/.test(fullText)) detail = 'No coverage in area';
      else if (/\b(data|internet).*(not|slow|can't|unable)\b/.test(fullText)) detail = 'Mobile data not working';
      else if (/\b(wifi calling|wi-fi calling)\b/.test(fullText)) detail = 'WiFi calling issue';
      else if (/\bvoicemail\b/.test(fullText)) detail = 'Voicemail issue';
      return { problem: detail, confidence: 'high', type: 'network' };
    }

    // Sentiment: very negative with dissatisfaction
    if (tags.includes('sentiment__negative') && tags.includes('dissatisfaction')) {
      // Fall through to order-based checks but flag sentiment
    }
  }

  // 2. PostHog friction signals (NEW — between ticket-based and order-based)
  if (posthogFriction && posthogFriction.length > 0) {
    // Check high-severity signals first
    const highSignals = posthogFriction.filter(f => f.severity === 'high');
    for (const signal of highSignals) {
      if (signal.type === 'esim_activation_failed') {
        return { problem: 'eSIM activation failed (detected from app behavior)', confidence: 'high', type: 'esim' };
      }
      if (signal.type === 'payment_failed_no_retry') {
        return { problem: 'Payment failed with no successful retry (detected from app behavior)', confidence: 'high', type: 'payment' };
      }
    }

    // Medium-severity signals
    const medSignals = posthogFriction.filter(f => f.severity === 'medium');
    for (const signal of medSignals) {
      if (signal.type === 'esim_view_no_attempt') {
        return { problem: 'Customer stalled on eSIM install — viewed page but never attempted', confidence: 'medium', type: 'esim' };
      }
      if (signal.type === 'repeated_login_failure') {
        return { problem: 'Repeated login failures (' + (signal.count || 'multiple') + ' attempts)', confidence: 'medium', type: 'login_issue' };
      }
    }
  }

  // 3. Order/system-based detection (existing logic)
  if (!lookup || !lookup.found) return null;

  const orders = lookup.orders || [];
  const mochi = lookup.mochi || [];

  // eSIM ERROR/FAILED from order
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

  return null;
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

  const deviceMatch = text.match(/\b(iPhone\s*\d{1,2}(?:\s*Pro(?:\s*Max)?)?|Samsung\s+Galaxy\s+\S+|Google\s+Pixel\s+\S+|iPad\s*(?:Pro|Air|Mini)?)/i);
  if (deviceMatch) info.Device = deviceMatch[0];
  else if (/android/i.test(text) && !/iphone|ipad/i.test(text)) info.Device = 'Android device';
  else if (/iphone/i.test(text)) info.Device = 'iPhone';

  const browserMatch = text.match(/\b(Chrome|Safari|Firefox|Edge|Opera)\b/i);
  if (browserMatch) info.Browser = browserMatch[0];

  const iosMatch = text.match(/iOS\s*([\d.]+)/i);
  if (iosMatch) info['OS Version'] = 'iOS ' + iosMatch[1];
  const androidMatch = text.match(/Android\s*([\d.]+)/i);
  if (androidMatch) info['OS Version'] = 'Android ' + androidMatch[1];

  const errorMatch = text.match(/(?:error|failed|failure)[:\s]+(.{10,80})/i);
  if (errorMatch) info['Error Message'] = errorMatch[1].trim();

  return info;
}

function buildNextSteps(problem, kbArticles, lookup, customerName, channel, tier, infoCollected, lobId) {
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
      // Check if we already have device info
      let esimDevice = (infoCollected && infoCollected.Device) ? infoCollected.Device : null;
      if (!esimDevice && lookup && lookup.individual && lookup.individual.products) {
        for (const p of lookup.individual.products) {
          if (p.productCharacteristic) {
            const devChar = p.productCharacteristic.find(ch => ch.name && ch.name.toUpperCase().indexOf('DEVICE') !== -1 && ch.value);
            if (devChar) { esimDevice = devChar.value; break; }
          }
        }
      }
      if (esimDevice) {
        steps.push({ type: 'ai_done', text: 'Device', result: esimDevice, status: 'ok' });
        steps.push({ type: 'ask_info', text: 'Confirm whether customer scanned the QR code', sla: resolveSla(problem.type, 'ask_info', channel) });
      } else {
        steps.push({ type: 'ask_info', text: 'Ask customer for device model and whether they scanned the QR code', sla: resolveSla(problem.type, 'ask_info', channel) });
      }
      steps.push({ type: 'customer_action', text: 'Guide customer through manual eSIM installation if QR failed', sla: resolveSla(problem.type, 'customer_action', channel) });
      break;
    }
    case 'payment': {
      // Auto-resolve: show payment status from lookup
      const payOrder = (lookup && lookup.orders) ? lookup.orders[0] : null;
      const payDone = payOrder ? payOrder.paymentCompleted : null;
      const payResult = payDone ? ('Payment completed at ' + payDone) : 'Payment NOT completed';
      steps.push({ type: 'ai_done', text: 'Payment Status', result: payResult, status: payDone ? 'ok' : 'issue' });
      steps.push({ type: 'customer_action', text: 'Suggest customer retry with a different payment method', sla: resolveSla(problem.type, 'customer_action', channel) });
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

      // Surface port-out PIN from Boss API partyCharacteristic if available
      const portInd = lookup ? lookup.individual : null;
      const portChars = portInd && portInd.partyCharacteristic ? portInd.partyCharacteristic : [];
      const pinChar = portChars.find(ch => ch.name && /pin/i.test(ch.name) && ch.value);
      if (pinChar) {
        steps.push({ type: 'ai_done', text: 'Port-out PIN (on file)', result: pinChar.value, status: 'ok' });
        steps.push({ type: 'ask_info', text: 'Confirm account number with previous carrier (PIN already on file)', sla: resolveSla(problem.type, 'ask_info', channel) });
      } else {
        steps.push({ type: 'ask_info', text: 'Ask customer for previous carrier account number and PIN', sla: resolveSla(problem.type, 'ask_info', channel) });
      }
      steps.push({ type: 'customer_action', text: 'If rejected, ask customer to contact previous carrier for correct details', sla: resolveSla(problem.type, 'customer_action', channel) });
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
      steps.push({ type: 'customer_action', text: 'Address the specific issue the chatbot could not resolve', sla: resolveSla(problem.type, 'customer_action', channel) });
      break;
    }
    case 'refund': {
      // Auto-resolve: check payment/refund history
      const refundOrder = (lookup && lookup.orders) ? lookup.orders[0] : null;
      const payStatus = refundOrder && refundOrder.paymentCompleted ? 'Payment completed at ' + refundOrder.paymentCompleted : 'No completed payment found';
      steps.push({ type: 'ai_done', text: 'Payment History', result: payStatus, status: refundOrder && refundOrder.paymentCompleted ? 'info' : 'ok' });
      steps.push({ type: 'ai_done', text: 'Account Status', result: refundOrder ? ('Order status: ' + (refundOrder.status || 'unknown')) : 'No orders found', status: 'info' });
      steps.push({ type: 'customer_action', text: 'Process refund via Stripe dashboard and confirm cancellation', sla: resolveSla(problem.type, 'customer_action', channel) });
      steps.push({ type: 'customer_action', text: 'Confirm account cancellation and removal from email list', sla: resolveSla(problem.type, 'ask_info', channel) });
      break;
    }
    case 'cancellation': {
      const cancelOrder = (lookup && lookup.orders) ? lookup.orders[0] : null;
      steps.push({ type: 'ai_done', text: 'Account Status', result: cancelOrder ? ('Order: ' + (cancelOrder.status || 'unknown') + ', eSIM: ' + (cancelOrder.esimStatus || 'N/A')) : 'No orders found', status: 'info' });
      steps.push({ type: 'customer_action', text: 'Cancel account and confirm with customer', sla: resolveSla(problem.type, 'customer_action', channel) });
      break;
    }
    case 'billing_dispute': {
      const billingOrder = (lookup && lookup.orders) ? lookup.orders[0] : null;
      const hasPaymentDate = billingOrder && billingOrder.paymentCompleted;
      const billingResult = hasPaymentDate ? 'Payment completed at ' + billingOrder.paymentCompleted : 'No completed payment found';
      steps.push({ type: 'ai_done', text: 'Payment Status', result: billingResult, status: 'info' });
      // Show payment timestamp so agent doesn't need to ask for transaction date
      if (hasPaymentDate) {
        steps.push({ type: 'ai_done', text: 'Transaction Date (on file)', result: billingOrder.paymentCompleted, status: 'ok' });
        steps.push({ type: 'ask_info', text: 'Ask customer for disputed amount and last 4 digits of card (transaction date already on file)', sla: resolveSla(problem.type, 'ask_info', channel) });
      } else {
        steps.push({ type: 'ask_info', text: 'Ask customer for transaction date, amount, and last 4 digits of card', sla: resolveSla(problem.type, 'ask_info', channel) });
      }
      steps.push({ type: 'customer_action', text: 'Review Stripe transactions and resolve discrepancy', sla: resolveSla(problem.type, 'customer_action', channel) });
      break;
    }
    case 'login_issue': {
      const loginCount = (lookup && lookup.posthogFriction) ? lookup.posthogFriction.find(f => f.type === 'repeated_login_failure')?.count : null;
      steps.push({ type: 'ai_done', text: 'Login Failures', result: (loginCount || 'Multiple') + ' failed login attempts detected in app', status: 'issue' });
      steps.push({ type: 'customer_action', text: 'Check if account is active and credentials are correct, suggest password reset', sla: resolveSla('payment', 'customer_action', channel) });
      break;
    }
    case 'network': {
      // Diagnostic auto-checks — no ask_info, surface what the system already knows
      const ind = lookup ? lookup.individual : null;

      // Step 1: Device from Boss API productCharacteristic or ticket comments
      let netDevice = (infoCollected && infoCollected.Device) ? infoCollected.Device : null;
      if (!netDevice && ind && ind.products) {
        for (const p of ind.products) {
          if (p.productCharacteristic) {
            const devChar = p.productCharacteristic.find(ch => ch.name && ch.name.toUpperCase().indexOf('DEVICE') !== -1 && ch.value);
            if (devChar) { netDevice = devChar.value; break; }
          }
        }
      }
      steps.push({ type: 'ai_done', text: 'Device', result: netDevice || 'Not on file — check ticket comments', status: netDevice ? 'ok' : 'info' });

      // Step 2: Service Line — MSISDN from Boss API
      const netMsisdn = ind?.msisdn || (Array.isArray(ind) ? ind[0]?.msisdn : null) || lookup?.msisdn;
      steps.push({ type: 'ai_done', text: 'Service Line', result: netMsisdn ? ('MSISDN ' + netMsisdn) : 'MSISDN not available', status: netMsisdn ? 'ok' : 'issue' });

      // Step 3: Line Status — individual status from Boss API
      const indStatus = ind ? (ind.status || (Array.isArray(ind) ? ind[0]?.status : null)) : null;
      const lineActive = indStatus && String(indStatus).toUpperCase() === 'ACTIVE';
      steps.push({ type: 'ai_done', text: 'Line Status', result: indStatus ? String(indStatus) : 'Unknown', status: lineActive ? 'ok' : 'issue' });

      // Step 4: SIM Status — from simProducts
      const netSimInfo = lookup && lookup.simProducts;
      let netSimStatus = 'Unknown';
      let netSimOk = false;
      if (netSimInfo) {
        const simItems = Array.isArray(netSimInfo) ? netSimInfo : (netSimInfo.content || [netSimInfo]);
        const firstSim = simItems[0];
        if (firstSim && firstSim.status) {
          netSimStatus = firstSim.status;
          netSimOk = ['ACTIVE', 'PROVISIONED'].includes(String(firstSim.status).toUpperCase());
        }
      }
      steps.push({ type: 'ai_done', text: 'SIM Status', result: netSimStatus, status: netSimOk ? 'ok' : 'issue' });

      // Step 5: If line not active, flag for reactivation
      if (!lineActive && indStatus) {
        steps.push({ type: 'customer_action', text: 'Line is ' + indStatus + ' — reactivate or escalate to provisioning', sla: resolveSla(problem.type, 'customer_action', channel) });
      }

      // Step 6: Check network outages
      steps.push({ type: 'customer_action', text: 'Check network outages for customer area', sla: resolveSla(problem.type, 'customer_action', channel) });

      // Step 7: Verify device settings
      steps.push({ type: 'customer_action', text: 'Verify data/cellular is enabled on device and APN is correct', sla: resolveSla(problem.type, 'customer_action', channel) });
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

  if (kbArticles && kbArticles.length > 0) {
    for (const a of kbArticles.slice(0, 2)) {
      steps.push({ type: 'kb_article', text: a.title, url: a.html_url });
    }
  }

  // Attach drafts based on agent tier (customer-facing reply; escalation email is separate)
  const draftType = resolveDraftType(tier, problem.type);
  const brandName = (lobId && getLob(lobId)) ? getLob(lobId).displayName : 'Meow Mobile';
  for (const step of steps) {
    if (step.type === 'customer_action' || step.type === 'ask_info') {
      if (draftType === 'vendor') {
        step.emailDraft = humanizeText(buildVendorDraft(problem.type, step.type, step.text, customerName, lookup, brandName));
      } else if (draftType === 'internal') {
        step.emailDraft = humanizeText(buildInternalDraft(problem.type, step.type, step.text, customerName, lookup));
      } else {
        step.emailDraft = humanizeText(buildEmailDraft(problem.type, step.type, step.text, customerName, brandName));
      }
    }
  }

  return steps;
}

function buildEmailDraft(problemType, stepType, stepText, customerName, brandName) {
  const name = customerName || 'there';
  const greeting = `Hi ${name},\n\n`;
  const brand = brandName || 'Meow Mobile';
  const signoff = `\n\nIf you have any questions, just reply to this email.\n\nBest,\n${brand} Support`;

  const templates = {
    'esim:customer_action': `${greeting}We noticed your eSIM may need to be set up manually. Here's how:\n\n1. Go to Settings > Cellular > Add eSIM\n2. Select "Enter Details Manually"\n3. Enter the activation details from your confirmation email\n4. Restart your device after setup\n\nIf you need help finding your activation details, just let us know!${signoff}`,
    'esim:ask_info': `${greeting}To help resolve your eSIM issue, could you please reply with:\n\n- Your device model (e.g., iPhone 15, Samsung Galaxy S24)\n- Whether you tried scanning the QR code or entering details manually\n- Any error messages you saw\n\nThis will help us get things sorted quickly.${signoff}`,
    'payment:customer_action': `${greeting}It looks like your recent payment didn't go through. Here are a few things to try:\n\n1. Double-check your card details are up to date\n2. Try a different payment method\n3. Make sure your bank isn't blocking the transaction\n\nYou can retry your payment in the ${brand} app or on our website.${signoff}`,
    'portin:ask_info': `${greeting}To complete your number transfer, we just need one detail. Could you please confirm:\n\n- Your account number with your previous carrier\n\nYou can usually find this in your old carrier's app, on a recent bill, or by calling them.${signoff}`,
    'portin:customer_action': `${greeting}Your number transfer needs a small update. Please contact your previous carrier and:\n\n1. Confirm your account number and PIN are correct\n2. Make sure your account is active (not suspended)\n3. Remove any port-out blocks on your line\n\nOnce that's done, let us know and we'll retry the transfer right away.${signoff}`,
    'mochi_escalation:customer_action': `${greeting}Thank you for your patience — I've reviewed your conversation with our chatbot and I'm here to personally help resolve this.\n\nI'm looking into your issue now and will follow up shortly with next steps.${signoff}`,
    'refund:customer_action': `${greeting}Thank you for reaching out. I completely understand your frustration and I'm sorry for the inconvenience.\n\nI've processed your refund and it should appear back in your account within 5-10 business days. Your account has been cancelled as requested.\n\nIf you have any questions about the refund, please don't hesitate to reply.\n\nWe wish you all the best!${signoff}`,
    'cancellation:customer_action': `${greeting}Thank you for letting us know. I've cancelled your account as requested.\n\nIf you ever decide to come back, we'd be happy to have you.\n\nWishing you all the best!${signoff}`,
    'billing_dispute:ask_info': `${greeting}I'm sorry to hear about the billing issue. We've located the transaction on our end. To investigate further, could you please share:\n\n- The amount you're disputing\n- The last 4 digits of the card that was charged\n\nThis will help me resolve this for you quickly.${signoff}`,
    'billing_dispute:customer_action': `${greeting}Thank you for your patience while we looked into this. I've reviewed the transaction and here's what I found:\n\n[REVIEW FINDINGS HERE]\n\nPlease let me know if you have any other questions.${signoff}`,
    'network:customer_action': `${greeting}I'm sorry you're experiencing connectivity issues. We've looked into your account and here are a few things to try:\n\n1. Make sure cellular data is turned on in your device settings\n2. Check that your APN settings are correct (Settings > Cellular > Cellular Data Network)\n3. Restart your device\n4. Toggle Airplane Mode on and off\n\nWe're also checking for any outages in your area. We'll update you shortly.${signoff}`,
  };

  const key = `${problemType}:${stepType}`;
  if (templates[key]) return templates[key];

  // Generic fallback
  return `${greeting}${stepText}\n\nPlease let us know if you need any help with this.${signoff}`;
}

// ── Problem types L1-3 can solve internally vs need vendor ──

const SOLVABLE_INTERNALLY = new Set([
  'refund', 'cancellation', 'billing_dispute', 'login_issue',
  'mochi_escalation', 'ai_synthesized',
]);

const VENDOR_MAP = {
  esim: 'ConnectX Provisioning',
  portin: 'Carrier Porting Team',
  network: 'Carrier Network Ops',
  airvet: 'Airvet Partner Team',
  order_failure: 'Engineering',
  voice_sms: 'Carrier Network Ops',
};

function resolveDraftType(tier, problemType) {
  if (tier !== 'L1+') return 'customer';
  if (!problemType) return 'internal';
  if (SOLVABLE_INTERNALLY.has(problemType)) return 'internal';
  return 'vendor';
}

// ── Escalation Recommendation ────────────────────────────────

function buildEscalationRecommendation(problem, lookup) {
  if (!problem) return null;
  const vendorTeam = VENDOR_MAP[problem.type];
  if (!vendorTeam) return null; // solvable internally — no escalation needed

  // Determine priority based on problem confidence and type
  let priority = 'medium';
  if (problem.confidence === 'high') priority = 'high';
  if (problem.type === 'order_failure') priority = 'high';

  // Build reason and suggested action based on problem type
  const ESCALATION_DETAILS = {
    esim: {
      reason: 'eSIM provisioning issues require carrier-level investigation',
      suggestedAction: 'Escalate to ConnectX with ICCID, device model, and activation error details',
    },
    portin: {
      reason: 'Port-in failures require coordination with the carrier porting team',
      suggestedAction: 'Escalate with MSISDN, previous carrier account number, PIN, and rejection reason',
    },
    network: {
      reason: 'Network/connectivity issues require carrier-level diagnostics',
      suggestedAction: 'Escalate to AT&T/carrier network ops with MSISDN, location, and symptom details',
    },
    airvet: {
      reason: 'Airvet activation or service issue requires partner coordination',
      suggestedAction: 'Escalate to Airvet partner team with customer ID and activation status',
    },
    order_failure: {
      reason: 'Order processing failure requires engineering investigation',
      suggestedAction: 'Escalate to internal engineering with order ID, RCA data, and failure point',
    },
    voice_sms: {
      reason: 'Voice/SMS/MMS issues require carrier-level diagnostics',
      suggestedAction: 'Escalate to carrier network ops with MSISDN, issue symptoms, and timestamps',
    },
  };

  const details = ESCALATION_DETAILS[problem.type] || {
    reason: 'Issue requires vendor/partner investigation',
    suggestedAction: 'Escalate with customer details and issue summary',
  };

  // Enrich suggested action with available data
  let suggestedAction = details.suggestedAction;
  const enrichments = [];
  if (lookup?.customer?.individualId) enrichments.push('Individual ID: ' + lookup.customer.individualId);
  if (lookup?.orders?.[0]?.orderId) enrichments.push('Order: ' + lookup.orders[0].orderId);
  if (lookup?.msisdn) enrichments.push('MSISDN: ' + lookup.msisdn);
  if (enrichments.length > 0) {
    suggestedAction += ' (' + enrichments.join(', ') + ')';
  }

  return {
    required: true,
    target: vendorTeam,
    reason: details.reason,
    priority,
    suggestedAction,
  };
}

function buildInternalDraft(problemType, stepType, stepText, customerName, lookup) {
  const name = customerName || 'Customer';
  const email = lookup?.customer?.email || 'N/A';
  const orderId = lookup?.orders?.[0]?.orderId || 'N/A';
  const orderStatus = lookup?.orders?.[0]?.status || 'N/A';
  const indId = lookup?.customer?.individualId || 'N/A';

  const templates = {
    'refund:customer_action': `Internal Note — Refund Processing\n\nCustomer: ${name} (${email})\nIndividual ID: ${indId}\nOrder: ${orderId} — Status: ${orderStatus}\nPayment: ${lookup?.orders?.[0]?.paymentCompleted ? 'Completed' : 'Not completed'}\n\nAction:\n- Process refund via Stripe dashboard\n- Cancel subscription if requested\n- Send confirmation email to customer after processing\n\nFollow-up: Verify refund reflected in 5-10 business days.`,
    'refund:ask_info': `Internal Note — Refund Investigation\n\nCustomer: ${name} (${email})\nOrder: ${orderId} — Status: ${orderStatus}\n\nNeeded before processing:\n- Confirm refund amount and transaction date\n- Check for partial vs full refund eligibility\n- Verify no chargeback already filed`,
    'cancellation:customer_action': `Internal Note — Account Cancellation\n\nCustomer: ${name} (${email})\nIndividual ID: ${indId}\n\nAction:\n- Terminate individual via Boss API\n- Cancel active subscriptions in Stripe\n- Send cancellation confirmation email\n\nNote: Check if customer wants data export before cancellation.`,
    'billing_dispute:customer_action': `Internal Note — Billing Dispute Resolution\n\nCustomer: ${name} (${email})\nOrder: ${orderId}\nPayment: ${lookup?.orders?.[0]?.paymentCompleted ? 'Completed at ' + lookup.orders[0].paymentCompleted : 'Not completed'}\n\nAction:\n- Review Stripe transaction history for discrepancies\n- Cross-reference with Boss API payment records\n- Document finding and resolution in ticket`,
    'billing_dispute:ask_info': `Internal Note — Billing Dispute\n\nCustomer: ${name} (${email})\n\nTransaction date already on file from Boss API/Stripe.\n\nNeeded from customer:\n- Disputed amount (may differ from records)\n- Last 4 digits of card charged\n- Compare against Stripe records`,
    'login_issue:customer_action': `Internal Note — Login Issue\n\nCustomer: ${name} (${email})\nIndividual ID: ${indId}\n\nAction:\n- Verify account is active in Boss API\n- Trigger password reset if needed\n- Check for account lock/suspension`,
    'mochi_escalation:customer_action': `Internal Note — Mochi Escalation\n\nCustomer: ${name} (${email})\nMochi category: ${lookup?.mochi?.[0]?.category || 'N/A'}\nMochi title: ${lookup?.mochi?.[0]?.title || 'N/A'}\n\nContext: Customer escalated from chatbot. Review Mochi conversation to avoid making them repeat.\n\nAction:\n- Address the specific issue Mochi couldn't resolve\n- Document resolution steps taken`,
  };

  const key = `${problemType}:${stepType}`;
  if (templates[key]) return templates[key];

  return `Internal Note\n\nCustomer: ${name} (${email})\nIndividual ID: ${indId}\nOrder: ${orderId} — Status: ${orderStatus}\n\nAction: ${stepText}`;
}

// ── Incident Intake: mandatory fields per template type ──────

const INTAKE_TEMPLATES = {
  'Subscriber Connectivity': [
    'ICCID', 'IMEI', 'SIM Type', 'Device Make/Model', 'Issue Start Date & Time',
    'Ongoing or Intermittent', 'Location (Full Address)', 'Latitude / Longitude',
    'Technology (4G/LTE/5G)', 'Signal Bars', 'Worked Before at Same Location',
    'Worked in Other Location', 'Issue Scope', 'Other Devices Affected',
    'Impact Description', 'Exact Error Message',
  ],
  'Port-In': [
    'Exact Error Message', 'New SIM ICCID', 'IMEI', 'Plan', 'Customer Full Name (OSP)',
    'OSP Account Number', 'OSP Account Address', 'SSN Last 4', 'Port-Out PIN',
    'Additional Notes',
  ],
  'Port-Out': [
    'Exact Error Message', 'Active SIM ICCID', 'IMEI', 'MSISDN', 'Current Pricing Plan',
    'Customer Full Name', 'OSP Account Number', 'OSP Account Address', 'SSN Last 4',
    'Port-Out PIN', 'Additional Notes',
  ],
  'API Issues': [
    'CSI Service Name', 'Environment', 'Conversation IDs',
    'XML Request Payload', 'XML Response Payload',
  ],
  'Order Processing': [
    'Order ID', 'Order Status', 'Failed Step', 'Error Code',
    'Error Message', 'Failure Timestamp', 'MSISDN',
    'Customer Name', 'Customer Email', 'Individual ID',
  ],
  'Billing Issues': [
    'MSISDN', 'Account ID', 'ICCID', 'Billing Issue Type',
    'Amount', 'Invoice Number', 'Billing Period', 'Current Plan',
    'Active Add-ons', 'Last Plan Change Date', 'Issue First Noticed',
    'Customer Expected Resolution',
  ],
  'Voice/SMS/MMS Issues': [
    'ICCID', 'IMEI', 'SIM Type', 'Device Make/Model', 'Issue Start Date & Time',
    'Ongoing or Intermittent', 'Location (Full Address)', 'Latitude / Longitude',
    'Technology (4G/LTE/5G)', 'Signal Bars', 'Worked Before at Same Location',
    'Worked in Other Location', 'Issue Scope', 'Other Devices Affected',
    'Impact Description', 'Exact Error Message',
  ],
};

// Map problem types → intake template types
const PROBLEM_TO_TEMPLATE = {
  esim: 'Subscriber Connectivity',
  network: 'Subscriber Connectivity',
  portin: 'Port-In',
  portout: 'Port-Out',
  order_failure: 'Order Processing',
  billing_dispute: 'Billing Issues',
  voice_sms: 'Voice/SMS/MMS Issues',
  airvet: 'Subscriber Connectivity',
};

function extractStructuredEvidence(lookup) {
  const ev = {
    // Order-level
    orderId: null, orderState: null, orderDate: null,
    paymentCompleted: null, esimStatus: null, portinResponse: null,
    // Execution-level (parsed from orderExecution)
    executionSteps: [],       // [{name, state}]
    failedSteps: [],          // names of failed/cancelled steps
    // RCA-level (parsed from orderRca)
    rcaFailedItems: [],       // [{parent, child, status}]
    rcaErrors: [],            // [{code, message}]
    rcaTimestamp: null,
    rcaApiCalls: null,
    // Port-level (parsed from portStatus)
    portState: null,
    portRejectionReason: null,
    portCarrierResponse: null,
    // Inferred (when raw data is sparse)
    inferredFailedStep: null,
    inferredFailureCategory: null,
    inferredErrorMessage: null,
    inferredImpactedSystem: null,
  };

  // --- Orders ---
  const order = lookup?.orders?.[0];
  if (order) {
    ev.orderId = order.orderId;
    ev.orderState = order.status;
    ev.orderDate = order.createdAt;
    ev.paymentCompleted = order.paymentCompleted;
    ev.esimStatus = order.esimStatus;
    ev.portinResponse = order.portinResponse;
  }

  // --- Execution (walk items, extract states) ---
  const exec = lookup?.orderExecution;
  if (exec?.productOrderItems) {
    for (const item of exec.productOrderItems) {
      const name = item.productOffering?.name || item.id;
      ev.executionSteps.push({ name, state: item.state });
      if (item.state === 'failed' || item.state === 'cancelled') {
        ev.failedSteps.push(`${name} (${item.state})`);
      }
    }
  }

  // --- RCA (walk workflow for issues, extract failed items) ---
  const rca = lookup?.orderRca;
  if (rca) {
    ev.rcaTimestamp = rca.timestamp;
    ev.rcaApiCalls = rca.apiCalls?.total;
    ev.rcaFailedItems = (rca.summary?.failedItems || []).map(f => ({
      parent: f.parent, child: f.child, status: f.status,
    }));
    for (const item of (rca.workflow?.items || [])) {
      for (const issue of (item.issues || [])) {
        ev.rcaErrors.push({
          code: issue.code || issue.errorCode || issue.error || null,
          message: issue.message || issue.errorMessage || issue.cause || null,
        });
      }
      for (const child of (item.children || [])) {
        for (const issue of (child.issues || [])) {
          ev.rcaErrors.push({
            code: issue.code || issue.errorCode || issue.error || null,
            message: issue.message || issue.errorMessage || issue.cause || null,
          });
        }
      }
    }
  }

  // --- Port status (parse instead of JSON dump) ---
  const port = lookup?.portStatus;
  if (port) {
    ev.portState = port.status || port.portStatus || port.state || null;
    ev.portRejectionReason = port.rejectionReason || port.reason || port.errorMessage || null;
    ev.portCarrierResponse = port.carrierResponse || port.donorResponse || null;
  }

  // --- Inferences (when raw data has no explicit failures) ---
  if (order && ev.rcaErrors.length === 0 && ev.rcaFailedItems.length === 0) {
    const st = String(order.status || '').toLowerCase();
    if (st === 'cancelled' && !order.paymentCompleted) {
      ev.inferredFailedStep = 'Payment Processing';
      ev.inferredFailureCategory = 'Payment Issue';
      ev.inferredErrorMessage = 'Payment not completed - order cancelled';
      ev.inferredImpactedSystem = 'Payment/Order Management System';
    } else if (st === 'failed') {
      ev.inferredFailedStep = 'Order Execution';
      ev.inferredFailureCategory = 'Order Processing Failure';
    } else if (order.esimStatus === 'ERROR' || order.esimStatus === 'FAILED') {
      ev.inferredFailedStep = 'eSIM Provisioning';
      ev.inferredFailureCategory = 'Provisioning Issue';
      ev.inferredErrorMessage = 'eSIM status: ' + order.esimStatus;
      ev.inferredImpactedSystem = 'ConnectX / SM-DP+';
    }
  }

  return ev;
}

function extractSimResource(lookup, type) {
  const simProducts = lookup?.simProducts;
  if (!simProducts) return null;
  const items = Array.isArray(simProducts) ? simProducts : (simProducts.content || [simProducts]);
  for (const item of items) {
    const resources = item?.realizingResource || [];
    for (const r of resources) {
      if (r.type === type) return r.value;
    }
  }
  return null;
}

function extractProductChar(lookup, name) {
  const ind = lookup?.individual;
  if (!ind?.products) return null;
  for (const p of ind.products) {
    for (const c of (p.productCharacteristic || [])) {
      if (c.name === name) return c.value;
    }
  }
  return null;
}

function computeIntakeFields(problemType, lookup) {
  const templateType = PROBLEM_TO_TEMPLATE[problemType] || 'Subscriber Connectivity';
  const mandatoryFields = INTAKE_TEMPLATES[templateType] || INTAKE_TEMPLATES['Subscriber Connectivity'];
  const vendorTeam = VENDOR_MAP[problemType] || 'Partner Team';

  // Extract all available data from APIs
  const iccid = extractSimResource(lookup, 'ICCID') || extractSimResource(lookup, 'iccid');
  const imei = extractSimResource(lookup, 'IMEI') || extractSimResource(lookup, 'imei');
  const msisdn = lookup?.msisdn || lookup?.customer?.phone || null;
  const orderId = lookup?.orders?.[0]?.orderId || null;
  const orderStatus = lookup?.orders?.[0]?.status || null;
  const esimStatus = lookup?.orders?.[0]?.esimStatus || null;
  const indId = lookup?.customer?.individualId || null;
  const customerName = lookup?.customer?.name || null;
  const email = lookup?.customer?.email || null;
  const planName = extractProductChar(lookup, 'planName') || extractProductChar(lookup, 'plan');
  const simType = extractProductChar(lookup, 'simType') || (esimStatus ? 'eSIM' : null);
  const portStatus = lookup?.portStatus?.status || lookup?.portStatus?.portStatus || null;

  // Map field names → auto-populated values
  const autoFill = {
    'ICCID': iccid,
    'New SIM ICCID': iccid,
    'Active SIM ICCID': iccid,
    'IMEI': imei,
    'MSISDN': msisdn,
    'SIM Type': simType,
    'Device Make/Model': null, // Must come from agent
    'Issue Start Date & Time': null,
    'Ongoing or Intermittent': null,
    'Location (Full Address)': null, // ZIP not acceptable per template
    'Latitude / Longitude': null,
    'Technology (4G/LTE/5G)': null,
    'Signal Bars': null,
    'Worked Before at Same Location': null,
    'Worked in Other Location': null,
    'Issue Scope': null,
    'Other Devices Affected': null,
    'Impact Description': null,
    'Exact Error Message': portStatus ? `Port status: ${portStatus}` : null,
    'Plan': planName,
    'Current Pricing Plan': planName,
    'Current Plan': planName,
    'Customer Full Name (OSP)': customerName,
    'Customer Full Name': customerName,
    'OSP Account Number': null,
    'OSP Account Address': null,
    'SSN Last 4': null,
    'Port-Out PIN': null,
    'Requested Carrier': null,
    'Additional Notes': null,
    'CSI Service Name': null,
    'Environment': null,
    'Conversation IDs': null,
    'XML Request Payload': null,
    'XML Response Payload': null,
    'Account ID': indId,
    'Billing Issue Type': null,
    'Amount': null,
    'Invoice Number': null,
    'Billing Period': null,
    'Active Add-ons': null,
    'Last Plan Change Date': null,
    'Issue First Noticed': null,
    'Customer Expected Resolution': null,
    // Order Processing fields (auto-filled from structured evidence)
    'Order ID': orderId,
    'Order Status': orderStatus,
    'Customer Name': customerName,
    'Customer Email': email,
    'Individual ID': indId,
  };

  // Enrich with structured evidence for execution-derived fields
  const execEvidence = extractStructuredEvidence(lookup);
  autoFill['Failed Step'] = execEvidence.rcaFailedItems.length > 0
    ? execEvidence.rcaFailedItems.map(f => f.parent).join(', ')
    : execEvidence.failedSteps.length > 0
      ? execEvidence.failedSteps.join(', ')
      : execEvidence.inferredFailedStep;
  autoFill['Error Code'] = execEvidence.rcaErrors.length > 0
    ? execEvidence.rcaErrors.map(e => e.code).filter(Boolean).join(', ') || null
    : null;
  autoFill['Error Message'] = execEvidence.rcaErrors.length > 0
    ? execEvidence.rcaErrors.map(e => e.message).filter(Boolean).join('; ') || null
    : execEvidence.inferredErrorMessage;
  autoFill['Failure Timestamp'] = execEvidence.rcaTimestamp || execEvidence.orderDate;

  const fields = mandatoryFields.map(field => ({
    field,
    value: autoFill[field] || null,
    source: autoFill[field] ? 'api' : 'agent',
  }));

  const filledCount = fields.filter(f => f.source === 'api').length;
  const completeness = Math.round((filledCount / fields.length) * 100);

  return { templateType, vendorTeam, fields, completeness };
}

function buildVendorDraft(problemType, stepType, stepText, customerName, lookup, brandName) {
  const intake = computeIntakeFields(problemType, lookup);
  const vendorTeam = intake.vendorTeam;
  const brand = brandName || 'Meow Mobile';
  const signoff = `\nPlease investigate and advise on next steps.\n\nThanks,\n${brand} Support`;

  // Build ConnectX-format field block from intake fields
  const fieldLines = intake.fields.map(f => {
    const val = f.value || '[NEEDS AGENT INPUT]';
    return `  ${f.field}: ${val}`;
  }).join('\n');

  // Trouble description varies by template type
  const troubleDescriptions = {
    'Subscriber Connectivity': 'eSIM Activation / Connectivity Issue',
    'Port-In': 'Port-In Request Failure',
    'Port-Out': 'Port-Out Request',
    'API Issues': 'API / System Error',
    'Billing Issues': 'Billing Discrepancy',
    'Voice/SMS/MMS Issues': 'Voice/SMS/MMS Service Issue',
  };
  const troubleDesc = troubleDescriptions[intake.templateType] || stepText;

  return `Hi ${vendorTeam},\n\nWe are submitting a ticket for investigation.\n\n` +
    `Issue Type: ${intake.templateType}\n` +
    `Trouble Description: ${troubleDesc}\n\n` +
    `── Mandatory Fields ──\n${fieldLines}\n\n` +
    `── Additional Context ──\n` +
    `  Customer: ${customerName || 'N/A'} (${lookup?.customer?.email || 'N/A'})\n` +
    `  Individual ID: ${lookup?.customer?.individualId || 'N/A'}\n` +
    `  Order: ${lookup?.orders?.[0]?.orderId || 'N/A'} — Status: ${lookup?.orders?.[0]?.status || 'N/A'}` +
    `${signoff}`;
}

function buildTimeline(lookup, payments, tickets, mochi) {
  const events = [];

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

  if (payments && Array.isArray(payments)) {
    for (const p of payments.slice(0, 10)) {
      events.push({ type: 'payment', label: 'Payment: ' + (p.name || p.status || 'attempt'), date: p.payment_date || p.paymentDate || p.created_at, status: p.status });
    }
  }

  if (mochi) {
    for (const m of mochi) {
      events.push({ type: 'mochi', label: 'Mochi: ' + (m.category || m.title || 'conversation'), date: m.created_at, escalated: m.escalated === 'true' });
    }
  }

  if (tickets && tickets.tickets) {
    for (const t of tickets.tickets) {
      events.push({ type: 'zendesk', label: 'Ticket: ' + (t.subject || '#' + t.id), date: t.created_at, status: t.status });
    }
  }

  events.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  return events;
}

// ── Timer computation ────────────────────────────────────────

function computeTimers(lookup, previousContacts, zendeskTickets, nextSteps) {
  const timers = {};

  // 1. Onboarding stall timer — find last completed step and next pending step
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
    const latest = previousContacts[0]; // sorted newest first
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

  // 4. Next step SLA timer — time remaining to complete the next agent action
  if (nextSteps && nextSteps.length > 0) {
    const actionStep = nextSteps.find(s => s.sla && (s.type === 'ask_info' || s.type === 'customer_action'));
    if (actionStep && actionStep.sla) {
      // Reference point: last contact → oldest open ticket → onboarding stall → now
      let refTime = null;
      if (timers.lastContact && timers.lastContact.since) {
        refTime = new Date(timers.lastContact.since).getTime();
      } else if (timers.ticketAge && timers.ticketAge.since) {
        refTime = new Date(timers.ticketAge.since).getTime();
      } else if (timers.onboarding && timers.onboarding.since) {
        refTime = new Date(timers.onboarding.since).getTime();
      } else {
        refTime = Date.now(); // SLA starts now
      }
      {
        const deadlineMs = refTime + (actionStep.sla.minutes * 60000);
        const remainingMs = deadlineMs - Date.now();
        const remainingMin = Math.round(remainingMs / 60000);
        timers.nextStepSla = {
          label: actionStep.sla.label,
          stepText: actionStep.text,
          deadlineMs,
          remainingMin,
          overdue: remainingMin < 0,
        };
      }
    }
  }

  return timers;
}

// ── Customer State Engine (v3) ───────────────────────────────

/**
 * Determine journey stage from customer data.
 * Returns a human-readable stage description.
 */
function computeJourneyStage(lookup, posthogFriction) {
  if (!lookup || !lookup.found) return { stage: 'unknown', label: 'Unknown' };

  const orders = lookup.orders || [];
  const ind = lookup.individual;
  const indStatus = ind ? (ind.status || (Array.isArray(ind) ? (ind[0] && ind[0].status) : null)) : null;
  const frictionTypes = (posthogFriction || []).map(f => f.type);

  if (orders.length === 0) {
    // PostHog enhancement: detect survey abandonment
    if (frictionTypes.includes('survey_abandoned')) {
      return { stage: 'survey_abandoned', label: 'Survey abandoned at step 1' };
    }
    return { stage: 'pre_order', label: 'No orders yet' };
  }

  const latest = orders[0];
  const orderStatus = String(latest.status || '').toUpperCase();

  if (orderStatus === 'FAILED') {
    return { stage: 'order_failed', label: 'Order failed' };
  }

  if (!latest.paymentCompleted) {
    // PostHog enhancement: detect payment failure
    if (frictionTypes.includes('payment_failed_no_retry')) {
      return { stage: 'payment_failed', label: 'Payment failed — no successful retry' };
    }
    return { stage: 'payment_pending', label: 'Paid, awaiting confirmation' };
  }

  if (!latest.activationCompleted) {
    const esim = String(latest.esimStatus || '').toUpperCase();
    if (esim === 'ERROR' || esim === 'FAILED') {
      return { stage: 'esim_failed', label: 'Paid, eSIM failed' };
    }
    // PostHog enhancement: detect eSIM activation failure from behavior
    if (frictionTypes.includes('esim_activation_failed')) {
      return { stage: 'esim_failed', label: 'Paid, eSIM activation failed (PostHog)' };
    }
    // PostHog enhancement: detect stalled eSIM install
    if (frictionTypes.includes('esim_view_no_attempt')) {
      return { stage: 'esim_stalled', label: 'Paid, stalled on eSIM install' };
    }
    return { stage: 'esim_pending', label: 'Paid, eSIM not installed' };
  }

  if (!latest.onboardingCompleted) {
    return { stage: 'onboarding_incomplete', label: 'eSIM active, onboarding incomplete' };
  }

  if (indStatus && String(indStatus).toUpperCase() === 'SUSPENDED') {
    return { stage: 'suspended', label: 'Account suspended' };
  }

  if (indStatus && String(indStatus).toUpperCase() === 'ACTIVE') {
    return { stage: 'active', label: 'Active customer' };
  }

  return { stage: 'completed', label: 'Onboarding complete' };
}

/**
 * Determine ball-in-court from Zendesk ticket tags and status.
 * Priority: explicit ball: tags > ticket status inference
 */
function computeBallInCourt(tickets, commentArrays) {
  const allTickets = (tickets && tickets.tickets) || [];
  if (allTickets.length === 0) return { ball: null, since: null, ticketId: null };

  // Check the most recent open/pending/new ticket
  const activeTicket = allTickets.find(t =>
    t.status === 'open' || t.status === 'pending' || t.status === 'new' || t.status === 'hold'
  );

  if (!activeTicket) return { ball: null, since: null, ticketId: null };

  const tags = activeTicket.tags || [];

  // Check explicit ball tags
  if (tags.includes('ball:ours')) {
    return { ball: 'ours', since: activeTicket.updated_at, ticketId: activeTicket.id };
  }
  if (tags.includes('ball:theirs')) {
    return { ball: 'theirs', since: activeTicket.updated_at, ticketId: activeTicket.id };
  }
  if (tags.includes('ball:partner')) {
    return { ball: 'partner', since: activeTicket.updated_at, ticketId: activeTicket.id };
  }

  // Infer from ticket status
  if (activeTicket.status === 'pending') {
    return { ball: 'theirs', since: activeTicket.updated_at, ticketId: activeTicket.id };
  }
  if (activeTicket.status === 'hold') {
    return { ball: 'partner', since: activeTicket.updated_at, ticketId: activeTicket.id };
  }
  // open or new = ball is ours
  return { ball: 'ours', since: activeTicket.updated_at, ticketId: activeTicket.id };
}

/**
 * Determine if we owe the customer a communication.
 */
function computeCommsDue(ballInCourt, previousContacts, timers) {
  if (!ballInCourt.ball) return { due: false, reason: null };

  const now = Date.now();
  const ballSince = ballInCourt.since ? new Date(ballInCourt.since).getTime() : now;
  const elapsed = now - ballSince;
  const elapsedHours = elapsed / 3600000;

  // Find last outbound message time (from us to customer)
  let lastOutboundTime = null;
  if (previousContacts) {
    const lastEmail = previousContacts.find(c => c.channel === 'Email');
    if (lastEmail && lastEmail.date) lastOutboundTime = new Date(lastEmail.date).getTime();
  }
  const timeSinceOutbound = lastOutboundTime ? (now - lastOutboundTime) / 3600000 : null;

  switch (ballInCourt.ball) {
    case 'ours':
      // We owe the customer — overdue if SLA exceeded
      if (elapsedHours > 4) {
        return { due: true, reason: 'Ball in our court for ' + Math.round(elapsedHours) + ' hours — response overdue', urgency: 'high' };
      }
      if (elapsedHours > 1) {
        return { due: true, reason: 'Ball in our court for ' + Math.round(elapsedHours) + ' hours', urgency: 'medium' };
      }
      return { due: false, reason: null };

    case 'theirs':
      // We're waiting for them — send reminder after 24h
      if (elapsedHours > 48) {
        return { due: true, reason: 'Customer hasn\'t responded in ' + Math.round(elapsedHours) + ' hours — send final nudge', urgency: 'medium' };
      }
      if (elapsedHours > 24) {
        return { due: true, reason: 'Customer hasn\'t responded in ' + Math.round(elapsedHours) + ' hours — send reminder', urgency: 'low' };
      }
      return { due: false, reason: null };

    case 'partner':
      // We're waiting for partner — update customer if SLA exceeded
      if (elapsedHours > 72) {
        return { due: true, reason: 'Partner SLA exceeded (' + Math.round(elapsedHours) + 'h) — update customer', urgency: 'high' };
      }
      if (elapsedHours > 24) {
        return { due: true, reason: 'Partner escalation pending — consider customer update', urgency: 'low' };
      }
      return { due: false, reason: null };

    default:
      return { due: false, reason: null };
  }
}

/**
 * Compute the single next action the agent should take.
 */
function computeNextAction(problem, journeyStage, ballInCourt, commsDue, lookup) {
  // If comms are due, that's the highest priority
  if (commsDue.due && commsDue.urgency === 'high') {
    return {
      action: 'send_followup',
      label: 'Follow up with customer',
      reason: commsDue.reason,
      priority: 'high',
    };
  }

  // Problem-specific actions
  if (problem) {
    switch (problem.type) {
      case 'esim':
        if (journeyStage.stage === 'esim_failed' || journeyStage.stage === 'esim_pending') {
          return {
            action: 'trigger_sim_swap',
            label: 'Trigger SIM Swap',
            reason: 'eSIM not activating — swap to fresh profile',
            priority: 'high',
            actionType: 'sim_swap',
            individualId: lookup?.customer?.individualId,
          };
        }
        break;
      case 'portin':
        return {
          action: 'investigate_portin',
          label: 'Check port-in rejection reason',
          reason: 'Port-in failed — review rejection code and verify customer details',
          priority: 'high',
        };
      case 'refund':
        return {
          action: 'process_refund',
          label: 'Process refund via Stripe',
          reason: 'Customer requesting refund',
          priority: 'high',
        };
      case 'cancellation':
        return {
          action: 'cancel_account',
          label: 'Cancel account',
          reason: 'Customer requesting cancellation',
          priority: 'medium',
        };
      case 'network':
        return {
          action: 'check_outages',
          label: 'Check network outages',
          reason: 'Customer reporting network issues',
          priority: 'high',
        };
      case 'payment':
        return {
          action: 'check_payment',
          label: 'Check payment status in Stripe',
          reason: 'Payment not completed',
          priority: 'high',
        };
      case 'mochi_escalation':
        return {
          action: 'review_mochi',
          label: 'Review Mochi conversation',
          reason: 'Customer escalated from chatbot — don\'t make them repeat',
          priority: 'high',
        };
      case 'login_issue':
        return {
          action: 'check_account',
          label: 'Check account status',
          reason: 'Repeated login failures detected — verify account is active',
          priority: 'medium',
        };
    }
  }

  // If comms are due (lower urgency)
  if (commsDue.due) {
    return {
      action: 'send_followup',
      label: 'Send follow-up',
      reason: commsDue.reason,
      priority: 'medium',
    };
  }

  // Default — review customer state
  return {
    action: 'review',
    label: 'Review customer conversation',
    reason: 'No specific action identified — review latest ticket',
    priority: 'low',
  };
}

/**
 * Load agent-learned patterns from triage-kb.md.
 * Returns the learned patterns section text, or empty string if unavailable.
 */
function loadLearnedPatterns() {
  try {
    const feedbackPath = path.join(__dirname, '..', '..', '..', 'zara-feedback.md');
    const raw = fs.readFileSync(feedbackPath, 'utf-8');

    // Parse feedback entries — extract original vs edited pairs as concrete examples
    const entryBlocks = raw.split(/^### FB-/m).slice(1); // skip header
    if (entryBlocks.length === 0) return '';

    // Take the most recent 5 entries (they're prepended, so first = newest)
    const recentEntries = entryBlocks.slice(0, 5);
    const examples = [];

    for (const block of recentEntries) {
      // Extract problem context
      const problemMatch = block.match(/\*\*Problem\*\*:\s*(.+)/);
      const problem = problemMatch ? problemMatch[1].trim() : 'general';

      // Extract original draft (blockquoted lines after "Original (Zara):")
      const origMatch = block.match(/\*\*Original \(Zara\):\*\*\n((?:>.*\n?)+)/);
      const original = origMatch
        ? origMatch[1].replace(/^> ?/gm, '').trim()
        : null;

      // Extract agent's version (blockquoted lines after "Agent's Version:")
      const editMatch = block.match(/\*\*Agent's Version:\*\*\n((?:>.*\n?)+)/);
      const edited = editMatch
        ? editMatch[1].replace(/^> ?/gm, '').trim()
        : null;

      if (original && edited) {
        examples.push(`Problem: ${problem}\nZara drafted: "${original.substring(0, 200)}"\nAgent changed to: "${edited.substring(0, 200)}"`);
      }
    }

    if (examples.length === 0) return '';
    return examples.join('\n\n');
  } catch (e) {
    return '';
  }
}

/**
 * v3.1: Load LOB system prompt overlay from prompts/{lobId}.md
 * Always returns at least the base-telco overlay so tone is always applied.
 */
function loadLobPromptOverlay(lobId) {
  const basePath = path.join(__dirname, '..', '..', 'prompts', 'base-telco.md');
  let baseOverlay = '';
  try {
    if (fs.existsSync(basePath)) {
      baseOverlay = fs.readFileSync(basePath, 'utf-8').trim();
    }
  } catch (e) { /* ignore */ }

  if (!lobId) return baseOverlay;
  const lobConfig = getLob(lobId);
  if (!lobConfig || !lobConfig.systemPromptOverlay) return baseOverlay;
  const promptPath = path.join(__dirname, '..', '..', 'prompts', lobConfig.systemPromptOverlay);
  try {
    if (fs.existsSync(promptPath)) {
      return fs.readFileSync(promptPath, 'utf-8').trim();
    }
  } catch (e) { /* ignore */ }
  return baseOverlay;
}

/**
 * Generate a suggested response using Claude + brand-comms skill.
 * Returns the draft text or null if AI is not available.
 */
async function generateSuggestedResponse(anthropicClient, problem, journeyStage, customerName, ballInCourt, lookup, agentTier, draftType, lobId) {
  if (!anthropicClient) return null;

  try {
    // Load brand-comms skill for tone guidance
    const brandComms = loadSkill('brand-comms') || '';
    // v3.1: Always load LOB prompt overlay (falls back to base-telco if no LOB)
    const lobPromptOverlay = loadLobPromptOverlay(lobId);
    // Load agent-learned patterns from KB feedback loop
    const learnedPatterns = loadLearnedPatterns();

    const context = [];
    context.push(`Customer name: ${customerName || 'there'}`);
    context.push(`Journey stage: ${journeyStage.label}`);
    if (problem) context.push(`Problem: ${problem.problem}`);
    if (ballInCourt.ball) context.push(`Ball in court: ${ballInCourt.ball}`);
    if (lookup?.orders?.length > 0) {
      const o = lookup.orders[0];
      context.push(`Latest order status: ${o.status}, eSIM: ${o.esimStatus || 'N/A'}`);
    }
    if (lookup?.mochi?.length > 0) {
      context.push(`Last Mochi chat: ${lookup.mochi[0].title || lookup.mochi[0].category || 'conversation'}`);
    }
    context.push(`Agent tier: ${agentTier || 'L0'}`);
    context.push(`Draft type: ${draftType || 'customer'}`);

    // Build verified facts from API data (Tier 1 — not AI-generated)
    // These are human-readable so agents can glance at them in 2 seconds
    const facts = [];
    if (lookup?.orders?.length > 0) {
      const o = lookup.orders[0];
      if (o.paymentCompleted) facts.push('Payment went through');
      else facts.push('Payment has NOT completed');
      if (o.esimStatus) {
        const esimMap = { ALLOCATED: 'eSIM assigned but not installed', INSTALLED: 'eSIM installed', ACTIVATED: 'eSIM active', DOWNLOADED: 'eSIM downloaded to device' };
        facts.push(esimMap[o.esimStatus] || 'eSIM status: ' + o.esimStatus);
      }
      if (o.status) {
        const orderMap = { INPROGRESS: 'Order is being processed', COMPLETED: 'Order completed', CANCELLED: 'Order was cancelled', FAILED: 'Order failed' };
        facts.push(orderMap[o.status] || 'Order status: ' + o.status);
      }
    }
    if (lookup?.individual) {
      const status = lookup.individual.status || (Array.isArray(lookup.individual) ? lookup.individual[0]?.status : null);
      if (status) {
        const acctMap = { ACTIVE: 'Account is active', SUSPENDED: 'Account is suspended', TERMINATED: 'Account is terminated' };
        facts.push(acctMap[status.toUpperCase()] || 'Account ' + status.toLowerCase());
      }
    }
    if (lookup?.portStatus) {
      const ps = lookup.portStatus.status || lookup.portStatus.portStatus;
      if (ps) {
        const portMap = { PENDING: 'Number port-in is pending', COMPLETED: 'Number ported successfully', FAILED: 'Number port-in failed', CANCELLED: 'Number port-in cancelled' };
        facts.push(portMap[ps.toUpperCase()] || 'Port-in: ' + ps);
      }
    }
    if (journeyStage?.label) facts.push('Customer stage: ' + journeyStage.label);
    if (lookup?.customer?.individualId) facts.push('Individual ID: ' + lookup.customer.individualId);
    if (lookup?.customer?.email) facts.push('Email: ' + lookup.customer.email);
    if (lookup?.msisdn) facts.push('Phone: ' + lookup.msisdn);

    // v3.0: Use LOB display name in draft instructions
    const lobDisplayName = (lobId && getLob(lobId)) ? getLob(lobId).displayName : 'Meow Mobile';

    // Tier-specific prompt instructions
    let draftInstruction;
    if (draftType === 'internal' || draftType === 'vendor') {
      draftInstruction = `You are an L1-3 escalation agent at ${lobDisplayName}. Generate a concise INTERNAL NOTE for the ticket — not a customer-facing email. This note is read by the CS team and L0 agents, NOT the customer. Use THIRD-PERSON language throughout: "the customer's account" not "your account", "the customer reported" not "you reported". Use a structured format: Issue, Customer, Findings, Action Taken/Next Steps. Keep it factual and brief.`;
      if (draftType === 'vendor') {
        const lobConf = lobId ? getLob(lobId) : null;
        const lobVendor = lobConf && lobConf.nonTelcoProblemTypes[problem?.type]
          ? lobConf.nonTelcoProblemTypes[problem.type].vendorTeam : null;
        const vendorTeam = lobVendor || VENDOR_MAP[problem?.type] || 'Partner Team';
        draftInstruction += ` Note that this issue is being escalated to ${vendorTeam}.`;
      }
    } else {
      draftInstruction = `You are a ${lobDisplayName} support agent. Generate a short, warm customer email response.`;
    }
    // v3.0: Append LOB brand voice overlay
    if (lobPromptOverlay) {
      draftInstruction += `\n\n## LOB Brand Context\n${lobPromptOverlay}`;
    }

    const resp = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `${draftInstruction}

${brandComms && draftType === 'customer' ? '## Brand Guidelines\n' + brandComms.substring(0, 1500) + '\n\n' : ''}${learnedPatterns && draftType === 'customer' ? '## How agents actually edit drafts (learn from these real examples)\nBelow are recent cases where agents changed Zara\'s draft before sending. Study the differences and apply the same preferences to your draft.\n\n' + learnedPatterns.substring(0, 1500) + '\n\n' : ''}## Customer Context
${context.join('\n')}

## Verified Facts Available
${facts.join('\n')}

Respond in JSON format:
{
  "draft": "the ${draftType === 'internal' || draftType === 'vendor' ? 'internal note' : 'email body'} text",
  "basedOn": [],
  "verify": []
}

Rules:
- Write ONLY the ${draftType === 'internal' || draftType === 'vendor' ? 'note' : 'email'} body (no subject line). Under ${draftType === 'customer' ? '100' : '150'} words. ${draftType === 'customer' ? 'Be warm and specific.' : 'Be concise and factual.'}
- NEVER use em dashes (\u2014 or \u2013) - use spaced hyphens instead. NEVER use semicolons - use periods. Do NOT start with "Certainly!", "Absolutely!", "I understand your frustration", "I'd be happy to help", or any filler opener. Do NOT end with "Don't hesitate to reach out" or "I hope this helps". Write like a real person, not a chatbot.
- "basedOn": For each claim in the draft that is backed by a verified fact above, add a SHORT phrase describing what the draft says and that it's confirmed. Example: if the draft says "your payment went through" and the fact confirms it, add "Payment confirmed". Only include facts the draft actually references. Max 4 items.
- "verify": ONLY add items if the draft makes a claim NOT backed by the verified facts, or the customer asked something the draft doesn't fully address. Each item should be a specific action: "Check X before sending". Usually this is empty.`,
      }],
    });

    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    console.log('  ✉ Draft AI raw:', text.substring(0, 200));
    try {
      // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
      const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      // Fix literal newlines inside JSON string values (AI often outputs them unescaped)
      let fixed = '', inStr = false, esc = false;
      for (const c of cleaned) {
        if (esc) { fixed += c; esc = false; continue; }
        if (c === '\\' && inStr) { fixed += c; esc = true; continue; }
        if (c === '"') { inStr = !inStr; fixed += c; continue; }
        fixed += (c === '\n' && inStr) ? '\\n' : c;
      }
      const parsed = JSON.parse(fixed);
      return {
        text: humanizeText(parsed.draft || text),
        basedOn: parsed.basedOn || [],
        verify: parsed.verify || [],
      };
    } catch {
      // JSON.parse still failed — try regex extraction as fallback
      const m = text.match(/"draft"\s*:\s*"([\s\S]+?)"\s*,\s*\n?\s*"basedOn"/);
      if (m) {
        return { text: humanizeText(m[1]), basedOn: [], verify: [] };
      }
      return { text: humanizeText(text.trim()), basedOn: [], verify: [] };
    }
  } catch (e) {
    console.warn('  ⚠ Suggested response generation failed:', e.message);
    return null;
  }
}

// ── AI-Powered Escalation Package Generator ──────────────────

async function generateEscalationPackage(anthropicClient, problem, lookup, customerName, intake, lobId) {
  const kbContext = getKBContext(problem.type, lobId);
  // v3.0: Use LOB-specific vendor team if available
  const lobConfig = lobId ? getLob(lobId) : null;
  const lobVendor = lobConfig && lobConfig.nonTelcoProblemTypes[problem.type]
    ? lobConfig.nonTelcoProblemTypes[problem.type].vendorTeam : null;
  const vendorTeam = lobVendor || VENDOR_MAP[problem.type] || 'Partner Team';
  const templateType = PROBLEM_TO_TEMPLATE[problem.type] || 'Subscriber Connectivity';

  // Build the mandatory fields section from intake
  const fieldLines = (intake?.fields || []).map(f => {
    const val = f.value || '[NEEDS AGENT INPUT]';
    return `  ${f.field}: ${val}`;
  }).join('\n');

  // Build evidence from API data (structured extraction replaces raw JSON dumps)
  const ev = extractStructuredEvidence(lookup);
  const evidence = [];
  if (lookup.orders?.[0]) {
    const o = lookup.orders[0];
    evidence.push(`Order ${o.orderId}: status=${o.status}, eSIM=${o.esimStatus || 'N/A'}`);
    if (o.paymentCompleted) evidence.push(`Payment completed: ${o.paymentCompleted}`);
    if (o.portinResponse) evidence.push(`Port-in response: ${o.portinResponse}`);
  }
  // Execution steps (structured)
  if (ev.executionSteps.length > 0) {
    evidence.push(`Execution steps: ${ev.executionSteps.map(s => `${s.name}=${s.state}`).join(', ')}`);
  }
  if (ev.failedSteps.length > 0) {
    evidence.push(`Failed/cancelled steps: ${ev.failedSteps.join(', ')}`);
  }
  // RCA errors (structured)
  if (ev.rcaFailedItems.length > 0) {
    evidence.push(`RCA failed items: ${ev.rcaFailedItems.map(f => f.parent).join(', ')}`);
  }
  for (const err of ev.rcaErrors) {
    if (err.code) evidence.push(`Error code: ${err.code}`);
    if (err.message) evidence.push(`Error message: ${err.message}`);
  }
  if (ev.rcaTimestamp) evidence.push(`RCA timestamp: ${ev.rcaTimestamp}`);
  // Port status (structured)
  if (ev.portState) evidence.push(`Port state: ${ev.portState}`);
  if (ev.portRejectionReason) evidence.push(`Port rejection: ${ev.portRejectionReason}`);
  if (ev.portCarrierResponse) evidence.push(`Carrier response: ${ev.portCarrierResponse}`);
  // Inferences (when raw data was sparse)
  if (ev.inferredFailedStep) evidence.push(`Inferred failed step: ${ev.inferredFailedStep}`);
  if (ev.inferredFailureCategory) evidence.push(`Inferred category: ${ev.inferredFailureCategory}`);
  if (ev.inferredErrorMessage) evidence.push(`Inferred error: ${ev.inferredErrorMessage}`);
  if (ev.inferredImpactedSystem) evidence.push(`Inferred system: ${ev.inferredImpactedSystem}`);

  const lobDisplayName = lobConfig ? lobConfig.displayName : 'Meow Mobile';

  const prompt = `You are an L1+ support engineer at ${lobDisplayName} writing an escalation email to ${vendorTeam}.

Generate a structured escalation email following this EXACT format. Be concise, factual, evidence-based.

FORMAT:
Hi ${vendorTeam},

We are submitting a ticket for investigation.

## 1. Executive Summary
Problem: [What failed, at which step, in which system - 1-2 sentences based on evidence]
Root Cause: [Most likely category from KB + explanation - 1 sentence]
Action Requested: [What you need from the partner - 1 sentence]

## 2. Failure Details
- Issue Type: ${templateType}
- Failed Step: [from execution data, or best inference]
- Error: [code + message if available]
- Timestamp: [when failure occurred]
- System: [which system failed - ConnectX, AT&T, SM-DP+, etc.]

## 3. Evidence
[2-4 bullets of strongest indicators from the data below]

## 4. Mandatory Fields
${fieldLines}

Please investigate and advise on next steps.

Thanks,
${lobDisplayName} Support

---
CUSTOMER DATA:
- Name: ${customerName || 'N/A'}
- Email: ${lookup.customer?.email || 'N/A'}
- Individual ID: ${lookup.customer?.individualId || 'N/A'}
- MSISDN: ${lookup.msisdn || 'N/A'}
- Problem detected: ${problem.problem}

STRUCTURED EVIDENCE (use these directly - do NOT write [NEEDS AGENT INPUT] if a value is provided):
- Order ID: ${ev.orderId || 'N/A'}
- Order State: ${ev.orderState || 'N/A'}
- Order Date: ${ev.orderDate || 'N/A'}
- Payment: ${ev.paymentCompleted || 'Not completed'}
- eSIM Status: ${ev.esimStatus || 'N/A'}
- Execution Steps: ${ev.executionSteps.map(s => `${s.name}=${s.state}`).join(', ') || 'N/A'}
- Failed Steps: ${ev.failedSteps.join(', ') || 'None'}
- RCA Errors: ${ev.rcaErrors.map(e => `${e.code || 'Error'}: ${e.message}`).join('; ') || 'None'}
- RCA Timestamp: ${ev.rcaTimestamp || 'N/A'}
- Port State: ${ev.portState || 'N/A'}
- Port Rejection: ${ev.portRejectionReason || 'N/A'}
- Inferred Failed Step: ${ev.inferredFailedStep || 'N/A'}
- Inferred Category: ${ev.inferredFailureCategory || 'N/A'}
- Inferred Error: ${ev.inferredErrorMessage || 'N/A'}
- Inferred System: ${ev.inferredImpactedSystem || 'N/A'}

EVIDENCE FROM APIS:
${evidence.join('\n')}

${kbContext ? `KB ERROR PATTERNS (from article ${kbContext.articleId}):
${kbContext.errorPatterns.map(e => `- ${e.code}: ${e.meaning}`).join('\n')}

KB ROOT CAUSE CATEGORIES:
${kbContext.rootCauseCategories.join(', ')}

KB KNOWN FAILURE STEPS:
${kbContext.failureSteps.join(' → ')}

KB RESOLUTION (partner tier):
${kbContext.resolutionByTier.partner}` : ''}

RULES:
- Write ONLY the email body. No subject line.
- Base analysis ONLY on evidence - never speculate.
- Use values from STRUCTURED EVIDENCE directly. Prefer explicit data, then inferred data.
- Only write [NEEDS AGENT INPUT] if the value is genuinely missing from ALL evidence sources.
- Never write [NEEDS AGENT INPUT] for Error or Timestamp if execution steps, RCA errors, or inferences provide values.
- Match error codes against KB patterns when possible.
- NEVER use em dashes or semicolons. Use spaced hyphens and periods.
- Do NOT use filler language. Be direct and professional.`;

  try {
    const resp = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    return {
      vendorTeam,
      templateType,
      text: humanizeText(text.trim()),
      fields: intake?.fields || [],
      completeness: intake?.completeness || 0,
      hasTriageAnalysis: true,
    };
  } catch (e) {
    console.warn('  ⚠ Escalation package AI failed, falling back to template:', e.message);
    return {
      vendorTeam,
      templateType,
      text: humanizeText(buildVendorDraft(problem.type, 'customer_action', '', customerName, lookup, lobDisplayName)),
      fields: intake?.fields || [],
      completeness: intake?.completeness || 0,
      hasTriageAnalysis: false,
    };
  }
}

/**
 * Build a consolidated timeline across ALL tickets (not just the latest order).
 * This is the "one customer, one story" view.
 */
/**
 * Build 1-2 sentence summaries per ticket conversation from comment text.
 * Each entry: { ticketId, subject, date, status, channel, summary }
 */
/**
 * Classify a contact into a topic label from tags, subject, and message text.
 * Returns a short, agent-readable label like "eSIM activation issue".
 */
function classifyContactTopic(tags, subject, messageText) {
  const blob = [
    (tags || []).join(' '),
    subject || '',
    messageText || '',
  ].join(' ').toLowerCase();

  // Ordered by specificity — first match wins
  const topics = [
    { pattern: /refund|money back|charge.?back|overcharge|double.?charge/, label: 'Refund request' },
    { pattern: /cancel|terminat|close.?account|end.?service/, label: 'Cancellation request' },
    { pattern: /port.?out|switch.?carrier|leaving|transfer.?out/, label: 'Port-out request' },
    { pattern: /port.?in|transfer.?number|ntp|porting|number.?transfer|keep.?my.?number/, label: 'Port-in issue' },
    { pattern: /esim|e.?sim|qr.?code|activation|provision|download.?profile|install.?sim/, label: 'eSIM activation issue' },
    { pattern: /sim.?swap|replace.?sim|new.?sim/, label: 'SIM swap request' },
    { pattern: /payment|billing|invoice|charge|declined|card|autopay|stripe/, label: 'Billing/payment issue' },
    { pattern: /no.?service|no.?signal|network|outage|coverage|roaming|data.?not.?work|can'?t.?call|can'?t.?text/, label: 'Network/service issue' },
    { pattern: /airvet|pet|vet|insurance/, label: 'Airvet/pet insurance inquiry' },
    { pattern: /login|password|can'?t.?sign|otp|verify.?email|locked.?out|auth/, label: 'Login/account access issue' },
    { pattern: /suspend|reactivat|resume/, label: 'Account suspension' },
    { pattern: /plan|upgrade|downgrade|change.?plan|pricing|subscription/, label: 'Plan change request' },
    { pattern: /device|imei|compatibility|phone.?not.?work/, label: 'Device compatibility issue' },
    { pattern: /order|track|shipping|deliver|status/, label: 'Order status inquiry' },
    { pattern: /app.?crash|bug|error|glitch|not.?loading/, label: 'App issue' },
  ];

  for (const t of topics) {
    if (t.pattern.test(blob)) return t.label;
  }

  // Fallback: use the subject/title directly (cleaned up) instead of "General inquiry"
  if (subject) {
    // Strip "Re:", "Fwd:", ticket prefixes, and trim
    let cleaned = subject
      .replace(/^(re|fwd|fw)\s*:\s*/i, '')
      .replace(/^ticket\s*#?\d*\s*[-:]\s*/i, '')
      .replace(/^new\s+conversation\s*$/i, '')
      .trim();
    if (cleaned && cleaned.length > 3) {
      return cleaned.length > 50 ? cleaned.substring(0, 47) + '...' : cleaned;
    }
  }
  // Last resort: use first sentence of message text
  if (messageText) {
    const stripped = messageText
      .replace(/^(hi|hello|hey|dear|good\s+(morning|afternoon|evening))[\s,!.\-:]*/i, '')
      .replace(/^(my name is|i am|this is)\s+\w+[\s,!.\-:]*/i, '')
      .trim();
    const sentences = stripped.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences[0].trim().length > 5) {
      const s = sentences[0].trim();
      return s.length > 50 ? s.substring(0, 47) + '...' : s;
    }
  }
  return 'Support contact';
}

function buildCorrespondenceSummaries(tickets, commentArrays, mochi) {
  const summaries = [];
  const allTickets = (tickets && tickets.tickets) || [];

  // Track Mochi escalation dates so we can deduplicate tickets created from Mochi
  const mochiEscalationDates = new Set();
  if (mochi) {
    for (const m of mochi) {
      if (m.escalated === 'true' && m.created_at) {
        // Store date portion for fuzzy matching (Mochi escalation creates a ticket ~same time)
        mochiEscalationDates.add(new Date(m.created_at).toISOString().slice(0, 10));
      }
    }
  }

  for (let i = 0; i < allTickets.length; i++) {
    const t = allTickets[i];
    const comments = (commentArrays && commentArrays[i] && Array.isArray(commentArrays[i])) ? commentArrays[i] : [];

    // Extract first customer message for topic classification
    let firstCustomerMsg = '';
    for (const c of comments) {
      const body = (c.body || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      if (!body) continue;
      const isCustomer = c.via && c.via.source && c.via.source.from && c.via.source.from.address;
      if (isCustomer) { firstCustomerMsg = body; break; }
    }

    const topic = classifyContactTopic(t.tags, t.subject, firstCustomerMsg);

    // Build outcome string
    let outcome = '';
    const isResolved = t.status === 'solved' || t.status === 'closed';
    if (isResolved) {
      // Find last agent message as resolution hint
      let lastAgentMsg = '';
      for (let ci = comments.length - 1; ci >= 0; ci--) {
        const c = comments[ci];
        if (c.public !== false) {
          const isAgent = !(c.via && c.via.source && c.via.source.from && c.via.source.from.address);
          if (isAgent) {
            lastAgentMsg = (c.body || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
            break;
          }
        }
      }
      // Extract a short resolution hint from the last agent reply
      if (lastAgentMsg) {
        const stripped = lastAgentMsg
          .replace(/^(hi|hello|hey|thank)[\s,!.\-:]*/i, '')
          .replace(/Best regards[\s\S]*/i, '')
          .replace(/Kind regards[\s\S]*/i, '')
          .trim();
        const sentences = stripped.match(/[^.!?]+[.!?]+/g);
        outcome = sentences ? sentences[0].trim() : stripped;
        if (outcome.length > 80) outcome = outcome.substring(0, 77) + '...';
      }
      if (!outcome) outcome = 'Resolved';
    } else if (t.status === 'pending') {
      outcome = 'Waiting on customer';
    } else if (t.status === 'hold') {
      outcome = 'On hold';
    } else {
      outcome = 'Open';
    }

    // Check if this ticket was created from a Mochi escalation (same day, subject hints)
    const ticketDate = t.created_at ? new Date(t.created_at).toISOString().slice(0, 10) : '';
    const isMochiEscalation = mochiEscalationDates.has(ticketDate) && (
      (t.tags || []).some(tag => tag.toLowerCase().includes('mochi')) ||
      (t.subject || '').toLowerCase().includes('mochi') ||
      (t.via && t.via.channel === 'api')
    );

    summaries.push({
      ticketId: t.id,
      subject: t.subject || 'Ticket #' + t.id,
      date: t.created_at,
      updatedAt: t.updated_at,
      status: t.status,
      channel: isMochiEscalation ? 'mochi_escalation' : ((t.via && t.via.channel) || 'unknown'),
      messageCount: comments.length,
      summary: topic,
      outcome,
    });

    // If this ticket came from Mochi, mark that date as consumed
    if (isMochiEscalation) mochiEscalationDates.delete(ticketDate);
  }

  // Mochi conversations — only add those NOT already represented by a ticket
  if (mochi) {
    for (const m of mochi) {
      const mDate = m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : '';
      const wasEscalated = m.escalated === 'true';

      // Skip if this escalation was already merged into a ticket entry above
      if (wasEscalated && !mochiEscalationDates.has(mDate)) continue;

      const mochiTitle = m.title || m.category || null;
      const topic = classifyContactTopic([], mochiTitle, m.category || '');
      const msgCount = parseInt(m.message_count) || null;

      summaries.push({
        ticketId: null,
        subject: m.title || m.category || 'Chat',
        date: m.created_at,
        status: wasEscalated ? 'escalated' : 'resolved',
        channel: 'mochi',
        messageCount: msgCount,
        summary: topic,
        outcome: wasEscalated ? 'Escalated to agent' : 'Resolved by bot',
      });
    }
  }

  summaries.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  return summaries;
}

function buildConsolidatedTimeline(lookup, payments, tickets, mochi, commentArrays, posthogEvents) {
  const events = [];

  // ALL orders (not just most recent)
  if (lookup && lookup.orders) {
    for (const o of lookup.orders) {
      if (o.createdAt) events.push({ type: 'order', label: 'Order created', date: o.createdAt, status: o.status, orderId: o.orderId });
      if (o.paymentCompleted) events.push({ type: 'onboarding', label: 'Payment completed', date: o.paymentCompleted, orderId: o.orderId });
      if (o.activationCompleted) events.push({ type: 'onboarding', label: 'eSIM activated', date: o.activationCompleted, orderId: o.orderId });
      if (o.onboardingCompleted) events.push({ type: 'onboarding', label: 'Onboarding completed', date: o.onboardingCompleted, orderId: o.orderId });
    }
  }

  // Payment attempts
  if (payments && Array.isArray(payments)) {
    for (const p of payments.slice(0, 10)) {
      events.push({ type: 'payment', label: 'Payment: ' + (p.name || p.status || 'attempt'), date: p.payment_date || p.paymentDate || p.created_at, status: p.status });
    }
  }

  // Mochi conversations
  if (mochi) {
    for (const m of mochi) {
      events.push({ type: 'mochi', label: 'Mochi: ' + (m.category || m.title || 'conversation'), date: m.created_at, escalated: m.escalated === 'true' });
    }
  }

  // ALL Zendesk tickets
  if (tickets && tickets.tickets) {
    for (const t of tickets.tickets) {
      events.push({ type: 'zendesk', label: 'Ticket: ' + (t.subject || '#' + t.id), date: t.created_at, status: t.status, ticketId: t.id });
    }
  }

  // Ticket comments (if available) — shows what was communicated
  if (commentArrays) {
    for (const comments of commentArrays) {
      if (Array.isArray(comments)) {
        for (const c of comments) {
          if (c.created_at && c.body) {
            const isAgent = c.public === true || c.public === undefined;
            const snippet = (c.body || '').substring(0, 80).replace(/\n/g, ' ');
            events.push({
              type: 'comment',
              label: (isAgent ? 'Agent' : 'Internal') + ': ' + snippet + (c.body.length > 80 ? '...' : ''),
              date: c.created_at,
              public: c.public,
            });
          }
        }
      }
    }
  }

  // PostHog behavioral events (key milestones only)
  if (posthogEvents && posthogEvents.length > 0) {
    const posthogMilestones = new Set([
      'survey_started', 'survey_order_created',
      'payment_attempt', 'payment_failed', 'purchase',
      'af_esim_activation_attempt', 'af_esim_activation_failed',
      'af_portin', 'af_portin_status',
      'af_mochi', 'af_mochi_failed',
    ]);
    const posthogLabels = {
      survey_started: 'Survey started',
      survey_order_created: 'Survey order created',
      payment_attempt: 'Payment attempted',
      payment_failed: 'Payment failed',
      purchase: 'Purchase completed',
      af_esim_activation_attempt: 'eSIM activation attempted',
      af_esim_activation_failed: 'eSIM activation failed',
      af_portin: 'Port-in submitted',
      af_portin_status: 'Port-in status checked',
      af_mochi: 'Mochi chat started',
      af_mochi_failed: 'Mochi chat failed',
    };
    for (const ev of posthogEvents) {
      if (posthogMilestones.has(ev.event)) {
        events.push({
          type: 'posthog',
          label: (posthogLabels[ev.event] || ev.event),
          date: ev.timestamp,
        });
      }
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

// ── Time ago helper ──────────────────────────────────────────

function timeAgoLabel(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'min ago';
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 48) return hrs + 'h ago';
  const days = Math.floor(diff / 86400000);
  return days + 'd ago';
}

// ── Tier detection from Zendesk group name ──────────────────
const GROUP_TIER_KEYWORDS = {
  'l0': 'L0', 'tier 0': 'L0', 'tier0': 'L0', 'level 0': 'L0',
  'l1': 'L1', 'tier 1': 'L1', 'tier1': 'L1', 'level 1': 'L1',
  'l2': 'L2', 'tier 2': 'L2', 'tier2': 'L2', 'level 2': 'L2',
  'l3': 'L3', 'tier 3': 'L3', 'tier3': 'L3', 'level 3': 'L3', 'engineering': 'L3',
};

function detectTier(groupName) {
  if (!groupName) return 'L0';
  const lower = groupName.toLowerCase();
  for (const [keyword, tier] of Object.entries(GROUP_TIER_KEYWORDS)) {
    if (lower.includes(keyword)) return tier;
  }
  return 'L0';
}

// ── POST /api/customer/agent-brief ───────────────────────────

router.post('/agent-brief', async (req, res) => {
  const { email, tier } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  console.log(`  → Agent brief: ${email}`);

  try {
    // Phase 1: parallel — customer lookup + Zendesk tickets + PostHog events
    let posthogResult = { events: [] };
    const [lookup, zendeskResult] = await Promise.all([
      performCustomerLookup(email),
      zendeskSearch(`type:ticket requester:${email}`),
      queryPostHog(email).then(r => { posthogResult = r; }).catch(() => {}),
    ]);

    if (!lookup.found) {
      // v3.0: Still try LOB detection from Zendesk tags even when customer not found
      let lob = null;
      const latestTicket = (zendeskResult.tickets || [])[0];
      if (latestTicket) {
        const { resolveLobFromTicketTags } = require('../lib/lob-resolver');
        lob = resolveLobFromTicketTags(latestTicket);
      }
      if (req.body.lobId) {
        const overrideLob = getLob(req.body.lobId);
        if (overrideLob) lob = { lobId: overrideLob.lobId, displayName: overrideLob.displayName, shortName: overrideLob.shortName, color: overrideLob.color, icon: overrideLob.icon };
      }
      const lobConfig = lob ? getLob(lob.lobId) : null;
      return res.json({ found: false, lob, lobConfig: lobConfig || null });
    }

    // Enrich cohort from Zendesk ticket tags (supplements data-level detection)
    enrichCohortFromTags(lookup.customer, zendeskResult);

    // v3.0: Resolve LOB — try Zendesk ticket tags as fallback if not detected from Boss
    const latestTicketForLob = (zendeskResult.tickets || [])[0];
    if (!lookup.lob && latestTicketForLob) {
      const { resolveLobFromTicketTags } = require('../lib/lob-resolver');
      lookup.lob = resolveLobFromTicketTags(latestTicketForLob);
    }
    // If LOB override from frontend
    if (req.body.lobId) {
      const overrideLob = getLob(req.body.lobId);
      if (overrideLob) {
        lookup.lob = { lobId: overrideLob.lobId, displayName: overrideLob.displayName, shortName: overrideLob.shortName, color: overrideLob.color, icon: overrideLob.icon };
      }
    }
    const lobId = lookup.lob ? lookup.lob.lobId : null;
    const lobConfig = lobId ? getLob(lobId) : null;

    // Auto-detect tier from the latest ticket's assigned group
    let agentTier = 'L0';
    if (tier === 'L1+') {
      agentTier = 'L1+';  // respect explicit override from frontend
    } else {
      const latestTicket = (zendeskResult.tickets || [])[0];
      if (latestTicket && latestTicket.group_id) {
        try {
          const gData = await zendeskGet(`/api/v2/groups/${latestTicket.group_id}.json`);
          const groupName = gData.group.name || '';
          const detectedTier = detectTier(groupName);
          if (detectedTier !== 'L0') agentTier = 'L1+';
        } catch (e) { /* group fetch failed, stay L0 */ }
      }
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

    // Phase 3: PostHog friction detection
    const posthogEvents = posthogResult.events || [];
    const posthogFriction = detectPostHogFriction(posthogEvents);
    if (posthogFriction.length > 0) {
      console.log(`  → PostHog: ${posthogEvents.length} events, ${posthogFriction.length} friction signal(s): ${posthogFriction.map(f => f.type).join(', ')}`);
    }

    // Phase 3b: synthesis (rule-based) — now with PostHog friction
    const previousContacts = buildPreviousContacts(zendeskResult.tickets, lookup.mochi);
    let currentProblem = identifyCurrentProblem(lookup, zendeskResult, commentArrays, posthogFriction);
    console.log(`  → Problem detected: ${currentProblem ? currentProblem.type + ' (' + currentProblem.confidence + ')' : 'none'} | Tickets: ${(zendeskResult.tickets || []).length} | Comments: ${commentArrays.length}`);
    const infoCollected = extractInfoFromComments(commentArrays);

    // Phase 3c: Customer State Engine (v3) — with PostHog-enhanced stage
    const journeyStage = computeJourneyStage(lookup, posthogFriction);
    const ballInCourt = computeBallInCourt(zendeskResult, commentArrays);

    // Phase 4: Claude AI fallback if no clear problem
    if (!currentProblem && anthropic) {
      try {
        const ctx = [];
        if (lookup.orders.length > 0) ctx.push(`Latest order status: ${lookup.orders[0].status}`);
        if (lookup.mochi && lookup.mochi.length > 0) ctx.push(`Last Mochi chat: ${lookup.mochi[0].title || lookup.mochi[0].category}`);
        if (zendeskResult.tickets && zendeskResult.tickets.length > 0) {
          const t = zendeskResult.tickets[0];
          ctx.push(`Latest ticket subject: ${t.subject}`);
          ctx.push(`Ticket tags: ${(t.tags || []).join(', ')}`);
          if (t.description) ctx.push(`Ticket description (first 500 chars): ${t.description.substring(0, 500)}`);
        }
        if (commentArrays.length > 0) {
          for (const comments of commentArrays) {
            if (Array.isArray(comments) && comments.length > 0) {
              const firstComment = comments[0].body || '';
              if (firstComment.length > 0) {
                ctx.push(`Customer message (first 600 chars): ${firstComment.substring(0, 600)}`);
                break;
              }
            }
          }
        }
        // Include PostHog friction in AI context
        if (posthogFriction.length > 0) {
          ctx.push(`PostHog behavioral signals: ${posthogFriction.map(f => f.label).join('; ')}`);
        }

        const aiResp = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `A customer (${email}) is contacting support. Based on this data, what is their problem? Respond in one clear sentence.\n\n${ctx.join('\n')}\n\nRespond with ONLY the problem statement, nothing else.`,
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
    const latestTicket = (zendeskResult.tickets || [])[0];
    const ticketChannel = latestTicket && latestTicket.via ? latestTicket.via.channel : null;
    // Attach posthogFriction to lookup so buildNextSteps can reference it
    lookup.posthogFriction = posthogFriction;
    const nextSteps = buildNextSteps(currentProblem, kbArticles, lookup, customerName, ticketChannel, agentTier, infoCollected, lobId);
    // Customer-facing draft follows tier logic; escalation email is a separate package
    const draftType = resolveDraftType(agentTier, currentProblem ? currentProblem.type : null);

    // Phase 4b: Incident intake fields (all customer-facing issue types)
    const CUSTOMER_FACING_TEMPLATES = new Set([
      'Subscriber Connectivity', 'Port-In', 'Port-Out',
      'Billing Issues', 'Voice/SMS/MMS Issues', 'Order Processing',
    ]);
    let incidentIntake = null;
    if (currentProblem) {
      const templateType = PROBLEM_TO_TEMPLATE[currentProblem.type];
      if (templateType && CUSTOMER_FACING_TEMPLATES.has(templateType)) {
        incidentIntake = computeIntakeFields(currentProblem.type, lookup);
      }
    }

    // Phase 5: Skill-based troubleshooting guidance
    let skillGuidance = [];
    if (skillsAvailable()) {
      try {
        skillGuidance = getSkillGuidance(currentProblem, lookup, undefined, lobId);
      } catch (e) {
        console.warn('  ⚠ Skill guidance failed:', e.message);
      }
    }

    // Phase 6: Compute timers + state engine fields
    const timers = computeTimers(lookup, previousContacts, zendeskResult.tickets, nextSteps);
    const commsDue = computeCommsDue(ballInCourt, previousContacts, timers);
    const nextAction = computeNextAction(currentProblem, journeyStage, ballInCourt, commsDue, lookup);

    // Phase 7: Consolidated timeline (all tickets, all channels, + PostHog)
    const timeline = buildConsolidatedTimeline(lookup, payments, zendeskResult, lookup.mochi, commentArrays, posthogEvents);
    const correspondenceSummaries = buildCorrespondenceSummaries(zendeskResult, commentArrays, lookup.mochi);

    // Phase 8: Generate suggested response + escalation package IN PARALLEL
    let suggestedResponse = null;
    let escalationPackage = null;

    if (anthropic) {
      const aiTasks = [
        generateSuggestedResponse(anthropic, currentProblem, journeyStage, customerName, ballInCourt, lookup, agentTier, draftType, lobId),
      ];
      const isVendorEscalatable = currentProblem && VENDOR_MAP[currentProblem.type];
      if (isVendorEscalatable) {
        aiTasks.push(generateEscalationPackage(anthropic, currentProblem, lookup, customerName, incidentIntake, lobId));
      }
      const [draftResult, escResult] = await Promise.allSettled(aiTasks);
      suggestedResponse = draftResult.status === 'fulfilled' ? draftResult.value : null;
      escalationPackage = escResult?.status === 'fulfilled' ? escResult.value : null;
    }

    // Fallback: use static email draft from next steps if no AI response
    if (!suggestedResponse) {
      const draftStep = nextSteps.find(s => s.emailDraft);
      if (draftStep) suggestedResponse = draftStep.emailDraft;
    }

    // Phase 9: Escalation recommendation (deterministic — no AI needed)
    const escalationRecommendation = buildEscalationRecommendation(currentProblem, lookup);

    // Format PostHog friction for response
    const posthogFrictionResponse = posthogFriction.map(f => ({
      type: f.type,
      severity: f.severity,
      label: f.label,
      when: f.event?.timestamp ? timeAgoLabel(f.event.timestamp) : null,
    }));

    console.log(`  ✓ Agent brief: tier=${agentTier}, draft=${draftType}, stage=${journeyStage.stage}, ball=${ballInCourt.ball}, comms_due=${commsDue.due}, problem=${currentProblem ? currentProblem.type : 'none'}, posthog=${posthogFriction.length} signals, ${timeline.length} timeline events`);
    res.json({
      found: true,
      // v3.0: LOB context
      lob: lookup.lob || null,
      lobConfig: lobConfig ? {
        lobId: lobConfig.lobId,
        displayName: lobConfig.displayName,
        shortName: lobConfig.shortName,
        color: lobConfig.color,
        icon: lobConfig.icon,
        funnelSteps: lobConfig.funnelSteps,
        ctaTypes: lobConfig.ctaTypes,
        escalationTiers: lobConfig.escalationTiers,
      } : null,
      // Customer State Engine (v3)
      customerState: {
        journeyStage,
        openIssues: currentProblem ? [currentProblem.problem] : [],
        ballInCourt,
        commsDue,
        nextAction,
        lastComms: previousContacts.length > 0 ? {
          channel: previousContacts[0].channel,
          reason: previousContacts[0].reason,
          date: previousContacts[0].date,
        } : null,
        suggestedResponse,
      },
      // Backward-compatible fields (v2)
      customerName,
      timers,
      previousContacts,
      currentProblem,
      infoCollected,
      nextSteps,
      skillGuidance,
      timeline,
      correspondenceSummaries,
      brazeEmails: lookup.brazeEmails || [],
      kbArticles,
      // PostHog behavioral signals (v4)
      posthogFriction: posthogFrictionResponse,
      // Customer data for actions
      individualId: lookup.customer.individualId,
      // Agent tier context (v5)
      draftType,
      // Incident intake checklist (L1+ vendor escalations)
      incidentIntake,
      // Vendor escalation email (L1+ vendor tickets only)
      escalationPackage,
      // Escalation recommendation (when vendor/partner escalation needed)
      escalationRecommendation,
    });
  } catch (err) {
    console.error('Agent brief error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.performCustomerLookup = performCustomerLookup;
